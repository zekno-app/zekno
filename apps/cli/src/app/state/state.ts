/**
 * The app's state and what every key does on every screen
 * (specs/004-cli-app/contracts/app.md), as one pure function: an event in,
 * the next state and the effects to run out. Nothing here touches the
 * terminal, a file or a server; effects/ does that and reports back with
 * more events. That is what lets every key be tested without a terminal.
 *
 * This file puts the reducer together: the first state, which part of it a
 * key goes to, and which part handles each event. The parts are the other
 * files of this folder: the types (types.ts, events.ts), reading and
 * changing the state (reading.ts, steps.ts, input.ts), the team as Home
 * shows it (team.ts), one file for each screen (home.ts, app.ts, deploy.ts,
 * logs.ts, welcome.ts, add-server.ts, set-secret.ts), and the questions
 * (questions.ts).
 *
 * A hidden value (a secret being typed) never enters this state. While the
 * hidden prompt is open the reducer only knows that it is open: the keys go
 * to the prompt, and only Esc and Ctrl-C close it (set-secret.ts).
 */
import type { AppKey } from "../keys"
import { addCode, addLine, addStarted, addStep, failAdding, onAddServer, serverAdded, typeAddServer } from "./add-server"
import { onApp } from "./app"
import { deployEnded, deployProgress, deployStage, deployStarted, onDeploy } from "./deploy"
import type { AppEvent, Step } from "./events"
import { onHome } from "./home"
import { inputOf, isText } from "./input"
import { onLogs, typeFilter, withLogLines } from "./logs"
import { askDeployElsewhere, onQuestion } from "./questions"
import { hiddenPromptOpen, refreshAllowed, textQuestionOpen, tooSmall, top } from "./reading"
import { onHiddenPrompt, onSetSecret, secretRefused, secretSaved, setSecretScreen, typeSecretName } from "./set-secret"
import { go, keep, pop, push, quit, replaceTop, stay, updateScreens } from "./steps"
import { appStates, clampHome, serverReached, withApps } from "./team"
import type { Notice } from "../../shared/notice"
import { RUNNER_LINES, type Linked, type Question, type Screen, type Start, type State, type TeamView } from "./types"
import { teamCreated, typeName } from "./welcome"

// ---------------------------------------------------------------------------
// Start

/**
 * Home, on the server and app a linked folder names (contracts/app.md,
 * "Linked folder"); on the first server when there is no link, or it names
 * a server Home does not list.
 */
function homeOn(team: TeamView, linked: Linked | undefined): Extract<Screen, { name: "home" }> {
  const found = team.servers.findIndex((entry) => entry.name === linked?.server)
  const server = Math.max(found, 0)
  const app = found === -1 ? -1 : team.servers[found]!.apps.findIndex((entry) => entry.name === linked?.app)
  return { name: "home", pane: app === -1 ? "servers" : "apps", server, app: Math.max(app, 0) }
}

/**
 * The first screen: Home for a verified team (on the linked server and app),
 * first run, or the profile error. A zekno.json signed by the team that was
 * not used here before is asked about at once, over Home, which is on no app.
 */
export function initialState(start: Start, size: { columns: number; rows: number }): State {
  const base = { size, runnerLines: [], quitting: false, exiting: false }
  if (start.kind === "no-team") return { ...base, stack: [{ name: "welcome", value: "", creating: false }] }
  if (start.kind === "profile-error") {
    return { ...base, stack: [{ name: "profile-error", reason: start.reason, folder: start.folder }] }
  }
  const { team, linked, firstUse } = start
  const notice: Notice | undefined = start.problem === undefined ? undefined : { tone: "error", text: start.problem }
  const question: Question | undefined = firstUse && {
    kind: "use-link",
    member: firstUse.member,
    server: firstUse.server,
    app: firstUse.app,
    ...(firstUse.above ? { above: firstUse.above } : {}),
  }
  return { ...base, stack: [homeOn(team, linked)], team, linked, notice, ...(question ? { question } : {}) }
}

// ---------------------------------------------------------------------------
// Keys

/** An open one-line question: letters type into it, Enter answers it, Esc leaves it. Ctrl-C still quits. */
function onTextQuestion(state: State, key: AppKey): Step {
  if (key.kind === "ctrl-c") return quit(state)
  const screen = top(state)
  const [input, flags] = inputOf(key)
  if (input === "" && !flags.return && !flags.escape && !flags.backspace) return stay(state)

  switch (screen.name) {
    case "welcome":
      return typeName(state, screen, input, flags)
    case "add-server":
      return typeAddServer(state, screen, input, flags)
    case "set-secret":
      return typeSecretName(state, screen, input, flags)
    case "logs":
      return typeFilter(state, screen, input, flags)
    default:
      return stay(state)
  }
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
      step = onDeploy(state, screen, key)
      break
    case "add-server":
      step = onAddServer(state, screen, key)
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
      return teamCreated(state, event)
    case "server-added":
      return serverAdded(state, event)
    case "add-started":
      return addStarted(state, event)
    case "add-step":
      return addStep(state, event)
    case "add-code":
      return addCode(state, event)
    case "add-line":
      return addLine(state, event)
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
    case "server-reached":
      return serverReached(state, event)
    case "server-apps":
      return stay(withApps(state, event.server, event.apps))
    case "deploy-started":
      return deployStarted(state, event)
    case "deploy-stage":
      return deployStage(state, event)
    case "deploy-progress":
      return deployProgress(state, event)
    case "deploy-ended":
      return deployEnded(state, event)
    case "missing-values":
      return push(state, { ...setSecretScreen(event.server, event.app), missing: event.names, file: event.file, question: "value" })
    case "ask-remember-folder":
      return stay({ ...state, question: { kind: "remember-folder", server: event.server, app: event.app, compose: event.compose } })
    case "ask-deploy-elsewhere":
      return askDeployElsewhere(state, event)
    case "linked":
      return stay({ ...state, linked: event.linked })
    case "link-used": {
      // As a linked folder opens: Home on its server and app.
      const team = state.team
      const used = { ...state, linked: event.linked }
      return stay(team ? updateScreens(used, "home", () => homeOn(team, event.linked)) : used)
    }
    case "secret-saved":
      return secretSaved(state, event)
    case "secret-refused":
      return secretRefused(state, event)
    case "log-lines":
      return stay(updateScreens(state, "logs", (screen) => withLogLines(screen, event.lines, event.fresh === true)))
    case "logs-dropped":
      return stay(updateScreens(state, "logs", (screen) => ({ ...screen, dropped: true, problem: event.problem })))
    case "app-states":
      return appStates(state, event)
    case "tick": {
      if (!refreshAllowed(state)) return stay(state)
      const screen = top(state)
      // Home shows every server; the app screen shows one app of one server.
      return go(state, screen.name === "app" ? { kind: "refresh", server: screen.server } : { kind: "refresh" })
    }
  }
}
