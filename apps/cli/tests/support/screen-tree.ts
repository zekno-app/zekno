/**
 * What the runner and the model read of the screen: a small tree built from
 * the screen model's cells. One node per line of text, grouped under the
 * pane (a rounded box) it is drawn in, plus the header, the line about
 * something done elsewhere (the status) and the key hints. A line marked
 * with `❯` is the selected row; a question (`? Your name › ada`) is a text
 * box, and the hidden prompt is a secure one whose value is never read.
 *
 * Pure: it reads cells and returns nodes, so it is checked with captured
 * output in test/e2e-screen-model.test.ts.
 */
import type { SemanticNode } from "e2e/engine"

import type { Cell } from "./screen-model"

/** A rounded box as Ink draws it: corners, and the title in the top border when it has one. */
type Box = { top: number; left: number; bottom: number; right: number; title: string; focused: boolean }

/** The wordmark is drawn with half blocks; it says nothing a test or the model needs. */
const LOGO = /^[▀▄█\s]*$/
/** A rule between parts of a pane: a line of its own, with nothing to read. */
const RULE = /^[─\s]*$/
const LOGO_PREFIX = /^[\s▀▄█]+/
/** What the hidden prompt shows where a value would be (src/app/screens/set-secret.tsx). */
const HIDDEN = "hidden as you type"
/** A question being asked: `? Your name › ada`, `? SSH destination   this machine`. */
const QUESTION = /^\? (.+?)(?:\s+›\s*|\s{2,}|\s*$)(.*)$/
const MARKER = "❯"

/** A short, stable hash of a line's text, so a node's id changes when its text does. */
function hash(text: string): string {
  let h = 5381
  for (let index = 0; index < text.length; index++) h = (h * 33) ^ text.charCodeAt(index)
  return (h >>> 0).toString(36)
}

/** Runs of three or more spaces as two: columns stay apart, and the text stays short. */
const tidy = (text: string): string => text.trim().replace(/ {3,}/g, "  ")

/** Every rounded box on the screen. */
export function findBoxes(rows: readonly (readonly Cell[])[]): Box[] {
  const char = (row: number, column: number) => rows[row]?.[column]?.char ?? ""
  const boxes: Box[] = []
  rows.forEach((cells, top) => {
    cells.forEach((cell, left) => {
      if (cell.char !== "╭") return
      let right = left + 1
      while (right < cells.length && char(top, right) !== "╮" && char(top, right) !== "╭") right++
      if (char(top, right) !== "╮") return
      let bottom = top + 1
      while (bottom < rows.length && char(bottom, left) === "│") bottom++
      if (char(bottom, left) !== "╰" || char(bottom, right) !== "╯") return
      const title = cells
        .slice(left + 1, right)
        .map((entry) => entry.char)
        .join("")
        .replace(/─/g, " ")
        .trim()
      boxes.push({ top, left, bottom, right, title, focused: !cell.dim })
    })
  })
  return boxes
}

/** The box a cell is inside of, the innermost when boxes nest; -1 outside every box, -2 on a border. */
function ownerOf(boxes: readonly Box[], row: number, column: number): number {
  let owner = -1
  let area = Infinity
  for (const [index, box] of boxes.entries()) {
    const inside = row >= box.top && row <= box.bottom && column >= box.left && column <= box.right
    if (!inside) continue
    if (row === box.top || row === box.bottom || column === box.left || column === box.right) return -2
    const size = (box.bottom - box.top) * (box.right - box.left)
    if (size < area) {
      owner = index
      area = size
    }
  }
  return owner
}

type Segment = { row: number; column: number; owner: number; text: string }

/** Each row cut where a box begins or ends, so text in two panes side by side is two lines. */
function segments(rows: readonly (readonly Cell[])[], boxes: readonly Box[]): Segment[] {
  const found: Segment[] = []
  rows.forEach((cells, row) => {
    let current: Segment | undefined
    const close = () => {
      if (current && !RULE.test(current.text)) found.push(current)
      current = undefined
    }
    cells.forEach((cell, column) => {
      const owner = ownerOf(boxes, row, column)
      if (owner === -2) return close()
      if (!current || current.owner !== owner) {
        close()
        current = { row, column, owner, text: "" }
      }
      current.text += cell.char
    })
    close()
  })
  return found
}

/** One line of text as a node: the selected row, a question, or plain text. */
function lineNode(segment: Segment, within: string): SemanticNode {
  const text = tidy(segment.text)
  const id = `${segment.row}:${segment.column}:${hash(text)}`
  if (text.startsWith(MARKER)) {
    const name = text.slice(MARKER.length).trim()
    return { ref: { id: `row:${id}`, revision: "" }, role: "option", name, text, states: { selected: true } }
  }
  const question = QUESTION.exec(text)
  if (question) {
    const label = question[1]!.trim()
    const answer = question[2]!.trim()
    // The same field keeps its id while its value changes, as a person types.
    const field = `field:${within}:${label}`
    if (answer === HIDDEN) {
      return {
        ref: { id: field, revision: "" },
        role: "textbox",
        name: label,
        inputPurpose: "generic-secret",
        attributes: { placeholder: HIDDEN },
        states: { secure: true, focused: true },
      }
    }
    return { ref: { id: field, revision: "" }, role: "textbox", name: label, value: answer, states: { focused: true } }
  }
  return { ref: { id: `line:${id}`, revision: "" }, role: "text", text }
}

/** The header's text without the wordmark: the screen's place, and what is on its right. */
function headerParts(lines: readonly string[]): string[] {
  return lines
    .map((line) => line.replace(LOGO_PREFIX, ""))
    .filter((line) => !LOGO.test(line))
    .flatMap((line) => line.trim().split(/\s{2,}/))
    .filter(Boolean)
}

export type ScreenTree = { location: string; root: SemanticNode }

/** The tree of what `rows` shows. */
export function screenTree(rows: readonly (readonly Cell[])[]): ScreenTree {
  const boxes = findBoxes(rows)
  const all = segments(rows, boxes)
  const lineOf = (row: number) => all.filter((segment) => segment.row === row)
  const blank = (row: number) => lineOf(row).length === 0

  // The header: the rows from the top down to the first blank one, when no box is in them.
  let headerEnd = 0
  while (headerEnd < rows.length && !blank(headerEnd)) headerEnd++
  const headerHasBox = boxes.some((box) => box.top < headerEnd)
  const headerRows = headerHasBox ? 0 : headerEnd
  const header = headerParts(
    all.filter((segment) => segment.row < headerRows).map((segment) => segment.text)
  )
  const place = (header[0] ?? "").replace(/^›\s*/, "")

  // The key hints: the last line, outside every box.
  const lastRow = Math.max(-1, ...all.map((segment) => segment.row))
  const hintsRow = lastRow >= headerRows && lineOf(lastRow).every((segment) => segment.owner === -1) ? lastRow : -1
  // The status: the line above the hints, with a blank row between them (app/frame.tsx).
  const statusRow = hintsRow >= 2 && blank(hintsRow - 1) && lineOf(hintsRow - 2).every((s) => s.owner === -1) ? hintsRow - 2 : -1

  const panes: SemanticNode[] = boxes.map((box, index) => {
    const children = all.filter((segment) => segment.owner === index).map((segment) => lineNode(segment, box.title || `${box.top}:${box.left}`))
    const title = box.title || (children[0]?.text ?? "")
    return {
      ref: { id: `pane:${box.top}:${box.left}:${hash(title)}`, revision: "" },
      // No text of its own: its lines say it, and a pane that echoed them would change whenever one of them does.
      role: "region",
      name: title,
      states: { focused: box.focused },
      children,
    }
  })
  // A box inside another is a child of the one around it.
  const parentOf = (index: number): number => {
    let parent = -1
    let area = Infinity
    boxes.forEach((outer, at) => {
      const inner = boxes[index]!
      if (at === index || !(outer.top < inner.top && outer.bottom > inner.bottom && outer.left < inner.left && outer.right > inner.right)) return
      const size = (outer.bottom - outer.top) * (outer.right - outer.left)
      if (size < area) (parent = at), (area = size)
    })
    return parent
  }

  const top: { row: number; node: SemanticNode }[] = []
  if (header.length > 0) {
    top.push({ row: 0, node: { ref: { id: `header:${hash(header.join("  "))}`, revision: "" }, role: "banner", name: place, text: header.join("  ") } })
  }
  for (const segment of all) {
    if (segment.owner !== -1 || segment.row < headerRows) continue
    const text = tidy(segment.text)
    if (segment.row === hintsRow) {
      top.push({ row: segment.row, node: { ref: { id: `keys:${hash(text)}`, revision: "" }, role: "toolbar", name: "keys", text } })
    } else if (segment.row === statusRow) {
      top.push({ row: segment.row, node: { ref: { id: `status:${hash(text)}`, revision: "" }, role: "status", text } })
    } else if (!LOGO.test(segment.text)) {
      top.push({ row: segment.row, node: lineNode(segment, "screen") })
    }
  }
  panes.forEach((pane, index) => {
    const parent = parentOf(index)
    if (parent === -1) top.push({ row: boxes[index]!.top, node: pane })
    else (panes[parent]!.children as SemanticNode[]).push(pane)
  })
  top.sort((a, b) => a.row - b.row)

  return {
    location: place,
    root: { ref: { id: "screen", revision: "" }, role: "window", name: place, children: top.map((entry) => entry.node) },
  }
}

/** The tree as lines of text, one node per line, for a test's output and the unit tests. */
export function treeText(node: SemanticNode, depth = 0): string[] {
  const states = Object.entries(node.states ?? {})
    .filter(([, on]) => on)
    .map(([state]) => state)
  const label = [
    node.role,
    node.name !== undefined ? JSON.stringify(node.name) : undefined,
    node.text !== undefined && node.text !== node.name && !(node.children?.length ?? 0) ? `text=${JSON.stringify(node.text)}` : undefined,
    node.value !== undefined ? `value=${JSON.stringify(node.value)}` : undefined,
    states.length > 0 ? `[${states.join(",")}]` : undefined,
  ]
    .filter(Boolean)
    .join(" ")
  return [`${"  ".repeat(depth)}${label}`, ...(node.children ?? []).flatMap((child) => treeText(child, depth + 1))]
}
