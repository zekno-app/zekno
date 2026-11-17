/**
 * A list to pick several rows from (specs/012-templates, contracts/commands.md,
 * "Who reads the connection secret"; board `AddTemplate`, right column; plan.md,
 * D13; tasks T020): the question, a row per service with its mark, the keys;
 * it opens with the first row picked, space picks and unpicks, Enter with
 * none picked says AD11 and stays open, Esc and Ctrl-C leave, and a long list
 * keeps the selected row in view.
 */
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { Left } from "../../../src/cli/errors"
import { AD10, AD11 } from "../../../src/templates/add-words"
import { BRAND } from "../../../src/ui/terminal/theme"
import { plainUi } from "../../../src/ui/plain/plain"
import type { ListRow } from "../../../src/ui/types"
import { drawnInColour, plainOf, wordRuns } from "../../support/colour"
import { KEYS, shows, terminal, until } from "../../support/terminal"

const SEVERAL = join(import.meta.dir, "../../../src/ui/ink/several.tsx")

/** A moment for Ink to draw, when a key is expected to change nothing. */
const settle = () => Bun.sleep(60)

const missing = new Error("AD12, the sentence the command has with no terminal")
const rowsOf = (...names: string[]): ListRow<string>[] =>
  names.map((name) => ({ value: name, label: name }))
const whoReads = (rows = rowsOf("web", "worker")) => ({
  question: AD10("DATABASE_URL"),
  rows,
  collapsed: "Read by",
  atLeastOne: AD11,
  missing,
})

const BOARD = [
  "? Which services read DATABASE_URL?",
  "  ❯ ◉ web",
  "    ◯ worker",
  "  ↑↓ move   space pick   enter done   esc leave",
]

describe("a list to pick several from (board `AddTemplate`, right column)", () => {
  test("the board's four lines; it opens with the first row picked; Enter gives the picked values and leaves ✔ Read by  web", async () => {
    const t = terminal()
    const picked = t.ui.chooseSeveral(whoReads())
    await shows(t, "? Which services read DATABASE_URL?")
    expect(t.lines()).toEqual(BOARD)
    t.keys(KEYS.enter)
    expect(await picked).toEqual(["web"])
    await shows(t, "✔ Read by  web")
    expect(t.lines()).toEqual(["✔ Read by  web"])
    await t.ui.close()
  })

  test("space picks and unpicks the selected row; ↑ and ↓ stop at the ends; the values come in the rows' order", async () => {
    const t = terminal()
    const picked = t.ui.chooseSeveral(whoReads(rowsOf("web", "worker", "cron")))
    await shows(t, "  ❯ ◉ web")
    t.keys(" ")
    await shows(t, "  ❯ ◯ web")
    t.keys(" ")
    await shows(t, "  ❯ ◉ web")
    t.keys(KEYS.up)
    await settle()
    expect(t.lines()).toContain("  ❯ ◉ web")
    t.keys(KEYS.down)
    await shows(t, "  ❯ ◯ worker")
    expect(t.lines()).toContain("    ◉ web")
    t.keys(KEYS.down)
    await shows(t, "  ❯ ◯ cron")
    t.keys(KEYS.down)
    await settle()
    expect(t.lines()).toContain("  ❯ ◯ cron")
    t.keys(" ")
    await shows(t, "  ❯ ◉ cron")
    t.keys(KEYS.up)
    await shows(t, "  ❯ ◯ worker")
    t.keys(" ")
    await shows(t, "  ❯ ◉ worker")
    t.keys(KEYS.enter)
    expect(await picked).toEqual(["web", "worker", "cron"])
    await shows(t, "✔ Read by  web, worker, cron")
    await t.ui.close()
  })

  test("no other key picks or answers it", async () => {
    const t = terminal()
    const picked = t.ui.chooseSeveral(whoReads())
    await shows(t, "  ❯ ◉ web")
    for (const key of ["y", "n", "q", "\t", "\x1b[C", "\x1b[D", "2", "\x7f"]) {
      t.keys(key)
      await Bun.sleep(30)
    }
    expect(t.lines()).toEqual(BOARD)
    t.keys(KEYS.enter)
    expect(await picked).toEqual(["web"])
    await t.ui.close()
  })

  test("Enter with none picked: AD11 under the rows, and it stays open until one is picked", async () => {
    const t = terminal()
    const picked = t.ui.chooseSeveral(whoReads())
    await shows(t, "  ❯ ◉ web")
    t.keys(" ")
    await shows(t, "  ❯ ◯ web")
    t.keys(KEYS.enter)
    await shows(t, `  ${AD11}`)
    expect(t.lines()).toEqual([
      "? Which services read DATABASE_URL?",
      "  ❯ ◯ web",
      "    ◯ worker",
      `  ${AD11}`,
      "  ↑↓ move   space pick   enter done   esc leave",
    ])
    t.keys(KEYS.down)
    t.keys(" ")
    await shows(t, "  ❯ ◉ worker")
    t.keys(KEYS.enter)
    expect(await picked).toEqual(["worker"])
    await shows(t, "✔ Read by  worker")
    expect(t.lines()).toEqual(["✔ Read by  worker"])
    await t.ui.close()
  })

  test("Esc and Ctrl-C leave: Left, and the question's line stays as it was drawn", async () => {
    for (const key of [KEYS.esc, KEYS.ctrlC]) {
      const t = terminal()
      const picked = t.ui.chooseSeveral(whoReads())
      await shows(t, "  ❯ ◉ web")
      t.keys(key)
      expect(picked).rejects.toBeInstanceOf(Left)
      await picked.catch(() => {})
      await settle()
      expect(t.lines()).toEqual(["? Which services read DATABASE_URL?"])
      await t.ui.close()
    }
  })

  test("forty services in a window of 24 rows: the selected row stays in view, with ↑ <n> more and ↓ <n> more; every line fits", async () => {
    const t = terminal(100, 24)
    const names = Array.from({ length: 40 }, (_, index) => `svc-${index + 1}`)
    const picked = t.ui.chooseSeveral(whoReads(rowsOf(...names)))
    await shows(t, "  ❯ ◉ svc-1")
    const isRow = (line: string) => /^ {2}(❯| ) (◉|◯) svc-\d+$/.test(line)
    const top = t.lines()
    const below = top.find((line) => /^ {2}↓ \d+ more$/.test(line))
    expect(below).toBeDefined()
    expect(top.filter(isRow).length + Number(/\d+/.exec(below!)![0])).toBe(40)
    expect(top.some((line) => /^ {2}↑ \d+ more$/.test(line))).toBe(false)
    expect(top.length).toBeLessThanOrEqual(24)
    t.keys(KEYS.down.repeat(20))
    await shows(t, "  ❯ ◯ svc-21")
    const middle = t.lines()
    expect(middle.some((line) => /^ {2}↑ \d+ more$/.test(line))).toBe(true)
    expect(middle.some((line) => /^ {2}↓ \d+ more$/.test(line))).toBe(true)
    t.keys(" ")
    t.keys(KEYS.down.repeat(30))
    await shows(t, "  ❯ ◯ svc-40")
    const end = t.lines()
    expect(end.some((line) => /^ {2}↓ \d+ more$/.test(line))).toBe(false)
    for (const line of [...top, ...middle, ...end])
      expect([...line].length).toBeLessThanOrEqual(100)
    t.keys(KEYS.enter)
    expect(await picked).toEqual(["svc-1", "svc-21"])
    await t.ui.close()
  })

  test("the plain interface never asks: it throws what it was given", async () => {
    const ui = plainUi(
      () => {},
      () => {}
    )
    expect(ui.chooseSeveral(whoReads())).rejects.toBe(missing)
  })
})

describe("its looks (board `AddTemplate`: ? and ❯ brand, ◉ green, ◯ dim, the selected name bold, keys in the text colour and their words dim, AD11 in the warning colour)", () => {
  const drawn = (props: Record<string, unknown>) =>
    drawnInColour(SEVERAL, "SeveralView", {
      question: AD10("DATABASE_URL"),
      labels: ["web", "worker"],
      columns: 100,
      height: 30,
      ...props,
    }).split("\n")
  const line = (lines: string[], start: string) =>
    lines.find((each) => plainOf(each).startsWith(start))!

  test("as it opens", () => {
    const lines = drawn({ picked: [true, false], selected: 0 })
    expect(lines.map(plainOf).map((each) => each.trimEnd())).toEqual(BOARD)
    expect(wordRuns(line(lines, "?"))).toEqual([
      { text: "?", bold: false, dim: false, color: BRAND },
      {
        text: "Which services read DATABASE_URL?",
        bold: true,
        dim: false,
      },
    ])
    expect(wordRuns(line(lines, "  ❯"))).toEqual([
      { text: "❯", bold: false, dim: false, color: BRAND },
      { text: "◉", bold: false, dim: false, color: "green" },
      { text: "web", bold: true, dim: false },
    ])
    expect(wordRuns(line(lines, "    ◯"))).toEqual([
      { text: "◯", bold: false, dim: true },
      { text: "worker", bold: false, dim: false },
    ])
    expect(wordRuns(line(lines, "  ↑↓"))).toEqual([
      { text: "↑↓", bold: false, dim: false },
      { text: "move", bold: false, dim: true },
      { text: "space", bold: false, dim: false },
      { text: "pick", bold: false, dim: true },
      { text: "enter", bold: false, dim: false },
      { text: "done", bold: false, dim: true },
      { text: "esc", bold: false, dim: false },
      { text: "leave", bold: false, dim: true },
    ])
  })

  test("the second row selected and picked, the first not; AD11 under the rows", () => {
    const lines = drawn({
      picked: [false, true],
      selected: 1,
      reason: AD11,
    })
    expect(wordRuns(line(lines, "    ◯"))).toEqual([
      { text: "◯", bold: false, dim: true },
      { text: "web", bold: false, dim: false },
    ])
    expect(wordRuns(line(lines, "  ❯"))).toEqual([
      { text: "❯", bold: false, dim: false, color: BRAND },
      { text: "◉", bold: false, dim: false, color: "green" },
      { text: "worker", bold: true, dim: false },
    ])
    expect(wordRuns(line(lines, `  ${AD11}`))).toEqual([
      { text: AD11, bold: false, dim: false, color: "yellow" },
    ])
  })
})

describe("one question after another", () => {
  test("each starts afresh, the first row picked", async () => {
    const t = terminal()
    const first = t.ui.chooseSeveral(whoReads())
    await shows(t, "  ❯ ◉ web")
    t.keys(KEYS.down)
    t.keys(" ")
    await shows(t, "  ❯ ◉ worker")
    t.keys(KEYS.enter)
    expect(await first).toEqual(["web", "worker"])
    const second = t.ui.chooseSeveral({
      ...whoReads(),
      question: AD10("REDIS_URL"),
    })
    await until(
      () => t.lines().includes("? Which services read REDIS_URL?"),
      "the second question"
    )
    expect(t.lines().slice(-3)).toEqual([
      "  ❯ ◉ web",
      "    ◯ worker",
      "  ↑↓ move   space pick   enter done   esc leave",
    ])
    t.keys(KEYS.enter)
    expect(await second).toEqual(["web"])
    await t.ui.close()
  })
})
