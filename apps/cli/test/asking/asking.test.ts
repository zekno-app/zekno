/**
 * What single commands ask at a terminal, and what they never ask without
 * one (specs/006-cli-small-features, contracts/questions.md, "The lists each
 * command offers"; data-model.md, "Server row and app row").
 */
import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { runner, tempDir } from "../../../runner/test/support/helpers"
import {
  APP_NAME_RULE as A11,
  appRows,
  folderName,
  NO_SERVER_YET as A4,
  NO_TEAM_AT_TERMINAL as A3,
  noApps as A5,
  onlyServer as A1,
  whichApp,
  whichServer,
} from "../../src/asking/asking"
import { openTeam, teamOnce, type Team } from "../../src/cli/context"
import { appTaken as A12 } from "../../src/shared/app-names"
import { MISSING_APP, MISSING_SERVER } from "../../src/cli/errors"
import { isMemberName, type Server } from "../../src/profile/profile"
import type { ListQuestion } from "../../src/ui/types"
import runnerPackage from "../../../runner/package.json"
import { answering, COMPOSE_V1, filesUnder, machine, ready, twin, type Answer, type Asked } from "../support/helpers"
import { realRunner, sshStandIn, stallingRunner, standInServer, stillRunning, withSsh } from "../support/stand-in-server"

/** The version the repository's runner reports, which a stand-in release made from it carries. */
const OWN = runnerPackage.version

const PROD: Server = { name: "prod", serverId: `srv_${"1".repeat(32)}`, target: { kind: "ssh", destination: "deploy@203.0.113.7", runnerPath: "~/.local/bin/zekno-runner" } }
const STAGING: Server = { name: "staging", serverId: `srv_${"2".repeat(32)}`, target: { kind: "local", home: "/tmp/staging" } }

/** A verified team as far as the list of servers goes: whichServer reads nothing else of it. */
const teamWith = (servers: Server[]) => ({ profile: { servers } }) as unknown as Team

describe("the building blocks", () => {
  test("isMemberName is the rule a member's name is held to in the profile and the team list", () => {
    for (const name of ["ada", "Ada Lovelace", "a".repeat(64), "Zoë"]) expect({ name, ok: isMemberName(name) }).toEqual({ name, ok: true })
    for (const name of ["", "a".repeat(65), " ada", "ada ", "ada\nlovelace", "ada‮", "\x1b[31mada", "a b"]) {
      expect({ name, ok: isMemberName(name) }).toEqual({ name, ok: false })
    }
  })

  test("teamOnce: peek then take read the keychain once; a failed open is not kept", async () => {
    const m = machine()
    let reads = 0
    const keyStore = { ...m.keyStore, get: (name: string) => (reads++, m.keyStore.get(name)) }
    const once = teamOnce({ home: m.home, keyStore })
    expect(once.peek()).rejects.toThrow("No team on this machine yet.")
    await once.peek().catch(() => {})
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    // The open that failed before the team existed is forgotten: this one opens the team.
    expect((await once.peek()).profile.memberName).toBe("Ada")
    reads = 0
    const fresh = teamOnce({ home: m.home, keyStore })
    const peeked = await fresh.peek()
    expect(await fresh.peek()).toBe(peeked)
    expect(await fresh.take()).toBe(peeked)
    expect(reads).toBe(1)
    // Taken, it is not kept: the next take opens it again.
    await fresh.take()
    expect(reads).toBe(2)
    // trust then take, as before.
    reads = 0
    const judged = teamOnce({ home: m.home, keyStore })
    await judged.trust()
    await judged.take()
    expect(reads).toBe(1)
  })

  test("folderName: the folder's own name in lowercase, only when it is an app name", () => {
    const root = tempDir("folders")
    const named = (name: string) => {
      const path = join(root, name)
      mkdirSync(path)
      return path
    }
    expect(folderName(named("my-folder"))).toBe("my-folder")
    expect(folderName(named("MyApp"))).toBe("myapp")
    expect(folderName(named("my folder"))).toBeUndefined()
    expect(folderName(named("-x"))).toBeUndefined()
    expect(folderName(named("x".repeat(64)))).toBeUndefined()
    expect(folderName(join(root, "not-there"))).toBeUndefined()
  })

  test("whichServer: a flag or a linked server is used and nothing is asked", async () => {
    const m = machine()
    const a = answering(m, [])
    const team = teamWith([PROD, STAGING])
    expect(await whichServer(m.deps, team, { server: "staging" })).toEqual({ server: STAGING, how: "given" })
    expect(await whichServer(m.deps, team, { server: "prod", serverFrom: "~/shop/zekno.json" })).toEqual({ server: PROD, how: "linked" })
    expect(whichServer(m.deps, team, { server: "nope" })).rejects.toThrow('No server named "nope". Connected servers: prod, staging.')
    expect(a.asked).toEqual([])
    expect(a.lines).toEqual([])
  })

  test("whichServer: the one server is used and said with A1; none is A4", async () => {
    const m = machine()
    const a = answering(m, [])
    expect(await whichServer(m.deps, teamWith([PROD]), {})).toEqual({ server: PROD, how: "only" })
    expect(a.lines).toEqual([["note", "Using prod, your only server."]])
    expect(A1("prod")).toBe("Using prod, your only server.")
    expect(a.asked).toEqual([])
    expect(whichServer(m.deps, teamWith([]), {})).rejects.toThrow(A4)
    expect(A4).toBe("No server is connected yet. Run `zekno deploy` in a project folder, or `zekno server add`.")
  })

  test("whichServer: with two, Which server? with each server in the profile's order, collapsing to Server", async () => {
    const m = machine()
    const a = answering(m, [{ choose: "staging" }])
    let seen: ListQuestion<unknown> | undefined
    const choose = m.deps.ui.choose
    m.deps.ui.choose = (question) => ((seen = question as ListQuestion<unknown>), choose(question))
    expect(await whichServer(m.deps, teamWith([PROD, STAGING]), {})).toEqual({ server: STAGING, how: "asked" })
    expect(a.asked).toEqual([{ kind: "choose", question: "Which server?", rows: ["prod\tdeploy@203.0.113.7", "staging\tthis machine"] }])
    expect(seen?.collapsed).toBe("Server")
    // Where nobody can answer, the plain interface throws what the command says today.
    expect(seen?.missing.message).toBe(MISSING_SERVER)
  })
})

describe("the building blocks: the sentences and the limit", () => {
  test("A3", () => {
    expect(A3).toBe("No team on this machine yet. Run `zekno deploy` in a project folder, or `zekno init --name <you>`.")
  })

  test("main.ts reaches neither Ink nor React through its static imports: the interface is loaded only once DEV is out of the environment", () => {
    // main.ts loads Ink with `import()` inside `withoutDev`; a static import anywhere below it would load Ink first.
    const ts = new Bun.Transpiler({ loader: "ts" })
    const tsx = new Bun.Transpiler({ loader: "tsx" })
    const seen = new Set<string>()
    const reached: string[] = []
    const queue = [resolve(import.meta.dir, "../../src/main.ts")]
    while (queue.length > 0) {
      const file = queue.shift()!
      if (seen.has(file)) continue
      seen.add(file)
      const code = readFileSync(file, "utf8").replace(/^#!.*\n/, "")
      for (const found of (file.endsWith(".tsx") ? tsx : ts).scanImports(code)) {
        if (found.kind !== "import-statement") continue
        if (found.path === "ink" || found.path === "react" || found.path.startsWith("react/")) reached.push(`${found.path} from ${file}`)
        if (!found.path.startsWith(".")) continue
        const next = ["", ".ts", ".tsx"].map((ending) => resolve(dirname(file), found.path + ending)).find((path) => /\.tsx?$/.test(path) && existsSync(path))
        if (next) queue.push(next)
      }
    }
    expect(seen.size).toBeGreaterThan(20)
    expect(reached).toEqual([])
  })
})

describe("the building blocks: which app", () => {
  /** A ready machine that deployed web twice to dev, with the stand-in Docker saying it runs. */
  async function deployedTwice() {
    const m = await ready()
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)
    m.docker.ps("web", '{"Service":"web","State":"running","ExitCode":0,"Health":""}\n')
    const team = await openTeam(m.deps)
    return { m, team, server: team.profile.servers[0]! }
  }

  test("the apps the runner holds, read from it: deploy <n> and what is running", async () => {
    const { m, team, server } = await deployedTwice()
    const a = answering(m, [{ choose: "web" }])
    expect(await whichApp(m.deps, team, server, {}, { offerNew: false, folder: m.project })).toEqual({ app: "web", how: "asked", fresh: false })
    expect(a.asked).toEqual([{ kind: "choose", question: "Which app on dev?", rows: ["web\tdeploy 2, running"] }])
  })

  test("a runner that cannot be reached, or does not answer within the limit: this machine's history, deploy <n>", async () => {
    const { m, team, server } = await deployedTwice()
    m.deps.localRunner = ["sh", "-c", "exit 255"]
    const gone = answering(m, [{ choose: "web" }])
    await whichApp(m.deps, team, server, {}, { offerNew: false, folder: m.project })
    expect(gone.asked).toEqual([{ kind: "choose", question: "Which app on dev?", rows: ["web\tdeploy 2"] }])
    m.deps.localRunner = ["sh", "-c", "exec sleep 5"]
    const silent = answering(m, [{ choose: "web" }])
    const started = Date.now()
    await whichApp(m.deps, team, server, {}, { offerNew: false, folder: m.project, limitMs: 200 })
    expect(Date.now() - started).toBeLessThan(3000)
    expect(silent.asked).toEqual([{ kind: "choose", question: "Which app on dev?", rows: ["web\tdeploy 2"] }])
  })

  test("a runner that answers as one from before sessions, then never answers status (security review S2): the limit holds, and no process is left", async () => {
    const { m, team, server } = await deployedTwice()
    const pids = join(tempDir("pids"), "pids")
    const stalling = join(tempDir("stalling"), "zekno-runner")
    writeFileSync(stalling, stallingRunner(pids))
    chmodSync(stalling, 0o755)
    m.deps.localRunner = [stalling]
    const started = Date.now()
    const rows = await appRows(m.deps, team, server, { limitMs: 1000 })
    expect(Date.now() - started).toBeLessThan(3000)
    // The runner asked for its status, and was stopped at the limit: the list is this machine's history.
    expect(existsSync(pids)).toBe(true)
    expect(rows).toEqual([{ value: "web", label: "web", detail: "deploy 2" }])
    expect(await stillRunning(pids)).toEqual([])
  }, 20_000)

  test("names a runner sends that are not app names are never drawn: its answer is refused, and the history is offered", async () => {
    const { m, team, server } = await deployedTwice()
    const status = (await runner(m.runnerHome, m.docker.path, "status")).json as { lastSequence: Record<string, number> }
    const lying = { ...status, lastSequence: { "\x1b[2Jweb": 9, web: 2 } }
    const frame = (value: unknown) => `printf '%s\\n' '${JSON.stringify({ result: value }).replace(/'/g, "'\\''")}'`
    m.deps.localRunner = ["sh", "-c", `read -r l; ${frame({ version: "0.1.0", protocol: 2 })}; read -r l; ${frame(lying)}; read -r l; exit 1`]
    const a = answering(m, [{ choose: "web" }])
    await whichApp(m.deps, team, server, {}, { offerNew: false, folder: m.project })
    expect(a.asked).toEqual([{ kind: "choose", question: "Which app on dev?", rows: ["web\tdeploy 2"] }])
    expect(JSON.stringify(a.asked)).not.toContain("\\u001b")
  })

  test("deploy's list ends with + a new app; choosing it asks for a name with the folder's filled in, held to A11 and A12", async () => {
    const { m, team, server } = await deployedTwice()
    const a = answering(m, [{ choose: "+ a new app" }, { type: "web" }, { type: "Not-An-App" }, { type: "api" }])
    expect(await whichApp(m.deps, team, server, {}, { offerNew: true, folder: m.project })).toEqual({ app: "api", how: "asked", fresh: true })
    const fill = folderName(m.project)
    expect(fill).toBeDefined()
    expect(a.asked).toEqual([
      { kind: "choose", question: "Which app on dev?", rows: ["web\tdeploy 2, running", "+ a new app"] },
      { kind: "ask", question: "Name for the new app", fill },
    ])
    expect(a.refused).toEqual([
      { answer: "web", reason: A12("dev", "web") },
      { answer: "Not-An-App", reason: A11 },
    ])
    expect(A11).toBe("Use lowercase letters, digits and hyphens, starting with a letter or a digit.")
    expect(A12("dev", "web")).toBe("dev already has an app named web. Choose it from the list, or give another name.")
  })

  test("with no apps: deploy asks Name for this app; any other command says A5", async () => {
    const m = await ready()
    const team = await openTeam(m.deps)
    const server = team.profile.servers[0]!
    const a = answering(m, [{ type: "-bad" }, { type: "demo" }])
    expect(await whichApp(m.deps, team, server, {}, { offerNew: true, folder: m.project })).toEqual({ app: "demo", how: "asked", fresh: true })
    expect(a.asked).toEqual([{ kind: "ask", question: "Name for this app", fill: folderName(m.project) }])
    expect(a.refused).toEqual([{ answer: "-bad", reason: A11 }])
    expect(whichApp(m.deps, team, server, {}, { offerNew: false, folder: m.project })).rejects.toThrow(A5("dev"))
    expect(A5("dev")).toBe("dev has no apps yet, so there is nothing to choose from. Name one with `--app <name>`.")
  })

  test("an app given by a flag or by the linked folder is used, and nothing is read or asked", async () => {
    const m = machine()
    const a = answering(m, [])
    m.deps.connect = () => {
      throw new Error("nothing is read for an app that was given")
    }
    const team = teamWith([PROD])
    expect(await whichApp(m.deps, team, PROD, { app: "web" }, { offerNew: true, folder: m.project })).toEqual({ app: "web", how: "given", fresh: false })
    expect(await whichApp(m.deps, team, PROD, { app: "web", linked: true }, { offerNew: false, folder: m.project })).toEqual({ app: "web", how: "linked", fresh: false })
    expect(a.asked).toEqual([])
  })

  test("the folder's name filled in is the folder's real name", () => {
    const root = realpathSync(tempDir("real"))
    const path = join(root, "Shop")
    mkdirSync(path)
    expect(folderName(path)).toBe("shop")
  })
})

const RUNNING = '{"Service":"web","State":"running","ExitCode":0,"Health":""}\n'
const BOTH_SERVERS = ["dev\tthis machine", "staging\tthis machine"]

/** Two servers on this machine, dev and staging; web deployed twice to dev, running, with GREETING set; a folder with no zekno.json. */
async function twoServers() {
  const m = await ready()
  expect(await m.zekno("server", "add", "staging", "--local", "--home", tempDir("staging"))).toBe(0)
  expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)
  m.typing("hello")
  expect(await m.zekno("secret", "set", "GREETING", "--app", "web", "--server", "dev")).toBe(0)
  expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)
  m.docker.ps("web", RUNNING)
  return m
}

/**
 * Runs `zekno <args>` as at a terminal, its questions answered by `answers`,
 * and gives back the exit status, what was asked and drawn, what was written,
 * how many times the keychain was read, and each connection made (`batch` or
 * not). Everything the interface was told is in `events`, in order.
 */
async function atTerminal(m: ReturnType<typeof machine>, answers: Answer[], ...args: string[]) {
  const plain = m.deps.ui
  const keyStore = m.deps.keyStore
  const connect = m.deps.connect
  let gets = 0
  const connections: string[] = []
  m.deps.keyStore = { ...keyStore, get: (name) => (gets++, keyStore.get(name)) }
  m.deps.connect = (target, localRunner, options) => (connections.push(options?.batch ? "batch" : "session"), connect(target, localRunner, options))
  const asking = answering(m, answers)
  const answered = m.deps.ui
  const events: string[] = []
  m.deps.ui = {
    ...answered,
    warn: (text) => (events.push(`! ${text}`), answered.warn(text)),
    note: (text) => (events.push(`  ${text}`), answered.note(text)),
    step: (label, work, options) => (events.push(`step ${label}`), answered.step(label, work, options)),
    confirm: (question, refusal, options) => (events.push(`? ${question}`), answered.confirm(question, refusal, options)),
    choose: (question) => (events.push(`? ${question.question}`), answered.choose(question)),
  }
  const [out, err] = [m.out.length, m.err.length]
  try {
    const code = await m.zekno(...args)
    return { code, ...asking, events, gets, connections, out: m.out.slice(out), err: m.err.slice(err) }
  } finally {
    m.deps.ui = plain
    m.deps.keyStore = keyStore
    m.deps.connect = connect
  }
}

/** The files of the profile folder and the project folder, with their bytes and modes. */
const snapshot = (m: ReturnType<typeof machine>) => [...filesUnder(m.home), ...filesUnder(m.deps.cwd)]

/** Lines with numbers and the folder they were run in written the same, to compare two runs of a command. */
const alike = (lines: string[], cwd: string) => lines.map((line) => line.replaceAll(cwd, "<folder>").replace(/\d+/g, "N"))

/** The commands that ask, each with what it asks at a terminal (plan.md, "What each command asks"), and what it needs before each run. */
const COMMANDS: { args: string[]; asks: ("server" | "app")[]; before?: (m: ReturnType<typeof machine>) => Promise<void> }[] = [
  { args: ["rollback"], asks: ["server", "app"] },
  { args: ["status"], asks: ["server"] },
  { args: ["logs", "--no-follow"], asks: ["server", "app"] },
  { args: ["secret", "set", "GREETING"], asks: ["server", "app"], before: async (m) => m.typing("again") },
  {
    args: ["secret", "rm", "GREETING"],
    asks: ["server", "app"],
    before: async (m) => {
      m.typing("again")
      expect(await m.zekno("secret", "set", "GREETING", "--app", "web", "--server", "dev")).toBe(0)
    },
  },
  { args: ["secret", "ls"], asks: ["server", "app"] },
  {
    args: ["link"],
    asks: ["server", "app"],
    // Each run links a folder of its own, so the one before does not answer for it.
    before: async (m) => {
      m.deps.cwd = tempDir("unlinked")
      writeFileSync(join(m.deps.cwd, "compose.yaml"), COMPOSE_V1)
    },
  },
  { args: ["server", "update"], asks: ["server"] },
]

/** The answers to what a command asks: dev, then web. */
const answersFor = (asks: ("server" | "app")[]): Answer[] => asks.map((detail) => (detail === "server" ? { choose: "dev" } : { choose: "web" }))
/** The flags that say the same. */
const flagsFor = (args: string[], asks: ("server" | "app")[]): string[] =>
  args[0] === "server" ? [...args, "dev"] : [...args, ...(asks.includes("server") ? ["--server", "dev"] : []), ...(asks.includes("app") ? ["--app", "web"] : [])]

describe("questions in single commands (User Story 2)", () => {
  test("with no flags, each command asks what it lacks, server then app, and then does what it does when given them; the keychain read once", async () => {
    const m = await twoServers()
    for (const { args, asks, before } of COMMANDS) {
      await before?.(m)
      const asked = await atTerminal(m, answersFor(asks), ...args)
      const expected: Asked[] = [
        { kind: "choose", question: "Which server?", rows: BOTH_SERVERS },
        ...(asks.includes("app") ? [{ kind: "choose" as const, question: "Which app on dev?", rows: ["web\tdeploy N, running"] }] : []),
      ]
      // The deploy number grows as rollback runs; the rest is exact.
      const numbered = asked.asked.map((question) => ({ ...question, ...(question.rows ? { rows: question.rows.map((row) => row.replace(/deploy \d+/, "deploy N")) } : {}) }))
      expect({ args, asked: numbered }).toEqual({ args, asked: expected })
      expect({ args, gets: asked.gets }).toEqual({ args, gets: 1 })
      const askedIn = m.deps.cwd
      await before?.(m)
      const given = await atTerminal(m, [], ...flagsFor(args, asks))
      expect({ args, asked: given.asked }).toEqual({ args, asked: [] })
      expect({ args, code: asked.code, out: alike(asked.out, askedIn), err: alike(asked.err, askedIn) }).toEqual({
        args,
        code: given.code,
        out: alike(given.out, m.deps.cwd),
        err: alike(given.err, m.deps.cwd),
      })
    }
  }, 60_000)

  test("given --server it asks only the app; given both, or in a linked folder, it asks nothing", async () => {
    const m = await twoServers()
    for (const { args, asks, before } of COMMANDS.filter((command) => command.asks.includes("app"))) {
      await before?.(m)
      const app = await atTerminal(m, [{ choose: "web" }], ...args, "--server", "dev")
      expect({ args, asked: app.asked.map((question) => question.question) }).toEqual({ args, asked: ["Which app on dev?"] })
      await before?.(m)
      const both = await atTerminal(m, [], ...flagsFor(args, asks))
      expect({ args, asked: both.asked }).toEqual({ args, asked: [] })
    }
    // A linked folder gives both: nothing is asked, and nothing is read for a list.
    expect(await m.zekno("link", "--app", "web", "--server", "dev")).toBe(0)
    for (const { args } of COMMANDS.filter((command) => command.args[0] !== "link" && command.args[0] !== "server")) {
      m.typing("again")
      if (args[1] === "rm") expect(await m.zekno("secret", "set", "GREETING")).toBe(0)
      m.typing("again")
      const linked = await atTerminal(m, [], ...args)
      expect({ args, asked: linked.asked, batch: linked.connections.filter((how) => how === "batch") }).toEqual({ args, asked: [], batch: [] })
    }
  }, 60_000)

  test("with one server it is used and said, and no server is asked", async () => {
    const m = await ready()
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)
    m.typing("hello")
    expect(await m.zekno("secret", "set", "GREETING", "--app", "web", "--server", "dev")).toBe(0)
    for (const { args, asks, before } of COMMANDS) {
      await before?.(m)
      const run = await atTerminal(m, asks.includes("app") ? [{ choose: "web" }] : [], ...args)
      expect({ args, first: run.events[0] }).toEqual({ args, first: "  Using dev, your only server." })
      expect({ args, asked: run.asked.map((question) => question.question) }).toEqual({ args, asked: asks.includes("app") ? ["Which app on dev?"] : [] })
    }
  }, 60_000)

  test("leaving any question: Nothing was done., status 1, no file changed, and nothing started after the question", async () => {
    const m = await twoServers()
    for (const { args, asks, before } of COMMANDS) {
      for (let at = 0; at < asks.length; at++) {
        await before?.(m)
        const files = snapshot(m)
        const left = await atTerminal(m, [...answersFor(asks).slice(0, at), "leave"], ...args)
        expect({ args, at, code: left.code, err: left.err }).toEqual({ args, at, code: 1, err: ["Nothing was done."] })
        expect({ args, at, same: snapshot(m) }).toEqual({ args, at, same: files })
        // Only the read for the list of apps, in batch mode, which changes nothing: no runner was asked to do anything.
        expect({ args, at, connections: left.connections }).toEqual({ args, at, connections: at === 0 ? [] : ["batch"] })
      }
    }
  }, 60_000)

  test("a zekno.json signed by the team and not used here: the first-use question comes first, before any question and any read", async () => {
    const m = await twoServers()
    expect(await m.zekno("link", "--app", "web", "--server", "dev")).toBe(0)
    const other = await twin(m)
    other.deps.cwd = m.project
    other.docker.ps("web", RUNNING)
    const run = await atTerminal(other, [{ yes: true }], "secret", "ls")
    expect(run.code).toBe(0)
    expect(run.events[0]).toBe("? Ada linked this folder to web on dev. Use it here?")
    expect(run.asked).toEqual([{ kind: "confirm", question: "Ada linked this folder to web on dev. Use it here?" }])
    expect(run.events.filter((event) => event.startsWith("step "))).toEqual([])
    // No: Nothing was done., and nothing was read or asked after it.
    const another = await twin(m)
    another.deps.cwd = m.project
    const no = await atTerminal(another, [{ yes: false }], "status")
    expect({ code: no.code, err: no.err, connections: no.connections, steps: no.events.filter((event) => event.startsWith("step ")) }).toEqual({
      code: 1,
      err: ["Nothing was done."],
      connections: [],
      steps: [],
    })
  }, 60_000)

  test("a zekno.json not signed by the team: A14 is drawn, then the questions, as if it were not there", async () => {
    const m = await twoServers()
    writeFileSync(join(m.project, "zekno.json"), JSON.stringify({ app: "other", server: "staging" }))
    const run = await atTerminal(m, [{ choose: "dev" }, { choose: "web" }], "secret", "ls")
    expect(run.code).toBe(0)
    expect(run.events.slice(0, 2)).toEqual(["! zekno.json here is not signed by your team, so zekno does not use it. It names other on staging.", "? Which server?"])
    expect(run.asked.map((question) => question.question)).toEqual(["Which server?", "Which app on dev?"])
    expect(run.out).toEqual(["GREETING\tversion 1"])
  }, 60_000)
})

describe("what a command says instead of asking (User Story 2)", () => {
  test("with no team: A3, for every command that needs one, server add and server ls included; status 1", async () => {
    const m = machine()
    m.compose(COMPOSE_V1)
    const commands = [...COMMANDS.map((command) => command.args), ["server", "add", "two", "--local"], ["server", "ls"], ["secret", "set"]]
    for (const args of commands) {
      const run = await atTerminal(m, [], ...args)
      expect({ args, code: run.code, err: run.err, asked: run.asked }).toEqual({ args, code: 1, err: [A3], asked: [] })
    }
    expect(existsSync(join(m.home, "profile.json"))).toBe(false)
  })

  test("with a team and no server: A4; a server with no apps: A5", async () => {
    const m = machine()
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    m.compose(COMPOSE_V1)
    for (const { args } of COMMANDS) {
      const run = await atTerminal(m, [], ...args)
      expect({ args, code: run.code, err: run.err }).toEqual({ args, code: 1, err: [A4] })
    }
    const two = await twoServers()
    const empty = await atTerminal(two, [], "secret", "ls", "--server", "staging")
    expect({ code: empty.code, err: empty.err }).toEqual({ code: 1, err: [A5("staging")] })
  }, 60_000)

  test("what needs no answer is checked before any question", async () => {
    const m = await twoServers()
    const cases: [string[], number, string][] = [
      [["secret", "set"], 2, "Say which secret: `zekno secret set <NAME> ...`.\nRun `zekno --help` for the list of commands."],
      [["secret", "set", "A=b"], 1, "A secret name uses letters, digits and underscore, and does not start with a digit."],
      [["secret", "set", "PATH"], 1, '"PATH" is reserved: the runner uses it to start Docker. Choose another name.'],
      [["secret", "rm"], 2, "Say which secret: `zekno secret rm <NAME> ...`.\nRun `zekno --help` for the list of commands."],
      [["rollback", "--to", "x"], 2, "`--to` takes a deploy number, such as `--to 3`.\nRun `zekno --help` for the list of commands."],
      [["logs", "--tail", "9999"], 2, "`--tail` takes a whole number from 0 to 1000.\nRun `zekno --help` for the list of commands."],
    ]
    for (const [args, code, sentence] of cases) {
      const run = await atTerminal(m, [], ...args)
      expect({ args, code: run.code, err: run.err, asked: run.asked, connections: run.connections }).toEqual({ args, code, err: [sentence], asked: [], connections: [] })
    }
    // zekno link would have to replace a file here that is not the team's: A15, before anything is asked; with --force it asks.
    writeFileSync(join(m.project, "zekno.json"), JSON.stringify({ app: "other", server: "dev" }))
    const link = await atTerminal(m, [], "link")
    expect({ code: link.code, err: link.err, asked: link.asked }).toEqual({
      code: 1,
      err: [`There is already a zekno.json in ${m.project}. Run \`zekno link --force\` to replace it.`],
      asked: [],
    })
    const forced = await atTerminal(m, [{ choose: "dev" }, { choose: "web" }], "link", "--force")
    expect(forced.code).toBe(0)
    expect(forced.events[0]).toBe("! zekno.json here is not signed by your team, so zekno does not use it. It names other on dev.")
    expect(JSON.parse(readFileSync(join(m.project, "zekno.json"), "utf8"))).toMatchObject({ app: "web", server: "dev" })
  }, 60_000)

  test("server update asks for the server, then asks its own question; over SSH as anywhere", async () => {
    const m = machine()
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    const server = standInServer()
    m.deps.release = { version: OWN, files: { "linux-x64": { sha256: server.release(realRunner(m.docker.path)) }, "linux-arm64": { sha256: null } } }
    const ssh = sshStandIn(server)
    await withSsh(ssh, async () => {
      expect(await m.zekno("server", "add", "prod", "--ssh", "deploy@203.0.113.7")).toBe(0)
      expect(await m.zekno("server", "add", "staging", "--local", "--home", tempDir("staging"))).toBe(0)
      const calls = ssh.calls().length
      const run = await atTerminal(m, [{ choose: "prod" }, { yes: false }], "server", "update")
      expect(run.code).toBe(0)
      expect(run.asked).toEqual([
        { kind: "choose", question: "Which server?", rows: ["prod\tdeploy@203.0.113.7", "staging\tthis machine"] },
        { kind: "confirm", question: `Replace the runner on prod with version ${OWN}? The server downloads it and checks it before it replaces the old one.` },
      ])
      expect(run.out).toEqual(["Nothing was changed."])
      // Nothing reached the server: the question came first, and it was answered no.
      expect(ssh.calls().length).toBe(calls)
    })
  }, 60_000)
})

describe("with no terminal nothing is asked (FR-002, FR-028)", () => {
  test("each missing detail: today's sentence and status, and nothing asked or drawn", async () => {
    const m = await twoServers()
    let notes = 0
    const plain = m.deps.ui
    m.deps.ui = { ...plain, note: (text) => (notes++, plain.note(text)) }
    const help = "\nRun `zekno --help` for the list of commands."
    const cases: [string[], number, string][] = [
      [["rollback"], 2, MISSING_SERVER + help],
      [["rollback", "--server", "dev"], 2, MISSING_APP + help],
      [["status"], 2, MISSING_SERVER + help],
      [["logs", "--no-follow"], 2, MISSING_SERVER + help],
      [["logs", "--server", "dev", "--no-follow"], 2, MISSING_APP + help],
      [["secret", "set", "GREETING"], 2, MISSING_SERVER + help],
      [["secret", "set", "GREETING", "--server", "dev"], 2, MISSING_APP + help],
      [["secret", "rm", "GREETING"], 2, MISSING_SERVER + help],
      [["secret", "ls"], 2, MISSING_SERVER + help],
      [["secret", "ls", "--server", "dev"], 2, MISSING_APP + help],
      [["link"], 2, MISSING_SERVER + help],
      [["link", "--server", "dev"], 2, MISSING_APP + help],
      [["server", "update"], 2, "Say which server: `zekno server update <name>`." + help],
      // As before: the server and the app are found before the name or `--to` is looked at.
      [["secret", "set"], 2, MISSING_SERVER + help],
      [["rollback", "--to", "x"], 2, MISSING_SERVER + help],
    ]
    for (const [args, code, sentence] of cases) {
      const [out, err] = [m.out.length, m.err.length]
      expect({ args, code: await m.zekno(...args) }).toEqual({ args, code })
      expect({ args, out: m.out.slice(out), err: m.err.slice(err) }).toEqual({ args, out: [], err: [sentence] })
    }
    // No team: today's sentence, not the terminal's.
    const bare = machine()
    for (const args of [["status"], ["secret", "ls"], ["server", "ls"]]) {
      expect(await bare.zekno(...args)).toBe(1)
      expect(bare.lastErr()).toBe("No team on this machine yet. Run `zekno init --name <you>` first.")
    }
    expect(notes).toBe(0)
  }, 60_000)
})
