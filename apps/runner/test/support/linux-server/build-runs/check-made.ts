/**
 * What a Linux check made in the stand-in, and its removal by exact name
 * after the record, whether the check got that far or not
 * (specs/016-build-from-source, T012 to T014). A check notes each thing as
 * it makes it, so a failure half way leaves nothing it does not remove.
 *
 *   await recordCheck("L3", open.inStandIn, async (run, made) => {
 *     made.folders.push(ROOT)
 *     made.images.push(builtName(options))
 *     return "what was seen"
 *   })
 *
 * The order: processes holding the check's entries, containers, images,
 * build records, the build cache made since the check began, the base when
 * the check pulled it, and the folders. Processes, containers, images, the
 * base and folders that stay fail the check; build records and cache
 * records that stay are said in one line each, as L2 says its records: they
 * go with the stand-in.
 *
 * `prepare` is what a check of builds does first: its folder made empty
 * with a home in it, buildx's version (or why there is none: an engine
 * without buildx builds nothing and says so), and the build cache as it
 * was, so the removal takes only what the check's builds made.
 */
import { cacheRecords, removeCacheMade } from "./build-cache"
import { dropPulled, type Present } from "./check-images"
import { buildxVersionOf } from "./builder-output"
import { firstLine } from "../host/host-lists"
import { record } from "../jobs/record"
import { removeImages, removeRecords, type InStandIn } from "./rb7"
import { checkFolder, newRunToken, rb7Command, rb7Env } from "./rb7-args"
import { procWords, stopTagged } from "./stand-in-processes"

export type Made = {
  /** Environment entries of the processes it started. */
  readonly tags: string[]
  /** Containers of the stand-in's Docker, by name. */
  readonly containers: string[]
  readonly images: string[]
  /** Each home whose `BUILDX_CONFIG` kept its builds' records, with the record ids known. */
  readonly homes: Map<string, (string | undefined)[]>
  /** The cache records there before the check's first build, and the home to list them with. */
  cache?: { readonly home: string; readonly before: readonly string[] }
  readonly bases: Present[]
  /** Folders of the stand-in under `/tmp/zekno-check-*`. */
  readonly folders: string[]
}

export function newMade(): Made {
  return {
    tags: [],
    containers: [],
    images: [],
    homes: new Map(),
    bases: [],
    folders: [],
  }
}

export type Prepared =
  { readonly home: string; readonly buildx: string } | { readonly none: string }

/**
 * Empties `root`, makes `<root>/home`, and notes both; gives buildx's
 * version and lists the build cache, or says there is no buildx.
 */
export async function prepare(
  run: InStandIn,
  made: Made,
  root: string
): Promise<Prepared> {
  const home = `${checkFolder(root)}/home`
  made.folders.push(root)
  made.homes.set(home, made.homes.get(home) ?? [])
  for (const args of [
    ["rm", "-rf", root],
    ["mkdir", "-p", home],
  ]) {
    const answer = await run(args)
    if (answer.code !== 0)
      throw new Error(`${args.join(" ")} failed: ${firstLine(answer)}`)
  }
  const env = rb7Env({ home, run: newRunToken() })
  const version = await run(rb7Command(["docker", "buildx", "version"], env))
  if (version.code !== 0)
    return { none: `no buildx (${firstLine(version)}); nothing built` }
  made.cache = {
    home,
    before: (await cacheRecords(run, home)).map((item) => item.id),
  }
  return {
    home,
    buildx: `buildx ${buildxVersionOf(version.stdout) ?? firstLine(version)}`,
  }
}

/** A container's name in the stand-in's Docker that a check gives. */
const CONTAINER = /^zekno-check-[a-z0-9-]+$/

export type CleanUpOptions = {
  /** Where the records that stayed are said; the console when absent. */
  readonly say?: (line: string) => void
  /** How the stop of processes waits between its rounds; `Bun.sleep` when absent. */
  readonly wait?: (ms: number) => Promise<unknown>
}

/**
 * Removes what `made` names. Gives what stayed that fails the check; says
 * through `say` the records that stayed.
 */
export async function cleanUp(
  run: InStandIn,
  made: Made,
  id: string,
  options: CleanUpOptions = {}
): Promise<string[]> {
  const say = options.say ?? ((line: string) => console.log(line))
  const left: string[] = []
  // Each part runs whatever an earlier one threw.
  const part = async (what: string, remove: () => Promise<void>) => {
    try {
      await remove()
    } catch (error) {
      left.push(`${what}: ${(error as Error).message}`)
    }
  }
  if (made.tags.length > 0)
    await part("its processes", async () => {
      for (const proc of await stopTagged(run, made.tags, options.wait))
        left.push(`process ${proc.pid} (${procWords(proc)})`)
    })
  for (const name of new Set(made.containers))
    await part(name, async () => {
      if (!CONTAINER.test(name))
        throw new Error("not a check's container, left alone")
      const answer = await run(["docker", "rm", "--force", name])
      if (answer.code !== 0 && !/no such container/i.test(answer.stderr))
        left.push(`${name} (${firstLine(answer)})`)
    })
  await part("its images", async () => {
    left.push(...(await removeImages(run, made.images)))
  })
  for (const [home, known] of made.homes)
    await part(`the records of ${home}`, async () => {
      const records = await removeRecords(run, home, known)
      if (records.length > 0)
        say(
          `${id} could not remove its build records ${records.join(", ")}; they go with the stand-in`
        )
    })
  const cache = made.cache
  if (cache !== undefined)
    await part("its build cache", async () => {
      const stayed = await removeCacheMade(run, cache.home, cache.before)
      if (stayed.length > 0)
        say(
          `${id} could not remove its build cache ${stayed.join(", ")}; it goes with the stand-in`
        )
    })
  for (const base of made.bases)
    await part(base.image, async () => {
      left.push(...(await dropPulled(run, base)))
    })
  for (const folder of new Set(made.folders))
    await part(folder, async () => {
      const answer = await run(["rm", "-rf", checkFolder(folder)])
      if (answer.code !== 0) left.push(`${folder} (${firstLine(answer)})`)
    })
  return left
}

export type RecordDeps = {
  readonly write: (id: string, seen: string) => void
  readonly say: (line: string) => void
}

const hostRecord: RecordDeps = {
  write: (id, seen) => {
    record(id, seen)
  },
  say: (line) => console.log(line),
}

/**
 * Runs `observe`, records what it gives, removes what it made, then fails
 * with `observe`'s own error, or with what stayed.
 */
export async function recordCheck(
  id: string,
  run: InStandIn,
  observe: (run: InStandIn, made: Made) => Promise<string>,
  deps: RecordDeps = hostRecord
): Promise<void> {
  const made = newMade()
  let failure: { error: unknown } | undefined
  try {
    deps.write(id, await observe(run, made))
  } catch (error) {
    failure = { error }
  }
  const left = await cleanUp(run, made, id, { say: deps.say })
  if (failure !== undefined) throw failure.error
  if (left.length > 0)
    throw new Error(`${id} left in the stand-in: ${left.join("; ")}`)
}
