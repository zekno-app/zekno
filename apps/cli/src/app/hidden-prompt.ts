/**
 * The keys of the hidden prompt in "set a secret" (T020), with every rule of
 * ui/parts/secret-input.ts: a value of several lines is refused with the pointer
 * to `--stdin`, an empty value is not stored, control keys never become part
 * of the value, and Ctrl-C cancels the prompt only.
 *
 * The value is held in `held`, which app.tsx keeps in a ref: never in the
 * app's state, never in an event, never drawn. Only Esc and Ctrl-C reach
 * the reducer, as keys, and a finished value goes straight to the secret
 * operation (effects.ts `saveSecret`).
 */
import type { Key } from "ink"

import { isLateAnswer } from "../ui/terminal/background"
import { applySecretInput } from "../ui/parts/secret-input"
import type { AppEvent } from "./state/events"
import { promptedName, top } from "./state/reading"
import type { State } from "./state/types"

/** The value typed so far, and whether a finished value is being stored. */
export type HiddenValue = { value: string; saving: boolean }

export const emptyHiddenValue = (): HiddenValue => ({
  value: "",
  saving: false,
})

/** Stores a finished value for one secret of one app. */
export type SaveSecret = (
  where: { server: string; app: string; name: string },
  value: string
) => Promise<void>

/**
 * Applies one key press or paste to the hidden prompt that is open in
 * `state`. Once a value is finished nothing more is taken until it has been
 * stored or refused. A piece of the terminal's late answer to the background
 * question is the terminal talking, not a person typing, and is dropped.
 */
export function hiddenPromptKey(
  held: HiddenValue,
  input: string,
  key: Partial<Key>,
  state: State,
  dispatch: (event: AppEvent) => void,
  save: SaveSecret
): void {
  if (held.saving || isLateAnswer(input)) return
  const next = applySecretInput(held.value, input, key)
  switch (next.kind) {
    case "typing":
      held.value = next.value
      return
    case "cancelled":
      held.value = ""
      dispatch({ type: "key", key: { kind: key.escape ? "escape" : "ctrl-c" } })
      return
    case "rejected":
      held.value = ""
      dispatch({
        type: "secret-refused",
        notice: { tone: "error", text: next.reason },
      })
      return
    case "done": {
      held.value = ""
      const screen = top(state)
      const name = promptedName(state)
      if (screen.name !== "set-secret" || name === undefined) return
      held.saving = true
      void save(
        { server: screen.server, app: screen.app, name },
        next.value
      ).finally(() => (held.saving = false))
      return
    }
  }
}
