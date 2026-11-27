/**
 * Checks L6 and L7, in record mode (specs/016-build-from-source, T014;
 * FR-040, FR-043a, FR-089b; research/map-checks.md, T6). They run only in
 * the Linux stand-in `gate.ts` names; without ZEKNO_LINUX_SERVER the file
 * prints its one skip line. Each asserts nothing about Docker: it prints
 * one record line, `<id> <engine> <store>: ...`, and fails only on its own
 * fault (a step of its own that could not be done, or something it made
 * that it could not remove). `jobs.ts` says which runs on the leg
 * run-checks.ts started: L6 in `memory`, L7 in `checks` at the floor on both
 * stores.
 *
 * L6, the stand-in held to 1 GB: an app container writes a line to a file
 * each second; then a build, RB7's list (`rb7.ts`), whose step asks for
 * 1.6 GB. Recorded: the builder's last lines and exit status, whether the
 * app still runs and its file kept growing, the kills in the stand-in's
 * `memory.events`, whether dockerd answers, and Docker's `OOMKilled` of the
 * stand-in itself, read on the machine through `gate.ts` (the one read of
 * the machine's engine a check makes, `host-calls.ts` allows it for the
 * run's server only). The record says it is a stand-in; nothing is claimed
 * about a real 1 GB server. A stand-in that is not held to 1 GB builds
 * nothing and says so.
 *
 * L7: a build of a 512 MiB context of random bytes made in the stand-in
 * (`COPY . /data`), the tar piped to RB7's list; each second during it,
 * `df` of Docker's root, of `/var/lib/containerd` when it exists, and of the
 * work folder's parent. Recorded: each one's peak over its start against
 * the floor of FR-040 (`LIMITS.diskFloorBytes`, 2 GiB, CO16).
 *
 * Every command runs in the stand-in. Each check removes what it made
 * there, by name, also after a failure (`check-made.ts`): the app, its
 * images, its build records, the build cache made since it began, the base
 * when it pulled it, what it started, and its folder.
 */
import { describe, test } from "bun:test"

import {
  lastLines,
  progressOfAnswer,
} from "../support/linux-server/build-runs/build-progress"
import {
  prepare,
  recordCheck,
  type Made,
} from "../support/linux-server/build-runs/check-made"
import { ensureImage } from "../support/linux-server/build-runs/check-images"
import {
  contextArgs,
  DISK_DOCKERFILE,
  DISK_FLOOR_BYTES,
  bytesWords,
  diskArgs,
  endOf,
  peaksOf,
  peakWords,
  type Place,
} from "../support/linux-server/checks/disk-use"
import { gate } from "../support/linux-server/gate"
import type { Answer } from "../support/linux-server/host/host-docker"
import { firstLine } from "../support/linux-server/host/host-lists"
import { runsHere } from "../support/linux-server/jobs/jobs"
import {
  APP,
  APP_STATE_ARGS,
  appArgs,
  appStateWords,
  countIn,
  eventsWords,
  growthWords,
  heldToOneGb,
  hogDockerfile,
  linesArgs,
  MEMORY_EVENTS,
  MEMORY_MAX,
  memoryEventsOf,
  memoryMaxOf,
  oomKilledWords,
} from "../support/linux-server/checks/memory-use"
import { loadPins } from "../support/linux-server/pins"
import {
  builtName,
  firstError,
  type InStandIn,
  newRunToken,
  outcomeWords,
  rb7Args,
  rb7Build,
  rb7Command,
  rb7Env,
  type Rb7Options,
  refOf,
} from "../support/linux-server/build-runs/rb7"

const open = gate("L6 and L7")
if (!open.ready) console.log(open.skip)

const MINUTE = 60_000
const FIXTURES = loadPins().images.fixtures.image

async function must(
  run: InStandIn,
  args: readonly string[],
  timeoutMs?: number
): Promise<string> {
  const answer = await run(args, timeoutMs === undefined ? {} : { timeoutMs })
  if (answer.code !== 0)
    throw new Error(`${args.slice(0, 3).join(" ")}: ${firstLine(answer)}`)
  return answer.stdout
}

/** L6: a build that asks for 1.6 GB beside a running app, in the stand-in held to 1 GB. */
async function memory(
  run: InStandIn,
  made: Made,
  oomKilled: () => Promise<Answer>
): Promise<string> {
  const root = "/tmp/zekno-check-memory"
  const stand = "in the stand-in held to 1 GB, not a real 1 GB server"
  const max = memoryMaxOf((await run(["cat", MEMORY_MAX])).stdout)
  if (!heldToOneGb(max))
    return `the stand-in is not held to 1 GB (memory.max ${max ?? "unread"}); nothing built`
  const started = await prepare(run, made, root)
  if ("none" in started) return `${stand}: ${started.none}`
  const { home, buildx } = started
  const base = await ensureImage(run, FIXTURES)
  made.bases.push(base)

  const folder = `${root}/app`
  await must(run, ["mkdir", "-p", folder])
  made.containers.push(APP)
  await run(["docker", "rm", "--force", APP])
  await must(run, appArgs(base.image, folder))
  const lines = async () => countIn((await run(linesArgs(folder))).stdout)
  for (let wait = 0; wait < 30 && ((await lines()) ?? 0) < 3; wait++)
    await Bun.sleep(1000)

  const events = async () => {
    const answer = await run(["cat", MEMORY_EVENTS])
    return answer.code === 0 ? memoryEventsOf(answer.stdout) : undefined
  }
  const before = await events()
  const counts = [await lines()]
  const options: Rb7Options = {
    app: "check-memory",
    key: "k1",
    dockerfile: "Dockerfile",
    network: "default",
    work: `${root}/work`,
  }
  made.images.push(builtName(options))
  const start = performance.now()
  const built = await rb7Build(run, {
    options,
    home,
    files: [
      {
        path: "Dockerfile",
        data: hogDockerfile(base.image, newRunToken().slice(0, 12)),
      },
    ],
    timeoutMs: 5 * MINUTE,
  })
  const seconds = Math.round((performance.now() - start) / 1000)
  made.homes.get(home)?.push(refOf(built.metadata))
  counts.push(await lines())
  await Bun.sleep(3000)
  counts.push(await lines())
  const after = await events()
  const state = await run([...APP_STATE_ARGS])
  const dockerd = await run(
    ["docker", "version", "--format", "{{.Server.Version}}"],
    { timeoutMs: 30_000 }
  )
  const last = lastLines(progressOfAnswer(built.answer))
  const killed = await oomKilled()
  return [
    `${stand} (memory.max ${max})`,
    buildx,
    `a step asking for 1.6 GB: exit ${built.answer.code} after ${seconds} s, ${outcomeWords(built)}`,
    `buildx printed last: ${last.plain.join(" / ") || "nothing"}`,
    `the step printed last: ${last.steps.join(" / ") || "nothing"}`,
    `the app: ${appStateWords(state.stdout, state.code)}, its file ${growthWords(counts)}`,
    `the stand-in's memory.events: ${eventsWords(before, after)}`,
    dockerd.code === 0
      ? `dockerd answered (${dockerd.stdout.trim()})`
      : `dockerd did not answer: ${firstLine(dockerd)}`,
    oomKilledWords(killed),
  ].join("; ")
}

/** L7: the disk a build of a 512 MiB context uses, each second. */
async function disk(run: InStandIn, made: Made): Promise<string> {
  const root = "/tmp/zekno-check-disk"
  const started = await prepare(run, made, root)
  if ("none" in started) return started.none
  const { home, buildx } = started
  const dockerRoot = (
    await must(run, ["docker", "info", "--format", "{{.DockerRootDir}}"])
  ).trim()
  if (!dockerRoot.startsWith("/"))
    throw new Error(
      `docker info gave ${JSON.stringify(dockerRoot)} as Docker's root`
    )
  const places: Place[] = [
    { label: "Docker's root", path: dockerRoot },
    { label: "containerd's root", path: "/var/lib/containerd" },
    { label: "the work folder's parent", path: root },
  ]
  const context = `${root}/context`
  await must(run, contextArgs(context), 5 * MINUTE)

  const token = newRunToken()
  const entry = `ZEKNO_CHECK_DISK=${token.slice(0, 12)}`
  made.tags.push(`ZEKNO_BUILD_RUN=${token}`, entry)
  const options: Rb7Options = {
    app: "check-disk",
    key: "k1",
    dockerfile: "Dockerfile",
    network: "default",
    work: `${root}/work`,
  }
  made.images.push(builtName(options))
  await must(run, ["mkdir", "-p", options.work])
  const client = rb7Command(rb7Args(options), rb7Env({ home, run: token }), {
    work: options.work,
    timeoutSeconds: 15 * 60,
  })
  const answer = await run(
    diskArgs({
      entry,
      samples: `${root}/samples`,
      out: `${root}/out`,
      context,
      places,
      client,
    }),
    { timeoutMs: 20 * MINUTE }
  )
  const end = endOf(answer.stdout)
  if (answer.code !== 0 || end === undefined)
    throw new Error(
      `the build's script failed (exit ${answer.code}): ${firstLine(answer)}`
    )
  const out = await run(["cat", `${root}/out`])
  const meta = await run(["cat", `${options.work}/meta.json`])
  if (meta.code === 0)
    try {
      made.homes
        .get(home)
        ?.push(refOf(JSON.parse(meta.stdout) as Record<string, unknown>))
    } catch {
      // No record id to remove by; removeRecords still finds it by the home's refs.
    }
  const outcome =
    end.code === 0
      ? "built"
      : `not built (exit ${end.code}): ${firstError({ code: end.code, stdout: out.stdout, stderr: "" })}`
  const samples = (await run(["cat", `${root}/samples`])).stdout
  return [
    buildx,
    `a 512 MiB context of random bytes, ${DISK_DOCKERFILE.trim().replace("\n", ", ")}: ${outcome} in ${end.seconds} s`,
    ...peaksOf(samples, places).map((peak) => peakWords(peak)),
    `the floor ${bytesWords(DISK_FLOOR_BYTES)} (LIMITS.diskFloorBytes, CO16)`,
  ].join("; ")
}

describe.skipIf(!open.ready)(
  "L6 and L7: a build out of memory beside an app, and the disk a 512 MiB build uses (record mode)",
  () => {
    test.skipIf(!runsHere("L6"))(
      "L6 records the builder, the app, the kills and dockerd after a step asks for 1.6 GB",
      async () => {
        if (open.ready)
          await recordCheck("L6", open.inStandIn, (run, made) =>
            memory(run, made, open.oomKilled)
          )
      },
      10 * MINUTE
    )

    test.skipIf(!runsHere("L7"))(
      "L7 records each place's peak disk use during a 512 MiB build against the floor",
      async () => {
        if (open.ready) await recordCheck("L7", open.inStandIn, disk)
      },
      25 * MINUTE
    )
  }
)
