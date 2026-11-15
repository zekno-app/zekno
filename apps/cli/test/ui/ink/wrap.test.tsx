/**
 * Words that wrap at a terminal (apps/cli/src/ui/wrap.tsx; specs/006-cli-small-features,
 * quickstart.md, the walkthrough's difference 6): a line goes on at the
 * column its text started at, with no space of its own, also when the word
 * before the break fills the line to its last column.
 */
import { describe, expect, test } from "bun:test"

import { KEPT_SO_FAR, MEMBER_NAME_RULE, openingLine, rememberFolder } from "../../src/asking/first-deploy"
import type { DoctorReport } from "../../src/ops/doctor"
import { linePieces } from "../../src/ui/ink"
import { plainUi } from "../../src/ui/plain"
import { quiet, strong } from "../../src/ui/types"
import { wrapPieces, type Piece } from "../../src/ui/wrap"
import { CLI_VERSION, versionCells, versionLines } from "../../src/version/version"
import { shows, terminal, until } from "./terminal"

/** The lines as plain text. */
const text = (pieces: Piece[], columns: number) => wrapPieces(pieces, columns).map((line) => line.map((piece) => piece.text).join(""))

describe("wrapPieces", () => {
  test("a word that fills the line to its last column: the next line starts with the next word, not with the space", () => {
    expect(text([{ text: "aaa bbb ccc" }], 7)).toEqual(["aaa bbb", "ccc"])
    expect(text([{ text: "aaaa bbb" }], 4)).toEqual(["aaaa", "bbb"])
    // F1 at 80 columns, set in by two: 78 columns for its text.
    const f1 = "Nothing is set up on this machine yet. Three things first: your key, a server, this app."
    expect(text([{ text: f1, dim: true }], 78)).toEqual(["Nothing is set up on this machine yet. Three things first: your key, a server,", "this app."])
  })

  test("a line breaks at the last space that fits; spaces inside a line are kept, as many as there are", () => {
    expect(text([{ text: "one two three four" }], 9)).toEqual(["one two", "three", "four"])
    expect(text([{ text: "(hidden)   esc skips it" }], 40)).toEqual(["(hidden)   esc skips it"])
    expect(text([{ text: "  set in" }], 40)).toEqual(["  set in"])
  })

  test("a word wider than a line is broken where the line ends; as Ink does, it starts on the line it follows unless that costs a break", () => {
    expect(text([{ text: "ab abcdefghij" }], 4)).toEqual(["ab", "abcd", "efgh", "ij"])
    // A path after a word, as doctor's next steps have: it starts after `Restore`, as Ink starts it.
    expect(text([{ text: `Restore /${"p".repeat(24)} from a copy` }], 12)).toEqual(["Restore /ppp", "pppppppppppp", "ppppppppp", "from a copy"])
    // Starting on the next line saves a break: it starts there.
    expect(text([{ text: `Restore /${"p".repeat(20)}` }], 12)).toEqual(["Restore", "/ppppppppppp", "ppppppppp"])
  })

  test("a line break in the text starts a new line", () => {
    expect(text([{ text: "first\nsecond line" }], 40)).toEqual(["first", "second line"])
  })

  test("each piece keeps its look across a break; a piece to keep whole is never broken at", () => {
    const lines = wrapPieces([{ text: "Remember this folder?", bold: true }, { text: " It writes zekno.json." }, { text: " " }, { text: "(y/N)", dim: true }], 30)
    expect(lines).toEqual([
      [{ text: "Remember this folder?", bold: true }, { text: " It" }],
      [{ text: "writes zekno.json." }, { text: " " }, { text: "(y/N)", dim: true }],
    ])
    // The cursor of a typed answer is a space to keep: it stays with the answer.
    expect(text([{ text: "Name › my-folder" }, { text: " ", inverse: true, keep: true }], 15)).toEqual(["Name ›", "my-folder "])
  })

  test("nothing wider than the window: every line fits, and none starts with a space", () => {
    const words = "Use lowercase letters, digits and hyphens, starting with a letter or a digit."
    for (let columns = 10; columns <= 80; columns++) {
      for (const line of text([{ text: words }], columns)) {
        expect(Bun.stringWidth(line)).toBeLessThanOrEqual(columns)
        expect(line.startsWith(" ")).toBe(false)
      }
    }
  })
})

/**
 * The lines single commands draw, on a stand-in terminal 80 columns wide: each
 * line the walkthrough saw go on one column off now goes on at the column its
 * text started at, with no space of its own; and the looks it saw differ from
 * the boards (the version's comma, doctor's next steps) are drawn as the boards
 * draw them.
 */
describe("the drawn lines at 80 columns (quickstart.md, the walkthrough's differences 4 and 6, and doctor's next steps)", () => {
  /** Waits for Ink to draw. */
  const drawn = () => Bun.sleep(60)
  const ENTER = "\r"

  test("F1, a note: it goes on at column 2", async () => {
    const t = terminal(80)
    t.ui.note(openingLine({ key: true, server: true, app: true })!)
    await drawn()
    await t.ui.close()
    expect(t.lines()).toEqual(["  Nothing is set up on this machine yet. Three things first: your key, a server,", "  this app."])
  })

  test("F5, a yes-or-no question exactly as wide as the window: (y/N) goes on under the words, open and answered", async () => {
    const t = terminal(80)
    const asked = t.ui.confirm(rememberFolder("demo", "prod"), "no terminal", { leave: true })
    await shows(t, "  (y/N)")
    expect(t.lines()).toEqual(["? Remember this folder? It writes zekno.json, so it always deploys demo to prod.", "  (y/N)"])
    t.keys("y")
    expect(await asked).toBe(true)
    await drawn()
    await t.ui.close()
    expect(t.lines()).toEqual(["? Remember this folder? It writes zekno.json, so it always deploys demo to prod.", "  (y/N) yes"])
  })

  test("A6, a typed answer's reason: it goes on at column 2, under itself", async () => {
    const t = terminal(80)
    const asked = t.ui.ask({ question: "Your name", fill: " ada", check: (answer) => (answer.startsWith(" ") ? MEMBER_NAME_RULE : undefined), missing: new Error("none") })
    await shows(t, "? Your name ›  ada")
    t.keys(ENTER)
    await shows(t, "  end.")
    expect(t.lines()).toEqual(["? Your name ›  ada", "  A name is 1 to 64 characters, with no control character and no space at either", "  end."])
    t.keys("\x1b")
    await asked.catch(() => {})
    await t.ui.close()
  })

  test("A10, the hidden prompt's reason after !: it goes on under its words, at column 2", async () => {
    const t = terminal(80)
    const value = t.ui.askValue("Value for DATABASE_URL (demo on prod): ", "DATABASE_URL")
    await shows(t, "? Value for DATABASE_URL (demo on prod): (hidden)   esc skips it")
    t.keys("one\ntwo\n")
    await until(() => t.lines().some((line) => line.startsWith("! That value")), "A10")
    const reason = t.lines().slice(1)
    expect(reason[0]).toBe("! That value has more than one line. Press esc to skip it, and set it later with")
    expect(reason.slice(1)).toEqual(["  `zekno secret set DATABASE_URL --stdin`."])
    t.keys("\x1b")
    await value
    await t.ui.close()
  })

  test("feature 004's status line: it goes on at column 0, where it starts", async () => {
    const t = terminal(80)
    t.ui.line("prod: team list version 2", [
      strong("prod"),
      { text: "reachable", mark: "●", tone: "success" },
      quiet("team list v2 (behind this machine; the next deploy brings it up to date)"),
    ])
    await drawn()
    await t.ui.close()
    expect(t.lines()).toEqual(["prod ● reachable team list v2 (behind this machine; the next deploy brings it up", "to date)"])
  })

  test("an error's first sentence and the rest: each goes on under itself, at column 2", async () => {
    const t = terminal(80)
    t.ui.error(`${"A sentence that goes on for a while, longer than the room for it on one line of this window."} ${KEPT_SO_FAR}`)
    await drawn()
    await t.ui.close()
    const lines = t.lines()
    expect(lines[0]!.startsWith("✖ A sentence")).toBe(true)
    for (const line of lines.slice(1)) {
      expect(line.startsWith("  ")).toBe(true)
      expect(line.startsWith("   ")).toBe(false)
    }
    expect(lines.join(" ").replace(/\s+/g, " ")).toContain("What was set up so far is kept: run zekno deploy again to carry on.")
  })

  test("zekno --version: the comma after the runner's version is dim, with the words after it; the words are the same", async () => {
    const t = terminal(80)
    const [first, second] = versionCells("0.1.0")
    t.ui.line(versionLines("0.1.0")[0], first)
    t.ui.line(versionLines("0.1.0")[1], second)
    await drawn()
    await t.ui.close()
    expect(t.lines()).toEqual([`zekno ${CLI_VERSION}`, "runner 0.1.0, the runner release this zekno installs"])
    // The stand-in terminal draws no colour (the walkthrough checks it): the line's pieces carry the looks Ink draws.
    expect(linePieces(second)).toEqual([{ text: "runner 0.1.0", bold: false, dim: false }, { text: ", the runner release this zekno installs", bold: false, dim: true }])
    expect(linePieces(first)).toEqual([{ text: `zekno ${CLI_VERSION}`, bold: false, dim: false }])
    expect(versionLines("0.1.0")).toEqual([`zekno ${CLI_VERSION}`, "runner 0.1.0, the runner release this zekno installs"])
  })

  test("doctor's next steps: a command without its backticks at a terminal, as error lines draw it; plain output keeps them", async () => {
    const report: DoctorReport = {
      zekno: CLI_VERSION,
      runner: "0.1.0",
      latest: { state: "newest" },
      machine: [{ check: "folder", label: "This folder", result: "problem", detail: "compose.yaml cannot be read", next: "No Compose file at ~/demo/compose.yaml. Point to one with `-f <file>`." }],
      servers: [],
      serversSkipped: false,
      problems: 1,
      warnings: 0,
    }
    const t = terminal(80)
    t.ui.doctorReport(report)
    await drawn()
    await t.ui.close()
    expect(t.lines()).toContain("                 No Compose file at ~/demo/compose.yaml. Point to one with -f")
    expect(t.lines()).toContain("                 <file>.")
    expect(t.raw()).not.toContain("`")
    const out: string[] = []
    plainUi((line) => out.push(line), () => {}).doctorReport(report)
    expect(out[0]).toBe("this machine\tfolder\tproblem\tcompose.yaml cannot be read\tNo Compose file at ~/demo/compose.yaml. Point to one with `-f <file>`.")
  })
})
