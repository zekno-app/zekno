/**
 * The smallest terminal screen that reads what the app writes: text with
 * its width, bold and colour per cell, cursor movement, erasing a line or
 * the screen, SGR, the alternate screen and synchronised output. That is the
 * whole set Ink uses (checked against real output, test/e2e/e2e-screen-model.test.ts).
 * Anything else is noted and otherwise ignored, never drawn as text.
 *
 * It holds no process and does no input or output: the pseudo-terminal
 * (pty.ts) feeds it, and the engine (engine.ts) reads it.
 */

/** One character cell: what is in it and how it is drawn. A wide character's second cell is `""`. */
export type Cell = {
  char: string
  bold: boolean
  dim: boolean
  fg: string | undefined
}

/** The attributes SGR sets. */
type Pen = { bold: boolean; dim: boolean; fg: string | undefined }

const PLAIN: Pen = { bold: false, dim: false, fg: undefined }

const blankCell = (): Cell => ({ char: " ", ...PLAIN })
const blankRow = (cols: number): Cell[] =>
  Array.from({ length: cols }, blankCell)

/** A CSI sequence: private marker, parameters, intermediates and final byte. */
const CSI = /^\x1b\[([?>=<]?)([0-9;:]*)([ -/]*)([@-~])/
/** An OSC sequence, ended by BEL or ST. */
const OSC = /^\x1b\]([^\x07\x1b]*)(?:\x07|\x1b\\)/
/** Longer than any sequence the app writes: what is still unfinished past this is dropped. */
const PENDING_LIMIT = 4096

/** Applies one SGR sequence's parameters to a pen. */
export function applySgr(pen: Pen, params: string): Pen {
  const parts = params === "" ? ["0"] : params.split(/[;:]/)
  let { bold, dim, fg } = pen
  for (let index = 0; index < parts.length; index++) {
    const code = Number(parts[index] || "0")
    if (code === 0) ({ bold, dim, fg } = PLAIN)
    else if (code === 1) bold = true
    else if (code === 2) dim = true
    else if (code === 22) {
      bold = false
      dim = false
    } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97))
      fg = String(code)
    else if (code === 39) fg = undefined
    else if (code === 38 || code === 48) {
      // 38;5;n or 38;2;r;g;b: the colour's own numbers are not codes.
      const kind = parts[index + 1]
      const take = kind === "5" ? 2 : kind === "2" ? 4 : 1
      if (code === 38) fg = parts.slice(index, index + 1 + take).join(";")
      index += take
    }
  }
  return { bold, dim, fg }
}

/** The display width of one code point, as Ink measures it. */
function widthOf(char: string): number {
  const code = char.codePointAt(0) ?? 0
  if (code < 0x20) return 0
  return Bun.stringWidth(char)
}

export type ScreenModel = ReturnType<typeof createScreen>

/** A screen `cols` wide and `rows` high, empty, with the cursor at the top left. */
export function createScreen(initialCols: number, initialRows: number) {
  let cols = initialCols
  let rows = initialRows
  let main: Cell[][] = Array.from({ length: rows }, () => blankRow(cols))
  let alternate: Cell[][] | undefined
  let x = 0
  let y = 0
  let savedMain = { x: 0, y: 0 }
  let saved = { x: 0, y: 0 }
  let pen: Pen = PLAIN
  let wrapPending = false
  let pending = ""
  let synchronizing = false
  let frames = 0
  let cursorVisible = true
  const unknown = new Set<string>()

  const grid = () => alternate ?? main

  function lineFeed() {
    wrapPending = false
    if (y === rows - 1) {
      grid().shift()
      grid().push(blankRow(cols))
    } else {
      y += 1
    }
  }

  function put(char: string) {
    const width = widthOf(char)
    if (width === 0) {
      // A combining mark joins the character before it.
      const row = grid()[y]!
      const at = Math.max(0, x - 1)
      row[at] = { ...row[at]!, char: row[at]!.char + char }
      return
    }
    if (wrapPending || x + width > cols) {
      x = 0
      lineFeed()
    }
    const row = grid()[y]!
    row[x] = { char, ...pen }
    if (width === 2 && x + 1 < cols) row[x + 1] = { char: "", ...pen }
    if (x + width >= cols) {
      x = cols - 1
      wrapPending = true
    } else {
      x += width
    }
  }

  function eraseInLine(mode: number) {
    const row = grid()[y]!
    const [from, to] =
      mode === 0 ? [x, cols] : mode === 1 ? [0, x + 1] : [0, cols]
    for (let column = from; column < to; column++) row[column] = blankCell()
  }

  function eraseInDisplay(mode: number) {
    const g = grid()
    if (mode === 2 || mode === 3) {
      for (let row = 0; row < rows; row++) g[row] = blankRow(cols)
    } else if (mode === 0) {
      eraseInLine(0)
      for (let row = y + 1; row < rows; row++) g[row] = blankRow(cols)
    } else if (mode === 1) {
      eraseInLine(1)
      for (let row = 0; row < y; row++) g[row] = blankRow(cols)
    }
  }

  function privateMode(on: boolean, params: string) {
    for (const mode of params.split(";").map(Number)) {
      if (mode === 25) cursorVisible = on
      else if (mode === 1049 || mode === 1047 || mode === 47) {
        if (on && !alternate) {
          savedMain = { x, y }
          alternate = Array.from({ length: rows }, () => blankRow(cols))
        } else if (!on && alternate) {
          alternate = undefined
          ;({ x, y } = savedMain)
        }
      } else if (mode === 2026) {
        // Synchronised output: a frame is complete when it ends.
        if (synchronizing && !on) frames += 1
        synchronizing = on
      } else {
        unknown.add(`CSI ?${mode}${on ? "h" : "l"}`)
      }
    }
  }

  function csi(
    marker: string,
    params: string,
    intermediates: string,
    final: string
  ) {
    if (marker === "?" && (final === "h" || final === "l"))
      return privateMode(final === "h", params)
    if (marker !== "" || intermediates !== "")
      return void unknown.add(`CSI ${marker}${params}${intermediates}${final}`)
    if (final === "m") {
      pen = applySgr(pen, params)
      return
    }
    const numbers =
      params === "" ? [] : params.split(";").map((part) => Number(part) || 0)
    const n = numbers[0] || 1
    wrapPending = false
    switch (final) {
      case "A":
        y = Math.max(0, y - n)
        return
      case "B":
        y = Math.min(rows - 1, y + n)
        return
      case "C":
        x = Math.min(cols - 1, x + n)
        return
      case "D":
        x = Math.max(0, x - n)
        return
      case "E":
        y = Math.min(rows - 1, y + n)
        x = 0
        return
      case "F":
        y = Math.max(0, y - n)
        x = 0
        return
      case "G":
        x = Math.min(cols - 1, n - 1)
        return
      case "H":
      case "f":
        y = Math.min(rows - 1, (numbers[0] || 1) - 1)
        x = Math.min(cols - 1, (numbers[1] || 1) - 1)
        return
      case "K":
        return eraseInLine(numbers[0] ?? 0)
      case "J":
        return eraseInDisplay(numbers[0] ?? 0)
      default:
        unknown.add(`CSI ${params}${final}`)
    }
  }

  /** Reads one escape sequence at the start of `text`: its length, 0 when it is not finished yet. */
  function escape(text: string): number {
    if (text.length < 2) return 0
    const second = text[1]!
    if (second === "[") {
      const match = CSI.exec(text)
      if (!match) return /^\x1b\[[?>=<]?[0-9;:]*[ -/]*$/.test(text) ? 0 : 2
      csi(match[1]!, match[2]!, match[3]!, match[4]!)
      return match[0].length
    }
    if (second === "]") {
      const match = OSC.exec(text)
      if (!match) return 0
      unknown.add(`OSC ${match[1]!.split(";")[0]}`)
      return match[0].length
    }
    if (second === "7") {
      saved = { x, y }
      return 2
    }
    if (second === "8") {
      ;({ x, y } = saved)
      wrapPending = false
      return 2
    }
    if (second === "(" || second === ")") return text.length < 3 ? 0 : 3
    unknown.add(`ESC ${second}`)
    return 2
  }

  return {
    get cols() {
      return cols
    },
    get rows() {
      return rows
    },
    /** True while the alternate screen is showing. */
    get alternate() {
      return alternate !== undefined
    },
    /** True between the start and the end of a synchronised frame: what is on screen is half drawn. */
    get synchronizing() {
      return synchronizing
    },
    /** How many synchronised frames have been completed. */
    get frames() {
      return frames
    },
    get cursorVisible() {
      return cursorVisible
    },
    get cursor() {
      return { x, y }
    },
    /** Sequences seen that this model does not draw, for tests and debugging. */
    unknown: (): readonly string[] => [...unknown],

    /** Takes what the program wrote. A sequence cut between two calls is finished by the next one. */
    feed(chunk: string) {
      const text = pending + chunk
      pending = ""
      let index = 0
      while (index < text.length) {
        const char = text[index]!
        if (char === "\x1b") {
          const length = escape(text.slice(index, index + PENDING_LIMIT))
          if (length === 0) {
            pending = text.slice(index)
            if (pending.length > PENDING_LIMIT) pending = ""
            return
          }
          index += length
          continue
        }
        const code = text.codePointAt(index)!
        const step = code > 0xffff ? 2 : 1
        if (char === "\r") {
          x = 0
          wrapPending = false
        } else if (char === "\n" || char === "\v" || char === "\f") {
          lineFeed()
        } else if (char === "\b") {
          x = Math.max(0, x - 1)
          wrapPending = false
        } else if (char === "\t") {
          x = Math.min(cols - 1, (Math.floor(x / 8) + 1) * 8)
        } else if (code >= 0x20 && code !== 0x7f) {
          put(String.fromCodePoint(code))
        }
        index += step
      }
    },

    /** Each row's text, wide characters once, trailing spaces taken off. */
    lines(): string[] {
      return grid().map((row) =>
        row
          .map((cell) => cell.char)
          .join("")
          .trimEnd()
      )
    },

    /** The cells of one row, for what is bold or coloured. */
    row(index: number): readonly Cell[] {
      return grid()[index] ?? []
    },

    /** A new window size. What is drawn is kept where it fits; the program redraws after it learns the size. */
    resize(newCols: number, newRows: number) {
      const fit = (g: Cell[][]) =>
        Array.from({ length: newRows }, (_, row) =>
          Array.from(
            { length: newCols },
            (_, column) => g[row]?.[column] ?? blankCell()
          )
        )
      main = fit(main)
      if (alternate) alternate = fit(alternate)
      cols = newCols
      rows = newRows
      x = Math.min(x, cols - 1)
      y = Math.min(y, rows - 1)
      wrapPending = false
    },
  }
}
