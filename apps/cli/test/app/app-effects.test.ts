import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { readSignedDeploy, RunnerStatusSchema } from "@workspace/core"
import {
  existsSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { tempDir, waitFor } from "../../../runner/test/support/helpers"
import { routeErrorLines } from "../../src/app/effects/context"
import { createEffects, type Effects } from "../../src/app/effects/effects"
import { loadStart } from "../../src/app/effects/profile"
import type { AppEvent, Effect } from "../../src/app/state/events"
import { openTeam, TAMPERED } from "../../src/cli/context"
import { memoryKeyStore } from "../../src/profile/keystore"
import { shownPath, tilde } from "../../src/project/shown"
import { openSession } from "../../src/server/session"
import {
  connect,
  type ConnectOptions,
  type Target,
} from "../../src/server/transport"
import { DP5 } from "../../src/settings/words"
import { COMPOSE_V1, machine, ready } from "../support/helpers"
import {
  DESIGN_COMPOSE,
  DESIGN_FILE,
  SENTINEL,
} from "../support/settings-files"

type Machine = ReturnType<typeof machine>

/** A runner that only writes to standard error, with a colour code and a screen clear in it, then says it does not know `session`. */
const NOISY = [
  "sh",
  "-c",
  "printf 'Usage: zekno-runner \\033[31m<setup|sync|apply|status>\\033[0m\\n\\033[2Jagain' >&2; exit 2",
  "sh",
]

describe("starting the app", () => {
  test("no profile is first run, and nothing is read from the keychain", async () => {
    const keyStore = memoryKeyStore()
    const get = spyOn(keyStore, "get")
    expect(await loadStart({ home: tempDir("empty"), keyStore })).toEqual({
      kind: "no-team",
    })
    expect(get).not.toHaveBeenCalled()
  })

  test("a profile that verifies is the team, with its servers", async () => {
    const m = await ready()
    const team = await openTeam(m.deps)
    expect(await loadStart(m.deps)).toEqual({
      kind: "team",
      team: {
        member: "Ada",
        version: 2,
        code: team.teamCode,
        servers: [{ name: "dev", destination: undefined, apps: [] }],
      },
      // The verified team list a zekno.json here is judged against. It holds no key.
      trust: team.trust,
    })
  })

  test("a name or address in the profile folder changed to hold escape sequences is a damaged profile, never drawn", async () => {
    // The member's name and a server's address are not signed: anything on this machine could change them.
    // The profile file is tampered with as loose JSON, as something other than zekno would.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changes: Record<string, (profile: any) => unknown> = {
      memberName: (profile) => ({
        ...profile,
        memberName: "\x1b]52;c;aGVsbG8=\x07Ada\x1b[2J",
      }),
      destination: (profile) => ({
        ...profile,
        servers: profile.servers.map((server: object) => ({
          ...server,
          target: {
            kind: "ssh",
            destination: "x\x1b]8;;https://evil\x07y",
            runnerPath: "zekno-runner",
          },
        })),
      }),
      runnerPath: (profile) => ({
        ...profile,
        servers: profile.servers.map((server: object) => ({
          ...server,
          target: {
            kind: "ssh",
            destination: "deploy@203.0.113.7",
            runnerPath: "zekno-runner\x1b[2J",
          },
        })),
      }),
    }
    for (const [field, change] of Object.entries(changes)) {
      const m = await ready()
      m.tamper("profile.json", change)
      expect({ field, start: await loadStart(m.deps) }).toEqual({
        field,
        start: {
          kind: "profile-error",
          reason: `The profile at ${join(m.home, "profile.json")} is damaged.`,
          folder: tilde(m.home),
        },
      })
    }
  })

  test("what the profile names and its schema accepts is still cleaned before it is drawn", async () => {
    const m = await ready()
    // Characters drawn as nothing that are not control or format characters: Hangul fillers and the
    // combining grapheme joiner. The profile's name rule lets them through; `sanitize` removes them.
    const member = "Aᅟdㅤa͏"
    m.tamper("profile.json", (profile) => ({
      ...profile,
      memberName: member,
      servers: profile.servers.map((server: object) => ({
        ...server,
        target: {
          kind: "ssh",
          destination: "deploy@203.0.113.7",
          runnerPath: "zekno-runner",
        },
      })),
    }))
    const start = await loadStart(m.deps)
    const team = await openTeam(m.deps)
    expect(start).toEqual({
      kind: "team",
      team: {
        member: "Ada",
        version: 2,
        code: team.teamCode,
        servers: [{ name: "dev", destination: "deploy@203.0.113.7", apps: [] }],
      },
      trust: team.trust,
    })
    expect(member).not.toBe("Ada")
  })

  test("a profile changed by something other than zekno is the error screen, with the reason", async () => {
    const m = await ready()
    const other = machine()
    expect(await other.zekno("init", "--name", "Eve")).toBe(0)
    const theirs = JSON.parse(
      await Bun.file(join(other.home, "profile.json")).text()
    )
    m.tamper("profile.json", (profile) => ({
      ...profile,
      rosters: theirs.rosters,
    }))
    const start = await loadStart(m.deps)
    expect(start).toEqual({
      kind: "profile-error",
      reason:
        "The team list in the profile is not the one this machine's key belongs to.",
      folder: tilde(m.home),
    })
    // The screen says in its own words that the folder may have been changed.
    expect(start.kind === "profile-error" && start.reason).not.toContain(
      TAMPERED
    )
  })

  test("a profile whose key is not in the keychain, or that cannot be read, is the error screen", async () => {
    const m = await ready()
    expect(
      await loadStart({ home: m.home, keyStore: memoryKeyStore() })
    ).toMatchObject({
      kind: "profile-error",
      reason: "The signing key is not in the system keychain on this machine.",
    })
    writeFileSync(join(m.home, "profile.json"), "{ not json")
    const damaged = await loadStart(m.deps)
    expect(damaged).toMatchObject({ kind: "profile-error" })
    expect(damaged.kind === "profile-error" && damaged.reason).toContain(
      "is not readable"
    )
  })

  test("a keychain that refuses is the error screen with its reason", async () => {
    const m = await ready()
    const keyStore = {
      ...memoryKeyStore(),
      get: async () => Promise.reject(new Error("denied")),
    }
    expect(await loadStart({ home: m.home, keyStore })).toMatchObject({
      kind: "profile-error",
      reason:
        "The system keychain could not be read. The signing key is kept nowhere else.",
    })
  })

  test("a path under the home folder is shown from ~", () => {
    expect(tilde(join(homedir(), ".zekno"))).toBe("~/.zekno")
    expect(tilde(homedir())).toBe("~")
    expect(tilde("/var/lib/zekno")).toBe("/var/lib/zekno")
    expect(tilde("/home/adam/x", "/home/ada")).toBe("/home/adam/x")
  })
})

describe("what runners write on standard error, while the app is on screen", () => {
  test("goes to the callback, cleaned, and never to the terminal", async () => {
    const lines: string[] = []
    const write = spyOn(process.stderr, "write")
    try {
      const transport = connect(
        { kind: "local", home: tempDir("runner") },
        NOISY,
        { errorLines: (line) => lines.push(line) }
      )
      expect((await transport.run("status")).exitCode).toBe(2)
      expect(write).not.toHaveBeenCalled()
    } finally {
      write.mockRestore()
    }
    expect(lines).toEqual([
      "Usage: zekno-runner <setup|sync|apply|status>",
      "again",
    ])
  })

  test("a single command still writes it to standard error, cleaned, as before", async () => {
    const written: string[] = []
    const write = spyOn(process.stderr, "write").mockImplementation((text) => {
      written.push(String(text))
      return true
    })
    try {
      await connect({ kind: "local", home: tempDir("runner") }, NOISY).run(
        "status"
      )
    } finally {
      write.mockRestore()
    }
    expect(written).toEqual([
      "Usage: zekno-runner <setup|sync|apply|status>\n",
      "again\n",
    ])
  })

  test("the app's operations send it as events, also from a session", async () => {
    const events: AppEvent[] = []
    const effects = createEffects(
      machine().deps,
      (event) => events.push(event),
      (error) => {
        throw error
      }
    )
    const write = spyOn(process.stderr, "write")
    try {
      const session = await openSession(
        effects.deps.connect({ kind: "local", home: tempDir("runner") }, NOISY)
      )
      expect(session.mode).toBe("one-shot")
      expect(write).not.toHaveBeenCalled()
    } finally {
      write.mockRestore()
    }
    expect(events).toEqual([
      {
        type: "runner-line",
        line: "Usage: zekno-runner <setup|sync|apply|status>",
      },
      { type: "runner-line", line: "again" },
    ])
  })

  test("other options are kept when the callback is added", async () => {
    const seen: unknown[] = []
    const recording = {
      ...machine().deps,
      connect: (target: Target, runner: string[], options?: ConnectOptions) => (
        seen.push(options),
        connect(target, runner, options)
      ),
    }
    const deps = routeErrorLines(recording, () => {})
    deps.connect({ kind: "local", home: tempDir("runner") }, NOISY)
    expect(seen).toHaveLength(1)
    expect(typeof (seen[0] as { errorLines?: unknown }).errorLines).toBe(
      "function"
    )
  })

  test("a real runner over the app's operations answers as usual", async () => {
    const m = await ready()
    const effects = createEffects(
      m.deps,
      () => {},
      (error) => {
        throw error
      }
    )
    const session = await openSession(
      effects.deps.connect(
        { kind: "local", home: m.runnerHome },
        m.deps.localRunner
      )
    )
    expect(
      (await session.request("status", RunnerStatusSchema)).team.version
    ).toBe(2)
    expect(await session.close()).toBe(0)
  })
})

describe("effects", () => {
  test("exit is left to the shell; an answer to a question nothing waits for does nothing", async () => {
    const events: AppEvent[] = []
    const m = machine()
    const effects = createEffects(
      m.deps,
      (event) => events.push(event),
      (error) => {
        throw error
      }
    )
    effects.run({ kind: "exit" })
    // No deploy asked these questions, so nothing is written, signed or sent.
    for (const answer of [
      "write-link",
      "skip-link",
      "values-set",
      "skip-values",
    ] as const) {
      effects.run({
        kind: "deploy-continue",
        server: "prod",
        app: "demo",
        answer,
      })
    }
    await Bun.sleep(10)
    expect(events).toEqual([])
    expect(existsSync(join(m.project, "zekno.json"))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// `d` deploys the file the rule picks (specs/010-app-settings, contracts/deploy.md, "The app's `d`"; T033)

/** The effects of every app a test of `d` opened: closed after each test, so no runner a test reached is left running. */
const opened: Effects[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((effects) => effects.close()))
})

const DB_VALUE = "zk_db_value_33d0"
const SESSION_VALUE = "zk_session_value_33d0"
const WHERE = ["--app", "demo", "--server", "dev"]
/** design.md's file with a value its rule refuses, the marker in its place. */
const FAULTY = DESIGN_FILE.replace('"1g"', `"${SENTINEL}"`)
const FAULT =
  "zekno.app.json could not be read as settings. web, deploy.memory: use a size such as 512m or 1g."

/** A ready machine whose folder holds only `files` (compose.yaml taken away unless named). */
async function folderWith(files: Record<string, string>): Promise<Machine> {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(m.project, name), text)
  return m
}

/**
 * The app's effects on `m`, made as app.tsx makes them, with what the app
 * opened on (its verified team list). Every event they send is kept in
 * order; a failure nobody planned for is kept too, and must not happen.
 * `d` is the effect `d` asks for, on the app's screen and on the settings
 * screen alike (test/app/settings-state.test.ts): a deploy of demo on dev.
 */
async function appOn(m: Machine) {
  const events: AppEvent[] = []
  const failures: unknown[] = []
  let connections = 0
  const deps = {
    ...m.deps,
    connect: ((...args) => (
      connections++,
      m.deps.connect(...args)
    )) as typeof m.deps.connect,
  }
  const effects = createEffects(
    deps,
    (event) => events.push(event),
    (error) => failures.push(error),
    undefined,
    {},
    await loadStart(m.deps)
  )
  opened.push(effects)
  const answer = (
    answer: Extract<Effect, { kind: "deploy-continue" }>["answer"]
  ) =>
    effects.run({ kind: "deploy-continue", server: "dev", app: "demo", answer })
  return {
    events,
    failures,
    connections: () => connections,
    d: () => effects.run({ kind: "deploy", server: "dev", app: "demo" }),
    answer,
    /** Waits for the next event of that type after the `seen` first ones. */
    until: (type: AppEvent["type"], seen = 0) =>
      waitFor(
        () => events.slice(seen).some((event) => event.type === type),
        type
      ),
    of: <T extends AppEvent["type"]>(type: T) =>
      events.filter(
        (event): event is Extract<AppEvent, { type: T }> => event.type === type
      ),
  }
}

/** Sets the two secrets design.md's file names, for demo on dev. */
async function withSecrets(m: Machine): Promise<void> {
  for (const [name, value] of [
    ["DATABASE_URL", DB_VALUE],
    ["SESSION_KEY", SESSION_VALUE],
  ] as const) {
    m.typing(value)
    expect(await m.zekno("secret", "set", name, ...WHERE)).toBe(0)
  }
}

/** What `zekno settings compose` prints in `m`'s folder, as bytes on a pipe. */
async function composePrinted(m: Machine): Promise<string> {
  m.out.length = 0
  expect(await m.zekno("settings", "compose")).toBe(0)
  return m.out.map((line) => `${line}\n`).join("")
}

/** The Compose text of each deploy of demo this machine signed, oldest first, read from under its signature. */
async function signed(m: Machine): Promise<string[]> {
  const team = await openTeam(m.deps)
  const server = team.profile.servers[0]!
  return team.store.history(server.serverId, "demo").map((entry) => {
    const read = readSignedDeploy({
      envelope: entry.envelope,
      trust: team.trust,
    })
    if (!read.ok) throw new Error("a history entry did not verify")
    return read.value.deploy.compose
  })
}

/** The Compose file the runner handed the stand-in Docker on its last `up`, and that call's environment. */
function lastUp(m: Machine) {
  const call = m.docker.calls().at(-1)!
  const args = call.args.split(" ")
  return {
    env: call.env,
    text: readFileSync(args[args.indexOf("-f") + 1]!, "utf8"),
  }
}

describe("d deploys the file the folder's rule picks, as zekno deploy does (feature 010, T033)", () => {
  test("only zekno.app.json, not linked: remember this folder? names it; yes links the folder to it, its values are listed, and the deploy signs the text zekno settings compose prints, byte for byte", async () => {
    const m = await folderWith({ "zekno.app.json": DESIGN_FILE })
    const printed = await composePrinted(m)
    expect(printed).toBe(DESIGN_COMPOSE)
    const app = await appOn(m)
    app.d()
    await app.until("ask-remember-folder")
    expect(app.events).toEqual([
      {
        type: "ask-remember-folder",
        server: "dev",
        app: "demo",
        compose: "zekno.app.json",
      },
    ])
    // Nothing is written, connected or signed while the question is open.
    expect(existsSync(join(m.project, "zekno.json"))).toBe(false)
    expect(app.connections()).toBe(0)

    app.answer("write-link")
    await app.until("missing-values")
    expect(app.events.slice(1)).toEqual([
      {
        type: "linked",
        linked: { server: "dev", app: "demo", compose: "zekno.app.json" },
      },
      {
        type: "missing-values",
        server: "dev",
        app: "demo",
        names: ["DATABASE_URL", "SESSION_KEY"],
        file: "zekno.app.json",
      },
    ])
    expect(
      JSON.parse(readFileSync(join(m.project, "zekno.json"), "utf8"))
    ).toMatchObject({
      app: "demo",
      server: "dev",
      compose: "zekno.app.json",
      signed: { payloadType: "zekno.link.v1" },
    })
    expect(app.connections()).toBe(0)

    app.answer("skip-values")
    await app.until("deploy-ended")
    expect(app.of("deploy-started")).toHaveLength(1)
    expect(app.of("deploy-started")[0]!.from).toEndWith("/zekno.app.json")
    expect(app.of("deploy-ended")[0]!.outcome).toBe("started")
    // What was signed, sent and started is what `zekno settings compose` printed, and prints again.
    expect(await signed(m)).toEqual([printed])
    expect(lastUp(m).text).toBe(printed)
    expect(await composePrinted(m)).toBe(printed)
    expect(app.failures).toEqual([])

    // The link written names zekno.app.json: `zekno deploy` with no flags deploys it too.
    expect(await m.zekno("deploy")).toBe(0)
    expect(await signed(m)).toEqual([printed, printed])
  }, 60_000)

  test("n deploys zekno.app.json without writing zekno.json", async () => {
    const m = await folderWith({ "zekno.app.json": DESIGN_FILE })
    await withSecrets(m)
    const app = await appOn(m)
    app.d()
    await app.until("ask-remember-folder")
    app.answer("skip-link")
    await app.until("deploy-ended")
    expect(app.of("missing-values")).toEqual([])
    expect(app.of("deploy-ended")[0]!.outcome).toBe("started")
    expect(existsSync(join(m.project, "zekno.json"))).toBe(false)
    expect(await signed(m)).toEqual([DESIGN_COMPOSE])
    expect(app.failures).toEqual([])
  }, 60_000)

  test("linked to zekno.app.json: d deploys it at once, also with compose.yaml beside it; the secrets reach Docker", async () => {
    const m = await folderWith({ "zekno.app.json": DESIGN_FILE })
    await withSecrets(m)
    expect(await m.zekno("link", ...WHERE)).toBe(0)
    writeFileSync(join(m.project, "compose.yaml"), COMPOSE_V1)
    const app = await appOn(m)
    app.d()
    await app.until("deploy-ended")
    expect(app.of("ask-remember-folder")).toEqual([])
    expect(app.of("missing-values")).toEqual([])
    expect(app.of("notice")).toEqual([])
    expect(app.of("deploy-ended")[0]!.outcome).toBe("started")
    expect(app.of("deploy-started")[0]!.secretNames).toEqual([
      "DATABASE_URL",
      "SESSION_KEY",
    ])
    expect(await signed(m)).toEqual([DESIGN_COMPOSE])
    const up = lastUp(m)
    expect(up.text).toBe(DESIGN_COMPOSE)
    expect(up.env.DATABASE_URL).toBe(DB_VALUE)
    expect(up.env.SESSION_KEY).toBe(SESSION_VALUE)
    // No value is in anything the app was told.
    const told = JSON.stringify(app.events)
    expect(told).not.toContain(DB_VALUE)
    expect(told).not.toContain(SESSION_VALUE)
    expect(app.failures).toEqual([])
  }, 60_000)

  test("both files and no link: DP5 as an error line; nothing asked, read, connected, signed or written. A compose.yaml that is a link to nowhere counts", async () => {
    for (const compose of ["file", "dangling link"] as const) {
      const m = await folderWith({ "zekno.app.json": DESIGN_FILE })
      if (compose === "file")
        writeFileSync(join(m.project, "compose.yaml"), COMPOSE_V1)
      else symlinkSync("nowhere.yaml", join(m.project, "compose.yaml"))
      const app = await appOn(m)
      app.d()
      await app.until("notice")
      expect({ compose, events: app.events }).toEqual({
        compose,
        events: [{ type: "notice", notice: { tone: "error", text: DP5 } }],
      })
      await Bun.sleep(50)
      expect(app.events).toHaveLength(1)
      expect(app.connections()).toBe(0)
      expect(m.docker.calls()).toEqual([])
      expect(existsSync(join(m.home, "history"))).toBe(false)
      expect(existsSync(join(m.project, "zekno.json"))).toBe(false)
      expect(app.failures).toEqual([])
    }
  }, 60_000)

  test("neither file: today's line, unchanged", async () => {
    const m = await folderWith({})
    const app = await appOn(m)
    app.d()
    await app.until("notice")
    expect(app.events).toEqual([
      {
        type: "notice",
        notice: {
          tone: "error",
          text: `There is no compose.yaml in ${shownPath(m.project)}, and no zekno.json names another. Run zekno link -f <file> here to name one.`,
        },
      },
    ])
    expect(m.docker.calls()).toEqual([])
  }, 60_000)

  test("a fault in the settings file, linked or not: its sentence as an error line, before any question; nothing of the file said, nothing connected or signed", async () => {
    for (const linked of [false, true]) {
      const m = await folderWith({ "zekno.app.json": DESIGN_FILE })
      if (linked) expect(await m.zekno("link", ...WHERE)).toBe(0)
      writeFileSync(join(m.project, "zekno.app.json"), FAULTY)
      const app = await appOn(m)
      app.d()
      await app.until("failed")
      expect({ linked, events: app.events }).toEqual({
        linked,
        events: [{ type: "failed", notice: { tone: "error", text: FAULT } }],
      })
      expect(JSON.stringify(app.events)).not.toContain(SENTINEL)
      expect(app.connections()).toBe(0)
      expect(m.docker.calls()).toEqual([])
      expect(existsSync(join(m.home, "history"))).toBe(false)
      expect(app.failures).toEqual([])
    }
  }, 60_000)

  test("a link that names compose.yaml beside zekno.app.json deploys compose.yaml, as before", async () => {
    const m = await folderWith({
      "zekno.app.json": DESIGN_FILE,
      "compose.yaml": COMPOSE_V1,
    })
    expect(await m.zekno("link", ...WHERE, "-f", "compose.yaml")).toBe(0)
    const app = await appOn(m)
    app.d()
    await app.until("missing-values")
    expect(app.of("missing-values")).toEqual([
      {
        type: "missing-values",
        server: "dev",
        app: "demo",
        names: ["GREETING"],
        file: "compose.yaml",
      },
    ])
    app.answer("skip-values")
    await app.until("deploy-ended")
    expect(await signed(m)).toEqual([COMPOSE_V1])
    expect(app.failures).toEqual([])
  }, 60_000)
})
