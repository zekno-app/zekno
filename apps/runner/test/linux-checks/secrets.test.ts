/**
 * Checks L12, L13, L14 and L16, in record mode (specs/016-build-from-source,
 * T018; FR-089, FR-037, FR-037b, FR-037c, FR-037g; quickstart.md US12;
 * plan step 1b item 1), run from phase 0 so that their records exist
 * before step 1b is built. They run only in the Linux stand-in `gate.ts`
 * names; without ZEKNO_LINUX_SERVER the file prints its one skip line.
 * Each asks `jobs.ts` whether it runs on this leg (L12 and L13 at the floor
 * and the newest, L14 and L16 at the floor). They assert nothing about
 * Docker: each prints one record line and fails only on its own fault.
 * Every build has RB7's list (`rb7.ts`) and `--secret
 * id=<NAME>,env=ZEKNO_BUILD_SECRET_<i>`; every value is a marker made in
 * the run, and no record, error or Dockerfile holds it (`secret-checks.ts`).
 *
 * L12: a step reads the mounted secret and checks its value by its hash.
 * The record says whether the value is found in the image's files (`docker
 * export`), its history, its metadata (`docker image inspect`, meta.json),
 * and, once Docker's record of the build is removed, anywhere in Docker's
 * root, `/var/lib/containerd` (the build cache) or the check's own folder,
 * which stands in for the runner's (`grep -r -a -l`).
 *
 * L13: a build with a secret and a `# syntax=` line naming a frontend the
 * check's registry serves. The record says whether the registry logged a
 * request for it, and whether the value is in the registry's log, dockerd's
 * log or what the build printed.
 *
 * L14: a secret named `GIT_AUTH_TOKEN`. The record says whether a step
 * could read it, and whether the builder sent it when an `ADD` fetched a
 * git address from a listener in the stand-in (`git-listener.ts`).
 *
 * L16: a step writes the secret into the app's cache folder; a second
 * build, with no secret and no cached step (`--no-cache --pull`), says
 * whether it reads the earlier contents.
 *
 * Every command runs in the stand-in. Each check removes what it made
 * there, by name, also after a failure: its container, images, build
 * records and build cache (by each record's id, `cache-records.ts`), the
 * registry or the listener it started, the fixtures' base when its builds
 * pulled it, and its folder.
 */
import { describe, test } from "bun:test"

import {
  cacheIds,
  pruneNewCache,
} from "../support/linux-server/build-runs/cache-records"
import { gate } from "../support/linux-server/gate"
import {
  LISTENER_PORT,
  listenerFiles,
  listenerWords,
  startListener,
  stopListener,
} from "../support/linux-server/checks/git-listener"
import { firstLine } from "../support/linux-server/host/host-lists"
import { runsHere } from "../support/linux-server/jobs/jobs"
import {
  DOCKERD_LOG,
  foundWords,
  newMarker,
  searchPlaces,
  searchStandIn,
  sha256Hex,
} from "../support/linux-server/build-runs/marker-search"
import { loadPins } from "../support/linux-server/pins"
import {
  hide,
  stepOutput,
} from "../support/linux-server/build-runs/rawjson-logs"
import {
  builtName,
  buildxVersionOf,
  type Built,
  type InStandIn,
  newRunToken,
  outcomeWords,
  rb7Build,
  rb7Command,
  rb7Env,
  type Rb7Options,
  refOf,
  removeImages,
  removeRecords,
} from "../support/linux-server/build-runs/rb7"
import { record } from "../support/linux-server/jobs/record"
import {
  inRegistry,
  REGISTRY_FILES,
  requestWords,
  smallImage,
  startRegistry,
  stopRegistry,
} from "../support/linux-server/build-runs/registry"
import {
  CACHE_ID,
  cacheReadDockerfile,
  cacheReadWords,
  cacheWriteDockerfile,
  gitAddDockerfile,
  readingDockerfile,
  readWords,
  syntaxDockerfile,
} from "../support/linux-server/checks/secret-checks"
import { readInStandIn } from "../support/linux-server/build-runs/stand-in-files"

const open = gate("L12, L13, L14 and L16")
if (!open.ready) console.log(open.skip)

type Id = "L12" | "L13" | "L14" | "L16"

const MINUTE = 60_000
const ROOT = "/tmp/zekno-check-secrets"
const HOME = `${ROOT}/home`
const LISTENER = `${ROOT}/listener`
const FIXTURES = loadPins().images.fixtures.image
const SECRET = "NPM_TOKEN"
const FRONTEND = "check/secret-frontend:1"
const FRONTEND_REPOSITORY = "check/secret-frontend"
const SOURCE = "zekno-check-secrets-source:1"
const EXPORTER = "zekno-check-secrets-export"
const APPS: Readonly<Record<Id, string>> = {
  L12: "check-secret-read",
  L13: "check-secret-syntax",
  L14: "check-secret-git",
  L16: "check-secret-cache",
}

/** What a check made, for the removal. */
type Made = {
  readonly options: Rb7Options[]
  readonly results: Built[]
  cache?: readonly string[]
  basePresent?: boolean
  registry: boolean
  listener: boolean
}

/** One check's run: its stand-in, its token, buildx's version. */
type Run = {
  readonly run: InStandIn
  readonly id: Id
  readonly made: Made
  readonly token: string
  readonly version: string
}

async function must(run: InStandIn, args: readonly string[]): Promise<void> {
  const answer = await run(args)
  if (answer.code !== 0)
    throw new Error(`${args.join(" ")}: ${firstLine(answer)}`)
}

const present = async (run: InStandIn, image: string) =>
  (await run(["docker", "image", "inspect", "--format", "{{.Id}}", image]))
    .code === 0

/** An empty folder, buildx's version, and the cache and base as they were; or why there is no buildx. */
async function begin(
  run: InStandIn,
  id: Id,
  made: Made
): Promise<Run | { none: string }> {
  const token = newRunToken()
  await must(run, ["rm", "-rf", ROOT])
  await must(run, ["mkdir", "-p", HOME])
  const version = await run(
    rb7Command(
      ["docker", "buildx", "version"],
      rb7Env({ home: HOME, run: token })
    )
  )
  if (version.code !== 0)
    return { none: `no buildx (${firstLine(version)}); nothing built` }
  made.cache = await cacheIds(run, HOME)
  made.basePresent = await present(run, FIXTURES)
  return {
    run,
    id,
    made,
    token,
    version: `buildx ${buildxVersionOf(version.stdout) ?? firstLine(version)}`,
  }
}

/** One build of the check with RB7's list; `secrets` maps each name to its value. */
async function build(
  at: Run,
  key: string,
  dockerfile: string,
  secrets: readonly (readonly [string, string])[] = [],
  more: Partial<Rb7Options> = {}
): Promise<Built> {
  const options: Rb7Options = {
    app: APPS[at.id],
    key,
    dockerfile: "Dockerfile",
    network: "default",
    work: `${ROOT}/${key}`,
    ...(secrets.length > 0 ? { secrets: secrets.map(([name]) => name) } : {}),
    ...more,
  }
  at.made.options.push(options)
  const built = await rb7Build(at.run, {
    options,
    home: HOME,
    run: at.token,
    files: [{ path: "Dockerfile", data: dockerfile }],
    ...(secrets.length > 0
      ? { secrets: secrets.map(([, value]) => value) }
      : {}),
  })
  at.made.results.push(built)
  return built
}

/** `found` or `not found` in what a call printed, or why it could not be read. */
async function lookIn(
  run: InStandIn,
  args: readonly string[],
  value: string
): Promise<string> {
  const answer = await run(args, { timeoutMs: 5 * MINUTE })
  if (answer.code !== 0) return `not read (${firstLine(answer)})`
  return `${answer.stdout}${answer.stderr}`.includes(value)
    ? "found"
    : "not found"
}

async function observeL12(at: Run, value: string): Promise<string> {
  const built = await build(
    at,
    "read",
    readingDockerfile(FIXTURES, SECRET, sha256Hex(value), at.token),
    [[SECRET, value]]
  )
  if (!built.built)
    return `${at.version}; ${outcomeWords(built)}; nothing searched`
  const image = builtName(at.made.options.at(-1)!)
  await at.run(["docker", "rm", "--force", EXPORTER])
  await must(at.run, ["docker", "create", "--name", EXPORTER, image])
  const files = await lookIn(at.run, ["docker", "export", EXPORTER], value)
  await must(at.run, ["docker", "rm", "--force", EXPORTER])
  const history = await lookIn(
    at.run,
    [
      "docker",
      "image",
      "history",
      "--no-trunc",
      "--format",
      "{{.CreatedBy}}",
      image,
    ],
    value
  )
  const inspect = await lookIn(
    at.run,
    ["docker", "image", "inspect", image],
    value
  )
  const meta = JSON.stringify(built.metadata ?? {}).includes(value)
    ? "found"
    : "not found"
  const ref = refOf(built.metadata)
  let removal = "no buildx.build.ref in its metadata, so no record removed"
  if (ref !== undefined) {
    const removed = await at.run(
      rb7Command(
        ["docker", "buildx", "history", "rm", "--builder", "default", ref],
        rb7Env({ home: HOME, run: at.token })
      )
    )
    removal =
      removed.code === 0
        ? `once its record ${ref} was removed by docker buildx history rm`
        : `docker buildx history rm ${ref} failed (${firstLine(removed)}), then`
  }
  const places = await searchPlaces(at.run, ROOT)
  const found = await searchStandIn(at.run, value, places)
  return [
    at.version,
    readWords(stepOutput(built.answer.stderr)),
    `the value in the image's files: ${files}`,
    `in its history: ${history}`,
    `in its metadata: docker image inspect ${inspect}, meta.json ${meta}`,
    `${removal}, the value was ${foundWords(found, places)}`,
  ].join("; ")
}

async function observeL13(at: Run, value: string): Promise<string> {
  at.made.registry = true
  const registry = await startRegistry(at.run)
  const image = await smallImage(at.run, SOURCE)
  try {
    await registry.push(image.name, FRONTEND)
  } finally {
    await image.remove()
  }
  const mark = await registry.mark()
  const built = await build(
    at,
    "syntax",
    syntaxDockerfile(inRegistry(FRONTEND), FIXTURES, SECRET, at.token),
    [[SECRET, value]]
  )
  const asked = await registry.requestsSince(mark, FRONTEND_REPOSITORY)
  const places = [
    { path: REGISTRY_FILES.log, name: "the registry's log" },
    { path: DOCKERD_LOG, name: "dockerd's log" },
  ]
  const found = await searchStandIn(at.run, value, places, 120)
  const printed = `${built.answer.stdout}${built.answer.stderr}`.includes(value)
  return [
    at.version,
    `a # syntax= line naming the registry's frontend, in a build with a secret: ${outcomeWords(built)}`,
    requestWords(asked, FRONTEND_REPOSITORY),
    `the value ${foundWords(found, places)}`,
    `in what the build printed: ${printed ? "found" : "not found"}`,
  ].join("; ")
}

async function observeL14(at: Run, value: string): Promise<string> {
  const name = "GIT_AUTH_TOKEN"
  const readable = await build(
    at,
    "read",
    readingDockerfile(FIXTURES, name, sha256Hex(value), at.token),
    [[name, value]]
  )
  const read = readable.built
    ? readWords(stepOutput(readable.answer.stderr))
    : outcomeWords(readable)
  let fetched: string
  at.made.listener = true
  try {
    await startListener(at.run, LISTENER)
  } catch (error) {
    fetched = `no listener (${(error as Error).message}), so no git address fetched`
    return `${at.version}; with a secret named ${name}: ${read}; ${fetched}`
  }
  const url = `http://127.0.0.1:${LISTENER_PORT}/zekno-check-${at.token.slice(0, 8)}.git`
  const git = await build(at, "git", gitAddDockerfile(FIXTURES, url), [
    [name, value],
  ])
  const log = await readInStandIn(at.run, listenerFiles(LISTENER).log)
  fetched = `an ADD of a git address on the stand-in ${outcomeWords(git)}; ${listenerWords(log, value)}`
  return `${at.version}; with a secret named ${name}: ${read}; ${fetched}`
}

async function observeL16(at: Run, value: string): Promise<string> {
  const write = await build(
    at,
    "write",
    cacheWriteDockerfile(FIXTURES, SECRET, at.token),
    [[SECRET, value]]
  )
  if (!write.built)
    return `${at.version}; the build that writes the secret into the cache folder ${outcomeWords(write)}; nothing read`
  const read = await build(
    at,
    "read",
    cacheReadDockerfile(FIXTURES, sha256Hex(value), at.token),
    [],
    { fresh: true }
  )
  return [
    at.version,
    `a step copied the secret into the app's cache folder (${CACHE_ID})`,
    `a later build of the app with no secret and no cached step (--no-cache --pull): ${
      read.built
        ? cacheReadWords(stepOutput(read.answer.stderr))
        : outcomeWords(read)
    }`,
  ].join("; ")
}

/** Removes, by name, what a check made in the stand-in; gives what it could not. */
async function cleanUp(run: InStandIn, id: Id, made: Made): Promise<string[]> {
  const exporter = await run(["docker", "rm", "--force", EXPORTER])
  const left =
    exporter.code === 0 || /no such container/i.test(exporter.stderr)
      ? []
      : [`${EXPORTER} (${firstLine(exporter)})`]
  left.push(
    ...(await removeImages(run, [
      ...made.options.map(builtName),
      ...(made.registry ? [inRegistry(FRONTEND), SOURCE] : []),
    ]))
  )
  if (made.basePresent === false && (await present(run, FIXTURES)))
    left.push(...(await removeImages(run, [FIXTURES])))
  const records = await removeRecords(
    run,
    HOME,
    made.results.map((built) => refOf(built.metadata))
  )
  if (records.length > 0)
    console.log(
      `${id} could not remove its build records ${records.join(", ")}; they go with the stand-in`
    )
  for (const [started, stop] of [
    [made.listener, () => stopListener(run, LISTENER)],
    [made.registry, () => stopRegistry(run)],
  ] as const)
    if (started)
      try {
        await stop()
      } catch (error) {
        left.push((error as Error).message)
      }
  if (made.cache !== undefined)
    try {
      const cache = await pruneNewCache(run, HOME, made.cache)
      if (cache.length > 0)
        console.log(
          `${id} could not remove its build cache ${cache.join(", ")}; it goes with the stand-in`
        )
    } catch (error) {
      left.push(`its build cache (${(error as Error).message})`)
    }
  const folder = await run(["rm", "-rf", ROOT])
  if (folder.code !== 0) left.push(`${ROOT} (${firstLine(folder)})`)
  return left
}

/** Runs a check with a value made for it, removes what it made whatever happened, and never shows the value. */
async function runCheck(
  id: Id,
  observe: (at: Run, value: string) => Promise<string>
): Promise<void> {
  if (!open.ready) return
  const value = newMarker(`zekno-${id.toLowerCase()}`)
  const made: Made = {
    options: [],
    results: [],
    registry: false,
    listener: false,
  }
  let failure: { error: unknown } | undefined
  try {
    const at = await begin(open.inStandIn, id, made)
    record(id, hide("none" in at ? at.none : await observe(at, value), [value]))
  } catch (error) {
    failure = { error }
  }
  const left = await cleanUp(open.inStandIn, id, made)
  if (failure !== undefined) {
    const error =
      failure.error instanceof Error
        ? failure.error
        : new Error(String(failure.error))
    error.message = hide(error.message, [value])
    throw error
  }
  if (left.length > 0)
    throw new Error(
      `${id} left in the stand-in: ${hide(left.join("; "), [value])}`
    )
}

const CHECKS: readonly [
  Id,
  string,
  (at: Run, value: string) => Promise<string>,
][] = [
  [
    "L12",
    "a named secret reaches its step and stays out of the image, its history, its metadata and the build cache",
    observeL12,
  ],
  ["L13", "a frontend named by # syntax= in a build with a secret", observeL13],
  ["L14", "a secret named GIT_AUTH_TOKEN", observeL14],
  [
    "L16",
    "a build with no cached step and a cache folder the app wrote earlier",
    observeL16,
  ],
]

for (const [id, what, observe] of CHECKS)
  describe.skipIf(!open.ready || !runsHere(id))(
    `${id}: ${what} (record mode)`,
    () => {
      test(
        "records what the builder did",
        () => runCheck(id, observe),
        20 * MINUTE
      )
    }
  )
