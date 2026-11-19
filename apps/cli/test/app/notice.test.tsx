/**
 * The app's notice line (src/app/notice.tsx): the line above the key hints,
 * the result of a deploy on its screen, and why the logs stopped. An error
 * is drawn as at a terminal and on every approved board: `✖`, its first
 * sentence in bold, the rest dim below and in line with it, commands without
 * their backticks. Whatever the tone, the words go on under the words, so no
 * row starts with the space it broke at; and `noticeRows` says the rows the
 * line is drawn in, which is what Home, the settings screen, the logs and
 * the deploy screen take from the rows they give the rest.
 *
 * Before this, the app drew a notice as one text and left the breaking to
 * Ink (specs/014-deploy-v2, plan.md, "As built": a long error kept its
 * backticks, had no bold first sentence, and a row could start one space in).
 */
import { describe, expect, test } from "bun:test"
import { Box, renderToString } from "ink"
import { join } from "node:path"

import { NoticeLine, noticeRows } from "../../src/app/notice"
import type { AppEvent } from "../../src/app/state/events"
import { initialState, update } from "../../src/app/state/state"
import type { State, TeamView } from "../../src/app/state/types"
import { C1, C4, C6 } from "../../src/shared/deploy-words"
import type { Notice } from "../../src/shared/notice"
import { drawnInColour, plainOf, wordRuns } from "../support/colour"

const SIZE = { columns: 100, rows: 30 }

const TEAM: TeamView = {
  member: "ada",
  version: 2,
  servers: [
    {
      name: "prod-1",
      destination: "deploy@203.0.113.7",
      reachable: true,
      apps: [{ name: "shop", deploy: 41, state: "unknown" }],
    },
  ],
}

const play = (state: State, ...events: AppEvent[]): State =>
  events.reduce((current, event) => update(current, event).state, state)

const onHome = () => initialState({ kind: "team", team: TEAM }, SIZE)

/** The window as a terminal that shows colours receives it, line by line. */
const inColour = (state: State) =>
  drawnInColour(join(import.meta.dir, "../../src/app/app.tsx"), "AppView", {
    state,
    columns: SIZE.columns,
    rows: SIZE.rows,
  }).split("\n")

/** The notice alone, in `columns` columns, line by line. */
const lone = (notice: Notice, columns: number) =>
  renderToString(
    <Box width={columns}>
      <NoticeLine notice={notice} columns={columns} />
    </Box>,
    { columns }
  ).split("\n")

/** The column a line's words start at. */
const startOf = (line: string) => line.length - line.trimStart().length

/** A deploy of shop that stopped before signing, with `text` as its result. */
const stopped = (text: string) =>
  play(
    onHome(),
    {
      type: "deploy-started",
      server: "prod-1",
      app: "shop",
      at: Date.now() - 4200,
      from: "~/code/shop/compose.yaml",
      replaces: 41,
      secretNames: ["SESSION_KEY"],
    },
    {
      type: "deploy-ended",
      outcome: "error",
      notice: { tone: "error", text },
      at: Date.now(),
    }
  )

describe("an error in the app is drawn as at a terminal", () => {
  test("the deploy screen at 100 columns, the case of the walkthrough: bold first sentence, the rest dim and in line, no backticks, no row one space in", () => {
    const lines = inColour(stopped(C4("DATABASE_URL", "shop")))
    const at = lines.findIndex((line) =>
      plainOf(line).includes("✖ DATABASE_URL was set")
    )
    const end = lines.findIndex((line) =>
      plainOf(line).includes("Nothing was signed.")
    )
    expect(at).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(at)
    const drawn = lines.slice(at, end + 1)

    // ✖ in the error colour, then the first sentence, bold, on as many rows as it takes.
    const [mark, ...first] = wordRuns(drawn[0]!)
    expect(mark).toEqual({ text: "✖", bold: false, dim: false, color: "red" })
    const runs = drawn.flatMap((line, index) =>
      index === 0 ? first : wordRuns(line)
    )
    const bold = runs.filter((run) => run.bold)
    const dim = runs.filter((run) => run.dim)
    expect(bold.map((run) => run.text).join(" ")).toBe(
      "DATABASE_URL was set by someone who is no longer in the team, so shop cannot be deployed with it."
    )
    expect(dim.map((run) => run.text).join(" ")).toBe(
      "Set it again with zekno secret set DATABASE_URL, or remove it with zekno secret rm DATABASE_URL. Nothing was signed."
    )
    // Nothing else is on these rows, and the bold rows come before the dim ones.
    expect(runs).toEqual([...bold, ...dim])

    // Every row starts under the first word, two columns after the mark's.
    const plain = drawn.map(plainOf)
    const words = plain[0]!.indexOf("DATABASE_URL")
    expect(words).toBe(plain[0]!.indexOf("✖") + 2)
    for (const line of plain.slice(1)) expect(startOf(line)).toBe(words)
    expect(plain.join("\n")).not.toContain("`")
  })

  test("a row that fills its line to the last column is followed by a row that starts under it", () => {
    // 18 columns of words after `✖ `: the first two words fill them exactly.
    const drawn = lone(
      {
        tone: "error",
        text: "aaaaaaaa bbbbbbbbb cccc. Do `this` now and no later.",
      },
      20
    )
    expect(drawn).toEqual([
      "✖ aaaaaaaa bbbbbbbbb",
      "  cccc.",
      "  Do this now and no",
      "  later.",
    ])
  })

  test("one sentence is one bold line, with nothing below it", () => {
    expect(
      lone({ tone: "error", text: "prod-1 could not be reached." }, 60)
    ).toEqual(["✖ prod-1 could not be reached."])
  })

  test("the line above the key hints, on Home: the same look, and the hints stay the last line", () => {
    const text = C1("shop", "prod-1", 42, false)
    const state = play(onHome(), {
      type: "notice",
      notice: { tone: "error", text },
    })
    const lines = inColour(state)
    expect(lines.length).toBeLessThanOrEqual(SIZE.rows)
    const at = lines.findIndex((line) =>
      plainOf(line).includes("✖ Another deploy of shop")
    )
    expect(wordRuns(lines[at]!).slice(1)).toEqual([
      {
        text: "Another deploy of shop reached prod-1 first, as deploy 42.",
        bold: true,
        dim: false,
      },
    ])
    expect(wordRuns(lines[at + 1]!)).toEqual([
      {
        text: "Nothing of this one ran. Run zekno deploy again to deploy on top of it.",
        bold: false,
        dim: true,
      },
    ])
    expect(startOf(plainOf(lines[at + 1]!))).toBe(
      plainOf(lines[at]!).indexOf("Another")
    )
    // Only the gap and the key hints are below it.
    expect(
      lines
        .slice(at + 2)
        .map(plainOf)
        .filter((line) => line.trim())
    ).toHaveLength(1)
  })
})

describe("the other tones", () => {
  test("a warning keeps its backticks, is not dim, and goes on under its words", () => {
    const text = C6("prod-1", "0.1.0", "0.1.1")
    const drawn = lone({ tone: "warning", text }, 60)
    expect(drawn.length).toBeGreaterThan(1)
    expect(drawn[0]!.startsWith("! The runner on prod-1")).toBe(true)
    for (const line of drawn.slice(1)) expect(startOf(line)).toBe(2)
    expect(drawn.map((line) => line.trim()).join(" ")).toBe(`! ${text}`)
  })

  test("a result after ✔, and a plain line with no mark", () => {
    expect(
      lone({ tone: "success", text: "Deploy 42 of shop started." }, 60)
    ).toEqual(["✔ Deploy 42 of shop started."])
    expect(lone({ tone: "info", text: "Nothing to deploy here." }, 60)).toEqual(
      ["Nothing to deploy here."]
    )
  })
})

describe("noticeRows", () => {
  test("says the rows the line is drawn in, for every tone and width", () => {
    const texts = [
      "Short.",
      C1("shop", "prod-1", 42, false),
      C4("DATABASE_URL", "shop"),
      C6("prod-1", "0.1.0", "0.1.1"),
      "aaaaaaaa bbbbbbbbb cccc. Do `this` now and no later.",
    ]
    for (const tone of ["error", "warning", "success", "info"] as const)
      for (const columns of [20, 38, 60, 94, 98])
        for (const text of texts) {
          const notice = { tone, text }
          expect([tone, columns, text, noticeRows(notice, columns)]).toEqual([
            tone,
            columns,
            text,
            lone(notice, columns).length,
          ])
        }
  })
})
