/**
 * `zekno add`'s refusals through `run` (specs/012-templates,
 * contracts/commands.md, "The order of checks" and "Sentences"; board
 * `AddOther`, "When it cannot add"; tasks T028): at a stand-in terminal,
 * each as `✖` and its first sentence, the second under it, with its status,
 * nothing written and nothing contacted; with no terminal, the usage
 * sentences with the help line.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { settingsText } from "../../src/settings/text"
import { AD1 } from "../../src/templates/add-words"
import { BEFORE_FILE, BEFORE_SETTINGS, DESIGN_FILE } from "../support/add-files"
import { atTerminal, folder, two } from "../support/add-terminal"
import { machine, ready } from "../support/helpers"
import { KEYS, shows } from "../support/terminal"

type Machine = ReturnType<typeof machine>

let m: Machine
beforeAll(async () => {
  m = await ready()
  rmSync(join(m.project, "compose.yaml"))
}, 60_000)

describe("every refusal at a terminal: ✖ and its first sentence, the second under it, with its status (board `AddOther`)", () => {
  type Case = {
    name: string
    file?: string | null
    args: string[]
    before?: () => Promise<void>
    lines: string[]
    code: number
  }
  const CASES: Case[] = [
    {
      name: "AL3, a name in a template's also",
      args: ["add", "mongo"],
      lines: two("There is no template named mongo.", "Run zekno add mongodb."),
      code: 2,
    },
    {
      name: "AL3, any other name",
      args: ["add", "nope"],
      lines: two(
        "There is no template named nope.",
        "Run zekno add --list to see them."
      ),
      code: 2,
    },
    {
      name: "AL4, a name that is no template's name, not repeated",
      args: ["add", "Bad Name"],
      lines: two(
        "There is no template of that name.",
        "Run zekno add --list to see them."
      ),
      code: 2,
    },
    {
      name: "AU8, --name that is no service name",
      args: ["add", "postgres", "--name", "Bad_Name"],
      lines: two(
        "That is not a service name.",
        "Use lowercase letters, digits and hyphens, starting with a letter."
      ),
      code: 2,
    },
    {
      name: "AD13, no settings file",
      file: null,
      args: ["add", "postgres", "--app", "r13", "--server", "dev"],
      lines: two(
        "This folder has no settings file.",
        "Run zekno settings init to start one, then add the template."
      ),
      code: 1,
    },
    {
      name: "a reader's fault of the file",
      file: DESIGN_FILE.replace('"memory": "1g"', '"memory": "lots"'),
      args: ["add", "postgres", "--app", "rf", "--server", "dev"],
      lines: two(
        "zekno.app.json could not be read as settings.",
        "web, deploy.memory: use a size such as 512m or 1g."
      ),
      code: 1,
    },
    {
      name: "AD5, the app has this template already",
      args: [
        "add",
        "postgres",
        "--app",
        "r5",
        "--server",
        "dev",
        "--for",
        "web",
      ],
      before: async () => {
        m.typing("an-old-password")
        expect(
          await m.zekno(
            "secret",
            "set",
            "POSTGRES_PASSWORD",
            "--app",
            "r5",
            "--server",
            "dev"
          )
        ).toBe(0)
      },
      lines: two(
        "r5 already has a secret named POSTGRES_PASSWORD.",
        "A template can be added once to an app in this version."
      ),
      code: 2,
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
      args: [
        "add",
        "postgres",
        "--app",
        "r6",
        "--server",
        "dev",
        "--for",
        "web",
      ],
      lines: two(
        "zekno.app.json already has a service named postgres.",
        "Give this one another name with --name <service>."
      ),
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
      args: ["add", "postgres", "--app", "r9", "--server", "dev"],
      lines: two(
        "zekno.app.json already has a volume named postgres-data.",
        "Give this one another name with --name <service>."
      ),
      code: 2,
    },
    {
      name: "AD14, --for a service the file does not have",
      args: [
        "add",
        "postgres",
        "--app",
        "r14",
        "--server",
        "dev",
        "--for",
        "nope",
      ],
      lines: two(
        "zekno.app.json has no service named nope.",
        "Its services are web, worker."
      ),
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
      args: [
        "add",
        "postgres",
        "--app",
        "r7",
        "--server",
        "dev",
        "--for",
        "web",
      ],
      lines: two(
        "web already has a variable named DATABASE_URL.",
        "Remove it, or leave web out with --for <service>."
      ),
      code: 2,
    },
    {
      name: "AD29, a service that already reads a secret of that name, though left out with --for (security review T1)",
      file: DESIGN_FILE,
      args: [
        "add",
        "postgres",
        "--app",
        "r29",
        "--server",
        "dev",
        "--for",
        "worker",
      ],
      lines: two(
        "web already reads a secret named DATABASE_URL.",
        "Remove it from web."
      ),
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
      args: [
        "add",
        "postgres",
        "--app",
        "r15",
        "--server",
        "dev",
        "--for",
        "s0",
      ],
      lines: two(
        "postgres cannot be added to zekno.app.json.",
        "services: at most 32 services."
      ),
      code: 2,
    },
  ]

  for (const each of CASES)
    test(each.name, async () => {
      await each.before?.()
      const cwd = folder(each.file === undefined ? BEFORE_FILE : each.file)
      const before = existsSync(join(cwd, "zekno.app.json"))
        ? readFileSync(join(cwd, "zekno.app.json"), "utf8")
        : undefined
      const run = await atTerminal(m, cwd, each.args)
      expect(run.lines).toEqual(each.lines)
      expect(run.code).toBe(each.code)
      expect(run.contacted).toBe(0)
      if (before !== undefined)
        expect(readFileSync(join(cwd, "zekno.app.json"), "utf8")).toBe(before)
    })

  test("no profile: AD1, status 2, never A3, nothing asked; a profile with no server: AD1", async () => {
    const fresh = machine()
    const lines = two(
      "There is no server to keep secrets for yet.",
      "Run zekno deploy first. It sets up your team and a server."
    )
    expect(AD1).toBe(lines.map((line) => line.slice(2)).join(" "))
    const none = await atTerminal(fresh, folder(), ["add", "postgres"])
    expect(none).toMatchObject({ code: 2, lines, contacted: 0 })
    expect(await fresh.zekno("init", "--name", "Ada")).toBe(0)
    const noServer = await atTerminal(fresh, folder(), ["add", "postgres"])
    expect(noServer).toMatchObject({ code: 2, lines, contacted: 0 })
  })

  test("Esc at the app question: ✖ Nothing was done., status 1; the apps are this machine's own, no server asked", async () => {
    // A deploy of app hist from this machine, so the question has a row.
    const linked = tempDir("add-history")
    writeFileSync(
      join(linked, "compose.yaml"),
      "services:\n  web:\n    image: example/web:1\n"
    )
    m.deps.cwd = linked
    try {
      expect(await m.zekno("deploy", "--app", "hist", "--server", "dev")).toBe(
        0
      )
    } finally {
      m.deps.cwd = m.project
    }
    const cwd = folder()
    const run = await atTerminal(
      m,
      cwd,
      ["add", "postgres", "--server", "dev", "--for", "web"],
      async (t) => {
        await shows(t, "? Which app on dev?")
        t.keys(KEYS.esc)
      }
    )
    expect(run.lines).toEqual(["? Which app on dev?", "✖ Nothing was done."])
    expect(run.code).toBe(1)
    expect(run.contacted).toBe(0)
    expect(run.docker).toBe(0)
    expect(readFileSync(join(cwd, "zekno.app.json"), "utf8")).toBe(BEFORE_FILE)
  })
})

describe("usage, with no terminal (contracts/commands.md, 'Usage, and the changes to HELP')", () => {
  /** The plain run of `zekno <args>` on a machine of its own, in a folder of design.md's app. */
  async function piped(...args: string[]) {
    const on = machine()
    writeFileSync(join(on.project, "zekno.app.json"), BEFORE_FILE)
    const code = await on.zekno(...args)
    return { code, out: on.out, err: on.err }
  }
  const HELP_LINE = "Run `zekno --help` for the list of commands."

  test("AU7: an option zekno add does not take, with the help line, status 2", async () => {
    for (const [option, shown] of [
      ["--stdin", "`--stdin`"],
      ["--force", "`--force`"],
      ["-f", "`-f`"],
    ] as const)
      expect(
        await piped(
          "add",
          "postgres",
          option,
          ...(option === "-f" ? ["x"] : [])
        )
      ).toEqual({
        code: 2,
        out: [],
        err: [`\`zekno add\` does not take ${shown}.\n${HELP_LINE}`],
      })
  })

  test("a third word: Unexpected, with the help line, status 2", async () => {
    expect(await piped("add", "postgres", "extra")).toEqual({
      code: 2,
      out: [],
      err: [`Unexpected "extra" after \`zekno add\`.\n${HELP_LINE}`],
    })
  })

  test("no template and no terminal: AU1, with the help line, status 2", async () => {
    expect(await piped("add")).toEqual({
      code: 2,
      out: [],
      err: [
        `Say which template: \`zekno add <template>\`, or see them with \`zekno add --list\`.\n${HELP_LINE}`,
      ],
    })
  })
})
