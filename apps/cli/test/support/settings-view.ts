/**
 * The app's state on the settings screen, for the tests of the screen and
 * its reducer (specs/010-app-settings, contracts/app-screen.md): a team
 * whose server `prod` runs `demo`, its app screen opened, `e` pressed, and
 * the settings read as effects/settings.ts would report them.
 */
import type { AppKey } from "../../src/app/keys"
import type { AppEvent, Effect, Step } from "../../src/app/state/events"
import { initialState, update } from "../../src/app/state/state"
import type { State, TeamView } from "../../src/app/state/types"
import { healthOf } from "../../src/domains/routes"
import { MADE_AT_DEPLOY } from "../../src/ops/settings-build"
import { composeText } from "../../src/settings/compose"
import { removedServices, screenRows } from "../../src/settings/rows"
import type { Settings } from "../../src/settings/types"
import { DESIGN_SETTINGS } from "./settings-files"

/** The board's team: demo on prod, running, deploy 4. */
export const SETTINGS_TEAM: TeamView = {
  member: "ada",
  version: 2,
  servers: [
    {
      name: "prod",
      destination: "deploy@203.0.113.7",
      reachable: true,
      apps: [
        {
          name: "demo",
          deploy: 4,
          state: "running",
          outcome: "started",
          accepted: 4,
        },
        { name: "api", deploy: 12, state: "running", outcome: "started" },
      ],
    },
  ],
}

/** A key press, as the reducer sees it. */
export const key = (k: AppKey): AppEvent => ({ type: "key", key: k })
export const text = (value: string): AppEvent =>
  key({ kind: "text", text: value })
export const K = {
  up: key({ kind: "up" }),
  down: key({ kind: "down" }),
  tab: key({ kind: "tab" }),
  enter: key({ kind: "enter" }),
  esc: key({ kind: "escape" }),
  backspace: key({ kind: "backspace" }),
  ctrlC: key({ kind: "ctrl-c" }),
  right: key({ kind: "right" }),
}

/** Each character as its own key press, as a person types. */
export const typing = (value: string): AppEvent[] => [...value].map(text)

/** Plays events in order: the last state, and every effect asked for. */
export function play(state: State, ...events: AppEvent[]): Step {
  let step: Step = { state, effects: [] }
  for (const event of events) {
    const next = update(step.state, event)
    step = { state: next.state, effects: [...step.effects, ...next.effects] }
  }
  return step
}
export const effectsOf = (state: State, ...events: AppEvent[]): Effect[] =>
  play(state, ...events).effects

/** The settings of design.md's file with web's memory at `memory`: what was deployed before it was changed to 1g. */
export const withMemory = (settings: Settings, memory: string): Settings => ({
  version: 1,
  services: settings.services.map(([name, service]) =>
    name === "web" ? [name, { ...service, memory }] : [name, service]
  ),
})

/** What effects/settings.ts reports for `settings` read from `file`, marked against `deployed`. */
export function settingsRead(
  settings: Settings,
  options: {
    deployed?: Settings
    sha256?: string
    file?: string
    server?: string
    app?: string
  } = {}
): AppEvent {
  const removed = removedServices(settings, options.deployed)
  return {
    type: "settings-read",
    server: options.server ?? "prod",
    app: options.app ?? "demo",
    outcome: {
      kind: "read",
      report: {
        app: options.app ?? "demo",
        file: options.file ?? "zekno.app.json",
        services: settings.services.map((service) => ({
          name: service[0],
          rows: screenRows(
            service,
            options.deployed,
            healthOf(settings)?.timeout
          ),
        })),
        ...(removed.length > 0 ? { removed } : {}),
      },
      settings,
      sha256: options.sha256 ?? "a".repeat(64),
      compose: composeText(settings, builtNames(settings, options.app)),
    },
  }
}

/** A built service's image in the Compose text, as effects/settings.ts names it: the placeholder of a key made at deploy (specs/016-build-from-source). */
const builtNames = (settings: Settings, app = "demo") =>
  new Map(
    settings.services.flatMap(([name, service]) =>
      service.build === undefined
        ? []
        : [[name, `zekno.invalid/${app}:${MADE_AT_DEPLOY}`] as const]
    )
  )

/** The board `AppSettings`: design.md's file, with the memory changed since deploy 4 from 512m. */
export const BOARD_READ = settingsRead(DESIGN_SETTINGS, {
  deployed: withMemory(DESIGN_SETTINGS, "512m"),
})

/** The app screen of demo on prod, with its deploys read. */
export function onApp(size = { columns: 100, rows: 30 }): State {
  return play(
    initialState({ kind: "team", team: SETTINGS_TEAM }, size),
    K.right,
    K.enter,
    {
      type: "app-view",
      server: "prod",
      app: "demo",
      deploys: [
        { sequence: 4, outcome: "started", at: "2026-11-16T09:00:00Z" },
      ],
      secrets: [],
    }
  ).state
}

/** The settings screen of demo, opened with `e`, before its read came back. */
export const opened = (size = { columns: 100, rows: 30 }): State =>
  play(onApp(size), text("e")).state

/** The settings screen as on the board `AppSettings`, the memory row selected. */
export const onBoard = (size = { columns: 100, rows: 30 }): State =>
  play(opened(size), BOARD_READ, K.down, K.down, K.down).state
