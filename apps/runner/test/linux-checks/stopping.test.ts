/**
 * Check L5, in record mode (specs/016-build-from-source, T013; FR-039,
 * plan item 27; contracts/runner.md RB15; research map-runner E04 and
 * E04c). It runs only in the Linux stand-in `gate.ts` names; without
 * ZEKNO_LINUX_SERVER it prints its one skip line. It asserts nothing about
 * Docker: it prints one record line, `L5 <engine> <store>: ...`, and fails
 * only on its own fault (a step of its own that could not be done, or
 * something it started or made that it could not stop or remove). In
 * `checks` at the floor on both stores.
 *
 * Inside the stand-in, a small parent process stands for the runner
 * (`parent-process.ts`): it starts `docker buildx build` with RB7's list
 * (`rb7.ts`) on a pack whose step sleeps 90 seconds, prints nothing, then
 * writes a marker into a cache mount; it reads the client's output. Ten
 * seconds after the step started, the parent is killed with SIGKILL, so
 * only the client's reader goes. Recorded: whether the client is alive 5
 * and 60 seconds later, and what holds the run's `ZEKNO_BUILD_RUN`;
 * Docker's record of the build (`docker buildx history ls` and `inspect`,
 * by the ref buildx keeps for it, and the metadata file's when written) as
 * `Running`, `Completed` or `Error`, and when; whether the marker exists
 * afterwards. Once more with the client itself killed. Plan item 27 reads
 * the first: (a) if the silent step outlives its runner, else (c).
 *
 * It kills what it started, by the entries of their environment, and
 * removes, by name, the records by their refs, the images, the build cache
 * it made, the base when it pulled it, and its folder, also after a failure.
 */
import { describe, test } from "bun:test"

import {
  inspectRecord,
  recordState,
  refIds,
  secondsBetween,
  type RecordState,
} from "../support/linux-server/build-runs/build-records"
import {
  progressOf,
  stepRunning,
} from "../support/linux-server/build-runs/build-progress"
import {
  prepare,
  recordCheck,
  type Made,
} from "../support/linux-server/build-runs/check-made"
import { ensureImage } from "../support/linux-server/build-runs/check-images"
import { gate } from "../support/linux-server/gate"
import { firstLine } from "../support/linux-server/host/host-lists"
import {
  killNowArgs,
  launchArgs,
  markerArgs,
  type Moment,
  PARENT_ENTRY,
  PARENT_FILES,
  pidIn,
  putFile,
  scenarioWords,
  stoppingDockerfile,
} from "../support/linux-server/checks/parent-process"
import { loadPins } from "../support/linux-server/pins"
import {
  builtName,
  firstError,
  type InStandIn,
  newRunToken,
  packOf,
  rb7Args,
  rb7Command,
  rb7Env,
  type Rb7Options,
  refOf,
} from "../support/linux-server/build-runs/rb7"
import {
  alive,
  procAt,
  stopTagged,
  tagged,
} from "../support/linux-server/build-runs/stand-in-processes"

const CHECK = "L5"
const open = gate(CHECK)
if (!open.ready) console.log(open.skip)

const MINUTE = 60_000
const ROOT = "/tmp/zekno-check-stopping"
const FIXTURES = loadPins().images.fixtures.image
/** How long the step may take to start, the base being there already. */
const START_MS = 3 * MINUTE
/** How long after the kill the record is watched for its end: the step ends 80 seconds after it. */
const END_MS = 150_000

async function must(run: InStandIn, args: readonly string[]): Promise<string> {
  const answer = await run(args)
  if (answer.code !== 0)
    throw new Error(`${args.slice(0, 3).join(" ")}: ${firstLine(answer)}`)
  return answer.stdout
}

const read = async (run: InStandIn, path: string) =>
  (await run(["cat", path])).stdout

/** Waits until `ready` gives a value, looking each second up to `ms`. */
async function until<T>(ms: number, ready: () => Promise<T | undefined>) {
  const end = performance.now() + ms
  for (;;) {
    const value = await ready()
    if (value !== undefined || performance.now() > end) return value
    await Bun.sleep(1000)
  }
}

/** One kill: of the parent (`the reader`), or of the client itself. */
async function scenario(
  run: InStandIn,
  made: Made,
  base: string,
  who: "parent" | "client"
): Promise<string> {
  const killed = who === "parent" ? "the reader" : "the client itself"
  const dir = `${ROOT}/${who}`
  const home = `${dir}/home`
  const work = `${dir}/work`
  const token = newRunToken()
  const marker = `zekno-check-stopping-${token.slice(0, 12)}-${who}`
  const entry = `ZEKNO_BUILD_RUN=${token}`
  const tags = [entry, `${PARENT_ENTRY}=${marker}`]
  made.homes.set(home, [])
  made.tags.push(...tags)
  // What is left of this run is stopped before the next starts, whatever it saw.
  const ending = async (words: string) => {
    await stopTagged(run, tags)
    return words
  }
  await must(run, ["mkdir", "-p", home, work])
  await putFile(
    run,
    `${dir}/${PARENT_FILES.pack}`,
    packOf([{ path: "Dockerfile", data: stoppingDockerfile(base, marker) }])
  )
  const options: Rb7Options = {
    app: "check-stopping",
    key: who,
    dockerfile: "Dockerfile",
    network: "default",
    work,
  }
  made.images.push(builtName(options))
  const env = rb7Env({ home, run: token })
  await must(
    run,
    launchArgs(marker, dir, rb7Command(rb7Args(options), env, { work }))
  )

  const pids = await until(30_000, async () => {
    const parent = pidIn(await read(run, `${dir}/${PARENT_FILES.parent}`))
    const client = pidIn(await read(run, `${dir}/${PARENT_FILES.client}`))
    return parent && client ? { parent, client } : undefined
  })
  if (pids === undefined)
    return ending(`${killed}: the parent did not start the client within 30 s`)
  const seen = () => read(run, `${dir}/${PARENT_FILES.seen}`)
  const running = await until(START_MS, async () => {
    const text = await seen()
    if (stepRunning(progressOf(text), marker)) return true
    if (!alive(await procAt(run, pids.client))) return false
    return undefined
  })
  if (running !== true)
    return ending(
      `${killed}: the silent step did not run (${
        running === false
          ? "the client ended first"
          : "not started within 3 minutes"
      }: ${firstError({ code: 1, stdout: "", stderr: await seen() })})`
    )

  await Bun.sleep(10_000)
  const target = who === "parent" ? pids.parent : pids.client
  if (!alive(await procAt(run, target)))
    return ending(
      `${killed}: it had ended before the kill, 10 s after the step started`
    )
  const linesRead = (await seen())
    .split("\n")
    .filter((line) => line !== "").length
  const killedAt = (await must(run, killNowArgs(target))).trim()
  const kill = performance.now()
  const ref = await until(10_000, async () => (await refIds(run, home))[0])
  made.homes.get(home)?.push(ref)
  const stateNow = async (): Promise<RecordState | undefined> =>
    ref === undefined ? undefined : recordState(run, home, ref)

  const moments: Moment[] = []
  for (const after of [5, 60]) {
    await Bun.sleep(Math.max(0, kill + after * 1000 - performance.now()))
    moments.push({
      after,
      client: await procAt(run, pids.client),
      carrying: await tagged(run, [entry]),
      record: await stateNow(),
    })
  }
  let state = moments.at(-1)?.record
  while (state?.status === "Running" && performance.now() - kill < END_MS) {
    await Bun.sleep(5000)
    state = await stateNow()
  }
  const ended =
    state !== undefined && state.status !== "Running"
      ? {
          status: state.status,
          seconds: secondsBetween(killedAt, state.completedAt),
        }
      : undefined
  const runningAfter = Math.round((performance.now() - kill) / 1000)
  const marked = (await run(markerArgs(marker))).stdout.trim() !== ""
  const last = await procAt(run, pids.client)
  const meta = await run(["cat", `${work}/meta.json`])
  let metadata = "no metadata file"
  if (meta.code === 0) {
    let named: string | undefined
    try {
      named = refOf(JSON.parse(meta.stdout) as Record<string, unknown>)
    } catch {
      named = undefined
    }
    metadata =
      named === undefined
        ? "a metadata file naming no ref"
        : named === ref
          ? "the metadata file names the same ref"
          : `the metadata file names another ref, ${named}`
    made.homes.get(home)?.push(named)
  }
  const inspect =
    ref === undefined ? "no ref was kept" : await inspectRecord(run, home, ref)

  await stopTagged(run, tags)
  // Its record is let end, so it can be removed by its ref.
  if (ref !== undefined)
    await until(30_000, async () =>
      (await stateNow())?.status === "Running" ? undefined : true
    )
  return scenarioWords({
    killed,
    linesRead,
    moments,
    ...(ended === undefined ? { runningAfter } : { ended }),
    marker: marked,
    last,
    metadata,
    inspect,
  })
}

async function observe(run: InStandIn, made: Made): Promise<string> {
  const prepared = await prepare(run, made, ROOT)
  if ("none" in prepared) return prepared.none
  const base = await ensureImage(run, FIXTURES)
  made.bases.push(base)
  return [
    prepared.buildx,
    await scenario(run, made, base.image, "parent"),
    await scenario(run, made, base.image, "client"),
  ].join(" | ")
}

describe.skipIf(!open.ready)(
  "L5: whether the builder stops when the program that started it goes (record mode)",
  () => {
    test(
      "records the client, the build's record and the marker after its reader, then the client itself, is killed",
      async () => {
        if (open.ready) await recordCheck(CHECK, open.inStandIn, observe)
      },
      25 * MINUTE
    )
  }
)
