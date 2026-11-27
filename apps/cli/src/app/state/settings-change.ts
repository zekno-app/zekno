/**
 * Changing one setting on the settings screen (specs/010-app-settings,
 * contracts/app-screen.md, "Changing a value"; board `AppSettingsEdit`):
 * `enter` on a row opens its value, typed with the current one filled in,
 * or picked from a list for `restart`; the value is checked by the rule
 * `zekno settings set` uses (settings/values.ts) and the whole file with the
 * change by the reader's own rules (`applyChange`); then the old and the new
 * value are shown and one question is asked, y/N. Only `y` writes: `n`,
 * `enter` and `esc` keep the value, so a key typed ahead never writes.
 *
 * Nothing here reads or writes the file: `y` asks for `write-setting` with
 * the SHA-256 of the file the change was opened on, and the effect refuses
 * the write when the file is no longer those bytes.
 */
import { buildRaw, isBuildPath } from "../../settings/build-values"
import { applyChange, shownValue } from "../../settings/change"
import type { ServiceSettings, SettingPath } from "../../settings/types"
import { MAX_SECRETS, MAX_TEXT, readTyped } from "../../settings/values"
import {
  CS17,
  IMAGE_NEEDED,
  settingWords,
  startRule,
} from "../../settings/words"
import { applyConfirmKey, type Choice } from "../../ui/parts/confirm"
import { applySelectKey } from "../../ui/parts/select"
import { applyTextInput } from "../../ui/parts/text-input"
import { TYPED_AHEAD_MS } from "../../ui/terminal/type-ahead"
import type { AppKey } from "../keys"
import type { Step } from "./events"
import { inputOf, listKey, type InputFlags } from "./input"
import {
  settingsReadOf,
  top,
  type ReadOutcome,
  type SettingsScreen,
} from "./reading"
import { go, quit, replaceTop, stay } from "./steps"
import type { ScreenChange, State } from "./types"

/**
 * Whether a key read at `at` comes too soon after the settings screen's open
 * question (the value typed, the restart rules, or "Write this to ...?")
 * opened to answer it: within `TYPED_AHEAD_MS` of the key that opened it,
 * that read included, before it can have been drawn. Single commands throw
 * such keys away for as long before they draw a question (type-ahead.ts);
 * here a `y` 3 ms after the Enter that opens the write question would
 * otherwise write the file unseen (the pseudo-terminal walkthrough of
 * feature 010). Ctrl-C is left to quit.
 */
export function heldBack(state: State, key: AppKey, at?: number): boolean {
  const screen = top(state)
  const opened =
    screen.name === "settings" ? screen.change?.openedAt : undefined
  return (
    opened !== undefined &&
    at !== undefined &&
    key.kind !== "ctrl-c" &&
    at - opened < TYPED_AHEAD_MS
  )
}

/**
 * Marks when a question of the settings screen opened: a change that is new
 * after this key, or now at another stage, opened at `at`, the time the key
 * was read (`heldBack`).
 */
export function stampOpened(before: State, step: Step, at?: number): Step {
  if (at === undefined) return step
  const was = top(before)
  const now = top(step.state)
  if (now.name !== "settings" || !now.change) return step
  const previous = was.name === "settings" ? was.change : undefined
  if (previous && previous.stage === now.change.stage) return step
  return {
    ...step,
    state: replaceTop(step.state, {
      ...now,
      change: { ...now.change, openedAt: at },
    }),
  }
}

/** The restart rules, in the order the list shows them. */
export const RESTARTS = ["no", "on-failure", "always"] as const

/** The answers to "Write this to zekno.app.json?": only `y` writes. `n` names the value it keeps. */
export const askChoices = (now: string): Choice<"yes" | "no">[] => [
  { key: "y", answer: "yes", does: "write it" },
  { key: "n", answer: "no", does: `keep ${now}` },
  { key: "esc", answer: "no", does: "back" },
]

/** The beginning of CS17: what is left after it is the place and the rule a change breaks. */
const CS17_START = CS17("", "")

/** The most characters a typed value may hold: a secret list holds many names, anything else at most 4096. */
const limitOf = (path: SettingPath): number =>
  path.key === "secrets" ? MAX_SECRETS * 130 : MAX_TEXT

/** A setting's value as it is written in the file, to be filled in: empty when it is not set. */
function rawValue(service: ServiceSettings | undefined, path: SettingPath) {
  if (service === undefined) return ""
  // specs/016-build-from-source, J18: a Build row's value as `zekno settings set` takes it.
  if (isBuildPath(path)) return buildRaw(service, path.key)
  switch (path.key) {
    case "plain":
      return service.plain?.find(([name]) => name === path.name)?.[1] ?? ""
    case "volume":
      return service.volumes?.find(([name]) => name === path.name)?.[1] ?? ""
    case "secrets":
      return service.secrets?.join(", ") ?? ""
    case "port":
    case "publish": {
      const port = service[path.key]
      return port === undefined ? "" : String(port)
    }
    // specs/015-domains-https, CL1: as `zekno settings set` takes them. The screen gives them rows in a later phase.
    case "domains":
      return service.domains?.join(", ") ?? ""
    case "health":
      return service.health === undefined ? "" : (service.health.path ?? "up")
    case "health-timeout": {
      const timeout = service.health?.timeout
      return timeout === undefined ? "" : String(timeout)
    }
    default:
      return service[path.key] ?? ""
  }
}

/** The change in a settings screen, replaced; undefined closes it. */
const withChange = (
  state: State,
  screen: SettingsScreen,
  change: ScreenChange | undefined
): State => replaceTop(state, { ...screen, change })

/** `enter` on a row: its value to type, with the current one filled in, or the restart rules to pick from. */
export function openChange(
  state: State,
  screen: SettingsScreen,
  read: ReadOutcome,
  path: SettingPath
): Step {
  const service = read.settings.services.find(
    ([name]) => name === path.service
  )?.[1]
  const typed = rawValue(service, path)
  const change: ScreenChange = {
    path,
    stage: path.key === "restart" ? "picking" : "typing",
    typed,
    pick: Math.max(
      0,
      RESTARTS.findIndex((rule) => rule === (typed || "no"))
    ),
    now: shownValue(path, read.settings),
    sha256: read.sha256,
  }
  return stay(withChange(state, screen, change))
}

/**
 * A value given (`typed`; empty removes the setting): refused with the rule
 * it breaks, kept open; the same as now, closed with nothing written; or
 * on to the question, with how the old and the new value read.
 */
function checked(
  state: State,
  screen: SettingsScreen,
  change: ScreenChange,
  typed: string
): Step {
  const read = settingsReadOf(state, screen)
  if (!read) return stay(withChange(state, screen, undefined))
  const refuse = (reason: string) =>
    stay(withChange(state, screen, { ...change, typed, reason }))
  const { path } = change
  if (typed === "" && path.key === "image") return refuse(IMAGE_NEEDED)
  // A Build row's value is held to its rules by `applyChange`, as `zekno settings set` holds it (build-values.ts).
  if (typed !== "" && !isBuildPath(path)) {
    const value = readTyped(path, typed)
    if ("refused" in value) return refuse(value.refused)
  }
  const value = typed === "" ? undefined : typed
  const applied = applyChange(read.settings, path, value, read.report.file)
  if ("refused" in applied) {
    // The same value, or a setting left out that is left out again: nothing to write.
    if (applied.status === 0) return stay(withChange(state, screen, undefined))
    const { refused } = applied
    return refuse(
      refused.startsWith(CS17_START)
        ? refused.slice(CS17_START.length)
        : refused
    )
  }
  return stay(
    withChange(state, screen, {
      ...change,
      stage: "asking",
      typed,
      reason: undefined,
      now: applied.now,
      next: { value, shown: applied.next },
    })
  )
}

/** A line break or a control character, which a typed value never takes. */
const LINE_OR_CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** The sentence the screen has for a value of more than one line: a plain value's rule, or a start command's for a control character. */
const oneLine = (path: SettingPath): string =>
  path.key === "plain" ? settingWords("plain").rule : startRule("control")

/** A key, or a paste, typed into the value. Enter checks it; Esc closes the change. */
export function typeSetting(
  state: State,
  screen: SettingsScreen,
  input: string,
  flags: InputFlags
): Step {
  const change = screen.change
  if (!change || change.stage !== "typing") return stay(state)
  const result = applyTextInput(
    change.typed,
    input,
    flags,
    limitOf(change.path)
  )
  // Keys that came in one read with a line break or a control character among them are taken for a paste of several
  // lines and dropped, so nothing is written: the setting's rule for one line says why (the walkthrough's rough edge).
  if (
    result.kind === "typing" &&
    result.value === change.typed &&
    LINE_OR_CONTROL.test(input.replace(/(\r\n?|\n)$/, ""))
  )
    return stay(
      withChange(state, screen, { ...change, reason: oneLine(change.path) })
    )
  if (result.kind === "cancelled")
    return stay(withChange(state, screen, undefined))
  if (result.kind === "done")
    return checked(state, screen, change, result.value)
  // Why a value was refused is about that value: the first key that changes it takes the reason away.
  if (result.value === change.typed) return stay(state)
  return stay(
    withChange(state, screen, {
      ...change,
      typed: result.value,
      reason: undefined,
    })
  )
}

/**
 * The keys of a change that is picking or asking. Ctrl-C quits; nothing else
 * but the change's own keys does anything, as with every question the app
 * asks.
 */
export function onChange(
  state: State,
  screen: SettingsScreen,
  key: AppKey
): Step {
  const change = screen.change!
  if (key.kind === "ctrl-c") return quit(state)
  if (change.stage === "picking") {
    const moved = applySelectKey(change.pick, RESTARTS.length, listKey(key))
    if (moved.kind === "moved")
      return stay(withChange(state, screen, { ...change, pick: moved.index }))
    if (moved.kind === "cancelled")
      return stay(withChange(state, screen, undefined))
    if (moved.kind === "chosen")
      return checked(state, screen, change, RESTARTS[moved.index]!)
    return stay(state)
  }
  if (change.stage === "asking") {
    const [input, flags] = inputOf(key)
    // Enter answers no, as the default of a y/N question; only `y` writes.
    const answer =
      applyConfirmKey(askChoices(change.now), input, flags) ??
      (flags.return ? "no" : undefined)
    if (answer === undefined) return stay(state)
    const closed = withChange(state, screen, undefined)
    if (answer === "no" || !change.next) return stay(closed)
    return go(closed, {
      kind: "write-setting",
      server: screen.server,
      app: screen.app,
      path: change.path,
      value: change.next.value,
      sha256: change.sha256,
    })
  }
  return stay(state)
}
