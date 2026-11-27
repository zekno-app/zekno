/**
 * `builds` (specs/016-build-from-source, contracts/runner.md RB17 first
 * bullet; core.md CO12, CO13, CO14; FR-045, FR-064, FR-066, FR-080): what
 * the runner keeps of each app's builds, in a session only. `zekno status`
 * and `zekno doctor` read it, and a rollback asks it, before signing,
 * whether the images it would run are still here.
 *
 * - With no input: `{ built }`, the apps that have an entry in the state's
 *   `builds`, sorted.
 * - With `apps` (1 to 8): CO12's `AppBuildsAnswer` for each, from the state
 *   and `kept/`; `records` are the builds of the deploy that runs, and
 *   `building` the state's `building` when it is that app's.
 * - With `check` (1 to 8 keys, exactly one app): `kept`, `gone` or
 *   `changed` for each key, by `docker image inspect` of its tag.
 *
 * No lock for its own work (RB1): the state is written whole and atomically,
 * and `kept/` file by file, so a read without the state lock sees one
 * version or the next. Once the request reads, RB15's bounded part comes
 * first (`boundedFirst`): when the state's `building` is set, the deploy
 * lock is tried once and released before the answer is made. The records
 * are read by `kept/records.ts`, the reader RB14's cleaning goes by.
 * Reading writes nothing.
 */
import {
  builtImageName,
  LIMITS,
  parseMessage,
  RunnerBuildsRequestSchema,
  type AppBuilds,
  type AppBuildsAnswer,
  type BuildRecord,
  type RunnerBuilds,
  type RunnerReport,
  type StoredRunnerState,
} from "@workspace/core"

import { runDocker } from "../docker/run"
import { readRecords } from "../kept/records"
import { boundedFirst, isReport, load, refused } from "./commands"

/** How each image `check` asked about stands (CO12). */
type CheckState = "kept" | "gone" | "changed"

/** The records of the deploy that runs, by its keys in order, each that reads (at most 8, CO12). */
function runningRecords(
  dir: string,
  app: string,
  entry: AppBuilds
): BuildRecord[] {
  const running = entry.deploys.find(
    (deploy) => deploy.sequence === entry.running
  )
  if (running === undefined) return []
  return readRecords(dir, app, running.keys.slice(0, LIMITS.buildsPerDeploy))
}

/** The state's `building` as `builds` gives it for `app`: whole seconds since it started, 0 when its start is ahead of this clock. */
function buildingOf(
  state: StoredRunnerState,
  app: string,
  now: number
): AppBuildsAnswer["building"] {
  const building = state.building
  if (building === null || building.app !== app) return null
  return {
    sequence: building.sequence,
    seconds: Math.max(0, Math.floor((now - Date.parse(building.since)) / 1000)),
    limit: building.limit,
    phase: building.phase,
  }
}

/** What the runner keeps of one app (CO12's `AppBuildsAnswer`); an app with no entry has none of it. */
function answerFor(
  dir: string,
  state: StoredRunnerState,
  app: string,
  now: number
): AppBuildsAnswer {
  const entry = Object.hasOwn(state.builds, app) ? state.builds[app] : undefined
  return {
    running: entry?.running ?? null,
    deploys: (entry?.deploys ?? []).map((deploy) => ({
      sequence: deploy.sequence,
      keys: [...deploy.keys],
    })),
    fresh: (entry?.fresh ?? []).map((each) => ({
      base: each.base,
      sequence: each.sequence,
    })),
    records: entry === undefined ? [] : runningRecords(dir, app, entry),
    last: entry?.last ? { ...entry.last } : null,
    building: buildingOf(state, app, now),
  }
}

/**
 * The `.Id` of the image under `tag`, from `docker image inspect --format
 * '{{.Id}}'` through `runDocker` and its 60-second limit; undefined when
 * Docker shows no image there, because there is none, or because Docker
 * did not answer.
 */
async function imageId(dir: string, tag: string): Promise<string | undefined> {
  const result = await runDocker(dir, [
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    tag,
  ])
  const id = result.stdout.trim()
  return result.code === 0 && id !== "" ? id : undefined
}

/** The tag of a built image (CO2), or undefined when core names none for `app` and `key`. */
function tagOf(app: string, key: string): string | undefined {
  try {
    return builtImageName(app, key)
  } catch {
    return undefined
  }
}

/**
 * `check` for each key, in the order asked (RB17; FR-062, FR-064): `kept`
 * when the state records the key for the app, in `images` or in `drop`,
 * and the image under its tag has an `.Id` equal to one of its digests;
 * `gone` when Docker shows no image under the tag; `changed` when the tag
 * leads to another image, or to any image for a key the state does not
 * record. A Docker that does not answer shows no image: `gone`, so a
 * rollback is never signed on an image nobody could confirm. So is an app
 * the request's schema reads but no built image can be named for (one
 * ending with `-`, CO2): Docker is not asked.
 */
async function checkImages(
  dir: string,
  state: StoredRunnerState,
  app: string,
  keys: readonly string[]
): Promise<Record<string, CheckState>> {
  const entry = Object.hasOwn(state.builds, app) ? state.builds[app] : undefined
  const recorded = [...(entry?.images ?? []), ...(entry?.drop ?? [])]
  const check: Record<string, CheckState> = {}
  for (const key of keys) {
    const tag = tagOf(app, key)
    const id = tag === undefined ? undefined : await imageId(dir, tag)
    const image = recorded.find((each) => each.key === key)
    check[key] =
      id === undefined
        ? "gone"
        : image !== undefined && (id === image.manifest || id === image.config)
          ? "kept"
          : "changed"
  }
  return check
}

/**
 * Answers `builds` (RB17), or refuses: `invalid_request` for an input that
 * is not CO12's (no input reads as `{}`), and the folder's and the state's
 * own refusals. Docker is asked only for `check`.
 */
export async function builds(
  dir: string,
  input: string
): Promise<RunnerBuilds | RunnerReport> {
  const request = parseMessage(
    RunnerBuildsRequestSchema,
    input === "" ? "{}" : input
  )
  if (!request.ok) return refused("invalid_request")
  await boundedFirst(dir)
  const loaded = load(dir)
  if (isReport(loaded)) return loaded
  const { state } = loaded

  if (!("apps" in request.value))
    return {
      built: Object.keys(state.builds).sort().slice(0, LIMITS.appsPerServer),
    }

  const now = Date.now()
  const { apps, check } = request.value
  const answers: Record<string, AppBuildsAnswer> = {}
  for (const app of apps) answers[app] = answerFor(dir, state, app, now)
  // With exactly one app, as the schema holds it.
  if (check !== undefined)
    answers[apps[0]!] = {
      ...answers[apps[0]!]!,
      check: await checkImages(dir, state, apps[0]!, check),
    }
  return { apps: answers }
}
