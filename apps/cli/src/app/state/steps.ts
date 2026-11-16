/**
 * Changing the state: a step that stays or asks for effects, the stack of
 * screens, and quitting. Every part of the reducer changes the state with
 * these.
 */
import type { Effect, Step } from "./events"
import type { Screen, ScreenName, State } from "./types"

export const stay = (state: State): Step => ({ state, effects: [] })
export const go = (state: State, ...effects: Effect[]): Step => ({
  state,
  effects,
})

/** Opens a screen on top of the current one. A line about something else is left behind. */
export const push = (
  state: State,
  screen: Screen,
  ...effects: Effect[]
): Step =>
  go(
    { ...state, stack: [...state.stack, screen], notice: undefined },
    ...effects
  )

/** Returns to the screen below. The first screen is never closed this way. */
export function pop(state: State, ...effects: Effect[]): Step {
  if (state.stack.length <= 1) return stay(state)
  return go(
    { ...state, stack: state.stack.slice(0, -1), notice: undefined },
    ...effects
  )
}

/** Changes the screen that is showing. */
export const replaceTop = (state: State, screen: Screen): State => ({
  ...state,
  stack: [...state.stack.slice(0, -1), screen],
})

/** Changes every screen of one kind, wherever it is in the stack. */
export function updateScreens<Name extends ScreenName>(
  state: State,
  name: Name,
  change: (screen: Extract<Screen, { name: Name }>) => Screen
): State {
  return {
    ...state,
    stack: state.stack.map((screen) =>
      screen.name === name
        ? change(screen as Extract<Screen, { name: Name }>)
        : screen
    ),
  }
}

/** Quits, or, with a deploy in progress, waits for it to finish first. */
export function quit(state: State): Step {
  if (state.deploy?.running) return stay({ ...state, quitting: true })
  return go({ ...state, exiting: true }, { kind: "exit" })
}

export const keep = <T>(
  items: readonly T[],
  added: readonly T[],
  limit: number
): T[] => [...items, ...added].slice(-limit)
