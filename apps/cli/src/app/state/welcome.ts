/** First run (board "First run: no team yet"): the name the key is created with, then step 2, adding a server. */
import { applyTextInput } from "../../ui/parts/text-input"
import { addServerScreen } from "./add-server"
import type { EventOf, Step } from "./events"
import type { InputFlags } from "./input"
import { go, quit, replaceTop, stay } from "./steps"
import type { Screen, State } from "./types"

/** Typing the name. Esc quits: there is nothing below this screen. */
export function typeName(state: State, screen: Extract<Screen, { name: "welcome" }>, input: string, flags: InputFlags): Step {
  const result = applyTextInput(screen.value, input, flags)
  if (result.kind === "cancelled") return quit(state)
  const name = result.value.trim()
  if (result.kind === "done" && name !== "") {
    return go(replaceTop(state, { ...screen, value: result.value, creating: true }), { kind: "create-key", name })
  }
  return stay(replaceTop(state, { ...screen, value: result.value }))
}

export const teamCreated = (state: State, event: EventOf<"team-created">): Step =>
  // First run, step 2: Home underneath, so leaving "add a server" lands there.
  stay({
    ...state,
    team: event.team,
    stack: [{ name: "home", pane: "servers", server: 0, app: 0 }, addServerScreen(true)],
    notice: undefined,
  })
