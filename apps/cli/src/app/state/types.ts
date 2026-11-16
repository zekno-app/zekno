/**
 * The app's state (specs/004-cli-app/contracts/app.md): what it knows, the
 * screens it shows, the questions it asks, and the limits on what it keeps
 * in memory. Types and constants only: what changes the state is in the
 * other files of this folder, put together in state.ts.
 */
import type { TeamTrust } from "@workspace/core"

import type { DeployProgress } from "../../shared/deploy"
import type { Notice } from "../../shared/notice"
import type { AppRow, DeployRow, SecretRow } from "../../shared/views"
import type {
  SettingPath,
  Settings,
  SettingsReport,
} from "../../settings/types"

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

/** A server on Home, with its apps (shared/views.ts `AppRow`). */
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
export type RunnerRow = {
  version?: string
  relation: "older" | "same" | "newer"
  missing: "state and logs" | "some" | "nothing"
}

/** The verified team, as the screens show it. `code` is the team code, which servers check. */
export type TeamView = {
  member: string
  version: number
  code?: string
  servers: ServerRow[]
}

/** One line of an app's logs. Its text was cleaned when it arrived (session.ts). */
export type LogLine = { time: string; service: string; line: string }

/** The steps of adding a server, in order (board "Add a server"). */
export const ADD_STEPS = [
  "connect",
  "docker",
  "runner",
  "set_up",
  "added",
] as const
export type AddStepName = (typeof ADD_STEPS)[number]

/** The steps shown for a runner on this machine: there is no SSH, no Docker check and nothing to install. */
export const LOCAL_ADD_STEPS: readonly AddStepName[] = [
  "connect",
  "set_up",
  "added",
]

/** One step of adding a server that has ended. `found`: the runner was already there and was used as it is. */
export type AddStep = {
  state: "done" | "failed"
  detail?: string
  found?: boolean
}

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
export type FirstUse = Linked & {
  member: string
  path: string
  sha256: string
  above?: Above
}

/**
 * How the app starts: the profile has been read and verified, or not
 * (effects/profile.ts `loadStart`). `problem` is why this folder's zekno.json could
 * not be used, shown as a line on Home. `firstUse` is a file signed by the
 * team to ask about. `trust` is the verified team list the file was judged
 * against; it holds no key, and lets a later `d` judge the file again
 * without reading the keychain.
 */
export type Start =
  | {
      kind: "team"
      team: TeamView
      linked?: Linked
      problem?: string
      firstUse?: FirstUse
      trust?: TeamTrust
    }
  | { kind: "no-team" }
  | { kind: "profile-error"; reason: string; folder: string }

// ---------------------------------------------------------------------------
// Screens

export type Screen =
  | { name: "home"; pane: "servers" | "apps"; server: number; app: number }
  | {
      name: "app"
      server: string
      app: string
      pane: "deploys" | "secrets"
      deploy: number
      secret: number
    }
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
  /** An app's settings (specs/010-app-settings, contracts/app-screen.md), opened with `e` on its screen. */
  | {
      name: "settings"
      server: string
      app: string
      /** The service shown, by its place in the file. */
      service: number
      /** The selected row of that service. */
      row: number
      /** The pane shows the settings, or the Compose text they turn into (`c`). */
      showing: "settings" | "compose"
      /** Lines of the Compose text scrolled past. */
      scroll: number
      /** A change of the selected row, while it is open. */
      change?: ScreenChange
    }

export type ScreenName = Screen["name"]

/**
 * A change of one setting on the settings screen (contracts/app-screen.md,
 * "Changing a value"): typing its value, picking it from a list, or asking
 * y/N before it is written. Only what a setting may hold is kept: a secret
 * is a name, never a value.
 */
export type ScreenChange = {
  path: SettingPath
  stage: "typing" | "picking" | "asking"
  /** What is typed so far (typing), or the value picked (picking): the text a write is given. */
  typed: string
  /** The row of the list (picking). */
  pick: number
  /** Why the typed value was refused, drawn under it. */
  reason?: string
  /** Once checked: the value as typed (undefined removes the setting) and how it reads. */
  next?: { value: string | undefined; shown: string }
  /** How the value reads now. */
  now: string
  /**
   * The SHA-256 of the file the change was opened on: a write is refused
   * when the file is no longer those bytes (CS12), whatever was read since.
   */
  sha256: string
  /**
   * When its stage (typing, picking, asking) opened, as the key that opened
   * it was read: keys read before `TYPED_AHEAD_MS` have passed were typed
   * before the question could be on the screen, and answer nothing.
   */
  openedAt?: number
}

/** What the settings screen shows for one app, once read (effects/settings.ts). */
export type SettingsView = {
  server: string
  app: string
  outcome:
    | {
        kind: "read"
        /** Every service with every row of the screen (`screenRows`), marked against the last deploy. */
        report: SettingsReport
        settings: Settings
        sha256: string
        /** The Compose text the settings turn into (`composeText`). */
        compose: string
      }
    /** One sentence in place of the settings: SH1, SH2 or AS6. */
    | { kind: "sentence"; sentence: string }
    /** The file could not be used: its first sentence, and the rest. */
    | { kind: "fault"; first: string; rest: string }
}

/** A question the app asks with a few fixed answers (board "Two questions the app asks"). Their answers are in questions.ts. */
export type Question =
  | { kind: "remove-secret"; server: string; app: string; name: string }
  | { kind: "update-runner"; server: string }
  | { kind: "remember-folder"; server: string; app: string; compose: string }
  /** Esc on the list before a deploy: go ahead without the values in `names`, which are not set? */
  | {
      kind: "skip-values"
      server: string
      app: string
      names: readonly string[]
    }
  /**
   * `d` with an app selected other than the one this folder's accepted
   * zekno.json names (`linked`): deploy the folder to the selected app on the
   * selected server all the same?
   */
  | {
      kind: "deploy-elsewhere"
      server: string
      app: string
      linked: { server: string; app: string }
    }
  /**
   * When the app opens in a folder whose zekno.json is signed by the team
   * (`member` signed it) and was not used in this folder on this machine:
   * use it here? `above`: the file is in a folder above, named in the question.
   */
  | {
      kind: "use-link"
      member: string
      server: string
      app: string
      above?: Above
    }

// ---------------------------------------------------------------------------
// The state

export type State = {
  /** The screens, the one showing last. Never empty. */
  stack: Screen[]
  team?: TeamView
  /** The server and app this folder's zekno.json names. */
  linked?: Linked
  /** Deploys and secrets of the app the app screen shows, once read. */
  appView?: {
    server: string
    app: string
    deploys: DeployRow[]
    secrets: SecretRow[]
  }
  /** What the settings screen shows, once read for that app. Names and values that are not secret only. */
  settingsView?: SettingsView
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
