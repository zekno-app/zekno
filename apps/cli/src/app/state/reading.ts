/**
 * Reading the state: the screen that shows, and what is open on it. Every
 * part of the reducer, and the screens, ask these.
 */
import {
  MIN_COLUMNS,
  MIN_ROWS,
  type Screen,
  type SettingsView,
  type State,
} from "./types"

export const top = (state: State): Screen => state.stack.at(-1)!

/** The settings screen. */
export type SettingsScreen = Extract<Screen, { name: "settings" }>
/** The settings as read for that screen. */
export type ReadOutcome = Extract<SettingsView["outcome"], { kind: "read" }>

/** What the settings screen shows, when it has been read for its app. */
export function settingsViewOf(
  state: State,
  screen: Pick<SettingsScreen, "server" | "app">
): SettingsView | undefined {
  const view = state.settingsView
  return view?.server === screen.server && view.app === screen.app
    ? view
    : undefined
}

/** The settings as read for the screen's app, or undefined before the read or when a sentence stands in their place. */
export function settingsReadOf(
  state: State,
  screen: Pick<SettingsScreen, "server" | "app">
): ReadOutcome | undefined {
  const outcome = settingsViewOf(state, screen)?.outcome
  return outcome?.kind === "read" ? outcome : undefined
}

/** Below 80 by 24 the app asks for a larger window instead of drawing (FR-007). */
export const tooSmall = (state: State): boolean =>
  state.size.columns < MIN_COLUMNS || state.size.rows < MIN_ROWS

/** A visible one-line question is open, so letters type into it. */
export function textQuestionOpen(state: State): boolean {
  const screen = top(state)
  switch (screen.name) {
    case "welcome":
      return !screen.creating
    case "add-server":
      return screen.step === "destination" || screen.step === "name"
    case "set-secret":
      return screen.question === "name"
    case "logs":
      return screen.filtering
    case "settings":
      return screen.change?.stage === "typing"
    default:
      return false
  }
}

/** The hidden prompt is open: keys go to it, not to the app. */
export function hiddenPromptOpen(state: State): boolean {
  const screen = top(state)
  return screen.name === "set-secret" && screen.question === "value"
}

/** The secret the hidden prompt is asking for. */
export function promptedName(state: State): string | undefined {
  const screen = top(state)
  if (screen.name !== "set-secret" || screen.question !== "value")
    return undefined
  return screen.missing.length > 0
    ? screen.missing[screen.at]
    : screen.secretName
}

/**
 * Whether what is running may be read again now (contracts/app.md,
 * "Refresh"): only while Home, the app screen or the settings screen with no
 * change open is showing and no question of any kind is open, and not below
 * 80 by 24, where nothing is shown.
 */
export function refreshAllowed(state: State): boolean {
  const screen = top(state)
  const settings = screen.name === "settings" && screen.change === undefined
  if (screen.name !== "home" && screen.name !== "app" && !settings) return false
  if (state.exiting || state.quitting || tooSmall(state)) return false
  return (
    state.question === undefined &&
    !textQuestionOpen(state) &&
    !hiddenPromptOpen(state)
  )
}
