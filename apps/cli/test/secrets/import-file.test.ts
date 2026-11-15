/**
 * The import file's reader (specs/006-cli-small-features, contracts/import.md,
 * "Reading the file" and "The grammar"): every case of the grammar, the
 * sentence each kind of wrong line gets, and the descriptor checks of a path
 * the person typed. Every case that stops carries a recognisable value on the
 * wrong line, and the error it becomes never holds it.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, symlinkSync, truncateSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/helpers"
import { CliError } from "../../src/errors"
import {
  IMPORT_FILE_LIMIT,
  importError,
  importLineSentence,
  parseImport,
  readImportFile,
  type ImportFailure,
  type ImportReason,
} from "../../src/secrets/import-file"
import { ready } from "../helpers"

/** A value that must never appear in an error. */
const SENTINEL = "zk_SENTINEL_9f3a"

/** The entries of a text that fits, as `name=value` pairs. */
function read(text: string): [string, string][] {
  const parsed = parseImport(text)
  if (!("entries" in parsed)) throw new Error(`expected the text to fit, it stopped at line ${parsed.line} (${parsed.reason})`)
  return parsed.entries.map((entry) => [entry.name, entry.value])
}

/** The failure of a text that does not fit. */
function stops(text: string): ImportFailure {
  const parsed = parseImport(text)
  if ("entries" in parsed) throw new Error(`expected the text to stop, it gave ${parsed.entries.length} entries`)
  return parsed
}

/** The error a failure becomes holds nothing of the line: not in its message, its stack, or the failure itself. */
function holdsNoValue(failure: ImportFailure): void {
  const error = importError(".env", failure)
  expect(error).toBeInstanceOf(CliError)
  expect(error.message).not.toContain(SENTINEL)
  expect(error.stack ?? "").not.toContain(SENTINEL)
  expect(JSON.stringify(failure)).not.toContain(SENTINEL)
}

describe("the grammar, case by case (contracts/import.md, What each case means)", () => {
  test("lines that fit, and the value each gives", () => {
    const cases: [string, [string, string][]][] = [
      ["NAME=value", [["NAME", "value"]]],
      ["export NAME=value", [["NAME", "value"]]],
      ["export\tNAME=value", [["NAME", "value"]]],
      ["  NAME = value  ", [["NAME", "value"]]],
      ["\tNAME\t=\tvalue\t", [["NAME", "value"]]],
      ["NAME=two words", [["NAME", "two words"]]],
      ["NAME=", [["NAME", ""]]],
      ['NAME=""', [["NAME", ""]]],
      ["NAME=''", [["NAME", ""]]],
      [`NAME='a "b" $c #d'`, [["NAME", 'a "b" $c #d']]],
      [`NAME='a\\nb'`, [["NAME", "a\\nb"]]],
      ['NAME="a\\nb"', [["NAME", "a\nb"]]],
      ['NAME="\\\\ \\" \\n \\r \\t \\$"', [["NAME", '\\ " \n \r \t $']]],
      ["NAME=value # note", [["NAME", "value"]]],
      ["NAME=value\t# note", [["NAME", "value"]]],
      ['NAME="v" # note', [["NAME", "v"]]],
      ['NAME="v"# note', [["NAME", "v"]]],
      ["NAME='v'# note", [["NAME", "v"]]],
      ["NAME= # only a comment", [["NAME", ""]]],
      ["# a comment", []],
      ["   # an indented comment", []],
      ["", []],
      ["   \t ", []],
      ["export=1", [["export", "1"]]],
      ["export =1", [["export", "1"]]],
      ["a.b-c_D9=x", [["a.b-c_D9", "x"]]],
      ["NAME=ünïcødé ✓", [["NAME", "ünïcødé ✓"]]],
      ["NAME=a=b", [["NAME", "a=b"]]],
    ]
    for (const [text, entries] of cases) expect({ text, entries: read(text) }).toEqual({ text, entries })
  })

  test("lines that do not fit, and the reason each gets", () => {
    const cases: [string, ImportReason][] = [
      ["NAME=va#lue", "hash"],
      ["NAME=#x", "hash"],
      ["NAME =#x", "hash"],
      ["NAME=$OTHER", "dollar"],
      ["NAME=${OTHER}", "dollar"],
      ['NAME="a$b"', "dollar"],
      ['NAME="abc', "unclosed"],
      ["NAME='abc", "unclosed"],
      ['NAME="abc\\', "unclosed"],
      ['NAME="a\\qb"', "escape"],
      ['NAME="v" x', "after_quote"],
      ["NAME='v' x", "after_quote"],
      ["NAME='v''w'", "after_quote"],
      ["NAME=`cmd`", "not_entry"],
      ['NAME=a"b', "not_entry"],
      ["NAME=a'b", "not_entry"],
      ["NAME=a\\b", "not_entry"],
      // An unquoted value that begins with `=`: the last piece of a wrapped value, never a name and a value (security review S1).
      ["QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo1Ng==", "not_entry"],
      ["NAME==", "not_entry"],
      ["NAME==x", "not_entry"],
      ["NAME = =x", "not_entry"],
      ["NAME==$x", "not_entry"],
      ["NAME value", "not_entry"],
      ["=value", "not_entry"],
      ["my var=x", "not_entry"],
      ["{", "not_entry"],
      ["export", "not_entry"],
      ["export NAME", "not_entry"],
      ["NAME=a\u0000b", "control"],
      ["NAME=a\u001bb", "control"],
      ["NAME=a\u007fb", "control"],
      ["NAME=a\u0085b", "control"],
      ["NAME='a\u0007b'", "control"],
      ["\rNAME=x", "control"],
    ]
    for (const [text, reason] of cases) expect({ text, reason: stops(text).reason }).toEqual({ text, reason })
  })

  test("a tab is not a control character", () => {
    expect(read("NAME='a\tb'")).toEqual([["NAME", "a\tb"]])
  })

  test("the same key twice stops at the second line, naming both; letter case counts", () => {
    const text = ["A=1", "", "SAME=first", "# comment", "B=2", "C=3", "", "D=4", "SAME=second"].join("\n")
    expect(stops(text)).toEqual({ line: 9, reason: "twice", first: 3 })
    expect(importLineSentence(".env", { line: 9, reason: "twice", first: 3 })).toBe(".env, line 9: the same name as line 3. Nothing was stored.")
    expect(read("Foo=1\nFOO=2")).toEqual([
      ["Foo", "1"],
      ["FOO", "2"],
    ])
  })
})

describe("which sentence a line that does not fit gets (I2 to I9)", () => {
  /** One line for each step of the order, with the value on it, and the sentence it gets. */
  const cases: [string, ImportReason, string][] = [
    [`NAME=${SENTINEL}\u0007`, "control", "a control character."],
    [`${SENTINEL} is not a line`, "not_entry", "this is not a NAME=value line."],
    [`NAME='${SENTINEL}`, "unclosed", "a quoted value does not end on this line. Write a line break as \\n inside double quotes."],
    [`NAME='${SENTINEL}' tail`, "after_quote", "there is text after the closing quote."],
    [`NAME="${SENTINEL}\\q"`, "escape", 'an escape zekno does not read. Inside double quotes only \\\\ \\" \\n \\r \\t and \\$ are read.'],
    [`NAME="${SENTINEL}$X"`, "dollar", "a $ that zekno would not expand. Put the value in single quotes to keep it as it is."],
    [`NAME="${SENTINEL}`, "unclosed", "a quoted value does not end on this line. Write a line break as \\n inside double quotes."],
    [`NAME="${SENTINEL}" tail`, "after_quote", "there is text after the closing quote."],
    [`NAME=${SENTINEL}$X`, "dollar", "a $ that zekno would not expand. Put the value in single quotes to keep it as it is."],
    [`NAME=${SENTINEL}#x`, "hash", "a # inside a value. Quote the value to keep it, or put a space before # to start a comment."],
    [`NAME=${SENTINEL}"x`, "not_entry", "this is not a NAME=value line."],
    [`${SENTINEL}==`, "not_entry", "this is not a NAME=value line."],
  ]

  test("each step of the order, on line 4 after a blank line, a comment and an entry, in an LF file and a CRLF file", () => {
    for (const eol of ["\n", "\r\n"]) {
      for (const [line, reason, said] of cases) {
        const failure = stops(["", "# the values of this project", `GOOD=${SENTINEL}`, line, "LATER=1"].join(eol))
        expect({ line, failure }).toEqual({ line, failure: { line: 4, reason } })
        expect(importLineSentence(".env", failure)).toBe(`.env, line 4: ${said} Nothing was stored.`)
        holdsNoValue(failure)
      }
    }
  })

  test("the first of the steps that applies decides, and the first line that does not fit stops the reading", () => {
    // A control character comes first, whatever else is on the line.
    expect(stops(`NAME=$${SENTINEL}#\u0001`).reason).toBe("control")
    // A double-quoted value is read one character at a time: what is met first decides.
    expect(stops('NAME="$\\q"').reason).toBe("dollar")
    expect(stops('NAME="\\q$"').reason).toBe("escape")
    // An unquoted value too.
    expect(stops("NAME=a#b$c").reason).toBe("hash")
    expect(stops("NAME=a$b#c").reason).toBe("dollar")
    // The same key below a wrong line: the wrong line is named.
    expect(stops(`A=1\nB=x#y\nA=${SENTINEL}`)).toEqual({ line: 2, reason: "hash" })
    const twice = stops(`A=1\nA=${SENTINEL}`)
    expect(twice).toEqual({ line: 2, reason: "twice", first: 1 })
    holdsNoValue(twice)
  })

  test("a last line without a line feed counts; a CR not before a line feed is a control character", () => {
    expect(read("A=1\nB=2")).toEqual([
      ["A", "1"],
      ["B", "2"],
    ])
    expect(read("A=1\r\nB=2\r\n")).toEqual([
      ["A", "1"],
      ["B", "2"],
    ])
    expect(stops("A=1\r\nB=2\r")).toEqual({ line: 2, reason: "control" })
    expect(stops("A=1\rB=2")).toEqual({ line: 1, reason: "control" })
  })

  test("a byte order mark at the very start is dropped", () => {
    expect(read("﻿NAME=value\n")).toEqual([["NAME", "value"]])
    expect(parseImport("﻿A=1\nB=2")).toEqual({
      entries: [
        { line: 1, name: "A", value: "1" },
        { line: 2, name: "B", value: "2" },
      ],
    })
  })

  test("entries keep their line numbers and the file's order", () => {
    expect(parseImport("# top\n\nB=2\n  A = 1 # one\nexport C='3'\n")).toEqual({
      entries: [
        { line: 3, name: "B", value: "2" },
        { line: 4, name: "A", value: "1" },
        { line: 5, name: "C", value: "3" },
      ],
    })
  })
})

describe("reading the file (contracts/import.md, Reading the file)", () => {
  const folder = tempDir("import")
  const at = (name: string, content?: string | Uint8Array) => {
    const path = join(folder, name)
    if (content !== undefined) writeFileSync(path, content)
    return path
  }
  const refused = (path: string): string => {
    try {
      readImportFile(path, "shown")
    } catch (error) {
      expect(error).toBeInstanceOf(CliError)
      expect((error as Error).message).not.toContain(SENTINEL)
      expect((error as Error).stack ?? "").not.toContain(SENTINEL)
      return (error as Error).message
    }
    throw new Error(`${path} was read`)
  }

  test("a good file is read once and given back as text, without a byte order mark", () => {
    expect(readImportFile(at("good.env", "A=1\n"), "good.env")).toBe("A=1\n")
    expect(readImportFile(at("bom.env", "﻿A=1\n"), "bom.env")).toBe("A=1\n")
    expect(readImportFile(at("limit.env", "#".repeat(IMPORT_FILE_LIMIT)), "limit.env").length).toBe(IMPORT_FILE_LIMIT)
  })

  test("a missing path is I19; a folder and a named pipe are I20, the pipe at once", async () => {
    expect(refused(join(folder, "missing.env"))).toBe("No file at shown.")
    const dir = join(folder, "a-folder")
    mkdirSync(dir)
    expect(refused(dir)).toBe("shown is not a file.")
    const pipe = join(folder, "a-pipe")
    expect(Bun.spawnSync(["mkfifo", pipe]).exitCode).toBe(0)
    const started = Date.now()
    expect(refused(pipe)).toBe("shown is not a file.")
    expect(Date.now() - started).toBeLessThan(2000)
  }, 5000)

  test("a file over 1 MiB is I21, a sparse one too; one that is not UTF-8 is I22, with the value in it", () => {
    const big = at("big.env", "")
    truncateSync(big, 2 * 1024 * 1024)
    expect(refused(big)).toBe("shown is larger than the 1 MiB an import file may be. Nothing was stored.")
    expect(refused(at("over.env", "#".repeat(IMPORT_FILE_LIMIT + 1)))).toBe("shown is larger than the 1 MiB an import file may be. Nothing was stored.")
    const bytes = new Uint8Array([...new TextEncoder().encode(`A=${SENTINEL}`), 0xff, 0x0a])
    expect(refused(at("binary.env", bytes))).toBe("shown is not UTF-8 text. Nothing was stored.")
  })

  test("a symbolic link to a good file is followed, as `-f` follows one", () => {
    const target = at("target.env", "LINKED=yes\n")
    const link = join(folder, "link.env")
    symlinkSync(target, link)
    expect(readImportFile(link, "link.env")).toBe("LINKED=yes\n")
    const dangling = join(folder, "dangling.env")
    symlinkSync(join(folder, "nothing-here"), dangling)
    expect(refused(dangling)).toBe("No file at shown.")
  })

  test("the folder's own zekno.json is not a file of values: line 1 is named", async () => {
    const m = await ready()
    expect(await m.zekno("link", "--app", "web", "--server", "dev")).toBe(0)
    const failure = stops(readImportFile(join(m.project, "zekno.json"), "zekno.json"))
    expect(failure).toEqual({ line: 1, reason: "not_entry" })
    expect(importLineSentence("zekno.json", failure)).toBe("zekno.json, line 1: this is not a NAME=value line. Nothing was stored.")
  }, 30_000)
})
