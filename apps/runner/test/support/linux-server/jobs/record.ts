/**
 * The record line of a Linux check (specs/016-build-from-source, T009;
 * quickstart.md, "Phase 0", item 2): `record(id, seen)` prints one line,
 * `<id> <engine> <store>: <what was seen>`, and appends it to the step's
 * summary on GitHub (`$GITHUB_STEP_SUMMARY`). The engine and the store come
 * from `ZEKNO_CHECK_ENGINE` and `ZEKNO_CHECK_STORE`, which run-checks.ts
 * sets (`none` in the macOS job, which has no Docker); run by hand without
 * them, from the run.json of the stand-in `ZEKNO_LINUX_SERVER` names, else
 * `unknown`.
 *
 * What was seen is kept to one line whatever it held: a break becomes ` / `
 * and a control character `?`, so a check in record mode never fails on what
 * it saw. A record with nothing seen, or an id no check has, is the check's
 * own fault, and throws.
 */
import { appendFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"

import { STAND_IN, standInOf } from "../gate"
import { labels } from "./modes"
import { ENGINE_NAMES } from "../pins"
import { STORES } from "../stand-in/plan"
import { readState } from "../stand-in/run-folder"

export const ENGINE_VARIABLE = "ZEKNO_CHECK_ENGINE"
export const STORE_VARIABLE = "ZEKNO_CHECK_STORE"
export const SUMMARY_VARIABLE = "GITHUB_STEP_SUMMARY"
/** The engine and store of a job with no Docker. */
export const NO_DOCKER = "none"
export const UNKNOWN = "unknown"

type Env = Readonly<Record<string, string | undefined>>

/** `seen` as one line of text. */
export function oneLine(seen: string): string {
  const line = seen
    .trim()
    .replace(/\r\n|[\r\n\u0085\p{Zl}\p{Zp}]/gu, " / ")
    .replace(/\t/g, " ")
    .replace(/\p{Cc}/gu, "?")
    .trim()
  if (line === "") throw new Error("a record says what was seen")
  return line
}

/** The engine and the store a record names. */
export function legOf(
  env: Env,
  root: string = tmpdir()
): { engine: string; store: string } {
  const engine = env[ENGINE_VARIABLE]
  const store = env[STORE_VARIABLE]
  if (engine || store) {
    const none = engine === NO_DOCKER && store === NO_DOCKER
    if (
      !none &&
      !(
        (ENGINE_NAMES as readonly string[]).includes(engine ?? "") &&
        (STORES as readonly string[]).includes(store ?? "")
      )
    )
      throw new Error(
        `${ENGINE_VARIABLE}=${engine ?? ""} and ${STORE_VARIABLE}=${store ?? ""} are not an engine and a store of the stand-in, nor both ${NO_DOCKER}`
      )
    return { engine: engine!, store: store! }
  }
  const standIn = standInOf(env)
  if (standIn !== undefined) {
    const state = readState(root, STAND_IN.exec(standIn)![1]!)
    if (!("reason" in state))
      return { engine: state.engine, store: state.store }
  }
  return { engine: UNKNOWN, store: UNKNOWN }
}

/** `<id> <engine> <store>: <what was seen>`. */
export function recordLine(
  id: string,
  seen: string,
  env: Env = process.env,
  root: string = tmpdir()
): string {
  if (!labels().includes(id))
    throw new Error(`${JSON.stringify(id)} is no check or part of modes.ts`)
  const { engine, store } = legOf(env, root)
  return `${id} ${engine} ${store}: ${oneLine(seen)}`
}

/**
 * Appends a line to the step's summary as a line of an indented code block,
 * which GitHub shows as it is, one line each, with nothing of it read as
 * Markdown.
 */
export function appendToSummary(path: string, line: string): void {
  let before = ""
  try {
    before = readFileSync(path, "utf8")
  } catch {
    // A summary not yet written starts here.
  }
  const opening = before === "" || /(?:^|\n) {4}[^\n]*\n$/.test(before)
  appendFileSync(path, `${opening ? "" : "\n"}    ${line}\n`)
}

/** Prints the record line of `id` and, on GitHub, appends it to the step's summary. */
export function record(
  id: string,
  seen: string,
  env: Env = process.env,
  print: (line: string) => void = (line) => console.log(line),
  root: string = tmpdir()
): string {
  const line = recordLine(id, seen, env, root)
  print(line)
  const summary = env[SUMMARY_VARIABLE]
  if (summary) appendToSummary(summary, line)
  return line
}
