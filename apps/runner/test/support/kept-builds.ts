/**
 * What the runner keeps of builds, written by hand for the tests of
 * `builds` and `builder` (specs/016-build-from-source, contracts/core.md
 * CO13, CO14; contracts/runner.md RB17): the state's `builds` and
 * `building`, read back with core's strict rules before they are written,
 * so a test never hands the runner a state it would refuse, and the build
 * records of `kept/<app>/<key>.json`.
 */
import { readRunnerState } from "@workspace/core"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** The state file as a test changes it: the parts these tests touch, the rest carried as read. */
export type State = Record<string, unknown> & {
  lastSequence: Record<string, number>
  formats: Record<string, number>
  builds: Record<string, unknown>
  building: unknown
}

export const AT = "2026-11-27T10:00:00.000Z"

/** 64 hex characters made of one: a build key or a base key. */
export const hex = (c: string) => c.repeat(64)
/** An image's digest made of one hex character. */
export const digest = (c: string) => `sha256:${hex(c)}`
/** An image the state records: its key and its two digests. */
export const image = (key: string, m: string, c: string) => ({
  key,
  manifest: digest(m),
  config: digest(c),
})
/** The tag of a built image, `zekno.invalid/<app>:<key>` (CO2). */
export const tagOf = (app: string, key: string) => `zekno.invalid/${app}:${key}`

export const BUSYBOX = `registry-1.docker.io/library/busybox@sha256:${hex("9")}`

/** A build record as the runner writes it at B3 (CO14). */
export const record = (key: string, bases = [BUSYBOX]) => ({
  key,
  manifest: digest("1"),
  config: digest("2"),
  builder: "dockerfile",
  railpack: null,
  docker: { engine: "29.6.1", buildx: "0.34.1", buildkit: "0.31.1" },
  reader: { kind: "dockerfile", version: "1.19.0" },
  cache: false,
  bases,
  arch: "amd64",
  built: AT,
})

export const stateFile = (home: string) => join(home, "state.json")

/** Changes the state on disk, then reads it back with core's strict rules, so the test never writes a state the runner would refuse. */
export function changeState(home: string, change: (state: State) => void) {
  const state = JSON.parse(readFileSync(stateFile(home), "utf8")) as State
  change(state)
  readRunnerState(state)
  writeFileSync(stateFile(home), JSON.stringify(state), { mode: 0o600 })
}

/** An app at format 2 with `last` as its last number, as a version-2 deploy leaves it. */
export function addApp(state: State, app: string, last: number) {
  state.lastSequence[app] = last
  state.formats[app] = 2
}

/** Writes `kept/<app>/<name>` as the runner does, mode 600. */
export function writeKept(
  home: string,
  app: string,
  name: string,
  content: string
) {
  const folder = join(home, "kept", app)
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  writeFileSync(join(folder, name), content, { mode: 0o600 })
}
