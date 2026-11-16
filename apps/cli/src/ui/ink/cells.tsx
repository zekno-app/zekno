/**
 * Cells at a terminal (`Cell`, ui/types.ts): a marked cell's symbol before
 * its word, in its tone's colour; a styled cell bold, faint or in the text
 * colour, with its words for a terminal. Drawn as a table's cell (`CellText`)
 * and as the pieces of a line of cells (`linePieces`).
 */
import { Text } from "ink"

import type { Cell } from "../types"
import type { Piece } from "./wrap"

const TONE = { success: "green", danger: "red", warning: "yellow" } as const

/** A cell as a terminal draws it: a marked cell's symbol before its word, a styled cell's words for a terminal. */
export const drawnCell = (cell: Cell | undefined): string => {
  if (cell === undefined) return ""
  if (typeof cell === "string") return cell
  return "mark" in cell
    ? `${cell.mark} ${cell.text}`
    : (cell.terminal ?? cell.text)
}

/**
 * One cell in its look: a marked cell in its tone's colour, a styled cell
 * bold, faint or in the text colour, and a bare word as `bare` says.
 */
export function CellText({
  cell,
  text,
  bare,
}: {
  cell: Cell
  text: string
  bare: "plain" | "quiet"
}) {
  if (typeof cell === "string")
    return <Text dimColor={bare === "quiet"}>{text}</Text>
  if ("mark" in cell) {
    return (
      <Text
        color={cell.tone === "quiet" ? undefined : TONE[cell.tone]}
        dimColor={cell.tone === "quiet"}
      >
        {text}
      </Text>
    )
  }
  return (
    <Text bold={cell.style === "strong"} dimColor={cell.style === "quiet"}>
      {text}
    </Text>
  )
}

/**
 * A line of cells (`Ui.line`) as a terminal draws it: each cell in its look,
 * a space apart, unless a cell is drawn right after the one before it
 * (`tight`), such as the dim comma of `zekno --version`.
 */
export function linePieces(cells: readonly Cell[]): Piece[] {
  return cells.flatMap((cell, index): Piece[] => {
    const piece = cellPieces(cell, drawnCell(cell), "plain")
    const tight =
      typeof cell === "object" && "style" in cell && cell.tight === true
    return index > 0 && !tight ? [{ text: " " }, piece] : [piece]
  })
}

/** A cell as pieces in its look, as `CellText` draws it. */
function cellPieces(cell: Cell, text: string, bare: "plain" | "quiet"): Piece {
  if (typeof cell === "string") return { text, dim: bare === "quiet" }
  if ("mark" in cell)
    return cell.tone === "quiet"
      ? { text, dim: true }
      : { text, color: TONE[cell.tone] }
  return { text, bold: cell.style === "strong", dim: cell.style === "quiet" }
}
