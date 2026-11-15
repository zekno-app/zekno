/**
 * What goes into the reducer and what comes out of it: the events it takes
 * (keys, the window's size, and what effects/ reports back), the effects it
 * asks for, and a step, the next state with those effects.
 */
import type { DeployStage } from "../../ops/deploy"
import type { RunState } from "../../ops/status"
import type { AppKey } from "../keys"
import type { AddStepName, AppRow, DeployRow, Linked, LogLine, Notice, RunnerRow, SecretRow, State, TeamView } from "./types"

// ---------------------------------------------------------------------------
// Effects: what the reducer asks for. effects/ runs them.

export type Effect =
  | { kind: "exit" }
  | { kind: "create-key"; name: string }
  | { kind: "add-server"; destination: string; name: string }
  | { kind: "open-app"; server: string; app: string }
  /** `app` undefined: the app of the linked folder. */
  | { kind: "deploy"; server: string; app?: string }
  /**
   * Go ahead with the deploy that was waiting on a question, with its answer:
   * write zekno.json or not, the missing values were set or skipped, or deploy
   * a linked folder to the app selected instead of its own.
   */
  | {
      kind: "deploy-continue"
      server: string
      app: string
      answer: "write-link" | "skip-link" | "values-set" | "skip-values" | "deploy-elsewhere"
    }
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
  /**
   * Connect to a server on purpose, where SSH needs an answer (`asks`): SSH
   * may ask, on the terminal handed over, and the session is kept for the
   * reads that follow, as the one opened when the app starts.
   */
  | { kind: "connect"; server: string }
  /** `y` to "use it here?": record this folder's zekno.json, signed by the team, as used here, once it is still what was shown. */
  | { kind: "use-link"; server: string; app: string }

// ---------------------------------------------------------------------------
// Events

export type AppEvent =
  | { type: "key"; key: AppKey }
  | { type: "resize"; columns: number; rows: number }
  | { type: "team"; team: TeamView }
  /** First run: the key was created; next is adding a server. */
  | { type: "team-created"; team: TeamView }
  /** A server was added. `code`, its server code, is said on Home only when its panel was not seen. */
  | { type: "server-added"; team: TeamView; notice: Notice; code?: string }
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
  /**
   * A server answered, or could not be reached and why; and, when it
   * answered, its runner's version. `asks`: it could not be reached because
   * SSH would have had to ask something (`ServerRow.asks`).
   */
  | {
      type: "server-reached"
      server: string
      reachable: boolean
      problem?: string
      asks?: boolean
      runner?: RunnerRow
    }
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
  /** `d` in a linked folder with another app selected than the folder's own (`linked`). */
  | { type: "ask-deploy-elsewhere"; server: string; app: string; linked: { server: string; app: string } }
  /** zekno.json was written: this folder is now linked to that app on that server. */
  | { type: "linked"; linked: Linked }
  /** This folder's zekno.json, signed by the team, was recorded as used here: Home moves to its server and app. */
  | { type: "link-used"; linked: Linked }
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

/** One kind of event, for the part of the reducer that handles it. */
export type EventOf<Type extends AppEvent["type"]> = Extract<AppEvent, { type: Type }>

/** The next state, and the effects to run. */
export type Step = { state: State; effects: Effect[] }
