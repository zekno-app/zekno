/**
 * A one-row list whose rows have a middle column (specs/012-templates,
 * contracts/commands.md, "`zekno add` with no template"; board `AddLook`,
 * left column; plan.md, D12; tasks T032): the picker of `zekno add`. Beside
 * the list's own tests (questions.test.tsx), which show a row without the
 * column draws as it did.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { Left } from "../../../src/cli/errors"
import { AL1, AL2 } from "../../../src/templates/add-words"
import { catalogue } from "../../../src/templates/catalogue"
import { templateRows } from "../../../src/templates/shown"
import { plainUi } from "../../../src/ui/plain/plain"
import { BRAND } from "../../../src/ui/terminal/theme"
import type { ListRow } from "../../../src/ui/types"
import { drawnInColour, plainOf, wordRuns } from "../../support/colour"
import { KEYS, shows, terminal } from "../../support/terminal"

const QUESTIONS = join(import.meta.dir, "../../../src/ui/ink/questions.tsx")

/** The picker's rows: the name, `<title> <software>`, the about without its full stop. */
const ROWS: ListRow<string>[] = templateRows(catalogue()).map((row) => ({
  value: row.name,
  label: row.name,
  column: `${row.title} ${row.software}`,
  detail: row.about,
}))

const missing = new Error("AU1, the sentence the command has with no terminal")
const picker = { question: AL1, rows: ROWS, collapsed: AL2, missing }

/** The board's picker, in today's list: the marker at column 2, each column padded to its longest plus two. */
const BOARD = [
  "? Add which template?",
  "  ❯ postgres  PostgreSQL 18.7  A relational database",
  "    mysql     MySQL 9.7        A relational database",
  "    mongodb   MongoDB 9.0      A document database",
  "    redis     Redis 8.10       A cache and key-value store",
  "  ↑↓ move   enter choose   esc leave",
]

describe("a list with a middle column (board `AddLook`, the picker)", () => {
  test("the board's lines; ↓ moves; Enter chooses and leaves ✔ Template  <name> (D12)", async () => {
    const t = terminal()
    const chosen = t.ui.choose(picker)
    await shows(t, "? Add which template?")
    expect(t.lines()).toEqual(BOARD)
    t.keys(KEYS.down)
    await shows(t, "  ❯ mysql     MySQL 9.7        A relational database")
    expect(t.lines()).toContain(
      "    postgres  PostgreSQL 18.7  A relational database"
    )
    t.keys(KEYS.up)
    await shows(t, BOARD[1]!)
    t.keys(KEYS.enter)
    expect(await chosen).toBe("postgres")
    await shows(t, "✔ Template  postgres")
    expect(t.lines()).toEqual(["✔ Template  postgres"])
    await t.ui.close()
  })

  test("Esc and Ctrl-C leave: Left, the question's line stays", async () => {
    for (const key of [KEYS.esc, KEYS.ctrlC]) {
      const t = terminal()
      const chosen = t.ui.choose(picker)
      await shows(t, "? Add which template?")
      t.keys(key)
      expect(chosen).rejects.toBeInstanceOf(Left)
      await chosen.catch(() => {})
      await Bun.sleep(60)
      expect(t.lines()).toEqual(["? Add which template?"])
      await t.ui.close()
    }
  })

  test("the plain interface never asks: it throws what it was given", async () => {
    const ui = plainUi(
      () => {},
      () => {}
    )
    expect(ui.choose(picker)).rejects.toBe(missing)
  })
})

describe("its looks (board `AddLook`: the name bold when selected and in the text colour otherwise, the middle column in the text colour, the about dim)", () => {
  const drawn = (rows: readonly ListRow<string>[], selected = 0) =>
    drawnInColour(QUESTIONS, "ListView", {
      question: AL1,
      rows,
      selected,
      columns: 100,
      height: 30,
    }).split("\n")

  test("the selected row and another", () => {
    const lines = drawn(ROWS)
    expect(lines.map(plainOf).map((line) => line.trimEnd())).toEqual(BOARD)
    expect(wordRuns(lines[1]!)).toEqual([
      { text: "❯", bold: false, dim: false, color: BRAND },
      { text: "postgres", bold: true, dim: false },
      { text: "PostgreSQL 18.7", bold: false, dim: false },
      { text: "A relational database", bold: false, dim: true },
    ])
    // The name and the middle column are both in the text colour: one run.
    expect(wordRuns(lines[4]!)).toEqual([
      { text: "redis     Redis 8.10", bold: false, dim: false },
      { text: "A cache and key-value store", bold: false, dim: true },
    ])
  })

  test("rows without the column draw as today: the label column max(11, longest + 2), the detail dim", () => {
    const lines = drawn([
      { value: "prod", label: "prod", detail: "deploy@203.0.113.7" },
      { value: "staging", label: "staging", detail: "this machine" },
      { value: "new", label: "+ a new app" },
    ])
    expect(lines.map(plainOf).map((line) => line.trimEnd())).toEqual([
      "? Add which template?",
      "  ❯ prod       deploy@203.0.113.7",
      "    staging    this machine",
      "    + a new app",
      "  ↑↓ move   enter choose   esc leave",
    ])
    expect(wordRuns(lines[2]!)).toEqual([
      { text: "staging", bold: false, dim: false },
      { text: "this machine", bold: false, dim: true },
    ])
    expect(wordRuns(lines[3]!)).toEqual([
      { text: "+ a new app", bold: false, dim: true },
    ])
  })
})
