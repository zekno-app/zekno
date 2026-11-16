/**
 * What the installer's script prints, and how it is read: one short line per
 * step, each matched against a fixed pattern and taken only in the script's
 * own order, read one line at a time (the rules: install.ts). The check script
 * of `zekno doctor` (../check-script.ts) is read with the same `scriptLines`.
 */
import { RUNNER_VERSION_PATTERN } from "@workspace/core"

import type { RunnerArch } from "../../version/runner-release"
import type { InstallRequest, RunnerPlace } from "./checks"

export type InstallFailure =
  | "usage"
  | "name"
  | "newer"
  | "docker"
  | "home"
  | "missing"
  | "platform"
  | "release"
  | "download"
  | "tools"
  | "space"
  | "libc"
  | "cpu"
  | "checksum"
  | "install"
  | "version"
  | "folder"

/** One line of the script, read. */
export type InstallEvent =
  | { kind: "connected" }
  /** Docker with Compose was found. `version` is Compose's, when it fits a version's shape. */
  | { kind: "docker"; version?: string }
  /** A runner is already there. `version` is undefined for a runner that does not report its version. */
  | { kind: "runner"; place: RunnerPlace; version?: string }
  | { kind: "no-runner" }
  | { kind: "platform"; arch: RunnerArch }
  /** The script is ready for the runner file (`--runner-file` only). */
  | { kind: "ready" }
  /** The file is on the server, this many bytes, not yet checked. */
  | { kind: "download"; bytes: number }
  | { kind: "checksum" }
  | { kind: "install" }
  | { kind: "version" }
  | { kind: "folder" }
  | { kind: "done"; place: RunnerPlace }
  | { kind: "fail"; reason: InstallFailure }

const FAILURES: readonly string[] = [
  "usage",
  "name",
  "newer",
  "docker",
  "home",
  "missing",
  "platform",
  "release",
  "download",
  "tools",
  "space",
  "libc",
  "cpu",
  "checksum",
  "install",
  "version",
  "folder",
]

/** The script's lines are short. Anything longer is not one of them. */
export const INSTALL_LINE_LIMIT = 256

/** `runner found <place> <version|unknown>`, the version held to the same grammar as everywhere else. */
const RUNNER_FOUND = new RegExp(
  `^runner found (system|user|path|target) (${RUNNER_VERSION_PATTERN.source.replace(/^\^/, "").replace(/\$$/, "")}|unknown)$`
)

/** Reads one line the script printed, or undefined when it is not one of its lines. */
export function parseInstallLine(line: string): InstallEvent | undefined {
  if (line.length > INSTALL_LINE_LIMIT) return undefined
  const fixed: Record<string, InstallEvent> = {
    connected: { kind: "connected" },
    "runner none": { kind: "no-runner" },
    ready: { kind: "ready" },
    "checksum ok": { kind: "checksum" },
    "install ok": { kind: "install" },
    "version ok": { kind: "version" },
    "folder ok": { kind: "folder" },
  }
  if (Object.hasOwn(fixed, line)) return fixed[line]
  let match = /^docker ok ([0-9A-Za-z.+-]{1,32})$/.exec(line)
  if (match) {
    const shape = /^v?([0-9]+(\.[0-9]+){1,3})$/.exec(match[1]!)
    return shape ? { kind: "docker", version: shape[1] } : { kind: "docker" }
  }
  match = RUNNER_FOUND.exec(line)
  if (match) {
    const version = match[2] === "unknown" ? undefined : match[2]
    return {
      kind: "runner",
      place: match[1] as RunnerPlace,
      ...(version ? { version } : {}),
    }
  }
  match = /^platform ok (x64|arm64)$/.exec(line)
  if (match) return { kind: "platform", arch: match[1] as RunnerArch }
  match = /^download ok ([1-9][0-9]{0,9})$/.exec(line)
  if (match) return { kind: "download", bytes: Number(match[1]) }
  match = /^done (system|user|path|target)$/.exec(line)
  if (match) return { kind: "done", place: match[1] as RunnerPlace }
  match = /^fail ([a-z]+)$/.exec(line)
  if (match && FAILURES.includes(match[1]!))
    return { kind: "fail", reason: match[1] as InstallFailure }
  return undefined
}

/** The order the steps come in. An event may only follow those before it in this list. */
const ORDER: readonly InstallEvent["kind"][] = [
  "connected",
  "docker",
  "runner",
  "no-runner",
  "platform",
  "ready",
  "download",
  "checksum",
  "install",
  "version",
  "folder",
  "done",
]

/**
 * Whether `event` may come next, given what came before: the script's own
 * order, each step once, an install only after a matching checksum, and the
 * end only once the folder is there. A server can still print a believable
 * list without doing anything; what it says here only decides what is shown.
 * What it does is checked by the session that follows.
 */
export function followsOrder(
  seen: readonly InstallEvent[],
  event: InstallEvent,
  request: InstallRequest
): boolean {
  if (event.kind === "fail") return seen.length > 0
  const at = ORDER.indexOf(event.kind)
  const last = seen.at(-1)
  if (last === undefined) return event.kind === "connected"
  if (at <= ORDER.indexOf(last.kind)) return false
  const has = (kind: InstallEvent["kind"]) =>
    seen.some((item) => item.kind === kind)
  const runnerSeen = has("runner") || has("no-runner")
  switch (event.kind) {
    case "docker":
      return last.kind === "connected"
    case "runner":
      return (
        last.kind === "docker" &&
        (request.mode === "update"
          ? event.place === "target"
          : event.place !== "target")
      )
    case "no-runner":
      return last.kind === "docker" && request.mode === "add"
    case "platform":
      return runnerSeen
    case "ready":
      return last.kind === "platform" && request.source.kind === "file"
    case "download":
      return request.source.kind === "file"
        ? last.kind === "ready"
        : last.kind === "platform"
    case "checksum":
      return last.kind === "download"
    case "install":
      return last.kind === "checksum"
    case "version":
      return runnerSeen && (last.kind === "install" || last.kind === "runner")
    case "folder":
      return (
        runnerSeen &&
        (has("platform") || has("no-runner") ? has("version") : true)
      )
    case "done":
      return (
        last.kind === "folder" &&
        (request.mode === "update"
          ? event.place === "target"
          : event.place !== "target")
      )
    default:
      return false
  }
}

type Line =
  { kind: "line"; text: string } | { kind: "too_long" } | { kind: "end" }

/**
 * Reads the script's lines one at a time, never holding more than one line
 * of `INSTALL_LINE_LIMIT` bytes. `release` gives the stream back for the
 * session that follows, and says false when bytes beyond the last line were
 * already read: nothing may arrive before the session's first request.
 */
export function scriptLines(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  let held = new Uint8Array(0)
  let done = false
  const decoder = new TextDecoder()

  async function next(): Promise<Line> {
    for (;;) {
      const end = held.indexOf(0x0a)
      if (end !== -1) {
        const line = held.subarray(0, end)
        held = held.slice(end + 1)
        if (line.length > INSTALL_LINE_LIMIT) return { kind: "too_long" }
        return { kind: "line", text: decoder.decode(line) }
      }
      if (held.length > INSTALL_LINE_LIMIT) return { kind: "too_long" }
      if (done) {
        if (held.length === 0) return { kind: "end" }
        const text = decoder.decode(held)
        held = new Uint8Array(0)
        return { kind: "line", text }
      }
      try {
        const chunk = await reader.read()
        if (chunk.done) done = true
        else held = Buffer.concat([held, chunk.value])
      } catch {
        done = true
      }
    }
  }

  return {
    next,
    release(): boolean {
      reader.releaseLock()
      return held.length === 0
    },
    cancel: () => void reader.cancel().catch(() => {}),
  }
}
