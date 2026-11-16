/**
 * Reading the state: the screen that shows, and what is open on it. Every
 * part of the reducer, and the screens, ask these.
 */
import { MIN_COLUMNS, MIN_ROWS, type Screen, type State } from "./types"

export const top = (state: State): Screen => state.stack.at(-1)!

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
 * "Refresh"): only while Home or the app screen is showing and no question
 * of any kind is open, and not below 80 by 24, where nothing is shown.
 */
export function refreshAllowed(state: State): boolean {
  const screen = top(state)
  if (screen.name !== "home" && screen.name !== "app") return false
  if (state.exiting || state.quitting || tooSmall(state)) return false
  return (
    state.question === undefined &&
    !textQuestionOpen(state) &&
    !hiddenPromptOpen(state)
  )
}
