/**
 * Adding a server (board "Add a server"): its two questions, its steps as
 * they end, what the server printed, and its code once it was added. Adding
 * goes on while the screen is left with esc; the screen opens on its
 * progress again.
 */
import { applyTextInput } from "../../ui/parts/text-input"
import type { AppKey } from "../keys"
import type { EventOf, Step } from "./events"
import { isText, type InputFlags } from "./input"
import { go, keep, pop, push, replaceTop, stay, updateScreens } from "./steps"
import { clampHome } from "./team"
import {
  ADD_STEPS,
  LOCAL_ADD_STEPS,
  RUNNER_LINES,
  type AddProgress,
  type Screen,
  type State,
} from "./types"

type AddServerScreen = Extract<Screen, { name: "add-server" }>

export const addServerScreen = (firstRun = false): AddServerScreen => ({
  name: "add-server",
  step: "destination",
  destination: "",
  serverName: "",
  output: false,
  ...(firstRun ? { firstRun } : {}),
})

/**
 * Opens "add a server". While one is still being added (its screen was left
 * with esc), it opens on that one's progress; otherwise on the questions,
 * with nothing left over from an earlier attempt.
 */
export function openAddServer(state: State): Step {
  const adding = state.adding
  if (adding?.running) {
    return push(state, {
      ...addServerScreen(),
      step: "working",
      destination: adding.destination,
      serverName: adding.name,
    })
  }
  return push({ ...state, adding: undefined }, addServerScreen())
}

/** Typing the destination, then the name. */
export function typeAddServer(
  state: State,
  screen: AddServerScreen,
  input: string,
  flags: InputFlags
): Step {
  const field = screen.step === "destination" ? "destination" : "serverName"
  const result = applyTextInput(screen[field], input, flags)
  if (result.kind === "cancelled") return pop(state)
  const typed = { ...screen, [field]: result.value }
  if (result.kind !== "done" || result.value.trim() === "")
    return stay(replaceTop(state, typed))
  if (screen.step === "destination")
    return stay(replaceTop(state, { ...typed, step: "name" }))
  return go(replaceTop(state, { ...typed, step: "working" }), {
    kind: "add-server",
    destination: typed.destination.trim(),
    name: typed.serverName.trim(),
  })
}

/** Its keys once no question is open: `o` while it works, enter or esc once it is done. */
export function onAddServer(
  state: State,
  screen: AddServerScreen,
  key: AppKey
): Step | undefined {
  if (
    screen.step === "done" &&
    (key.kind === "enter" || key.kind === "escape")
  ) {
    // Home, where the new server is already selected, with the line that says it was added.
    const back = pop(state)
    return { ...back, state: { ...back.state, notice: screen.added } }
  }
  if (screen.step === "working" && isText(key, "o"))
    return stay(replaceTop(state, { ...screen, output: !screen.output }))
  return undefined
}

/** The step adding a server stopped at: the first that had not ended. */
export function failAdding(adding: AddProgress): AddProgress {
  const at = (adding.local ? LOCAL_ADD_STEPS : ADD_STEPS).find(
    (step) => !adding.steps[step]
  )
  return {
    ...adding,
    running: false,
    steps: at ? { ...adding.steps, [at]: { state: "failed" } } : adding.steps,
  }
}

/** A server was added: it is selected on Home, and its screen shows its code. */
export function serverAdded(
  state: State,
  event: EventOf<"server-added">
): Step {
  const adding = state.adding ? { ...state.adding, running: false } : undefined
  const next = clampHome({ ...state, team: event.team, adding })
  // The new server is selected on Home.
  const index = event.team.servers.length - 1
  const selected = updateScreens(next, "home", (screen) =>
    index >= 0 ? { ...screen, pane: "servers", server: index, app: 0 } : screen
  )
  // Its screen stays open, every step ticked and the server code in its panel, until enter or esc (FR-013).
  if (
    selected.stack.some(
      (screen) => screen.name === "add-server" && screen.step === "working"
    )
  ) {
    return stay(
      updateScreens(selected, "add-server", (screen) =>
        screen.step === "working"
          ? { ...screen, step: "done", output: false, added: event.notice }
          : screen
      )
    )
  }
  // It was left with esc while it worked, so the panel was not seen: the line on Home gives the code.
  const code = event.code === undefined ? "" : ` Server code ${event.code}.`
  return stay({
    ...selected,
    notice: { ...event.notice, text: `${event.notice.text}${code}` },
  })
}

export const addStarted = (state: State, event: EventOf<"add-started">): Step =>
  // A line about an earlier attempt would now be about the wrong one.
  stay({
    ...state,
    notice: undefined,
    adding: {
      destination: event.destination,
      name: event.name,
      local: event.local,
      steps: {},
      lines: [],
      running: true,
    },
  })

export function addStep(state: State, event: EventOf<"add-step">): Step {
  if (!state.adding) return stay(state)
  return stay({
    ...state,
    adding: {
      ...state.adding,
      steps: {
        ...state.adding.steps,
        [event.step]: {
          state: "done",
          detail: event.detail,
          found: event.found,
        },
      },
    },
  })
}

export const addCode = (state: State, event: EventOf<"add-code">): Step =>
  state.adding
    ? stay({ ...state, adding: { ...state.adding, serverCode: event.code } })
    : stay(state)

export const addLine = (state: State, event: EventOf<"add-line">): Step =>
  state.adding
    ? stay({
        ...state,
        adding: {
          ...state.adding,
          lines: keep(state.adding.lines, [event.line], RUNNER_LINES),
        },
      })
    : stay(state)
