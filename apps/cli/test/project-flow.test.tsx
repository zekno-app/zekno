import { describe, expect, test } from "bun:test"
import { renderToString, type Key } from "ink"
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir, waitFor } from "../../runner/test/helpers"
import { AppView, createStore } from "../src/app/app"
import { createEffects, loadStart, type Effects } from "../src/app/effects"
import { emptyHiddenValue, hiddenPromptKey } from "../src/app/hidden-prompt"
import type { AppKey } from "../src/app/keys"
import { hiddenPromptOpen, initialState, top, update, type State } from "../src/app/state"
import { MISSING_APP, MISSING_SERVER } from "../src/errors"
import { COMPOSE_V1, COMPOSE_V2, filesUnder, machine, ready } from "./helpers"

type Machine = ReturnType<typeof machine>

/** A Compose file that expects two values, one listed with no value and one used in another, and has one of its own. */
const COMPOSE_TWO =
  "services:\n  web:\n    image: example/web:1\n    environment:\n      - DATABASE_URL\n      - AUTH=${SESSION_KEY}\n      - GREETING=hello\n    command: echo $$HOME $HOME ${PORT:-80}\n"
/** One that expects nothing. */
const COMPOSE_PLAIN = "services:\n  web:\n    image: example/web:1\n"

const link = (m: Machine, content: unknown, folder = m.project) =>
  writeFileSync(join(folder, "zekno.json"), typeof content === "string" ? content : JSON.stringify(content))
const deployed = (m: Machine, app: string) => readFileSync(join(m.runnerHome, "apps", app, "compose.yaml"), "utf8")
/**
 * The project folder as zekno finds it: the folders a program is in are
 * real paths, and temporary folders on macOS are reached through a link.
 */
const folderOf = (m: Machine) => realpathSync(m.project)
const fileOf = (m: Machine) => join(folderOf(m), "zekno.json")

const draw = (state: State, columns = 100, rows = 30) => renderToString(<AppView state={state} columns={columns} rows={rows} />, { columns })
/** All the text, with the box lines and runs of spaces taken out, for wording that may wrap. */
const words = (screen: string) => screen.replace(/[│╭╮╰╯─]/g, " ").replace(/\s+/g, " ")

describe("single commands in a linked folder", () => {
  test("`zekno deploy` with no flags takes the app, the server and the Compose file from zekno.json, also from a sub-folder", async () => {
    const m = await ready()
    mkdirSync(join(m.project, "deploy"))
    writeFileSync(join(m.project, "deploy", "prod.yaml"), COMPOSE_V2)
    link(m, { app: "web", server: "dev", compose: "deploy/prod.yaml" })
    expect(await m.zekno("deploy")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 1 of web is running on dev with 0 secret(s).")
    expect(deployed(m, "web")).toBe(COMPOSE_V2)

    // From a folder below, the same file applies, and its Compose file is found from the file's own folder.
    m.deps.cwd = join(m.project, "deploy")
    writeFileSync(join(m.project, "deploy", "prod.yaml"), COMPOSE_V1)
    expect(await m.zekno("deploy")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 2 of web is running on dev with 0 secret(s).")
    expect(deployed(m, "web")).toBe(COMPOSE_V1)
    expect(m.docker.calls()).toHaveLength(2)
  })

  test("flags win over the file, one detail at a time", async () => {
    const m = await ready()
    link(m, { app: "web", server: "dev" })
    m.compose(COMPOSE_V2, "other.yaml")
    expect(await m.zekno("deploy", "--app", "api")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 1 of api is running on dev with 0 secret(s).")
    expect(deployed(m, "api")).toBe(COMPOSE_V1)
    expect(await m.zekno("deploy", "-f", "other.yaml")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 1 of web is running on dev with 0 secret(s).")
    expect(deployed(m, "web")).toBe(COMPOSE_V2)
    // A server typed on the command line is the typist's: the sentence does not blame the file.
    expect(await m.zekno("deploy", "--server", "prod")).toBe(1)
    expect(m.lastErr()).toBe('No server named "prod". Connected servers: dev.')
  })

  test("secret, status, rollback and logs take their defaults from it too", async () => {
    const m = await ready()
    link(m, { app: "web", server: "dev" })
    m.typing("hello")
    expect(await m.zekno("secret", "set", "GREETING")).toBe(0)
    expect(m.lastOut()).toBe("Set GREETING (version 1) for web on dev. It takes effect on the next deploy.")
    m.out.length = 0
    expect(await m.zekno("secret", "ls")).toBe(0)
    expect(m.out).toEqual(["GREETING\tversion 1"])
    expect(await m.zekno("deploy")).toBe(0)
    m.compose(COMPOSE_V2)
    expect(await m.zekno("deploy")).toBe(0)

    m.out.length = 0
    expect(await m.zekno("status")).toBe(0)
    expect(m.out[0]).toBe("dev: team list version 2")
    expect(m.out).toContain("web\tdeploy 2\tstopped")

    expect(await m.zekno("rollback")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 3 of web is running on dev with 1 secret(s).")
    expect(deployed(m, "web")).toBe(COMPOSE_V1)

    m.docker.logs("web", "web-1  | 2026-11-14T21:52:03Z hello\n")
    m.out.length = 0
    expect(await m.zekno("logs", "--no-follow")).toBe(0)
    expect(m.out).toEqual(["2026-11-14T21:52:03Z\tweb\thello"])

    expect(await m.zekno("secret", "rm", "GREETING")).toBe(0)
    expect(m.lastOut()).toBe("Removed GREETING from web on dev. It takes effect on the next deploy.")
  })

  test("a server it names that this machine does not know stops the command, naming the file and the server; nothing is signed", async () => {
    const m = await ready()
    link(m, { app: "web", server: "prod" })
    for (const args of [["deploy"], ["rollback"], ["status"], ["secret", "ls"], ["logs", "--no-follow"]]) {
      expect(await m.zekno(...args)).toBe(1)
      expect(m.lastErr()).toBe(`${fileOf(m)} names a server "prod" that is not connected to this machine. Connected servers: dev.`)
    }
    expect(m.docker.calls()).toEqual([])
    expect(existsSync(join(m.home, "history"))).toBe(false)
  })

  test("a file that is malformed, names an app outside the pattern, or a Compose file that is missing or leads outside, stops the command", async () => {
    const m = await ready()
    const path = fileOf(m)
    const cases: [unknown, string][] = [
      ["{ app: web", `${path} is not valid JSON.`],
      [{ app: "web", server: "dev", extra: true }, `${path} has a field zekno does not read: "extra". It holds only "app", "server" and "compose".`],
      [{ app: "../../etc", server: "dev" }, `${path} needs "app": an app name of lowercase letters, digits and hyphens.`],
      [{ app: "web", server: "dev", compose: "../compose.yaml" }, `${path} has a "compose" that is not a relative path inside its folder.`],
      [{ app: "web", server: "dev", compose: "missing.yaml" }, `${path} names missing.yaml as the Compose file, and there is no such file in ${folderOf(m)}.`],
    ]
    for (const [content, sentence] of cases) {
      link(m, content)
      expect(await m.zekno("deploy")).toBe(1)
      expect(m.lastErr()).toBe(sentence)
    }
    // A Compose file reached through a link out of the folder is never read or sent.
    const outside = join(tempDir("outside"), "private.yaml")
    writeFileSync(outside, "services:\n  leak:\n    image: private\n")
    symlinkSync(outside, join(m.project, "linked.yaml"))
    link(m, { app: "web", server: "dev", compose: "linked.yaml" })
    expect(await m.zekno("deploy")).toBe(1)
    expect(m.lastErr()).toBe(`linked.yaml, named by ${path}, leads outside the folder that holds it. zekno does not follow it there.`)
    expect(m.docker.calls()).toEqual([])

    // Given every detail as a flag, the command never reads the file.
    link(m, "{ app: web")
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev", "-f", "compose.yaml")).toBe(0)
  })

  test("without a project file, a missing detail is wrong usage naming the flag and the project file, and nothing is asked", async () => {
    const m = await ready()
    const cases: [string[], string][] = [
      [["deploy"], MISSING_SERVER],
      [["deploy", "--server", "dev"], MISSING_APP],
      [["rollback", "--app", "web"], MISSING_SERVER],
      [["status"], MISSING_SERVER],
      [["logs", "--server", "dev"], MISSING_APP],
      [["secret", "set", "API_KEY", "--server", "dev"], MISSING_APP],
      [["secret", "rm", "API_KEY", "--app", "web"], MISSING_SERVER],
      [["secret", "ls"], MISSING_SERVER],
    ]
    for (const [args, sentence] of cases) {
      expect(await m.zekno(...args)).toBe(2)
      expect(m.lastErr()).toBe(`${sentence}\nRun \`zekno --help\` for the list of commands.`)
    }
    expect(m.docker.calls()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The app

/** The app on a test machine, without a terminal: the reducer, the effects, and the window drawn on request. */
function openApp(m: Machine, start: Awaited<ReturnType<typeof loadStart>>) {
  const failures: unknown[] = []
  let effects: Effects | undefined
  const store = createStore(initialState(start, { columns: 100, rows: 30 }), (effect) => {
    if (effect.kind !== "exit") effects!.run(effect)
  })
  effects = createEffects(m.deps, store.dispatch, (error) => failures.push(error))
  const held = emptyHiddenValue()
  return {
    store,
    failures,
    get state() {
      return store.get()
    },
    press: (...keys: AppKey[]) => keys.forEach((k) => store.dispatch({ type: "key", key: k })),
    type: (value: string) => [...value].forEach((char) => store.dispatch({ type: "key", key: { kind: "text", text: char } })),
    /** One key press or paste at the hidden prompt, as app.tsx hands it over. */
    hidden: (input: string, k: Partial<Key> = {}) => hiddenPromptKey(held, input, k, store.get(), store.dispatch, effects!.saveSecret),
    draw: () => draw(store.get()),
    until: (ready: () => boolean, what: string) => waitFor(ready, what),
  }
}
type App = ReturnType<typeof openApp>

/** A machine with demo deployed once from the command line, and the app open on Home with demo selected. */
async function onHome(compose: string, prepare?: (m: Machine) => Promise<void> | void) {
  const m = await ready()
  expect(await m.zekno("deploy", "--app", "demo", "--server", "dev")).toBe(0)
  m.compose(compose)
  await prepare?.(m)
  const app = openApp(m, await loadStart(m.deps))
  app.press({ kind: "right" })
  return { m, app }
}

const ended = (app: App) => app.until(() => app.state.deploy?.running === false, "the deploy to end")

/** Types a value at the hidden prompt and presses enter, and waits for it to be stored. */
async function setValue(app: App, value: string) {
  expect(hiddenPromptOpen(app.state)).toBe(true)
  const before = app.state.notice
  app.hidden(value)
  app.hidden("\r", { return: true })
  await app.until(() => app.state.notice !== before && app.state.notice?.tone === "success", "the value to be stored")
}

describe("the app in a project folder", () => {
  test("opens focused on the linked server and app, says the folder is linked, and names its Compose file", async () => {
    const m = await ready()
    expect(await m.zekno("server", "add", "staging", "--local", "--home", tempDir("staging"))).toBe(0)
    for (const app of ["demo", "web"]) expect(await m.zekno("deploy", "--app", app, "--server", "staging")).toBe(0)
    link(m, { app: "demo", server: "staging" })
    const start = await loadStart(m.deps)
    expect(start).toMatchObject({ kind: "team", linked: { server: "staging", app: "demo", compose: "compose.yaml" } })
    const state = initialState(start, { columns: 100, rows: 30 })
    // web was deployed last, so it is listed first; demo is selected all the same.
    expect(top(state)).toEqual({ name: "home", pane: "apps", server: 1, app: 1 })
    const screen = words(draw(state))
    expect(screen).toContain("Apps on staging")
    expect(screen).toContain("This folder is linked to demo on staging by zekno.json.")
    expect(draw(state)).toMatch(/file +compose\.yaml/)
  })

  test("a zekno.json that cannot be used is said on Home, and the app opens all the same", async () => {
    const m = await ready()
    link(m, "{ nope")
    const broken = await loadStart(m.deps)
    expect(broken).toMatchObject({ kind: "team", problem: `${fileOf(m)} is not valid JSON.` })
    const screen = draw(initialState(broken, { columns: 100, rows: 30 }))
    expect(screen).toContain("✖ ")
    expect(words(screen)).toContain("is not valid JSON.")
    link(m, { app: "web", server: "prod" })
    const unknown = await loadStart(m.deps)
    expect(unknown).toMatchObject({ kind: "team", problem: `${fileOf(m)} names a server "prod" that is not connected to this machine.` })
    expect(unknown.kind === "team" && unknown.linked).toBeUndefined()
  })

  test("the first deploy of a folder that is not linked asks to remember it; enter writes zekno.json and deploys", async () => {
    const { m, app } = await onHome(COMPOSE_PLAIN)
    app.type("d")
    await app.until(() => app.state.question !== undefined, "the question")
    expect(app.state.question).toEqual({ kind: "remember-folder", server: "dev", app: "demo", compose: "compose.yaml" })
    const screen = app.draw()
    const said = words(screen)
    expect(said).toContain("Remember this folder?")
    expect(said).toContain("Write zekno.json here, so this folder always deploys demo to dev.")
    expect(said).toContain('{ "app": "demo", "server": "dev", "compose": "compose.yaml" }')
    expect(said).toContain("It holds no secret and is safe to commit.")
    expect(said).toContain("enter write it and deploy n deploy without it esc cancel")
    // Nothing is written or signed while the question is open.
    expect(existsSync(join(m.project, "zekno.json"))).toBe(false)
    expect(m.docker.calls()).toHaveLength(1)

    app.press({ kind: "enter" })
    await ended(app)
    expect(app.state.deploy).toMatchObject({ app: "demo", server: "dev", sequence: 2, outcome: "started" })
    const written = join(m.project, "zekno.json")
    expect(JSON.parse(readFileSync(written, "utf8"))).toEqual({ app: "demo", server: "dev", compose: "compose.yaml" })
    expect(statSync(written).mode & 0o777).toBe(0o644)
    expect(app.state.linked).toEqual({ server: "dev", app: "demo", compose: "compose.yaml" })
    app.press({ kind: "escape" })
    expect(words(app.draw())).toContain("This folder is linked to demo on dev by zekno.json.")

    // Linked now: the next deploy does not ask.
    app.type("d")
    await app.until(() => app.state.deploy?.sequence === 3 && !app.state.deploy.running, "deploy 3")
    expect(app.state.question).toBeUndefined()
    expect(app.failures).toEqual([])
  })

  test("n deploys without writing it and is not asked again while the app is open; esc cancels and nothing is signed", async () => {
    const { m, app } = await onHome(COMPOSE_PLAIN)
    app.type("d")
    await app.until(() => app.state.question !== undefined, "the question")
    app.press({ kind: "escape" })
    expect(app.state.question).toBeUndefined()
    await Bun.sleep(100)
    expect(app.state.deploy).toBeUndefined()
    expect(m.docker.calls()).toHaveLength(1)

    app.type("d")
    await app.until(() => app.state.question !== undefined, "the question again")
    app.type("n")
    await ended(app)
    expect(app.state.deploy).toMatchObject({ sequence: 2, outcome: "started" })
    expect(existsSync(join(m.project, "zekno.json"))).toBe(false)

    app.press({ kind: "escape" })
    app.type("d")
    await app.until(() => app.state.deploy?.sequence === 3 && !app.state.deploy.running, "deploy 3")
    expect(app.state.question).toBeUndefined()
    expect(existsSync(join(m.project, "zekno.json"))).toBe(false)
    expect(app.failures).toEqual([])
  })

  test("missing values are listed before a deploy, each set with the hidden prompt, then the deploy goes on with them", async () => {
    const DATABASE = "postgres://only-the-runner-reads-this"
    const SESSION = "session-value-never-shown"
    const { m, app } = await onHome(COMPOSE_TWO, (m) => link(m, { app: "demo", server: "dev" }))
    app.type("d")
    await app.until(() => top(app.state).name === "set-secret", "the list")
    expect(top(app.state)).toMatchObject({ server: "dev", app: "demo", missing: ["DATABASE_URL", "SESSION_KEY"], file: "compose.yaml", at: 0, question: "value" })
    const seen: string[] = []
    const look = () => seen.push(JSON.stringify(app.state), app.draw())
    look()
    let screen = words(app.draw())
    expect(screen).toContain("› dev › demo › set a secret 1 of 2")
    expect(screen).toContain("! compose.yaml expects 2 values that are not set yet.")
    expect(screen).toContain("Set them now, or press esc and deploy without them.")
    expect(screen).toMatch(/❯ DATABASE_URL +not set SESSION_KEY +not set/)
    expect(screen).toContain("? Value ›")
    expect(screen).toContain("hidden as you type")
    expect(screen).toContain("enter save esc cancel")
    // $HOME is reserved and ${PORT:-80} has a default: neither is listed.
    expect(screen).not.toContain("HOME")
    expect(screen).not.toContain("PORT")

    await setValue(app, DATABASE)
    look()
    screen = words(app.draw())
    expect(top(app.state)).toMatchObject({ at: 1, done: ["DATABASE_URL"], question: "value" })
    expect(screen).toContain("2 of 2")
    expect(screen).toContain("! compose.yaml expects 1 value that is not set yet.")
    expect(screen).toContain("Set it now, or press esc and deploy without it.")
    expect(screen).toMatch(/DATABASE_URL +set ❯ SESSION_KEY +not set/)

    await setValue(app, SESSION)
    await ended(app)
    look()
    expect(app.state.deploy).toMatchObject({ sequence: 2, outcome: "started", secretNames: ["DATABASE_URL", "SESSION_KEY"] })
    const env = m.docker.calls().at(-1)!.env
    expect(env.DATABASE_URL).toBe(DATABASE)
    expect(env.SESSION_KEY).toBe(SESSION)
    for (const frame of seen) {
      expect(frame).not.toContain(DATABASE)
      expect(frame).not.toContain(SESSION)
    }
    for (const file of filesUnder(m.home)) {
      expect(file.content).not.toContain(DATABASE)
      expect(file.content).not.toContain(SESSION)
    }
    expect(readFileSync(join(m.project, "zekno.json"), "utf8")).not.toContain("only-the-runner")
    expect(app.failures).toEqual([])
  })

  test("or skipped: esc deploys without them, and the list is not shown again for that deploy", async () => {
    const { m, app } = await onHome(COMPOSE_TWO, (m) => link(m, { app: "demo", server: "dev" }))
    app.type("d")
    await app.until(() => top(app.state).name === "set-secret", "the list")
    app.press({ kind: "escape" })
    await ended(app)
    expect(app.state.deploy).toMatchObject({ sequence: 2, outcome: "started" })
    expect(m.docker.calls().at(-1)!.env.DATABASE_URL).toBeUndefined()
    expect(app.failures).toEqual([])
  })

  test("a value already set is not listed; with every value set there is no list", async () => {
    const { m, app } = await onHome(COMPOSE_TWO, async (m) => {
      link(m, { app: "demo", server: "dev" })
      m.typing("set-before")
      expect(await m.zekno("secret", "set", "DATABASE_URL")).toBe(0)
    })
    app.type("d")
    await app.until(() => top(app.state).name === "set-secret", "the list")
    expect(top(app.state)).toMatchObject({ missing: ["SESSION_KEY"] })
    await setValue(app, "now-set")
    await ended(app)
    app.press({ kind: "escape" })
    app.type("d")
    await app.until(() => app.state.deploy?.sequence === 3 && !app.state.deploy.running, "deploy 3 with no list")
    expect(m.docker.calls().at(-1)!.env).toMatchObject({ DATABASE_URL: "set-before", SESSION_KEY: "now-set" })
  })

  test("in a folder that is not linked: first the question, then the list", async () => {
    const { m, app } = await onHome(COMPOSE_TWO)
    app.type("d")
    await app.until(() => app.state.question !== undefined, "the question")
    app.press({ kind: "enter" })
    await app.until(() => top(app.state).name === "set-secret", "the list")
    expect(existsSync(join(m.project, "zekno.json"))).toBe(true)
    app.press({ kind: "escape" })
    await ended(app)
    expect(app.state.deploy).toMatchObject({ sequence: 2, outcome: "started" })
  })

  test("on a server with no apps yet, d deploys the app the folder is linked to", async () => {
    const m = await ready()
    expect(await m.zekno("server", "add", "staging", "--local", "--home", tempDir("staging"))).toBe(0)
    m.compose(COMPOSE_PLAIN)
    link(m, { app: "fresh", server: "staging" })
    const app = openApp(m, await loadStart(m.deps))
    expect(top(app.state)).toEqual({ name: "home", pane: "servers", server: 1, app: 0 })
    app.type("d")
    await ended(app)
    expect(app.state.deploy).toMatchObject({ server: "staging", app: "fresh", sequence: 1, outcome: "started" })
    expect(app.failures).toEqual([])
  })

  test("a zekno.json whose Compose file leads outside its folder is refused at d, and nothing is signed", async () => {
    const { m, app } = await onHome(COMPOSE_PLAIN, (m) => {
      const outside = join(tempDir("outside"), "private.yaml")
      writeFileSync(outside, COMPOSE_PLAIN)
      symlinkSync(outside, join(m.project, "linked.yaml"))
      link(m, { app: "demo", server: "dev", compose: "linked.yaml" })
    })
    app.type("d")
    await app.until(() => app.state.notice !== undefined, "a line")
    expect(app.state.notice).toEqual({
      tone: "error",
      text: `linked.yaml, named by ${fileOf(m)}, leads outside the folder that holds it. zekno does not follow it there.`,
    })
    expect(app.state.deploy).toBeUndefined()
    expect(m.docker.calls()).toHaveLength(1)
  })
})

describe("the two screens, and the reducer's part", () => {
  const TEAM = { member: "Ada", version: 2, servers: [{ name: "prod", apps: [{ name: "demo", state: "unknown" as const }] }] }
  const home = () => initialState({ kind: "team", team: TEAM }, { columns: 100, rows: 30 })
  const fits = (screen: string, columns: number) => {
    for (const line of screen.split("\n")) expect([...line].length).toBeLessThanOrEqual(columns)
  }

  test("both fit at 80 columns, with the board's words", () => {
    const asked = update(home(), { type: "ask-remember-folder", server: "prod", app: "demo", compose: "compose.yaml" }).state
    const question = draw(asked, 80, 24)
    fits(question, 80)
    expect(words(question)).toContain("Write zekno.json here, so this folder always deploys demo to prod.")
    const listed = update(home(), { type: "missing-values", server: "prod", app: "demo", names: ["DATABASE_URL", "SESSION_KEY"], file: "compose.yaml" }).state
    const list = draw(listed, 80, 24)
    fits(list, 80)
    expect(words(list)).toContain("! compose.yaml expects 2 values that are not set yet.")
  })

  test("after a value is stored, the next name not set yet is asked, going round to an earlier one left out", () => {
    let state = update(home(), { type: "missing-values", server: "prod", app: "demo", names: ["A", "B", "C"] }).state
    // Ctrl-C closes the prompt; ↓ ↓ and enter ask for C first.
    for (const k of [{ kind: "ctrl-c" }, { kind: "down" }, { kind: "down" }, { kind: "enter" }] as AppKey[]) state = update(state, { type: "key", key: k }).state
    expect(top(state)).toMatchObject({ at: 2, question: "value" })
    const saved = { type: "secret-saved", notice: { tone: "success", text: "set" } } as const
    state = update(state, saved).state
    expect(top(state)).toMatchObject({ at: 0, done: ["C"], question: "value" })
    state = update(state, saved).state
    expect(top(state)).toMatchObject({ at: 1, done: ["C", "A"] })
    const last = update(state, saved)
    expect(top(last.state).name).toBe("home")
    expect(last.effects).toEqual([{ kind: "deploy-continue", server: "prod", app: "demo", answer: "values-set" }])
  })

  test("writing zekno.json marks the folder linked; a project file that cannot be used is a line from the start", () => {
    const linked = update(home(), { type: "linked", linked: { server: "prod", app: "demo", compose: "compose.yaml" } }).state
    expect(linked.linked).toEqual({ server: "prod", app: "demo", compose: "compose.yaml" })
    expect(words(draw(linked))).toContain("This folder is linked to demo on prod by zekno.json.")
    const problem = initialState({ kind: "team", team: TEAM, problem: "zekno.json is not valid JSON." }, { columns: 100, rows: 30 })
    expect(problem.notice).toEqual({ tone: "error", text: "zekno.json is not valid JSON." })
  })
})
