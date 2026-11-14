import { afterEach, describe, expect, test } from "bun:test"
import { renderToString, type Key } from "ink"
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir, waitFor } from "../../runner/test/helpers"
import { acceptedLinks } from "../src/accepted"
import { AppView, createStore } from "../src/app/app"
import { createEffects, linkedElsewhere, loadStart, type Effects } from "../src/app/effects"
import { emptyHiddenValue, hiddenPromptKey } from "../src/app/hidden-prompt"
import type { AppKey } from "../src/app/keys"
import { nameWindow } from "../src/app/screens/set-secret"
import { hiddenPromptOpen, initialState, NOT_DEPLOYED, top, update, type State } from "../src/app/state"
import type { OpDeps } from "../src/context"
import { MISSING_APP, MISSING_SERVER } from "../src/errors"
import { connect } from "../src/transport"
import { COMPOSE_V1, COMPOSE_V2, filesUnder, machine, ready } from "./helpers"

type Machine = ReturnType<typeof machine>

/** A Compose file that expects two values, one listed with no value and one used in another, and has one of its own. */
const COMPOSE_TWO =
  "services:\n  web:\n    image: example/web:1\n    environment:\n      - DATABASE_URL\n      - AUTH=${SESSION_KEY}\n      - GREETING=hello\n    command: echo $$HOME $HOME ${PORT:-80}\n"
/** One that expects nothing. */
const COMPOSE_PLAIN = "services:\n  web:\n    image: example/web:1\n"

/** Writes zekno.json by hand, as a cloned repository brings it. Nothing on this machine has accepted it. */
const link = (m: Machine, content: unknown, folder = m.project) =>
  writeFileSync(join(folder, "zekno.json"), typeof content === "string" ? content : JSON.stringify(content))
/** Writes zekno.json by hand and accepts it the way a person would: `zekno link` in its folder, with no names. */
async function linkAccepted(m: Machine, content: unknown, folder = m.project) {
  link(m, content, folder)
  const cwd = m.deps.cwd
  m.deps.cwd = folder
  try {
    expect(await m.zekno("link")).toBe(0)
    expect(m.lastOut()).toStartWith("Accepted zekno.json: ")
  } finally {
    m.deps.cwd = cwd
  }
}
const deployed = (m: Machine, app: string) => readFileSync(join(m.runnerHome, "apps", app, "compose.yaml"), "utf8")
/**
 * The project folder as zekno finds it: the folders a program is in are
 * real paths, and temporary folders on macOS are reached through a link.
 */
const folderOf = (m: Machine) => realpathSync(m.project)
const fileOf = (m: Machine) => join(folderOf(m), "zekno.json")

const draw = (state: State, columns = 100, rows = 30) => renderToString(<AppView state={state} columns={columns} rows={rows} />, { columns })
/** The key hints: the last line drawn, without the margins. */
const lastLine = (screen: string) => screen.trimEnd().split("\n").at(-1)!.trim()
/** All the text, with the box lines and runs of spaces taken out, for wording that may wrap. */
const words = (screen: string) => screen.replace(/[│╭╮╰╯─]/g, " ").replace(/\s+/g, " ")

describe("single commands in a linked folder", () => {
  test("`zekno deploy` with no flags takes the app, the server and the Compose file from zekno.json, also from a sub-folder", async () => {
    const m = await ready()
    mkdirSync(join(m.project, "deploy"))
    writeFileSync(join(m.project, "deploy", "prod.yaml"), COMPOSE_V2)
    await linkAccepted(m, { app: "web", server: "dev", compose: "deploy/prod.yaml" })
    expect(await m.zekno("deploy")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 1 of web is running on dev with no secrets.")
    expect(deployed(m, "web")).toBe(COMPOSE_V2)

    // From a folder below, the same file applies, and its Compose file is found from the file's own folder.
    m.deps.cwd = join(m.project, "deploy")
    writeFileSync(join(m.project, "deploy", "prod.yaml"), COMPOSE_V1)
    expect(await m.zekno("deploy")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 2 of web is running on dev with no secrets.")
    expect(deployed(m, "web")).toBe(COMPOSE_V1)
    expect(m.docker.calls()).toHaveLength(2)
  })

  test("flags win over the file, one detail at a time, and its Compose file goes only with its own app", async () => {
    const m = await ready()
    const WEB = COMPOSE_V1.replace("web:1", "web-from-zekno-json:1")
    m.compose(WEB, "web.yaml")
    m.compose(COMPOSE_V2, "other.yaml")
    await linkAccepted(m, { app: "web", server: "dev", compose: "web.yaml" })
    // Another app: the server from the file, the Compose file as without one (compose.yaml here), never web.yaml.
    expect(await m.zekno("deploy", "--app", "api")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 1 of api is running on dev with no secrets.")
    expect(deployed(m, "api")).toBe(COMPOSE_V1)
    expect(await m.zekno("deploy", "--app", "api", "--server", "dev")).toBe(0)
    expect(deployed(m, "api")).toBe(COMPOSE_V1)
    // The file's own app, named or not, deploys the file's Compose file; -f wins over it.
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)
    expect(deployed(m, "web")).toBe(WEB)
    expect(await m.zekno("deploy", "-f", "other.yaml")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 2 of web is running on dev with no secrets.")
    expect(deployed(m, "web")).toBe(COMPOSE_V2)
    // A server typed on the command line is the typist's: the sentence does not blame the file.
    expect(await m.zekno("deploy", "--server", "prod")).toBe(1)
    expect(m.lastErr()).toBe('No server named "prod". Connected servers: dev.')
  })

  test("a zekno.json in a folder above does not hand its Compose file to another app below it", async () => {
    const m = await ready()
    m.compose("services:\n  rootsvc:\n    image: example/root:1\n", "root.yaml")
    await linkAccepted(m, { app: "web", server: "dev", compose: "root.yaml" })
    const billing = join(m.project, "services", "billing")
    mkdirSync(billing, { recursive: true })
    const BILLING = "services:\n  billing:\n    image: example/billing:1\n"
    writeFileSync(join(billing, "compose.yaml"), BILLING)
    m.deps.cwd = billing
    expect(await m.zekno("deploy", "--app", "billing", "--server", "dev")).toBe(0)
    expect(deployed(m, "billing")).toBe(BILLING)
  })

  test("secret, status, rollback and logs take their defaults from it too; the value is asked for with the app and server named", async () => {
    const m = await ready()
    await linkAccepted(m, { app: "web", server: "dev" })
    const asked: string[] = []
    const ask = m.deps.ui.askSecret
    m.deps.ui.askSecret = (question, stdin) => (asked.push(question), ask(question, stdin))
    m.typing("hello")
    expect(await m.zekno("secret", "set", "GREETING")).toBe(0)
    expect(asked).toEqual(["Value for GREETING (web on dev): "])
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
    expect(m.lastOut()).toBe("Deploy 3 of web is running on dev with 1 secret.")
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
    // Accepted while prod was connected; prod has since been taken off this machine's profile.
    expect(await m.zekno("server", "add", "prod", "--local", "--home", tempDir("prod"))).toBe(0)
    await linkAccepted(m, { app: "web", server: "prod" })
    m.tamper("profile.json", (profile) => ({ ...profile, servers: profile.servers.filter((server: { name: string }) => server.name !== "prod") }))
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
      ['{"app":"web","server":"dev","app":"api"}', `${path} has the same field more than once.`],
    ]
    for (const [content, sentence] of cases) {
      link(m, content)
      expect(await m.zekno("deploy")).toBe(1)
      expect(m.lastErr()).toBe(sentence)
    }
    // Accepted with its Compose file in place; the file then goes, or is swapped for a link out of the folder.
    m.compose(COMPOSE_V1, "linked.yaml")
    await linkAccepted(m, { app: "web", server: "dev", compose: "linked.yaml" })
    rmSync(join(m.project, "linked.yaml"))
    expect(await m.zekno("deploy")).toBe(1)
    expect(m.lastErr()).toBe(`${path} names linked.yaml as the Compose file, and there is no such file in ${folderOf(m)}.`)
    // A Compose file reached through a link out of the folder is never read or sent.
    const outside = join(tempDir("outside"), "private.yaml")
    writeFileSync(outside, "services:\n  leak:\n    image: private\n")
    symlinkSync(outside, join(m.project, "linked.yaml"))
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

  test("with no zekno.json, a compose.yaml that is a link out of the folder is not sent; -f names a file anywhere", async () => {
    const m = await ready()
    const outside = join(tempDir("outside"), "private.yaml")
    writeFileSync(outside, "services:\n  leak:\n    image: private\n")
    rmSync(join(m.project, "compose.yaml"))
    symlinkSync(outside, join(m.project, "compose.yaml"))
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(1)
    expect(m.lastErr()).toBe("compose.yaml leads outside this folder through a symbolic link, so zekno does not read it. To deploy that file, name it with `-f <file>`.")
    expect(m.docker.calls()).toEqual([])
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev", "-f", outside)).toBe(0)
    // A named pipe in its place is not waited on.
    rmSync(join(m.project, "compose.yaml"))
    Bun.spawnSync(["mkfifo", join(m.project, "compose.yaml")])
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(1)
    expect(m.lastErr()).toBe(`${join(m.project, "compose.yaml")} is not a file.`)
  })
})

describe("a folder nobody on this machine linked (the reviewer's scenario)", () => {
  const HOSTILE = "services:\n  exfil:\n    image: attacker/exfil:1\n    environment:\n      - DB_PASSWORD\n"

  /** api on dev, deployed with a secret, and a cloned folder whose zekno.json names api on dev and whose Compose file wants that secret. */
  async function cloned() {
    const m = await ready()
    m.compose("services:\n  api:\n    image: example/api:1\n    environment:\n      - DB_PASSWORD\n")
    m.typing("hunter2-prod-db")
    expect(await m.zekno("secret", "set", "DB_PASSWORD", "--app", "api", "--server", "dev")).toBe(0)
    expect(await m.zekno("deploy", "--app", "api", "--server", "dev")).toBe(0)
    const folder = tempDir("cloned")
    writeFileSync(join(folder, "zekno.json"), JSON.stringify({ app: "api", server: "dev" }))
    writeFileSync(join(folder, "compose.yaml"), HOSTILE)
    m.deps.cwd = folder
    // Every runner process a command starts, and every read of the keychain, is counted.
    let started = 0
    m.deps.connect = (...args) => (started++, connect(...args))
    let keychain = 0
    const get = m.keyStore.get
    m.keyStore.get = (name) => (keychain++, get(name))
    return { m, folder, started: () => started, keychain: () => keychain }
  }

  test("every command that would take a name from it stops with status 2 and says why; nothing is read, signed, sent or started", async () => {
    const { m, folder, started, keychain } = await cloned()
    const ups = m.docker.calls().length
    const sentence = `zekno.json in ${realpathSync(folder)} names api on dev. It was not made or accepted on this machine. To use it, run \`zekno link\` in that folder. To leave it aside, give --app and --server.`
    m.typing("sk_live_typed_here")
    const commands = [["deploy"], ["rollback"], ["secret", "set", "X"], ["secret", "rm", "X"], ["secret", "ls"], ["status"], ["logs", "--no-follow"]]
    for (const args of commands) {
      expect({ args, status: await m.zekno(...args) }).toEqual({ args, status: 2 })
      expect(m.lastErr()).toStartWith(sentence)
    }
    expect(started()).toBe(0)
    expect(keychain()).toBe(0)
    expect(m.docker.calls()).toHaveLength(ups)
    // Nothing was asked for: the value queued for the prompt is still there.
    m.deps.cwd = m.project
    m.deps.connect = connect
    expect(await m.zekno("secret", "set", "STRIPE_KEY", "--app", "api", "--server", "dev")).toBe(0)
    expect(m.lastOut()).toStartWith("Set STRIPE_KEY (version 1)")
  })

  test("given --app and --server, it is left aside, Compose file and all; once accepted with zekno link it is used, until it changes", async () => {
    const { m, folder } = await cloned()
    writeFileSync(join(folder, "compose.yaml"), COMPOSE_V1)
    writeFileSync(join(folder, "other.yaml"), HOSTILE)
    writeFileSync(join(folder, "zekno.json"), JSON.stringify({ app: "api", server: "dev", compose: "other.yaml" }))
    expect(await m.zekno("deploy", "--app", "api", "--server", "dev")).toBe(0)
    expect(deployed(m, "api")).toBe(COMPOSE_V1)

    writeFileSync(join(folder, "zekno.json"), JSON.stringify({ app: "api", server: "dev" }))
    writeFileSync(join(folder, "compose.yaml"), HOSTILE)
    expect(await m.zekno("link")).toBe(0)
    expect(m.lastOut()).toBe("Accepted zekno.json: api on dev, file compose.yaml.")
    expect(acceptedLinks(m.home)).toHaveLength(1)
    expect(await m.zekno("deploy")).toBe(0)
    expect(deployed(m, "api")).toBe(HOSTILE)

    // A `git pull` that changes it: not used again until it is accepted again.
    writeFileSync(join(folder, "zekno.json"), JSON.stringify({ app: "api", server: "dev", compose: "other.yaml" }))
    expect(await m.zekno("deploy")).toBe(2)
    expect(m.lastErr()).toContain("It was not made or accepted on this machine.")
  })

  test("given --app and --server, a zekno.json that cannot be read is left aside too, and the folder's compose.yaml is deployed", async () => {
    const m = await ready()
    symlinkSync("/etc/hosts", join(m.project, "zekno.json"))
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)
    expect(deployed(m, "web")).toBe(COMPOSE_V1)
    // A command that would take a name from it still stops, and names it.
    expect(await m.zekno("deploy", "--app", "web")).toBe(1)
    expect(m.lastErr()).toContain("is a symbolic link")
  })

  test("`zekno link` given one name never fills the other from it: it stops with status 2, writes nothing, accepts nothing; with no names it is accepted", async () => {
    const { m, folder } = await cloned()
    const sub = join(folder, "services", "api")
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, "compose.yaml"), COMPOSE_V1)
    m.deps.cwd = sub
    const sentence = `zekno.json in ${realpathSync(folder)} names api on dev. It was not made or accepted on this machine. To use it, run \`zekno link\` in that folder. To leave it aside, give --app and --server.`
    for (const args of [["--app", "api"], ["--server", "dev"], ["-f", "compose.yaml"], ["--app", "api", "--force"]]) {
      expect({ args, status: await m.zekno("link", ...args) }).toEqual({ args, status: 2 })
      expect(m.lastErr()).toStartWith(sentence)
    }
    // In its own folder too, where names that are its own would accept it as it is.
    m.deps.cwd = folder
    expect(await m.zekno("link", "--app", "api")).toBe(2)
    expect(existsSync(join(sub, "zekno.json"))).toBe(false)
    expect(acceptedLinks(m.home)).toEqual([])
    expect(await m.zekno("deploy")).toBe(2)

    // Both names typed take nothing from it.
    m.deps.cwd = sub
    expect(await m.zekno("link", "--app", "api", "--server", "dev")).toBe(0)
    expect(JSON.parse(readFileSync(join(sub, "zekno.json"), "utf8"))).toEqual({ app: "api", server: "dev", compose: "compose.yaml" })
    // With no names, `zekno link` is how it is accepted, and says what it accepted; after that one name fills from it.
    m.deps.cwd = folder
    expect(await m.zekno("link")).toBe(0)
    expect(m.lastOut()).toBe("Accepted zekno.json: api on dev, file compose.yaml.")
    rmSync(join(sub, "zekno.json"))
    m.deps.cwd = sub
    expect(await m.zekno("link", "--app", "api")).toBe(0)
    expect(JSON.parse(readFileSync(join(sub, "zekno.json"), "utf8"))).toEqual({ app: "api", server: "dev", compose: "compose.yaml" })
  })

  test("in the app, Home does not move to its app, says why on the problem line, and d deploys nothing and offers nothing", async () => {
    const { m, folder, started } = await cloned()
    const ups = m.docker.calls().length
    const deps: OpDeps = { ...m.deps, connect: m.deps.connect }
    const app = openApp(m, await loadStart(deps), deps)
    const sentence = "zekno.json here names api on dev. It was not made or accepted on this machine. Run `zekno link` to accept it."
    expect(app.state.linked).toBeUndefined()
    expect(top(app.state)).toEqual({ name: "home", pane: "servers", server: 0, app: 0 })
    expect(app.state.notice).toEqual({ tone: "error", text: sentence })
    expect(words(app.draw())).toContain(sentence)
    expect(words(app.draw())).not.toContain("This folder is linked")
    app.press({ kind: "right" })
    app.type("d")
    await Bun.sleep(150)
    expect(app.state.notice).toEqual({ tone: "error", text: sentence })
    expect(app.state.question).toBeUndefined()
    expect(top(app.state).name).toBe("home")
    expect(app.state.deploy).toBeUndefined()
    expect(started()).toBe(0)
    expect(m.docker.calls()).toHaveLength(ups)
    expect(existsSync(join(folder, "zekno.json"))).toBe(true)
    expect(readFileSync(join(folder, "zekno.json"), "utf8")).toBe(JSON.stringify({ app: "api", server: "dev" }))
    expect(app.failures).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The app

/** The effects of every app a test opened: closed after each test, so no runner a test reached is left running. */
const opened: Effects[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((effects) => effects.close()))
})

/** The app on a test machine, without a terminal: the reducer, the effects, and the window drawn on request. */
function openApp(m: Machine, start: Awaited<ReturnType<typeof loadStart>>, deps: OpDeps = m.deps) {
  const failures: unknown[] = []
  let effects: Effects | undefined
  const store = createStore(initialState(start, { columns: 100, rows: 30 }), (effect) => {
    if (effect.kind !== "exit") effects!.run(effect)
  })
  effects = createEffects(deps, store.dispatch, (error) => failures.push(error))
  opened.push(effects)
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
async function onHome(compose: string, prepare?: (m: Machine) => Promise<unknown> | unknown) {
  const m = await ready()
  expect(await m.zekno("deploy", "--app", "demo", "--server", "dev")).toBe(0)
  m.compose(compose)
  await prepare?.(m)
  const app = openApp(m, await loadStart(m.deps))
  app.press({ kind: "right" })
  return { m, app }
}

const ended = (app: App) => app.until(() => app.state.deploy?.running === false, "the deploy to end")

/** Goes ahead without the values not set: esc closes the prompt, esc on the list asks, and y answers (P4). */
function skipValues(app: App) {
  expect(hiddenPromptOpen(app.state)).toBe(true)
  app.press({ kind: "escape" })
  expect(top(app.state)).toMatchObject({ name: "set-secret", question: undefined })
  app.press({ kind: "escape" })
  expect(app.state.question?.kind).toBe("skip-values")
  app.type("y")
}

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
    await linkAccepted(m, { app: "demo", server: "staging" })
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
    const foreign = await loadStart(m.deps)
    expect(foreign).toMatchObject({
      kind: "team",
      problem: "zekno.json here names web on prod. It was not made or accepted on this machine. Run `zekno link` to accept it.",
    })
    expect(foreign.kind === "team" && foreign.linked).toBeUndefined()
    // From a folder below, the file is named by its path.
    mkdirSync(join(m.project, "sub"))
    expect(await loadStart({ ...m.deps, cwd: join(m.project, "sub") })).toMatchObject({ problem: `${fileOf(m)} names web on prod. It was not made or accepted on this machine. Run \`zekno link\` to accept it.` })
    // Accepted while prod was connected; prod has since been taken off this machine's profile.
    expect(await m.zekno("server", "add", "prod", "--local", "--home", tempDir("prod"))).toBe(0)
    await linkAccepted(m, { app: "web", server: "prod" })
    m.tamper("profile.json", (profile) => ({ ...profile, servers: profile.servers.filter((server: { name: string }) => server.name !== "prod") }))
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
    // Written by a "yes" here, so accepted on this machine.
    expect(acceptedLinks(m.home).map((entry) => entry.path)).toEqual([fileOf(m)])
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
    const { m, app } = await onHome(COMPOSE_TWO, (m) => linkAccepted(m, { app: "demo", server: "dev" }))
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

  test("esc at the prompt returns to the list and signs nothing; esc on the list asks; n deploys nothing, y deploys without them", async () => {
    const { m, app } = await onHome(COMPOSE_TWO, (m) => linkAccepted(m, { app: "demo", server: "dev" }))
    const ups = m.docker.calls().length
    app.type("d")
    await app.until(() => top(app.state).name === "set-secret", "the list")
    expect(lastLine(app.draw())).toBe("enter save  esc cancel")
    app.press({ kind: "escape" })
    expect(top(app.state)).toMatchObject({ name: "set-secret", question: undefined })
    expect(lastLine(app.draw())).toBe("↑↓ move  enter set  esc deploy without them")
    await Bun.sleep(100)
    expect(app.state.deploy).toBeUndefined()

    app.press({ kind: "escape" })
    expect(app.state.question).toEqual({ kind: "skip-values", server: "dev", app: "demo", names: ["DATABASE_URL", "SESSION_KEY"] })
    const asked = app.draw()
    expect(words(asked)).toContain("Deploy demo to dev without 2 values?")
    expect(lastLine(asked)).toBe("y deploy  n do not deploy")
    app.type("n")
    expect(top(app.state).name).toBe("home")
    expect(app.state.notice).toEqual({ tone: "info", text: NOT_DEPLOYED })
    expect(words(app.draw())).toContain(NOT_DEPLOYED)
    await Bun.sleep(100)
    expect(app.state.deploy).toBeUndefined()
    expect(m.docker.calls()).toHaveLength(ups)

    // Esc on the question is no as well.
    app.type("d")
    await app.until(() => top(app.state).name === "set-secret", "the list again")
    app.press({ kind: "escape" }, { kind: "escape" }, { kind: "escape" })
    expect(top(app.state).name).toBe("home")
    expect(app.state.notice?.text).toBe(NOT_DEPLOYED)

    app.type("d")
    await app.until(() => top(app.state).name === "set-secret", "the list once more")
    skipValues(app)
    await ended(app)
    expect(app.state.deploy).toMatchObject({ sequence: 2, outcome: "started" })
    expect(m.docker.calls()).toHaveLength(ups + 1)
    expect(m.docker.calls().at(-1)!.env.DATABASE_URL).toBeUndefined()
    expect(app.failures).toEqual([])
  })

  test("what is signed is the text whose names were listed: an edit while the list is open is not deployed", async () => {
    const { m, app } = await onHome(COMPOSE_TWO, (m) => linkAccepted(m, { app: "demo", server: "dev" }))
    app.type("d")
    await app.until(() => top(app.state).name === "set-secret", "the list")
    m.compose(COMPOSE_PLAIN.replace("web:1", "edited-meanwhile:1"))
    skipValues(app)
    await ended(app)
    expect(deployed(m, "demo")).toBe(COMPOSE_TWO)
  })

  test("a value already set is not listed; with every value set there is no list", async () => {
    const { m, app } = await onHome(COMPOSE_TWO, async (m) => {
      await linkAccepted(m, { app: "demo", server: "dev" })
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
    skipValues(app)
    await ended(app)
    expect(app.state.deploy).toMatchObject({ sequence: 2, outcome: "started" })
  })

  test("on a server with no apps yet, d deploys the app the folder is linked to", async () => {
    const m = await ready()
    expect(await m.zekno("server", "add", "staging", "--local", "--home", tempDir("staging"))).toBe(0)
    m.compose(COMPOSE_PLAIN)
    await linkAccepted(m, { app: "fresh", server: "staging" })
    expect(await m.zekno("server", "add", "empty", "--local", "--home", tempDir("empty"))).toBe(0)
    const app = openApp(m, await loadStart(m.deps))
    expect(top(app.state)).toEqual({ name: "home", pane: "servers", server: 1, app: 0 })
    // Another server with no apps is not the folder's: nothing is deployed there.
    app.press({ kind: "down" })
    app.type("d")
    await app.until(() => app.state.notice !== undefined, "a line")
    expect(app.state.notice).toEqual({ tone: "info", text: linkedElsewhere({ app: "fresh", server: "staging" }) })
    expect(app.state.deploy).toBeUndefined()
    app.press({ kind: "up" })
    app.type("d")
    await ended(app)
    expect(app.state.deploy).toMatchObject({ server: "staging", app: "fresh", sequence: 1, outcome: "started" })
    expect(app.failures).toEqual([])
  })

  test("a folder linked to an app its server does not have yet: d deploys it as a first deploy, whichever row is marked, and replaces nothing", async () => {
    const { m, app } = await onHome(COMPOSE_PLAIN, async (m) => {
      expect(await m.zekno("deploy", "--app", "billing", "--server", "dev")).toBe(0)
      expect(await m.zekno("link", "--app", "fresh", "--server", "dev")).toBe(0)
    })
    // The linked app is not on the server yet, so it has no row to select: another app is marked.
    const before = app.state.team!.servers[0]!.apps.map((row) => [row.name, row.deploy])
    expect(before.map(([name]) => name)).not.toContain("fresh")
    expect(before.length).toBeGreaterThan(0)
    app.type("d")
    await ended(app)
    expect(app.state.deploy).toMatchObject({ server: "dev", app: "fresh", sequence: 1, outcome: "started" })
    // The apps that were there were not touched: each still has the deploy it had.
    const after = app.state.team!.servers[0]!.apps.map((row) => [row.name, row.deploy])
    for (const row of before) expect(after).toContainEqual(row)
    expect(after.map(([name]) => name)).toContain("fresh")
    expect(app.failures).toEqual([])
  })

  test("a linked folder deploys only to its own app: d on another app says so, names how to deploy elsewhere, and deploys nothing", async () => {
    const { m, app } = await onHome(COMPOSE_PLAIN, async (m) => {
      expect(await m.zekno("deploy", "--app", "billing", "--server", "dev")).toBe(0)
      expect(await m.zekno("link", "--app", "demo", "--server", "dev")).toBe(0)
    })
    const ups = m.docker.calls().length
    const rows = app.state.team!.servers[0]!.apps.map((row) => row.name)
    // billing was deployed last, so it is listed first.
    expect(rows).toEqual(["billing", "demo"])
    expect(top(app.state)).toMatchObject({ name: "home", pane: "apps", app: 1 })
    app.press({ kind: "up" })
    app.type("d")
    await app.until(() => app.state.notice !== undefined, "a line")
    const sentence =
      "This folder is linked to demo on dev. Select it to deploy this folder. To deploy it elsewhere, run `zekno deploy --app <name> --server <name>` here."
    expect(app.state.notice).toEqual({ tone: "info", text: sentence })
    expect(words(app.draw())).toContain(sentence)
    await Bun.sleep(100)
    expect(app.state.deploy).toBeUndefined()
    expect(m.docker.calls()).toHaveLength(ups)
    // The same from the app screen. Opening it leaves the line behind.
    app.press({ kind: "enter" })
    await app.until(() => app.state.appView?.app === "billing", "billing's history")
    expect(app.state.notice).toBeUndefined()
    app.type("d")
    await app.until(() => app.state.notice !== undefined, "a line")
    expect(app.state.notice?.text).toBe(sentence)
    expect(m.docker.calls()).toHaveLength(ups)
    expect(app.failures).toEqual([])
  })

  test("a zekno.json whose Compose file leads outside its folder is refused at d, and nothing is signed", async () => {
    const { m, app } = await onHome(COMPOSE_PLAIN, async (m) => {
      // Accepted with its Compose file in place; then swapped for a link out of the folder.
      m.compose(COMPOSE_PLAIN, "linked.yaml")
      await linkAccepted(m, { app: "demo", server: "dev", compose: "linked.yaml" })
      rmSync(join(m.project, "linked.yaml"))
      const outside = join(tempDir("outside"), "private.yaml")
      writeFileSync(outside, COMPOSE_PLAIN)
      symlinkSync(outside, join(m.project, "linked.yaml"))
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

  test("the list of missing names fits the window: the line that says how many and the marked name are always drawn", () => {
    for (const size of [
      { columns: 80, rows: 24 },
      { columns: 100, rows: 30 },
    ]) {
      for (const count of [3, 4, 20, 64]) {
        const names = Array.from({ length: count }, (_, n) => `VALUE_NUMBER_${n}`)
        let state = update(home(), { type: "missing-values", server: "prod", app: "demo", names, file: "compose.yaml" }).state
        state = update(state, { type: "resize", ...size }).state
        for (const at of [0, Math.floor(count / 2), count - 1]) {
          const marked = { ...state, stack: [...state.stack.slice(0, -1), { ...top(state), at }] } as State
          const shown = [marked, update(marked, { type: "key", key: { kind: "escape" } }).state, { ...marked, notice: { tone: "success", text: "Set A." } } as State]
          for (const each of shown) {
            const screen = draw(each, size.columns, size.rows)
            const lines = screen.split("\n")
            const what = { size, count, at, prompt: hiddenPromptOpen(each), notice: each.notice !== undefined }
            expect({ what, lines: lines.length }).toEqual({ what, lines: size.rows })
            expect({ what, said: lines.some((line) => line.includes(`! compose.yaml expects ${count} values that are not set yet.`)) }).toEqual({ what, said: true })
            expect({ what, marked: lines.some((line) => new RegExp(`❯ VALUE_NUMBER_${at} +not set`).test(line)) }).toEqual({ what, marked: true })
            expect({ what, hints: lastLine(screen).length > 0 }).toEqual({ what, hints: true })
            // Nothing is drawn over anything else: the foot's lines are whole.
            const foot = ["Encrypted on this machine for prod's key and signed by you.", "It cannot be shown again after it is set, only replaced."]
            for (const text of foot) expect({ what, text, whole: lines.some((line) => line.trim() === text) }).toEqual({ what, text, whole: true })
            if (count >= 20) expect(words(screen)).toMatch(/and \d+ more/)
          }
        }
      }
    }
  })

  test("which names are drawn: all when they fit, else a window around the marked one and a line for the rest", () => {
    expect(nameWindow(3, 2, 5)).toEqual({ start: 0, end: 3, hidden: 0 })
    expect(nameWindow(20, 0, 5)).toEqual({ start: 0, end: 4, hidden: 16 })
    expect(nameWindow(20, 10, 5)).toEqual({ start: 8, end: 12, hidden: 16 })
    expect(nameWindow(20, 19, 5)).toEqual({ start: 16, end: 20, hidden: 16 })
    expect(nameWindow(64, 63, 2)).toEqual({ start: 63, end: 64, hidden: 63 })
  })

  test("the question before deploying without them: its words, its keys, and q and other keys do nothing", () => {
    const listed = update(home(), { type: "missing-values", server: "prod", app: "demo", names: ["A", "B"] }).state
    // A was set from the list, and the prompt for B closed: only B is left.
    const left = { ...listed, stack: [...listed.stack.slice(0, -1), { ...top(listed), done: ["A"], at: 1, question: undefined }] } as State
    const state = update(left, { type: "key", key: { kind: "escape" } }).state
    expect(state.question).toEqual({ kind: "skip-values", server: "prod", app: "demo", names: ["B"] })
    expect(words(draw(state, 80, 24))).toContain("Deploy demo to prod without B?")
    for (const key of [{ kind: "text", text: "q" }, { kind: "enter" }, { kind: "down" }, { kind: "text", text: "d" }] as AppKey[]) {
      expect(update(state, { type: "key", key })).toEqual({ state, effects: [] })
    }
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
