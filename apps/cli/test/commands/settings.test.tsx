/**
 * The `zekno settings` commands through `run`, piped and at a terminal
 * (specs/010-app-settings, contracts/commands.md; board `CmdSettings`;
 * tasks T039). Plain output goes through the plain interface; a terminal is
 * the stand-in of test/support/terminal.ts.
 */
import { describe, expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SH1, SH2 } from "../../src/settings/words"
import { COMPOSE_V1, machine, ready } from "../support/helpers"
import { DESIGN_FILE, SENTINEL } from "../support/settings-files"
import { terminal } from "../support/terminal"

type Machine = ReturnType<typeof machine>

/** A value a secret holds: it may appear in no output of any settings command (SC-004). */
const SECRET_VALUE = "zk_secret_value_3d9c"

/** contracts/commands.md, "Piped", for design.md's file. */
const PIPED = [
  "web\tsource.image\tghcr.io/acme/demo-web:1.4.2",
  "web\tdeploy.start\tbun run start",
  "web\tdeploy.restart\ton-failure",
  "web\tdeploy.memory\t1g",
  "web\tdeploy.cpus\t1",
  "web\tnetworking.port\t3000",
  "web\tvariables.secrets\tDATABASE_URL,SESSION_KEY",
  "web\tvariables.plain.NODE_ENV\tproduction",
  "web\tvolumes.uploads\t/data/uploads",
  "worker\tsource.image\tghcr.io/acme/demo-worker:1.4.2",
  "worker\tdeploy.start\tbun run worker",
  "worker\tdeploy.restart\talways",
  "worker\tvariables.secrets\tDATABASE_URL",
]

/** contracts/commands.md, "--json", for design.md's file. */
const JSON_LINE =
  '{"zekno":1,"services":{"web":{"source":{"image":"ghcr.io/acme/demo-web:1.4.2"},"deploy":{"start":"bun run start","restart":"on-failure","memory":"1g","cpus":1},"networking":{"port":3000},"variables":{"secrets":["DATABASE_URL","SESSION_KEY"],"plain":{"NODE_ENV":"production"}},"volumes":{"uploads":"/data/uploads"}},"worker":{"source":{"image":"ghcr.io/acme/demo-worker:1.4.2"},"deploy":{"start":"bun run worker","restart":"always"},"variables":{"secrets":["DATABASE_URL"]}}}}'

/** The board's left column, the services' rows: the label column at 16, the values at 26. */
const ROWS = [
  "",
  "  web",
  "  Source        image     ghcr.io/acme/demo-web:1.4.2",
  "  Deploy        start     bun run start",
  "                restart   on failure",
  "                memory    1g  ! changed, not deployed (was 512m)",
  "                cpus      1",
  "  Networking    port      3000, not published",
  "  Variables     secrets   DATABASE_URL, SESSION_KEY",
  "                plain     NODE_ENV=production",
  "  Volumes       uploads   /data/uploads",
  "",
  "  worker",
  "  Source        image     ghcr.io/acme/demo-worker:1.4.2",
  "  Deploy        start     bun run worker",
  "                restart   always",
  "  Variables     secrets   DATABASE_URL",
]

/** Runs `zekno <args>` at a stand-in terminal and gives the status and the screen, its last empty lines left out. */
async function atTerminal(m: Machine, ...args: string[]) {
  const t = terminal(100, 40)
  const before = m.deps.ui
  m.deps.ui = t.ui
  try {
    const code = await m.zekno(...args)
    await t.ui.close()
    const screen = t.screen()
    while (screen.at(-1) === "") screen.pop()
    return { code, screen, raw: t.raw() }
  } finally {
    m.deps.ui = before
  }
}

/** The plain run of `zekno <args>`: its status and what it wrote on each stream. */
async function piped(m: Machine, ...args: string[]) {
  m.out.length = 0
  m.err.length = 0
  const code = await m.zekno(...args)
  return { code, out: [...m.out], err: [...m.err] }
}

describe("zekno settings", () => {
  test("piped: one line per setting, as contracts/commands.md writes them; status 0", async () => {
    const m = machine()
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    expect(await piped(m, "settings")).toEqual({
      code: 0,
      out: PIPED,
      err: [],
    })
  })

  test("--json: exactly the object of the contract, on one line", async () => {
    const m = machine()
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    expect(await piped(m, "settings", "--json")).toEqual({
      code: 0,
      out: [JSON_LINE],
      err: [],
    })
  })

  test("SH1 and SH2 on standard error, status 1, nothing else printed", async () => {
    const m = machine()
    expect(await piped(m, "settings")).toEqual({
      code: 1,
      out: [],
      err: [SH1],
    })
    m.compose(COMPOSE_V1)
    expect(await piped(m, "settings")).toEqual({
      code: 1,
      out: [],
      err: [SH2("compose.yaml")],
    })
    expect(await piped(m, "settings", "--json")).toEqual({
      code: 1,
      out: [],
      err: [SH2("compose.yaml")],
    })
  })

  test("a fault: its sentence, status 1, nothing of the file said", async () => {
    const m = machine()
    writeFileSync(
      join(m.project, "zekno.app.json"),
      DESIGN_FILE.replace('"bun run start"', `"${SENTINEL} && x"`)
    )
    const run = await piped(m, "settings")
    expect(run).toEqual({
      code: 1,
      out: [],
      err: [
        "zekno.app.json could not be read as settings. web, deploy.start: it runs without a shell, so put ; & | < > ( ) $ and backquotes in quotes. To use a shell, start it with sh -c.",
      ],
    })
    expect(run.err.join("\n")).not.toContain(SENTINEL)
  })

  test("a word too many: status 2, with the help line", async () => {
    const m = machine()
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    const run = await piped(m, "settings", "extra")
    expect(run.code).toBe(2)
    expect(run.out).toEqual([])
    expect(run.err).toEqual([
      'Unknown command "settings extra".\nRun `zekno --help` for the list of commands.',
    ])
  })

  test("at a terminal with no profile: no A3, the settings shown, the file alone on the first line", async () => {
    const m = machine()
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    const run = await atTerminal(m, "settings")
    expect(run.code).toBe(0)
    expect(run.screen).toEqual([
      "  zekno.app.json",
      ...ROWS.map((line) =>
        line.replace("  ! changed, not deployed (was 512m)", "")
      ),
    ])
  })

  test("at a terminal in a linked folder, last deployed with memory 512m: the board's left column, line by line", async () => {
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(
      join(m.project, "zekno.app.json"),
      DESIGN_FILE.replace('"1g"', '"512m"')
    )
    expect(await m.zekno("link", "--app", "demo", "--server", "dev")).toBe(0)
    expect(await m.zekno("deploy")).toBe(0)
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    const run = await atTerminal(m, "settings")
    expect(run.code).toBe(0)
    expect(run.screen).toEqual(["  demo  from zekno.app.json", ...ROWS])
  }, 60_000)

  test("no secret value appears in any output, piped, as JSON or at a terminal (SC-004)", async () => {
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    m.typing(SECRET_VALUE)
    expect(
      await m.zekno(
        "secret",
        "set",
        "DATABASE_URL",
        "--app",
        "demo",
        "--server",
        "dev"
      )
    ).toBe(0)
    expect(await m.zekno("link", "--app", "demo", "--server", "dev")).toBe(0)
    expect(await m.zekno("deploy")).toBe(0)
    const plainRun = await piped(m, "settings")
    const jsonRun = await piped(m, "settings", "--json")
    const drawn = await atTerminal(m, "settings")
    expect(plainRun.code).toBe(0)
    expect(jsonRun.code).toBe(0)
    expect(drawn.code).toBe(0)
    const everything = [
      ...plainRun.out,
      ...plainRun.err,
      ...jsonRun.out,
      ...jsonRun.err,
      drawn.raw,
    ].join("\n")
    expect(everything).toContain("DATABASE_URL")
    expect(everything).not.toContain(SECRET_VALUE)
  }, 60_000)
})
