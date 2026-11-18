/**
 * The stored screens' reader (specs/013-docs-refresh, contracts/screens.md,
 * "The stored file" and "The tests"): a sound file is read as it is, and a
 * file that breaks the format, a row wider than the screen, a full-screen
 * capture without exactly its rows, an unknown look or a missing description
 * is refused with the screen's name. Every file is written to a temporary
 * folder, never to `content/screens`.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  cellsOf,
  isLook,
  readScreen,
  screensFolder,
  storedScreenNames,
} from "./screens"

/** A command's output, as the contract's example draws one. */
function commandScreen(): Record<string, unknown> {
  return {
    name: "add-postgres",
    title: "Adding PostgreSQL",
    command: "zekno add postgres",
    columns: 100,
    rows: null,
    alt: "The output of zekno add postgres: the service it added and its port.",
    fixed: [],
    lines: [
      [["dim", "$ zekno add postgres"]],
      [
        ["green", "✔"],
        ["", " "],
        ["dim", "Read by"],
        ["", "  web"],
      ],
      [],
      [
        ["bold", "PostgreSQL 18.7"],
        ["dim", "  A relational database."],
      ],
    ],
  }
}

/** A screen of the full-screen app, 80 by 3. */
function appScreen(): Record<string, unknown> {
  return {
    name: "home",
    title: "The app: Home",
    command: "zekno",
    columns: 80,
    rows: 3,
    alt: "The full-screen app with one server, prod-1.",
    fixed: [{ what: "how long ago the deploy was", shown: "2 minutes ago" }],
    lines: [
      [
        ["", "  "],
        ["bold", "zekno"],
        ["dim", "  pre-alpha"],
      ],
      [],
      [
        ["brand,bold", "❯"],
        ["", " prod-1"],
      ],
    ],
  }
}

/** A new temporary folder holding the given screens, each written as `<name>.json` with a newline at the end. */
function folderWith(...screens: Record<string, unknown>[]): string {
  const folder = mkdtempSync(join(tmpdir(), "zekno-web-screens-"))
  for (const screen of screens)
    writeFileSync(
      join(folder, `${String(screen.name)}.json`),
      `${JSON.stringify(screen, null, 2)}\n`
    )
  return folder
}

/** The message `readScreen` throws for `screen`, stored under its own name unless `file` is given. */
function refusal(screen: Record<string, unknown>, file?: string): string {
  const folder = mkdtempSync(join(tmpdir(), "zekno-web-screens-"))
  const name = file ?? String(screen.name)
  writeFileSync(join(folder, `${name}.json`), `${JSON.stringify(screen)}\n`)
  try {
    readScreen(name, folder)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error(`${name} was read, but it should have been refused`)
}

describe("the stored screens (contracts/screens.md)", () => {
  test("a command's output and a screen of the app are read as they are stored", () => {
    const folder = folderWith(commandScreen(), appScreen())
    expect(readScreen("add-postgres", folder)).toEqual(commandScreen() as never)
    expect(readScreen("home", folder)).toEqual(appScreen() as never)
    expect(storedScreenNames(folder)).toEqual(["add-postgres", "home"])
  })

  test("by default, from content/screens in the site's folder", () => {
    expect(screensFolder()).toBe(join(process.cwd(), "content/screens"))
  })

  test("a name with no file is refused with the name", () => {
    const folder = folderWith()
    expect(() => readScreen("status", folder)).toThrow('"status"')
    expect(() => readScreen("../secret", folder)).toThrow("not a screen's name")
  })

  test("a file that is not JSON, or does not end with a newline, is refused with the name", () => {
    const folder = folderWith()
    writeFileSync(join(folder, "broken.json"), "{ not json\n")
    expect(() => readScreen("broken", folder)).toThrow('"broken"')
    writeFileSync(
      join(folder, "home.json"),
      JSON.stringify(appScreen()) // no newline at the end
    )
    expect(() => readScreen("home", folder)).toThrow("newline")
  })

  test("each field is held to its rule", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...appScreen(), name: "Home" }, "lower-case"],
      [{ ...appScreen(), name: "other" }, "not the file's name"],
      [{ ...appScreen(), title: "" }, "title is missing"],
      [{ ...appScreen(), command: undefined }, "command is missing"],
      [{ ...appScreen(), alt: "  " }, "alt is missing"],
      [{ ...appScreen(), columns: 120 }, "columns is not 100 or 80"],
      [{ ...appScreen(), rows: 0 }, "rows is not"],
      [{ ...appScreen(), rows: "30" }, "rows is not"],
      [{ ...appScreen(), fixed: undefined }, "fixed is not a list"],
      [{ ...appScreen(), fixed: [{ what: "a time" }] }, "fixed entry 1"],
      [
        { ...appScreen(), fixed: [{ what: "a", shown: "b", more: "c" }] },
        "fixed entry 1",
      ],
      [{ ...appScreen(), lines: "text" }, "lines is not a list"],
      [
        { ...appScreen(), colour: "blue" },
        "fields the format does not: colour",
      ],
    ]
    for (const [screen, reason] of cases) {
      const message = refusal(screen, "home")
      expect(message).toContain('"home"')
      expect(message).toContain(reason)
    }
  })

  test("a run is [look, text] with a known look, and holds no control character", () => {
    const withRow = (row: unknown) => {
      const screen = appScreen()
      ;(screen.lines as unknown[])[1] = row
      return screen
    }
    expect(refusal(withRow([["bold"]]))).toContain(
      "row 2 has a run that is not"
    )
    expect(refusal(withRow("text"))).toContain("row 2 is not a list of runs")
    expect(refusal(withRow([["blue", "x"]]))).toContain('unknown look "blue"')
    expect(refusal(withRow([["bold,bold", "x"]]))).toContain("unknown look")
    expect(refusal(withRow([["bold,", "x"]]))).toContain("unknown look")
    expect(refusal(withRow([["", "\u001b[1mx"]]))).toContain(
      "control character"
    )
    expect(refusal(withRow([["", "a\tb"]]))).toContain("control character")
  })

  test("a row is no longer than the screen is wide, and has no trailing spaces", () => {
    const screen = appScreen()
    ;(screen.lines as unknown[])[1] = [["", "x".repeat(80)]]
    expect(() => readScreen("home", folderWith(screen))).not.toThrow()
    ;(screen.lines as unknown[])[1] = [
      ["dim", "x".repeat(40)],
      ["", "y".repeat(41)],
    ]
    expect(refusal(screen)).toContain("row 2 is 81 cells wide, more than 80")
    ;(screen.lines as unknown[])[1] = [
      ["", "x"],
      ["dim", "  "],
    ]
    expect(refusal(screen)).toContain("row 2 ends with spaces")
  })

  test("a screen of the app has exactly its rows; a command's output starts with its prompt", () => {
    const short = appScreen()
    short.lines = (short.lines as unknown[]).slice(0, 2)
    expect(refusal(short)).toContain("it has 2 rows, not the 3")
    const long = appScreen()
    long.lines = [...(long.lines as unknown[]), []]
    expect(refusal(long)).toContain("it has 4 rows, not the 3")
    const output = commandScreen()
    ;(output.lines as unknown[])[0] = [["dim", "$ zekno deploy"]]
    expect(refusal(output)).toContain('is not "$ zekno add postgres"')
  })

  test("looks and cells", () => {
    expect(isLook("")).toBe(true)
    expect(isLook("brand,bold")).toBe(true)
    expect(isLook("dim,green")).toBe(true)
    expect(isLook("italic")).toBe(false)
    expect(cellsOf("╭──╮ ✔ ● ❯")).toBe(10)
    expect(cellsOf("日本")).toBe(4)
    expect(cellsOf("e\u0301")).toBe(1)
  })
})
