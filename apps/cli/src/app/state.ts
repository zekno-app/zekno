/**
 * The app's state and what every key does on every screen
 * (specs/004-cli-app/contracts/app.md), as one pure function: an event in,
 * the next state and the effects to run out. Nothing here touches the
 * terminal, a file or a server; effects.ts does that and reports back with
 * more events. That is what lets every key be tested without a terminal.
 *
 * A hidden value (a secret being typed) never enters this state. While the
 * hidden prompt is open the reducer only knows that it is open: the keys go
 * to the prompt, and only Esc and Ctrl-C close it.
 */
import type { DeployStage } from "../ops/deploy"
import { applyConfirmKey, type Choice } from "../ui/confirm"
import { applySelectKey, clampIndex, type ListKey } from "../ui/select"
import { applyTextInput } from "../ui/text-input"
import type { AppKey } from "./keys"

/** FR-007: the smallest window the app draws itself in. */
export const MIN_COLUMNS = 80
export const MIN_ROWS = 24

/** data-model.md, "In the app's memory only". */
export const DEPLOY_LINES = 500
export const LOG_LINES = 2000
/** What runners and SSH wrote on standard error, kept for showing on request. */
export const RUNNER_LINES = 200

// ---------------------------------------------------------------------------
// What the app knows

/** Whether an app's services are running, as the runner last said. */
export type RunState = "running" | "stopped" | "partly running" | "unknown"

export type AppRow = { name: string; deploy?: number; at?: string; state: RunState }

export type ServerRow = {
  name: string
  /** The SSH destination. Undefined for a runner on this machine. */
  destination?: string
  /** Undefined until it has been asked. */
  reachable?: boolean
  /** The runner's version, and whether it is older than this CLI needs. */
  runner?: { version: string; outdated: boolean }
  apps: AppRow[]
}

/** The verified team, as the screens show it. */
export type TeamView = { member: string; version: number; servers: ServerRow[] }

export type DeployRow = { sequence: number; outcome: "sent" | "started" | "start_failed"; at: string }
export type SecretRow = { name: string; version: number; removed: boolean }
/** One line of an app's logs. Its text was cleaned when it arrived (session.ts). */
export type LogLine = { time: string; service: string; line: string }

/** A line on the current screen: the result of something done elsewhere, or why something was not done. */
export type Notice = { tone: "success" | "error" | "warning" | "info"; text: string }

/** A deploy started from the app, kept until the app closes. */
export type DeployProgress = {
  server: string
  app: string
  /** Known from the "checked" stage on. */
  sequence?: number
  secrets?: number
  stage?: DeployStage
  /** Docker's output, cleaned, the last `DEPLOY_LINES`. */
  lines: string[]
  running: boolean
  /** How it ended. `error` is a refusal or a failure before the runner answered. */
  outcome?: "started" | "start_failed" | "error"
  /** When it began, in milliseconds, for the time shown beside it. */
  since: number
}

/** How the app starts: the profile has been read and verified, or not (effects.ts `loadStart`). */
export type Start =
  | { kind: "team"; team: TeamView; linked?: { server: string; app: string } }
  | { kind: "no-team" }
  | { kind: "profile-error"; reason: string; folder: string }

// ---------------------------------------------------------------------------
// Screens

export type Screen =
  | { name: "home"; pane: "servers" | "apps"; server: number; app: number }
  | { name: "app"; server: string; app: string; pane: "deploys" | "secrets"; deploy: number; secret: number }
  | { name: "deploy"; output: boolean }
  | {
      name: "logs"
      server: string
      app: string
      lines: LogLine[]
      following: boolean
      /** The filter text; empty for none. */
      filter: string
      /** The filter question is open. */
      filtering: boolean
      /** The one service shown, or undefined for all. */
      service?: string
      /** Lines scrolled back from the newest. */
      scroll: number
      /** The connection dropped; Enter reconnects. */
      dropped: boolean
    }
  | { name: "welcome"; value: string; creating: boolean }
  | {
      name: "add-server"
      step: "destination" | "name" | "working"
      destination: string
      serverName: string
      output: boolean
    }
  | {
      name: "set-secret"
      server: string
      app: string
      /** Names the Compose file expects that have no secret, before a deploy. Empty when opened with `s`. */
      missing: readonly string[]
      at: number
      /** The question that is open: the name, the hidden value, or none. */
      question?: "name" | "value"
      secretName: string
    }
  | { name: "help" }
  | { name: "profile-error"; reason: string; folder: string }

export type ScreenName = Screen["name"]

/** A question the app asks with a few fixed answers (board "Two questions the app asks"). */
export type Question =
  | { kind: "remove-secret"; server: string; app: string; name: string }
  | { kind: "update-runner"; server: string }
  | { kind: "remember-folder"; server: string; app: string; compose: string }

/** The answers to each question and their keys. The boards give the words for the last two. */
export const CHOICES = {
  "remove-secret": [
    { key: "enter", answer: "yes", does: "remove it" },
    { key: "esc", answer: "no", does: "cancel" },
  ],
  "update-runner": [
    { key: "u", answer: "yes", does: "update now" },
    { key: "esc", answer: "no", does: "later" },
  ],
  "remember-folder": [
    { key: "enter", answer: "yes", does: "write it and deploy" },
    { key: "n", answer: "skip", does: "deploy without it" },
    { key: "esc", answer: "no", does: "cancel" },
  ],
} as const satisfies Record<Question["kind"], readonly Choice<string>[]>

// ---------------------------------------------------------------------------
// Effects: what the reducer asks for. effects.ts runs them.

export type Effect =
  | { kind: "exit" }
  | { kind: "create-key"; name: string }
  | { kind: "add-server"; destination: string; name: string }
  | { kind: "open-app"; server: string; app: string }
  /** `app` undefined: the app of the linked folder. */
  | { kind: "deploy"; server: string; app?: string }
  /**
   * Go ahead with the deploy that was waiting on a question, with its answer:
   * write zekno.json or not, or the missing values were set or skipped.
   */
  | { kind: "deploy-continue"; server: string; app: string; answer: "write-link" | "skip-link" | "values-set" | "skip-values" }
  /** `to` undefined: the deploy before the latest. */
  | { kind: "rollback"; server: string; app: string; to?: number }
  | { kind: "logs"; server: string; app: string }
  | { kind: "stop-logs" }
  | { kind: "remove-secret"; server: string; app: string; name: string }
  | { kind: "update-runner"; server: string }

// ---------------------------------------------------------------------------
// Events

export type AppEvent =
  | { type: "key"; key: AppKey }
  | { type: "resize"; columns: number; rows: number }
  | { type: "team"; team: TeamView }
  /** First run: the key was created; next is adding a server. */
  | { type: "team-created"; team: TeamView }
  | { type: "server-added"; team: TeamView; notice: Notice }
  | { type: "app-view"; server: string; app: string; deploys: DeployRow[]; secrets: SecretRow[] }
  | { type: "notice"; notice: Notice }
  /** An effect failed with a reason a person can act on. What was waiting for it can be tried again. */
  | { type: "failed"; notice: Notice }
  /** A line a runner or SSH wrote on standard error, already cleaned. */
  | { type: "runner-line"; line: string }
  | { type: "deploy-started"; server: string; app: string; at: number }
  | { type: "deploy-stage"; stage: DeployStage; sequence: number; secrets: number }
  | { type: "deploy-progress"; line: string }
  | { type: "deploy-ended"; outcome: "started" | "start_failed" | "error"; notice: Notice }
  /** Before a deploy: names the Compose file expects that have no secret. */
  | { type: "missing-values"; server: string; app: string; names: string[] }
  /** Before the first deploy of a folder that is not linked. */
  | { type: "ask-remember-folder"; server: string; app: string; compose: string }
  /** The hidden prompt stored a value, or refused one; it is closed either way. */
  | { type: "secret-saved"; notice: Notice }
  | { type: "secret-refused"; notice: Notice }
  | { type: "log-lines"; lines: LogLine[] }
  | { type: "logs-dropped" }

export type State = {
  /** The screens, the one showing last. Never empty. */
  stack: Screen[]
  team?: TeamView
  /** The server and app this folder's zekno.json names. */
  linked?: { server: string; app: string }
  /** Deploys and secrets of the app the app screen shows, once read. */
  appView?: { server: string; app: string; deploys: DeployRow[]; secrets: SecretRow[] }
  size: { columns: number; rows: number }
  deploy?: DeployProgress
  question?: Question
  notice?: Notice
  runnerLines: string[]
  /** `q` was pressed during a deploy: the app closes when it ends. */
  quitting: boolean
  exiting: boolean
}

export type Step = { state: State; effects: Effect[] }

// ---------------------------------------------------------------------------
// Start

/** The first screen: Home for a verified team (on the linked server and app), first run, or the profile error. */
export function initialState(start: Start, size: { columns: number; rows: number }): State {
  const base = { size, runnerLines: [], quitting: false, exiting: false }
  if (start.kind === "no-team") return { ...base, stack: [{ name: "welcome", value: "", creating: false }] }
  if (start.kind === "profile-error") {
    return { ...base, stack: [{ name: "profile-error", reason: start.reason, folder: start.folder }] }
  }
  // A linked folder opens on its server and app (contracts/app.md, "Linked folder").
  const { team, linked } = start
  const found = team.servers.findIndex((entry) => entry.name === linked?.server)
  const server = Math.max(found, 0)
  const app = found === -1 ? -1 : team.servers[found]!.apps.findIndex((entry) => entry.name === linked?.app)
  const home: Screen = { name: "home", pane: app === -1 ? "servers" : "apps", server, app: Math.max(app, 0) }
  return { ...base, stack: [home], team, linked }
}

// ---------------------------------------------------------------------------
// Reading the state

export const top = (state: State): Screen => state.stack.at(-1)!

/** Below 80 by 24 the app asks for a larger window instead of drawing (FR-007). */
export const tooSmall = (state: State): boolean => state.size.columns < MIN_COLUMNS || state.size.rows < MIN_ROWS

/** A visible one-line question is open, so letters type into it. */
export function textQuestionOpen(state: State): boolean {
  const screen = top(state)
  switch (screen.name) {
    case "welcome":
      return !screen.creating
    case "add-server":
      return screen.step !== "working"
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
  if (screen.name !== "set-secret" || screen.question !== "value") return undefined
  return screen.missing.length > 0 ? screen.missing[screen.at] : screen.secretName
}

/** The selected server on Home, if there is one. */
export function selectedServer(state: State, screen: Extract<Screen, { name: "home" }>): ServerRow | undefined {
  return state.team?.servers[screen.server]
}

/** The selected app on Home, if there is one. */
export function selectedApp(state: State, screen: Extract<Screen, { name: "home" }>): AppRow | undefined {
  return selectedServer(state, screen)?.apps[screen.app]
}

/** The app screen's data, when it has been read for that app. */
export function appViewOf(state: State, screen: Extract<Screen, { name: "app" }>) {
  const view = state.appView
  return view?.server === screen.server && view.app === screen.app ? view : undefined
}

/** The services seen in a log, in the order they first appeared: what `1`–`9` choose from. */
export function servicesOf(lines: readonly LogLine[]): string[] {
  return [...new Set(lines.map((line) => line.service))]
}

// ---------------------------------------------------------------------------
// Changing the state

const stay = (state: State): Step => ({ state, effects: [] })
const go = (state: State, ...effects: Effect[]): Step => ({ state, effects })

/** Opens a screen on top of the current one. A line about something else is left behind. */
const push = (state: State, screen: Screen, ...effects: Effect[]): Step =>
  go({ ...state, stack: [...state.stack, screen], notice: undefined }, ...effects)

/** Returns to the screen below. The first screen is never closed this way. */
function pop(state: State, ...effects: Effect[]): Step {
  if (state.stack.length <= 1) return stay(state)
  return go({ ...state, stack: state.stack.slice(0, -1), notice: undefined }, ...effects)
}

/** Changes the screen that is showing. */
const replaceTop = (state: State, screen: Screen): State => ({ ...state, stack: [...state.stack.slice(0, -1), screen] })

/** Changes every screen of one kind, wherever it is in the stack. */
function updateScreens<Name extends ScreenName>(
  state: State,
  name: Name,
  change: (screen: Extract<Screen, { name: Name }>) => Screen
): State {
  return { ...state, stack: state.stack.map((screen) => (screen.name === name ? change(screen as Extract<Screen, { name: Name }>) : screen)) }
}

/** Quits, or, with a deploy in progress, waits for it to finish first. */
function quit(state: State): Step {
  if (state.deploy?.running) return stay({ ...state, quitting: true })
  return go({ ...state, exiting: true }, { kind: "exit" })
}

const keep = <T>(items: readonly T[], added: readonly T[], limit: number): T[] => [...items, ...added].slice(-limit)

/** Keeps each selection on Home inside its list after the team changed. */
function clampHome(state: State): State {
  return updateScreens(state, "home", (screen) => {
    const servers = state.team?.servers ?? []
    const server = clampIndex(screen.server, servers.length + 1)
    return { ...screen, server, app: clampIndex(screen.app, servers[server]?.apps.length ?? 0) }
  })
}

// ---------------------------------------------------------------------------
// Keys

const isText = (key: AppKey, text: string): boolean => key.kind === "text" && key.text === text

/** As the list helpers in ui/select.tsx read keys. */
const listKey = (key: AppKey): ListKey => ({
  upArrow: key.kind === "up",
  downArrow: key.kind === "down",
  return: key.kind === "enter",
  escape: key.kind === "escape",
})

/** As the text helpers in ui/ read keys. */
function inputOf(key: AppKey): [string, { return?: boolean; escape?: boolean; backspace?: boolean }] {
  if (key.kind === "text") return [key.text, {}]
  if (key.kind === "enter") return ["\r", { return: true }]
  if (key.kind === "escape") return ["", { escape: true }]
  if (key.kind === "backspace") return ["", { backspace: true }]
  return ["", {}]
}

/** An open question with fixed answers: its keys answer it, Ctrl-C quits, anything else is ignored. */
function onQuestion(state: State, question: Question, key: AppKey): Step {
  if (key.kind === "ctrl-c") return quit(state)
  const [input, flags] = inputOf(key)
  const answer = applyConfirmKey<string>(CHOICES[question.kind], input, flags)
  if (answer === undefined) return stay(state)
  const closed = { ...state, question: undefined }
  if (answer === "no") return stay(closed)
  switch (question.kind) {
    case "remove-secret":
      return go(closed, { kind: "remove-secret", server: question.server, app: question.app, name: question.name })
    case "update-runner":
      return go(closed, { kind: "update-runner", server: question.server })
    case "remember-folder":
      return go(closed, {
        kind: "deploy-continue",
        server: question.server,
        app: question.app,
        answer: answer === "yes" ? "write-link" : "skip-link",
      })
  }
}

/** An open one-line question: letters type into it, Enter answers it, Esc leaves it. Ctrl-C still quits. */
function onTextQuestion(state: State, key: AppKey): Step {
  if (key.kind === "ctrl-c") return quit(state)
  const screen = top(state)
  const [input, flags] = inputOf(key)
  if (input === "" && !flags.return && !flags.escape && !flags.backspace) return stay(state)

  switch (screen.name) {
    case "welcome": {
      const result = applyTextInput(screen.value, input, flags)
      if (result.kind === "cancelled") return quit(state)
      const name = result.value.trim()
      if (result.kind === "done" && name !== "") {
        return go(replaceTop(state, { ...screen, value: result.value, creating: true }), { kind: "create-key", name })
      }
      return stay(replaceTop(state, { ...screen, value: result.value }))
    }
    case "add-server": {
      const field = screen.step === "destination" ? "destination" : "serverName"
      const result = applyTextInput(screen[field], input, flags)
      if (result.kind === "cancelled") return pop(state)
      const typed = { ...screen, [field]: result.value }
      if (result.kind !== "done" || result.value.trim() === "") return stay(replaceTop(state, typed))
      if (screen.step === "destination") return stay(replaceTop(state, { ...typed, step: "name" }))
      return go(replaceTop(state, { ...typed, step: "working" }), {
        kind: "add-server",
        destination: typed.destination.trim(),
        name: typed.serverName.trim(),
      })
    }
    case "set-secret": {
      const result = applyTextInput(screen.secretName, input, flags)
      if (result.kind === "cancelled") return pop(state)
      const name = result.value.trim()
      if (result.kind === "done" && name !== "") return stay(replaceTop(state, { ...screen, secretName: name, question: "value" }))
      return stay(replaceTop(state, { ...screen, secretName: result.value }))
    }
    case "logs": {
      const result = applyTextInput(screen.filter, input, flags)
      if (result.kind === "cancelled") return stay(replaceTop(state, { ...screen, filter: "", filtering: false }))
      return stay(replaceTop(state, { ...screen, filter: result.value, filtering: result.kind !== "done" }))
    }
    default:
      return stay(state)
  }
}

/** The hidden prompt has the keys. Esc closes it as the board's "esc cancel"; Ctrl-C closes the prompt only. */
function onHiddenPrompt(state: State, key: AppKey): Step {
  const screen = top(state)
  if (screen.name !== "set-secret") return stay(state)
  if (key.kind === "ctrl-c") {
    // Back to what was asked before the value, so nothing is lost but the value.
    return stay(replaceTop(state, { ...screen, question: screen.missing.length > 0 ? undefined : "name" }))
  }
  if (key.kind === "escape") return leaveSetSecret(state, screen)
  return stay(state)
}

/** Leaving "set a secret": before a deploy that means going ahead without the missing values. */
function leaveSetSecret(state: State, screen: Extract<Screen, { name: "set-secret" }>): Step {
  if (screen.missing.length === 0) return pop(state)
  return pop(state, { kind: "deploy-continue", server: screen.server, app: screen.app, answer: "skip-values" })
}

function onHome(state: State, screen: Extract<Screen, { name: "home" }>, key: AppKey): Step | undefined {
  const servers = state.team?.servers ?? []
  const server = selectedServer(state, screen)
  const app = selectedApp(state, screen)

  if (key.kind === "left") return stay(replaceTop(state, { ...screen, pane: "servers" }))
  if (key.kind === "right") return stay(replaceTop(state, { ...screen, pane: "apps" }))
  if (key.kind === "tab") return stay(replaceTop(state, { ...screen, pane: screen.pane === "servers" ? "apps" : "servers" }))

  if (key.kind === "up" || key.kind === "down" || key.kind === "enter") {
    if (screen.pane === "servers") {
      // The last row is "+ add a server".
      const moved = applySelectKey(screen.server, servers.length + 1, listKey(key))
      if (moved.kind === "moved") return stay(replaceTop(state, { ...screen, server: moved.index, app: 0 }))
      if (moved.kind === "chosen") {
        if (moved.index === servers.length) return push(state, addServerScreen())
        return stay(replaceTop(state, { ...screen, pane: "apps" }))
      }
      return stay(state)
    }
    const moved = applySelectKey(screen.app, server?.apps.length ?? 0, listKey(key))
    if (moved.kind === "moved") return stay(replaceTop(state, { ...screen, app: moved.index }))
    if (moved.kind === "chosen" && server && app) return openApp(state, server.name, app.name)
    return stay(state)
  }

  if (key.kind !== "text") return undefined
  switch (key.text) {
    case "a":
      return push(state, addServerScreen())
    case "d":
      return server && !state.deploy?.running ? go(state, { kind: "deploy", server: server.name, app: app?.name }) : stay(state)
    case "r":
      return server && app && !state.deploy?.running ? go(state, { kind: "rollback", server: server.name, app: app.name }) : stay(state)
    case "l":
      return server && app ? openLogs(state, server.name, app.name) : stay(state)
    case "s":
      return server && app ? push(state, setSecretScreen(server.name, app.name)) : stay(state)
    case "u":
      return server?.runner?.outdated ? stay({ ...state, question: { kind: "update-runner", server: server.name } }) : stay(state)
  }
  return undefined
}

function onApp(state: State, screen: Extract<Screen, { name: "app" }>, key: AppKey): Step | undefined {
  const view = appViewOf(state, screen)
  const deploys = view?.deploys ?? []
  const secrets = view?.secrets ?? []

  if (key.kind === "left") return stay(replaceTop(state, { ...screen, pane: "deploys" }))
  if (key.kind === "right") return stay(replaceTop(state, { ...screen, pane: "secrets" }))
  if (key.kind === "tab") return stay(replaceTop(state, { ...screen, pane: screen.pane === "deploys" ? "secrets" : "deploys" }))

  if (key.kind === "up" || key.kind === "down" || key.kind === "enter") {
    if (screen.pane === "deploys") {
      const moved = applySelectKey(screen.deploy, deploys.length, listKey(key))
      return moved.kind === "moved" ? stay(replaceTop(state, { ...screen, deploy: moved.index })) : stay(state)
    }
    // The last row is "+ set a secret".
    const moved = applySelectKey(screen.secret, secrets.length + 1, listKey(key))
    if (moved.kind === "moved") return stay(replaceTop(state, { ...screen, secret: moved.index }))
    if (moved.kind === "chosen") {
      const secret = secrets[moved.index]
      // A value is never shown, only set again: Enter on a secret asks for its new value.
      const asking = setSecretScreen(screen.server, screen.app)
      return push(state, secret ? { ...asking, secretName: secret.name, question: "value" } : asking)
    }
    return stay(state)
  }

  if (key.kind !== "text") return undefined
  switch (key.text) {
    case "d":
      return state.deploy?.running ? stay(state) : go(state, { kind: "deploy", server: screen.server, app: screen.app })
    case "r": {
      const selected = deploys[clampIndex(screen.deploy, deploys.length)]
      if (!selected || state.deploy?.running) return stay(state)
      return go(state, { kind: "rollback", server: screen.server, app: screen.app, to: selected.sequence })
    }
    case "l":
      return openLogs(state, screen.server, screen.app)
    case "s":
      return push(state, setSecretScreen(screen.server, screen.app))
    case "x": {
      const secret = screen.pane === "secrets" ? secrets[screen.secret] : undefined
      if (!secret || secret.removed) return stay(state)
      return stay({ ...state, question: { kind: "remove-secret", server: screen.server, app: screen.app, name: secret.name } })
    }
  }
  return undefined
}

function onLogs(state: State, screen: Extract<Screen, { name: "logs" }>, key: AppKey): Step | undefined {
  if (key.kind === "up") {
    return stay(replaceTop(state, { ...screen, scroll: Math.min(screen.scroll + 1, Math.max(screen.lines.length - 1, 0)) }))
  }
  if (key.kind === "down") return stay(replaceTop(state, { ...screen, scroll: Math.max(screen.scroll - 1, 0) }))
  if (key.kind === "escape") return pop(state, { kind: "stop-logs" })
  if (key.kind === "enter") {
    if (!screen.dropped) return stay(state)
    return go(replaceTop(state, { ...screen, dropped: false }), { kind: "logs", server: screen.server, app: screen.app })
  }
  if (key.kind !== "text") return undefined
  if (key.text === "f") return stay(replaceTop(state, { ...screen, following: !screen.following, scroll: 0 }))
  if (key.text === "/") return stay(replaceTop(state, { ...screen, filtering: true }))
  if (key.text === "0") return stay(replaceTop(state, { ...screen, service: undefined }))
  if (/^[1-9]$/.test(key.text)) {
    const service = servicesOf(screen.lines)[Number(key.text) - 1]
    return service ? stay(replaceTop(state, { ...screen, service })) : stay(state)
  }
  return undefined
}

function onSetSecret(state: State, screen: Extract<Screen, { name: "set-secret" }>, key: AppKey): Step | undefined {
  // No question is open here: the hidden prompt was closed with Ctrl-C, before a deploy.
  if (key.kind === "escape") return leaveSetSecret(state, screen)
  if (key.kind === "up" || key.kind === "down") {
    const moved = applySelectKey(screen.at, screen.missing.length, listKey(key))
    return moved.kind === "moved" ? stay(replaceTop(state, { ...screen, at: moved.index })) : stay(state)
  }
  if (key.kind === "enter") return stay(replaceTop(state, { ...screen, question: screen.missing.length > 0 ? "value" : "name" }))
  return undefined
}

/** Keys that work on almost every screen: help, quit and back. */
function onAnyScreen(state: State, screen: Screen, key: AppKey): Step {
  if (key.kind === "ctrl-c" || isText(key, "q")) return quit(state)
  if (screen.name === "profile-error") return stay(state)
  if (isText(key, "?") && screen.name !== "help") return push(state, { name: "help" })
  if (key.kind === "escape") return pop(state)
  return stay(state)
}

function onKey(state: State, key: AppKey): Step {
  if (state.exiting || state.quitting) return stay(state)
  // Below 80 by 24 the screen cannot be seen, so only quitting does anything.
  if (tooSmall(state)) return key.kind === "ctrl-c" || isText(key, "q") ? quit(state) : stay(state)
  if (hiddenPromptOpen(state)) return onHiddenPrompt(state, key)
  if (state.question) return onQuestion(state, state.question, key)
  if (textQuestionOpen(state)) return onTextQuestion(state, key)

  const screen = top(state)
  let step: Step | undefined
  switch (screen.name) {
    case "home":
      step = onHome(state, screen, key)
      break
    case "app":
      step = onApp(state, screen, key)
      break
    case "deploy":
      if (isText(key, "o")) step = stay(replaceTop(state, { ...screen, output: !screen.output }))
      break
    case "add-server":
      if (isText(key, "o")) step = stay(replaceTop(state, { ...screen, output: !screen.output }))
      break
    case "logs":
      step = onLogs(state, screen, key)
      break
    case "set-secret":
      step = onSetSecret(state, screen, key)
      break
    case "welcome":
      // The key is being created: no question is open, so only help and quit do anything.
      break
  }
  return step ?? onAnyScreen(state, screen, key)
}

const addServerScreen = (): Screen => ({ name: "add-server", step: "destination", destination: "", serverName: "", output: false })

const setSecretScreen = (server: string, app: string): Extract<Screen, { name: "set-secret" }> => ({
  name: "set-secret",
  server,
  app,
  missing: [],
  at: 0,
  question: "name",
  secretName: "",
})

const openApp = (state: State, server: string, app: string): Step =>
  push(state, { name: "app", server, app, pane: "deploys", deploy: 0, secret: 0 }, { kind: "open-app", server, app })

const openLogs = (state: State, server: string, app: string): Step =>
  push(
    state,
    { name: "logs", server, app, lines: [], following: true, filter: "", filtering: false, scroll: 0, dropped: false },
    { kind: "logs", server, app }
  )

// ---------------------------------------------------------------------------
// The reducer

/** The next state, and the effects to run, after one event. */
export function update(state: State, event: AppEvent): Step {
  switch (event.type) {
    case "key":
      return onKey(state, event.key)
    case "resize":
      return stay({ ...state, size: { columns: event.columns, rows: event.rows } })
    case "team":
      return stay(clampHome({ ...state, team: event.team }))
    case "team-created":
      // First run, step 2: Home underneath, so leaving "add a server" lands there.
      return stay({
        ...state,
        team: event.team,
        stack: [{ name: "home", pane: "servers", server: 0, app: 0 }, addServerScreen()],
        notice: undefined,
      })
    case "server-added": {
      const next = clampHome({ ...state, team: event.team })
      const back = top(next).name === "add-server" ? pop(next).state : next
      return stay({ ...back, notice: event.notice })
    }
    case "app-view":
      return stay({ ...state, appView: { server: event.server, app: event.app, deploys: event.deploys, secrets: event.secrets } })
    case "notice":
      return stay({ ...state, notice: event.notice })
    case "failed": {
      // The name question and the server's details open again, as they were, for another try.
      const screen = top(state)
      if (screen.name === "welcome" && screen.creating) {
        return stay({ ...replaceTop(state, { ...screen, creating: false }), notice: event.notice })
      }
      if (screen.name === "add-server" && screen.step === "working") {
        return stay({ ...replaceTop(state, { ...screen, step: "destination" }), notice: event.notice })
      }
      return stay({ ...state, notice: event.notice })
    }
    case "runner-line":
      return stay({ ...state, runnerLines: keep(state.runnerLines, [event.line], RUNNER_LINES) })
    case "deploy-started": {
      const deploy: DeployProgress = { server: event.server, app: event.app, lines: [], running: true, since: event.at }
      return push({ ...state, deploy }, { name: "deploy", output: false })
    }
    case "deploy-stage":
      if (!state.deploy) return stay(state)
      return stay({ ...state, deploy: { ...state.deploy, stage: event.stage, sequence: event.sequence, secrets: event.secrets } })
    case "deploy-progress":
      if (!state.deploy) return stay(state)
      return stay({ ...state, deploy: { ...state.deploy, lines: keep(state.deploy.lines, [event.line], DEPLOY_LINES) } })
    case "deploy-ended": {
      if (!state.deploy) return stay(state)
      const ended = { ...state, deploy: { ...state.deploy, running: false, outcome: event.outcome }, notice: event.notice }
      return ended.quitting ? go({ ...ended, exiting: true }, { kind: "exit" }) : stay(ended)
    }
    case "missing-values":
      return push(state, { ...setSecretScreen(event.server, event.app), missing: event.names, question: "value" })
    case "ask-remember-folder":
      return stay({ ...state, question: { kind: "remember-folder", server: event.server, app: event.app, compose: event.compose } })
    case "secret-saved": {
      const screen = top(state)
      if (screen.name !== "set-secret") return stay({ ...state, notice: event.notice })
      // Before a deploy: on to the next missing name, and on to the deploy after the last.
      if (screen.missing.length > 0 && screen.at < screen.missing.length - 1) {
        return stay({ ...replaceTop(state, { ...screen, at: screen.at + 1, question: "value" }), notice: event.notice })
      }
      const step =
        screen.missing.length > 0
          ? pop(state, { kind: "deploy-continue", server: screen.server, app: screen.app, answer: "values-set" })
          : pop(state)
      return { ...step, state: { ...step.state, notice: event.notice } }
    }
    case "secret-refused": {
      const screen = top(state)
      if (screen.name !== "set-secret") return stay({ ...state, notice: event.notice })
      // The prompt opens again, for another try.
      return stay({ ...replaceTop(state, { ...screen, question: "value" }), notice: event.notice })
    }
    case "log-lines":
      return stay(updateScreens(state, "logs", (screen) => ({ ...screen, lines: keep(screen.lines, event.lines, LOG_LINES) })))
    case "logs-dropped":
      return stay(updateScreens(state, "logs", (screen) => ({ ...screen, dropped: true })))
  }
}
