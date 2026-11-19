/**
 * No command but `zekno version` and `zekno doctor` asks GitHub whether a
 * newer release exists (specs/006-cli-small-features, contracts/version.md,
 * FR-036), and nothing else of the CLI fetches: every command of the help
 * run against a ready machine with a fetch that counts its calls, and the
 * source read for who may fetch. Moved out of version.test.ts, unchanged but
 * for `zekno add`'s three forms (specs/012-templates, contracts/commands.md,
 * "Usage, and the changes to HELP").
 */
import { describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { HELP } from "../../src/cli/cli"
import { ready } from "../support/helpers"

/**
 * Which `zekno` to run for each command of the help, to show it never asks
 * GitHub (FR-036): one run, or several for a command the help lists in
 * several forms (`zekno add`, `--list` and `--show`). A command the help
 * gains and this table lacks fails the test below, so that it is added here.
 */
const NEVER_FETCHES: { [command: string]: string[][] } = {
  "": [["--version"]],
  init: [["init", "--name", "Bob"]],
  "server add": [["server", "add", "two", "--local", "--home", tempDir("two")]],
  "server update": [["server", "update", "dev", "--yes"]],
  "server ls": [["server", "ls"]],
  "secret set": [
    ["secret", "set", "GREETING", "--app", "web", "--server", "dev"],
  ],
  "secret import": [
    ["secret", "import", ".env", "--app", "web", "--server", "dev", "--yes"],
  ],
  "secret rm": [
    ["secret", "rm", "GREETING", "--app", "web", "--server", "dev"],
  ],
  "secret ls": [["secret", "ls", "--app", "web", "--server", "dev"]],
  deploy: [["deploy", "--app", "web", "--server", "dev"]],
  rollback: [["rollback", "--app", "web", "--server", "dev"]],
  status: [["status", "--server", "dev"]],
  logs: [["logs", "--app", "web", "--server", "dev", "--no-follow"]],
  link: [["link", "--app", "web", "--server", "dev"]],
  settings: [["settings"]],
  "settings set": [["settings", "set", "web.memory", "1g", "--yes"]],
  "settings unset": [["settings", "unset", "web.memory", "--yes"]],
  "settings compose": [["settings", "compose"]],
  "settings init": [["settings", "init"]],
  // specs/015-domains-https, CL2: they change the settings file only.
  "domain add": [["domain", "add", "shop.example.com", "--yes"]],
  "domain rm": [["domain", "rm", "shop.example.com", "--yes"]],
  // CL4: the folder's file and its server, and what this machine looks up itself (CL5), never GitHub.
  domain: [["domain"], ["domain", "--json"]],
  add: [
    ["add", "postgres", "--yes", "--app", "demo", "--server", "dev"],
    ["add", "--list"],
    ["add", "postgres", "--show"],
  ],
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
    const commands = helpCommands().filter(
      (command) => command !== "version" && command !== "doctor"
    )
    expect(
      commands.filter((command) => NEVER_FETCHES[command] === undefined)
    ).toEqual([])
    for (const command of commands)
      for (const argv of NEVER_FETCHES[command]!) {
        if (command === "secret set") m.typing("hello")
        if (command === "secret import")
          writeFileSync(join(m.project, ".env"), "IMPORTED=1\n")
        await m.zekno(...argv)
        expect({ argv, calls }).toEqual({ argv, calls: [] })
      }
  }, 60_000)

  test("main.ts hands Bun's fetch to run, and is the only place that does", () => {
    const main = readFileSync(
      join(import.meta.dir, "../../src/main.ts"),
      "utf8"
    )
    expect(main).toMatch(/fetch: \(input, init\) => fetch\(input, init\)/)
  })

  test("only version/newest.ts uses the fetch, and only cli.ts and ops/doctor.ts ask it: the full-screen app and the other operations never do", () => {
    const source = join(import.meta.dir, "../../src")
    const files = [...new Bun.Glob("**/*.{ts,tsx}").scanSync(source)].sort()
    expect(files.length).toBeGreaterThan(40)
    const using = (pattern: RegExp) =>
      files.filter((file) =>
        pattern.test(readFileSync(join(source, file), "utf8"))
      )
    // cli.ts for `zekno version`; ops/doctor.ts for `zekno doctor`'s first line, once per run (contracts/version.md, "In zekno doctor").
    expect(using(/\bcheckNewest\(/)).toEqual([
      "cli/cli.ts",
      "ops/doctor.ts",
      "version/newest.ts",
    ])
    expect(using(/\.fetch\b/)).toEqual(["version/newest.ts"])
    // A call with something to fetch. The installer's shell script has a function of its own named `fetch()`, which is not this.
    expect(using(/\bfetch\([^)\s]/)).toEqual(["main.ts", "version/newest.ts"])
  })
})
