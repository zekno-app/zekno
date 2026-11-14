import { describe, expect, test } from "bun:test"

import { toAppKey, type AppKey } from "../src/app/keys"
import {
  initialState,
  LOG_LINES,
  RUNNER_LINES,
  top,
  update,
  type AppEvent,
  type Effect,
  type Screen,
  type State,
  type Step,
  type TeamView,
} from "../src/app/state"

// ---------------------------------------------------------------------------
// Fixtures

const SIZE = { columns: 100, rows: 30 }

const TEAM: TeamView = {
  member: "Ada",
  version: 2,
  servers: [
    {
      name: "prod",
      destination: "deploy@203.0.113.7",
      runner: { version: "0.1.0", outdated: true },
      apps: [
        { name: "demo", deploy: 4, state: "running" },
        { name: "api", deploy: 12, state: "running" },
      ],
    },
    { name: "staging", destination: "staging-box", runner: { version: "0.2.0", outdated: false }, apps: [] },
  ],
}

const home = (): State => initialState({ kind: "team", team: TEAM }, SIZE)

/** Plays events in order and returns the last step. */
function play(state: State, ...events: AppEvent[]): Step {
  let step: Step = { state, effects: [] }
  for (const event of events) {
    const next = update(step.state, event)
    step = { state: next.state, effects: [...step.effects, ...next.effects] }
  }
  return step
}

const key = (k: AppKey): AppEvent => ({ type: "key", key: k })
const text = (value: string): AppEvent => key({ kind: "text", text: value })
const K = {
  up: key({ kind: "up" }),
  down: key({ kind: "down" }),
  left: key({ kind: "left" }),
  right: key({ kind: "right" }),
  tab: key({ kind: "tab" }),
  enter: key({ kind: "enter" }),
  esc: key({ kind: "escape" }),
  backspace: key({ kind: "backspace" }),
  ctrlC: key({ kind: "ctrl-c" }),
}

/** Types each character as its own key press, as a person does. */
const typing = (value: string): AppEvent[] => [...value].map(text)

const press = (state: State, ...events: AppEvent[]) => play(state, ...events)

const onApp = (): State =>
  play(home(), K.right, K.enter, {
    type: "app-view",
    server: "prod",
    app: "demo",
    deploys: [
      { sequence: 4, outcome: "started", at: "2026-11-14T21:52:00Z" },
      { sequence: 3, outcome: "started", at: "2026-11-14T21:50:00Z" },
      { sequence: 2, outcome: "start_failed", at: "2026-11-14T21:47:00Z" },
    ],
    secrets: [
      { name: "DATABASE_URL", version: 3, removed: false },
      { name: "GREETING", version: 2, removed: true },
    ],
  }).state

const deploying = (from: State = onApp()): State =>
  play(from, { type: "deploy-started", server: "prod", app: "demo", at: 1000 }, { type: "deploy-stage", stage: "checked", sequence: 5, secrets: 1 }).state

const logLines = [
  { time: "2026-11-14T21:52:03Z", service: "web", line: "started" },
  { time: "2026-11-14T21:52:04Z", service: "worker", line: "connected to the queue" },
  { time: "2026-11-14T21:52:09Z", service: "web", line: "GET /healthz 200 2ms" },
]
const onLogs = (): State => play(onApp(), text("l"), { type: "log-lines", lines: logLines }).state

/** Every key the app knows, and letters no screen uses. */
const ALL_KEYS: AppEvent[] = [
  K.up,
  K.down,
  K.left,
  K.right,
  K.tab,
  K.enter,
  K.esc,
  K.backspace,
  ...["d", "r", "l", "s", "x", "a", "u", "o", "f", "/", "0", "1", "2", "9", "?", "n", "z", "Q", "ab"].map(text),
]
const describeKey = (event: AppEvent) => (event.type === "key" ? JSON.stringify(event.key) : event.type)

/**
 * Every key not in `active` leaves the state exactly as it was and asks for
 * nothing. `q` and Ctrl-C are left to their own tests.
 */
function expectIgnored(state: State, active: AppEvent[]) {
  const activeKeys = new Set(active.map(describeKey))
  for (const event of ALL_KEYS) {
    if (activeKeys.has(describeKey(event))) continue
    const step = update(state, event)
    expect({ key: describeKey(event), state: step.state, effects: step.effects }).toEqual({ key: describeKey(event), state, effects: [] })
  }
}

const effectsOf = (state: State, ...events: AppEvent[]): Effect[] => play(state, ...events).effects
const screenAfter = (state: State, ...events: AppEvent[]): Screen => top(play(state, ...events).state)

// ---------------------------------------------------------------------------

describe("start", () => {
  test("a verified team opens on Home, no team on first run, a profile that does not verify on the error screen", () => {
    expect(top(home())).toEqual({ name: "home", pane: "servers", server: 0, app: 0 })
    expect(top(initialState({ kind: "no-team" }, SIZE))).toEqual({ name: "welcome", value: "", creating: false })
    const error = initialState({ kind: "profile-error", reason: "The team list is wrong.", folder: "~/.zekno" }, SIZE)
    expect(top(error)).toEqual({ name: "profile-error", reason: "The team list is wrong.", folder: "~/.zekno" })
  })

  test("a linked folder opens with its server and app selected", () => {
    const linked = initialState({ kind: "team", team: TEAM, linked: { server: "prod", app: "api" } }, SIZE)
    expect(top(linked)).toEqual({ name: "home", pane: "apps", server: 0, app: 1 })
    const unknown = initialState({ kind: "team", team: TEAM, linked: { server: "nope", app: "api" } }, SIZE)
    expect(top(unknown)).toEqual({ name: "home", pane: "servers", server: 0, app: 0 })
  })
})

describe("Home", () => {
  test("↑ ↓ move in the focused pane and stop at the ends; the servers list ends with '+ add a server'", () => {
    expect(screenAfter(home(), K.down)).toMatchObject({ server: 1, app: 0 })
    expect(screenAfter(home(), K.down, K.down)).toMatchObject({ server: 2 })
    expect(screenAfter(home(), K.down, K.down, K.down)).toMatchObject({ server: 2 })
    expect(screenAfter(home(), K.up)).toMatchObject({ server: 0 })
    expect(screenAfter(home(), K.right, K.down)).toMatchObject({ pane: "apps", app: 1 })
    expect(screenAfter(home(), K.right, K.down, K.down)).toMatchObject({ app: 1 })
  })

  test("moving to another server selects its first app", () => {
    expect(screenAfter(home(), K.right, K.down, K.left, K.down)).toMatchObject({ pane: "servers", server: 1, app: 0 })
  })

  test("← → and tab move between the panes", () => {
    expect(screenAfter(home(), K.right)).toMatchObject({ pane: "apps" })
    expect(screenAfter(home(), K.right, K.left)).toMatchObject({ pane: "servers" })
    expect(screenAfter(home(), K.tab)).toMatchObject({ pane: "apps" })
    expect(screenAfter(home(), K.tab, K.tab)).toMatchObject({ pane: "servers" })
  })

  test("enter on a server goes to its apps, on '+ add a server' adds one, on an app opens it", () => {
    expect(screenAfter(home(), K.enter)).toMatchObject({ name: "home", pane: "apps" })
    expect(screenAfter(home(), K.down, K.down, K.enter)).toMatchObject({ name: "add-server", step: "destination" })
    const opened = play(home(), K.right, K.down, K.enter)
    expect(top(opened.state)).toEqual({ name: "app", server: "prod", app: "api", pane: "deploys", deploy: 0, secret: 0 })
    expect(opened.effects).toEqual([{ kind: "open-app", server: "prod", app: "api" }])
  })

  test("d deploys, r rolls back to the one before the latest, l logs, s sets a secret, a adds a server", () => {
    const onDemo = play(home(), K.right).state
    expect(effectsOf(onDemo, text("d"))).toEqual([{ kind: "deploy", server: "prod", app: "demo" }])
    expect(effectsOf(onDemo, text("r"))).toEqual([{ kind: "rollback", server: "prod", app: "demo" }])
    const logs = play(onDemo, text("l"))
    expect(top(logs.state)).toMatchObject({ name: "logs", server: "prod", app: "demo", following: true })
    expect(logs.effects).toEqual([{ kind: "logs", server: "prod", app: "demo" }])
    expect(screenAfter(onDemo, text("s"))).toMatchObject({ name: "set-secret", server: "prod", app: "demo", question: "name", missing: [] })
    expect(screenAfter(onDemo, text("a"))).toMatchObject({ name: "add-server" })
  })

  test("on a server with no apps, d deploys the linked folder and r, l, s do nothing", () => {
    const staging = play(home(), K.down).state
    expect(effectsOf(staging, text("d"))).toEqual([{ kind: "deploy", server: "staging", app: undefined }])
    for (const letter of ["r", "l", "s"]) expect(update(staging, text(letter))).toEqual({ state: staging, effects: [] })
  })

  test("u asks before updating a runner that is out of date, and only then", () => {
    const asked = play(home(), text("u")).state
    expect(asked.question).toEqual({ kind: "update-runner", server: "prod" })
    expect(play(asked, text("u")).effects).toEqual([{ kind: "update-runner", server: "prod" }])
    expect(play(asked, text("u")).state.question).toBeUndefined()
    expect(play(asked, K.esc)).toEqual({ state: { ...asked, question: undefined }, effects: [] })
    const current = play(home(), K.down).state
    expect(update(current, text("u"))).toEqual({ state: current, effects: [] })
  })

  test("? opens help; esc on Home does nothing; keys Home does not use are ignored", () => {
    expect(screenAfter(home(), text("?"))).toEqual({ name: "help" })
    expect(update(home(), K.esc)).toEqual({ state: home(), effects: [] })
    const onDemo = play(home(), K.right).state
    expectIgnored(onDemo, [K.up, K.down, K.left, K.right, K.tab, K.enter, text("d"), text("r"), text("l"), text("s"), text("a"), text("u"), text("?")])
  })
})

describe("the app screen", () => {
  test("↑ ↓ move in the deploys, or in the secrets with '+ set a secret' last", () => {
    expect(screenAfter(onApp(), K.down, K.down, K.down)).toMatchObject({ pane: "deploys", deploy: 2 })
    expect(screenAfter(onApp(), K.tab, K.down, K.down, K.down)).toMatchObject({ pane: "secrets", secret: 2 })
  })

  test("← → and tab move between deploys and secrets", () => {
    expect(screenAfter(onApp(), K.right)).toMatchObject({ pane: "secrets" })
    expect(screenAfter(onApp(), K.right, K.left)).toMatchObject({ pane: "deploys" })
    expect(screenAfter(onApp(), K.tab, K.tab)).toMatchObject({ pane: "deploys" })
  })

  test("r rolls back to the selected deploy; d deploys; l logs; s sets a secret", () => {
    expect(effectsOf(onApp(), K.down, text("r"))).toEqual([{ kind: "rollback", server: "prod", app: "demo", to: 3 }])
    expect(effectsOf(onApp(), text("d"))).toEqual([{ kind: "deploy", server: "prod", app: "demo" }])
    expect(screenAfter(onApp(), text("l"))).toMatchObject({ name: "logs", app: "demo" })
    expect(screenAfter(onApp(), text("s"))).toMatchObject({ name: "set-secret", question: "name", secretName: "" })
  })

  test("x asks before removing the selected secret, only in the secrets pane and not for one already removed", () => {
    const asked = play(onApp(), K.tab, text("x")).state
    expect(asked.question).toEqual({ kind: "remove-secret", server: "prod", app: "demo", name: "DATABASE_URL" })
    expect(play(asked, K.enter).effects).toEqual([{ kind: "remove-secret", server: "prod", app: "demo", name: "DATABASE_URL" }])
    expect(play(asked, K.esc).effects).toEqual([])
    expect(play(asked, K.esc).state.question).toBeUndefined()
    const inDeploys = onApp()
    expect(update(inDeploys, text("x"))).toEqual({ state: inDeploys, effects: [] })
    const removed = play(onApp(), K.tab, K.down).state
    expect(update(removed, text("x"))).toEqual({ state: removed, effects: [] })
  })

  test("enter on a secret asks for its new value; on '+ set a secret' asks for a name", () => {
    expect(screenAfter(onApp(), K.tab, K.enter)).toMatchObject({ name: "set-secret", secretName: "DATABASE_URL", question: "value" })
    expect(screenAfter(onApp(), K.tab, K.down, K.down, K.enter)).toMatchObject({ name: "set-secret", secretName: "", question: "name" })
  })

  test("esc goes back to Home; keys the app screen does not use are ignored", () => {
    expect(screenAfter(onApp(), K.esc)).toMatchObject({ name: "home" })
    expectIgnored(onApp(), [K.up, K.down, K.left, K.right, K.tab, K.esc, text("d"), text("r"), text("l"), text("s"), text("?")])
  })

  test("before its deploys have been read, r does nothing", () => {
    const unread = play(home(), K.right, K.enter).state
    expect(update(unread, text("r"))).toEqual({ state: unread, effects: [] })
  })
})

describe("a deploy in progress", () => {
  test("starting a deploy opens its screen; o shows Docker's output; esc goes back and the deploy carries on", () => {
    const state = deploying()
    expect(top(state)).toEqual({ name: "deploy", output: false })
    expect(state.deploy).toMatchObject({ server: "prod", app: "demo", sequence: 5, stage: "checked", running: true })
    expect(screenAfter(state, text("o"))).toEqual({ name: "deploy", output: true })
    expect(screenAfter(state, text("o"), text("o"))).toEqual({ name: "deploy", output: false })
    const back = play(state, K.esc)
    expect(top(back.state)).toMatchObject({ name: "app" })
    expect(back.state.deploy?.running).toBe(true)
    expect(back.effects).toEqual([])
    expectIgnored(state, [K.esc, text("o"), text("?")])
  })

  test("the result arrives as a line on whatever screen is showing", () => {
    const state = play(deploying(), K.esc, { type: "deploy-ended", outcome: "started", notice: { tone: "success", text: "demo is live on prod" } }).state
    expect(top(state)).toMatchObject({ name: "app" })
    expect(state.notice).toEqual({ tone: "success", text: "demo is live on prod" })
    expect(state.deploy).toMatchObject({ running: false, outcome: "started" })
  })

  test("Docker's output is kept, the last 500 lines", () => {
    const lines = Array.from({ length: 600 }, (_, n) => ({ type: "deploy-progress", lines: [`line ${n}`] }) as const)
    const state = play(deploying(), ...lines).state
    expect(state.deploy?.lines).toHaveLength(500)
    expect(state.deploy?.lines.at(-1)).toBe("line 599")
  })

  test("q and Ctrl-C wait for the deploy, then close when it ends", () => {
    for (const quit of [text("q"), K.ctrlC]) {
      const waiting = play(deploying(), quit)
      expect(waiting.effects).toEqual([])
      expect(waiting.state.quitting).toBe(true)
      expect(waiting.state.exiting).toBe(false)
      // Nothing else is done while waiting, not even a second q.
      for (const event of [...ALL_KEYS, text("q"), K.ctrlC]) expect(update(waiting.state, event)).toEqual({ state: waiting.state, effects: [] })
      const ended = play(waiting.state, { type: "deploy-ended", outcome: "start_failed", notice: { tone: "error", text: "it did not start" } })
      expect(ended.effects).toEqual([{ kind: "exit" }])
      expect(ended.state.exiting).toBe(true)
    }
  })

  test("q waits from any screen, also after leaving the deploy screen", () => {
    const state = play(deploying(), K.esc, K.esc, text("q")).state
    expect(top(state)).toMatchObject({ name: "home" })
    expect(state.quitting).toBe(true)
  })

  test("d and r do nothing while a deploy is in progress", () => {
    const back = play(deploying(), K.esc).state
    expect(update(back, text("d"))).toEqual({ state: back, effects: [] })
    expect(update(back, text("r"))).toEqual({ state: back, effects: [] })
  })
})

describe("quitting", () => {
  test("q and Ctrl-C quit at once when nothing is in progress", () => {
    for (const state of [home(), onApp(), onLogs(), play(home(), text("?")).state]) {
      for (const quit of [text("q"), K.ctrlC]) {
        const step = update(state, quit)
        expect(step.effects).toEqual([{ kind: "exit" }])
        expect(step.state.exiting).toBe(true)
        expect(update(step.state, text("?"))).toEqual({ state: step.state, effects: [] })
      }
    }
  })

  test("a deploy that has ended does not hold the app open", () => {
    const ended = play(deploying(), { type: "deploy-ended", outcome: "started", notice: { tone: "success", text: "done" } }).state
    expect(update(ended, text("q")).effects).toEqual([{ kind: "exit" }])
  })
})

describe("live logs", () => {
  test("f pauses and resumes following", () => {
    expect(screenAfter(onLogs(), text("f"))).toMatchObject({ following: false })
    expect(screenAfter(onLogs(), text("f"), text("f"))).toMatchObject({ following: true })
  })

  test("1–9 show one service in the order they appeared, 0 shows all; a number with no service does nothing", () => {
    expect(screenAfter(onLogs(), text("1"))).toMatchObject({ service: "web" })
    expect(screenAfter(onLogs(), text("2"))).toMatchObject({ service: "worker" })
    expect(screenAfter(onLogs(), text("2"), text("0"))).toMatchObject({ service: undefined })
    const state = onLogs()
    expect(update(state, text("9"))).toEqual({ state, effects: [] })
  })

  test("/ opens the filter: letters type into it, enter keeps it, esc clears it", () => {
    const open = play(onLogs(), text("/")).state
    expect(top(open)).toMatchObject({ filtering: true, filter: "" })
    // Letters that are keys elsewhere, q included, type into the filter.
    const typed = play(open, ...typing("q?fd/1"), K.backspace).state
    expect(top(typed)).toMatchObject({ filtering: true, filter: "q?fd/" })
    expect(typed.exiting).toBe(false)
    expect(screenAfter(typed, K.enter)).toMatchObject({ filtering: false, filter: "q?fd/" })
    expect(screenAfter(typed, K.esc)).toMatchObject({ name: "logs", filtering: false, filter: "" })
    expect(update(typed, K.ctrlC).effects).toEqual([{ kind: "exit" }])
  })

  test("↑ ↓ scroll back and forward, never past the ends", () => {
    expect(screenAfter(onLogs(), K.up, K.up)).toMatchObject({ scroll: 2 })
    expect(screenAfter(onLogs(), K.up, K.up, K.up, K.up)).toMatchObject({ scroll: 2 })
    expect(screenAfter(onLogs(), K.up, K.down, K.down)).toMatchObject({ scroll: 0 })
  })

  test("esc goes back and stops following; at most 2000 lines are kept", () => {
    const back = play(onLogs(), K.esc)
    expect(top(back.state)).toMatchObject({ name: "app" })
    expect(back.effects).toEqual([{ kind: "stop-logs" }])
    const many = Array.from({ length: LOG_LINES + 10 }, (_, n) => ({ time: "2026-11-14T21:52:03Z", service: "web", line: `${n}` }))
    const kept = top(play(onLogs(), { type: "log-lines", lines: many }).state)
    expect(kept.name === "logs" && kept.lines.length).toBe(LOG_LINES)
  })

  test("a dropped connection is shown, and enter reconnects", () => {
    const dropped = play(onLogs(), { type: "logs-dropped" }).state
    expect(top(dropped)).toMatchObject({ dropped: true })
    const again = play(dropped, K.enter)
    expect(again.effects).toEqual([{ kind: "logs", server: "prod", app: "demo" }])
    expect(top(again.state)).toMatchObject({ dropped: false })
  })

  test("keys the logs screen does not use are ignored", () => {
    expectIgnored(onLogs(), [K.up, K.esc, text("f"), text("/"), text("0"), text("1"), text("2"), text("?")])
  })
})

describe("first run", () => {
  const welcome = () => initialState({ kind: "no-team" }, SIZE)

  test("letters type into the name, q and ? included; enter creates the key", () => {
    const typed = play(welcome(), ...typing("Ada q?"), K.backspace, K.backspace, K.backspace).state
    expect(top(typed)).toEqual({ name: "welcome", value: "Ada", creating: false })
    const created = play(typed, K.enter)
    expect(created.effects).toEqual([{ kind: "create-key", name: "Ada" }])
    expect(top(created.state)).toEqual({ name: "welcome", value: "Ada", creating: true })
  })

  test("enter with no name does nothing; a pasted name followed by Enter is taken", () => {
    expect(effectsOf(welcome(), K.enter)).toEqual([])
    expect(effectsOf(welcome(), ...typing("   "), K.enter)).toEqual([])
    expect(effectsOf(welcome(), text("Ada Lovelace\r"))).toEqual([{ kind: "create-key", name: "Ada Lovelace" }])
  })

  test("esc and Ctrl-C quit, as the board says", () => {
    expect(effectsOf(welcome(), K.esc)).toEqual([{ kind: "exit" }])
    expect(effectsOf(welcome(), K.ctrlC)).toEqual([{ kind: "exit" }])
  })

  test("once the key is created, adding a server follows, with Home underneath", () => {
    const state = play(welcome(), ...typing("Ada"), K.enter, { type: "team-created", team: { ...TEAM, servers: [] } }).state
    expect(state.stack.map((screen) => screen.name)).toEqual(["home", "add-server"])
  })

  test("if creating the key failed, the name can be tried again", () => {
    const state = play(welcome(), ...typing("Ada"), K.enter, { type: "failed", notice: { tone: "error", text: "The keychain said no." } }).state
    expect(top(state)).toEqual({ name: "welcome", value: "Ada", creating: false })
    expect(state.notice).toEqual({ tone: "error", text: "The keychain said no." })
  })
})

describe("adding a server", () => {
  const adding = () => play(home(), text("a")).state

  test("the destination, then the name; letters type into each; enter on both starts it", () => {
    const named = play(adding(), ...typing("deploy@203.0.113.7"), K.enter, ...typing("prod-2q"), K.backspace)
    expect(top(named.state)).toMatchObject({ step: "name", destination: "deploy@203.0.113.7", serverName: "prod-2" })
    const started = play(named.state, K.enter)
    expect(started.effects).toEqual([{ kind: "add-server", destination: "deploy@203.0.113.7", name: "prod-2" }])
    expect(top(started.state)).toMatchObject({ step: "working" })
  })

  test("enter on an empty answer does nothing; esc cancels", () => {
    expect(screenAfter(adding(), K.enter)).toMatchObject({ name: "add-server", step: "destination" })
    expect(screenAfter(adding(), ...typing("x"), K.esc)).toMatchObject({ name: "home" })
    expect(screenAfter(adding(), ...typing("x"), K.enter, K.esc)).toMatchObject({ name: "home" })
  })

  test("while it works, o shows the details and esc goes back", () => {
    const working = play(adding(), ...typing("h"), K.enter, ...typing("n"), K.enter).state
    expect(screenAfter(working, text("o"))).toMatchObject({ output: true })
    expect(screenAfter(working, K.esc)).toMatchObject({ name: "home" })
    expectIgnored(working, [K.esc, text("o"), text("?")])
  })

  test("when it is done the screen stays, with the server code, until enter or esc; then Home with the new server selected and a line says so; when it fails the details can be fixed", () => {
    const working = play(
      adding(),
      ...typing("h"),
      K.enter,
      ...typing("n"),
      K.enter,
      { type: "add-started", destination: "h", name: "n", local: false },
      { type: "add-code", code: "ABCD-EFGH" }
    ).state
    const notice = { tone: "success", text: "Connected n and added it to the signed team list." } as const
    const added = play(working, { type: "server-added", team: TEAM, notice, code: "ABCD-EFGH" }).state
    // The code is in its panel (FR-013): nothing is said on a line yet.
    expect(top(added)).toMatchObject({ name: "add-server", step: "done", destination: "h", serverName: "n" })
    expect(added.adding).toMatchObject({ running: false, serverCode: "ABCD-EFGH" })
    expect(added.notice).toBeUndefined()
    // Only enter and esc do anything; ? opens help and esc there comes back to it.
    expectIgnored(added, [K.enter, K.esc, text("?")])
    expect(top(play(added, text("?"), K.esc).state)).toMatchObject({ name: "add-server", step: "done" })
    for (const leave of [K.enter, K.esc]) {
      const back = play(added, leave).state
      expect(top(back)).toEqual({ name: "home", pane: "servers", server: TEAM.servers.length - 1, app: 0 })
      expect(back.notice).toEqual(notice)
    }
    // Left with esc while it worked, the panel was not seen: the line on Home gives the code.
    const left = play(working, K.esc, { type: "server-added", team: TEAM, notice, code: "ABCD-EFGH" }).state
    expect(top(left)).toMatchObject({ name: "home", server: TEAM.servers.length - 1 })
    expect(left.notice).toEqual({ tone: "success", text: "Connected n and added it to the signed team list. Server code ABCD-EFGH." })
    const failed = play(working, { type: "failed", notice: { tone: "error", text: "No." } }).state
    expect(top(failed)).toMatchObject({ name: "add-server", step: "destination", destination: "h", serverName: "n" })
  })
})

describe("setting a secret", () => {
  const naming = () => play(onApp(), text("s")).state

  test("letters type into the name; enter opens the hidden prompt", () => {
    const named = play(naming(), ...typing("API_KEYq"), K.backspace).state
    expect(top(named)).toMatchObject({ question: "name", secretName: "API_KEY" })
    expect(top(play(named, K.enter).state)).toMatchObject({ question: "value", secretName: "API_KEY" })
  })

  test("while the hidden prompt is open the app acts on no key: q does not quit, letters are not commands", () => {
    const prompt = play(naming(), ...typing("API_KEY"), K.enter).state
    for (const event of [...ALL_KEYS.filter((e) => describeKey(e) !== describeKey(K.esc)), text("q")]) {
      expect(update(prompt, event)).toEqual({ state: prompt, effects: [] })
    }
  })

  test("Ctrl-C in the hidden prompt cancels the prompt only; esc cancels setting the secret", () => {
    const prompt = play(naming(), ...typing("API_KEY"), K.enter).state
    const cancelled = play(prompt, K.ctrlC)
    expect(cancelled.effects).toEqual([])
    expect(cancelled.state.exiting).toBe(false)
    expect(top(cancelled.state)).toMatchObject({ name: "set-secret", question: "name", secretName: "API_KEY" })
    expect(screenAfter(prompt, K.esc)).toMatchObject({ name: "app" })
  })

  test("a value stored returns to the app with a line; a value refused opens the prompt again", () => {
    const prompt = play(naming(), ...typing("API_KEY"), K.enter).state
    const saved = play(prompt, { type: "secret-saved", notice: { tone: "success", text: "API_KEY set." } }).state
    expect(top(saved)).toMatchObject({ name: "app" })
    expect(saved.notice).toEqual({ tone: "success", text: "API_KEY set." })
    const refused = play(prompt, { type: "secret-refused", notice: { tone: "error", text: "That value has more than one line." } }).state
    expect(top(refused)).toMatchObject({ name: "set-secret", question: "value" })
  })

  test("before a deploy, each missing name is asked in turn, then the deploy goes on", () => {
    const missing = play(onApp(), { type: "missing-values", server: "prod", app: "demo", names: ["DATABASE_URL", "SESSION_KEY"] }).state
    expect(top(missing)).toMatchObject({ name: "set-secret", missing: ["DATABASE_URL", "SESSION_KEY"], at: 0, question: "value" })
    const first = play(missing, { type: "secret-saved", notice: { tone: "success", text: "set" } }).state
    expect(top(first)).toMatchObject({ at: 1, question: "value" })
    const last = play(first, { type: "secret-saved", notice: { tone: "success", text: "set" } })
    expect(top(last.state)).toMatchObject({ name: "app" })
    expect(last.effects).toEqual([{ kind: "deploy-continue", server: "prod", app: "demo", answer: "values-set" }])
  })

  test("before a deploy, esc and Ctrl-C at the prompt close it only, back to the list, and sign nothing", () => {
    const missing = play(onApp(), { type: "missing-values", server: "prod", app: "demo", names: ["A", "B"] }).state
    for (const close of [K.esc, K.ctrlC]) {
      const closed = play(missing, close)
      expect(closed.effects).toEqual([])
      expect(closed.state.question).toBeUndefined()
      expect(top(closed.state)).toMatchObject({ name: "set-secret", question: undefined, missing: ["A", "B"] })
    }
    const listed = play(missing, K.esc).state
    expect(screenAfter(listed, K.down)).toMatchObject({ at: 1 })
    expect(screenAfter(listed, K.down, K.enter)).toMatchObject({ at: 1, question: "value" })
    expectIgnored(listed, [K.up, K.down, K.enter, K.esc, text("?")])
  })

  test("before a deploy, esc on the list asks; y deploys without the values not set, n or esc deploys nothing and says so", () => {
    const missing = play(onApp(), { type: "missing-values", server: "prod", app: "demo", names: ["A", "B"] }).state
    const asked = play(missing, K.esc, K.esc)
    expect(asked.effects).toEqual([])
    expect(asked.state.question).toEqual({ kind: "skip-values", server: "prod", app: "demo", names: ["A", "B"] })
    const yes = play(asked.state, text("y"))
    expect(yes.effects).toEqual([{ kind: "deploy-continue", server: "prod", app: "demo", answer: "skip-values" }])
    expect(top(yes.state)).toMatchObject({ name: "app" })
    expect(yes.state.question).toBeUndefined()
    for (const no of [text("n"), K.esc]) {
      const step = play(asked.state, no)
      expect(step.effects).toEqual([])
      expect(top(step.state)).toMatchObject({ name: "app" })
      expect(step.state.question).toBeUndefined()
      expect(step.state.notice).toEqual({ tone: "info", text: "Nothing was deployed." })
    }
    // q does nothing in a question; Ctrl-C still quits.
    expect(update(asked.state, text("q"))).toEqual({ state: asked.state, effects: [] })
    expect(update(asked.state, K.ctrlC).effects).toEqual([{ kind: "exit" }])
    expectIgnored(asked.state, [K.esc, text("n")])
  })
})

describe("remembering the folder", () => {
  test("enter writes zekno.json and deploys, n deploys without it, esc cancels; q does nothing in a question", () => {
    const asked = play(onApp(), { type: "ask-remember-folder", server: "prod", app: "demo", compose: "compose.yaml" }).state
    expect(asked.question).toEqual({ kind: "remember-folder", server: "prod", app: "demo", compose: "compose.yaml" })
    expect(effectsOf(asked, K.enter)).toEqual([{ kind: "deploy-continue", server: "prod", app: "demo", answer: "write-link" }])
    expect(effectsOf(asked, text("n"))).toEqual([{ kind: "deploy-continue", server: "prod", app: "demo", answer: "skip-link" }])
    expect(play(asked, K.esc)).toEqual({ state: { ...asked, question: undefined }, effects: [] })
    expect(update(asked, text("q"))).toEqual({ state: asked, effects: [] })
    expect(update(asked, K.ctrlC).effects).toEqual([{ kind: "exit" }])
    expectIgnored(asked, [K.enter, K.esc, text("n")])
  })
})

describe("help", () => {
  test("? opens help on every screen that has keys; esc closes it, back where it was opened", () => {
    for (const state of [home(), onApp(), deploying(), onLogs(), play(home(), text("a"), ...typing("h"), K.enter, ...typing("n"), K.enter).state]) {
      const opened = play(state, text("?")).state
      expect(top(opened)).toEqual({ name: "help" })
      expect(play(opened, K.esc).state.stack).toEqual(state.stack)
    }
  })

  test("on help only esc, q and Ctrl-C do anything", () => {
    const help = play(home(), text("?")).state
    expectIgnored(help, [K.esc])
  })
})

describe("the profile that does not verify", () => {
  test("there is no action but quit", () => {
    const state = initialState({ kind: "profile-error", reason: "No.", folder: "~/.zekno" }, SIZE)
    expectIgnored(state, [])
    expect(effectsOf(state, text("q"))).toEqual([{ kind: "exit" }])
    expect(effectsOf(state, K.ctrlC)).toEqual([{ kind: "exit" }])
  })
})

describe("a window that is too small", () => {
  test("below 80 by 24 only q and Ctrl-C do anything, and the screen underneath is kept", () => {
    for (const size of [
      { columns: 79, rows: 30 },
      { columns: 100, rows: 23 },
    ]) {
      const small = play(onApp(), { type: "resize", ...size }).state
      expectIgnored(small, [])
      expect(effectsOf(small, text("q"))).toEqual([{ kind: "exit" }])
      const roomy = play(small, { type: "resize", columns: 80, rows: 24 }).state
      expect(top(roomy)).toEqual(top(onApp()))
      expect(screenAfter(roomy, K.tab)).toMatchObject({ pane: "secrets" })
    }
  })

  test("q while too small still waits for a deploy", () => {
    const small = play(deploying(), { type: "resize", columns: 40, rows: 10 }, text("q")).state
    expect(small.quitting).toBe(true)
    expect(small.exiting).toBe(false)
  })
})

describe("other events", () => {
  test("a new team keeps each selection inside its list", () => {
    const onApi = play(home(), K.right, K.down).state
    const fewer = play(onApi, { type: "team", team: { ...TEAM, servers: [{ ...TEAM.servers[0]!, apps: [TEAM.servers[0]!.apps[0]!] }] } }).state
    expect(top(fewer)).toMatchObject({ server: 0, app: 0 })
  })

  test("what runners write on standard error is kept, the last 200 lines", () => {
    const lines = Array.from({ length: RUNNER_LINES + 5 }, (_, n) => ({ type: "runner-line", line: `${n}` }) as const)
    const state = play(home(), ...lines).state
    expect(state.runnerLines).toHaveLength(RUNNER_LINES)
    expect(state.runnerLines.at(-1)).toBe(`${RUNNER_LINES + 4}`)
  })

  test("opening a screen clears a line about something done elsewhere", () => {
    const noticed = play(home(), { type: "notice", notice: { tone: "info", text: "x" } }).state
    expect(noticed.notice).toBeDefined()
    expect(play(noticed, text("?")).state.notice).toBeUndefined()
  })
})

describe("reading keys from Ink", () => {
  const none = {}
  test("arrows, tab, enter, esc, backspace and Ctrl-C", () => {
    expect(toAppKey("", { upArrow: true })).toEqual({ kind: "up" })
    expect(toAppKey("", { downArrow: true })).toEqual({ kind: "down" })
    expect(toAppKey("", { leftArrow: true })).toEqual({ kind: "left" })
    expect(toAppKey("", { rightArrow: true })).toEqual({ kind: "right" })
    expect(toAppKey("", { tab: true })).toEqual({ kind: "tab" })
    expect(toAppKey("\r", { return: true })).toEqual({ kind: "enter" })
    expect(toAppKey("", { escape: true })).toEqual({ kind: "escape" })
    expect(toAppKey("", { backspace: true })).toEqual({ kind: "backspace" })
    expect(toAppKey("", { delete: true })).toEqual({ kind: "backspace" })
    expect(toAppKey("c", { ctrl: true })).toEqual({ kind: "ctrl-c" })
  })

  test("letters and pastes are text; other control and Alt keys are ignored", () => {
    expect(toAppKey("q", none)).toEqual({ kind: "text", text: "q" })
    expect(toAppKey("deploy@host", none)).toEqual({ kind: "text", text: "deploy@host" })
    expect(toAppKey("x", { ctrl: true })).toBeUndefined()
    expect(toAppKey("d", { meta: true })).toBeUndefined()
    expect(toAppKey("", none)).toBeUndefined()
  })

  test("pieces of a terminal's late answer to the background question are never taken as keys", () => {
    // How Ink splits an answer to OSC 11 and DA1 that arrives after the app started (checked against Ink 8).
    expect(toAppKey("]", { meta: true })).toBeUndefined()
    expect(toAppKey("11;rgb:0b0b/0d0d/1010\x07", none)).toBeUndefined()
    expect(toAppKey("11;rgb:ffff/ffff/ffff", none)).toBeUndefined()
    expect(toAppKey("\\", { meta: true })).toBeUndefined()
    expect(toAppKey("[?62;22c", none)).toBeUndefined()
  })
})
