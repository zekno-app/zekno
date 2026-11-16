/**
 * The settings screen's reducer (specs/010-app-settings,
 * contracts/app-screen.md, "Keys", "Changing a value" and "Tests"; tasks
 * T041, T055 and T063): every key in every state, with the reducer only.
 * Nothing here reads a file. It is one file, longer than most, on purpose:
 * the tasks name it, and every key of the contract's table is read against
 * it in one pass.
 */
import { describe, expect, test } from "bun:test"

import type { AppEvent } from "../../src/app/state/events"
import {
  refreshAllowed,
  textQuestionOpen,
  top,
} from "../../src/app/state/reading"
import { update } from "../../src/app/state/state"
import type { State } from "../../src/app/state/types"
import type { Settings } from "../../src/settings/types"
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
  typing,
  withMemory,
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

  test("d deploys as on the app screen, with the SHA-256 of the file the screen shows; nothing while a deploy runs", () => {
    const state = onBoard()
    // The file the screen shows, by its bytes: a file read with other ones is not deployed (security review, needs validation).
    expect(effectsOf(state, text("d"))).toEqual([
      { kind: "deploy", server: "prod", app: "demo", shown: "a".repeat(64) },
    ])
    // The app's own screen shows no settings, and carries none.
    expect(effectsOf(onApp(), text("d"))).toEqual([
      { kind: "deploy", server: "prod", app: "demo" },
    ])
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
    // Drawn as every line of the app is at a terminal: the command without its backticks (the walkthrough's rough edge).
    const plain = play(worker, ...downs(8), K.enter).state
    expect(plain.notice).toEqual({
      tone: "info",
      text: "Add one with zekno settings set worker.plain.<NAME> <value>.",
    })
    expect(settingsScreen(plain).change).toBeUndefined()
    const volume = play(worker, ...downs(9), K.enter).state
    expect(volume.notice).toEqual({
      tone: "info",
      text: "Add one with zekno settings set worker.volumes.<name> <path>.",
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

/** The SHA-256 the file was read with, as the effect reports it. */
const SHA = "b".repeat(64)

/** Backspace `n` times. */
const erase = (n: number): AppEvent[] =>
  Array.from({ length: n }, () => K.backspace)
/** Down `n` times. */
const downs = (n: number): AppEvent[] => Array.from({ length: n }, () => K.down)

/** On row `row` of web (0 is the image), design.md's file with web's memory at 512m unless other settings are given. */
const onRow = (row: number, settings?: Settings) =>
  play(
    opened(),
    settingsRead(settings ?? withMemory(DESIGN_SETTINGS, "512m"), {
      sha256: SHA,
    }),
    ...downs(row)
  ).state
const onMemory = () => onRow(3)
/** Typed into the memory: emptied, then `value`, then enter. */
const memoryTyped = (value: string) =>
  play(onMemory(), K.enter, ...erase(4), ...typing(value), K.enter)

describe("changing", () => {
  test("enter opens the value to type, filled in; restart opens the list, on the current rule", () => {
    const open = play(onMemory(), K.enter).state
    expect(settingsScreen(open).change).toEqual({
      path: { service: "web", key: "memory" },
      stage: "typing",
      typed: "512m",
      pick: 0,
      now: "512m",
      sha256: SHA,
    })
    expect(textQuestionOpen(open)).toBe(true)
    const picking = play(onRow(2), K.enter).state
    expect(settingsScreen(picking).change).toMatchObject({
      path: { service: "web", key: "restart" },
      stage: "picking",
      pick: 1,
      now: "on failure",
    })
    expect(textQuestionOpen(picking)).toBe(false)
    // A setting left out opens empty; the secrets are names, separated by commas.
    const cpus = play(onRow(0), K.tab, ...downs(4), K.enter).state
    expect(settingsScreen(cpus).change).toMatchObject({
      path: { service: "worker", key: "cpus" },
      typed: "",
      now: "no limit",
    })
    expect(settingsScreen(play(onRow(7), K.enter).state).change?.typed).toBe(
      "DATABASE_URL, SESSION_KEY"
    )
  })

  test("letters type, q and ? included; Backspace removes; a paste of one line is taken, of several not", () => {
    const state = play(onMemory(), K.enter, ...erase(4)).state
    expect(settingsScreen(state).change?.typed).toBe("")
    const typed = play(state, ...typing("q?2g")).state
    expect(settingsScreen(typed).change?.typed).toBe("q?2g")
    expect(typed.exiting).toBe(false)
    expect(top(typed).name).toBe("settings")
    expect(settingsScreen(play(state, text("2g")).state).change?.typed).toBe(
      "2g"
    )
    expect(
      settingsScreen(play(state, text("2g\nsomething else")).state).change
        ?.typed
    ).toBe("")
    // Ctrl-C still quits.
    expect(play(typed, K.ctrlC).state.exiting).toBe(true)
  })

  test("enter with a value its rule refuses keeps the question open, with the rule", () => {
    const refused = memoryTyped("lots")
    expect(settingsScreen(refused.state).change).toMatchObject({
      stage: "typing",
      typed: "lots",
      reason: "Use a size such as 512m or 1g.",
    })
    expect(refused.effects).toEqual([])
    // The reason is about the value refused: the first key that changes the value takes it away.
    const erased = play(refused.state, K.backspace).state
    expect(settingsScreen(erased).change).toMatchObject({ typed: "lot" })
    expect(settingsScreen(erased).change?.reason).toBeUndefined()
    // A key that changes nothing keeps it: an arrow; Backspace on the empty image refused.
    expect(
      settingsScreen(play(refused.state, K.right).state).change?.reason
    ).toBe("Use a size such as 512m or 1g.")
    const image = play(onRow(0), K.enter, ...erase(40), K.enter).state
    expect(settingsScreen(play(image, K.backspace).state).change).toMatchObject(
      { typed: "", reason: "A service needs an image." }
    )
    const typed = play(refused.state, ...erase(4), ...typing("2g")).state
    expect(settingsScreen(typed).change?.reason).toBeUndefined()
    expect(settingsScreen(play(typed, K.enter).state).change).toMatchObject({
      stage: "asking",
      reason: undefined,
    })
  })

  test("an empty value removes a setting that can be left out; the image cannot be", () => {
    expect(settingsScreen(memoryTyped("").state).change).toMatchObject({
      stage: "asking",
      now: "512m",
      next: { value: undefined, shown: "no limit" },
    })
    const image = play(onRow(0), K.enter, ...erase(40), K.enter).state
    expect(settingsScreen(image).change).toMatchObject({
      stage: "typing",
      reason: "A service needs an image.",
    })
  })

  test("the same value as now closes the change and asks for nothing; so does emptying a setting not set", () => {
    const same = play(onMemory(), K.enter, K.enter)
    expect(settingsScreen(same.state).change).toBeUndefined()
    expect(same.effects).toEqual([])
    // A start command with other spaces is the same command.
    const spaced = play(
      onRow(1),
      K.enter,
      ...erase(13),
      ...typing("bun  run   start"),
      K.enter
    )
    expect(settingsScreen(spaced.state).change).toBeUndefined()
    expect(spaced.effects).toEqual([])
    const notSet = play(onRow(0), K.tab, ...downs(4), K.enter, K.enter)
    expect(settingsScreen(notSet.state).change).toBeUndefined()
    expect(notSet.effects).toEqual([])
  })

  test("a value that breaks a rule across settings is refused with CS17's place and rule", () => {
    const published: Settings = {
      version: 1,
      services: [
        ["web", { image: "nginx:1.27", port: 3000, publish: 80 }],
        ["worker", { image: "nginx:1.27", port: 4000 }],
      ],
    }
    // Leaving the port out while it is published.
    const port = play(onRow(5, published), K.enter, ...erase(4), K.enter).state
    expect(settingsScreen(port).change).toMatchObject({
      stage: "typing",
      reason:
        "web, networking.publish: set networking.port too, the port it reaches.",
    })
    // Publishing the port web publishes.
    const both = play(
      onRow(0, published),
      K.tab,
      ...downs(6),
      K.enter,
      ...typing("80"),
      K.enter
    ).state
    expect(settingsScreen(both).change).toMatchObject({
      stage: "typing",
      reason: "worker, networking.publish: web publishes the same port.",
    })
  })

  test("picking: ↑ ↓ move, enter chooses and asks, esc closes", () => {
    const picking = play(onRow(2), K.enter).state
    expect(
      settingsScreen(play(picking, K.down, K.enter).state).change
    ).toMatchObject({
      stage: "asking",
      typed: "always",
      now: "on failure",
      next: { value: "always", shown: "always" },
    })
    expect(
      settingsScreen(play(picking, K.up, K.up, K.up).state).change?.pick
    ).toBe(0)
    // The rule it has: nothing to write.
    expect(settingsScreen(play(picking, K.enter).state).change).toBeUndefined()
    const left = play(picking, K.esc).state
    expect(settingsScreen(left).change).toBeUndefined()
  })

  test("asking: y asks to write with the path, the value and the SHA-256 the change was opened on; n, enter and esc write nothing", () => {
    const asking = memoryTyped("1g").state
    expect(settingsScreen(asking).change).toMatchObject({
      stage: "asking",
      now: "512m",
      next: { value: "1g", shown: "1g" },
    })
    const yes = play(asking, text("y"))
    expect(yes.effects).toEqual([
      {
        kind: "write-setting",
        server: "prod",
        app: "demo",
        path: { service: "web", key: "memory" },
        value: "1g",
        sha256: SHA,
      },
    ])
    expect(settingsScreen(yes.state).change).toBeUndefined()
    // A second y, typed ahead, finds no question and writes nothing more.
    expect(play(yes.state, text("y")).effects).toEqual([])
    for (const no of [text("n"), K.enter, K.esc]) {
      const step = play(asking, no)
      expect(step.effects).toEqual([])
      expect(settingsScreen(step.state).change).toBeUndefined()
    }
    // A key that is not an answer does nothing; q does not quit; Ctrl-C does.
    for (const other of [
      text("Y"),
      text("q"),
      text("d"),
      text("?"),
      K.down,
      K.tab,
    ])
      expect(update(asking, other)).toEqual({ state: asking, effects: [] })
    expect(play(asking, K.ctrlC).state.exiting).toBe(true)
  })

  test("the SHA-256 written against is the one the change was opened on, even when the file was read again since", () => {
    const asking = memoryTyped("1g").state
    const reread = play(
      asking,
      settingsRead(withMemory(DESIGN_SETTINGS, "2g"), {
        sha256: "c".repeat(64),
      })
    ).state
    expect(effectsOf(reread, text("y"))).toMatchObject([
      { kind: "write-setting", sha256: SHA },
    ])
  })

  test("esc at any stage closes the change; while one is open the tick reads nothing", () => {
    for (const open of [
      play(onMemory(), K.enter).state,
      memoryTyped("lots").state,
      memoryTyped("1g").state,
      play(onRow(2), K.enter).state,
    ]) {
      expect(refreshAllowed(open)).toBe(false)
      expect(effectsOf(open, { type: "tick" })).toEqual([])
      const closed = play(open, K.esc)
      expect(settingsScreen(closed.state).change).toBeUndefined()
      expect(closed.effects).toEqual([])
      expect(refreshAllowed(closed.state)).toBe(true)
    }
  })

  test("written: the file is read again; refused: the line says why and the file is read again", () => {
    const written = play(memoryTyped("1g").state, text("y"), {
      type: "setting-written",
      server: "prod",
      app: "demo",
    })
    expect(written.effects).toEqual([
      expect.objectContaining({ kind: "write-setting" }),
      { kind: "read-settings", server: "prod", app: "demo", deployed: false },
    ])
    expect(settingsScreen(written.state).change).toBeUndefined()
    const notice = {
      tone: "error" as const,
      text: "zekno.app.json changed since zekno read it, so nothing was written. Try again.",
    }
    const refused = play(memoryTyped("1g").state, text("y"), {
      type: "setting-refused",
      server: "prod",
      app: "demo",
      notice,
    })
    expect(refused.state.notice).toEqual(notice)
    expect(refused.effects.at(-1)).toEqual({
      kind: "read-settings",
      server: "prod",
      app: "demo",
      deployed: false,
    })
  })

  test("a file that can no longer be shown closes the change; below 80 by 24 the change is kept for when there is room", () => {
    const open = play(onMemory(), K.enter, ...typing("x")).state
    const gone = play(open, {
      type: "settings-read",
      server: "prod",
      app: "demo",
      outcome: {
        kind: "sentence",
        sentence:
          "This folder has no settings file. Run zekno settings init to start one.",
      },
    }).state
    expect(settingsScreen(gone).change).toBeUndefined()
    expect(textQuestionOpen(gone)).toBe(false)
    const small = play(open, { type: "resize", columns: 70, rows: 20 }).state
    expect(update(small, text("y"))).toEqual({ state: small, effects: [] })
    const back = play(small, { type: "resize", columns: 100, rows: 30 }).state
    expect(settingsScreen(back).change).toEqual(settingsScreen(open).change)
  })

  test("a secret is a name: the secrets row types names, never a value", () => {
    const secrets = play(
      onRow(7),
      K.enter,
      ...erase(40),
      ...typing("A, B"),
      K.enter
    ).state
    expect(settingsScreen(secrets).change).toMatchObject({
      path: { service: "web", key: "secrets" },
      next: { value: "A, B", shown: "A, B" },
    })
  })
})

describe("the Compose text (c)", () => {
  test("c shows it from its first line; c or esc goes back to the settings, on the row that was selected", () => {
    const state = onBoard()
    const compose = play(state, text("c")).state
    expect(settingsScreen(compose)).toMatchObject({
      showing: "compose",
      scroll: 0,
      row: 3,
    })
    for (const back of [text("c"), K.esc]) {
      const step = play(compose, back)
      expect(settingsScreen(step.state)).toMatchObject({
        showing: "settings",
        row: 3,
      })
      expect(step.effects).toEqual([])
    }
  })

  test("↑ ↓ scroll it, and stop once its last line shows: 24 lines in 20 at 100 by 30, in 14 at 80 by 24", () => {
    for (const [size, last] of [
      [{ columns: 100, rows: 30 }, 5],
      [{ columns: 80, rows: 24 }, 11],
    ] as const) {
      const compose = play(
        opened(size),
        settingsRead(DESIGN_SETTINGS),
        text("c")
      ).state
      expect(settingsScreen(play(compose, K.up).state).scroll).toBe(0)
      const bottom = play(compose, ...downs(40)).state
      expect(settingsScreen(bottom).scroll).toBe(last)
      expect(settingsScreen(play(bottom, K.up).state).scroll).toBe(last - 1)
    }
  })

  test("d deploys from it; enter and tab do nothing; ? opens help and q quits", () => {
    const compose = play(onBoard(), text("c")).state
    expect(effectsOf(compose, text("d"))).toEqual([
      { kind: "deploy", server: "prod", app: "demo", shown: "a".repeat(64) },
    ])
    for (const event of [K.enter, K.tab])
      expect(update(compose, event)).toEqual({ state: compose, effects: [] })
    expect(top(play(compose, text("?")).state).name).toBe("help")
    expect(play(compose, text("q")).state.exiting).toBe(true)
  })

  test("the tick reads the file again from it too", () => {
    const compose = play(onBoard(), text("c")).state
    expect(effectsOf(compose, { type: "tick" })).toEqual([
      { kind: "refresh", server: "prod" },
      { kind: "read-settings", server: "prod", app: "demo", deployed: false },
    ])
  })
})

describe("keys read before a question of the screen can be drawn (the walkthrough's type-ahead)", () => {
  /** A key as app.tsx dispatches it: with the time it was read. */
  const at = (event: AppEvent, time: number): AppEvent => {
    if (event.type !== "key") throw new Error(event.type)
    return { ...event, at: time }
  }
  /** The board, the memory row selected, its value open at time 1000 and emptied at 1100. */
  const typingAt1000 = () =>
    play(
      onBoard(),
      at(K.enter, 1000),
      ...Array.from({ length: 4 }, (_, n) => at(K.backspace, 1100 + n))
    ).state

  test("the write question: a y in the same read as the Enter that opens it, or 3 ms after, writes nothing; one read once it is on the screen writes", () => {
    const typed = play(
      typingAt1000(),
      at(text("2"), 1200),
      at(text("g"), 1201)
    ).state
    const asking = play(typed, at(K.enter, 2000)).state
    expect(settingsScreen(asking).change?.stage).toBe("asking")
    expect(settingsScreen(asking).change?.openedAt).toBe(2000)
    for (const time of [2000, 2003, 2010, 2049]) {
      const step = play(asking, at(text("y"), time))
      expect({ time, effects: step.effects }).toEqual({ time, effects: [] })
      expect(settingsScreen(step.state).change?.stage).toBe("asking")
    }
    expect(effectsOf(asking, at(text("y"), 2050))).toEqual([
      expect.objectContaining({
        kind: "write-setting",
        sha256: "a".repeat(64),
      }),
    ])
    // Ctrl-C still quits at once.
    expect(play(asking, at(K.ctrlC, 2001)).state.exiting).toBe(true)
  })

  test("the value typed: keys read with or just after the Enter that opens it type nothing", () => {
    const open = typingAt1000()
    // The backspaces at 1100 came after the hold: the value is empty.
    expect(settingsScreen(open).change?.typed).toBe("")
    const early = play(
      play(onBoard(), at(K.enter, 1000)).state,
      at(text("9"), 1000),
      at(text("9"), 1030)
    ).state
    expect(settingsScreen(early).change?.typed).toBe("1g")
  })

  test("the restart rules: a key read just after the Enter that opens the list neither moves nor chooses", () => {
    const list = play(onBoard(), K.up, at(K.enter, 1000)).state
    expect(settingsScreen(list).change?.stage).toBe("picking")
    const early = play(list, at(K.down, 1001), at(K.enter, 1002)).state
    expect(settingsScreen(early).change).toMatchObject({
      stage: "picking",
      pick: 1,
    })
    const later = play(list, at(K.down, 1060)).state
    expect(settingsScreen(later).change?.pick).toBe(2)
  })
})

describe("keys dropped as a paste while a value is typed (the walkthrough's rough edge)", () => {
  test("keys that came in one read with a line break among them type nothing, and the rule for one line says why", () => {
    const typing = play(onBoard(), K.enter).state
    const dropped = play(typing, text("g\ry")).state
    expect(settingsScreen(dropped).change).toMatchObject({
      stage: "typing",
      typed: "1g",
      reason: "Use one line with no control character.",
    })
    // A plain value says its own rule.
    const plain = play(
      onBoard(),
      ...Array.from({ length: 5 }, () => K.down),
      K.enter
    ).state
    expect(settingsScreen(plain).change?.path).toEqual({
      service: "web",
      key: "plain",
      name: "NODE_ENV",
    })
    expect(settingsScreen(play(plain, text("a\nb")).state).change?.reason).toBe(
      "Use one line with no control character, at most 4096 characters."
    )
    // A paste of one line followed by Enter is still taken.
    expect(
      settingsScreen(play(typing, K.backspace, K.backspace, text("2g\r")).state)
        .change?.stage
    ).toBe("asking")
  })
})
