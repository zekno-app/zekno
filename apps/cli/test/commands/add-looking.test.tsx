/**
 * `zekno add` looking before adding, through `run` (specs/012-templates,
 * contracts/commands.md, "`zekno add` with no template", "`zekno add
 * --list`", "`zekno add <template> --show`", "The order of checks", steps 1
 * to 5, and "Usage"; board `AddLook`; plan.md, D9, D12, D18; tasks T034): the
 * picker at a stand-in terminal, the list and the view at a terminal, piped
 * and as JSON with no team, no keychain, no profile and no file, the names
 * that are no template's, and the usage sentences. Beside add.test.tsx and
 * add-refusals.test.tsx, which keep adding and its refusals.
 */
import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test"
import { readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { run } from "../../src/cli/cli"
import type { Deps } from "../../src/cli/context"
import * as profile from "../../src/profile/profile"
import { plainUi } from "../../src/ui/plain/plain"
import { BEFORE_FILE } from "../support/add-files"
import { atTerminal, folder, two } from "../support/add-terminal"
import { machine, ready } from "../support/helpers"
import { FIRST_SET } from "../support/template-files"
import { LIST, LIST_PIPED, SHOW, SHOW_PIPED } from "../support/template-lines"
import { KEYS, shows, terminal } from "../support/terminal"

type Machine = ReturnType<typeof machine>

const HELP_LINE = "Run `zekno --help` for the list of commands."

let m: Machine
beforeAll(async () => {
  m = await ready()
  rmSync(join(m.project, "compose.yaml"))
}, 60_000)

/** The picker of the board, in today's list (contracts/commands.md). */
const PICKER = [
  "? Add which template?",
  "  ❯ postgres  PostgreSQL 18.7  A relational database",
  "    mysql     MySQL 9.7        A relational database",
  "    mongodb   MongoDB 9.0      A document database",
  "    redis     Redis 8.10       A cache and key-value store",
  "  ↑↓ move   enter choose   esc leave",
]

/**
 * A machine with nothing to read: an empty profile folder, a folder with no
 * file, a keychain, a connection and a fetch that fail whatever touches
 * them, and a profile that cannot be loaded (`profileStore` throws, restored
 * after each test). `ui`: the plain interface, or the one a terminal gets.
 */
let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})
function bare() {
  const touched: string[] = []
  const refuse = (what: string) => () => {
    touched.push(what)
    throw new Error(`${what} was used`)
  }
  const spy = spyOn(profile, "profileStore").mockImplementation(
    refuse("the profile")
  )
  restore = () => spy.mockRestore()
  const out: string[] = []
  const err: string[] = []
  const home = tempDir("add-look-home")
  const cwd = tempDir("add-look-folder")
  const deps: Deps = {
    home,
    cwd,
    keyStore: {
      get: refuse("the keychain"),
      set: refuse("the keychain"),
      delete: refuse("the keychain"),
    },
    connect: refuse("a server"),
    fetch: refuse("the network"),
    ui: plainUi(
      (line) => out.push(line),
      (line) => err.push(line)
    ),
    localRunner: [],
  }
  return {
    deps,
    out,
    err,
    touched,
    /** Nothing was written in either folder. */
    untouched: () =>
      readdirSync(home).length === 0 && readdirSync(cwd).length === 0,
    piped: (...argv: string[]) => run(argv, deps),
    /** `zekno <argv>` with the interface a terminal gets, `columns` wide: the status and the lines on the screen. */
    async drawn(argv: string[], columns = 100) {
      const t = terminal(columns, 40)
      const code = await run(argv, { ...deps, ui: t.ui })
      await t.ui.close()
      return { code, lines: t.lines() }
    },
  }
}

describe("looking (board `AddLook`)", () => {
  test("zekno add at a terminal: the board's picker; Enter leaves ✔ Template  postgres and goes on as zekno add postgres", async () => {
    const cwd = folder()
    const run = await atTerminal(
      m,
      cwd,
      ["add", "--app", "look", "--server", "dev", "--for", "web"],
      async (t) => {
        await shows(t, "? Add which template?")
        expect(t.lines()).toEqual(PICKER)
        t.keys(KEYS.enter)
        await shows(
          t,
          "? Add postgres to look? Nothing is deployed until you deploy. (y/N)"
        )
        t.keys("y")
      }
    )
    expect(run.lines[0]).toBe("✔ Template  postgres")
    expect(run.lines[1]).toStartWith("PostgreSQL 18.7  A relational database.")
    expect(run.lines.slice(-3)).toEqual([
      "✔ Added postgres to zekno.app.json",
      "✔ Stored POSTGRES_PASSWORD and DATABASE_URL, sealed for dev",
      "  Run zekno deploy to start it.",
    ])
    expect(run.code).toBe(0)
    expect(run.contacted).toBe(0)
    expect(readFileSync(join(cwd, "zekno.app.json"), "utf8")).toContain(
      '"postgres-data": "/var/lib/postgresql"'
    )
  })

  test("the picker: ↓ to redis chooses redis; Esc draws Nothing was added., status 1, nothing written", async () => {
    const chosen = folder()
    const redis = await atTerminal(
      m,
      chosen,
      ["add", "--app", "look-redis", "--server", "dev", "--for", "web"],
      async (t) => {
        await shows(t, "? Add which template?")
        t.keys(KEYS.down.repeat(3))
        await shows(
          t,
          "  ❯ redis     Redis 8.10       A cache and key-value store"
        )
        t.keys(KEYS.enter)
        await shows(
          t,
          "? Add redis to look-redis? Nothing is deployed until you deploy. (y/N)"
        )
        t.keys("n")
      }
    )
    expect(redis.lines[0]).toBe("✔ Template  redis")
    expect(redis.lines.at(-1)).toBe("Nothing was added.")
    expect(redis.code).toBe(1)

    const cwd = folder()
    const left = await atTerminal(
      m,
      cwd,
      ["add", "--app", "look-esc", "--server", "dev"],
      async (t) => {
        await shows(t, "? Add which template?")
        t.keys(KEYS.esc)
      }
    )
    expect(left.lines).toEqual(["? Add which template?", "Nothing was added."])
    expect(left.code).toBe(1)
    expect(left.contacted).toBe(0)
    expect(readFileSync(join(cwd, "zekno.app.json"), "utf8")).toBe(BEFORE_FILE)
  })

  test("zekno add with no profile at a terminal: AD1 first, no picker", async () => {
    const fresh = machine()
    const run = await atTerminal(fresh, folder(), ["add"])
    expect(run.lines).toEqual(
      two(
        "There is no server to keep secrets for yet.",
        "Run zekno deploy first. It sets up your team and a server."
      )
    )
    expect(run.code).toBe(2)
  })

  test("--name for the one picked: AU8 before anything; a good one names the service", async () => {
    const fresh = machine()
    expect(
      await atTerminal(fresh, folder(), ["add", "--name", "Bad_Name"])
    ).toMatchObject({
      code: 2,
      lines: two(
        "That is not a service name.",
        "Use lowercase letters, digits and hyphens, starting with a letter."
      ),
    })
    const cwd = folder()
    const named = await atTerminal(
      m,
      cwd,
      ["add", "--name", "db", "--app", "look-db", "--server", "dev"],
      async (t) => {
        await shows(t, "? Add which template?")
        t.keys(KEYS.enter)
        await shows(t, "? Which services read DATABASE_URL?")
        t.keys(KEYS.esc)
      }
    )
    expect(named.lines[0]).toBe("✔ Template  postgres")
    expect(named.lines.at(-1)).toBe("Nothing was added.")
    expect(named.code).toBe(1)
  })

  test("--list at a terminal, piped and with --json: status 0, no team, no keychain, no profile, no file, nothing written", async () => {
    const terminal = bare()
    expect(await terminal.drawn(["add", "--list"])).toEqual({
      code: 0,
      lines: LIST,
    })
    const piped = bare()
    expect(await piped.piped("add", "--list")).toBe(0)
    expect({ out: piped.out, err: piped.err }).toEqual({
      out: LIST_PIPED,
      err: [],
    })
    const json = bare()
    expect(await json.piped("add", "--list", "--json")).toBe(0)
    expect(json.err).toEqual([])
    expect(json.out).toHaveLength(1)
    expect(JSON.parse(json.out[0]!)).toEqual({
      templates: ["postgres", "mysql", "mongodb", "redis"].map((name) => {
        const file = JSON.parse(FIRST_SET[name]!)
        return {
          name,
          title: file.title,
          about: file.about,
          software: file.software,
          author: "zekno",
          also: file.also,
        }
      }),
    })
    for (const each of [terminal, piped, json]) {
      expect(each.touched).toEqual([])
      expect(each.untouched()).toBe(true)
    }
  })

  test("postgres --show at a terminal, piped and with --json: status 0, the same with nothing behind it", async () => {
    const terminal = bare()
    expect(await terminal.drawn(["add", "postgres", "--show"], 140)).toEqual({
      code: 0,
      lines: SHOW,
    })
    const piped = bare()
    expect(await piped.piped("add", "postgres", "--show")).toBe(0)
    expect({ out: piped.out, err: piped.err }).toEqual({
      out: SHOW_PIPED,
      err: [],
    })
    const json = bare()
    expect(await json.piped("add", "postgres", "--show", "--json")).toBe(0)
    expect(json.err).toEqual([])
    // The file's own data, its keys in the format's order: the first set is written in it.
    expect(json.out).toEqual([JSON.stringify(JSON.parse(FIRST_SET.postgres!))])
    expect(Object.keys(JSON.parse(json.out[0]!))).toEqual([
      "template",
      "name",
      "title",
      "about",
      "software",
      "author",
      "also",
      "services",
      "makes",
      "offers",
      "notes",
    ])
    for (const each of [terminal, piped, json]) {
      expect(each.touched).toEqual([])
      expect(each.untouched()).toBe(true)
    }
  })

  test("--show of a name that is no template's: AL3, AL4; mongo points to mongodb (board)", async () => {
    for (const [argv, line] of [
      [
        ["add", "mongo", "--show"],
        "There is no template named mongo. Run zekno add mongodb.",
      ],
      [
        ["add", "nope", "--show"],
        "There is no template named nope. Run zekno add --list to see them.",
      ],
      [
        ["add", "Bad Name", "--show", "--json"],
        "There is no template of that name. Run zekno add --list to see them.",
      ],
    ] as const) {
      const each = bare()
      expect({ code: await each.piped(...argv), err: each.err }).toEqual({
        code: 2,
        err: [line],
      })
      expect(each.out).toEqual([])
    }
  })

  test("a name that is no template's, at a terminal: AL3 with the board's Run zekno add mongodb., AL3's second form, AL4 with the name not repeated; status 2", async () => {
    const cases = [
      [
        "mongo",
        two("There is no template named mongo.", "Run zekno add mongodb."),
      ],
      [
        "nope",
        two(
          "There is no template named nope.",
          "Run zekno add --list to see them."
        ),
      ],
      [
        "Bad Name",
        two(
          "There is no template of that name.",
          "Run zekno add --list to see them."
        ),
      ],
    ] as const
    for (const [name, lines] of cases) {
      const each = bare()
      expect(await each.drawn(["add", name])).toEqual({ code: 2, lines })
      expect(each.touched).toEqual([])
    }
  })
})

describe("usage, before AD1 and before anything is read (contracts/commands.md, AU1 to AU6)", () => {
  const CASES: [argv: string[], sentence: string][] = [
    [
      ["add"],
      "Say which template: `zekno add <template>`, or see them with `zekno add --list`.",
    ],
    [
      ["add", "--yes"],
      "Say which template: `zekno add <template>`, or see them with `zekno add --list`.",
    ],
    [["add", "postgres", "--list"], "`zekno add --list` takes no template."],
    [
      ["add", "--show"],
      "Say which template to show: `zekno add <template> --show`.",
    ],
    [["add", "--list", "--show"], "Use `--list` or `--show`, not both."],
    [
      ["add", "postgres", "--show", "--list"],
      "Use `--list` or `--show`, not both.",
    ],
    [
      ["add", "postgres", "--json"],
      "`zekno add` takes `--json` with `--list` or `--show` only.",
    ],
    [
      ["add", "--json"],
      "`zekno add` takes `--json` with `--list` or `--show` only.",
    ],
    [
      ["add", "--list", "--name", "db"],
      "`zekno add --list` does not take `--name`.",
    ],
    [
      ["add", "--list", "--json", "--for", "web"],
      "`zekno add --list` does not take `--for`.",
    ],
    [
      ["add", "postgres", "--show", "--app", "demo"],
      "`zekno add --show` does not take `--app`.",
    ],
    [
      ["add", "postgres", "--show", "--server", "dev"],
      "`zekno add --show` does not take `--server`.",
    ],
    [
      ["add", "postgres", "--show", "--yes"],
      "`zekno add --show` does not take `--yes`.",
    ],
  ]

  test("each with the help line, status 2, with no profile, no keychain and no file", async () => {
    for (const [argv, sentence] of CASES) {
      const each = bare()
      expect({
        argv,
        code: await each.piped(...argv),
        out: each.out,
        err: each.err,
      }).toEqual({ argv, code: 2, out: [], err: [`${sentence}\n${HELP_LINE}`] })
      expect(each.touched).toEqual([])
    }
  })

  test("at a terminal too, but AU1, which a terminal answers with the picker", async () => {
    for (const [argv, sentence] of CASES.filter(
      ([, sentence]) => !sentence.startsWith("Say which template:")
    )) {
      const each = bare()
      const shown = await each.drawn(argv)
      expect({ argv, code: shown.code, first: shown.lines[0] }).toEqual({
        argv,
        code: 2,
        first: `✖ ${sentence.replaceAll("`", "")}`,
      })
    }
  })

  test("an option zekno add does not take, with --list: AU7 first", async () => {
    const each = bare()
    expect(await each.piped("add", "--list", "--force")).toBe(2)
    expect(each.err).toEqual([
      `\`zekno add\` does not take \`--force\`.\n${HELP_LINE}`,
    ])
  })
})
