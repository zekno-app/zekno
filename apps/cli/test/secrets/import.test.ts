/**
 * `zekno secret import <file>` (specs/006-cli-small-features, User Story 3,
 * contracts/import.md, mock-up 4): how the names are grouped and the limits,
 * storing every value in one write or none (FR-019), and the command at a
 * terminal, through the stand-in terminal and with no terminal. A value from
 * the file is never anywhere but in its sealed record (FR-021): every output,
 * every file of the profile and project folders, and every argument of a
 * process started are searched for each one.
 */
import { describe, expect, spyOn, test } from "bun:test"
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/helpers"
import { HELP } from "../../src/cli"
import {
  importFor,
  importGroups,
  importNeedsYes,
  importStillThere,
  importStored,
  nothingToImport,
  SAY_WHICH_FILE,
  storeQuestion,
} from "../../src/commands/secret"
import { openTeam, type Team } from "../../src/context"
import { MISSING_APP, NOTHING_DONE } from "../../src/errors"
import { importTooMany, importTooManyRecords, importTooManySecrets, prepareSecretImport, storeSecrets } from "../../src/ops/secret"
import { profileStore } from "../../src/profile"
import { parseImport, type ImportEntry } from "../../src/secrets/import-file"
import { answering, filesUnder, machine, ready } from "../helpers"
import { shows, terminal } from "../ui/terminal"

type Machine = ReturnType<typeof machine>

const WEB = { app: "web", server: "dev" }
const HELP_LINE = "\nRun `zekno --help` for the list of commands."

/** Values that must never appear anywhere but sealed. Each holds the sentinel, so one search finds any of them. */
const SENTINEL = "zk_SENTINEL_9f3a"
const secret = (name: string) => `${SENTINEL}_${name.toLowerCase()}`

/** The entries of a text that fits. */
function entriesOf(text: string): ImportEntry[] {
  const parsed = parseImport(text)
  if (!("entries" in parsed)) throw new Error(`the test's file stops at line ${parsed.line}`)
  return parsed.entries
}

/** The app's store file on `server`, and its server's id. */
function storeOf(m: Machine, app = "web", server = "dev") {
  const serverId = profileStore(m.home)
    .load()
    .servers.find((entry) => entry.name === server)!.serverId
  return { serverId, folder: join(m.home, "secrets", serverId), path: join(m.home, "secrets", serverId, `${app}.json`) }
}

/** Every file under `dir` that holds the sentinel in plain text. */
const holding = (dir: string) => filesUnder(dir).filter((file) => file.content.includes(SENTINEL))

/** The names and versions `zekno secret ls` lists. */
async function listed(m: Machine, where = WEB): Promise<string[]> {
  const before = m.out.length
  expect(await m.zekno("secret", "ls", "--app", where.app, "--server", where.server)).toBe(0)
  return m.out.slice(before)
}

/** A file of `count` values with distinct valid names, each holding the sentinel. */
const manyValues = (count: number, prefix = "V") =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}=${secret(`${prefix}${index}`)}`).join("\n")

describe("storing (contracts/import.md, Names and Limits; research R9)", () => {
  test("prepareSecretImport groups the names in the file's order, and gives each value its next version", async () => {
    const m = await ready()
    m.typing("hello")
    expect(await m.zekno("secret", "set", "GREETING", "--app", "web", "--server", "dev")).toBe(0)
    const text = [
      `DATABASE_URL=${secret("db")}`,
      `SESSION_KEY=${secret("session")}`,
      `GREETING=${secret("greeting")}`,
      `PATH=${secret("path")}`,
      `my-var=${secret("var")}`,
      "EMPTY=",
      `${"K".repeat(129)}=${secret("long")}`,
      `STRIPE_KEY=${secret("stripe")}`,
      `BIG=${"x".repeat(65 * 1024)}`,
    ].join("\n")
    const plan = await prepareSecretImport(m.deps, WEB, entriesOf(text), ".env")
    expect(importGroups(plan)).toEqual([
      ["new", "DATABASE_URL, SESSION_KEY, STRIPE_KEY"],
      ["replaces", "GREETING"],
      ["left out", "PATH (zekno keeps this name), line 5 (not a valid name), line 6 (empty), line 7 (a name longer than 128 characters), line 9 (larger than 64 KiB)"],
    ])
    expect(plan.values.map(({ name, version, replaces }) => ({ name, version, replaces }))).toEqual([
      { name: "DATABASE_URL", version: 1, replaces: false },
      { name: "SESSION_KEY", version: 1, replaces: false },
      { name: "GREETING", version: 2, replaces: true },
      { name: "STRIPE_KEY", version: 1, replaces: false },
    ])
    // Nothing was stored: preparing writes nothing.
    expect(holding(m.home)).toEqual([])
  }, 30_000)

  test("a name whose latest change was a removal is new, and gets the version after the removal", async () => {
    const m = await ready()
    m.typing("one")
    expect(await m.zekno("secret", "set", "GONE", "--app", "web", "--server", "dev")).toBe(0)
    expect(await m.zekno("secret", "rm", "GONE", "--app", "web", "--server", "dev")).toBe(0)
    const plan = await prepareSecretImport(m.deps, WEB, entriesOf(`GONE=${secret("gone")}`), ".env")
    expect(importGroups(plan)).toEqual([["new", "GONE"]])
    expect(plan.values.map(({ name, version }) => ({ name, version }))).toEqual([{ name: "GONE", version: 3 }])
  }, 30_000)

  test("storeSecrets writes the store once, one new record per value at its version; secret ls lists them", async () => {
    const m = await ready()
    m.typing("hello")
    expect(await m.zekno("secret", "set", "GREETING", "--app", "web", "--server", "dev")).toBe(0)
    const plan = await prepareSecretImport(m.deps, WEB, entriesOf(`A=${secret("a")}\nGREETING=${secret("g")}\nB=${secret("b")}`), ".env")
    const records = plan.secrets.records.length
    const save = spyOn(plan.team.store, "saveSecrets")
    const changes = await storeSecrets(plan)
    expect(save).toHaveBeenCalledTimes(1)
    expect(changes).toEqual([
      { name: "A", version: 1, app: "web", server: "dev" },
      { name: "GREETING", version: 2, app: "web", server: "dev" },
      { name: "B", version: 1, app: "web", server: "dev" },
    ])
    const stored = JSON.parse(readFileSync(storeOf(m).path, "utf8"))
    expect(stored.records.length).toBe(records + 3)
    expect((await listed(m)).sort()).toEqual(["A\tversion 1", "B\tversion 1", "GREETING\tversion 2"])
    // The values are sealed: none is in any file of the profile folder in plain text.
    expect(holding(m.home)).toEqual([])
  }, 30_000)

  test("all or nothing: a signer that fails on the third record leaves the store byte for byte, and no temporary file", async () => {
    const m = await ready()
    m.typing("hello")
    expect(await m.zekno("secret", "set", "GREETING", "--app", "web", "--server", "dev")).toBe(0)
    const store = storeOf(m)
    const before = readFileSync(store.path)
    const plan = await prepareSecretImport(m.deps, WEB, entriesOf(manyValues(5)), ".env")
    const original = plan.team.withSigner
    let signed = 0
    const team: Team = {
      ...plan.team,
      withSigner: (work) =>
        original((signer) =>
          work({
            publicKey: signer.publicKey,
            sign(message) {
              signed++
              if (signed === 3) throw new Error("the signer stopped")
              return signer.sign(message)
            },
          })
        ),
    }
    await expect(storeSecrets({ ...plan, team })).rejects.toThrow("the signer stopped")
    expect(signed).toBe(3)
    expect(readFileSync(store.path).equals(before)).toBe(true)
    expect(readdirSync(store.folder)).toEqual(["web.json"])
    expect(holding(m.home)).toEqual([])
  }, 30_000)

  test("all or nothing: a store folder that cannot be written leaves the file as it was, no temporary file, and says so", async () => {
    const m = await ready()
    m.typing("hello")
    expect(await m.zekno("secret", "set", "GREETING", "--app", "web", "--server", "dev")).toBe(0)
    const store = storeOf(m)
    const before = readFileSync(store.path)
    const plan = await prepareSecretImport(m.deps, WEB, entriesOf(manyValues(4)), ".env")
    chmodSync(store.folder, 0o500)
    try {
      await expect(storeSecrets(plan)).rejects.toThrow(`Could not write ${store.path}.`)
    } finally {
      chmodSync(store.folder, 0o700)
    }
    expect(readFileSync(store.path).equals(before)).toBe(true)
    expect(readdirSync(store.folder)).toEqual(["web.json"])
    expect(holding(m.home)).toEqual([])
  }, 30_000)

  test("the limits stop the import before anything is sealed: 257 values, 257 secrets for the app, 4097 records", async () => {
    const m = await ready()
    const team = await openTeam(m.deps)
    const signer = spyOn(team, "withSigner")
    const deps = { ...m.deps, team: async () => team }
    await expect(prepareSecretImport(deps, WEB, entriesOf(manyValues(257)), ".env")).rejects.toThrow(importTooMany(".env"))
    expect(importTooMany(".env")).toBe(".env has more than 256 values, more than one deploy carries. Nothing was stored.")

    // The app has 250 secrets: 7 new names would make 257, past what one deploy carries. Names it has already do not count.
    const many = await prepareSecretImport(m.deps, WEB, entriesOf(manyValues(250, "OLD")), ".env")
    await storeSecrets(many)
    signer.mockClear()
    await expect(prepareSecretImport(deps, WEB, entriesOf(manyValues(7)), ".env")).rejects.toThrow(importTooManySecrets("web", "dev"))
    expect(importTooManySecrets("web", "dev")).toBe("web on dev would have more than 256 secrets, more than one deploy carries. Nothing was stored.")
    const fits = await prepareSecretImport(deps, WEB, entriesOf(`${manyValues(6)}\n${manyValues(7, "OLD")}`), ".env")
    expect(fits.values.length).toBe(13)

    // 4,094 records already: 3 more would pass the 4,096 past which none of them is read.
    const store = storeOf(m)
    const held = JSON.parse(readFileSync(store.path, "utf8"))
    writeFileSync(store.path, JSON.stringify({ records: Array.from({ length: 4094 }, () => held.records[0]), removals: [] }))
    await expect(prepareSecretImport(deps, WEB, entriesOf(manyValues(3)), ".env")).rejects.toThrow(importTooManyRecords("web", "dev"))
    expect(importTooManyRecords("web", "dev")).toBe("web on dev would have more than 4096 secret records on this machine. Nothing was stored.")
    // Nothing was ever sealed for a refused import.
    expect(signer).not.toHaveBeenCalled()
  }, 60_000)
})

/**
 * Mock-up 4's machine: a team with `prod` (a runner on this machine), a
 * project folder linked to demo on prod, API_URL already set for it, and the
 * mock-up's `.env` in the folder, each value holding the sentinel.
 */
async function mockUp4() {
  const m = machine()
  expect(await m.zekno("init", "--name", "Ada")).toBe(0)
  expect(await m.zekno("server", "add", "prod", "--local", "--home", tempDir("prod"))).toBe(0)
  m.compose("services:\n  web:\n    image: example/web:1\n")
  expect(await m.zekno("link", "--app", "demo", "--server", "prod")).toBe(0)
  m.typing("https://api.example.test")
  expect(await m.zekno("secret", "set", "API_URL")).toBe(0)
  const text = [
    "# demo's values",
    `DATABASE_URL=${secret("db")}`,
    `export SESSION_KEY="${secret("session")}"`,
    `STRIPE_KEY='${secret("stripe")}' # live key`,
    `API_URL=${secret("api")}`,
    `PATH=${secret("path")}`,
    `my-var=${secret("var")}`,
    "",
  ].join("\n")
  writeFileSync(join(m.project, ".env"), text)
  m.out.length = 0
  m.err.length = 0
  return { m, text }
}

/** The four summary lines of mock-up 4, as plain output prints them. */
const SUMMARY = [
  ".env, for demo on prod",
  "new\tDATABASE_URL, SESSION_KEY, STRIPE_KEY",
  "replaces\tAPI_URL",
  "left out\tPATH (zekno keeps this name), line 7 (not a valid name)",
]
const STORED = ["Stored 4 values for demo on prod. They take effect on the next deploy.", ".env still holds them in plain text. Delete it, or keep it out of git."] as const

describe("the command (contracts/import.md, mock-up 4)", () => {
  test("the sentences of contracts/import.md", () => {
    expect(importFor(".env", "demo", "prod")).toBe(".env, for demo on prod")
    expect(SAY_WHICH_FILE).toBe("Say which file: `zekno secret import <file>`.")
    expect(nothingToImport(".env")).toBe("No value in .env can be stored, so nothing was stored.")
    expect(storeQuestion(1)).toBe("Store 1 value? Values are never shown.")
    expect(storeQuestion(4)).toBe("Store 4 values? Values are never shown.")
    expect(importNeedsYes(".env")).toBe("There is no terminal to ask on. Add `--yes` to store the values from .env.")
    expect(importStored(1, "demo", "prod")).toBe("Stored 1 value for demo on prod. It takes effect on the next deploy.")
    expect(importStored(4, "demo", "prod")).toBe(STORED[0])
    expect(importStillThere(".env", 1)).toBe(".env still holds it in plain text. Delete it, or keep it out of git.")
    expect(importStillThere(".env", 4)).toBe(STORED[1])
    expect(HELP).toContain("  zekno secret set <NAME> [--app <app>] [--server <name>] [--stdin]\n  zekno secret import <file> [--app <app>] [--server <name>] [--yes]\n")
  })

  test("at a terminal: the summary, one question, then stored; the file byte for byte as it was", async () => {
    const { m, text } = await mockUp4()
    const asking = answering(m, [{ yes: true }])
    expect(await m.zekno("secret", "import", ".env")).toBe(0)
    expect(asking.asked).toEqual([{ kind: "confirm", question: "Store 4 values? Values are never shown." }])
    expect(asking.lines).toEqual([
      ["note", ".env, for demo on prod"],
      ["gap"],
      ["groups", ...SUMMARY.slice(1)],
      ["gap"],
      ["note", STORED[1]],
    ])
    expect(m.out).toEqual([...SUMMARY, ...STORED])
    expect(m.err).toEqual([])
    expect((await listed(m, { app: "demo", server: "prod" })).sort()).toEqual(["API_URL\tversion 2", "DATABASE_URL\tversion 1", "SESSION_KEY\tversion 1", "STRIPE_KEY\tversion 1"])
    expect(readFileSync(join(m.project, ".env"), "utf8")).toBe(text)
  }, 30_000)

  test("at a terminal: no, and Esc, store nothing and say Nothing was done.; --yes stores without the question", async () => {
    for (const answer of [{ yes: false }, "leave"] as const) {
      const { m } = await mockUp4()
      const store = storeOf(m, "demo", "prod")
      const before = readFileSync(store.path)
      answering(m, [answer])
      expect(await m.zekno("secret", "import", ".env")).toBe(1)
      expect(m.err).toEqual([NOTHING_DONE])
      expect(readFileSync(store.path).equals(before)).toBe(true)
    }
    const { m } = await mockUp4()
    const asking = answering(m, [])
    expect(await m.zekno("secret", "import", ".env", "--yes")).toBe(0)
    expect(asking.asked).toEqual([])
    expect(m.out).toEqual([...SUMMARY, ...STORED])
  }, 60_000)

  test("at a terminal with no app or server: the file is read first, then the server and the app are asked", async () => {
    const m = await ready()
    expect(await m.zekno("server", "add", "staging", "--local", "--home", tempDir("staging"))).toBe(0)
    m.typing("hello")
    expect(await m.zekno("secret", "set", "GREETING", "--app", "web", "--server", "dev")).toBe(0)
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)
    // A missing file and a bad line each stop before any question, and before the server is read.
    for (const [file, content, said] of [
      ["missing.env", undefined, "No file at missing.env."],
      ["bad.env", `A=1\nB=${secret("b")}#x\n`, "bad.env, line 2: a # inside a value. Quote the value to keep it, or put a space before # to start a comment. Nothing was stored."],
    ] as const) {
      if (content !== undefined) writeFileSync(join(m.project, file), content)
      const asking = answering(m, [])
      const before = m.err.length
      expect(await m.zekno("secret", "import", file)).toBe(1)
      expect(asking.asked).toEqual([])
      expect(m.err.slice(before)).toEqual([said])
    }
    writeFileSync(join(m.project, ".env"), `NEW_ONE=${secret("new")}\n`)
    const asking = answering(m, [{ choose: "dev" }, { choose: "web" }, { yes: true }])
    expect(await m.zekno("secret", "import", ".env")).toBe(0)
    expect(asking.asked.map((question) => question.question)).toEqual(["Which server?", "Which app on dev?", "Store 1 value? Values are never shown."])
    expect(m.out.slice(-2)).toEqual(["Stored 1 value for web on dev. It takes effect on the next deploy.", ".env still holds it in plain text. Delete it, or keep it out of git."])
  }, 60_000)

  test("through the stand-in terminal: mock-up 4, line for line", async () => {
    const { m } = await mockUp4()
    const plain = m.deps.ui
    const t = terminal()
    m.deps.ui = t.ui
    const done = m.zekno("secret", "import", ".env").finally(() => (m.deps.ui = plain))
    await shows(t, "? Store 4 values? Values are never shown. (y/N)", 20_000)
    expect(t.screen().slice(0, 7)).toEqual([
      "  .env, for demo on prod",
      "",
      "  new         DATABASE_URL, SESSION_KEY, STRIPE_KEY",
      "  replaces    API_URL",
      "  left out    PATH (zekno keeps this name), line 7 (not a valid name)",
      "",
      "? Store 4 values? Values are never shown. (y/N)",
    ])
    t.keys("y")
    expect(await done).toBe(0)
    await t.ui.close()
    const screen = t.screen()
    while (screen.at(-1) === "") screen.pop()
    expect(screen).toEqual([
      "  .env, for demo on prod",
      "",
      "  new         DATABASE_URL, SESSION_KEY, STRIPE_KEY",
      "  replaces    API_URL",
      "  left out    PATH (zekno keeps this name), line 7 (not a valid name)",
      "",
      "? Store 4 values? Values are never shown. (y/N) yes",
      "✔ Stored 4 values for demo on prod. They take effect on the next deploy.",
      "  .env still holds them in plain text. Delete it, or keep it out of git.",
    ])
    expect(t.raw()).not.toContain(SENTINEL)
  }, 60_000)

  test("through the stand-in terminal: a bad line is named by its number, its first sentence after ✖ and the rest under it", async () => {
    const { m } = await mockUp4()
    writeFileSync(join(m.project, ".env"), `A=1\nB=2\nC=3\nD=4\nE=5\nF=6\nnot a line ${SENTINEL}\n`)
    const plain = m.deps.ui
    const t = terminal()
    m.deps.ui = t.ui
    expect(await m.zekno("secret", "import", ".env").finally(() => (m.deps.ui = plain))).toBe(1)
    await t.ui.close()
    expect(t.lines()).toEqual(["✖ .env, line 7: this is not a NAME=value line.", "  Nothing was stored."])
    expect(t.raw()).not.toContain(SENTINEL)
  }, 30_000)

  test("with no terminal: --yes prints the six plain lines; without it the summary, I16 and status 1, nothing stored", async () => {
    const { m } = await mockUp4()
    const store = storeOf(m, "demo", "prod")
    const before = readFileSync(store.path)
    expect(await m.zekno("secret", "import", ".env")).toBe(1)
    expect(m.out).toEqual(SUMMARY)
    expect(m.err).toEqual(["There is no terminal to ask on. Add `--yes` to store the values from .env."])
    expect(readFileSync(store.path).equals(before)).toBe(true)
    m.out.length = 0
    m.err.length = 0
    expect(await m.zekno("secret", "import", ".env", "--yes")).toBe(0)
    expect(m.out).toEqual([...SUMMARY, ...STORED])
    expect(m.err).toEqual([])
  }, 30_000)

  test("with no terminal: wrong usage, a missing app, every name left out, one value", async () => {
    const m = await ready()
    expect(await m.zekno("secret", "import")).toBe(2)
    expect(m.lastErr()).toBe(SAY_WHICH_FILE + HELP_LINE)
    expect(await m.zekno("secret", "import", ".env", "extra")).toBe(2)
    expect(m.lastErr()).toBe('Unexpected "extra" after `zekno secret import`.' + HELP_LINE)
    writeFileSync(join(m.project, ".env"), `ONE=${secret("one")}\n`)
    expect(await m.zekno("secret", "import", ".env", "--server", "dev", "--yes")).toBe(2)
    expect(m.lastErr()).toBe(MISSING_APP + HELP_LINE)

    writeFileSync(join(m.project, "out.env"), `PATH=${secret("path")}\nmy-var=${secret("var")}\nEMPTY=\n`)
    m.out.length = 0
    expect(await m.zekno("secret", "import", "out.env", "--app", "web", "--server", "dev", "--yes")).toBe(1)
    expect(m.out).toEqual(["out.env, for web on dev", "left out\tPATH (zekno keeps this name), line 2 (not a valid name), line 3 (empty)"])
    expect(m.lastErr()).toBe("No value in out.env can be stored, so nothing was stored.")
    expect(existsSync(storeOf(m).path)).toBe(false)

    m.out.length = 0
    expect(await m.zekno("secret", "import", ".env", "--app", "web", "--server", "dev", "--yes")).toBe(0)
    expect(m.out).toEqual([
      ".env, for web on dev",
      "new\tONE",
      "Stored 1 value for web on dev. It takes effect on the next deploy.",
      ".env still holds it in plain text. Delete it, or keep it out of git.",
    ])
  }, 30_000)

  test("twenty values with one command and one answer: twenty new versions, and no value anywhere but sealed (SC-003, FR-021)", async () => {
    const { m } = await mockUp4()
    const text = manyValues(20, "VALUE_")
    writeFileSync(join(m.project, "twenty.env"), text)
    const spawned: string[] = []
    const spawn = Bun.spawn
    const spy = spyOn(Bun, "spawn").mockImplementation(((argv: string[], options: never) => {
      spawned.push(JSON.stringify(argv), JSON.stringify(options ?? {}))
      return spawn(argv, options)
    }) as never)
    const drawn: string[] = []
    const plain = m.deps.ui
    m.deps.ui = {
      ...plain,
      info: (line) => (drawn.push(line), plain.info(line)),
      success: (line, detail, options) => (drawn.push(line), plain.success(line, detail, options)),
      warn: (line, options) => (drawn.push(line), plain.warn(line, options)),
      error: (line) => (drawn.push(line), plain.error(line)),
      note: (line) => (drawn.push(line), plain.note(line)),
      groups: (rows) => (drawn.push(JSON.stringify(rows)), plain.groups(rows)),
    }
    const asking = answering(m, [{ yes: true }])
    try {
      expect(await m.zekno("secret", "import", "twenty.env")).toBe(0)
    } finally {
      spy.mockRestore()
    }
    expect(asking.asked).toEqual([{ kind: "confirm", question: "Store 20 values? Values are never shown." }])
    const versions = await listed(m, { app: "demo", server: "prod" })
    expect(versions.filter((line) => line.startsWith("VALUE_")).length).toBe(20)
    expect(versions.filter((line) => line.startsWith("VALUE_")).every((line) => line.endsWith("\tversion 1"))).toBe(true)
    // Nowhere: standard output and error, every line drawn, every file of the profile and project folders but the
    // import file itself, and every process started with its arguments and environment.
    for (const where of [m.out, m.err, drawn, spawned]) expect(where.filter((line) => line.includes(SENTINEL))).toEqual([])
    expect(holding(m.home)).toEqual([])
    expect(holding(m.project).map((file) => file.path.split("/").at(-1)).sort()).toEqual([".env", "twenty.env"])
    expect(readFileSync(join(m.project, "twenty.env"), "utf8")).toBe(text)
  }, 60_000)

  test("a value wrapped onto lines of its own (security review S1): no piece of it is shown, stored as a name, or in any error", async () => {
    const m = await ready()
    // The review's file: line 2 is the last piece of GOOGLE_CREDENTIALS's value, line 4 the last piece of API_TOKEN's.
    const FIRST = "c2VydmljZS1hY2NvdW50LWtleS1hYmNkZWYxMjM0NTY3ODkw"
    const PIECES = ["QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo1Ng", "dG9wc2VjcmV0dG9rZW4xMjM0NTY3ODkwYWJj", "c2VjcmV0LXdyYXBwZWQ"]
    const REVIEW = `GOOGLE_CREDENTIALS=${FIRST}\n${PIECES[0]}==\nAPI_TOKEN=x\n${PIECES[1]}=\n`
    const nowhere = (lines: readonly string[]) => expect(lines.filter((line) => PIECES.some((piece) => line.includes(piece)))).toEqual([])
    const plain = m.deps.ui
    const drawn: string[] = []
    const atTerminal = async (...args: string[]) => {
      const t = terminal(80)
      m.deps.ui = t.ui
      const code = await m.zekno(...args).finally(() => (m.deps.ui = plain))
      await t.ui.close()
      drawn.push(t.raw())
      return { code, lines: t.lines() }
    }
    const [out, err] = [m.out.length, m.err.length]

    // Line 2 begins with `=` after its key: the whole import stops there, by the line's number, and nothing is stored.
    writeFileSync(join(m.project, ".env"), REVIEW)
    expect(await m.zekno("secret", "import", ".env", "--app", "web", "--server", "dev", "--yes")).toBe(1)
    expect(m.out.slice(out)).toEqual([])
    expect(m.err.slice(err)).toEqual([".env, line 2: this is not a NAME=value line. Nothing was stored."])
    expect(await atTerminal("secret", "import", ".env", "--app", "web", "--server", "dev", "--yes")).toEqual({
      code: 1,
      lines: ["✖ .env, line 2: this is not a NAME=value line.", "  Nothing was stored."],
    })
    expect(existsSync(storeOf(m).path)).toBe(false)

    // Without line 2, the pieces left are left out by their line only: one read as an empty value, one as a name that does not fit.
    writeFileSync(join(m.project, ".env"), `GOOGLE_CREDENTIALS=${FIRST}\n# wrapped\nAPI_TOKEN=x\n${PIECES[1]}=\nOTHER=y\n${PIECES[2]}-Zg=x\n`)
    const shown = m.out.length
    expect(await m.zekno("secret", "import", ".env", "--app", "web", "--server", "dev", "--yes")).toBe(0)
    expect(m.out.slice(shown)).toEqual([
      ".env, for web on dev",
      "new\tGOOGLE_CREDENTIALS, API_TOKEN, OTHER",
      "left out\tline 4 (empty), line 6 (not a valid name)",
      "Stored 3 values for web on dev. They take effect on the next deploy.",
      ".env still holds them in plain text. Delete it, or keep it out of git.",
    ])
    const screen = await atTerminal("secret", "import", ".env", "--app", "web", "--server", "dev", "--yes")
    expect(screen.code).toBe(0)
    expect(screen.lines).toContain("  left out    line 4 (empty), line 6 (not a valid name)")

    // The names stored are the three real ones; no piece is a name, a line, an error or a file in plain text.
    expect((await listed(m)).sort()).toEqual(["API_TOKEN\tversion 2", "GOOGLE_CREDENTIALS\tversion 2", "OTHER\tversion 2"])
    nowhere([...m.out, ...m.err, ...drawn])
    nowhere(filesUnder(m.home).map((file) => file.content))
  }, 60_000)

  test("no value in any error: a bad line, a limit, a failed write", async () => {
    const { m } = await mockUp4()
    const lines: string[] = []
    writeFileSync(join(m.project, "bad.env"), `GOOD=${secret("good")}\nBAD="${secret("bad")}\\q"\n`)
    expect(await m.zekno("secret", "import", "bad.env", "--yes")).toBe(1)
    writeFileSync(join(m.project, "many.env"), manyValues(257))
    expect(await m.zekno("secret", "import", "many.env", "--yes")).toBe(1)
    const store = storeOf(m, "demo", "prod")
    chmodSync(store.folder, 0o500)
    try {
      expect(await m.zekno("secret", "import", ".env", "--yes")).toBe(1)
    } finally {
      chmodSync(store.folder, 0o700)
    }
    lines.push(...m.out, ...m.err)
    expect(m.err).toEqual([
      'bad.env, line 2: an escape zekno does not read. Inside double quotes only \\\\ \\" \\n \\r \\t and \\$ are read. Nothing was stored.',
      "many.env has more than 256 values, more than one deploy carries. Nothing was stored.",
      `Could not write ${store.path}.`,
    ])
    expect(lines.filter((line) => line.includes(SENTINEL))).toEqual([])
    expect(holding(m.home)).toEqual([])
  }, 30_000)
})
