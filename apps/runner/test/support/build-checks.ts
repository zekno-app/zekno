/**
 * What the scenarios of the steps before the number share (specs/016-build-
 * from-source, T072; contracts/runner.md RB3): a runner that accepted one
 * deploy of `web`, a deploy of `web` with one Dockerfile build sealed for
 * it, its pieces staged as `pack` stages them, and a wrapper around the
 * stand-in for Docker (`watched`) that copies `state.json` as each call
 * finds it and can hold one call until the test lets it go, so a test reads
 * the state K17 wrote at the first Docker call after the number, whatever
 * that call is.
 */
import { expect } from "bun:test"
import {
  LIMITS,
  parseMessage,
  proposeRoster,
  RunnerReportSchema,
  type Envelope,
  type ServerPublicKey,
} from "@workspace/core"
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { stagedDeployOf } from "../../src/pack/open"
import { stagePiece } from "../../src/pack/stage"
import { buildDeployV2, deployV2, payloadOf, recordFiles } from "./deploy-v2"
import { deployed, filesUnder, session, tempDir } from "./helpers"
import {
  dockerfileBuild,
  packOf,
  project,
  sealAll,
  type Piece,
} from "./code-packs"

export type World = Awaited<ReturnType<typeof deployed>>

export const APP = "web"
export const FLOOR = LIMITS.diskFloorBytes

/** What the runner may ask Docker before the number: it only reads (K14a, K14b, K14c). */
export const READS = [
  "image inspect --format {{.Id}} zekno.invalid/",
  "version --format json",
  "buildx version",
  "context show",
  "buildx inspect --builder ",
  "buildx build --help",
  "buildx prune --help",
  "info --format {{.DockerRootDir}}",
]
/** K14b and K14c's calls for a build not kept, in order, with the stand-in's builder `default`. */
export const FACTS_AND_DISK = [
  "version --format json",
  "buildx version",
  "context show",
  "buildx inspect --builder default",
  "buildx build --help",
  "buildx prune --help",
  "info --format {{.DockerRootDir}}",
]

export const stateFile = (home: string) => join(home, "state.json")
export const stateOf = (home: string) =>
  JSON.parse(readFileSync(stateFile(home), "utf8")) as Record<string, unknown>
export const buildingFolder = (w: World) => join(w.home, "building", APP)
export const serverKey = (w: World) =>
  w.setup.json!.serverPublicKey as ServerPublicKey

/**
 * The stand-in for Docker of `w`, behind a script that first copies the
 * runner's `state.json` as each call finds it, and holds a call whose first
 * word is `hold`'s until `go`. Its path is what the runner is given.
 */
export function watched(w: World) {
  const dir = tempDir("watch")
  const path = join(dir, "docker")
  writeFileSync(
    path,
    `#!/bin/sh
d="${dir}"
printf '%s\\n' "$*" >> "$d/args"
{ cat "${stateFile(w.home)}"; echo; } >> "$d/states"
if [ -f "$d/hold" ] && [ "$1" = "$(cat "$d/hold")" ]; then
  rm -f "$d/hold"
  touch "$d/held"
  while [ ! -f "$d/go" ]; do sleep 0.05; done
fi
exec "${w.docker.path}" "$@"
`
  )
  chmodSync(path, 0o755)
  const lines = (name: string) =>
    existsSync(join(dir, name))
      ? readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean)
      : []
  return {
    path,
    /** Each call, with the state as it found it. */
    seen: () => {
      const states = lines("states")
      return lines("args").map((args, index) => ({
        args,
        state: JSON.parse(states[index]!) as Record<string, unknown>,
      }))
    },
    hold: (verb: string) => writeFileSync(join(dir, "hold"), verb),
    held: () => existsSync(join(dir, "held")),
    go: () => writeFileSync(join(dir, "go"), ""),
  }
}

/**
 * A runner that accepted one deploy of `web` without a build, Docker
 * scripted to keep its data in a folder that exists, a folder for work
 * folders of its own, and a newer team list the next requests carry (K3).
 */
export async function ready() {
  const w = await deployed([APP])
  w.docker.script({ docker: { dockerRootDir: tempDir("docker-root") } })
  const newer = await proposeRoster({ trust: w.trust, signer: w.signer })
  return {
    ...w,
    watch: watched(w),
    unpacked: tempDir("unpacked"),
    newer: { trust: newer.trust, rosters: [...w.rosters, newer.envelope] },
  }
}
export type Ready = Awaited<ReturnType<typeof ready>>

/** Sends one `deploy` through the watched stand-in, with the folder for work folders set. */
export const send = (w: Ready, input: unknown) =>
  deployV2({ home: w.home, docker: w.watch }, input, {
    env: { ZEKNO_RUNNER_UNPACKED: w.unpacked },
  })

/** The events and the result of the request a session is answering, read from its frames. */
export async function answerOf(s: ReturnType<typeof session>) {
  const events: Record<string, unknown>[] = []
  for (;;) {
    const frame = await s.next()
    if (frame === undefined) throw new Error("the session ended first")
    if ("result" in frame)
      return { events, result: frame.result as Record<string, unknown> }
    events.push(frame)
  }
}

/**
 * A deploy of `web` made against `previous` (1 when not said), signed by
 * the admin against the newer team list, with one Dockerfile build of a
 * small project sealed for this server; `change` goes to `buildDeployV2`.
 */
export async function withBuild(
  w: Ready,
  change: Partial<Parameters<typeof buildDeployV2>[0]> = {}
) {
  const pack = packOf(project())
  const pieces = sealAll(pack.tar, serverKey(w))
  const previous = change.previous ?? 1
  const { envelope, records } = await buildDeployV2({
    trust: w.newer.trust,
    serverId: w.serverId,
    signer: w.signer,
    previous,
    builds: [
      dockerfileBuild({ hash: pack.hash, size: pack.tar.length }, pieces),
    ],
    ...change,
  })
  const key = (payloadOf(envelope).builds as { key: string }[])[0]!.key
  return {
    input: { rosters: w.newer.rosters, envelope, records },
    envelope,
    pieces,
    key,
    previous,
  }
}

/** Stages `pieces` for the deploy `envelope` made against `previous`, as `pack` would. */
export function stage(
  w: Ready,
  envelope: Envelope,
  previous: number,
  pieces: readonly Piece[]
) {
  const deploy = stagedDeployOf(envelope, previous)
  for (const piece of pieces)
    stagePiece(w.home, APP, deploy, piece.fingerprint, piece.sealed)
}

/**
 * Sends `input` and checks it is refused with `expected` exactly, a report
 * a zekno reads, before any event; that the state is as it was but its
 * team lists (now `w.newer`'s); that the Compose files and the records are
 * as they were; that Docker was only read, never under the state lock; and
 * that no piece is left in `building/web/`. Gives the Docker calls it made.
 */
export async function refusedWith(
  w: Ready,
  input: unknown,
  expected: Record<string, unknown>
): Promise<string[]> {
  const before = stateOf(w.home)
  const apps = filesUnder(join(w.home, "apps"))
  const records = recordFiles(w.home)
  const calls = w.docker.calls().length
  const { events, result } = await send(w, input)
  expect(result).toEqual(expected)
  expect(events).toEqual([])
  expect(parseMessage(RunnerReportSchema, result).ok).toBe(true)
  expect(stateOf(w.home)).toEqual({ ...before, team: w.newer.trust })
  expect(filesUnder(join(w.home, "apps"))).toEqual(apps)
  expect(recordFiles(w.home)).toEqual(records)
  const made = w.docker.calls().slice(calls)
  for (const call of made) {
    expect(READS.some((read) => call.args.startsWith(read))).toBe(true)
    expect(call.stateLock).toBe(false)
  }
  expect(existsSync(buildingFolder(w))).toBe(false)
  return made.map((call) => call.args)
}

/** The first call the watched stand-in saw once `web`'s number was `sequence`, and the state it found. */
export function firstAfterNumber(w: Ready, sequence: number) {
  return w.watch
    .seen()
    .find(
      (call) =>
        (call.state.lastSequence as Record<string, number>)[APP] === sequence
    )
}

/** Records `key` as a kept image of `web`'s deploy 1 in the state, as B3 would, and gives the image's digests. */
export function recordKept(
  w: Ready,
  key: string,
  image: { manifest: string; config: string }
) {
  const state = stateOf(w.home)
  state.builds = {
    [APP]: {
      running: 1,
      images: [{ key, manifest: image.manifest, config: image.config }],
      deploys: [{ sequence: 1, keys: [key] }],
      drop: [],
      fresh: [],
      last: null,
    },
  }
  writeFileSync(stateFile(w.home), JSON.stringify(state), { mode: 0o600 })
}
