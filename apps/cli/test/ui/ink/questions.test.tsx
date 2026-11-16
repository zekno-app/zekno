/**
 * The questions single commands ask at a terminal (specs/006-cli-small-features,
 * contracts/questions.md, mock-ups 1 to 3): each drawn on a stand-in terminal,
 * driven by keys written to its input, and read back from what Ink wrote. Also
 * what the plain interface does with each: it never asks. Colour is checked in
 * the pseudo-terminal walkthrough, not here.
 */
import { describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PassThrough, Writable } from "node:stream"

import runnerPackage from "../../../../runner/package.json"
import { tempDir } from "../../../../runner/test/support/helpers"
import { run } from "../../../src/cli/cli"
import { Left, NOTHING_DONE } from "../../../src/cli/errors"
import { inkUi } from "../../../src/ui/ink/ink"
import { plainUi } from "../../../src/ui/plain/plain"
import type { ListRow } from "../../../src/ui/types"
import { COMPOSE_V1, machine, ready, screenOf } from "../../support/helpers"
import {
  realRunner,
  sshStandIn,
  standInServer,
  withSsh,
} from "../../support/stand-in-server"
import { shows, terminal, until } from "../../support/terminal"

const UP = "\x1b[A"
const DOWN = "\x1b[B"
const ENTER = "\r"
const ESC = "\x1b"
const CTRL_C = "\x03"
const BACKSPACE = "\x7f"

/** A moment for Ink to draw, when a key is expected to change nothing. */
const settle = () => Bun.sleep(60)

const SERVERS: ListRow<string>[] = [
  { value: "prod", label: "prod", detail: "deploy@203.0.113.7" },
  { value: "staging", label: "staging", detail: "this machine" },
]
const MOCK_UP_1 = [
  "? Which server?",
  "  ❯ prod       deploy@203.0.113.7",
  "    staging    this machine",
  "  ↑↓ move   enter choose   esc leave",
]
const missing = new Error("the sentence the command has today")
const whichServer = (rows: ListRow<string>[] = SERVERS) => ({
  question: "Which server?",
  rows,
  collapsed: "Server",
  missing,
})

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
    for (const key of [
      "y",
      "n",
      "q",
      " ",
      "\t",
      "\x1b[C",
      "\x1b[D",
      "2",
      BACKSPACE,
    ]) {
      t.keys(key)
      await Bun.sleep(30)
    }
    expect(t.lines()).toEqual(MOCK_UP_1)
    t.keys(ENTER)
    expect(await chosen).toBe("prod")
    await t.ui.close()
  })

  test("Esc and Ctrl-C leave; the question's line stays, as the board draws it above Nothing was done.", async () => {
    for (const key of [ESC, CTRL_C]) {
      const t = terminal()
      const chosen = t.ui.choose(whichServer())
      await shows(t, "? Which server?")
      t.keys(key)
      expect(chosen).rejects.toBeInstanceOf(Left)
      await chosen.catch(() => {})
      await settle()
      expect(t.lines()).toEqual(["? Which server?"])
      await t.ui.close()
    }
  })

  test("a row that asks a question of its own, such as + a new app, leaves no line when chosen: that question follows the list", async () => {
    const t = terminal()
    const chosen = t.ui.choose({
      ...whichServer([
        ...SERVERS,
        { value: "new", label: "+ a new app", asksNext: true },
      ]),
      question: "Which app on prod?",
      collapsed: "App",
    })
    await shows(t, "? Which app on prod?")
    t.keys(DOWN)
    t.keys(DOWN)
    await shows(t, "  ❯ + a new app")
    t.keys(ENTER)
    expect(await chosen).toBe("new")
    const named = t.ui.ask({
      question: "Name for the new app",
      fill: "my-folder",
      check: () => undefined,
      missing,
    })
    await shows(t, "? Name for the new app › my-folder")
    expect(t.lines()).toEqual(["? Name for the new app › my-folder"])
    t.keys(ENTER)
    await named
    await settle()
    expect(t.lines()).toEqual(["? Name for the new app › my-folder"])
    await t.ui.close()
  })

  test("the label column is max(11, longest label + 2); a row with no detail ends after its label", async () => {
    const t = terminal()
    const chosen = t.ui.choose(
      whichServer([
        {
          value: "a",
          label: "a-very-long-server-name",
          detail: "this machine",
        },
        { value: "b", label: "b", detail: "deploy@x" },
        { value: "new", label: "+ a new app" },
      ])
    )
    await shows(t, "? Which server?")
    expect(t.lines()).toEqual([
      "? Which server?",
      "  ❯ a-very-long-server-name  this machine",
      "    b                        deploy@x",
      "    + a new app",
      "  ↑↓ move   enter choose   esc leave",
    ])
    t.keys(ESC)
    await chosen.catch(() => {})
    await t.ui.close()
  })

  test("fifty rows in a window of 80 by 10: at least three rows, how many more below, and above once at the end; every line fits", async () => {
    const t = terminal(80, 10)
    const rows = Array.from({ length: 50 }, (_, index) => ({
      value: index + 1,
      label: `server-${index + 1}`,
      detail: `deploy@203.0.113.${index + 1}`,
    }))
    const chosen = t.ui.choose({
      question: "Which server?",
      rows,
      collapsed: "Server",
      missing,
    })
    await shows(t, "? Which server?")
    const isRow = (line: string) => /^ {2}(❯| ) server-\d+ /.test(line)
    const top = t.lines()
    expect(top.filter(isRow).length).toBeGreaterThanOrEqual(3)
    const below = top.find((line) => /^ {2}↓ \d+ more$/.test(line))
    expect(below).toBeDefined()
    expect(top.filter(isRow).length + Number(/\d+/.exec(below!)![0])).toBe(50)
    expect(
      top.some((line) => line.includes("↑") && line.includes("more"))
    ).toBe(false)
    for (const line of top) expect([...line].length).toBeLessThanOrEqual(80)
    t.keys(DOWN.repeat(60))
    await until(
      () => t.lines().some((line) => line.startsWith("  ❯ server-50 ")),
      "the last row selected"
    )
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
  const nameForTheNewApp = (
    check: (answer: string) => string | undefined = () => undefined
  ) => ({ question: "Name for the new app", fill: "my-folder", check, missing })

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

  test("a refused answer stays open as typed, with the reason under it in line with the question's words and no mark; a paste of two lines changes nothing", async () => {
    const t = terminal()
    const answered = t.ui.ask(
      nameForTheNewApp((answer) =>
        answer === "my-folder" ? "Not that one." : undefined
      )
    )
    await shows(t, "? Name for the new app › my-folder")
    t.keys(ENTER)
    // As the board "Questions in single commands" draws it: from column 2, under the question's words, without `!`.
    await shows(t, "  Not that one.")
    expect(t.lines()).toEqual([
      "? Name for the new app › my-folder",
      "  Not that one.",
    ])
    expect(t.raw()).not.toContain("!")
    t.keys("x\ny")
    await settle()
    expect(t.lines()).toContain("? Name for the new app › my-folder")
    t.keys("-2")
    await shows(t, "? Name for the new app › my-folder-2")
    t.keys(ENTER)
    expect(await answered).toBe("my-folder-2")
    await t.ui.close()
  })

  test("a reason wider than the window goes on under itself, never at the left edge", async () => {
    const t = terminal(40)
    const answered = t.ui.ask(
      nameForTheNewApp(
        () =>
          "Use lowercase letters, digits and hyphens, starting with a letter or a digit."
      )
    )
    await shows(t, "? Name for the new app › my-folder")
    t.keys(ENTER)
    await shows(t, "  Use lowercase letters, digits and")
    const reason = t.lines().slice(1)
    expect(reason.length).toBeGreaterThan(1)
    for (const line of reason) {
      expect(line.startsWith("  ")).toBe(true)
      expect(line.startsWith("   ")).toBe(false)
      expect([...line].length).toBeLessThanOrEqual(40)
    }
    t.keys(ESC)
    await answered.catch(() => {})
    await t.ui.close()
  })

  test("Esc and Ctrl-C leave; the question's line stays with what was typed, without the cursor", async () => {
    for (const key of [ESC, CTRL_C]) {
      const t = terminal()
      const answered = t.ui.ask(nameForTheNewApp())
      await shows(t, "? Name for the new app › my-folder")
      t.keys("-x")
      await shows(t, "? Name for the new app › my-folder-x")
      t.keys(key)
      expect(answered).rejects.toBeInstanceOf(Left)
      await answered.catch(() => {})
      await settle()
      expect(t.lines()).toEqual(["? Name for the new app › my-folder-x"])
      const raw = t.raw()
      const last = raw.slice(raw.lastIndexOf("Name for the new app"))
      expect(last.slice(0, last.indexOf("\n"))).not.toContain("\x1b[7m")
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
    const second = t.ui.choose({
      ...whichServer(),
      question: "Which app on staging?",
      collapsed: "App",
    })
    await shows(t, "? Which app on staging?")
    expect(t.lines()).toContain("  ❯ prod       deploy@203.0.113.7")
    t.keys(ENTER)
    expect(await second).toBe("prod")
    const where = t.ui.ask({
      question: "Where is the server?",
      check: () => undefined,
      missing,
    })
    await shows(t, "? Where is the server? ›")
    t.keys("deploy@203.0.113.7")
    await shows(t, "? Where is the server? › deploy@203.0.113.7")
    t.keys(ENTER)
    expect(await where).toBe("deploy@203.0.113.7")
    const name = t.ui.ask({
      question: "A name for it",
      check: () => undefined,
      missing,
    })
    await shows(t, "? A name for it ›")
    t.keys("prod")
    t.keys(ENTER)
    expect(await name).toBe("prod")
    await settle()
    expect(t.lines()).toEqual([
      "✔ Server  staging",
      "✔ App  prod",
      "? Where is the server? › deploy@203.0.113.7",
      "? A name for it › prod",
    ])
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
    const asked = t.ui.confirm("Remember this folder?", "no terminal", {
      leave: true,
    })
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

  test("asked with leave: Esc and Ctrl-C leave, and its line stays as it was drawn; n and Enter are no", async () => {
    for (const key of [ESC, CTRL_C]) {
      const t = terminal()
      const asked = t.ui.confirm(
        "Remember this folder? It writes zekno.json.",
        "no terminal",
        { leave: true }
      )
      await shows(t, "? Remember this folder? It writes zekno.json. (y/N)")
      t.keys(key)
      expect(asked).rejects.toBeInstanceOf(Left)
      await asked.catch(() => {})
      await settle()
      expect(t.lines()).toEqual([
        "? Remember this folder? It writes zekno.json. (y/N)",
      ])
      await t.ui.close()
    }
    for (const key of ["n", ENTER]) {
      const t = terminal()
      const asked = t.ui.confirm("Remember this folder?", "no terminal", {
        leave: true,
      })
      await shows(t, "? Remember this folder? (y/N)")
      t.keys(key)
      expect(await asked).toBe(false)
      await t.ui.close()
    }
  })
})

describe("the hidden prompt that can be skipped (mock-up 3)", () => {
  const QUESTION = "Value for DATABASE_URL (demo on prod): "
  const OPEN =
    "? Value for DATABASE_URL (demo on prod): (hidden)   esc skips it"

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
    // Drawn as a refused typed answer's reason (specs/008-cli-decisions): from column 2, under the question's words, without `!`.
    await shows(t, "  A value cannot be empty. Press esc to skip it.")
    expect(t.lines()).toEqual([
      OPEN,
      "  A value cannot be empty. Press esc to skip it.",
    ])
    t.keys("zk_first_9f3a\nzk_second_9f3a\n")
    // The command without its backticks, as an error line draws one at a terminal.
    await shows(
      t,
      "  That value has more than one line. Press esc to skip it, and set it later with zekno secret set DATABASE_URL --stdin."
    )
    expect(t.lines()).toEqual([
      OPEN,
      "  That value has more than one line. Press esc to skip it, and set it later with zekno secret set DATABASE_URL --stdin.",
    ])
    expect(t.raw()).not.toContain("!")
    expect(t.raw()).not.toContain("`")
    t.keys(ESC)
    expect(await value).toBeUndefined()
    await shows(t, "? Value for DATABASE_URL (demo on prod): skipped")
    // The reason goes with the prompt: only the line that says the value was skipped stays.
    await settle()
    expect(t.lines()).toEqual([
      "? Value for DATABASE_URL (demo on prod): skipped",
    ])
    expect(t.raw()).not.toContain("9f3a")
    await t.ui.close()
  })

  test("Ctrl-C leaves, and its line stays as it was drawn, with nothing of the value and without a reason that was under it", async () => {
    const t = terminal()
    const value = t.ui.askValue(QUESTION, "DATABASE_URL")
    await shows(t, OPEN)
    t.keys(ENTER)
    await shows(t, "  A value cannot be empty. Press esc to skip it.")
    t.keys("zk_typed_9f3a")
    await settle()
    t.keys(CTRL_C)
    expect(value).rejects.toBeInstanceOf(Left)
    await value.catch(() => {})
    await settle()
    expect(t.lines()).toEqual([OPEN])
    await t.ui.close()
    expect(t.raw()).not.toContain("9f3a")
  })

  test("Ctrl-C after A10: the line stays as it was drawn, without the reason, above Nothing was done.", async () => {
    const t = terminal(200)
    const value = t.ui.askValue(QUESTION, "DATABASE_URL")
    await shows(t, OPEN)
    t.keys("zk_first_9f3a\nzk_second_9f3a\n")
    await shows(
      t,
      "  That value has more than one line. Press esc to skip it, and set it later with zekno secret set DATABASE_URL --stdin."
    )
    t.keys(CTRL_C)
    expect(value).rejects.toBeInstanceOf(Left)
    await value.catch(() => {})
    t.ui.error(NOTHING_DONE)
    await settle()
    expect(t.lines()).toEqual([OPEN, "✖ Nothing was done."])
    await t.ui.close()
    expect(t.raw()).not.toContain("9f3a")
  })

  test("zekno secret set's own hidden prompt is as before: several lines, or nothing, end the command with its error, and no reason is drawn under the prompt", async () => {
    const m = await ready()
    const plain = m.deps.ui
    for (const [typed, said] of [
      [
        "zk_first_9f3a\nzk_second_9f3a\n",
        [
          "✖ That value has more than one line.",
          "  Pipe it in and add --stdin.",
        ],
      ],
      [ENTER, ["✖ No value was given, so nothing was set."]],
    ] as const) {
      const t = terminal(200)
      m.deps.ui = t.ui
      const done = m
        .zekno("secret", "set", "GREETING", "--app", "web", "--server", "dev")
        .finally(() => (m.deps.ui = plain))
      await shows(t, "? Value for GREETING (web on dev): (hidden)", 20_000)
      t.keys(typed)
      expect(await done).toBe(1)
      await t.ui.close()
      // The prompt leaves nothing, as before; what is said is the command's error, after ✖.
      expect(t.lines()).toEqual([...said])
      expect(t.raw()).not.toContain("9f3a")
    }
  }, 60_000)

  test("a yes-or-no question asked without leave, and the hidden prompt of zekno secret set, are as before", async () => {
    const t = terminal()
    const asked = t.ui.confirm("Use it here?", "no terminal")
    await shows(t, "? Use it here? (y/N)")
    t.keys(ESC)
    expect(await asked).toBe(false)
    await shows(t, "? Use it here? (y/N) no")
    const secret = t.ui.askSecret("Value for A (demo on prod): ", false)
    await shows(t, "? Value for A (demo on prod): (hidden)")
    t.keys(CTRL_C)
    expect(secret).rejects.toThrow("Cancelled.")
    await secret.catch(() => {})
    await settle()
    expect(t.lines()).toEqual(["? Use it here? (y/N) no"])
    await t.ui.close()
  })
})

describe("between two hidden values of one flow (security review, 'Echo between the first deploy's hidden prompts')", () => {
  const A = "Value for A (demo on prod): "
  const B = "Value for B (demo on prod): "
  const open = (question: string) => `? ${question}(hidden)   esc skips it`

  test("raw mode stays on from one to the next, so nothing typed between them is echoed; what is typed reaches neither; anything drawn next lets go", async () => {
    const t = terminal()
    const first = t.ui.askValue(A, "A")
    await shows(t, open(A))
    t.keys("one")
    await settle()
    t.keys(ENTER)
    expect(await first).toBe("one")
    const after = t.modes.length
    // The value is stored meanwhile, and the next name prepared: keys typed now, as a paste would come.
    t.keys("typed-between")
    await Bun.sleep(150)
    expect(t.input.isRaw).toBe(true)
    const second = t.ui.askValue(B, "B")
    await shows(t, open(B))
    // Raw mode never went off between the first value and the second prompt.
    expect(t.modes.slice(after)).not.toContain(false)
    t.keys("two")
    await settle()
    t.keys(ENTER)
    expect(await second).toBe("two")
    expect(t.raw()).not.toContain("typed-between")
    // What the flow draws next ends the hold: raw mode goes off.
    t.ui.note("Deploying.")
    await until(() => t.input.isRaw === false, "raw mode off")
    await t.ui.close()
  })

  test("with nothing drawn and nothing asked, raw mode goes off on its own; closing lets go too", async () => {
    const t = terminal()
    const value = t.ui.askValue(A, "A")
    await shows(t, open(A))
    t.keys(ESC)
    expect(await value).toBeUndefined()
    expect(t.input.isRaw).toBe(true)
    await until(() => t.input.isRaw === false, "raw mode off on its own", 4000)
    const again = t.ui.askValue(B, "B")
    await shows(t, open(B))
    t.keys(ESC)
    await again
    await t.ui.close()
    expect(t.input.isRaw).toBe(false)
  })

  test("Ctrl-C between them: raw mode off, then the interrupt the terminal would have sent", async () => {
    const kill = spyOn(process, "kill").mockImplementation(() => true)
    try {
      const t = terminal()
      const value = t.ui.askValue(A, "A")
      await shows(t, open(A))
      t.keys(ESC)
      await value
      t.keys(CTRL_C)
      await until(() => kill.mock.calls.length > 0, "the interrupt")
      expect(kill.mock.calls).toEqual([[process.pid, "SIGINT"]])
      expect(t.input.isRaw).toBe(false)
      await t.ui.close()
    } finally {
      kill.mockRestore()
    }
  })

  test("only a hidden value holds raw mode: after a list, a typed answer or a yes-or-no question it goes off as before", async () => {
    const t = terminal()
    const chosen = t.ui.choose(whichServer())
    await shows(t, "? Which server?")
    t.keys(ENTER)
    await chosen
    await settle()
    expect(t.input.isRaw).toBe(false)
    const asked = t.ui.confirm("Remember this folder?", "no terminal")
    await shows(t, "? Remember this folder? (y/N)")
    t.keys("n")
    await asked
    await settle()
    expect(t.input.isRaw).toBe(false)
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
    await until(
      () => t.lines().some((line) => line.startsWith(keys.drawn)),
      `the question ${keys.drawn}`
    )
    for (const key of keys.late) {
      t.keys(key)
      await settle()
    }
    const answer = await asked
    // Whatever the flow does next: raw mode is off once it moves on, also after a hidden value, which holds it until then.
    t.ui.note("what comes next")
    await settle()
    const raw = t.input.isRaw
    const screen = t.raw()
    await t.ui.close()
    return { answer, raw, screen }
  }

  test("a list: y, Enter and abc typed before, or Enter while it opens, never choose", async () => {
    for (const before of ["y", ENTER, "abc"]) {
      const { answer, raw } = await early((t) => t.ui.choose(whichServer()), {
        before,
        drawn: "? Which server?",
        late: [DOWN, ENTER],
      })
      expect({ before, answer, raw }).toEqual({
        before,
        answer: "staging",
        raw: false,
      })
    }
    const { answer } = await early((t) => t.ui.choose(whichServer()), {
      during: ENTER,
      drawn: "? Which server?",
      late: [DOWN, ENTER],
    })
    expect(answer).toBe("staging")
  })

  test("a typed answer: nothing typed before becomes part of it or answers it", async () => {
    for (const before of ["y", ENTER, "abc"]) {
      const { answer, raw } = await early(
        (t) =>
          t.ui.ask({
            question: "Your name",
            fill: "ada",
            check: () => undefined,
            missing,
          }),
        { before, drawn: "? Your name", late: ["z", ENTER] }
      )
      expect({ before, answer, raw }).toEqual({
        before,
        answer: "adaz",
        raw: false,
      })
    }
  })

  test("a yes-or-no question: y and Enter typed before, or y while it opens, never answer it", async () => {
    const ask = (t: ReturnType<typeof terminal>) =>
      t.ui.confirm("Use it here?", "no terminal")
    for (const [before, late, expected] of [
      ["y", "n", false],
      [ENTER, "y", true],
      ["abc", "y", true],
    ] as const) {
      const { answer, raw } = await early(ask, {
        before,
        drawn: "? Use it here?",
        late: [late],
      })
      expect({ before, answer, raw }).toEqual({
        before,
        answer: expected,
        raw: false,
      })
    }
    expect(
      (await early(ask, { during: "y", drawn: "? Use it here?", late: ["n"] }))
        .answer
    ).toBe(false)
  })

  test("the hidden prompt that can be skipped: nothing typed before reaches the value", async () => {
    for (const before of ["y", ENTER, "abc"]) {
      const { answer, raw, screen } = await early(
        (t) => t.ui.askValue("Value for A (demo on prod): ", "A"),
        { before, drawn: "? Value for A", late: ["v", ENTER] }
      )
      expect({ before, answer, raw }).toEqual({
        before,
        answer: "v",
        raw: false,
      })
      expect(screen).not.toContain("cannot be empty")
    }
  })

  test("the hidden prompt of zekno secret set: nothing typed before reaches the value", async () => {
    for (const before of ["y", ENTER, "abc"]) {
      const { answer, raw } = await early(
        (t) => t.ui.askSecret("Value for A (demo on prod): ", false),
        { before, drawn: "? Value for A", late: ["v", ENTER] }
      )
      expect({ before, answer, raw }).toEqual({
        before,
        answer: "v",
        raw: false,
      })
    }
    const { answer } = await early(
      (t) => t.ui.askSecret("Value for A (demo on prod): ", false),
      { during: "x", drawn: "? Value for A", late: ["v", ENTER] }
    )
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
    const ui = inkUi({
      stdout: output as unknown as NodeJS.WriteStream,
      stdin: new PassThrough() as unknown as NodeJS.ReadStream,
    })
    ui.note("Using prod, your only server.")
    ui.gap()
    ui.code(
      "Team code",
      "J4QF-AM29",
      "Identifies your team. A server checks it before it agrees to obey your team."
    )
    ui.code(
      "Server code",
      "MM4G-GPD7",
      "Identifies this server's key. Teammates compare it before they trust the server."
    )
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
    const ui = inkUi({
      stdout: output as unknown as NodeJS.WriteStream,
      stdin: new PassThrough() as unknown as NodeJS.ReadStream,
    })
    ui.code(
      "Server code",
      "MM4G-GPD7",
      "Identifies this server's key. Teammates compare it before they trust the server."
    )
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
    expect(
      plain.ask({ question: "Your name", check: () => undefined, missing })
    ).rejects.toBe(missing)
    expect(plain.askValue("Value for A (demo on prod): ", "A")).rejects.toThrow(
      "There is no terminal to ask on. Pipe the value in and add `--stdin`."
    )
    expect(
      plain.confirm("Remember this folder?", "the refusal", { leave: true })
    ).rejects.toThrow("the refusal")
    plain.note("Using prod, your only server.")
    plain.code("Team code", "J4QF-AM29", "Identifies your team.")
    plain.groups([
      ["new", "A, B"],
      ["left out", "PATH (zekno keeps this name)"],
    ])
    plain.gap()
    expect(out).toEqual([
      "Using prod, your only server.",
      "Team code: J4QF-AM29",
      "Identifies your team.",
      "new\tA, B",
      "left out\tPATH (zekno keeps this name)",
    ])
    expect(err).toEqual([])
  })
})

describe("mock-ups 1 and 2 through the commands", () => {
  const RUNNING =
    '{"Service":"web","State":"running","ExitCode":0,"Health":""}\n'

  /** A team with prod, a server over the stand-in `ssh` at deploy@203.0.113.7, and, unless `only`, staging on this machine. */
  async function servers(options: { only?: boolean } = {}) {
    const m = machine()
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    const server = standInServer()
    m.deps.release = {
      version: runnerPackage.version,
      files: {
        "linux-x64": { sha256: server.release(realRunner(m.docker.path)) },
        "linux-arm64": { sha256: null },
      },
    }
    const ssh = sshStandIn(server)
    await withSsh(ssh, async () =>
      expect(
        await m.zekno("server", "add", "prod", "--ssh", "deploy@203.0.113.7")
      ).toBe(0)
    )
    if (!options.only)
      expect(
        await m.zekno(
          "server",
          "add",
          "staging",
          "--local",
          "--home",
          tempDir("staging")
        )
      ).toBe(0)
    const plain = m.deps.ui
    return {
      m,
      ssh,
      /** Runs `zekno <args>` on the stand-in terminal, with `ssh` meaning the stand-in. */
      start(t: ReturnType<typeof terminal>, ...args: string[]) {
        m.deps.ui = t.ui
        return withSsh(ssh, () => m.zekno(...args)).finally(
          () => (m.deps.ui = plain)
        )
      },
    }
  }

  test("zekno status with two servers: mock-up 1; Enter collapses it to ✔ Server  prod and the status follows; Esc ends with ✖ Nothing was done.", async () => {
    const s = await servers()
    const t = terminal()
    const done = s.start(t, "status")
    await shows(t, "? Which server?", 20_000)
    expect(t.lines()).toEqual(MOCK_UP_1)
    t.keys(ENTER)
    expect(await done).toBe(0)
    await t.ui.close()
    const after = t.lines()
    expect(after[0]).toBe("✔ Server  prod")
    // prod's runner holds the list from before staging was added: status says so, as it always does.
    expect(after[1]).toMatch(/^prod ● reachable team list v\d+/)
    expect(after).not.toContain("? Which server?")

    const left = terminal()
    const leaving = s.start(left, "status")
    await shows(left, "? Which server?", 20_000)
    left.keys(ESC)
    expect(await leaving).toBe(1)
    await left.ui.close()
    expect(left.lines()).toEqual(["? Which server?", "✖ Nothing was done."])
  }, 60_000)

  test("zekno status with one server: it is used and said, and no list is drawn", async () => {
    const s = await servers({ only: true })
    const t = terminal()
    expect(await s.start(t, "status")).toBe(0)
    await t.ui.close()
    expect(t.lines()[0]).toBe("  Using prod, your only server.")
    expect(t.raw()).not.toContain("Which server?")
  }, 60_000)

  test("zekno logs and zekno deploy with --server prod: mock-up 2's rows, + a new app for deploy only, its name with the folder's filled in", async () => {
    const s = await servers()
    s.m.compose(COMPOSE_V1)
    // api first and demo last, so this machine's latest deploy, demo, comes first, as in mock-up 2.
    await withSsh(s.ssh, async () => {
      for (let deploy = 0; deploy < 12; deploy++)
        expect(
          await s.m.zekno("deploy", "--app", "api", "--server", "prod")
        ).toBe(0)
      for (let deploy = 0; deploy < 4; deploy++)
        expect(
          await s.m.zekno("deploy", "--app", "demo", "--server", "prod")
        ).toBe(0)
    })
    s.m.docker.ps("demo", RUNNING)
    s.m.docker.ps("api", RUNNING)
    const rows = [
      "  ❯ demo       deploy 4, running",
      "    api        deploy 12, running",
    ]

    const logs = terminal()
    const following = s.start(logs, "logs", "--server", "prod", "--no-follow")
    await shows(logs, "? Which app on prod?", 20_000)
    expect(logs.lines()).toEqual([
      "? Which app on prod?",
      ...rows,
      "  ↑↓ move   enter choose   esc leave",
    ])
    logs.keys(ENTER)
    expect(await following).toBe(0)
    await logs.ui.close()
    expect(logs.lines()[0]).toBe("✔ App  demo")

    const folder = join(tempDir("folders"), "my-folder")
    mkdirSync(folder)
    writeFileSync(join(folder, "compose.yaml"), COMPOSE_V1)
    s.m.deps.cwd = folder
    const deploy = terminal()
    const deploying = s.start(deploy, "deploy", "--server", "prod")
    await shows(deploy, "? Which app on prod?", 20_000)
    expect(deploy.lines()).toEqual([
      "? Which app on prod?",
      ...rows,
      "    + a new app",
      "  ↑↓ move   enter choose   esc leave",
    ])
    deploy.keys(DOWN)
    await shows(deploy, "    api        deploy 12, running")
    deploy.keys(DOWN)
    await shows(deploy, "  ❯ + a new app")
    deploy.keys(ENTER)
    await shows(deploy, "? Name for the new app › my-folder")
    // Choosing + a new app leaves no line of its own: the typed question follows the list straight away (mock-up 2).
    expect(deploy.lines()).toEqual(["? Name for the new app › my-folder"])
    deploy.keys(ESC)
    expect(await deploying).toBe(1)
    await deploy.ui.close()
    expect(deploy.lines()).toEqual([
      "? Name for the new app › my-folder",
      "✖ Nothing was done.",
    ])
  }, 60_000)
})
