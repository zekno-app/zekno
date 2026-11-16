/**
 * The `zekno settings` commands through `run`, piped and at a terminal
 * (specs/010-app-settings, contracts/commands.md; board `CmdSettings`;
 * tasks T039). Plain output goes through the plain interface; a terminal is
 * the stand-in of test/support/terminal.ts.
 */
import { describe, expect, test } from "bun:test"
import {
  chmodSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { checkSettings } from "../../src/settings/schema"
import { settingsText } from "../../src/settings/text"
import type { ServiceSettings, Settings } from "../../src/settings/types"
import {
  CS1,
  CS10,
  CS13,
  CS14,
  CS15,
  CS2,
  CS5,
  CS6,
  IN1_RULE,
  IN4,
  IN5,
  IN6,
  SH1,
  SH2,
} from "../../src/settings/words"
import { answering, COMPOSE_V1, machine, ready } from "../support/helpers"
import {
  DESIGN_FILE,
  DESIGN_SETTINGS,
  SENTINEL,
} from "../support/settings-files"
import { shows, terminal } from "../support/terminal"

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

/** The help line a `UsageError` ends with. */
const HELP_LINE = "\nRun `zekno --help` for the list of commands."

/** A machine with no profile whose folder holds `file` as zekno.app.json, a keychain and every connection failing whatever touches them. */
function settingsHere(file = DESIGN_FILE) {
  const m = machine()
  writeFileSync(join(m.project, "zekno.app.json"), file)
  const no = (what: string) => () => {
    throw new Error(what)
  }
  m.deps.keyStore = {
    get: no("the keychain was read"),
    set: no("the keychain was written"),
    delete: no("the keychain was written"),
  }
  m.deps.connect = no("a connection was made")
  return m
}

const fileOf = (m: Machine): string =>
  readFileSync(join(m.project, "zekno.app.json"), "utf8")

/** design.md's settings with one field of web changed. */
const webWith = (service: Partial<ServiceSettings>): Settings => ({
  ...DESIGN_SETTINGS,
  services: DESIGN_SETTINGS.services.map(([name, each]) =>
    name === "web" ? [name, { ...each, ...service }] : [name, each]
  ),
})

/** For each setting of contracts/commands.md's table: a good value and the settings it gives, and a value refused with its CS7. */
const TABLE: {
  setting: string
  good: string
  gives: Partial<ServiceSettings>
  refused: string
  says: string
}[] = [
  {
    setting: "image",
    good: "ghcr.io/acme/demo-web:1.5.0",
    gives: { image: "ghcr.io/acme/demo-web:1.5.0" },
    refused: "ACME/web",
    says: "That is not an image reference. Use one such as ghcr.io/acme/web:1.4.2.",
  },
  {
    setting: "start",
    good: "bun run serve",
    gives: { start: "bun run serve" },
    refused: "a && b",
    says: "That is not a start command zekno can run. It runs without a shell, so put ; & | < > ( ) $ and backquotes in quotes. To use a shell, start it with sh -c.",
  },
  {
    setting: "restart",
    good: "always",
    gives: { restart: "always" },
    refused: "sometimes",
    says: "That is not a restart rule. Use no, on-failure or always.",
  },
  {
    setting: "memory",
    good: "2g",
    gives: { memory: "2g" },
    refused: "lots",
    says: "That is not a memory limit. Use a size such as 512m or 1g.",
  },
  {
    setting: "cpus",
    good: "0.5",
    gives: { cpus: "0.5" },
    refused: "1.234",
    says: "That is not a processor limit. Use a number of processors, such as 0.5 or 2.",
  },
  {
    setting: "port",
    good: "8080",
    gives: { port: 8080 },
    refused: "70000",
    says: "That is not a port. Use a port from 1 to 65535.",
  },
  {
    setting: "publish",
    good: "8080",
    gives: { publish: 8080 },
    refused: "0",
    says: "That is not a port. Use a port from 1 to 65535.",
  },
  {
    setting: "secrets",
    good: "DATABASE_URL, SESSION_KEY ,API_KEY",
    gives: { secrets: ["DATABASE_URL", "SESSION_KEY", "API_KEY"] },
    refused: "1A",
    says: "That is not a list of secret names. A secret name uses letters, digits and underscore, does not start with a digit, and is not one zekno keeps for itself.",
  },
  {
    setting: "plain.NODE_ENV",
    good: "development",
    gives: { plain: [["NODE_ENV", "development"]] },
    refused: "a\u0007b",
    says: "That is not a value zekno can write. Use one line with no control character, at most 4096 characters.",
  },
  {
    setting: "volumes.uploads",
    good: "/srv/uploads",
    gives: { volumes: [["uploads", "/srv/uploads"]] },
    refused: "data",
    says: "That is not a mount path. Use an absolute path in the container, such as /data.",
  },
]

describe("zekno settings set and unset (T051)", () => {
  test("at a terminal: the board's lines for set web.memory 1g answered y; the file holds the change, one line of it", async () => {
    const before = DESIGN_FILE.replace('"1g"', '"512m"')
    const m = settingsHere(before)
    const t = terminal(100, 30)
    m.deps.ui = t.ui
    const setting = m.zekno("settings", "set", "web.memory", "1g")
    const question =
      "? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N)"
    await shows(t, question)
    t.keys("y")
    expect(await setting).toBe(0)
    await t.ui.close()
    expect(t.lines()).toEqual([
      "  web · memory limit  512m → 1g",
      `${question} yes`,
      "✔ Written  Run zekno deploy to use it.",
    ])
    expect(fileOf(m)).toBe(DESIGN_FILE)
    const changed = before
      .split("\n")
      .filter((line, at) => line !== DESIGN_FILE.split("\n")[at])
    expect(changed).toEqual(['        "memory": "512m",'])
  })

  test("at a terminal: a value not allowed is its two sentences, status 2, no help line, the file untouched", async () => {
    const m = settingsHere()
    const run = await atTerminal(m, "settings", "set", "web.memory", "lots")
    expect(run.code).toBe(2)
    expect(run.screen).toEqual([
      "✖ That is not a memory limit.",
      "  Use a size such as 512m or 1g.",
    ])
    expect(fileOf(m)).toBe(DESIGN_FILE)
  })

  test("n, Esc and Ctrl-C: Nothing was done., status 1, the file unchanged byte for byte", async () => {
    for (const key of ["n", "\x1b", "\x03"]) {
      const m = settingsHere()
      const t = terminal(100, 30)
      m.deps.ui = t.ui
      const setting = m.zekno("settings", "set", "web.memory", "2g")
      await shows(
        t,
        "? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N)"
      )
      t.keys(key)
      expect(await setting).toBe(1)
      await t.ui.close()
      expect(t.lines().at(-1)).toBe("✖ Nothing was done.")
      expect(fileOf(m)).toBe(DESIGN_FILE)
    }
  })

  test("--yes at a terminal asks nothing", async () => {
    const m = settingsHere()
    const run = await atTerminal(
      m,
      "settings",
      "set",
      "web.memory",
      "2g",
      "--yes"
    )
    expect(run.code).toBe(0)
    expect(run.screen).toEqual([
      "  web · memory limit  1g → 2g",
      "✔ Written  Run zekno deploy to use it.",
    ])
  })

  test("piped: with --yes the two lines and status 0; without, the change line, CS10 on standard error and status 1, nothing written", async () => {
    const m = settingsHere()
    expect(await piped(m, "settings", "set", "web.memory", "2g")).toEqual({
      code: 1,
      out: ["web · memory limit  1g → 2g"],
      err: [CS10("zekno.app.json")],
    })
    expect(fileOf(m)).toBe(DESIGN_FILE)
    expect(
      await piped(m, "settings", "set", "web.memory", "2g", "--yes")
    ).toEqual({
      code: 0,
      out: [
        "web · memory limit  1g → 2g",
        "Written  Run zekno deploy to use it.",
      ],
      err: [],
    })
    expect(await piped(m, "settings", "unset", "web.memory", "--yes")).toEqual({
      code: 0,
      out: [
        "web · memory limit  2g → no limit",
        "Written  Run zekno deploy to use it.",
      ],
      err: [],
    })
    expect(fileOf(m)).toBe(DESIGN_FILE.replace('        "memory": "1g",\n', ""))
  })

  test("every setting of the table, by its short and its long name: a good value changes that setting only; a refused one is CS7, status 2, nothing written", async () => {
    const long: Record<string, string> = {
      image: "source.image",
      start: "deploy.start",
      restart: "deploy.restart",
      memory: "deploy.memory",
      cpus: "deploy.cpus",
      port: "networking.port",
      publish: "networking.publish",
      secrets: "variables.secrets",
      "plain.NODE_ENV": "variables.plain.NODE_ENV",
      "volumes.uploads": "volumes.uploads",
    }
    for (const row of TABLE) {
      for (const name of [row.setting, long[row.setting]!]) {
        const m = settingsHere()
        const good = await piped(
          m,
          "settings",
          "set",
          `web.${name}`,
          row.good,
          "--yes"
        )
        expect({ name, code: good.code, err: good.err }).toEqual({
          name,
          code: 0,
          err: [],
        })
        expect({
          name,
          settings: checkSettings(fileOf(m), "zekno.app.json"),
        }).toEqual({ name, settings: webWith(row.gives) })
      }
      const m = settingsHere()
      expect(
        await piped(m, "settings", "set", `web.${row.setting}`, row.refused)
      ).toEqual({ code: 2, out: [], err: [row.says] })
      expect(fileOf(m)).toBe(DESIGN_FILE)
    }
  })

  test("a new plain variable and a new volume are added last; unset removes them", async () => {
    const m = settingsHere()
    expect(
      (await piped(m, "settings", "set", "web.plain.LOG", "debug", "--yes"))
        .code
    ).toBe(0)
    expect(
      (
        await piped(
          m,
          "settings",
          "set",
          "web.volumes.cache",
          "/cache",
          "--yes"
        )
      ).code
    ).toBe(0)
    expect(checkSettings(fileOf(m), "zekno.app.json")).toEqual(
      webWith({
        plain: [
          ["NODE_ENV", "production"],
          ["LOG", "debug"],
        ],
        volumes: [
          ["uploads", "/data/uploads"],
          ["cache", "/cache"],
        ],
      })
    )
    expect(
      (await piped(m, "settings", "unset", "web.plain.LOG", "--yes")).code
    ).toBe(0)
    expect(
      (await piped(m, "settings", "unset", "web.volumes.cache", "--yes")).code
    ).toBe(0)
    expect(fileOf(m)).toBe(DESIGN_FILE)
  })

  test("a value that starts with a hyphen is given after `--`, as for any command", async () => {
    const m = settingsHere()
    const run = await piped(
      m,
      "settings",
      "set",
      "--yes",
      "web.plain.FLAGS",
      "--",
      "-v"
    )
    expect(run.code).toBe(0)
    expect(run.out[0]).toBe("web · FLAGS  none → -v")
    expect(checkSettings(fileOf(m), "zekno.app.json")).toEqual(
      webWith({
        plain: [
          ["NODE_ENV", "production"],
          ["FLAGS", "-v"],
        ],
      })
    )
  })

  test("the words and the setting: CS1 and CS2 with the help line, a word too many, CS5 and CS6 without it", async () => {
    const m = settingsHere()
    expect(await piped(m, "settings", "set")).toEqual({
      code: 2,
      out: [],
      err: [`${CS1("set")}${HELP_LINE}`],
    })
    expect(await piped(m, "settings", "unset")).toEqual({
      code: 2,
      out: [],
      err: [`${CS1("unset")}${HELP_LINE}`],
    })
    expect(await piped(m, "settings", "set", "web.memory")).toEqual({
      code: 2,
      out: [],
      err: [`${CS2}${HELP_LINE}`],
    })
    expect(
      await piped(m, "settings", "set", "web.memory", "1g", "extra")
    ).toEqual({
      code: 2,
      out: [],
      err: [`Unexpected "extra" after \`zekno settings set\`.${HELP_LINE}`],
    })
    expect(await piped(m, "settings", "set", "web.memroy", "1g")).toEqual({
      code: 2,
      out: [],
      err: [CS5],
    })
    expect(await piped(m, "settings", "set", "web.domains", "x")).toEqual({
      code: 2,
      out: [],
      err: [CS6("domains")],
    })
    expect(fileOf(m)).toBe(DESIGN_FILE)
  })

  test("the file and what the change would make: SH1, CS4, CS8, CS15, CS16, CS17, each with its status", async () => {
    expect(
      await piped(machine(), "settings", "set", "web.memory", "1g")
    ).toEqual({ code: 1, out: [], err: [SH1] })
    const m = settingsHere()
    expect(await piped(m, "settings", "set", "api.memory", "1g")).toEqual({
      code: 2,
      out: [],
      err: ["zekno.app.json has no service api. Its services are web, worker."],
    })
    expect(await piped(m, "settings", "set", "web.memory", "1g")).toEqual({
      code: 0,
      out: ["web · memory limit is 1g already. Nothing was written."],
      err: [],
    })
    expect(await piped(m, "settings", "unset", "web.image")).toEqual({
      code: 2,
      out: [],
      err: [CS15],
    })
    expect(await piped(m, "settings", "unset", "worker.memory")).toEqual({
      code: 0,
      out: ["worker · memory limit is not set. Nothing was written."],
      err: [],
    })
    expect(await piped(m, "settings", "set", "worker.publish", "80")).toEqual({
      code: 2,
      out: [],
      err: [
        "That change cannot be written. worker, networking.publish: set networking.port too, the port it reaches.",
      ],
    })
    expect(fileOf(m)).toBe(DESIGN_FILE)
  })

  test("CS12: the file changed while the question was open is not overwritten", async () => {
    const m = settingsHere()
    const theirs = DESIGN_FILE.replace('"always"', '"no"')
    m.deps.ui = {
      ...m.deps.ui,
      asks: true,
      confirm: async () => {
        writeFileSync(join(m.project, "zekno.app.json"), theirs)
        return true
      },
    }
    m.err.length = 0
    expect(await m.zekno("settings", "set", "web.memory", "2g")).toBe(1)
    expect(m.err).toEqual([
      "zekno.app.json changed since zekno read it, so nothing was written. Try again.",
    ])
    expect(fileOf(m)).toBe(theirs)
  })

  test("CS13: a settings file that is a symbolic link is never written through, even to a file in this folder", async () => {
    const m = settingsHere()
    rmSync(join(m.project, "zekno.app.json"))
    writeFileSync(join(m.project, "real.json"), DESIGN_FILE)
    symlinkSync(join(m.project, "real.json"), join(m.project, "zekno.app.json"))
    expect(
      await piped(m, "settings", "set", "web.memory", "2g", "--yes")
    ).toEqual({ code: 1, out: [], err: [CS13("zekno.app.json")] })
    expect(readFileSync(join(m.project, "real.json"), "utf8")).toBe(DESIGN_FILE)
    expect(lstatSync(join(m.project, "zekno.app.json")).isSymbolicLink()).toBe(
      true
    )
  })

  test("CS14: a folder that cannot be written; the file as it was, and no file left behind", async () => {
    const m = settingsHere()
    chmodSync(m.project, 0o555)
    try {
      expect(
        await piped(m, "settings", "set", "web.memory", "2g", "--yes")
      ).toEqual({
        code: 1,
        out: ["web · memory limit  1g → 2g"],
        err: [CS14("zekno.app.json")],
      })
    } finally {
      chmodSync(m.project, 0o755)
    }
    expect(fileOf(m)).toBe(DESIGN_FILE)
    expect(readdirSync(m.project)).toEqual(["zekno.app.json"])
  })

  test("in a linked folder with a team, set and unset never read the keychain and never connect", async () => {
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    expect(await m.zekno("link", "--app", "demo", "--server", "dev")).toBe(0)
    const no = (what: string) => () => {
      throw new Error(what)
    }
    m.deps.keyStore = {
      get: no("the keychain was read"),
      set: no("the keychain was written"),
      delete: no("the keychain was written"),
    }
    m.deps.connect = no("a connection was made")
    expect(
      (await piped(m, "settings", "set", "web.memory", "2g", "--yes")).code
    ).toBe(0)
    expect(
      (await piped(m, "settings", "unset", "web.cpus", "--yes")).code
    ).toBe(0)
    expect(m.docker.calls()).toEqual([])
  }, 60_000)
})

describe("zekno settings init (T053)", () => {
  const IMAGE = "ghcr.io/acme/demo-web:1.4.2"
  const CREATED: Settings = {
    version: 1,
    services: [["web", { image: IMAGE }]],
  }

  test("at a terminal: the image, Enter keeps web; the lines of the contract; the file is settingsText of the answers and reads back", async () => {
    const m = machine()
    const t = terminal(100, 30)
    m.deps.ui = t.ui
    const init = m.zekno("settings", "init")
    await shows(t, "? Image ›")
    t.keys(`${IMAGE}\r`)
    await shows(t, "? Service name › web")
    t.keys("\r")
    expect(await init).toBe(0)
    await t.ui.close()
    expect(t.lines()).toEqual([
      `? Image › ${IMAGE}`,
      "? Service name › web",
      "✔ Written zekno.app.json  Run zekno deploy to use it.",
    ])
    expect(fileOf(m)).toBe(settingsText(CREATED))
    expect(checkSettings(fileOf(m), "zekno.app.json")).toEqual(CREATED)
  })

  test("a refused image keeps the question open with its reason; IN6 with compose.yaml here", async () => {
    const m = machine()
    m.compose(COMPOSE_V1)
    const t = terminal(100, 30)
    m.deps.ui = t.ui
    const init = m.zekno("settings", "init")
    await shows(t, "? Image ›")
    t.keys("Not Valid\r")
    await shows(t, `  ${IN1_RULE}`)
    t.keys(`${"\x7f".repeat(9)}${IMAGE}\r`)
    await shows(t, "? Service name › web")
    t.keys("\r")
    expect(await init).toBe(0)
    await t.ui.close()
    expect(t.lines()).toEqual([
      `? Image › ${IMAGE}`,
      "? Service name › web",
      "✔ Written zekno.app.json  Run zekno deploy to use it.",
      `  ${IN6}`,
    ])
  })

  test("IN4 before any question when zekno.app.json is here; with no terminal, IN5; neither writes", async () => {
    const here = settingsHere()
    const asking = answering(here, [])
    here.err.length = 0
    expect(await here.zekno("settings", "init")).toBe(1)
    expect(asking.asked).toEqual([])
    expect(here.err).toEqual([IN4])
    expect(fileOf(here)).toBe(DESIGN_FILE)

    const m = machine()
    expect(await piped(m, "settings", "init")).toEqual({
      code: 1,
      out: [],
      err: [IN5],
    })
    expect(readdirSync(m.project)).toEqual([])
  })

  test("Esc at each question: Nothing was done., status 1, no file", async () => {
    for (const answers of [["leave"], [{ type: IMAGE }, "leave"]] as const) {
      const m = machine()
      answering(m, [...answers])
      m.err.length = 0
      expect(await m.zekno("settings", "init")).toBe(1)
      expect(m.err).toEqual(["Nothing was done."])
      expect(readdirSync(m.project)).toEqual([])
    }
  })
})
