/**
 * User Story 4 of specs/012-templates: `zekno add` from scripts, with no
 * terminal, against the local runner and the stand-in Docker
 * (contracts/commands.md, "With no terminal (scripts)" and "The order of
 * checks"; board `AddOther`, right column; plan.md, D14, D16; FR-005, FR-012,
 * FR-019; tasks T051). It never asks: without `--yes` it stops with AD4 after
 * the checks, nothing written; with it, AD23's plain lines; with several
 * other services and no `--for`, AD12, even with `--yes` (it does not guess);
 * a missing app is said as `zekno secret set` says it; a folder linked with
 * `zekno link` needs no `--app` or `--server`; and every refusal is one line
 * on standard error. Every other command's plain output is
 * test/plain/plain-unchanged.test.ts's, and that no command but `version`
 * and `doctor` fetches is test/version/version.test.ts's.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { checkSettings } from "../../src/settings/schema"
import { settingsText } from "../../src/settings/text"
import type { Settings } from "../../src/settings/types"
import {
  AD1,
  AD12,
  AD13,
  AD14,
  AD15,
  AD24,
  AD25,
  AD29,
  AD4,
  AD5,
  AD6,
  AD7,
  AD9,
  AL3,
  AL4,
  AU1,
  AU8,
} from "../../src/templates/add-words"
import { SH4 } from "../../src/settings/words"
import {
  BEFORE_FILE,
  BEFORE_SETTINGS,
  DESIGN_FILE,
  ONE_FILE,
} from "../support/add-files"
import { machine, ready, twin } from "../support/helpers"

type Machine = ReturnType<typeof machine>

const WHERE = ["--app", "demo", "--server", "dev"]
const HELP_LINE = "Run `zekno --help` for the list of commands."

let m: Machine
let serverId: string
beforeAll(async () => {
  m = await ready()
  serverId = JSON.parse(readFileSync(join(m.home, "profile.json"), "utf8"))
    .servers[0].serverId
}, 60_000)

/** A folder holding `file` as its `zekno.app.json`, none when null. */
function folder(file: string | null = BEFORE_FILE): string {
  const cwd = tempDir("add-scripts")
  if (file !== null) writeFileSync(join(cwd, "zekno.app.json"), file)
  return cwd
}

/** Runs `zekno <args>` in `cwd` on `on` with the plain interface: its status and what it wrote on each stream. */
async function piped(cwd: string, args: string[], on: Machine = m) {
  on.out.length = 0
  on.err.length = 0
  const saved = on.deps.cwd
  on.deps.cwd = cwd
  try {
    const code = await on.zekno(...args)
    return { code, out: [...on.out], err: [...on.err] }
  } finally {
    on.deps.cwd = saved
  }
}

/** Runs `zekno <args>` in `cwd`; fails the test when it fails. */
async function zekno(cwd: string, ...args: string[]) {
  const run = await piped(cwd, args)
  if (run.code !== 0) throw new Error(run.err.join("\n"))
}

/** The app's secret store file on dev exists. */
const stores = (app: string): boolean =>
  existsSync(join(m.home, "secrets", serverId, `${app}.json`))

/** The settings file of a folder, as text. */
const fileOf = (cwd: string): string =>
  readFileSync(join(cwd, "zekno.app.json"), "utf8")

const ADDED = [
  "added\tpostgres\tzekno.app.json",
  "stored\tPOSTGRES_PASSWORD\t1",
  "stored\tDATABASE_URL\t1",
]

describe("no terminal: it never asks (board `AddOther`, right column)", () => {
  test("without --yes: AD4 on standard error after the checks, nothing on standard output, status 1 (D16); the file and the store unchanged", async () => {
    const cwd = folder(ONE_FILE)
    expect(await piped(cwd, ["add", "postgres", ...WHERE])).toEqual({
      code: 1,
      out: [],
      err: [AD4("zekno.app.json")],
    })
    expect(AD4("zekno.app.json")).toBe(
      "Adding a template changes zekno.app.json and stores secrets. Say --yes to go ahead."
    )
    expect(fileOf(cwd)).toBe(ONE_FILE)
    expect(stores("demo")).toBe(false)
  })

  test("with --yes: AD23's three lines exactly, status 0; the file holds the service, the store both secrets", async () => {
    const cwd = folder(ONE_FILE)
    expect(await piped(cwd, ["add", "postgres", "--yes", ...WHERE])).toEqual({
      code: 0,
      out: ADDED,
      err: [],
    })
    const settings = checkSettings(fileOf(cwd), "zekno.app.json") as Settings
    expect(settings.services.map(([name]) => name)).toEqual(["web", "postgres"])
    expect(settings.services[0]![1].secrets).toEqual(["DATABASE_URL"])
    expect(stores("demo")).toBe(true)
  })

  test("two other services, --yes and no --for: AD12, status 2 (D14), nothing written; --for web --for worker: both read it", async () => {
    const cwd = folder(BEFORE_FILE)
    expect(
      await piped(cwd, [
        "add",
        "postgres",
        "--yes",
        "--app",
        "two",
        "--server",
        "dev",
      ])
    ).toEqual({
      code: 2,
      out: [],
      err: [AD12("zekno.app.json", "DATABASE_URL")],
    })
    expect(AD12("zekno.app.json", "DATABASE_URL")).toBe(
      "zekno.app.json has several services. Say which read DATABASE_URL with --for <service>."
    )
    expect(fileOf(cwd)).toBe(BEFORE_FILE)
    expect(stores("two")).toBe(false)
    expect(
      await piped(cwd, [
        "add",
        "postgres",
        "--yes",
        "--app",
        "two",
        "--server",
        "dev",
        "--for",
        "web",
        "--for",
        "worker",
      ])
    ).toEqual({ code: 0, out: ADDED, err: [] })
    const settings = checkSettings(fileOf(cwd), "zekno.app.json") as Settings
    expect(
      settings.services.slice(0, 2).map(([, service]) => service.secrets)
    ).toEqual([["SESSION_KEY", "DATABASE_URL"], ["DATABASE_URL"]])
  })

  test("no --app in a folder not linked: MISSING_APP as zekno secret set says it, with the help line, status 2 (FR-012)", async () => {
    const cwd = folder(ONE_FILE)
    const said = await piped(cwd, ["secret", "set", "OTHER", "--server", "dev"])
    expect(said.code).toBe(2)
    expect(
      await piped(cwd, ["add", "postgres", "--yes", "--server", "dev"])
    ).toEqual(said)
    expect(said.err).toEqual([
      `Say which app with \`--app <name>\`, or link this folder to it with \`zekno link\`, which keeps it in zekno.json.\n${HELP_LINE}`,
    ])
    expect(fileOf(cwd)).toBe(ONE_FILE)
  })

  test("zekno add alone: AU1, with the help line, status 2", async () => {
    expect(await piped(folder(), ["add"])).toEqual({
      code: 2,
      out: [],
      err: [`${AU1}\n${HELP_LINE}`],
    })
  })

  test("a folder linked with zekno link needs no --app or --server", async () => {
    const cwd = folder(ONE_FILE)
    await zekno(cwd, "link", "--app", "linked", "--server", "dev")
    expect(await piped(cwd, ["add", "postgres", "--yes"])).toEqual({
      code: 0,
      out: ADDED,
      err: [],
    })
    expect(stores("linked")).toBe(true)
  })
})

describe("every refusal is one line on standard error (contracts/commands.md, 'With no terminal')", () => {
  type Case = {
    name: string
    file?: string | null
    args: string[]
    before?: () => Promise<void>
    sentence: string
    code: number
  }
  /** `--for web` and `--yes`, for the app `app` on dev. */
  const adding = (app: string, ...more: string[]) => [
    "add",
    "postgres",
    "--yes",
    "--app",
    app,
    "--server",
    "dev",
    ...more,
  ]
  // AD27, AD28 and AU9 need a template this zekno does not carry (one that fails its checks, asks, or adds several
  // services): test/ops/add-template.test.ts gives them to the catalogue. AD1 and SH4 need machines of their own, below.
  const CASES: Case[] = [
    {
      name: "AL3, a name in a template's also",
      args: ["add", "mongo", "--yes"],
      sentence: AL3("mongo", "mongodb"),
      code: 2,
    },
    {
      name: "AL3, any other name",
      args: ["add", "nope", "--yes"],
      sentence: AL3("nope"),
      code: 2,
    },
    {
      name: "AL4, a name that is no template's name",
      args: ["add", "Bad Name", "--yes"],
      sentence: AL4,
      code: 2,
    },
    {
      name: "AU8, --name that is no service name",
      args: adding("u8", "--name", "Bad_Name"),
      sentence: AU8,
      code: 2,
    },
    {
      name: "AD13, no settings file",
      file: null,
      args: adding("r13"),
      sentence: AD13,
      code: 1,
    },
    {
      name: "a reader's fault of the file",
      file: DESIGN_FILE.replace('"memory": "1g"', '"memory": "lots"'),
      args: adding("rf"),
      sentence:
        "zekno.app.json could not be read as settings. web, deploy.memory: use a size such as 512m or 1g.",
      code: 1,
    },
    {
      name: "AD5, the app has this template already",
      args: adding("r5", "--for", "web"),
      before: async () => {
        m.typing("an-old-password")
        await zekno(
          m.project,
          "secret",
          "set",
          "POSTGRES_PASSWORD",
          "--app",
          "r5",
          "--server",
          "dev"
        )
      },
      sentence: AD5("r5", "POSTGRES_PASSWORD"),
      code: 2,
    },
    {
      name: "AD24, more secrets than a deploy carries",
      args: adding("r24", "--for", "web"),
      before: async () => {
        writeFileSync(
          join(m.project, "many.env"),
          Array.from({ length: 255 }, (_, at) => `S${at}=value-${at}`).join(
            "\n"
          )
        )
        await zekno(
          m.project,
          "secret",
          "import",
          "many.env",
          "--app",
          "r24",
          "--server",
          "dev",
          "--yes"
        )
      },
      sentence: AD24("r24", "dev"),
      code: 1,
    },
    {
      name: "AD25, more records than this machine keeps",
      args: adding("r25", "--for", "web"),
      before: async () => {
        m.typing("a-value")
        await zekno(
          m.project,
          "secret",
          "set",
          "OTHER",
          "--app",
          "r25",
          "--server",
          "dev"
        )
        const path = join(m.home, "secrets", serverId, "r25.json")
        const store = JSON.parse(readFileSync(path, "utf8"))
        store.records = Array.from({ length: 4095 }, () => store.records[0])
        writeFileSync(path, JSON.stringify(store))
      },
      sentence: AD25("r25", "dev"),
      code: 1,
    },
    {
      name: "AD6, a service of that name",
      file: settingsText({
        version: 1,
        services: [
          ...BEFORE_SETTINGS.services,
          ["postgres", { image: "postgres:1" }],
        ],
      }),
      args: adding("r6", "--for", "web"),
      sentence: AD6("zekno.app.json", "postgres"),
      code: 2,
    },
    {
      name: "AD9, a volume of that name",
      file: settingsText({
        version: 1,
        services: [
          [
            "web",
            { image: "ghcr.io/acme/web:1", volumes: [["postgres-data", "/d"]] },
          ],
        ],
      }),
      args: adding("r9"),
      sentence: AD9("zekno.app.json", "postgres-data"),
      code: 2,
    },
    {
      name: "AD14, --for a service the file does not have",
      args: adding("r14", "--for", "nope"),
      sentence: AD14("zekno.app.json", "nope", ["web", "worker"]),
      code: 2,
    },
    {
      name: "AD7, a reader with a plain variable of the connection secret's name",
      file: settingsText({
        version: 1,
        services: [
          [
            "web",
            { image: "ghcr.io/acme/web:1", plain: [["DATABASE_URL", "x"]] },
          ],
          ["worker", { image: "ghcr.io/acme/worker:1" }],
        ],
      }),
      args: adding("r7", "--for", "web"),
      sentence: AD7("web", "DATABASE_URL"),
      code: 2,
    },
    {
      name: "AD29, a service that already reads a secret of that name, though left out with --for (security review T1)",
      file: DESIGN_FILE,
      args: adding("r29", "--for", "worker"),
      sentence: AD29("web", "DATABASE_URL"),
      code: 2,
    },
    {
      name: "AD15, one service too many",
      file: settingsText({
        version: 1,
        services: Array.from(
          { length: 32 },
          (_, at) => [`s${at}`, { image: "ghcr.io/acme/web:1" }] as const
        ),
      }),
      args: adding("r15", "--for", "s0"),
      sentence: AD15("postgres", "zekno.app.json", {
        place: "services",
        rule: "at most 32 services.",
      }),
      code: 2,
    },
  ]

  for (const each of CASES)
    test(
      each.name,
      async () => {
        await each.before?.()
        const cwd = folder(each.file === undefined ? BEFORE_FILE : each.file)
        const before = existsSync(join(cwd, "zekno.app.json"))
          ? fileOf(cwd)
          : undefined
        const run = await piped(cwd, each.args)
        expect(run).toEqual({ code: each.code, out: [], err: [each.sentence] })
        expect(each.sentence).not.toContain("\n")
        if (before !== undefined) expect(fileOf(cwd)).toBe(before)
      },
      60_000
    )

  test("AD1: no profile, and a profile with no server", async () => {
    const fresh = machine()
    expect(await piped(folder(), ["add", "postgres", "--yes"], fresh)).toEqual({
      code: 2,
      out: [],
      err: [AD1],
    })
    expect(
      (await piped(fresh.project, ["init", "--name", "Ada"], fresh)).code
    ).toBe(0)
    expect(await piped(folder(), ["add", "postgres", "--yes"], fresh)).toEqual({
      code: 2,
      out: [],
      err: [AD1],
    })
  })

  test("SH4: a zekno.json signed and not in use here yet that names another settings file", async () => {
    const cwd = folder(DESIGN_FILE)
    mkdirSync(join(cwd, "deploy"))
    writeFileSync(join(cwd, "deploy", "zekno.app.json"), BEFORE_FILE)
    await zekno(
      cwd,
      "link",
      "--app",
      "sh4",
      "--server",
      "dev",
      "-f",
      "deploy/zekno.app.json"
    )
    const other = await twin(m)
    expect(
      await piped(cwd, ["add", "postgres", "--yes", "--for", "web"], other)
    ).toEqual({ code: 1, out: [], err: [SH4("deploy/zekno.app.json")] })
    expect(SH4("deploy/zekno.app.json")).not.toContain("\n")
  }, 60_000)
})
