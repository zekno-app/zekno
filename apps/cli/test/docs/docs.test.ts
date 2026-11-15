/**
 * SC-010: the CLI's README and its docs page name every command, flag and
 * key the CLI has, and every `zekno` command they name exists. The commands
 * and flags are read from the CLI's own help text, and the keys from the key
 * table of the app's contract, so this test copies neither. Nothing here
 * starts a process.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { HELP, run } from "../src/cli"
import type { Deps } from "../src/context"
import { memoryKeyStore } from "../src/keystore"
import { plainUi } from "../src/ui/plain"

const ROOT = join(import.meta.dir, "../../..")
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8")

/** The two places a person reads about the CLI. */
const DOCS = ["apps/cli/README.md", "apps/web/content/docs/cli.mdx"] as const
const CONTRACT = "specs/004-cli-app/contracts/app.md"

/**
 * Each command of the help, by its words, with every flag its usage lines
 * name. A usage line is `  zekno <words> <placeholders and flags>`; the words
 * end at the first token that is not a plain lowercase word.
 */
function commandsOf(help: string): Map<string, Set<string>> {
  const commands = new Map<string, Set<string>>()
  for (const line of help.split("\n")) {
    const usage = /^\s+zekno\s+(.*)$/.exec(line)?.[1]
    if (usage === undefined) continue
    const words: string[] = []
    for (const token of usage.split(/\s+/)) {
      if (!/^[a-z]+$/.test(token)) break
      words.push(token)
    }
    const flags = commands.get(words.join(" ")) ?? new Set<string>()
    for (const match of usage.matchAll(/(?<=^|[\s[])(--?[a-z][a-z-]*)/g)) flags.add(match[1]!)
    commands.set(words.join(" "), flags)
  }
  return commands
}

/** The backquoted names in the first cell of each row of the table whose header starts with `| Key |`. */
function keyColumn(markdown: string): string[] {
  const lines = markdown.split("\n")
  const header = lines.findIndex((line) => /^\|\s*Key\s*\|/.test(line))
  if (header === -1) return []
  const keys: string[] = []
  // The row after the header is the line under it.
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) break
    for (const match of (line.split("|")[1] ?? "").matchAll(/`([^`]+)`/g)) keys.push(match[1]!)
  }
  return keys
}

/**
 * Every piece of code in a markdown text: each line of a fenced block, its
 * comment left out, and each inline code span. `\|` inside a table is `|`.
 */
function codeOf(markdown: string): string[] {
  const pieces: string[] = []
  let fenced = false
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) pieces.push(line.replace(/(^|\s)#.*$/, ""))
    else for (const match of line.matchAll(/`([^`\n]+)`/g)) pieces.push(match[1]!)
  }
  return pieces.map((piece) => piece.replace(/\\\|/g, "|"))
}

/** One `zekno ...` in code: its plain words and its flags, up to a pipe, a redirect or the end of the command. */
type Invocation = { text: string; words: string[]; flags: string[] }

/**
 * The `zekno` commands a piece of code runs. `zekno.json`, `zekno-runner`,
 * `~/.zekno` and `dist/zekno` are other things and are not counted. A
 * placeholder such as `<compose file>` and the brackets around an optional
 * part are read as a value, so that a `<` left over is a redirect.
 *
 * `zekno` runs a command only where a command starts: at the start of the
 * code, after a `$ ` prompt, or after `|`, `;`, `&&`, `$(`, or a `(` that
 * itself stands where a command starts. Anywhere else it is a word of zekno's
 * own output, such as `runner 0.1.0, the runner release this zekno installs`
 * in `zekno version`'s lines (specs/006-cli-small-features, mock-up 6) and
 * `PATH (zekno keeps this name)` in `zekno secret import`'s (mock-up 4): a `(`
 * after a word starts no command in a shell.
 */
function invocationsIn(code: string): Invocation[] {
  const plain = code.replace(/<[^<>\n]*>/g, "VALUE").replace(/[[\]]/g, " ")
  return [...plain.matchAll(/(?:^\s*\(?|[|;]\s*\(?|&&\s*\(?|\$\(?)\s*zekno(?=\s|$)([^|;&<>]*)/g)].map((match) => {
    const tokens = match[1]!.trim() === "" ? [] : match[1]!.trim().split(/\s+/)
    const words: string[] = []
    for (const token of tokens) {
      if (!/^[a-z]+$/.test(token)) break
      words.push(token)
    }
    return { text: `zekno ${tokens.join(" ")}`.trim(), words, flags: tokens.filter((token) => /^--?[a-z][a-z-]*$/.test(token)) }
  })
}

/** The command an invocation runs: the longest run of its first words that is a command of the help. */
function commandOf(invocation: Invocation, commands: Map<string, Set<string>>): string | undefined {
  for (let count = invocation.words.length; count > 0; count--) {
    const words = invocation.words.slice(0, count).join(" ")
    if (commands.has(words)) return words
  }
  return undefined
}

/** A flag as a whole token: `-f` is not the start of `--force`. */
const names = (text: string, flag: string): boolean =>
  new RegExp(`(?<![\\w-])${flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(text)

/**
 * The ways of asking for the help that the help does not list itself. The
 * test below runs each one, so they are the CLI's, not this file's.
 */
const HELP_FLAGS = ["--help", "-h"]
const HELP_WORD = "help"

/** Runs one command with nothing behind it: no profile, no keychain entry, no connection. */
async function runAlone(argv: string[]): Promise<{ code: number; out: string[] }> {
  const out: string[] = []
  const deps: Deps = {
    home: join(import.meta.dir, "no-profile-here"),
    cwd: import.meta.dir,
    keyStore: memoryKeyStore(),
    connect: () => {
      throw new Error("Nothing in this test connects to a runner.")
    },
    ui: plainUi(
      (line) => out.push(line),
      (line) => out.push(line)
    ),
    localRunner: [],
  }
  return { code: await run(argv, deps), out }
}

const COMMANDS = commandsOf(HELP)
const FLAGS = [...new Set([...COMMANDS.values()].flatMap((flags) => [...flags]))]
const KEYS = keyColumn(read(CONTRACT))
/** The flags `zekno` alone may take: the help's own, and those of a usage line with no command words, such as `zekno --version [--json]`. */
const ALONE_FLAGS = [...HELP_FLAGS, ...(COMMANDS.get("") ?? [])]

describe("what the docs are checked against", () => {
  test("the help lists the commands and flags, and the contract its keys", () => {
    expect([...COMMANDS.keys()]).toContain("server add")
    expect(COMMANDS.size).toBeGreaterThanOrEqual(12)
    expect(FLAGS).toContain("--no-follow")
    expect(FLAGS.length).toBeGreaterThanOrEqual(15)
    expect(KEYS).toContain("ctrl-c")
    expect(KEYS.length).toBeGreaterThanOrEqual(20)
  })

  test("`zekno --help`, `zekno -h` and `zekno help` print the help and succeed", async () => {
    for (const argv of [...HELP_FLAGS.map((flag) => [flag]), [HELP_WORD]]) {
      const { code, out } = await runAlone(argv)
      expect({ argv, code, out }).toEqual({ argv, code: 0, out: [HELP] })
    }
  })
})

describe.each(DOCS)("%s", (file) => {
  const text = read(file)

  test("names every command and every flag of the help", () => {
    const missing = [
      ...[...COMMANDS.keys()].filter((command) => !text.includes(`zekno ${command}`)).map((command) => `zekno ${command}`),
      ...FLAGS.filter((flag) => !names(text, flag)),
    ]
    expect(missing.map((name) => `${file} does not name ${name}`)).toEqual([])
  })

  test(`names every key of ${CONTRACT}`, () => {
    const missing = KEYS.filter((key) => !text.includes(`\`${key}\``))
    expect(missing.map((key) => `${file} does not name the key ${key}`)).toEqual([])
  })

  test("every zekno command it names is a command of the CLI, with flags that command takes", () => {
    const wrong: string[] = []
    for (const invocation of codeOf(text).flatMap(invocationsIn)) {
      if (invocation.words.length === 0 || (invocation.words.length === 1 && invocation.words[0] === HELP_WORD)) {
        // `zekno` alone opens the app; with only a help flag, or as `zekno help`, it prints the help; `zekno --version` prints the versions.
        const extra = invocation.flags.filter((flag) => !ALONE_FLAGS.includes(flag))
        if (extra.length > 0) wrong.push(`${file} names \`${invocation.text}\`, but ${extra.join(", ")} is not a flag of \`zekno\` alone`)
        continue
      }
      const command = commandOf(invocation, COMMANDS)
      if (command === undefined) {
        wrong.push(`${file} names \`${invocation.text}\`, which is not a command of the CLI`)
        continue
      }
      const extra = invocation.flags.filter((flag) => !COMMANDS.get(command)!.has(flag) && !HELP_FLAGS.includes(flag))
      if (extra.length > 0) wrong.push(`${file} names \`${invocation.text}\`, but \`zekno ${command}\` does not take ${extra.join(", ")}`)
    }
    expect(wrong).toEqual([])
  })

  test(`every key in its key table is a key of ${CONTRACT}`, () => {
    const listed = keyColumn(text)
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.filter((key) => !KEYS.includes(key)).map((key) => `${file} lists the key ${key}, which the app does not have`)).toEqual([])
  })
})
