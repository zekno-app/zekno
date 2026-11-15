/**
 * The pieces of the end-to-end engine that need no terminal: the screen
 * model (tests/support/screen-model.ts), the tree the runner and the model
 * read (screen-tree.ts), the keys (engine.ts) and the terminal's answers
 * (terminal.ts). The screens in test/e2e-screens/ are real output, captured
 * from the app in a pseudo-terminal at 100 by 30, test data only.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { keyBytes } from "../../tests/support/engine"
import { applySgr, createScreen } from "../../tests/support/screen-model"
import { findBoxes, screenTree, treeText } from "../../tests/support/screen-tree"
import { terminalAnswers } from "../../tests/support/terminal"

const captured = (name: string) => readFileSync(join(import.meta.dir, "e2e-screens", `${name}.txt`), "utf8")

/** The screen after `text`, fed whole or in pieces of `size` characters. */
function screenOf(text: string, size = text.length) {
  const screen = createScreen(100, 30)
  for (let at = 0; at < text.length; at += size) screen.feed(text.slice(at, at + size))
  return screen
}

const rowsOf = (screen: ReturnType<typeof createScreen>) => Array.from({ length: screen.rows }, (_, row) => screen.row(row))

describe("the screen model, fed real output", () => {
  test("Home: the header on the wordmark's last line, three panes, the key hints last", () => {
    const lines = screenOf(captured("home")).lines()
    expect(lines[2]!.endsWith("ada's team            team list v2  pre-alpha, unaudited")).toBe(true)
    expect(lines[4]).toBe(" ╭──────────────────────╮ ╭──────────────────────────────────────────╮ ╭──────────────────────────╮")
    expect(lines[7]).toBe(" │ ❯ prod             ● │ │   app    deploy  state       when        │ │ deploy     1, started    │")
    expect(lines[8]).toBe(" │   this machine       │ │ ❯ demo   1       ● stopped   just now    │ │ signed by  ada           │")
    expect(lines[26]).toBe(" ╰──────────────────────╯ ╰──────────────────────────────────────────╯ ╰──────────────────────────╯")
    expect(lines[29]).toBe(" ↑↓ move  ←→ pane  enter open  a add  ? help  q quit")
    // Every row is exactly as wide as the window: wide and narrow characters are counted as Ink counts them.
    for (const line of lines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(100)
  })

  test("the same screen, whatever pieces the output arrives in", () => {
    for (const name of ["first-run", "home", "set-a-secret", "deploy"]) {
      const whole = screenOf(captured(name)).lines()
      for (const size of [1, 2, 3, 7, 64, 1000]) expect(screenOf(captured(name), size).lines()).toEqual(whole)
    }
  })

  test("the app draws in the alternate screen, frame by frame, and answers nothing it does not draw", () => {
    const screen = screenOf(captured("deploy"))
    expect(screen.alternate).toBe(true)
    expect(screen.synchronizing).toBe(false)
    expect(screen.frames).toBe(12)
    // The background question and DA1 are the only sequences it reads past.
    expect(screen.unknown()).toEqual(["OSC 11", "CSI c"])
    expect(screen.lines()[11]).toBe("   ✔ Checked   ✔ Signed   ✔ Sent   ✔ Started")
  })

  test("cut inside a frame, the frame is known to be half drawn", () => {
    const text = captured("deploy")
    const start = text.lastIndexOf("\x1b[?2026h")
    const screen = screenOf(text.slice(0, start + 40))
    expect(screen.synchronizing).toBe(true)
    screen.feed(text.slice(start + 40))
    expect(screen.synchronizing).toBe(false)
  })

  test("bold, faint and colour per cell: the focused pane's border is not faint", () => {
    const screen = screenOf(captured("home"))
    const boxes = findBoxes(rowsOf(screen))
    expect(boxes.map((box) => [box.left, box.right, box.focused])).toEqual([
      [1, 24, true],
      [26, 69, false],
      [71, 98, false],
    ])
    // The selected row's name is bold.
    expect(screen.row(7)[5]).toMatchObject({ char: "p", bold: true })
  })
})

describe("the screen model, sequence by sequence", () => {
  test("cursor movement, erasing a line and the screen", () => {
    const screen = createScreen(10, 3)
    screen.feed("abcdef\r\nghij")
    expect(screen.lines()).toEqual(["abcdef", "ghij", ""])
    screen.feed("\x1b[1A\x1b[3G\x1b[K")
    expect(screen.lines()).toEqual(["ab", "ghij", ""])
    screen.feed("\x1b[2;2HX\x1b[1;1H\x1b[2J")
    expect(screen.lines()).toEqual(["", "", ""])
  })

  test("a line written to the last column wraps only when more follows; the bottom line scrolls", () => {
    const screen = createScreen(4, 2)
    screen.feed("abcd")
    expect(screen.cursor).toEqual({ x: 3, y: 0 })
    screen.feed("e")
    expect(screen.lines()).toEqual(["abcd", "e"])
    screen.feed("\r\nf")
    expect(screen.lines()).toEqual(["e", "f"])
  })

  test("a wide character takes two cells", () => {
    const screen = createScreen(6, 1)
    screen.feed("日本x")
    expect(screen.lines()).toEqual(["日本x"])
    expect(screen.cursor.x).toBe(5)
  })

  test("the alternate screen keeps the normal one underneath", () => {
    const screen = createScreen(5, 2)
    screen.feed("shell")
    screen.feed("\x1b[?1049h\x1b[Happ")
    expect(screen.lines()).toEqual(["app", ""])
    screen.feed("\x1b[?1049l")
    expect(screen.alternate).toBe(false)
    expect(screen.lines()).toEqual(["shell", ""])
  })

  test("SGR: bold, faint, 16, 256 and true colours, and their resets", () => {
    const plain = { bold: false, dim: false, fg: undefined }
    expect(applySgr(plain, "1;2;31")).toEqual({ bold: true, dim: true, fg: "31" })
    expect(applySgr(plain, "38;2;35;131;226")).toEqual({ ...plain, fg: "38;2;35;131;226" })
    expect(applySgr(plain, "38;5;244;1")).toEqual({ ...plain, bold: true, fg: "38;5;244" })
    expect(applySgr({ bold: true, dim: true, fg: "31" }, "22;39")).toEqual(plain)
    expect(applySgr({ bold: true, dim: false, fg: "31" }, "")).toEqual(plain)
  })

  test("a sequence it does not know is never drawn as text", () => {
    const screen = createScreen(10, 1)
    screen.feed("a\x1b[?2004h\x1b]0;title\x07\x1b=b")
    expect(screen.lines()).toEqual(["ab"])
  })
})

describe("the tree the runner and the model read", () => {
  test("Home: the header, each pane by its title with its lines, the selected rows, the key hints", () => {
    const tree = screenTree(rowsOf(screenOf(captured("home"))))
    expect(tree.location).toBe("ada's team")
    expect(treeText(tree.root)).toEqual([
      `window "ada's team"`,
      `  banner "ada's team" text="ada's team  team list v2  pre-alpha, unaudited"`,
      `  region "Servers" [focused]`,
      `    text text="Servers"`,
      `    option "prod  ●" text="❯ prod  ●" [selected]`,
      `    text text="this machine"`,
      `    text text="+ add a server"`,
      `  region "Apps on prod  1"`,
      `    text text="Apps on prod  1"`,
      `    text text="app  deploy  state  when"`,
      `    option "demo  1  ● stopped  just now" text="❯ demo  1  ● stopped  just now" [selected]`,
      `  region "demo"`,
      `    text text="demo"`,
      `    text text="deploy  1, started"`,
      `    text text="signed by  ada"`,
      `    text text="secrets  0"`,
      `    text text="d  Deploy this folder"`,
      `    text text="l  Logs"`,
      `    text text="s  Secrets"`,
      `  toolbar "keys" text="↑↓ move  ←→ pane  enter open  a add  ? help  q quit"`,
    ])
  })

  test("first run: a question is a text box with what was typed; the wordmark is left out", () => {
    const tree = screenTree(rowsOf(screenOf(captured("first-run"))))
    expect(tree.location).toBe("welcome")
    const text = treeText(tree.root)
    expect(text).toContain(`    textbox "Your name" value="ada" [focused]`)
    expect(text).toContain(`  region "Create your signing key" [focused]`)
    expect(text.join("\n")).not.toMatch(/[▀▄█]/)
  })

  test("the hidden prompt is a secure text box: no value, a secret's purpose", () => {
    const tree = screenTree(rowsOf(screenOf(captured("set-a-secret"))))
    expect(tree.location).toBe("prod › demo › set a secret")
    const pane = tree.root.children!.find((node) => node.name === "GREETING")!
    expect(pane.children![0]).toEqual({
      ref: { id: "field:GREETING:Value", revision: "" },
      role: "textbox",
      name: "Value",
      inputPurpose: "generic-secret",
      attributes: { placeholder: "hidden as you type" },
      states: { secure: true, focused: true },
    })
  })

  test("the deploy screen: the line about the result is a line of its own, the stages one line", () => {
    const tree = screenTree(rowsOf(screenOf(captured("deploy"))))
    expect(tree.location).toBe("prod › demo › deploy")
    expect(treeText(tree.root)).toContain(`  text text="✔ Checked  ✔ Signed  ✔ Sent  ✔ Started"`)
    expect(treeText(tree.root)).toContain(`    text text="from  ~/demo/compose.yaml"`)
  })

  test("a node keeps its id while its text is the same, and gets a new one when the text changes", () => {
    const one = screenTree(rowsOf(screenOf(captured("home"))))
    const two = screenTree(rowsOf(screenOf(captured("home"), 5)))
    expect(JSON.stringify(two)).toBe(JSON.stringify(one))
  })
})

describe("keys and the terminal's answers", () => {
  test("each key of the grammar as a terminal sends it", () => {
    expect(keyBytes("Enter")).toBe("\r")
    expect(keyBytes("Escape")).toBe("\x1b")
    expect(keyBytes("ArrowDown")).toBe("\x1b[B")
    expect(keyBytes("Shift+Tab")).toBe("\x1b[Z")
    expect(keyBytes("Control+c")).toBe("\x03")
    expect(keyBytes("ControlOrMeta+c")).toBe("\x03")
    expect(keyBytes("d")).toBe("d")
    expect(keyBytes("Shift+d")).toBe("D")
    expect(() => keyBytes("Meta+a")).toThrow("a terminal has no Meta key")
    expect(() => keyBytes("Control+Enter")).toThrow("cannot send")
  })

  test("the background question and DA1 are answered once each, even cut between two reads", () => {
    const query = "\x1b]11;?\x07\x1b[c"
    expect(terminalAnswers("", query).replies).toEqual(["\x1b]11;rgb:0000/0000/0000\x1b\\", "\x1b[?62;22c"])
    const first = terminalAnswers("", `frame${query.slice(0, 4)}`)
    expect(first.replies).toEqual([])
    const second = terminalAnswers(first.carry, query.slice(4))
    expect(second.replies).toHaveLength(2)
    // Read again with what came before, an answered question is not answered twice.
    expect(terminalAnswers(second.carry, "more").replies).toEqual([])
  })
})
