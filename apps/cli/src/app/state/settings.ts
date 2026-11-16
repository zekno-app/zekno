/**
 * The settings screen (specs/010-app-settings, contracts/app-screen.md;
 * board `AppSettings`): opened with `e` on an app's screen, it shows that
 * app's settings from this folder's `zekno.app.json`, service by service.
 * Its keys: `↑↓` move, `enter` change, `tab` services, `d` deploy, `esc`
 * back.
 *
 * This part of the reducer never reads or writes the file: it asks for
 * `read-settings` and `write-setting`, which effects/settings.ts runs, and
 * takes what they report. A change is opened, typed, checked and asked
 * about in settings-change.ts, with the pure checks of settings/.
 */
import { applySelectKey, clampIndex } from "../../ui/parts/select"
import type { SettingRow } from "../../settings/types"
import { AS7 } from "../../settings/words"
import type { AppKey } from "../keys"
import type { EventOf, Effect, Step } from "./events"
import { isText, listKey } from "./input"
import {
  settingsReadOf,
  settingsViewOf,
  top,
  type ReadOutcome,
  type SettingsScreen,
} from "./reading"
import { onChange, openChange } from "./settings-change"
import { go, push, replaceTop, stay, updateScreens } from "./steps"
import type { SettingsView, State } from "./types"

/** The service shown, kept inside the file's services. */
export const serviceAt = (read: ReadOutcome, screen: SettingsScreen): number =>
  clampIndex(screen.service, read.report.services.length)

/** Every row of the service shown. */
export const rowsOf = (
  read: ReadOutcome,
  screen: SettingsScreen
): readonly SettingRow[] =>
  read.report.services[serviceAt(read, screen)]?.rows ?? []

/** `e` on an app's screen: the settings screen of that app, read now, with this machine's last deploy of it. */
export const openSettings = (state: State, server: string, app: string): Step =>
  push(
    // Until the read comes back the pane is empty, never another read's.
    { ...state, settingsView: undefined },
    {
      name: "settings",
      server,
      app,
      service: 0,
      row: 0,
      showing: "settings",
      scroll: 0,
    },
    readAgain(server, app, true)
  )

/** `d`: the same deploy as `d` on the app's screen, and nothing while one runs. */
const deploy = (state: State, screen: SettingsScreen): Step =>
  state.deploy?.running
    ? stay(state)
    : go(state, { kind: "deploy", server: screen.server, app: screen.app })

/**
 * The settings screen's keys. On a sentence in place of the settings only
 * `esc`, `?`, `q` and Ctrl-C do anything; before the read comes back, `d`
 * deploys too. What this part leaves (undefined) is help, quit and back.
 * While a change is open its keys answer it and nothing else does; its
 * typed value is the reducer's text question (`typeSetting`).
 */
export function onSettings(
  state: State,
  screen: SettingsScreen,
  key: AppKey
): Step | undefined {
  if (screen.change) return onChange(state, screen, key)
  const read = settingsReadOf(state, screen)
  if (!read) {
    if (isText(key, "d") && !settingsViewOf(state, screen))
      return deploy(state, screen)
    return undefined
  }

  const rows = rowsOf(read, screen)
  if (key.kind === "up" || key.kind === "down") {
    const moved = applySelectKey(screen.row, rows.length, listKey(key))
    return moved.kind === "moved"
      ? stay(replaceTop(state, { ...screen, row: moved.index }))
      : stay(state)
  }
  if (key.kind === "tab") {
    const count = read.report.services.length
    return stay(
      replaceTop(state, {
        ...screen,
        service: (serviceAt(read, screen) + 1) % Math.max(count, 1),
        row: 0,
      })
    )
  }
  if (key.kind === "enter") {
    const row = rows[clampIndex(screen.row, rows.length)]
    if (!row) return stay(state)
    // A plain variable or a volume is added with `zekno settings set`; its `none` row says so.
    if ("adding" in row.path)
      return stay({
        ...state,
        notice: { tone: "info", text: AS7(row.path.service, row.path.key) },
      })
    return openChange(state, screen, read, row.path)
  }
  if (isText(key, "d")) return deploy(state, screen)
  return undefined
}

/**
 * The settings as just read. Each settings screen of that app keeps its
 * service and its row number, within what the file holds now; a change
 * that was open is closed when the file can no longer be shown. One that
 * stays open keeps the SHA-256 it was opened on: its write is refused when
 * the file changed since.
 */
export function settingsRead(
  state: State,
  event: EventOf<"settings-read">
): Step {
  const view: SettingsView = {
    server: event.server,
    app: event.app,
    outcome: event.outcome,
  }
  const { outcome } = event
  return stay(
    updateScreens({ ...state, settingsView: view }, "settings", (screen) => {
      if (screen.server !== event.server || screen.app !== event.app)
        return screen
      if (outcome.kind !== "read") return { ...screen, change: undefined }
      const service = clampIndex(screen.service, outcome.report.services.length)
      const rows = outcome.report.services[service]?.rows.length ?? 0
      return { ...screen, service, row: clampIndex(screen.row, rows) }
    })
  )
}

/** Read the settings again; `deployed`: this machine's last deploy of the app too. */
const readAgain = (server: string, app: string, deployed: boolean): Effect => ({
  kind: "read-settings",
  server,
  app,
  deployed,
})

/** A change was written: the file is read again, and shows the new value with its mark. Nothing was deployed. */
export const settingWritten = (
  state: State,
  event: EventOf<"setting-written">
): Step => go(state, readAgain(event.server, event.app, false))

/** A change was refused: the status line says why, and the file is read again as it is now. */
export const settingRefused = (
  state: State,
  event: EventOf<"setting-refused">
): Step =>
  go(
    { ...state, notice: event.notice },
    readAgain(event.server, event.app, false)
  )

/** Every few seconds: what is running on the server, and the file again, as it is now. */
export function settingsTick(state: State): Step {
  const screen = top(state)
  if (screen.name !== "settings") return stay(state)
  return go(
    state,
    { kind: "refresh", server: screen.server },
    readAgain(screen.server, screen.app, false)
  )
}

/** A deploy of an app whose settings screen is open ended: its last deploy is read again, for the marks. */
export function afterDeploy(before: State, step: Step): Step {
  const ended = before.deploy
  if (!ended || step.state.exiting) return step
  const open = step.state.stack.some(
    (screen) =>
      screen.name === "settings" &&
      screen.server === ended.server &&
      screen.app === ended.app
  )
  return open
    ? {
        ...step,
        effects: [...step.effects, readAgain(ended.server, ended.app, true)],
      }
    : step
}
