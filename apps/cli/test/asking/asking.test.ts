/**
 * What single commands ask at a terminal, and what they never ask without
 * one (specs/006-cli-small-features, contracts/questions.md, "The lists each
 * command offers"; data-model.md, "Server row and app row").
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { runner, tempDir } from "../../../runner/test/helpers"
import { READ_LIMIT_MS } from "../../src/app/effects"
import {
  APP_NAME_RULE as A11,
  appTaken as A12,
  ASKING_LIMIT_MS,
  folderName,
  NO_SERVER_YET as A4,
  NO_TEAM_AT_TERMINAL as A3,
  noApps as A5,
  onlyServer as A1,
  whichApp,
  whichServer,
} from "../../src/asking/asking"
import { openTeam, teamOnce, type Team } from "../../src/context"
import { MISSING_SERVER } from "../../src/errors"
import { isMemberName, type Server } from "../../src/profile"
import type { ListQuestion } from "../../src/ui/types"
import { answering, machine, ready } from "../helpers"

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
  test("A3, and the read limit is the app's own", () => {
    expect(A3).toBe("No team on this machine yet. Run `zekno deploy` in a project folder, or `zekno init --name <you>`.")
    expect(ASKING_LIMIT_MS).toBe(READ_LIMIT_MS)
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
