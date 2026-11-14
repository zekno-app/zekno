/**
 * The app's state and what every key does on every screen
 * (specs/004-cli-app/contracts/app.md), as one pure function: an event in,
 * the next state and the effects to run out. Nothing here touches the
 * terminal, a file or a server; effects.ts does that and reports back with
 * more events. That is what lets every key be tested without a terminal.
 *
 * A hidden value (a secret being typed) never enters this state. While the
 * hidden prompt is open the reducer only knows that it is open: the keys go
 * to the prompt, and only Esc and Ctrl-C close it. Closing it never signs or
 * sends anything: before a deploy it returns to the list of missing values,
 * where going ahead without them is a question of its own.
 */
import { isReservedSecretName } from "@workspace/core"

import type { DeployStage } from "../ops/deploy"
import type { RunState } from "../ops/status"
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
/**
 * The most of one log line the app keeps: far wider than any terminal, so
 * nothing that could be drawn is lost, while 2000 lines of the runner's
 * longest (16384 characters) cannot take hundreds of megabytes.
 */
export const LOG_TEXT_KEPT = 4096
/** How often Home and the app screen read what is running (contracts/app.md, "Refresh"). */
export const REFRESH_MS = 5000
/** What runners and SSH wrote on standard error, kept for showing on request. */
export const RUNNER_LINES = 200

// ---------------------------------------------------------------------------
// What the app knows

/** Whether an app's services are running, as the runner last said (ops/status.ts). */
export type { RunState }

/**
 * One app on Home. The deploy number, time, result, signer and secret count
 * are those of the latest deploy in this machine's history that verifies
 * (views.ts), so they are known even when the server cannot be reached.
 */
export type AppRow = {
  name: string
  deploy?: number
  at?: string
  state: RunState
  outcome?: DeployRow["outcome"]
  /** Who signed the latest deploy. */
  signer?: string
  /** How many secrets the latest deploy carried. */
  secrets?: number
  /** The deploy `r` returns to on Home: the accepted one before the latest. */
  previous?: number
  /**
   * The last deploy its runner accepted, as the runner last said. Undefined
   * until the server answers, and once it cannot be reached: then `deploy`,
   * from this machine's history, is shown instead.
   */
  accepted?: number
}

export type ServerRow = {
  name: string
  /** The SSH destination. Undefined for a runner on this machine. */
  destination?: string
  /** Undefined until it has been asked. */
  reachable?: boolean
  /** Why it could not be reached, as a sentence. */
  problem?: string
  /**
   * The runner's version, and whether it is older than the one this CLI
   * carries. `version` is undefined for a runner from before 0.2.0, which
   * does not say.
   */
  runner?: { version?: string; outdated: boolean }
  apps: AppRow[]
}

/** The verified team, as the screens show it. `code` is the team code, which servers check. */
export type TeamView = { member: string; version: number; code?: string; servers: ServerRow[] }

/** One deploy in an app's history. Everything but `outcome` is read from under the deploy's signature. */
export type DeployRow = {
  sequence: number
  outcome: "sent" | "started" | "start_failed"
  at: string
  signer?: string
  /** The version of the team list it was signed with. */
  teamVersion?: number
  /** Each service of its Compose file, as `web (caddy:2)`. */
  services?: string[]
  secrets?: { name: string; version: number }[]
  /** It ran the same service definition as this earlier deploy, and not the one just before it. */
  rollbackTo?: number
}
export type SecretRow = {
  name: string
  version: number
  removed: boolean
  /** Set or removed after the latest deploy the runner accepted: it takes effect on the next deploy. */
  afterDeploy?: boolean
}
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
  /** When it ended, in milliseconds. */
  endedAt?: number
  /** Where the service definition comes from: a file, or an earlier deploy. */
  from?: string
  /** The deploy it takes over from, when there was one. */
  replaces?: number
  /** The names of the secrets it carries. */
  secretNames?: string[]
  /** The line that says how it ended. */
  result?: Notice
}

/** The steps of adding a server, in order (board "Add a server"). */
export const ADD_STEPS = ["connect", "docker", "runner", "set_up", "added"] as const
export type AddStepName = (typeof ADD_STEPS)[number]

/** The steps shown for a runner on this machine: there is no SSH, no Docker check and nothing to install. */
export const LOCAL_ADD_STEPS: readonly AddStepName[] = ["connect", "set_up", "added"]

/** One step of adding a server that has ended. `found`: the runner was already there and was used as it is. */
export type AddStep = { state: "done" | "failed"; detail?: string; found?: boolean }

/** Adding a server, started from the app. Kept until another one starts. */
export type AddProgress = {
  /** As typed, once it was found valid; "this machine" for a runner here. */
  destination: string
  name: string
  /** A runner on this machine: no SSH, no Docker check, nothing to install. */
  local: boolean
  steps: Partial<Record<AddStepName, AddStep>>
  /** Derived on this machine from the key the server sent, once setup finished. */
  serverCode?: string
  /** What the installer, SSH and the runner printed on standard error, cleaned, the last `RUNNER_LINES`. */
  lines: string[]
  running: boolean
}

/** What this folder's zekno.json names: a server of the team, an app, and the Compose file as the file names it. */
export type Linked = { server: string; app: string; compose?: string }

/**
 * How the app starts: the profile has been read and verified, or not
 * (effects.ts `loadStart`). `problem` is why this folder's zekno.json could
 * not be used, shown as a line on Home.
 */
export type Start =
  | { kind: "team"; team: TeamView; linked?: Linked; problem?: string }
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
      /** The connection dropped, or the logs ended; Enter reconnects. */
      dropped: boolean
      /** Why, as a sentence, once it dropped. */
      problem?: string
    }
  | { name: "welcome"; value: string; creating: boolean }
  | {
      name: "add-server"
      step: "destination" | "name" | "working"
      destination: string
      serverName: string
      output: boolean
      /** Step 2 of first run: the header shows the three steps. */
      firstRun?: boolean
    }
  | {
      name: "set-secret"
      server: string
      app: string
      /** Names the Compose file expects that have no secret, before a deploy. Empty when opened with `s`. */
      missing: readonly string[]
      /** Those of `missing` set since the list opened. */
      done: readonly string[]
      /** The Compose file that expects them, as the list names it. */
      file?: string
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
  /** Esc on the list before a deploy: go ahead without the values in `names`, which are not set? */
  | { kind: "skip-values"; server: string; app: string; names: readonly string[] }

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
  // Esc answers no as well (`onQuestion`): it never deploys.
  "skip-values": [
    { key: "y", answer: "yes", does: "deploy" },
    { key: "n", answer: "no", does: "do not deploy" },
  ],
} as const satisfies Record<Question["kind"], readonly Choice<string>[]>

/** Said when a deploy that waited on the list of missing values was not made. */
export const NOT_DEPLOYED = "Nothing was deployed."

/** The question esc on that list asks: deploy without the values not set yet? */
export function skipValuesTitle(question: Extract<Question, { kind: "skip-values" }>): string {
  const without = question.names.length === 1 ? question.names[0]! : `${question.names.length} values`
  return `Deploy ${question.app} to ${question.server} without ${without}?`
}

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
  /**
   * Read again what is running and whether the servers answer, in the
   * background: on every server for Home, on one for the app screen.
   */
  | { kind: "refresh"; server?: string }
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
  /**
   * An effect failed with a reason a person can act on. What was waiting for
   * it can be tried again. `from` names the effect when it was adding a
   * server, whose progress then marks where it stopped.
   */
  | { type: "failed"; notice: Notice; from?: "add-server" }
  /** A line a runner or SSH wrote on standard error, already cleaned. */
  | { type: "runner-line"; line: string }
  /** A server answered, or could not be reached and why; and, when it answered, its runner's version. */
  | { type: "server-reached"; server: string; reachable: boolean; problem?: string; runner?: { version?: string; outdated: boolean } }
  /** Adding a server began: its details were found valid. */
  | { type: "add-started"; destination: string; name: string; local: boolean }
  /** A step of adding a server ended. */
  | { type: "add-step"; step: AddStepName; detail?: string; found?: boolean }
  /** The server code, once setup finished. */
  | { type: "add-code"; code: string }
  /** A line the installer, SSH or the runner printed while a server was being added, already cleaned. */
  | { type: "add-line"; line: string }
  /** One server's apps, read again from this machine's history. */
  | { type: "server-apps"; server: string; apps: AppRow[] }
  | {
      type: "deploy-started"
      server: string
      app: string
      at: number
      from?: string
      replaces?: number
      secretNames?: string[]
    }
  | { type: "deploy-stage"; stage: DeployStage; sequence: number; secrets: number }
  /** Docker's lines during the deploy, cleaned, in the order it printed them. */
  | { type: "deploy-progress"; lines: readonly string[] }
  | { type: "deploy-ended"; outcome: "started" | "start_failed" | "error"; notice: Notice; at?: number }
  /** Before a deploy: names the Compose file `file` expects that have no secret. */
  | { type: "missing-values"; server: string; app: string; names: string[]; file?: string }
  /** Before the first deploy of a folder that is not linked. */
  | { type: "ask-remember-folder"; server: string; app: string; compose: string }
  /** zekno.json was written: this folder is now linked to that app on that server. */
  | { type: "linked"; linked: Linked }
  /** The hidden prompt stored a value, or refused one; it is closed either way. */
  | { type: "secret-saved"; notice: Notice }
  | { type: "secret-refused"; notice: Notice }
  /**
   * What is running on one server's apps, and the last deploy of each that
   * it accepted, as its runner said. An app it does not name is unknown.
   */
  | { type: "app-states"; server: string; states: Record<string, RunState>; accepted?: Record<string, number> }
  /** Every `REFRESH_MS` while the app is open: Home and the app screen read again what is running. */
  | { type: "tick" }
  /** Lines of the logs being followed, cleaned. `fresh`: the first of a new connection, which replace what was there. */
  | { type: "log-lines"; lines: LogLine[]; fresh?: boolean }
  /** The logs stopped coming: the connection dropped, or Docker's log command ended. */
  | { type: "logs-dropped"; problem?: string }

export type State = {
  /** The screens, the one showing last. Never empty. */
  stack: Screen[]
  team?: TeamView
  /** The server and app this folder's zekno.json names. */
  linked?: Linked
  /** Deploys and secrets of the app the app screen shows, once read. */
  appView?: { server: string; app: string; deploys: DeployRow[]; secrets: SecretRow[] }
  size: { columns: number; rows: number }
  deploy?: DeployProgress
  /** Adding a server started from the app. */
  adding?: AddProgress
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
  const notice: Notice | undefined = start.problem === undefined ? undefined : { tone: "error", text: start.problem }
  return { ...base, stack: [home], team, linked, notice }
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

type LogsScreen = Extract<Screen, { name: "logs" }>

/**
 * Whether a log line is shown under the screen's choices: its service, when
 * one is chosen, and the filter. The filter is the text the person typed,
 * found anywhere in the line, whatever the case of its letters. It is plain
 * text, never a pattern: no character in it has a meaning of its own.
 */
export function shows(screen: Pick<LogsScreen, "service" | "filter">): (line: LogLine) => boolean {
  const filter = screen.filter.toLowerCase()
  return (line) => (screen.service === undefined || line.service === screen.service) && (filter === "" || line.line.toLowerCase().includes(filter))
}

/** The log lines the screen shows, oldest first. */
export const visibleLines = (screen: LogsScreen): LogLine[] => screen.lines.filter(shows(screen))

/** Lines back from the newest shown, kept inside the lines there are. */
const clampScroll = (scroll: number, count: number): number => Math.max(0, Math.min(scroll, count - 1))

/**
 * Whether what is running may be read again now (contracts/app.md,
 * "Refresh"): only while Home or the app screen is showing and no question
 * of any kind is open, and not below 80 by 24, where nothing is shown.
 */
export function refreshAllowed(state: State): boolean {
  const screen = top(state)
  if (screen.name !== "home" && screen.name !== "app") return false
  if (state.exiting || state.quitting || tooSmall(state)) return false
  return state.question === undefined && !textQuestionOpen(state) && !hiddenPromptOpen(state)
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

/**
 * One server's apps, read again. The app that was selected on Home stays
 * selected, wherever its row moved: a deploy moves its app to the top.
 */
function withApps(state: State, name: string, apps: AppRow[]): State {
  const team = state.team
  const index = team?.servers.findIndex((server) => server.name === name) ?? -1
  if (!team || index === -1) return state
  const before = team.servers[index]!.apps
  // The history does not say what is running, nor what the runner holds; what the runner last said stays until it is read again.
  const known = apps.map((app) => {
    const was = before.find((row) => row.name === app.name)
    return { ...app, state: was?.state ?? app.state, accepted: was?.accepted }
  })
  const servers = team.servers.map((server, at) => (at === index ? { ...server, apps: known } : server))
  const next = updateScreens({ ...state, team: { ...team, servers } }, "home", (screen) => {
    if (screen.server !== index) return screen
    const moved = known.findIndex((app) => app.name === before[screen.app]?.name)
    return moved === -1 ? screen : { ...screen, app: moved }
  })
  return clampHome(next)
}

/** Changes each of one server's apps. Nothing else changes, the selection included. */
function withAppRows(state: State, name: string, change: (app: AppRow) => AppRow): State {
  const team = state.team
  if (!team?.servers.some((server) => server.name === name)) return state
  const servers = team.servers.map((server) => (server.name === name ? { ...server, apps: server.apps.map(change) } : server))
  return { ...state, team: { ...team, servers } }
}

/** Only the record's own entries count, never something an object has by default, such as `constructor`. */
const own = <T>(record: Record<string, T> | undefined, key: string): T | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined

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
  const answer = applyConfirmKey<string>(CHOICES[question.kind], input, flags) ?? (question.kind === "skip-values" && flags.escape ? "no" : undefined)
  if (answer === undefined) return stay(state)
  const closed = { ...state, question: undefined }
  if (question.kind === "skip-values") return skipValues(closed, question, answer === "yes")
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

/**
 * The answer to "deploy without them?": yes goes on with the deploy without
 * the values not set; no ends it, with nothing signed, back on the screen `d`
 * was pressed on.
 */
function skipValues(state: State, question: Extract<Question, { kind: "skip-values" }>, yes: boolean): Step {
  const screen = top(state)
  if (screen.name !== "set-secret" || screen.server !== question.server || screen.app !== question.app) return stay(state)
  if (yes) return pop(state, { kind: "deploy-continue", server: question.server, app: question.app, answer: "skip-values" })
  const back = pop(state)
  return { ...back, state: { ...back.state, notice: { tone: "info", text: NOT_DEPLOYED } } }
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
      if (result.kind === "done" && name !== "") {
        // A name that cannot be stored is said now, before anyone types a value for it.
        const problem = secretNameProblem(name)
        if (problem) return stay({ ...replaceTop(state, { ...screen, secretName: name }), notice: { tone: "error", text: problem } })
        return stay(replaceTop(state, { ...screen, secretName: name, question: "value" }))
      }
      return stay(replaceTop(state, { ...screen, secretName: result.value }))
    }
    case "logs": {
      const result = applyTextInput(screen.filter, input, flags)
      if (result.kind === "cancelled") return stay(replaceTop(state, { ...screen, filter: "", filtering: false, scroll: 0 }))
      const scroll = result.value === screen.filter ? screen.scroll : 0
      return stay(replaceTop(state, { ...screen, filter: result.value, filtering: result.kind !== "done", scroll }))
    }
    default:
      return stay(state)
  }
}

/**
 * The hidden prompt has the keys. Esc is the board's "esc cancel": it
 * cancels setting the secret, and before a deploy it closes the prompt only,
 * back to the list, so nothing is ever signed by it. Ctrl-C closes the
 * prompt only.
 */
function onHiddenPrompt(state: State, key: AppKey): Step {
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
        if (moved.index === servers.length) return openAddServer(state)
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
      return openAddServer(state)
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

/**
 * The logs screen. `↑` and `↓` scroll through the lines shown, never past
 * the ends. `f` pauses where the view is, and resuming goes back to the
 * newest line. Choosing a service, or changing the filter, shows the newest
 * of the lines that then match.
 */
function onLogs(state: State, screen: LogsScreen, key: AppKey): Step | undefined {
  if (key.kind === "up") {
    return stay(replaceTop(state, { ...screen, scroll: clampScroll(screen.scroll + 1, visibleLines(screen).length) }))
  }
  if (key.kind === "down") return stay(replaceTop(state, { ...screen, scroll: Math.max(screen.scroll - 1, 0) }))
  if (key.kind === "escape") return pop(state, { kind: "stop-logs" })
  if (key.kind === "enter") {
    if (!screen.dropped) return stay(state)
    return go(replaceTop(state, { ...screen, dropped: false, problem: undefined }), { kind: "logs", server: screen.server, app: screen.app })
  }
  if (key.kind !== "text") return undefined
  if (key.text === "f") return stay(replaceTop(state, { ...screen, following: !screen.following, scroll: screen.following ? screen.scroll : 0 }))
  if (key.text === "/") return stay(replaceTop(state, { ...screen, filtering: true }))
  if (key.text === "0") return stay(replaceTop(state, { ...screen, service: undefined, scroll: 0 }))
  if (/^[1-9]$/.test(key.text)) {
    const service = servicesOf(screen.lines)[Number(key.text) - 1]
    return service ? stay(replaceTop(state, { ...screen, service, scroll: 0 })) : stay(state)
  }
  return undefined
}

/**
 * New lines on a logs screen, the oldest let go past `LOG_LINES`. While it
 * follows at the newest line, the view moves on with them. While it is
 * paused, or scrolled back, the view stays on the lines it shows: the scroll
 * grows by the new lines it would show. Lines keep arriving while paused, so
 * past `LOG_LINES` the oldest go even then; once the lines in view have gone
 * the view shows the oldest kept. `fresh` lines, the first of a new
 * connection, replace what was there.
 */
function withLogLines(screen: LogsScreen, added: readonly LogLine[], fresh: boolean): LogsScreen {
  const lines = keep(fresh ? [] : screen.lines, added, LOG_LINES)
  const next = { ...screen, lines }
  const held = !fresh && (!screen.following || screen.scroll > 0)
  const scroll = held ? screen.scroll + added.filter(shows(screen)).length : 0
  return { ...next, scroll: clampScroll(scroll, visibleLines(next).length) }
}

function onSetSecret(state: State, screen: Extract<Screen, { name: "set-secret" }>, key: AppKey): Step | undefined {
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

/** The step adding a server stopped at: the first that had not ended. */
function failAdding(adding: AddProgress): AddProgress {
  const at = (adding.local ? LOCAL_ADD_STEPS : ADD_STEPS).find((step) => !adding.steps[step])
  return { ...adding, running: false, steps: at ? { ...adding.steps, [at]: { state: "failed" } } : adding.steps }
}

/** The core library's rule for a secret name (`secretName` in packages/core/src/secrets.ts). */
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/

/** Why a name cannot be a secret's, in the words `zekno secret set` uses, or undefined when it can. */
export function secretNameProblem(name: string): string | undefined {
  if (!SECRET_NAME.test(name)) return "A secret name uses letters, digits and underscore, and does not start with a digit."
  if (isReservedSecretName(name)) return `"${name}" is reserved: the runner uses it to start Docker. Choose another name.`
  return undefined
}

const addServerScreen = (firstRun = false): Extract<Screen, { name: "add-server" }> => ({
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
function openAddServer(state: State): Step {
  const adding = state.adding
  if (adding?.running) {
    return push(state, { ...addServerScreen(), step: "working", destination: adding.destination, serverName: adding.name })
  }
  return push({ ...state, adding: undefined }, addServerScreen())
}

/** The first of `missing` after `at`, going round to the start, that is not done; undefined when all are. */
function nextUnset(missing: readonly string[], done: readonly string[], at: number): number | undefined {
  for (let step = 1; step <= missing.length; step++) {
    const index = (at + step) % missing.length
    if (!done.includes(missing[index]!)) return index
  }
  return undefined
}

const setSecretScreen = (server: string, app: string): Extract<Screen, { name: "set-secret" }> => ({
  name: "set-secret",
  server,
  app,
  missing: [],
  done: [],
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
        stack: [{ name: "home", pane: "servers", server: 0, app: 0 }, addServerScreen(true)],
        notice: undefined,
      })
    case "server-added": {
      const adding = state.adding ? { ...state.adding, running: false } : undefined
      const next = clampHome({ ...state, team: event.team, adding })
      const back = top(next).name === "add-server" ? pop(next).state : next
      // The new server is selected on Home.
      const index = event.team.servers.length - 1
      const selected = updateScreens(back, "home", (screen) => (index >= 0 ? { ...screen, pane: "servers", server: index, app: 0 } : screen))
      return stay({ ...selected, notice: event.notice })
    }
    case "add-started":
      // A line about an earlier attempt would now be about the wrong one.
      return stay({
        ...state,
        notice: undefined,
        adding: { destination: event.destination, name: event.name, local: event.local, steps: {}, lines: [], running: true },
      })
    case "add-step":
      if (!state.adding) return stay(state)
      return stay({
        ...state,
        adding: {
          ...state.adding,
          steps: { ...state.adding.steps, [event.step]: { state: "done", detail: event.detail, found: event.found } },
        },
      })
    case "add-code":
      return state.adding ? stay({ ...state, adding: { ...state.adding, serverCode: event.code } }) : stay(state)
    case "add-line":
      return state.adding ? stay({ ...state, adding: { ...state.adding, lines: keep(state.adding.lines, [event.line], RUNNER_LINES) } }) : stay(state)
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
      // The step it stopped at is marked, and stays in view under the questions.
      const adding = event.from === "add-server" && state.adding?.running ? failAdding(state.adding) : state.adding
      if (screen.name === "add-server" && screen.step === "working") {
        return stay({ ...replaceTop({ ...state, adding }, { ...screen, step: "destination" }), notice: event.notice })
      }
      return stay({ ...state, adding, notice: event.notice })
    }
    case "runner-line":
      return stay({ ...state, runnerLines: keep(state.runnerLines, [event.line], RUNNER_LINES) })
    case "server-reached": {
      if (!state.team) return stay(state)
      const reached = (server: ServerRow): ServerRow => {
        if (server.name !== event.server) return server
        const next: ServerRow = { ...server, reachable: event.reachable, problem: event.reachable ? undefined : event.problem }
        // A server that cannot be reached has a runner nobody can tell the version of now, and apps whose state is not known:
        // their deploy numbers are this machine's again.
        if (!event.reachable) return { ...next, runner: undefined, apps: server.apps.map((app) => ({ ...app, state: "unknown", accepted: undefined })) }
        return event.runner ? { ...next, runner: event.runner } : next
      }
      return stay({ ...state, team: { ...state.team, servers: state.team.servers.map(reached) } })
    }
    case "server-apps":
      return stay(withApps(state, event.server, event.apps))
    case "deploy-started": {
      const deploy: DeployProgress = {
        server: event.server,
        app: event.app,
        lines: [],
        running: true,
        since: event.at,
        from: event.from,
        replaces: event.replaces,
        secretNames: event.secretNames,
      }
      return push({ ...state, deploy }, { name: "deploy", output: false })
    }
    case "deploy-stage":
      if (!state.deploy) return stay(state)
      return stay({ ...state, deploy: { ...state.deploy, stage: event.stage, sequence: event.sequence, secrets: event.secrets } })
    case "deploy-progress":
      if (!state.deploy) return stay(state)
      return stay({ ...state, deploy: { ...state.deploy, lines: keep(state.deploy.lines, event.lines, DEPLOY_LINES) } })
    case "deploy-ended": {
      if (!state.deploy) return stay(state)
      const { server, app, sequence } = state.deploy
      const deploy = { ...state.deploy, running: false, outcome: event.outcome, endedAt: event.at, result: event.notice }
      // The runner just said it accepted this deploy, whether or not the app started.
      const accepted =
        sequence !== undefined && (event.outcome === "started" || event.outcome === "start_failed")
          ? withAppRows(state, server, (row) => (row.name === app ? { ...row, accepted: sequence } : row))
          : state
      const ended = { ...accepted, deploy, notice: event.notice }
      return ended.quitting ? go({ ...ended, exiting: true }, { kind: "exit" }) : stay(ended)
    }
    case "missing-values":
      return push(state, { ...setSecretScreen(event.server, event.app), missing: event.names, file: event.file, question: "value" })
    case "ask-remember-folder":
      return stay({ ...state, question: { kind: "remember-folder", server: event.server, app: event.app, compose: event.compose } })
    case "linked":
      return stay({ ...state, linked: event.linked })
    case "secret-saved": {
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
    case "secret-refused": {
      const screen = top(state)
      if (screen.name !== "set-secret") return stay({ ...state, notice: event.notice })
      // The prompt opens again, for another try.
      return stay({ ...replaceTop(state, { ...screen, question: "value" }), notice: event.notice })
    }
    case "log-lines":
      return stay(updateScreens(state, "logs", (screen) => withLogLines(screen, event.lines, event.fresh === true)))
    case "logs-dropped":
      return stay(updateScreens(state, "logs", (screen) => ({ ...screen, dropped: true, problem: event.problem })))
    case "app-states":
      return stay(withAppRows(state, event.server, (app) => ({ ...app, state: own(event.states, app.name) ?? "unknown", accepted: own(event.accepted, app.name) })))
    case "tick": {
      if (!refreshAllowed(state)) return stay(state)
      const screen = top(state)
      // Home shows every server; the app screen shows one app of one server.
      return go(state, screen.name === "app" ? { kind: "refresh", server: screen.server } : { kind: "refresh" })
    }
  }
}
