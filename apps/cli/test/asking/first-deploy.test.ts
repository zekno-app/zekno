/**
 * `zekno deploy` at a terminal, from nothing (specs/006-cli-small-features,
 * User Story 1, contracts/first-deploy.md, mock-up 3): end to end against the
 * stand-in server and the stand-in `ssh`, with the real runner as the release
 * and the stand-in Docker, an in-memory key store, and a person's answers
 * given by `answering`. Each case also looks at what is on disk and on the
 * stand-in server.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import runnerPackage from "../../../runner/package.json"
import { runner, tempDir } from "../../../runner/test/helpers"
import { foundDetail, megabytes as appMegabytes } from "../../src/app/effects"
import { appTaken } from "../../src/asking/asking"
import {
  DESTINATION_RULE,
  expectsValues,
  KEPT_SO_FAR,
  KEY_CREATED,
  megabytes,
  MEMBER_NAME_RULE,
  NOTHING_MORE,
  openingLine,
  rememberFolder,
  runnerFoundDetail,
  SERVER_CODE_ABOUT,
  SERVER_NAME_RULE,
  serverTaken,
  TEAM_CODE_ABOUT,
} from "../../src/asking/first-deploy"
import { SSH_IDENTITY } from "../../src/commands/server"
import { openTeam, reopenTeam } from "../../src/context"
import { MISSING_APP, MISSING_SERVER } from "../../src/errors"
import { prepareServerAdd } from "../../src/ops/server"
import type { RunnerRelease } from "../../src/runner-release"
import type { ListQuestion, Ui } from "../../src/ui/types"
import { answering, COMPOSE_V1, filesUnder, machine, ready, twin, type Answer } from "../helpers"
import { realRunner, snapshot, sshStandIn, standInServer, withSsh, type StandInServer } from "../stand-in-server"
import { shows, terminal } from "../ui/terminal"

type Machine = ReturnType<typeof machine>

/** The version the repository's runner reports: a stand-in release made from it carries it, so no runner warning is said. */
const OWN = runnerPackage.version

/** A Compose file that expects one value, DATABASE_URL. */
const COMPOSE_DB = "services:\n  web:\n    image: example/web:1\n    environment:\n      - DATABASE_URL\n"
const DESTINATION = "deploy@example.test"
const VALUE = "postgres://u:p@h/db"
/** The six answers of a deploy from nothing (SC-001). */
const ALL: Answer[] = [{ type: "ada" }, { type: DESTINATION }, { type: "prod" }, { type: "demo" }, { yes: true }, { value: VALUE }]
const VALUE_QUESTION = "Value for DATABASE_URL (demo on prod): "
const QUESTIONS = ["Your name", "Where is the server?", "A name for it", "Name for this app", rememberFolder("demo", "prod"), VALUE_QUESTION]
const DOCKER_MISSING = "Docker with Compose was not found on the server. Install Docker with its Compose plugin there, then try again."
const RUNNING = '{"Service":"web","State":"running","ExitCode":0,"Health":""}\n'

/** A release of the runner whose x64 file is `content`, as the stand-in server serves it. */
function releaseOf(server: StandInServer, content: string): RunnerRelease {
  return { version: OWN, files: { "linux-x64": { sha256: server.release(content) }, "linux-arm64": { sha256: null } } }
}

/**
 * Everything the interface was told, in order, one string each: `✔ `, `! `,
 * `✖ `, `i ` (info) and two spaces (a note) before a line's words; `? ` before
 * a question; `code <label> <value> <about>`; `deploy <app> <server>` for the
 * deploy panel; and an empty string for an empty line between blocks.
 */
function journal(m: Machine): string[] {
  const events: string[] = []
  const ui = m.deps.ui
  const say =
    <A extends unknown[], R>(draw: (...args: A) => R, text: (...args: A) => string) =>
    (...args: A): R => {
      events.push(text(...args))
      return draw(...args)
    }
  m.deps.ui = {
    ...ui,
    info: say(ui.info, (text) => `i ${text}`),
    success: say(ui.success, (text, detail) => `✔ ${text}${detail === undefined ? "" : `  ${detail}`}`),
    warn: say(ui.warn, (text) => `! ${text}`),
    error: say(ui.error, (text) => `✖ ${text}`),
    note: say(ui.note, (text) => `  ${text}`),
    code: say(ui.code, (label, value, about) => `code ${label} ${value} ${about}`),
    gap: say(ui.gap, () => ""),
    ask: say(ui.ask, (question) => `? ${question.question}`),
    confirm: say(ui.confirm, (question) => `? ${question}`),
    askValue: say(ui.askValue, (question) => `? ${question}`),
    deploy: say(ui.deploy, (start) => `deploy ${start.app} ${start.server}`),
    choose: <T>(question: ListQuestion<T>) => (events.push(`? ${question.question}`), ui.choose(question)),
  } satisfies Ui
  return events
}

/** The events with the two codes and the runner's size written as patterns, so the rest can be compared exactly. */
const general = (events: string[]) => events.map((event) => event.replace(/[0-9A-Z]{4}(-[0-9A-Z]{4}){4}/, "<code>").replace(/\d+ MB/, "<n> MB"))

/** The lines of mock-up 3 a deploy from nothing tells the interface, before the deploy itself. */
const FROM_NOTHING = [
  "  Nothing is set up on this machine yet. Three things first: your key, a server, this app.",
  "",
  "? Your name",
  `✔ ${KEY_CREATED}`,
  `code Team code <code> ${TEAM_CODE_ABOUT}`,
  "",
  "? Where is the server?",
  "? A name for it",
  "✔ Connected over SSH",
  "✔ Docker with Compose found",
  "✔ Runner installed  <n> MB, checksum verified",
  "✔ Added prod to the signed team list",
  `code Server code <code> ${SERVER_CODE_ABOUT}`,
  `  ${SSH_IDENTITY}`,
  "",
  "? Name for this app",
  `? ${rememberFolder("demo", "prod")}`,
  "",
  "! compose.yaml expects 1 value that has no secret yet.",
  `? ${VALUE_QUESTION}`,
  // No empty line is added before the deploy: at a terminal its panel has one above it of its own.
  "deploy demo prod",
]

/**
 * An empty machine: no profile, an empty key store, a project folder named
 * `demo` (or `folder`) whose compose.yaml expects DATABASE_URL, and a
 * stand-in server reached over the stand-in `ssh`, whose release is the real
 * runner with the stand-in Docker.
 */
function fromNothing(options: { compose?: string | null; folder?: string } = {}) {
  const m = machine()
  const project = join(tempDir("projects"), options.folder ?? "demo")
  mkdirSync(project)
  m.deps.cwd = project
  if (options.compose !== null) writeFileSync(join(project, "compose.yaml"), options.compose ?? COMPOSE_DB)
  const server = standInServer()
  m.deps.release = releaseOf(server, realRunner(m.docker.path))
  const ssh = sshStandIn(server)
  const plain = m.deps.ui
  const keyStore = m.keyStore
  let gets = 0
  m.deps.keyStore = { ...keyStore, get: (name) => (gets++, keyStore.get(name)) }
  return {
    m,
    project,
    server,
    ssh,
    /** How many times the keychain was read in the last run. */
    gets: () => gets,
    /** Runs `zekno deploy <args>` at a terminal, answered by `answers`, with `ssh` meaning the stand-in. */
    async deploy(answers: Answer[], ...args: string[]) {
      m.deps.ui = plain
      const [out, err] = [m.out.length, m.err.length]
      const asking = answering(m, answers)
      const events = journal(m)
      gets = 0
      const code = await withSsh(ssh, () => m.zekno("deploy", ...args))
      // What `run` said went wrong: the error line, apart from the warnings that plain output also writes on standard error.
      const errors = events.filter((event) => event.startsWith("✖ ")).map((event) => event.slice(2))
      return { code, ...asking, events, errors, questions: asking.asked.map((question) => question.question), out: m.out.slice(out), err: m.err.slice(err) }
    },
    profile: (): { servers: { name: string; serverId: string }[] } | undefined =>
      existsSync(join(m.home, "profile.json")) ? JSON.parse(readFileSync(join(m.home, "profile.json"), "utf8")) : undefined,
    /** The secret records this machine holds for `app` on its first server. */
    records(app = "demo"): unknown[] {
      const servers = this.profile()?.servers ?? []
      const file = servers[0] && join(m.home, "secrets", servers[0].serverId, `${app}.json`)
      return file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).records : []
    },
    linked: () => existsSync(join(project, "zekno.json")),
    /** The team list version the runner on the stand-in server holds, or undefined when none is set up there. */
    async rosterOnServer(): Promise<number | undefined> {
      if (!existsSync(server.folder)) return undefined
      const read = await runner(server.folder, m.docker.path, "status")
      return (read.json as { team?: { version: number } } | undefined)?.team?.version
    },
  }
}

describe("the building blocks of the first deploy", () => {
  test("F1 counts what is missing, and is said only when the key or a server is", () => {
    expect(openingLine({ key: true, server: true, app: true })).toBe("Nothing is set up on this machine yet. Three things first: your key, a server, this app.")
    expect(openingLine({ key: false, server: true, app: true })).toBe("Two things first: a server, this app.")
    expect(openingLine({ key: true, server: true, app: false })).toBe("Nothing is set up on this machine yet. Two things first: your key, a server.")
    expect(openingLine({ key: false, server: true, app: false })).toBe("One thing first: a server.")
    expect(openingLine({ key: false, server: false, app: true })).toBeUndefined()
    expect(openingLine({ key: false, server: false, app: false })).toBeUndefined()
  })

  test("the sentences of contracts/first-deploy.md, and those the server step shares with zekno server add", async () => {
    expect(rememberFolder("demo", "prod")).toBe("Remember this folder? It writes zekno.json, so it always deploys demo to prod.")
    expect(expectsValues("compose.yaml", 1)).toBe("compose.yaml expects 1 value that has no secret yet.")
    expect(expectsValues("compose.yaml", 3)).toBe("compose.yaml expects 3 values that have no secret yet.")
    expect(NOTHING_MORE).toBe("Nothing more was done. What was set up so far is kept: run `zekno deploy` again to carry on.")
    expect(KEPT_SO_FAR).toBe("What was set up so far is kept: run `zekno deploy` again to carry on.")
    expect(MEMBER_NAME_RULE).toBe("A name is 1 to 64 characters, with no control character and no space at either end.")
    expect(SSH_IDENTITY).toBe("You reached this server over SSH, so its identity rests on SSH's host verification.")
    // A7 and A8 are what `zekno server add` says for the same mistakes.
    const m = await ready()
    expect(prepareServerAdd(m.deps, "prod", { ssh: "-oProxyCommand=x" })).rejects.toThrow(DESTINATION_RULE)
    expect(prepareServerAdd(m.deps, "Prod", { ssh: DESTINATION })).rejects.toThrow(SERVER_NAME_RULE)
    expect(prepareServerAdd(m.deps, "dev", { ssh: DESTINATION })).rejects.toThrow(serverTaken("dev"))
  })

  test("the runner's size and what is said of a runner found are the app's add-server screen's words", () => {
    for (const bytes of [0, 1, 499_999, 500_000, 1_000_000, 52_400_000]) expect(megabytes(bytes)).toBe(appMegabytes(bytes))
    for (const version of [undefined, "0.0.1", OWN, "99.0.0", `${OWN}-dev.1`]) expect(runnerFoundDetail(version, OWN)).toBe(foundDetail(version, OWN))
  })

  test("reopenTeam reads the profile again and proves it again, without the keychain; a changed profile is refused", async () => {
    const m = await ready()
    const team = await openTeam(m.deps)
    expect(await m.zekno("server", "add", "two", "--local", "--home", tempDir("two"))).toBe(0)
    m.deps.keyStore = {
      get: () => {
        throw new Error("the keychain was read")
      },
      set: () => {
        throw new Error("the keychain was written")
      },
      delete: () => {
        throw new Error("the keychain was written")
      },
    }
    const again = reopenTeam(team)
    expect(again.profile.servers.map((server) => server.name)).toEqual(["dev", "two"])
    expect(again.trust.version).toBe(team.trust.version + 1)
    expect(again.withSigner).toBe(team.withSigner)
    m.tamper("profile.json", (json) => ({ ...json, servers: [...json.servers, { ...json.servers[0], name: "evil" }] }))
    expect(() => reopenTeam(team)).toThrow('The profile names a server "evil" that is not in the signed team list.')
  })
})

describe("zekno deploy from nothing (mock-up 3)", () => {
  test("six answers: the key, the server, the app, the folder, the value, then the deploy; the keychain read once after the key was written", async () => {
    const s = fromNothing()
    const run = await s.deploy(ALL)
    expect(run.errors).toEqual([])
    expect(run.code).toBe(0)
    expect(run.questions).toEqual(QUESTIONS)
    expect(run.asked[3]).toEqual({ kind: "ask", question: "Name for this app", fill: "demo" })
    expect(run.unanswered()).toBe(0)
    expect(run.refused).toEqual([])
    expect(general(run.events)).toEqual(FROM_NOTHING)
    expect(run.out.at(-1)).toBe("Deploy 1 of demo is running on prod with 1 secret.")
    expect(s.gets()).toBe(1)

    // On this machine: the key, the profile with the server, the value sealed, zekno.json signed and recorded.
    expect(s.m.keyStore.size()).toBe(1)
    expect(s.profile()?.servers.map((server) => server.name)).toEqual(["prod"])
    expect(s.records()).toHaveLength(1)
    expect(s.linked()).toBe(true)
    expect(existsSync(join(s.m.home, "links.json"))).toBe(true)
    // The value only in its sealed record: in no file of the profile folder or the project folder in plain text, and in no line.
    for (const file of [...filesUnder(s.m.home), ...filesUnder(s.project)]) expect({ file: file.path, has: file.content.includes(VALUE) }).toEqual({ file: file.path, has: false })
    expect([...s.m.out, ...s.m.err, ...run.events].join("\n")).not.toContain(VALUE)
    // On the server: the runner where the installer puts it, holding the team list with the server.
    expect(existsSync(s.server.runnerPath)).toBe(true)
    expect(await s.rosterOnServer()).toBe(2)
    // The installer ran once, as `zekno server add` runs it, and its connection became the session that set the runner up.
    const calls = s.ssh.calls()
    const install = `-- ${DESTINATION} sh -s -- add ${OWN} release x64 ${s.m.deps.release!.files["linux-x64"].sha256}`
    expect(calls.filter((call) => call.includes("sh -s --"))).toEqual([install])
    expect(calls[0]).toBe(install)
    // Then the apps were read in batch mode, and the deploy went to the runner where the installer put it.
    expect(calls.at(-1)).toBe(`-- ${DESTINATION} ~/.local/bin/zekno-runner session`)
  }, 60_000)

  test("a second run asks nothing and deploys again", async () => {
    const s = fromNothing()
    expect((await s.deploy(ALL)).code).toBe(0)
    const again = await s.deploy([])
    expect(again.code).toBe(0)
    expect(again.asked).toEqual([])
    expect(again.events).toEqual(["deploy demo prod"])
    expect(again.out.at(-1)).toBe("Deploy 2 of demo is running on prod with 1 secret.")
    expect(s.gets()).toBe(1)
  }, 60_000)
})

describe("leaving a question, then running again (contracts/first-deploy.md, 'When it stops in the middle')", () => {
  /** What exists after leaving at each question, and what the next run then asks. */
  const cases: { at: number; left: (s: ReturnType<typeof fromNothing>) => Promise<void>; next: string[]; opening?: string }[] = [
    {
      at: 0,
      left: async (s) => {
        expect(s.profile()).toBeUndefined()
        expect(s.m.keyStore.size()).toBe(0)
      },
      next: QUESTIONS,
      opening: "  Nothing is set up on this machine yet. Three things first: your key, a server, this app.",
    },
    {
      at: 1,
      left: async (s) => {
        expect(s.profile()?.servers).toEqual([])
        expect(s.m.keyStore.size()).toBe(1)
      },
      next: QUESTIONS.slice(1),
      opening: "  Two things first: a server, this app.",
    },
    {
      at: 2,
      left: async (s) => {
        expect(s.profile()?.servers).toEqual([])
        expect(existsSync(s.server.runnerPath)).toBe(false)
        expect(s.ssh.calls()).toEqual([])
      },
      next: QUESTIONS.slice(1),
      opening: "  Two things first: a server, this app.",
    },
    {
      at: 3,
      left: async (s) => {
        // The server is whole: in the profile, the runner installed and set up, holding the team list with it (the sync of `server add`).
        expect(s.profile()?.servers.map((server) => server.name)).toEqual(["prod"])
        expect(existsSync(s.server.runnerPath)).toBe(true)
        expect(await s.rosterOnServer()).toBe(2)
        expect(s.linked()).toBe(false)
      },
      next: QUESTIONS.slice(3),
    },
    {
      at: 4,
      left: async (s) => {
        expect(s.linked()).toBe(false)
        expect(existsSync(join(s.m.home, "links.json"))).toBe(false)
      },
      next: QUESTIONS.slice(3),
    },
    {
      at: 5,
      left: async (s) => {
        expect(s.linked()).toBe(true)
        expect(s.records()).toEqual([])
      },
      next: QUESTIONS.slice(5),
    },
  ]

  for (const { at, left, next, opening } of cases) {
    test(`left at "${QUESTIONS[at]!.split("?")[0]}": ${at === 0 ? "Nothing was done." : "F8"}, nothing half-made, and the next run asks only what is missing`, async () => {
      const s = fromNothing()
      const leaving = await s.deploy([...ALL.slice(0, at), "leave"])
      expect(leaving.code).toBe(1)
      expect(leaving.questions).toEqual(QUESTIONS.slice(0, at + 1))
      expect(leaving.errors).toEqual([at === 0 ? "Nothing was done." : NOTHING_MORE])
      expect(leaving.events.filter((event) => event.startsWith("deploy "))).toEqual([])
      await left(s)

      const carried = await s.deploy(ALL.slice(ALL.length - next.length))
      expect(carried.errors).toEqual([])
      expect(carried.code).toBe(0)
      expect(carried.questions).toEqual(next)
      const first = carried.events[0]
      if (opening === undefined) expect(first?.includes("things first")).toBe(false)
      else expect(first).toBe(opening)
      // After the server was made, a run finds it: the one server, used and said.
      if (at === 3 || at === 4) expect(first).toBe("  Using prod, your only server.")
      expect(carried.out.at(-1)).toBe("Deploy 1 of demo is running on prod with 1 secret.")
    }, 60_000)
  }
})

describe("when a step fails, or there is nothing to deploy", () => {
  test("the installer fails: its sentence and F9, the key kept, no server, nothing left on the server; with Compose back, a run carries on from the server", async () => {
    const s = fromNothing()
    s.server.noCompose()
    const failed = await s.deploy(ALL.slice(0, 3))
    expect(failed.code).toBe(1)
    expect(failed.err).toEqual([`${DOCKER_MISSING} ${KEPT_SO_FAR}`])
    expect(s.m.keyStore.size()).toBe(1)
    expect(s.profile()?.servers).toEqual([])
    expect(s.server.leftovers()).toEqual([])
    expect(existsSync(s.server.runnerPath)).toBe(false)

    rmSync(join(s.server.root, "state", "no-compose"))
    const carried = await s.deploy(ALL.slice(1))
    expect(carried.code).toBe(0)
    expect(carried.events[0]).toBe("  Two things first: a server, this app.")
    expect(carried.questions).toEqual(QUESTIONS.slice(1))
  }, 60_000)

  test("SSH cannot connect: today's sentence and F9, the key kept, no server", async () => {
    const s = fromNothing()
    s.ssh.down()
    const failed = await s.deploy(ALL.slice(0, 3))
    expect(failed.code).toBe(1)
    expect(failed.err).toEqual([`${DESTINATION} could not be reached over SSH. Check that \`ssh ${DESTINATION}\` works from this machine. ${KEPT_SO_FAR}`])
    expect(s.profile()?.servers).toEqual([])
  }, 60_000)

  test("no Compose file: today's sentence before anything is asked, and nothing is made", async () => {
    const s = fromNothing({ compose: null })
    const run = await s.deploy([])
    expect(run.code).toBe(1)
    expect(run.err).toEqual([`No Compose file at ${resolve(s.project, "compose.yaml")}. Point to one with \`-f <file>\`.`])
    expect(run.asked).toEqual([])
    expect(s.profile()).toBeUndefined()
    expect(s.m.keyStore.size()).toBe(0)
  })

  test("an empty Compose file: the same, with its own sentence", async () => {
    const s = fromNothing({ compose: "  \n" })
    const run = await s.deploy([])
    expect(run.code).toBe(1)
    expect(run.err).toHaveLength(1)
    expect(run.err[0]).toMatch(/^The Compose file at .*compose\.yaml is empty\.$/)
    expect(run.asked).toEqual([])
    expect(s.profile()).toBeUndefined()
  })
})

describe("what is asked depends on what is given and what exists", () => {
  test("a value skipped: no secret for it, the deploy goes on, and the next run asks for it again", async () => {
    const s = fromNothing()
    const skipped = await s.deploy([...ALL.slice(0, 5), "skip"])
    expect(skipped.code).toBe(0)
    expect(s.records()).toEqual([])
    expect(skipped.out.at(-1)).toBe("Deploy 1 of demo is running on prod with no secrets.")
    const again = await s.deploy([{ value: VALUE }])
    expect(again.questions).toEqual([VALUE_QUESTION])
    expect(again.code).toBe(0)
    expect(s.records()).toHaveLength(1)
  }, 60_000)

  test('"n" to remember this folder: no zekno.json, and the next run asks the app again from the server\'s list', async () => {
    const s = fromNothing()
    const first = await s.deploy([...ALL.slice(0, 4), { yes: false }, { value: VALUE }])
    expect(first.code).toBe(0)
    expect(s.linked()).toBe(false)
    s.m.docker.ps("demo", RUNNING)
    const again = await s.deploy([{ choose: "demo" }, { yes: false }])
    expect(again.code).toBe(0)
    expect(again.events[0]).toBe("  Using prod, your only server.")
    expect(again.asked[0]).toEqual({ kind: "choose", question: "Which app on prod?", rows: ["demo\tdeploy 1, running", "+ a new app"] })
    expect(again.questions).toEqual(["Which app on prod?", rememberFolder("demo", "prod")])
    expect(again.out.at(-1)).toBe("Deploy 2 of demo is running on prod with 1 secret.")
  }, 60_000)

  test("with --server prod: the server is not asked a name; with --app api: no app is asked, and the opening line counts two things", async () => {
    const named = fromNothing()
    const server = await named.deploy([ALL[0]!, ALL[1]!, ALL[3]!, ALL[4]!, ALL[5]!], "--server", "prod")
    expect(server.code).toBe(0)
    expect(server.questions).toEqual(QUESTIONS.filter((question) => question !== "A name for it"))
    expect(named.profile()?.servers.map((entry) => entry.name)).toEqual(["prod"])

    const app = fromNothing()
    const given = await app.deploy([ALL[0]!, ALL[1]!, ALL[2]!, { yes: true }, { value: VALUE }], "--app", "api")
    expect(given.code).toBe(0)
    expect(given.events[0]).toBe("  Nothing is set up on this machine yet. Two things first: your key, a server.")
    expect(given.questions).toEqual(["Your name", "Where is the server?", "A name for it", rememberFolder("api", "prod"), "Value for DATABASE_URL (api on prod): "])
    expect(given.out.at(-1)).toBe("Deploy 1 of api is running on prod with 1 secret.")
  }, 60_000)

  test("with -f: remember this folder is not asked, and that file is deployed", async () => {
    const s = fromNothing({ compose: null })
    writeFileSync(join(s.project, "other.yaml"), COMPOSE_DB)
    const run = await s.deploy([...ALL.slice(0, 4), { value: VALUE }], "-f", "other.yaml")
    expect(run.code).toBe(0)
    expect(run.questions).toEqual(QUESTIONS.filter((question) => !question.startsWith("Remember")))
    expect(run.events).toContain("! other.yaml expects 1 value that has no secret yet.")
    expect(s.linked()).toBe(false)
  }, 60_000)

  test("a --server or --app that is not a name stops before anything is asked or made", async () => {
    const s = fromNothing()
    const server = await s.deploy([], "--server", "Prod")
    expect(server.code).toBe(2)
    expect(server.err).toEqual([`${SERVER_NAME_RULE}\nRun \`zekno --help\` for the list of commands.`])
    const app = await s.deploy([], "--app", "My App")
    expect(app.code).toBe(2)
    expect(app.err).toEqual(["Say which app with `--app <name>`: lowercase letters, digits and hyphens.\nRun `zekno --help` for the list of commands."])
    expect(server.asked).toEqual([])
    expect(app.asked).toEqual([])
    expect(s.profile()).toBeUndefined()
  })

  test("the name refused: A6, and the next answer is used; the destination refused: A7", async () => {
    const s = fromNothing()
    const name = await s.deploy([{ type: " ada" }, "leave"])
    expect(name.refused).toEqual([{ answer: " ada", reason: MEMBER_NAME_RULE }])
    expect(name.err).toEqual(["Nothing was done."])
    const destination = await s.deploy([{ type: "ada" }, { type: "-oProxyCommand=x" }, "leave"])
    expect(destination.refused).toEqual([{ answer: "-oProxyCommand=x", reason: DESTINATION_RULE }])
    expect(destination.err).toEqual([NOTHING_MORE])
    expect(s.ssh.calls()).toEqual([])
  })
})

describe("a name typed as new that the server already holds (security review S3)", () => {
  test("a second machine with no history of the app, its apps not read: A12 from the deploy's own connection, before anything is signed, stored or sent", async () => {
    // Machine A deploys api to prod, from nothing, over the stand-in `ssh`.
    const s = fromNothing({ folder: "api", compose: "services:\n  web:\n    image: example/web:1\n" })
    const first = await s.deploy([{ type: "ada" }, { type: DESTINATION }, { type: "prod" }, { type: "api" }, { yes: false }])
    expect(first.code).toBe(0)
    const serverId = s.profile()!.servers[0]!.serverId
    // Machine B: the same team and server, no history of api, in another folder named api with another Compose file.
    const b = await twin(s.m)
    const folder = join(tempDir("elsewhere"), "api")
    mkdirSync(folder)
    writeFileSync(join(folder, "compose.yaml"), "services:\n  other:\n    image: example/other:1\n")
    b.deps.cwd = folder
    // SSH would ask here: the read in batch mode fails as SSH does then, and the deploy's own connection goes ahead.
    s.ssh.ask()
    const before = snapshot(s.server.root)
    const started = s.m.docker.calls().length
    const plain = b.deps.ui
    const A12 = appTaken("prod", "api")
    for (const [remember, said] of [
      [false, A12],
      [true, `${A12} ${KEPT_SO_FAR}`],
    ] as const) {
      b.deps.ui = plain
      const asking = answering(b, [{ type: "api" }, { yes: remember }])
      const err = b.err.length
      expect(await withSsh(s.ssh, () => b.zekno("deploy"))).toBe(1)
      // The apps were not read, so the name was offered as new, the folder's name filled in.
      expect(asking.asked).toEqual([
        { kind: "ask", question: "Name for this app", fill: "api" },
        { kind: "confirm", question: rememberFolder("api", "prod") },
      ])
      // A12, with F9 once the folder was remembered in this run: what was set up is kept.
      expect(b.err.slice(err)).toEqual([said])
      expect(existsSync(join(folder, "zekno.json"))).toBe(remember)
      // Nothing signed or stored on B, nothing sent: the server and its runner are byte for byte as they were, and nothing started.
      expect(existsSync(join(b.home, "history", serverId, "api.json"))).toBe(false)
      expect(snapshot(s.server.root)).toEqual(before)
      expect(s.m.docker.calls().length).toBe(started)
    }
    // The deploy's own connection read the runner, without batch mode.
    expect(s.ssh.calls().some((call) => /^-- deploy@example\.test \S+ session$/.test(call))).toBe(true)
  }, 90_000)
})

describe("with a profile already (a server on this machine)", () => {
  /** A ready machine, as `answering` drives it, recording what the interface is told. */
  function drive(m: Machine, answers: Answer[]) {
    const plain = m.deps.ui
    const asking = answering(m, answers)
    const events = journal(m)
    return {
      ...asking,
      events,
      async deploy(...args: string[]) {
        const [out, err] = [m.out.length, m.err.length]
        try {
          return { code: await m.zekno("deploy", ...args), out: m.out.slice(out), err: m.err.slice(err) }
        } finally {
          m.deps.ui = plain
        }
      },
    }
  }

  test("a server and an unlinked folder: no opening line, the one server said, then the app", async () => {
    const m = await ready()
    const d = drive(m, [{ type: "web" }, { yes: false }, { value: "hello" }])
    const run = await d.deploy()
    expect(run.code).toBe(0)
    expect(d.events.slice(0, 2)).toEqual(["  Using dev, your only server.", "? Name for this app"])
    expect(d.asked.map((question) => question.question)).toEqual(["Name for this app", rememberFolder("web", "dev"), "Value for GREETING (web on dev): "])
    expect(d.events.some((event) => event.includes("things first"))).toBe(false)
  })

  test("a zekno.json not signed by the team: named (A14), the questions asked as if it were not there, and remember this folder is not asked", async () => {
    const m = await ready()
    writeFileSync(join(m.project, "zekno.json"), JSON.stringify({ app: "other", server: "dev" }))
    const d = drive(m, [{ type: "web" }, { value: "hello" }])
    const run = await d.deploy()
    expect(run.code).toBe(0)
    expect(d.events[0]).toBe("! zekno.json here is not signed by your team, so zekno does not use it. It names other on dev.")
    expect(d.asked.map((question) => question.question)).toEqual(["Name for this app", "Value for GREETING (web on dev): "])
    expect(readFileSync(join(m.project, "zekno.json"), "utf8")).toBe(JSON.stringify({ app: "other", server: "dev" }))
  })

  test("no profile and a zekno.json: F7 before the first question", async () => {
    const s = fromNothing()
    writeFileSync(join(s.project, "zekno.json"), JSON.stringify({ app: "other", server: "dev" }))
    const run = await s.deploy(["leave"])
    expect(run.events.slice(0, 2)).toEqual([
      "! zekno.json here is not signed by your team, so zekno does not use it. It names other on dev.",
      "  Nothing is set up on this machine yet. Three things first: your key, a server, this app.",
    ])
    expect(run.questions).toEqual(["Your name"])
    expect(run.errors).toEqual(["Nothing was done."])
  })

  test("a zekno.json signed by the team and not used here: the first-use question first, and no ends with Nothing was done., nothing connected", async () => {
    const m = await ready()
    expect(await m.zekno("link", "--app", "web", "--server", "dev")).toBe(0)
    const other = await twin(m)
    other.deps.cwd = m.project
    let connections = 0
    const connect = other.deps.connect
    other.deps.connect = (...args) => (connections++, connect(...args))
    const d = drive(other, [{ yes: false }])
    const run = await d.deploy()
    expect(run.code).toBe(1)
    expect(d.asked).toEqual([{ kind: "confirm", question: "Ada linked this folder to web on dev. Use it here?" }])
    expect(run.err).toEqual(["Nothing was done."])
    expect(connections).toBe(0)
  })
})

describe("piped: zekno deploy never asks (FR-002, FR-028)", () => {
  test("no team, two servers, no app: today's sentences and statuses, nothing asked or made", async () => {
    const bare = machine()
    bare.compose(COMPOSE_V1)
    expect(await bare.zekno("deploy")).toBe(1)
    expect(bare.err).toEqual(["No team on this machine yet. Run `zekno init --name <you>` first."])
    expect(existsSync(join(bare.home, "profile.json"))).toBe(false)

    const m = await ready()
    expect(await m.zekno("server", "add", "staging", "--local", "--home", tempDir("staging"))).toBe(0)
    m.err.length = 0
    expect(await m.zekno("deploy")).toBe(2)
    expect(m.err).toEqual([`${MISSING_SERVER}\nRun \`zekno --help\` for the list of commands.`])
    m.err.length = 0
    expect(await m.zekno("deploy", "--server", "dev")).toBe(2)
    expect(m.err).toEqual([`${MISSING_APP}\nRun \`zekno --help\` for the list of commands.`])
    expect(existsSync(join(m.project, "zekno.json"))).toBe(false)
  })
})

describe("the drawn look of a deploy from nothing (mock-up 3, board 'zekno deploy from nothing')", () => {
  test("through the terminal's interface at 100 by 30, keys typed for each answer: every line of mock-up 3, in order, with the empty lines where it has them", async () => {
    const s = fromNothing()
    const t = terminal(100, 30)
    s.m.deps.ui = t.ui
    const answer = async (question: string, keys: string) => {
      await shows(t, question, 30_000)
      t.keys(keys)
    }
    const deployed = withSsh(s.ssh, () => s.m.zekno("deploy"))
    await answer("? Your name ›", "ada\r")
    await answer("? Where is the server? ›", "deploy@203.0.113.7\r")
    await answer("? A name for it ›", "prod\r")
    // The folder's name is filled in; Enter keeps it.
    await answer("? Name for this app › demo", "\r")
    await answer("? Remember this folder? It writes zekno.json, so it always deploys demo to prod. (y/N)", "y")
    await answer("? Value for DATABASE_URL (demo on prod): (hidden)   esc skips it", `${VALUE}\r`)
    expect(await deployed).toBe(0)
    await t.ui.close()

    const screen = t.screen()
    const from = screen.indexOf("  Nothing is set up on this machine yet. Three things first: your key, a server, this app.")
    expect(from).toBeGreaterThanOrEqual(0)
    const drawn = screen.slice(from)
    const before = drawn.slice(0, 23)
    const pattern = (line: string) => line.replace(/[0-9A-Z]{4}(-[0-9A-Z]{4}){4}/, "<code>").replace(/\d+ MB/, "<n> MB")
    expect(before.map(pattern)).toEqual([
      "  Nothing is set up on this machine yet. Three things first: your key, a server, this app.",
      "",
      "? Your name › ada",
      "✔ Key created. It is in your system keychain.",
      "  Team code    <code>",
      "  Identifies your team. A server checks it before it agrees to obey your team.",
      "",
      "? Where is the server? › deploy@203.0.113.7",
      "? A name for it › prod",
      "✔ Connected over SSH",
      "✔ Docker with Compose found",
      "✔ Runner installed  <n> MB, checksum verified",
      "✔ Added prod to the signed team list",
      "  Server code  <code>",
      "  Identifies this server's key. Teammates compare it before they trust the server.",
      "  You reached this server over SSH, so its identity rests on SSH's host verification.",
      "",
      "? Name for this app › demo",
      "? Remember this folder? It writes zekno.json, so it always deploys demo to prod. (y/N) yes",
      "",
      "! compose.yaml expects 1 value that has no secret yet.",
      "? Value for DATABASE_URL (demo on prod): (hidden)",
      "",
    ])
    // The codes in the same column, 15, as the mock-up draws them.
    expect(before[4]!.search(/[0-9A-Z]{4}-/)).toBe(15)
    expect(before[13]!.search(/[0-9A-Z]{4}-/)).toBe(15)
    // Then the deploy panel and stages, as today, and the result line.
    const rest = drawn.slice(23)
    expect(rest[0]).toMatch(/Deploy 1/)
    expect(rest.some((line) => /^✔ demo is live on prod in [0-9]+\.[0-9]s$/.test(line))).toBe(true)
    // The value was never drawn, not even its length.
    expect(t.raw()).not.toContain(VALUE)
    for (const line of screen) expect([...line].length).toBeLessThanOrEqual(100)
  }, 60_000)
})
