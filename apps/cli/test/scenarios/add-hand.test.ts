/**
 * User Story 3 of specs/012-templates end to end, with no terminal, against
 * the local runner and the stand-in Docker (contracts/commands.md, "A
 * hand-written Compose file"; board `AddOther`: "Piped, the lines are printed
 * as they are and no secret is made without --yes"; plan.md, D17; tasks
 * T049): without `--yes` the bare lines on standard output and AH8 on
 * standard error, status 1, nothing stored; with it the lines and one
 * `stored` line each, status 0. The person then puts the lines in their file
 * and deploys: the database's service gets its secrets from the environment,
 * and no Compose text holds a value. zekno never writes the Compose file.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { listSecrets } from "../../src/ops/secret"
import { SH4 } from "../../src/settings/words"
import { AH8, AU10 } from "../../src/templates/add-words"
import { handLines } from "../../src/templates/hand"
import { BEFORE_FILE } from "../support/add-files"
import { answering, machine, ready, twin } from "../support/helpers"
import { FIRST_TEMPLATES } from "../support/template-files"

type Machine = ReturnType<typeof machine>

const WHERE = ["--app", "demo", "--server", "dev"]

/** A Compose file a person wrote: zekno never reads or writes it. */
const COMPOSE =
  "services:\n  web:\n    image: example/web:1\n    environment:\n      GREETING: hello\n"

const LINES = handLines(FIRST_TEMPLATES.postgres!, undefined, "compose.yaml")

let m: Machine
let folder: string
beforeAll(async () => {
  m = await ready()
  folder = tempDir("add-hand-scenario")
  writeFileSync(join(folder, "compose.yaml"), COMPOSE)
}, 60_000)

/** Runs `zekno <args>` in the folder with the plain interface: its status and what it wrote on each stream. */
async function piped(...args: string[]) {
  m.out.length = 0
  m.err.length = 0
  m.deps.cwd = folder
  try {
    const code = await m.zekno(...args)
    return { code, out: [...m.out], err: [...m.err] }
  } finally {
    m.deps.cwd = m.project
  }
}

/** The app's secret store file on dev exists. */
function stores(app: string): boolean {
  const profile = JSON.parse(readFileSync(join(m.home, "profile.json"), "utf8"))
  return existsSync(
    join(m.home, "secrets", profile.servers[0].serverId, `${app}.json`)
  )
}

describe("zekno add postgres in a folder that deploys compose.yaml, with no terminal (US3)", () => {
  test("without --yes: the bare lines on standard output, AH8 on standard error, status 1, nothing stored", async () => {
    expect(await piped("add", "postgres", ...WHERE)).toEqual({
      code: 1,
      out: [...LINES.service, ...LINES.offers],
      err: [AH8],
    })
    expect(AH8).toBe(
      "Making its secrets stores them on this machine. Say --yes to go ahead."
    )
    expect(stores("demo")).toBe(false)
    expect(readFileSync(join(folder, "compose.yaml"), "utf8")).toBe(COMPOSE)
  })

  test("--for: AU10, status 2, nothing printed, nothing stored", async () => {
    expect(
      await piped("add", "postgres", "--yes", ...WHERE, "--for", "web")
    ).toEqual({ code: 2, out: [], err: [AU10("compose.yaml")] })
    expect(stores("demo")).toBe(false)
  })

  test("with --yes: the lines, then one stored line each, status 0; then the person adds the lines and deploys, and the secrets reach the database's service from the environment only", async () => {
    expect(await piped("add", "postgres", "--yes", ...WHERE)).toEqual({
      code: 0,
      out: [
        ...LINES.service,
        ...LINES.offers,
        "stored\tPOSTGRES_PASSWORD\t1",
        "stored\tDATABASE_URL\t1",
      ],
      err: [],
    })
    expect(readFileSync(join(folder, "compose.yaml"), "utf8")).toBe(COMPOSE)
    const listed = await listSecrets(m.deps, { app: "demo", server: "dev" })
    expect(listed.secrets.map(({ name, version }) => [name, version])).toEqual([
      ["DATABASE_URL", 1],
      ["POSTGRES_PASSWORD", 1],
    ])

    // The person puts the lines where AH3 to AH5 say: the service under services:, its volume under volumes:, the
    // connection secret in the environment of the service that uses it.
    const edited = [
      COMPOSE.trimEnd(),
      ...LINES.offers,
      ...LINES.service,
      "volumes:",
      ...LINES.volumes.map((volume) => `  ${volume}:`),
      "",
    ].join("\n")
    writeFileSync(join(folder, "compose.yaml"), edited)
    expect((await piped("deploy", ...WHERE)).code).toBe(0)
    const call = m.docker.calls().at(-1)!
    expect(call.args).toContain("zekno-demo")
    const password = call.env.POSTGRES_PASSWORD!
    expect(password).toMatch(/^[A-Za-z0-9]{32}$/)
    expect(call.env.DATABASE_URL).toBe(
      `postgres://app:${password}@postgres:5432/app`
    )
    const args = call.args.split(" ")
    const sent = readFileSync(args[args.indexOf("-f") + 1]!, "utf8")
    expect(sent).toBe(edited)
    expect(sent).not.toContain(password)
  })
})

describe("a zekno.json not in use on this machine yet that names another file than compose.yaml (security review T4)", () => {
  test("on the member's second machine: SH4, status 1, before any question or line, in a script and at a terminal; nothing stored; zekno settings says SH4 too", async () => {
    const linked = tempDir("add-hand-pending")
    writeFileSync(join(linked, "compose.yaml"), COMPOSE)
    mkdirSync(join(linked, "deploy"))
    writeFileSync(join(linked, "deploy", "zekno.app.json"), BEFORE_FILE)
    m.deps.cwd = linked
    try {
      expect(
        await m.zekno(
          "link",
          "--app",
          "pending",
          "--server",
          "dev",
          "-f",
          "deploy/zekno.app.json"
        )
      ).toBe(0)
    } finally {
      m.deps.cwd = m.project
    }
    const other = await twin(m)
    other.deps.cwd = linked
    const said = SH4("deploy/zekno.app.json")
    const run = async (...args: string[]) => {
      other.out.length = 0
      other.err.length = 0
      const code = await other.zekno(...args)
      return { code, out: [...other.out], err: [...other.err] }
    }
    for (const args of [
      ["add", "postgres", "--yes"],
      ["add", "postgres", "--yes", "--app", "pending", "--server", "dev"],
      ["settings"],
    ])
      expect({ args, run: await run(...args) }).toEqual({
        args,
        run: { code: 1, out: [], err: [said] },
      })
    const person = answering(other, [{ yes: true }, { yes: true }])
    expect(await run("add", "postgres")).toEqual({
      code: 1,
      out: [],
      err: [said],
    })
    expect(person.asked).toEqual([])
    expect(stores("pending")).toBe(false)
    expect(readFileSync(join(linked, "compose.yaml"), "utf8")).toBe(COMPOSE)
    expect(() => readFileSync(join(other.home, "links.json"))).toThrow()
  }, 60_000)
})
