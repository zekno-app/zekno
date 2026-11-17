/**
 * Who reads a template's secrets, end to end against the local runner and
 * the stand-in Docker (specs/012-templates, security review T1;
 * contracts/commands.md, "The order of checks", step 11): a service of the
 * file that already lists in its secrets a name the template makes or
 * builds would read the new secret without the summary naming it, since the
 * Compose text gives a service every secret its `secrets` lists. zekno add
 * refuses it (AD29), at a terminal before the question and in a script, and
 * following AD7's advice (`--for` another service) does not get round it.
 * Nothing is written and no secret is stored.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { AD29 } from "../../src/templates/add-words"
import { answering, machine, ready } from "../support/helpers"

type Machine = ReturnType<typeof machine>

/** `--app <app> --server dev`: an app of its own for each test, so none sees another's secrets. */
const where = (app: string) => ["--app", app, "--server", "dev"]

let m: Machine
let serverId: string
beforeAll(async () => {
  m = await ready()
  serverId = JSON.parse(readFileSync(join(m.home, "profile.json"), "utf8"))
    .servers[0].serverId
}, 60_000)

/** A settings file of `web` and `worker`, each listing `secrets`. */
const fileOf = (web: string[], worker: string[]): string =>
  `${JSON.stringify(
    {
      zekno: 1,
      services: {
        web: {
          source: { image: "example/web:1" },
          ...(web.length > 0 ? { variables: { secrets: web } } : {}),
        },
        worker: {
          source: { image: "example/vendor-sidecar:1" },
          ...(worker.length > 0 ? { variables: { secrets: worker } } : {}),
        },
      },
    },
    null,
    2
  )}\n`

/** A folder holding `file` as its `zekno.app.json`. */
function folder(file: string): string {
  const cwd = tempDir("add-readers")
  writeFileSync(join(cwd, "zekno.app.json"), file)
  return cwd
}

/** Runs `zekno <args>` in `cwd`: its status and what it wrote on each stream. */
async function inFolder(cwd: string, args: string[]) {
  m.out.length = 0
  m.err.length = 0
  m.deps.cwd = cwd
  try {
    const code = await m.zekno(...args)
    return { code, out: [...m.out], err: [...m.err] }
  } finally {
    m.deps.cwd = m.project
  }
}

/** Whether `app` has a secret store on dev. */
const stored = (app: string): boolean =>
  existsSync(join(m.home, "secrets", serverId, `${app}.json`))

describe("a service that already lists a secret the template makes or builds (security review T1)", () => {
  test("probe A, at a terminal: worker lists POSTGRES_PASSWORD and DATABASE_URL, --for web: AD29 naming worker, status 2, before the summary and the question", async () => {
    const file = fileOf([], ["POSTGRES_PASSWORD", "DATABASE_URL"])
    const cwd = folder(file)
    const plain = m.deps.ui
    const person = answering(m, [{ yes: true }])
    try {
      const run = await inFolder(cwd, [
        "add",
        "postgres",
        "--for",
        "web",
        ...where("a29"),
      ])
      expect(run).toEqual({
        code: 2,
        out: [],
        err: [AD29("worker", "POSTGRES_PASSWORD")],
      })
    } finally {
      m.deps.ui = plain
    }
    expect(person.asked).toEqual([])
    expect(person.lines.filter(([kind]) => kind === "addition")).toEqual([])
    expect(readFileSync(join(cwd, "zekno.app.json"), "utf8")).toBe(file)
    expect(stored("a29")).toBe(false)
  })

  test("probe B, in a script: web lists DATABASE_URL; --for web, then AD7's old advice, --for worker: AD29 naming web both times, status 2, nothing written", async () => {
    const file = fileOf(["DATABASE_URL"], [])
    const cwd = folder(file)
    for (const reader of ["web", "worker"]) {
      expect(
        await inFolder(cwd, [
          "add",
          "postgres",
          "--yes",
          ...where("b29"),
          "--for",
          reader,
        ])
      ).toEqual({
        code: 2,
        out: [],
        err: [AD29("web", "DATABASE_URL")],
      })
      expect(readFileSync(join(cwd, "zekno.app.json"), "utf8")).toBe(file)
      expect(stored("b29")).toBe(false)
    }
    expect(AD29("web", "DATABASE_URL")).toBe(
      "web already reads a secret named DATABASE_URL. Remove it from web."
    )
  })

  test("once removed, as AD29 says: added, and the Compose text gives DATABASE_URL to the reader only", async () => {
    const cwd = folder(fileOf([], []))
    expect(
      (
        await inFolder(cwd, [
          "add",
          "postgres",
          "--yes",
          ...where("c29"),
          "--for",
          "worker",
        ])
      ).code
    ).toBe(0)
    const text = (await inFolder(cwd, ["settings", "compose"])).out.join("\n")
    const parsed = Bun.YAML.parse(text) as {
      services: Record<string, { environment?: Record<string, string> }>
    }
    const given = Object.fromEntries(
      Object.entries(parsed.services).map(([name, each]) => [
        name,
        Object.keys(each.environment ?? {}).filter((key) =>
          ["POSTGRES_PASSWORD", "DATABASE_URL"].includes(key)
        ),
      ])
    )
    expect(given).toEqual({
      web: [],
      worker: ["DATABASE_URL"],
      postgres: ["POSTGRES_PASSWORD"],
    })
  })
})
