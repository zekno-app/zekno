/**
 * User Story 1 of specs/010-app-settings: `zekno deploy` from a settings
 * file, end to end against a local runner and the stand-in Docker
 * (contracts/deploy.md, "Tests"; tasks T026, T031). The Compose text the
 * settings turn into is what is signed, sent, started and recorded, byte for
 * byte; a folder with both files is never deployed without being told which;
 * a later setting or a fault stops everything before anything is signed.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { openTeam } from "../../src/cli/context"
import { DP2 } from "../../src/settings/words"
import { readDeployEntry } from "../../src/shared/history"
import {
  answering,
  COMPOSE_V1,
  filesUnder,
  machine,
  ready,
} from "../support/helpers"
import {
  DESIGN_COMPOSE,
  DESIGN_FILE,
  FAULTY_FILES,
  SENTINEL,
} from "../support/settings-files"
import { shows, showsStart, terminal } from "../support/terminal"

type Machine = ReturnType<typeof machine>

const DB_VALUE = "zk_db_value_51ab"
const SESSION_VALUE = "zk_session_value_51ab"
const WHERE = ["--app", "demo", "--server", "dev"]

/** A ready machine whose folder holds only `files` (compose.yaml taken away unless named). */
async function folderWith(files: Record<string, string>): Promise<Machine> {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(m.project, name), text)
  return m
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

/** The Compose text of each deploy of demo this machine signed, oldest first, read from under its signature. */
async function signed(m: Machine, app = "demo"): Promise<string[]> {
  const team = await openTeam(m.deps)
  const server = team.profile.servers[0]!
  return team.store.history(server.serverId, app).map((entry) => {
    const read = readDeployEntry(entry.envelope, team.trust)
    if (!read) throw new Error("a history entry did not verify")
    return read.deploy.compose
  })
}

/** The Compose file the runner handed the stand-in Docker on its last `up`, and that call's arguments and environment. */
function lastUp(m: Machine) {
  const call = m.docker.calls().at(-1)!
  const args = call.args.split(" ")
  const file = args[args.indexOf("-f") + 1]!
  return { call, args, text: readFileSync(file, "utf8") }
}

/** Counts the connections a run makes: none may be made when a deploy stops on this machine. */
function counting(m: Machine) {
  let connections = 0
  const connect = m.deps.connect
  m.deps.connect = (...args) => (connections++, connect(...args))
  return () => connections
}

describe("zekno deploy from zekno.app.json, piped (US1, scenarios 1, 2, 7)", () => {
  test("a folder with only the settings file: deployed, the text the runner starts and the text signed are the Compose text of the contract, byte for byte", async () => {
    const m = await folderWith({ "zekno.app.json": DESIGN_FILE })
    await withSecrets(m)
    m.out.length = 0
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect(m.out).toEqual([
      "Deploy 1 of demo is running on dev with 2 secrets.",
    ])
    const up = lastUp(m)
    expect(up.text).toBe(DESIGN_COMPOSE)
    expect(up.args.slice(0, 3)).toEqual(["compose", "-p", "zekno-demo"])
    expect(up.args).toContain("--remove-orphans")
    // Both secrets reach Docker's environment, where Compose fills `${NAME}`; the text holds neither value.
    expect(up.call.env.DATABASE_URL).toBe(DB_VALUE)
    expect(up.call.env.SESSION_KEY).toBe(SESSION_VALUE)
    expect(await signed(m)).toEqual([DESIGN_COMPOSE])
    // No value is in any file of this machine but the encrypted records, and never in what zekno printed.
    const printed = [...m.out, ...m.err].join("\n")
    expect(printed).not.toContain(DB_VALUE)
    expect(printed).not.toContain(SESSION_VALUE)
    for (const file of filesUnder(m.home))
      expect(file.content).not.toContain(DB_VALUE)
  }, 60_000)

  test("status, logs, a second deploy and a rollback work on it as on any deploy; the rollback signs the first text again", async () => {
    const m = await folderWith({ "zekno.app.json": DESIGN_FILE })
    await withSecrets(m)
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    m.docker.ps(
      "demo",
      '{"Service":"web","State":"running","ExitCode":0,"Health":""}\n'
    )
    m.out.length = 0
    expect(await m.zekno("status", "--server", "dev")).toBe(0)
    expect(m.out).toContain("demo\tdeploy 1\trunning")
    expect(await m.zekno("logs", ...WHERE, "--no-follow")).toBe(0)

    writeFileSync(
      join(m.project, "zekno.app.json"),
      DESIGN_FILE.replace('"memory": "1g"', '"memory": "2g"')
    )
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    const second = DESIGN_COMPOSE.replace('mem_limit: "1g"', 'mem_limit: "2g"')
    expect(lastUp(m).text).toBe(second)
    m.out.length = 0
    expect(await m.zekno("rollback", ...WHERE)).toBe(0)
    expect(m.out.at(-1)).toBe(
      "Deploy 3 of demo is running on dev with 2 secrets."
    )
    expect(lastUp(m).text).toBe(DESIGN_COMPOSE)
    expect(await signed(m)).toEqual([DESIGN_COMPOSE, second, DESIGN_COMPOSE])
  }, 60_000)

  test("without the secrets set, the deploy goes on as a Compose deploy does today (research R9, item 1)", async () => {
    const m = await folderWith({ "zekno.app.json": DESIGN_FILE })
    m.out.length = 0
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect(m.out).toEqual([
      "Deploy 1 of demo is running on dev with no secrets.",
    ])
    expect(lastUp(m).text).toBe(DESIGN_COMPOSE)
  }, 60_000)
})

describe("which file, piped (US1, scenario 4; FR-011)", () => {
  test("both files and no -f: DP2 with no help line, status 2; nothing connected, signed or written", async () => {
    const m = await folderWith({
      "zekno.app.json": DESIGN_FILE,
      "compose.yaml": COMPOSE_V1,
    })
    const connections = counting(m)
    m.err.length = 0
    expect(await m.zekno("deploy", ...WHERE)).toBe(2)
    expect(m.err).toEqual([DP2])
    expect(connections()).toBe(0)
    expect(m.docker.calls()).toEqual([])
    expect(existsSync(join(m.home, "history"))).toBe(false)
  }, 60_000)

  test("-f zekno.app.json and -f compose.yaml each deploy their own file, with both here", async () => {
    const m = await folderWith({
      "zekno.app.json": DESIGN_FILE,
      "compose.yaml": COMPOSE_V1,
    })
    expect(await m.zekno("deploy", ...WHERE, "-f", "zekno.app.json")).toBe(0)
    expect(lastUp(m).text).toBe(DESIGN_COMPOSE)
    expect(await m.zekno("deploy", ...WHERE, "-f", "compose.yaml")).toBe(0)
    expect(lastUp(m).text).toBe(COMPOSE_V1)
    expect(await signed(m)).toEqual([DESIGN_COMPOSE, COMPOSE_V1])
  }, 60_000)

  test("a zekno.json signed by the team naming zekno.app.json decides, with no flags, also with compose.yaml here", async () => {
    const m = await folderWith({ "zekno.app.json": DESIGN_FILE })
    expect(await m.zekno("link", ...WHERE)).toBe(0)
    expect(
      JSON.parse(readFileSync(join(m.project, "zekno.json"), "utf8")).compose
    ).toBe("zekno.app.json")
    writeFileSync(join(m.project, "compose.yaml"), COMPOSE_V1)
    m.out.length = 0
    expect(await m.zekno("deploy")).toBe(0)
    expect(m.out).toEqual([
      "Deploy 1 of demo is running on dev with no secrets.",
    ])
    expect(lastUp(m).text).toBe(DESIGN_COMPOSE)
    // -f still wins over it.
    expect(await m.zekno("deploy", "-f", "compose.yaml")).toBe(0)
    expect(lastUp(m).text).toBe(COMPOSE_V1)
  }, 60_000)

  test("zekno link without -f names the one file here: zekno.app.json alone; both is DP2 and status 2; neither is today's sentence", async () => {
    const only = await folderWith({ "zekno.app.json": DESIGN_FILE })
    expect(await only.zekno("link", ...WHERE)).toBe(0)
    expect(only.lastOut()).toBe(
      `Wrote ${join(only.project, "zekno.json")}: this folder deploys demo to dev from zekno.app.json. It holds no secret.`
    )

    const both = await folderWith({
      "zekno.app.json": DESIGN_FILE,
      "compose.yaml": COMPOSE_V1,
    })
    both.err.length = 0
    expect(await both.zekno("link", ...WHERE)).toBe(2)
    expect(both.err).toEqual([DP2])
    expect(existsSync(join(both.project, "zekno.json"))).toBe(false)
    expect(await both.zekno("link", ...WHERE, "-f", "compose.yaml")).toBe(0)

    const neither = await folderWith({})
    neither.err.length = 0
    expect(await neither.zekno("link", ...WHERE)).toBe(1)
    expect(neither.err).toEqual([
      `No Compose file at ${join(neither.project, "compose.yaml")}. Point to one with \`-f <file>\`.`,
    ])
  }, 60_000)

  test("zekno link at a terminal with both files and no -f: DP2 before the server or the app is asked, status 2", async () => {
    const m = await folderWith({
      "zekno.app.json": DESIGN_FILE,
      "compose.yaml": COMPOSE_V1,
    })
    const asking = answering(m, [])
    m.err.length = 0
    expect(await m.zekno("link")).toBe(2)
    expect(asking.asked).toEqual([])
    expect(m.err).toEqual([DP2])
    expect(existsSync(join(m.project, "zekno.json"))).toBe(false)
  }, 60_000)

  test("neither file: today's sentence, unchanged", async () => {
    const m = await folderWith({})
    m.err.length = 0
    expect(await m.zekno("deploy", ...WHERE)).toBe(1)
    expect(m.err).toEqual([
      `No Compose file at ${join(m.project, "compose.yaml")}. Point to one with \`-f <file>\`.`,
    ])
  }, 60_000)
})

describe("a file that cannot be used stops everything (US1, scenarios 5 and 6)", () => {
  const LATER: [string, string][] = [
    [
      '"build": {}',
      "zekno.app.json sets a build for web. Building from source is not in this version of zekno yet.",
    ],
    [
      '"predeploy": "bun run migrate"',
      "zekno.app.json sets a pre-deploy command for web. A pre-deploy command is not in this version of zekno yet.",
    ],
    [
      '"healthcheck": "/health"',
      "zekno.app.json sets a health check for web. Health checks are not in this version of zekno yet.",
    ],
    [
      '"replicas": 2',
      "zekno.app.json sets replicas for web. Several copies of a service are not in this version of zekno yet.",
    ],
    [
      '"domains": ["demo.example.com"]',
      "zekno.app.json sets a domain for web. Domains are not in this version of zekno yet.",
    ],
  ]
  const PLACE: Record<string, string> = {
    build: "source",
    predeploy: "deploy",
    healthcheck: "deploy",
    replicas: "deploy",
    domains: "networking",
  }

  test("each later setting, and SV11: status 1, its sentence; nothing connected, signed or written", async () => {
    const m = await folderWith({})
    const connections = counting(m)
    const cases: [string, string][] = LATER.map(([setting, sentence]) => {
      const key = /"([a-z]+)"/.exec(setting)![1]!
      const section = PLACE[key]!
      const text = DESIGN_FILE.replace(
        section === "source"
          ? '"source": { "image": "ghcr.io/acme/demo-web:1.4.2" }'
          : `"${section}": {`,
        section === "source"
          ? `"source": { "image": "ghcr.io/acme/demo-web:1.4.2", ${setting} }`
          : `"${section}": { ${setting},`
      )
      return [text, sentence]
    })
    cases.push([
      DESIGN_FILE.replace('"1g"', `"${SENTINEL}"`),
      "zekno.app.json could not be read as settings. web, deploy.memory: use a size such as 512m or 1g.",
    ])
    for (const [text, sentence] of cases) {
      writeFileSync(join(m.project, "zekno.app.json"), text)
      m.err.length = 0
      expect(await m.zekno("deploy", ...WHERE)).toBe(1)
      expect(m.err).toEqual([sentence])
    }
    expect(connections()).toBe(0)
    expect(m.docker.calls()).toEqual([])
    expect(existsSync(join(m.home, "history"))).toBe(false)
    expect(m.err.join("\n")).not.toContain(SENTINEL)
  }, 60_000)

  test("every faulty file of the test set: its own sentence, status 1, and nothing of its content said", async () => {
    const m = await folderWith({})
    const connections = counting(m)
    for (const file of FAULTY_FILES) {
      writeFileSync(join(m.project, "zekno.app.json"), file.text)
      m.err.length = 0
      expect({
        name: file.name,
        code: await m.zekno("deploy", ...WHERE),
      }).toEqual({ name: file.name, code: 1 })
      expect({ name: file.name, err: m.err }).toEqual({
        name: file.name,
        err: [file.expect.fault],
      })
      expect(m.err.join("\n")).not.toContain(SENTINEL)
    }
    expect(connections()).toBe(0)
    expect(m.docker.calls()).toEqual([])
  }, 120_000)
})

describe("from a Compose file to settings and back, on the same app (FR-012)", () => {
  test("each signed text is its own; a service left out of the settings is not in the text; every up removes orphans", async () => {
    const m = await folderWith({ "compose.yaml": COMPOSE_V1 })
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    rmSync(join(m.project, "compose.yaml"))
    const webOnly = DESIGN_FILE.replace(
      /,\n {4}"worker": \{[\s\S]*?\n {4}\}\n/,
      "\n"
    )
    expect(webOnly).not.toContain("worker")
    writeFileSync(join(m.project, "zekno.app.json"), webOnly)
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    const settingsText = lastUp(m).text
    expect(settingsText).not.toContain("worker")
    expect(settingsText.startsWith('services:\n  "web":\n')).toBe(true)
    rmSync(join(m.project, "zekno.app.json"))
    writeFileSync(join(m.project, "compose.yaml"), COMPOSE_V1)
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect(await signed(m)).toEqual([COMPOSE_V1, settingsText, COMPOSE_V1])
    const ups = m.docker.calls()
    expect(ups).toHaveLength(3)
    for (const up of ups) expect(up.args).toContain("--remove-orphans")
  }, 60_000)
})

describe("at a terminal (board `SettingsDeploy`, T031)", () => {
  /** Runs `zekno <args>` through the terminal's interface, 100 by 30, and gives the status and the lines drawn. */
  async function drawn(m: Machine, ...args: string[]) {
    const t = terminal(100, 30)
    const before = m.deps.ui
    m.deps.ui = t.ui
    try {
      const code = await m.zekno(...args)
      await t.ui.close()
      return { code, lines: t.lines(), raw: t.raw() }
    } finally {
      m.deps.ui = before
    }
  }

  test("the panel's rows are app, server, from and secrets; from is the file and its services", async () => {
    const m = await folderWith({ "zekno.app.json": DESIGN_FILE })
    await withSecrets(m)
    const run = await drawn(m, "deploy", ...WHERE)
    expect(run.code).toBe(0)
    const at = run.lines.findIndex((line) => /^╭─ Deploy 1 ─+╮$/.test(line))
    expect(at).toBeGreaterThanOrEqual(0)
    expect(run.lines.slice(at + 1, at + 6)).toEqual([
      expect.stringMatching(/^│ app {7}demo +│$/),
      expect.stringMatching(/^│ server {4}dev +│$/),
      expect.stringMatching(
        /^│ from {6}zekno\.app\.json {2}2 services: web, worker +│$/
      ),
      expect.stringMatching(/^│ secrets {3}2 +│$/),
      expect.stringMatching(/^╰─+╯$/),
    ])
    expect(run.raw).not.toContain(DB_VALUE)
  }, 60_000)

  test("one service reads `1 service: web`; a Compose deploy's panel has no from row", async () => {
    const one = await folderWith({
      "zekno.app.json": DESIGN_FILE.replace(
        /,\n {4}"worker": \{[\s\S]*?\n {4}\}\n/,
        "\n"
      ),
    })
    await withSecrets(one)
    const run = await drawn(one, "deploy", ...WHERE)
    expect(run.code).toBe(0)
    expect(
      run.lines.some((line) =>
        /^│ from {6}zekno\.app\.json {2}1 service: web +│$/.test(line)
      )
    ).toBe(true)

    const compose = await folderWith({ "compose.yaml": COMPOSE_V1 })
    compose.typing("hello")
    expect(await compose.zekno("secret", "set", "GREETING", ...WHERE)).toBe(0)
    const plain = await drawn(compose, "deploy", ...WHERE)
    expect(plain.code).toBe(0)
    expect(plain.lines.some((line) => line.startsWith("│ from"))).toBe(false)
    expect(plain.lines.some((line) => line.startsWith("│ secrets"))).toBe(true)
  }, 60_000)

  test("a later setting: its first sentence after ✖, its second under it, set in by two columns; nothing deployed", async () => {
    const m = await folderWith({
      "zekno.app.json": DESIGN_FILE.replace(
        '"networking": {',
        '"networking": { "domains": ["demo.example.com"],'
      ),
    })
    const t = terminal(100, 30)
    m.deps.ui = t.ui
    const code = await m.zekno("deploy", ...WHERE)
    await showsStart(t, "✖")
    await t.ui.close()
    expect(code).toBe(1)
    expect(t.lines()).toEqual([
      "✖ zekno.app.json sets a domain for web.",
      "  Domains are not in this version of zekno yet.",
    ])
    expect(m.docker.calls()).toEqual([])
  }, 60_000)

  test("both files and Enter on the first row: ✔ From  zekno.app.json is left, and the settings are deployed", async () => {
    const m = await folderWith({
      "zekno.app.json": DESIGN_FILE,
      "compose.yaml": COMPOSE_V1,
    })
    await withSecrets(m)
    const t = terminal(100, 30)
    m.deps.ui = t.ui
    const deploying = m.zekno("deploy", ...WHERE)
    await shows(t, "? Deploy from which file?", 30_000)
    expect(t.lines()).toEqual([
      "? Deploy from which file?",
      "  ❯ zekno.app.json  your settings",
      "    compose.yaml    a Compose file written by hand",
      "  ↑↓ move   enter choose   esc leave",
    ])
    t.keys("\r")
    expect(await deploying).toBe(0)
    await t.ui.close()
    expect(t.lines()[0]).toBe("✔ From  zekno.app.json")
    expect(lastUp(m).text).toBe(DESIGN_COMPOSE)
  }, 60_000)
})
