/**
 * The app's state (specs/004-cli-app/contracts/app.md): what it knows, the
 * screens it shows, the questions it asks, and the limits on what it keeps
 * in memory. Types and constants only: what changes the state is in the
 * other files of this folder, put together in state.ts.
 */
import type { TeamTrust } from "@workspace/core"

import type { DeployStage } from "../../ops/deploy"
import type { RunState } from "../../ops/status"

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
   * Not reached because SSH would have had to ask something (a password, a
   * passphrase, a host key), as SSH's own closing line said. It is not read
   * in the background again until the person connects to it on purpose:
   * `enter` on it on Home.
   */
  asks?: boolean
  /** The runner's version and how it stands to the one this CLI carries. Undefined until it answered. */
  runner?: RunnerRow
  apps: AppRow[]
}

/**
 * A server's runner as Home shows it (contracts/versions.md, "The app"):
 * its version, undefined for a runner that does not report one; whether it
 * is older than the one this CLI carries, the same or newer; and, for an
 * older one, what needs it updated (ops/server.ts `RunnerRelation`).
 */
export type RunnerRow = { version?: string; relation: "older" | "same" | "newer"; missing: "state and logs" | "some" | "nothing" }

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
 * A zekno.json in a folder above the one the app was started in: that
 * folder, and the Compose file the file names, as the question shows them.
 */
export type Above = { folder: string; compose: string }

/**
 * A zekno.json signed by the team that has not been used in this folder on
 * this machine: who signed it (cleaned) and what it names, for the question
 * asked when the app opens, with its folder and Compose file when it is in a
 * folder above (`above`); and the file as it was judged, its real path and
 * the SHA-256 of its bytes, so that a "yes" records only what was shown.
 */
export type FirstUse = Linked & { member: string; path: string; sha256: string; above?: Above }

/**
 * How the app starts: the profile has been read and verified, or not
 * (effects.ts `loadStart`). `problem` is why this folder's zekno.json could
 * not be used, shown as a line on Home. `firstUse` is a file signed by the
 * team to ask about. `trust` is the verified team list the file was judged
 * against; it holds no key, and lets a later `d` judge the file again
 * without reading the keychain.
 */
export type Start =
  | { kind: "team"; team: TeamView; linked?: Linked; problem?: string; firstUse?: FirstUse; trust?: TeamTrust }
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
      /** `done`: the server was added; the screen shows its code until enter or esc. */
      step: "destination" | "name" | "working" | "done"
      destination: string
      serverName: string
      output: boolean
      /** Step 2 of first run: the header shows the three steps. */
      firstRun?: boolean
      /** Once it is done: the line Home shows when the screen is left. */
      added?: Notice
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

/** A question the app asks with a few fixed answers (board "Two questions the app asks"). Their answers are in questions.ts. */
export type Question =
  | { kind: "remove-secret"; server: string; app: string; name: string }
  | { kind: "update-runner"; server: string }
  | { kind: "remember-folder"; server: string; app: string; compose: string }
  /** Esc on the list before a deploy: go ahead without the values in `names`, which are not set? */
  | { kind: "skip-values"; server: string; app: string; names: readonly string[] }
  /**
   * `d` with an app selected other than the one this folder's accepted
   * zekno.json names (`linked`): deploy the folder to the selected app on the
   * selected server all the same?
   */
  | { kind: "deploy-elsewhere"; server: string; app: string; linked: { server: string; app: string } }
  /**
   * When the app opens in a folder whose zekno.json is signed by the team
   * (`member` signed it) and was not used in this folder on this machine:
   * use it here? `above`: the file is in a folder above, named in the question.
   */
  | { kind: "use-link"; member: string; server: string; app: string; above?: Above }

// ---------------------------------------------------------------------------
// The state

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
