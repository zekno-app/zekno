/**
 * The settings screen's reducer (specs/010-app-settings,
 * contracts/app-screen.md, "Keys" and "Tests"; tasks T041): every key in
 * every state, with the reducer only. Nothing here reads a file.
 */
import { describe, expect, test } from "bun:test"

import type { AppEvent } from "../../src/app/state/events"
import { refreshAllowed, top } from "../../src/app/state/reading"
import { update } from "../../src/app/state/state"
import type { State } from "../../src/app/state/types"
import { AS7 } from "../../src/settings/words"
import { DESIGN_SETTINGS } from "../support/settings-files"
import {
  BOARD_READ,
  effectsOf,
  K,
  onApp,
  onBoard,
  opened,
  play,
  settingsRead,
  text,
} from "../support/settings-view"

const settingsScreen = (state: State) => {
  const screen = top(state)
  if (screen.name !== "settings") throw new Error(`on ${screen.name}`)
  return screen
}

/** The rows of design.md's web service, in order: as screenRows gives them. */
const WEB_ROWS = [
  "image",
  "start",
  "restart",
  "memory",
  "cpus",
  "port",
  "published",
  "secrets",
  "plain",
  "uploads",
]

describe("browsing", () => {
  test("e on the app screen pushes the settings screen and asks for its settings and the last deploy", () => {
    const step = play(onApp(), text("e"))
    expect(top(step.state)).toEqual({
      name: "settings",
      server: "prod",
      app: "demo",
      service: 0,
      row: 0,
      showing: "settings",
      scroll: 0,
    })
    expect(step.effects).toEqual([
      { kind: "read-settings", server: "prod", app: "demo", deployed: true },
    ])
    // The app screen is underneath, as it was.
    expect(step.state.stack.at(-2)).toMatchObject({ name: "app", app: "demo" })
  })

  test("e is the app screen's only: it does nothing on Home", () => {
    const home = play(onApp(), K.esc).state
    expect(update(home, text("e"))).toEqual({ state: home, effects: [] })
  })

  test("settings-read sets what the screen shows; a read of another app is kept apart", () => {
    const state = play(opened(), BOARD_READ).state
    expect(state.settingsView).toEqual({
      server: "prod",
      app: "demo",
      outcome: (BOARD_READ as Extract<AppEvent, { type: "settings-read" }>)
        .outcome,
    })
    // A screen opened again starts empty, until its own read comes back.
    const again = play(state, K.esc, text("e")).state
    expect(again.settingsView).toBeUndefined()
  })

  test("↑ ↓ move over the shown service's rows and stop at the ends", () => {
    const read = play(opened(), BOARD_READ).state
    expect(settingsScreen(read).row).toBe(0)
    expect(settingsScreen(play(read, K.up).state).row).toBe(0)
    const downs = WEB_ROWS.map(() => K.down)
    expect(settingsScreen(play(read, ...downs).state).row).toBe(
      WEB_ROWS.length - 1
    )
    expect(settingsScreen(play(read, K.down, K.down, K.up).state).row).toBe(1)
  })

  test("tab shows the next service from its first row, and after the last the first", () => {
    const read = play(opened(), BOARD_READ, K.down, K.down).state
    const worker = play(read, K.tab).state
    expect(settingsScreen(worker)).toMatchObject({ service: 1, row: 0 })
    expect(settingsScreen(play(worker, K.tab).state)).toMatchObject({
      service: 0,
      row: 0,
    })
    // The worker's rows are its own: image, start, restart, memory, cpus, port, published, secrets, plain none, volumes none.
    const last = play(worker, ...Array.from({ length: 20 }, () => K.down))
    expect(settingsScreen(last.state).row).toBe(9)
  })

  test("d deploys as on the app screen, and nothing while a deploy runs", () => {
    const state = onBoard()
    expect(effectsOf(state, text("d"))).toEqual([
      { kind: "deploy", server: "prod", app: "demo" },
    ])
    expect(effectsOf(onApp(), text("d"))).toEqual(effectsOf(state, text("d")))
    const running = play(state, {
      type: "deploy-started",
      server: "prod",
      app: "demo",
      at: 1000,
    }).state
    const back = play(running, K.esc).state
    expect(top(back).name).toBe("settings")
    expect(update(back, text("d"))).toEqual({ state: back, effects: [] })
  })

  test("esc goes back to the app screen; ? opens help; q and Ctrl-C quit", () => {
    const state = onBoard()
    expect(top(play(state, K.esc).state)).toMatchObject({
      name: "app",
      server: "prod",
      app: "demo",
    })
    expect(top(play(state, text("?")).state)).toEqual({ name: "help" })
    expect(top(play(state, text("?"), K.esc).state).name).toBe("settings")
    for (const quit of [text("q"), K.ctrlC]) {
      const step = play(state, quit)
      expect(step.state.exiting).toBe(true)
      expect(step.effects).toEqual([{ kind: "exit" }])
    }
  })

  test("below 80 by 24 only quitting works, and the screen is as it was when there is room again", () => {
    const small = play(onBoard(), {
      type: "resize",
      columns: 79,
      rows: 24,
    }).state
    for (const event of [K.down, K.up, K.tab, K.enter, K.esc, text("d")])
      expect(update(small, event)).toEqual({ state: small, effects: [] })
    expect(update(small, { type: "tick" })).toEqual({
      state: small,
      effects: [],
    })
    expect(play(small, text("q")).state.exiting).toBe(true)
    const again = play(small, { type: "resize", columns: 80, rows: 24 }).state
    expect(settingsScreen(again)).toEqual(settingsScreen(onBoard()))
  })

  test("the tick reads the server's state and the file again, not the last deploy; nothing while a question is open", () => {
    const state = onBoard()
    expect(refreshAllowed(state)).toBe(true)
    expect(effectsOf(state, { type: "tick" })).toEqual([
      { kind: "refresh", server: "prod" },
      { kind: "read-settings", server: "prod", app: "demo", deployed: false },
    ])
    const asking = play(state, {
      type: "ask-remember-folder",
      server: "prod",
      app: "demo",
      compose: "zekno.app.json",
    }).state
    expect(refreshAllowed(asking)).toBe(false)
    expect(effectsOf(asking, { type: "tick" })).toEqual([])
    // Help over the settings screen reads nothing.
    expect(effectsOf(play(state, text("?")).state, { type: "tick" })).toEqual(
      []
    )
  })

  test("a deploy of this app that ends reads its last deploy again; of another app it does not", () => {
    const state = onBoard()
    const started = (app: string): AppEvent => ({
      type: "deploy-started",
      server: "prod",
      app,
      at: 1000,
    })
    const ended: AppEvent = {
      type: "deploy-ended",
      outcome: "started",
      notice: { tone: "success", text: "demo is live on prod in 3s" },
      at: 4000,
    }
    expect(effectsOf(play(state, started("demo")).state, ended)).toEqual([
      { kind: "read-settings", server: "prod", app: "demo", deployed: true },
    ])
    expect(effectsOf(play(state, started("api")).state, ended)).toEqual([])
    // With no settings screen open, nothing is read.
    expect(effectsOf(play(onApp(), started("demo")).state, ended)).toEqual([])
  })

  test("enter on a none row of plain or of volumes says how to add one, and opens nothing", () => {
    // worker has no plain variable and no volume: its last two rows.
    const worker = play(onBoard(), K.tab).state
    const downs = (n: number) => Array.from({ length: n }, () => K.down)
    const plain = play(worker, ...downs(8), K.enter).state
    expect(plain.notice).toEqual({ tone: "info", text: AS7("worker", "plain") })
    expect(settingsScreen(plain).change).toBeUndefined()
    const volume = play(worker, ...downs(9), K.enter).state
    expect(volume.notice).toEqual({
      tone: "info",
      text: AS7("worker", "volume"),
    })
    expect(AS7("worker", "plain")).toBe(
      "Add one with `zekno settings set worker.plain.<NAME> <value>`."
    )
  })

  test("a file read again keeps the service and the row number, within what it holds now", () => {
    const state = play(onBoard(), K.tab, K.down, K.down).state
    expect(settingsScreen(state)).toMatchObject({ service: 1, row: 2 })
    // The same file again: nothing moves.
    expect(settingsScreen(play(state, BOARD_READ).state)).toMatchObject({
      service: 1,
      row: 2,
    })
    // Only web is left: the service is web's, the row number kept.
    const one = settingsRead({
      version: 1,
      services: [DESIGN_SETTINGS.services[0]!],
    })
    expect(settingsScreen(play(state, one).state)).toMatchObject({
      service: 0,
      row: 2,
    })
  })

  for (const [kind, outcome] of [
    [
      "sentence",
      {
        kind: "sentence",
        sentence:
          "This folder has no settings file. Run zekno settings init to start one.",
      },
    ],
    [
      "fault",
      {
        kind: "fault",
        first: "zekno.app.json could not be read as settings.",
        rest: "web, deploy.memory: use a size such as 512m or 1g.",
      },
    ],
  ] as const) {
    test(`on a ${kind} only esc, ?, q and Ctrl-C do anything`, () => {
      const state = play(opened(), {
        type: "settings-read",
        server: "prod",
        app: "demo",
        outcome,
      }).state
      for (const event of [
        K.up,
        K.down,
        K.tab,
        K.enter,
        K.backspace,
        text("d"),
        text("c"),
        text("e"),
        text("y"),
      ])
        expect(update(state, event)).toEqual({ state, effects: [] })
      expect(top(play(state, K.esc).state).name).toBe("app")
      expect(top(play(state, text("?")).state).name).toBe("help")
      expect(play(state, text("q")).state.exiting).toBe(true)
      expect(play(state, K.ctrlC).state.exiting).toBe(true)
    })
  }

  test("before the read comes back, d deploys and the keys that move do nothing", () => {
    const state = opened()
    expect(effectsOf(state, text("d"))).toEqual([
      { kind: "deploy", server: "prod", app: "demo" },
    ])
    for (const event of [K.up, K.down, K.tab, K.enter])
      expect(update(state, event)).toEqual({ state, effects: [] })
  })
})
