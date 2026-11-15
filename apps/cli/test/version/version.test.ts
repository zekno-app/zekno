/**
 * `zekno --version` and `zekno version` (specs/006-cli-small-features,
 * contracts/version.md, FR-031, mock-up 6): the CLI's own version and the
 * runner release it installs, with no key, no profile and no terminal.
 */
import { describe, expect, test } from "bun:test"
import { RUNNER_VERSION_PATTERN } from "@workspace/core"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PassThrough, Writable } from "node:stream"

import { tempDir } from "../../../runner/test/support/helpers"
import { HELP, run } from "../../src/cli/cli"
import type { Deps } from "../../src/cli/context"
import { newerExists, type Fetch } from "../../src/version/newest"
import { firstSentence } from "../../src/ui/ink/questions"
import { RUNNER_RELEASE } from "../../src/version/runner-release"
import { inkUi } from "../../src/ui/ink/ink"
import { plainUi } from "../../src/ui/plain/plain"
import { CLI_VERSION } from "../../src/version/version"
import { ready, screenOf } from "../support/helpers"

const PACKAGE = join(import.meta.dir, "../../package.json")

/** The two lines of mock-up 6. */
const LINES = [`zekno ${CLI_VERSION}`, `runner ${RUNNER_RELEASE.version}, the runner release this zekno installs`]

/** A machine with nothing on it: no profile, a keychain that must not be read, and no server to reach. */
function bare(fetch?: Fetch) {
  const out: string[] = []
  const err: string[] = []
  const untouchable = () => {
    throw new Error("the keychain was read")
  }
  const deps: Deps = {
    home: tempDir("no-profile"),
    cwd: tempDir("folder"),
    keyStore: { get: untouchable, set: untouchable, delete: untouchable },
    connect: () => {
      throw new Error("a connection was made")
    },
    ui: plainUi(
      (line) => out.push(line),
      (line) => err.push(line)
    ),
    localRunner: [],
    ...(fetch === undefined ? {} : { fetch }),
  }
  return { deps, out, err, zekno: (...argv: string[]) => run(argv, deps) }
}

/** The release file's form (specs/008-cli-decisions): a version, and both checksums unless given otherwise. */
const releaseFile = (version: unknown, sha256: unknown = "0123456789abcdef".repeat(4)) => ({ version, files: { "linux-x64": { sha256 }, "linux-arm64": { sha256 } } })

/** A stand-in for GitHub's answer: the release file on main naming a published version, or a failure. It counts its calls and never reaches the network. */
function github(version: string | "fails") {
  let calls = 0
  const fetch: Fetch = async () => {
    calls++
    if (version === "fails") throw new TypeError("fetch failed")
    return new Response(JSON.stringify(releaseFile(version)), { status: 200 })
  }
  return { fetch, calls: () => calls }
}

/** A fetch that must not be called: it counts its calls, and fails whatever calls it. */
function forbidden() {
  let calls = 0
  const fetch: Fetch = () => {
    calls++
    throw new Error("the network was used")
  }
  return { fetch, calls: () => calls }
}

/** The release this zekno carries, pinned to runner 0.1.0 as mock-up 6 draws it, whatever runner-release.json says today. */
const CARRIED = { ...RUNNER_RELEASE, version: "0.1.0" }
const LINES_010 = [`zekno ${CLI_VERSION}`, "runner 0.1.0, the runner release this zekno installs"]

/** Draws `zekno <argv>` with the interface a terminal gets, and gives back the lines on the screen. */
async function drawn(deps: Deps, ...argv: string[]): Promise<{ code: number; lines: string[] }> {
  let raw = ""
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        raw += String(chunk)
        done()
      },
    }),
    { columns: 100, rows: 30 }
  )
  const ui = inkUi({ stdout: stdout as unknown as NodeJS.WriteStream, stdin: new PassThrough() as unknown as NodeJS.ReadStream })
  const code = await run(argv, { ...deps, ui })
  await ui.close()
  return { code, lines: screenOf(raw).filter(Boolean) }
}

describe("the version (contracts/version.md)", () => {
  test("CLI_VERSION is apps/cli/package.json's version, 0.1.0, and fits the version grammar", () => {
    const version = (JSON.parse(readFileSync(PACKAGE, "utf8")) as { version: string }).version
    expect(CLI_VERSION).toBe(version)
    expect(CLI_VERSION).toBe("0.1.0")
    expect(CLI_VERSION).toMatch(RUNNER_VERSION_PATTERN)
  })

  test("zekno --version prints the two lines with no profile, no keychain and no connection", async () => {
    for (const argv of [["--version"], ["status", "--version"]]) {
      const m = bare()
      expect(await m.zekno(...argv)).toBe(0)
      expect(m.out).toEqual(LINES)
      expect(m.err).toEqual([])
    }
  })

  test("with --json: one object on one line", async () => {
    const m = bare()
    expect(await m.zekno("--version", "--json")).toBe(0)
    expect(m.out).toEqual([JSON.stringify({ zekno: CLI_VERSION, runner: RUNNER_RELEASE.version })])
    expect(m.err).toEqual([])
  })

  test("--help wins over --version, and nothing may follow `zekno version`", async () => {
    const help = bare()
    expect(await help.zekno("--version", "--help")).toBe(0)
    expect(help.out).toEqual([HELP])
    const extra = bare()
    expect(await extra.zekno("version", "extra")).toBe(2)
    expect(extra.out).toEqual([])
    expect(extra.err).toEqual(['Unexpected "extra" after `zekno version`.\nRun `zekno --help` for the list of commands.'])
  })

  test("at a terminal the two lines are drawn from column 0", async () => {
    expect(await drawn(bare().deps, "--version")).toEqual({ code: 0, lines: LINES })
  })
})

describe("zekno version says whether a newer release exists (contracts/version.md, mock-up 6)", () => {
  test("plain: the two lines, then the newest, a newer release on standard error, or could not check; status 0 and one request each time", async () => {
    const cases = [
      { version: "0.1.0", out: [...LINES_010, "This is the newest release."], err: [] },
      { version: "0.2.0", out: LINES_010, err: ["A newer release exists: 0.2.0. Update zekno to get it."] },
      { version: "fails", out: [...LINES_010, "Could not check for a newer release."], err: [] },
    ] as const
    for (const { version, out, err } of cases) {
      const answer = github(version)
      const m = bare(answer.fetch)
      m.deps.release = CARRIED
      expect(await m.zekno("version")).toBe(0)
      expect({ version, out: m.out, err: m.err }).toEqual({ version, out: [...out], err: [...err] })
      expect(answer.calls()).toBe(1)
    }
  })

  test("with --json: one object, the result in latest", async () => {
    const versions = { zekno: CLI_VERSION, runner: "0.1.0" }
    const cases = [
      { version: "0.1.0", latest: { state: "newest" } },
      { version: "0.2.0", latest: { state: "newer", version: "0.2.0" } },
      { version: "fails", latest: { state: "not_checked" } },
    ] as const
    for (const { version, latest } of cases) {
      const answer = github(version)
      const m = bare(answer.fetch)
      m.deps.release = CARRIED
      expect(await m.zekno("version", "--json")).toBe(0)
      expect(m.out).toEqual([JSON.stringify({ ...versions, latest })])
      expect(m.err).toEqual([])
      expect(answer.calls()).toBe(1)
    }
  })

  test("hostile answers end as could not check, or as the right line, and the status is 0; nothing of the answer but a version is shown", async () => {
    const release = (fields: unknown) => new Response(JSON.stringify(fields), { status: 200 })
    const moved = (location: string) => new Response(null, { status: 302, headers: { location } })
    const huge = `${JSON.stringify(releaseFile("99.0.0"))}${" ".repeat(16_385)}`
    const cases: { what: string; answer: () => Response; out: string[]; err: string[] }[] = [
      {
        what: "a redirect to http",
        answer: () => moved("http://raw.githubusercontent.com/zekno-app/zekno/refs/heads/main/apps/cli/src/version/runner-release.json"),
        out: [...LINES, "Could not check for a newer release."],
        err: [],
      },
      { what: "a redirect to another host", answer: () => moved("https://evil.example/latest"), out: [...LINES, "Could not check for a newer release."], err: [] },
      { what: "a body that is not JSON", answer: () => new Response("<html>\x1b[2J</html>", { status: 200 }), out: [...LINES, "Could not check for a newer release."], err: [] },
      { what: "a body larger than the limit", answer: () => new Response(huge, { status: 200 }), out: [...LINES, "Could not check for a newer release."], err: [] },
      { what: "a version that is not of the grammar", answer: () => release(releaseFile("v99.0.0")), out: [...LINES, "Could not check for a newer release."], err: [] },
      { what: "a development version", answer: () => release(releaseFile("99.0.0-dev.1")), out: [...LINES, "Could not check for a newer release."], err: [] },
      { what: "a version older than this zekno's", answer: () => release(releaseFile("0.0.1")), out: [...LINES, "This is the newest release."], err: [] },
      { what: "a newer version without its checksums", answer: () => release(releaseFile("99.0.0", null)), out: [...LINES, "This is the newest release."], err: [] },
      { what: "a checksum that is not 64 lowercase hex characters", answer: () => release(releaseFile("99.0.0", "\x1b[2J")), out: [...LINES, "Could not check for a newer release."], err: [] },
      { what: "a status other than 200", answer: () => new Response("rate limited", { status: 429 }), out: [...LINES, "Could not check for a newer release."], err: [] },
      {
        what: "a newer version among fields the file does not have",
        answer: () => release({ ...releaseFile("99.0.0"), name: "\x1b]52;c;ZXZpbA==\x07", body: "\x1b[2J" }),
        out: [...LINES, "Could not check for a newer release."],
        err: [],
      },
    ]
    for (const { what, answer, out, err } of cases) {
      const m = bare(async () => answer())
      expect({ what, code: await m.zekno("version"), out: m.out, err: m.err }).toEqual({ what, code: 0, out, err })
      expect([...m.out, ...m.err].join("\n")).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/)
    }
  })

  test("with no fetch at all nothing is asked: could not check", async () => {
    const m = bare()
    expect(await m.zekno("version")).toBe(0)
    expect(m.out).toEqual([...LINES, "Could not check for a newer release."])
  })

  test("zekno --version never uses the network", async () => {
    for (const argv of [["--version"], ["status", "--version"], ["version", "--version", "--help"]]) {
      const network = forbidden()
      const m = bare(network.fetch)
      expect(await m.zekno(...argv)).toBe(0)
      expect(m.err).toEqual([])
      expect(network.calls()).toBe(0)
    }
    const network = forbidden()
    const m = bare(network.fetch)
    expect(await m.zekno("--version", "--json")).toBe(0)
    expect(m.out).toEqual([JSON.stringify({ zekno: CLI_VERSION, runner: RUNNER_RELEASE.version })])
    expect(network.calls()).toBe(0)
  })

  test("at a terminal: mock-up 6's third line for each answer", async () => {
    const carrying = (version: string) => ({ ...bare(github(version).fetch).deps, release: CARRIED })
    const lines = LINES_010
    expect(await drawn(carrying("0.1.0"), "version")).toEqual({ code: 0, lines: [...lines, "✔ This is the newest release."] })
    expect(await drawn(carrying("0.2.0"), "version")).toEqual({ code: 0, lines: [...lines, "! A newer release exists: 0.2.0. Update zekno to get it."] })
    expect(await drawn(carrying("fails"), "version")).toEqual({ code: 0, lines: [...lines, "  Could not check for a newer release."] })
  })

  test("at a terminal a newer release is drawn as the board draws it: its first sentence bold, the rest plain; no other warning is", async () => {
    // Colour and bold are not written to a test's stream (no terminal to colour), so what is checked is what the interface is told.
    expect(firstSentence(newerExists("0.2.0"))).toEqual({ first: "A newer release exists: 0.2.0.", rest: " Update zekno to get it." })
    const m = { ...bare(github("0.2.0").fetch) }
    m.deps.release = CARRIED
    const warned: { text: string; options?: { firstBold?: boolean } }[] = []
    const plain = m.deps.ui
    m.deps.ui = { ...plain, warn: (text, options) => (warned.push({ text, ...(options === undefined ? {} : { options }) }), plain.warn(text, options)) }
    expect(await m.zekno("version")).toBe(0)
    expect(warned).toEqual([{ text: "A newer release exists: 0.2.0. Update zekno to get it.", options: { firstBold: true } }])
    // Plain output is the same as before: the sentence whole, on standard error.
    expect(m.err).toEqual(["A newer release exists: 0.2.0. Update zekno to get it."])
    // No other warning is drawn so: only `zekno version` asks for it.
    const source = join(import.meta.dir, "../../src")
    const asking = [...new Bun.Glob("**/*.{ts,tsx}").scanSync(source)].filter((file) => /\.warn\([^\n]*firstBold/.test(readFileSync(join(source, file), "utf8")))
    expect(asking).toEqual(["cli/cli.ts"])
  })
})

/**
 * Which `zekno` to run for each command of the help, to show it never asks
 * GitHub (FR-036). A command the help gains and this table lacks fails the
 * test below, so that it is added here.
 */
const NEVER_FETCHES: { [command: string]: string[] } = {
  "": ["--version"],
  init: ["init", "--name", "Bob"],
  "server add": ["server", "add", "two", "--local", "--home", tempDir("two")],
  "server update": ["server", "update", "dev", "--yes"],
  "server ls": ["server", "ls"],
  "secret set": ["secret", "set", "GREETING", "--app", "web", "--server", "dev"],
  "secret import": ["secret", "import", ".env", "--app", "web", "--server", "dev", "--yes"],
  "secret rm": ["secret", "rm", "GREETING", "--app", "web", "--server", "dev"],
  "secret ls": ["secret", "ls", "--app", "web", "--server", "dev"],
  deploy: ["deploy", "--app", "web", "--server", "dev"],
  rollback: ["rollback", "--app", "web", "--server", "dev"],
  status: ["status", "--server", "dev"],
  logs: ["logs", "--app", "web", "--server", "dev", "--no-follow"],
  link: ["link", "--app", "web", "--server", "dev"],
}

/** The commands of the help, by their words, as docs.test.ts reads them. */
function helpCommands(): string[] {
  const commands = new Set<string>()
  for (const line of HELP.split("\n")) {
    const usage = /^\s+zekno\s+(.*)$/.exec(line)?.[1]
    if (usage === undefined) continue
    const words: string[] = []
    for (const token of usage.split(/\s+/)) {
      if (!/^[a-z]+$/.test(token)) break
      words.push(token)
    }
    commands.add(words.join(" "))
  }
  return [...commands]
}

describe("no other command asks GitHub (FR-036)", () => {
  test("every command of the help but version and doctor, against a ready machine, never calls the fetch", async () => {
    const m = await ready()
    const calls: string[] = []
    m.deps.fetch = async (input) => {
      calls.push(input)
      throw new Error("the network was used")
    }
    const commands = helpCommands().filter((command) => command !== "version" && command !== "doctor")
    expect(commands.filter((command) => NEVER_FETCHES[command] === undefined)).toEqual([])
    for (const command of commands) {
      if (command === "secret set") m.typing("hello")
      if (command === "secret import") writeFileSync(join(m.project, ".env"), "IMPORTED=1\n")
      await m.zekno(...NEVER_FETCHES[command]!)
      expect({ command, calls }).toEqual({ command, calls: [] })
    }
  }, 60_000)

  test("main.ts hands Bun's fetch to run, and is the only place that does", () => {
    const main = readFileSync(join(import.meta.dir, "../../src/main.ts"), "utf8")
    expect(main).toMatch(/fetch: \(input, init\) => fetch\(input, init\)/)
  })

  test("only version/newest.ts uses the fetch, and only cli.ts and ops/doctor.ts ask it: the full-screen app and the other operations never do", () => {
    const source = join(import.meta.dir, "../../src")
    const files = [...new Bun.Glob("**/*.{ts,tsx}").scanSync(source)].sort()
    expect(files.length).toBeGreaterThan(40)
    const using = (pattern: RegExp) => files.filter((file) => pattern.test(readFileSync(join(source, file), "utf8")))
    // cli.ts for `zekno version`; ops/doctor.ts for `zekno doctor`'s first line, once per run (contracts/version.md, "In zekno doctor").
    expect(using(/\bcheckNewest\(/)).toEqual(["cli/cli.ts", "ops/doctor.ts", "version/newest.ts"])
    expect(using(/\.fetch\b/)).toEqual(["version/newest.ts"])
    // A call with something to fetch. The installer's shell script has a function of its own named `fetch()`, which is not this.
    expect(using(/\bfetch\([^)\s]/)).toEqual(["main.ts", "version/newest.ts"])
  })
})
