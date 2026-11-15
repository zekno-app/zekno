/**
 * Setting a secret (board "Set a secret"): the name question, the hidden
 * prompt and, before a deploy, the list of values the Compose file expects.
 *
 * A hidden value (a secret being typed) never enters the state. While the
 * hidden prompt is open the reducer only knows that it is open: the keys go
 * to the prompt, and only Esc and Ctrl-C close it. Closing it never signs or
 * sends anything: before a deploy it returns to the list of missing values,
 * where going ahead without them is a question of its own.
 */
import { isReservedSecretName, LIMITS, SECRET_NAME } from "@workspace/core"

import { applySelectKey } from "../../ui/parts/select"
import { applyTextInput } from "../../ui/parts/text-input"
import type { AppKey } from "../keys"
import type { EventOf, Step } from "./events"
import { listKey, type InputFlags } from "./input"
import { top } from "./reading"
import { pop, replaceTop, stay } from "./steps"
import type { Screen, State } from "./types"

type SetSecretScreen = Extract<Screen, { name: "set-secret" }>

export const setSecretScreen = (server: string, app: string): SetSecretScreen => ({
  name: "set-secret",
  server,
  app,
  missing: [],
  done: [],
  at: 0,
  question: "name",
  secretName: "",
})

/**
 * Why a name cannot be a secret's, in the words `zekno secret set` uses, or
 * undefined when it can. The rule is the core library's (`secretName` in
 * packages/core/src/secrets/secrets.ts): its pattern and its length.
 */
export function secretNameProblem(name: string): string | undefined {
  if (!SECRET_NAME.test(name) || name.length > LIMITS.secretNameLength) return "A secret name uses letters, digits and underscore, and does not start with a digit."
  if (isReservedSecretName(name)) return `"${name}" is reserved: the runner uses it to start Docker. Choose another name.`
  return undefined
}

/** Typing the secret's name. */
export function typeSecretName(state: State, screen: SetSecretScreen, input: string, flags: InputFlags): Step {
  const result = applyTextInput(screen.secretName, input, flags)
  if (result.kind === "cancelled") return pop(state)
  const name = result.value.trim()
  if (result.kind === "done" && name !== "") {
    // A name that cannot be stored is said now, before anyone types a value for it.
    const problem = secretNameProblem(name)
    if (problem) return stay({ ...replaceTop(state, { ...screen, secretName: name }), notice: { tone: "error", text: problem } })
    return stay(replaceTop(state, { ...screen, secretName: name, question: "value" }))
  }
  return stay(replaceTop(state, { ...screen, secretName: result.value }))
}

/**
 * The hidden prompt has the keys. Esc is the board's "esc cancel": it
 * cancels setting the secret, and before a deploy it closes the prompt only,
 * back to the list, so nothing is ever signed by it. Ctrl-C closes the
 * prompt only.
 */
export function onHiddenPrompt(state: State, key: AppKey): Step {
  const screen = top(state)
  if (screen.name !== "set-secret") return stay(state)
  if (key.kind === "ctrl-c") {
    // Back to what was asked before the value, so nothing is lost but the value.
    return stay(replaceTop(state, { ...screen, question: screen.missing.length > 0 ? undefined : "name" }))
  }
  if (key.kind === "escape") {
    if (screen.missing.length === 0) return pop(state)
    return stay(replaceTop(state, { ...screen, question: undefined }))
  }
  return stay(state)
}

export function onSetSecret(state: State, screen: SetSecretScreen, key: AppKey): Step | undefined {
  // No question is open here: the hidden prompt was closed, before a deploy. Esc asks before going ahead without the values.
  if (key.kind === "escape") {
    if (screen.missing.length === 0) return pop(state)
    const names = screen.missing.filter((name) => !screen.done.includes(name))
    return stay({ ...state, question: { kind: "skip-values", server: screen.server, app: screen.app, names } })
  }
  if (key.kind === "up" || key.kind === "down") {
    const moved = applySelectKey(screen.at, screen.missing.length, listKey(key))
    return moved.kind === "moved" ? stay(replaceTop(state, { ...screen, at: moved.index })) : stay(state)
  }
  if (key.kind === "enter") return stay(replaceTop(state, { ...screen, question: screen.missing.length > 0 ? "value" : "name" }))
  return undefined
}

/** The first of `missing` after `at`, going round to the start, that is not done; undefined when all are. */
function nextUnset(missing: readonly string[], done: readonly string[], at: number): number | undefined {
  for (let step = 1; step <= missing.length; step++) {
    const index = (at + step) % missing.length
    if (!done.includes(missing[index]!)) return index
  }
  return undefined
}

/** The hidden prompt stored a value: before a deploy, on to the next name not set yet. */
export function secretSaved(state: State, event: EventOf<"secret-saved">): Step {
  const screen = top(state)
  if (screen.name !== "set-secret") return stay({ ...state, notice: event.notice })
  // Before a deploy: on to the next name not set yet, and on to the deploy once none is left.
  if (screen.missing.length > 0) {
    const done = [...screen.done, screen.missing[screen.at]!]
    const next = nextUnset(screen.missing, done, screen.at)
    if (next !== undefined) return stay({ ...replaceTop(state, { ...screen, done, at: next, question: "value" }), notice: event.notice })
  }
  const step =
    screen.missing.length > 0
      ? pop(state, { kind: "deploy-continue", server: screen.server, app: screen.app, answer: "values-set" })
      : pop(state)
  return { ...step, state: { ...step.state, notice: event.notice } }
}

/** The hidden prompt's value was refused. */
export function secretRefused(state: State, event: EventOf<"secret-refused">): Step {
  const screen = top(state)
  if (screen.name !== "set-secret") return stay({ ...state, notice: event.notice })
  // The prompt opens again, for another try.
  return stay({ ...replaceTop(state, { ...screen, question: "value" }), notice: event.notice })
}
