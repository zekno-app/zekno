/**
 * The questions single commands ask at a terminal (specs/006-cli-small-features,
 * contracts/questions.md, mock-ups 1 to 3): each drawn on a stand-in terminal,
 * driven by keys written to its input, and read back from what Ink wrote. Also
 * what the plain interface does with each: it never asks. Colour is checked in
 * the pseudo-terminal walkthrough, not here.
 */
import { describe, expect, test } from "bun:test"
import { PassThrough, Writable } from "node:stream"

import { tempDir } from "../../runner/test/helpers"
import { run } from "../src/cli"
import { Left, NOTHING_DONE } from "../src/errors"
import { inkUi } from "../src/ui/ink"
import { plainUi } from "../src/ui/plain"
import type { ListRow } from "../src/ui/types"
import { machine, screenOf } from "./helpers"

const UP = "\x1b[A"
const DOWN = "\x1b[B"
const ENTER = "\r"
const ESC = "\x1b"
const CTRL_C = "\x03"
const BACKSPACE = "\x7f"

/**
 * A stand-in terminal: an input that says it is a terminal, records each
 * change of raw mode and takes keys from the test, and an output that keeps
 * what Ink writes. Ink draws into it as into a person's terminal.
 */
function terminal(columns = 100, rows = 30) {
  const modes: boolean[] = []
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(mode: boolean) {
      modes.push(mode)
      input.isRaw = mode
      return input
    },
    ref: () => input,
    unref: () => input,
  })
  let raw = ""
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        raw += String(chunk)
        done()
      },
    }),
    { columns, rows, isTTY: true }
  )
  const ui = inkUi({ stdin: input as unknown as NodeJS.ReadStream, stdout: output as unknown as NodeJS.WriteStream, interactive: true })
  return {
    ui,
    input,
    modes,
    /** Keys typed, as a terminal hands them over. */
    keys: (text: string) => void input.write(text),
    /** The lines on the screen now, empty ones left out. */
    lines: () => screenOf(raw).filter(Boolean),
    raw: () => raw,
  }
}

/** Waits until `ready` holds, a few seconds at most. */
async function until(ready: () => boolean, what: string): Promise<void> {
  const started = Date.now()
  while (!ready()) {
    if (Date.now() - started > 3000) throw new Error(`never happened: ${what}`)
    await Bun.sleep(5)
  }
}

/** Waits until a line on the screen is exactly `line`. */
const shows = (t: ReturnType<typeof terminal>, line: string) => until(() => t.lines().includes(line), `the line ${JSON.stringify(line)}`)

/** A moment for Ink to draw, when a key is expected to change nothing. */
const settle = () => Bun.sleep(60)

const SERVERS: ListRow<string>[] = [
  { value: "prod", label: "prod", detail: "deploy@203.0.113.7" },
  { value: "staging", label: "staging", detail: "this machine" },
]
const MOCK_UP_1 = ["? Which server?", "  ❯ prod       deploy@203.0.113.7", "    staging    this machine", "  ↑↓ move   enter choose   esc leave"]
const missing = new Error("the sentence the command has today")
const whichServer = (rows: ListRow<string>[] = SERVERS) => ({ question: "Which server?", rows, collapsed: "Server", missing })

describe("a list (mock-up 1)", () => {
  test("it draws the four lines of mock-up 1; ↓ and ↑ move and stop at the ends; Enter chooses and leaves one line", async () => {
    const t = terminal()
    const chosen = t.ui.choose(whichServer())
    await shows(t, "? Which server?")
    expect(t.lines()).toEqual(MOCK_UP_1)
    t.keys(DOWN)
    await shows(t, "  ❯ staging    this machine")
    expect(t.lines()).toContain("    prod       deploy@203.0.113.7")
    t.keys(DOWN)
    await settle()
    expect(t.lines()).toContain("  ❯ staging    this machine")
    t.keys(UP)
    await shows(t, "  ❯ prod       deploy@203.0.113.7")
    t.keys(DOWN)
    await shows(t, "  ❯ staging    this machine")
    t.keys(ENTER)
    expect(await chosen).toBe("staging")
    await shows(t, "✔ Server  staging")
    expect(t.lines()).toEqual(["✔ Server  staging"])
    await t.ui.close()
  })

  test("no other key answers it", async () => {
    const t = terminal()
    const chosen = t.ui.choose(whichServer())
    await shows(t, "? Which server?")
    for (const key of ["y", "n", "q", " ", "\t", "\x1b[C", "\x1b[D", "2", BACKSPACE]) {
      t.keys(key)
      await Bun.sleep(30)
    }
    expect(t.lines()).toEqual(MOCK_UP_1)
    t.keys(ENTER)
    expect(await chosen).toBe("prod")
    await t.ui.close()
  })

  test("Esc and Ctrl-C leave", async () => {
    for (const key of [ESC, CTRL_C]) {
      const t = terminal()
      const chosen = t.ui.choose(whichServer())
      await shows(t, "? Which server?")
      t.keys(key)
      expect(chosen).rejects.toBeInstanceOf(Left)
      await chosen.catch(() => {})
      await settle()
      expect(t.lines()).toEqual([])
      await t.ui.close()
    }
  })

  test("the label column is max(11, longest label + 2); a row with no detail ends after its label", async () => {
    const t = terminal()
    const chosen = t.ui.choose(
      whichServer([{ value: "a", label: "a-very-long-server-name", detail: "this machine" }, { value: "b", label: "b", detail: "deploy@x" }, { value: "new", label: "+ a new app" }])
    )
    await shows(t, "? Which server?")
    expect(t.lines()).toEqual(["? Which server?", "  ❯ a-very-long-server-name  this machine", "    b                        deploy@x", "    + a new app", "  ↑↓ move   enter choose   esc leave"])
    t.keys(ESC)
    await chosen.catch(() => {})
    await t.ui.close()
  })

  test("fifty rows in a window of 80 by 10: at least three rows, how many more below, and above once at the end; every line fits", async () => {
    const t = terminal(80, 10)
    const rows = Array.from({ length: 50 }, (_, index) => ({ value: index + 1, label: `server-${index + 1}`, detail: `deploy@203.0.113.${index + 1}` }))
    const chosen = t.ui.choose({ question: "Which server?", rows, collapsed: "Server", missing })
    await shows(t, "? Which server?")
    const isRow = (line: string) => /^ {2}(❯| ) server-\d+ /.test(line)
    const top = t.lines()
    expect(top.filter(isRow).length).toBeGreaterThanOrEqual(3)
    const below = top.find((line) => /^ {2}↓ \d+ more$/.test(line))
    expect(below).toBeDefined()
    expect(top.filter(isRow).length + Number(/\d+/.exec(below!)![0])).toBe(50)
    expect(top.some((line) => line.includes("↑") && line.includes("more"))).toBe(false)
    for (const line of top) expect([...line].length).toBeLessThanOrEqual(80)
    t.keys(DOWN.repeat(60))
    await until(() => t.lines().some((line) => line.startsWith("  ❯ server-50 ")), "the last row selected")
    const end = t.lines()
    expect(end.some((line) => /^ {2}↑ \d+ more$/.test(line))).toBe(true)
    expect(end.some((line) => /^ {2}↓ \d+ more$/.test(line))).toBe(false)
    expect(end.filter(isRow).length).toBeGreaterThanOrEqual(3)
    for (const line of end) expect([...line].length).toBeLessThanOrEqual(80)
    t.keys(ENTER)
    expect(await chosen).toBe(50)
    await t.ui.close()
  })
})

describe("a typed answer (mock-up 2)", () => {
  const nameForTheNewApp = (check: (answer: string) => string | undefined = () => undefined) => ({ question: "Name for the new app", fill: "my-folder", check, missing })

  test("the value filled in is the answer so far; Backspace takes one character; a good answer leaves its line without the cursor", async () => {
    const t = terminal()
    const answered = t.ui.ask(nameForTheNewApp())
    await shows(t, "? Name for the new app › my-folder")
    t.keys(BACKSPACE)
    await shows(t, "? Name for the new app › my-folde")
    t.keys("r")
    await shows(t, "? Name for the new app › my-folder")
    t.keys(ENTER)
    expect(await answered).toBe("my-folder")
    await settle()
    expect(t.lines()).toEqual(["? Name for the new app › my-folder"])
    // The line left behind is drawn once, after the prompt with its cursor is gone.
    const raw = t.raw()
    const last = raw.slice(raw.lastIndexOf("Name for the new app"))
    expect(last.slice(0, last.indexOf("\n"))).not.toContain("\x1b[7m")
    await t.ui.close()
  })

  test("a refused answer stays open as typed, with the reason under it; a paste of two lines changes nothing", async () => {
    const t = terminal()
    const answered = t.ui.ask(nameForTheNewApp((answer) => (answer === "my-folder" ? "Not that one." : undefined)))
    await shows(t, "? Name for the new app › my-folder")
    t.keys(ENTER)
    await shows(t, "! Not that one.")
    expect(t.lines()).toEqual(["? Name for the new app › my-folder", "! Not that one."])
    t.keys("x\ny")
    await settle()
    expect(t.lines()).toContain("? Name for the new app › my-folder")
    t.keys("-2")
    await shows(t, "? Name for the new app › my-folder-2")
    t.keys(ENTER)
    expect(await answered).toBe("my-folder-2")
    await t.ui.close()
  })

  test("Esc and Ctrl-C leave", async () => {
    for (const key of [ESC, CTRL_C]) {
      const t = terminal()
      const answered = t.ui.ask(nameForTheNewApp())
      await shows(t, "? Name for the new app › my-folder")
      t.keys(key)
      expect(answered).rejects.toBeInstanceOf(Left)
      await answered.catch(() => {})
      await t.ui.close()
    }
  })
})

describe("one question after another", () => {
  test("each starts afresh: a second list from its first row, a second answer from its own value", async () => {
    const t = terminal()
    const first = t.ui.choose(whichServer())
    await shows(t, "? Which server?")
    t.keys(DOWN)
    await shows(t, "  ❯ staging    this machine")
    t.keys(ENTER)
    expect(await first).toBe("staging")
    const second = t.ui.choose({ ...whichServer(), question: "Which app on staging?", collapsed: "App" })
    await shows(t, "? Which app on staging?")
    expect(t.lines()).toContain("  ❯ prod       deploy@203.0.113.7")
    t.keys(ENTER)
    expect(await second).toBe("prod")
    const where = t.ui.ask({ question: "Where is the server?", check: () => undefined, missing })
    await shows(t, "? Where is the server? ›")
    t.keys("deploy@203.0.113.7")
    await shows(t, "? Where is the server? › deploy@203.0.113.7")
    t.keys(ENTER)
    expect(await where).toBe("deploy@203.0.113.7")
    const name = t.ui.ask({ question: "A name for it", check: () => undefined, missing })
    await shows(t, "? A name for it ›")
    t.keys("prod")
    t.keys(ENTER)
    expect(await name).toBe("prod")
    await settle()
    expect(t.lines()).toEqual(["✔ Server  staging", "✔ App  prod", "? Where is the server? › deploy@203.0.113.7", "? A name for it › prod"])
    await t.ui.close()
  })
})

describe("a yes-or-no question", () => {
  test("as today: y is yes, and Esc and Ctrl-C are no; the answered line stays with ? and (y/N)", async () => {
    for (const [key, answer] of [
      ["y", true],
      [ESC, false],
      [CTRL_C, false],
      ["n", false],
      [ENTER, false],
    ] as const) {
      const t = terminal()
      const asked = t.ui.confirm("Remember this folder?", "no terminal")
      await shows(t, "? Remember this folder? (y/N)")
      t.keys(key)
      expect(await asked).toBe(answer)
      await shows(t, `? Remember this folder? (y/N) ${answer ? "yes" : "no"}`)
      await t.ui.close()
    }
  })

  test("no other key answers it", async () => {
    const t = terminal()
    const asked = t.ui.confirm("Remember this folder?", "no terminal", { leave: true })
    await shows(t, "? Remember this folder? (y/N)")
    for (const key of ["x", "q", " ", "1", "\t", DOWN, "yes"]) {
      t.keys(key)
      await Bun.sleep(30)
    }
    expect(t.lines()).toEqual(["? Remember this folder? (y/N)"])
    t.keys("y")
    expect(await asked).toBe(true)
    await t.ui.close()
  })

  test("asked with leave: Esc and Ctrl-C leave; n and Enter are no", async () => {
    for (const key of [ESC, CTRL_C]) {
      const t = terminal()
      const asked = t.ui.confirm("Remember this folder?", "no terminal", { leave: true })
      await shows(t, "? Remember this folder? (y/N)")
      t.keys(key)
      expect(asked).rejects.toBeInstanceOf(Left)
      await asked.catch(() => {})
      await t.ui.close()
    }
    for (const key of ["n", ENTER]) {
      const t = terminal()
      const asked = t.ui.confirm("Remember this folder?", "no terminal", { leave: true })
      await shows(t, "? Remember this folder? (y/N)")
      t.keys(key)
      expect(await asked).toBe(false)
      await t.ui.close()
    }
  })
})

describe("the hidden prompt that can be skipped (mock-up 3)", () => {
  const QUESTION = "Value for DATABASE_URL (demo on prod): "
  const OPEN = "? Value for DATABASE_URL (demo on prod): (hidden)   esc skips it"

  test("it draws the line of mock-up 3, takes a value without drawing any of it, and leaves the line ending (hidden)", async () => {
    const t = terminal()
    const value = t.ui.askValue(QUESTION, "DATABASE_URL")
    await shows(t, OPEN)
    t.keys("s3cret")
    await settle()
    t.keys(ENTER)
    expect(await value).toBe("s3cret")
    await shows(t, "? Value for DATABASE_URL (demo on prod): (hidden)")
    expect(t.raw()).not.toContain("s3cret")
    await t.ui.close()
  })

  test("nothing typed: A9, and it keeps asking; several lines: A10, and it keeps asking; Esc skips it", async () => {
    // Wide enough for A10 on one line.
    const t = terminal(200)
    const value = t.ui.askValue(QUESTION, "DATABASE_URL")
    await shows(t, OPEN)
    t.keys(ENTER)
    await shows(t, "! A value cannot be empty. Press esc to skip it.")
    t.keys("zk_first_9f3a\nzk_second_9f3a\n")
    await shows(t, "! That value has more than one line. Press esc to skip it, and set it later with `zekno secret set DATABASE_URL --stdin`.")
    expect(t.lines()).toContain(OPEN)
    t.keys(ESC)
    expect(await value).toBeUndefined()
    await shows(t, "? Value for DATABASE_URL (demo on prod): skipped")
    expect(t.raw()).not.toContain("9f3a")
    await t.ui.close()
  })

  test("Ctrl-C leaves", async () => {
    const t = terminal()
    const value = t.ui.askValue(QUESTION, "DATABASE_URL")
    await shows(t, OPEN)
    t.keys(CTRL_C)
    expect(value).rejects.toBeInstanceOf(Left)
    await value.catch(() => {})
    await t.ui.close()
  })
})

describe("keys typed before a question is on the screen never answer it (FR-007, feature 004 K12)", () => {
  /**
   * Types `before` while nothing reads it (as while the keychain asks), opens
   * the question, types `during` while it is opening, waits until it is drawn,
   * then types `late`. Each early key is typed on its own, so that it would be
   * read as one key if it were read at all.
   */
  async function early<T>(
    open: (t: ReturnType<typeof terminal>) => Promise<T>,
    keys: { before?: string; during?: string; drawn: string; late: string[] }
  ): Promise<{ answer: T; raw: boolean; screen: string }> {
    const t = terminal()
    if (keys.before !== undefined) t.keys(keys.before)
    const asked = open(t)
    if (keys.during !== undefined) setTimeout(() => t.keys(keys.during!), 10)
    await until(() => t.lines().some((line) => line.startsWith(keys.drawn)), `the question ${keys.drawn}`)
    for (const key of keys.late) {
      t.keys(key)
      await settle()
    }
    const answer = await asked
    await settle()
    const raw = t.input.isRaw
    const screen = t.raw()
    await t.ui.close()
    return { answer, raw, screen }
  }

  test("a list: y, Enter and abc typed before, or Enter while it opens, never choose", async () => {
    for (const before of ["y", ENTER, "abc"]) {
      const { answer, raw } = await early((t) => t.ui.choose(whichServer()), { before, drawn: "? Which server?", late: [DOWN, ENTER] })
      expect({ before, answer, raw }).toEqual({ before, answer: "staging", raw: false })
    }
    const { answer } = await early((t) => t.ui.choose(whichServer()), { during: ENTER, drawn: "? Which server?", late: [DOWN, ENTER] })
    expect(answer).toBe("staging")
  })

  test("a typed answer: nothing typed before becomes part of it or answers it", async () => {
    for (const before of ["y", ENTER, "abc"]) {
      const { answer, raw } = await early((t) => t.ui.ask({ question: "Your name", fill: "ada", check: () => undefined, missing }), { before, drawn: "? Your name", late: ["z", ENTER] })
      expect({ before, answer, raw }).toEqual({ before, answer: "adaz", raw: false })
    }
  })

  test("a yes-or-no question: y and Enter typed before, or y while it opens, never answer it", async () => {
    const ask = (t: ReturnType<typeof terminal>) => t.ui.confirm("Use it here?", "no terminal")
    for (const [before, late, expected] of [
      ["y", "n", false],
      [ENTER, "y", true],
      ["abc", "y", true],
    ] as const) {
      const { answer, raw } = await early(ask, { before, drawn: "? Use it here?", late: [late] })
      expect({ before, answer, raw }).toEqual({ before, answer: expected, raw: false })
    }
    expect((await early(ask, { during: "y", drawn: "? Use it here?", late: ["n"] })).answer).toBe(false)
  })

  test("the hidden prompt that can be skipped: nothing typed before reaches the value", async () => {
    for (const before of ["y", ENTER, "abc"]) {
      const { answer, raw, screen } = await early((t) => t.ui.askValue("Value for A (demo on prod): ", "A"), { before, drawn: "? Value for A", late: ["v", ENTER] })
      expect({ before, answer, raw }).toEqual({ before, answer: "v", raw: false })
      expect(screen).not.toContain("cannot be empty")
    }
  })

  test("the hidden prompt of zekno secret set: nothing typed before reaches the value", async () => {
    for (const before of ["y", ENTER, "abc"]) {
      const { answer, raw } = await early((t) => t.ui.askSecret("Value for A (demo on prod): ", false), { before, drawn: "? Value for A", late: ["v", ENTER] })
      expect({ before, answer, raw }).toEqual({ before, answer: "v", raw: false })
    }
    const { answer } = await early((t) => t.ui.askSecret("Value for A (demo on prod): ", false), { during: "x", drawn: "? Value for A", late: ["v", ENTER] })
    expect(answer).toBe("v")
  })
})

describe("lines between questions: note, code, groups, gap", () => {
  test("a note from column 2; a code at column 15 with what it is for under it; groups in a column from 14; a gap is one empty line", async () => {
    let raw = ""
    const output = Object.assign(
      new Writable({
        write(chunk, _encoding, done) {
          raw += String(chunk)
          done()
        },
      }),
      { columns: 100, rows: 30 }
    )
    const ui = inkUi({ stdout: output as unknown as NodeJS.WriteStream, stdin: new PassThrough() as unknown as NodeJS.ReadStream })
    ui.note("Using prod, your only server.")
    ui.gap()
    ui.code("Team code", "J4QF-AM29", "Identifies your team. A server checks it before it agrees to obey your team.")
    ui.code("Server code", "MM4G-GPD7", "Identifies this server's key. Teammates compare it before they trust the server.")
    ui.groups([
      ["new", "A, B"],
      ["left out", "PATH (zekno keeps this name)"],
    ])
    await settle()
    await ui.close()
    const lines = screenOf(raw)
    const start = lines.indexOf("  Using prod, your only server.")
    expect(lines.slice(start, start + 8)).toEqual([
      "  Using prod, your only server.",
      "",
      "  Team code    J4QF-AM29",
      "  Identifies your team. A server checks it before it agrees to obey your team.",
      "  Server code  MM4G-GPD7",
      "  Identifies this server's key. Teammates compare it before they trust the server.",
      "  new         A, B",
      "  left out    PATH (zekno keeps this name)",
    ])
    expect(lines[start + 2]!.indexOf("J4QF")).toBe(15)
    expect(lines[start + 4]!.indexOf("MM4G")).toBe(15)
    expect(lines[start + 6]!.indexOf("A, B")).toBe(14)
  })

  test("what a code is for wraps under itself, never at the left edge", async () => {
    let raw = ""
    const output = Object.assign(
      new Writable({
        write(chunk, _encoding, done) {
          raw += String(chunk)
          done()
        },
      }),
      { columns: 40, rows: 30 }
    )
    const ui = inkUi({ stdout: output as unknown as NodeJS.WriteStream, stdin: new PassThrough() as unknown as NodeJS.ReadStream })
    ui.code("Server code", "MM4G-GPD7", "Identifies this server's key. Teammates compare it before they trust the server.")
    await settle()
    await ui.close()
    const lines = screenOf(raw).filter(Boolean)
    expect(lines.length).toBeGreaterThan(2)
    for (const line of lines.slice(1)) expect(line.startsWith("  ")).toBe(true)
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(40)
  })
})

describe("leaving (research R4)", () => {
  test("Left is a failure that says Nothing was done.: run prints it as any other and ends with status 1", async () => {
    expect(new Left().message).toBe(NOTHING_DONE)
    expect(NOTHING_DONE).toBe("Nothing was done.")
    const m = machine()
    m.deps.home = tempDir("no-profile")
    // Left thrown where a command would ask: here, as the help is printed.
    m.deps.ui = {
      ...m.deps.ui,
      info: () => {
        throw new Left()
      },
    }
    expect(await run(["--help"], m.deps)).toBe(1)
    expect(m.err).toEqual(["Nothing was done."])
  })
})

describe("the plain interface never asks (contracts/questions.md, 'The plain interface')", () => {
  test("asks is false; each question throws what it was given, or the sentence it has today; the lines are plain", async () => {
    const out: string[] = []
    const err: string[] = []
    const plain = plainUi(
      (line) => out.push(line),
      (line) => err.push(line)
    )
    expect(plain.asks).toBe(false)
    expect(plain.choose(whichServer())).rejects.toBe(missing)
    expect(plain.ask({ question: "Your name", check: () => undefined, missing })).rejects.toBe(missing)
    expect(plain.askValue("Value for A (demo on prod): ", "A")).rejects.toThrow("There is no terminal to ask on. Pipe the value in and add `--stdin`.")
    expect(plain.confirm("Remember this folder?", "the refusal", { leave: true })).rejects.toThrow("the refusal")
    plain.note("Using prod, your only server.")
    plain.code("Team code", "J4QF-AM29", "Identifies your team.")
    plain.groups([
      ["new", "A, B"],
      ["left out", "PATH (zekno keeps this name)"],
    ])
    plain.gap()
    expect(out).toEqual(["Using prod, your only server.", "Team code: J4QF-AM29", "Identifies your team.", "new\tA, B", "left out\tPATH (zekno keeps this name)"])
    expect(err).toEqual([])
  })
})
