/**
 * The stored form of a screen (specs/013-docs-refresh, contracts/screens.md,
 * "The stored file"; tasks T003): a terminal's text read back as rows of
 * runs with the six looks, a colour outside them refused by name, trailing
 * spaces removed, and the file written one row per line.
 */
import { describe, expect, test } from "bun:test"

import {
  checkScreen,
  readScreen,
  rowsOf,
  storedText,
  textOf,
  tidy,
  type Screen,
} from "./format"

const ESC = "\x1b["
const sgr = (...codes: number[]) => `${ESC}${codes.join(";")}m`
const RESET = sgr(0)
const BRAND = sgr(38, 2, 35, 131, 226)

/** A screen of the app with `lines`, 100 by `rows`. */
const screen = (lines: Screen["lines"], rows: number | null = 2): Screen => ({
  name: "home",
  title: "The app: Home",
  command: "zekno",
  columns: 100,
  rows,
  alt: "Home, with one server.",
  fixed: [{ what: "how long ago the deploy was", shown: "2 min ago" }],
  lines,
})

describe("a terminal's text as rows of runs", () => {
  test("the six looks, named in one order, joined with commas", () => {
    const text = [
      `${sgr(1)}zekno${RESET}  ${sgr(2)}pre-alpha${RESET}`,
      `${BRAND}${sgr(1)}❯${RESET} ${sgr(32)}● running${sgr(39)} ${sgr(33)}!${RESET} ${sgr(31)}✖${RESET}`,
      `${sgr(1)}${sgr(2)}Servers${sgr(22)} plain`,
    ].join("\n")
    expect(rowsOf(text)).toEqual([
      [
        ["bold", "zekno"],
        ["", "  "],
        ["dim", "pre-alpha"],
      ],
      [
        ["bold,brand", "❯"],
        ["", " "],
        ["green", "● running"],
        ["", " "],
        ["yellow", "!"],
        ["", " "],
        ["red", "✖"],
      ],
      [
        ["bold,dim", "Servers"],
        ["", " plain"],
      ],
    ])
  })

  test("trailing spaces are removed whatever their look; empty rows are kept as empty rows", () => {
    expect(rowsOf(`a  ${sgr(2)}   ${RESET}  \n\n  b  `)).toEqual([
      [["", "a"]],
      [],
      [["", "  b"]],
    ])
  })

  test("as Ink writes a command at a terminal: a line erased, the cursor moved up and back, and drawn again", () => {
    const raw = `${sgr(36)}⠋${RESET} Connecting\n${ESC}1A${ESC}2K${ESC}G${sgr(32)}✔${RESET} Connected\nnext`
    expect(rowsOf(raw)).toEqual([
      [
        ["green", "✔"],
        ["", " Connected"],
      ],
      [["", "next"]],
    ])
  })

  test("a colour outside the list fails with its name, when it is on the screen at the end", () => {
    expect(() => rowsOf(`${sgr(36)}⠋${RESET} waiting`)).toThrow("cyan")
    expect(() => rowsOf(`${sgr(38, 2, 26, 115, 209)}❯${RESET}`)).toThrow(
      "#1a73d1"
    )
    expect(() => rowsOf(`${sgr(95)}x`)).toThrow("bright magenta")
  })

  test("another look fails with its name when it stays; a cursor drawn in reverse and drawn over is no look of the screen", () => {
    expect(() => rowsOf(`name ${sgr(7)} ${sgr(27)}`)).not.toThrow()
    expect(() => rowsOf(`name ${sgr(7)}x${sgr(27)}`)).toThrow("reverse")
    expect(() => rowsOf(`${sgr(4)}link${RESET}`)).toThrow("underline")
    expect(rowsOf(`a${sgr(7)}_${sgr(27)}\r${ESC}2Kab`)).toEqual([[["", "ab"]]])
  })

  test("tidy joins neighbours of one look and removes trailing spaces", () => {
    expect(
      tidy([
        ["dim", "a"],
        ["dim", "b"],
        ["", "c  "],
        ["dim", "  "],
      ])
    ).toEqual([
      ["dim", "ab"],
      ["", "c"],
    ])
    expect(
      textOf([
        ["dim", "ab"],
        ["", "c"],
      ])
    ).toBe("abc")
  })
})

describe("the stored file", () => {
  test("one field per line, one row of the screen per line, a newline at the end", () => {
    const text = storedText(screen([[["bold", "zekno"]], []]))
    expect(text).toBe(
      [
        "{",
        '  "name": "home",',
        '  "title": "The app: Home",',
        '  "command": "zekno",',
        '  "columns": 100,',
        '  "rows": 2,',
        '  "alt": "Home, with one server.",',
        '  "fixed": [',
        '    {"what":"how long ago the deploy was","shown":"2 min ago"}',
        "  ],",
        '  "lines": [',
        '    [["bold","zekno"]],',
        "    []",
        "  ]",
        "}",
        "",
      ].join("\n")
    )
    expect(readScreen(text)).toEqual(screen([[["bold", "zekno"]], []]))
    expect(storedText(readScreen(text))).toBe(text)
  })

  test("nothing replaced is an empty list; a command's output has no rows", () => {
    const text = storedText({
      ...screen([[["dim", "$ zekno status"]]], null),
      fixed: [],
    })
    expect(text).toContain('  "rows": null,\n')
    expect(text).toContain('  "fixed": [],\n')
  })

  test("a screen that breaks the contract is refused with its name", () => {
    expect(() => checkScreen(screen([[["", "x".repeat(101)]], []]))).toThrow(
      "Screen home: row 1 is 101 cells wide"
    )
    expect(() => checkScreen(screen([[]], 30))).toThrow(
      "Screen home: 1 rows, where the terminal has 30"
    )
    expect(() => checkScreen(screen([[["cyan", "x"]], []]))).toThrow(
      "the look cyan"
    )
    expect(() => checkScreen({ ...screen([[], []]), alt: " " })).toThrow(
      "no description"
    )
    expect(() => checkScreen({ ...screen([[], []]), name: "Home" })).toThrow(
      "a bad name"
    )
  })
})
