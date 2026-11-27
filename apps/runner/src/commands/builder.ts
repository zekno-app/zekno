/**
 * `builder` (specs/016-build-from-source, contracts/runner.md RB17 second
 * bullet, RB5, RB6; core.md CO12 `BuilderAnswer`; FR-078 to FR-080): what
 * the server can build with, in a session only, for `zekno doctor` and for
 * zekno's checks before it signs a deploy that builds.
 *
 * RB5's facts (Docker Engine's, buildx's and BuildKit's versions, buildx's
 * driver, the processor) and `can`, the first of `no_docker`,
 * `docker_too_old` and `no_build_plugin` that holds, else `yes`; the
 * machine's memory from `docker info`'s `MemTotal`; RB6's least free space
 * and the floor; `stale`, the build records whose refs are left because
 * Docker could not remove them (item 28); and, only when asked with
 * `usage`, what the runner's images and the build cache take, which costs
 * Docker more work.
 *
 * It takes no lock and does not run RB15's bounded part: data-model.md,
 * "The locks", and RB1 say so, where CO12 and RB17 say "as builds" (tasks
 * .md, "Open notes"). It reads the state once, without the state lock, for
 * the images it names and the build under way. Each Docker call goes
 * through `runDocker` with its limit, and none is made holding a lock.
 */
import {
  builtImageName,
  LIMITS,
  parseMessage,
  RunnerBuilderRequestSchema,
  type RunnerBuilder,
  type RunnerReport,
  type StoredRunnerState,
} from "@workspace/core"
import { lstatSync, statfsSync } from "node:fs"

import { canBuild, dockerFacts, type DockerFacts } from "../builder/facts"
import { refFile, refsNow } from "../builder/history"
import { buildPlaces, dockerRoot, freeBytes, type StatFs } from "../disk/free"
import { NOT_STARTED, runDocker, TIMED_OUT } from "../docker/run"
import { isReport, load, refused } from "./commands"

/** For in-process tests: a stand-in for the filesystem's free space. */
export type BuilderOptions = { statfs?: StatFs }

/** The images one `docker image inspect` names: about 9 KB of arguments. */
const IMAGES_PER_CALL = 64
/** A size Docker prints: whole bytes, at most a safe integer. */
const WHOLE = /^\d{1,15}$/
/** The last line of `docker buildx du`: `Total:` and a size as go-units prints it, `1.234GB`. */
const TOTAL = /^Total:\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)$/
/** The units of a size buildx prints: go-units' decimal ones, and the binary ones should it give those. */
const UNITS: Readonly<Record<string, number>> = {
  B: 1,
  kB: 1e3,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
  PB: 1e15,
  KiB: 2 ** 10,
  MiB: 2 ** 20,
  GiB: 2 ** 30,
  TiB: 2 ** 40,
  PiB: 2 ** 50,
}

/** The machine's memory in bytes, from `docker info --format '{{.MemTotal}}'`; null when Docker does not say. */
async function memory(dir: string): Promise<number | null> {
  const result = await runDocker(dir, ["info", "--format", "{{.MemTotal}}"])
  const shown = result.stdout.trim()
  return result.code === 0 && WHOLE.test(shown) ? Number(shown) : null
}

/**
 * RB6's least free space of the places a build writes to: Docker's root,
 * containerd's folder when it exists, `<home>` and the work folders'
 * parent. Null when one of them cannot be read: Docker did not give its
 * root (no engine, a remote `DOCKER_HOST`), or a folder is gone or not
 * private. A deploy counts such a place as none free (`low_disk`); this
 * answer says it is not known.
 */
async function leastFreeKnown(
  dir: string,
  statfs: StatFs
): Promise<number | null> {
  const root = await dockerRoot(dir)
  // Not known already: the work folders' parent is not made just to say so.
  if (root === undefined) return null
  let places: (string | undefined)[]
  try {
    places = buildPlaces(dir, root)
  } catch {
    // The work folders' parent is not private: it is not read.
    return null
  }
  let least: number | null = null
  for (const place of places) {
    const free = place === undefined ? undefined : freeBytes(place, statfs)
    if (free === undefined) return null
    least = least === null ? free : Math.min(least, free)
  }
  return least
}

/**
 * The refs left in `<home>/buildx/refs` whose records Docker could not
 * remove (RB12, RB15 step 2, item 28 (b)). While a deploy builds, or its
 * stopped build's record still runs, the refs its builds made since it
 * started are its own, not left over: only those older than its `since`
 * count then.
 */
function staleRefs(dir: string, state: StoredRunnerState): number {
  const since =
    state.building === null ? undefined : Date.parse(state.building.since)
  return refsNow(dir).filter((ref) => {
    if (since === undefined) return true
    try {
      return lstatSync(refFile(ref)).mtimeMs < since
    } catch {
      return false // Removed since the folder was read.
    }
  }).length
}

/** Every tag of an image the state names, in `images` or in `drop`, app by app in order, each once. */
function namedTags(state: StoredRunnerState): string[] {
  return Object.keys(state.builds)
    .sort()
    .flatMap((app) => {
      const entry = state.builds[app]!
      return [...entry.images, ...entry.drop]
        .map((image) => image.key)
        .sort()
        .map((key) => builtImageName(app, key))
    })
}

/** True when every line of Docker's error says only that an image is not there. */
const onlyMissing = (stderr: string) =>
  stderr
    .split("\n")
    .filter((line) => line.trim() !== "")
    .every((line) => /no such image/i.test(line))

/**
 * The bytes the runner's images take, from `docker image inspect --format
 * '{{.Size}}'` of each tag the state names, many at a time. An image that is
 * not there takes nothing. Null when Docker did not answer, or printed a
 * size that does not read.
 */
async function imagesSize(
  dir: string,
  state: StoredRunnerState
): Promise<number | null> {
  const tags = namedTags(state)
  let total = 0
  for (let i = 0; i < tags.length; i += IMAGES_PER_CALL) {
    const result = await runDocker(dir, [
      "image",
      "inspect",
      "--format",
      "{{.Size}}",
      ...tags.slice(i, i + IMAGES_PER_CALL),
    ])
    if (result.code === NOT_STARTED || result.code === TIMED_OUT) return null
    if (result.code !== 0 && !onlyMissing(result.stderr)) return null
    for (const line of result.stdout.split("\n")) {
      const shown = line.trim()
      if (shown === "") continue
      if (!WHOLE.test(shown)) return null
      total += Number(shown)
    }
  }
  return total
}

/**
 * The bytes the build cache takes, every app's together, from the `Total:`
 * line of `docker buildx du --builder <the current context's name>`: the
 * builder the runner's builds use and its prune bounds (RB7, RB14). Null
 * when buildx or the context is not known, or Docker's answer does not read.
 */
async function cacheSize(
  dir: string,
  facts: DockerFacts
): Promise<number | null> {
  if (facts.buildx === null || facts.context === null) return null
  const result = await runDocker(dir, [
    "buildx",
    "du",
    "--builder",
    facts.context,
  ])
  if (result.code !== 0) return null
  const total = result.stdout
    .split("\n")
    .map((line) => TOTAL.exec(line.trim()))
    .filter((match) => match !== null)
    .at(-1)
  const unit = total === undefined ? undefined : UNITS[total[2]!]
  if (total === undefined || unit === undefined) return null
  const bytes = Math.round(Number(total[1]) * unit)
  return Number.isSafeInteger(bytes) ? bytes : null
}

/**
 * Answers `builder` (RB17), or refuses: `invalid_request` for an input that
 * is not `{}` or `{ usage: true }` (no input reads as `{}`), and the
 * folder's and the state's own refusals.
 */
export async function builder(
  dir: string,
  input: string,
  options: BuilderOptions = {}
): Promise<RunnerBuilder | RunnerReport> {
  const request = parseMessage(
    RunnerBuilderRequestSchema,
    input === "" ? "{}" : input
  )
  if (!request.ok) return refused("invalid_request")
  const loaded = load(dir)
  if (isReport(loaded)) return loaded
  const { state } = loaded

  const facts = await dockerFacts(dir)
  const answer: RunnerBuilder = {
    docker: {
      engine: facts.engine,
      buildx: facts.buildx,
      buildkit: facts.buildkit,
      driver: facts.driver,
    },
    arch: facts.arch,
    memory: await memory(dir),
    disk: {
      free: await leastFreeKnown(dir, options.statfs ?? statfsSync),
      floor: LIMITS.diskFloorBytes,
    },
    can: canBuild(facts).can,
    stale: staleRefs(dir, state),
  }
  if (request.value.usage) {
    const images = await imagesSize(dir, state)
    const cache = images === null ? null : await cacheSize(dir, facts)
    answer.usage = images === null || cache === null ? null : { images, cache }
  }
  return answer
}
