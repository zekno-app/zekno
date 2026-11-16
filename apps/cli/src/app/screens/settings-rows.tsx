/**
 * The parts the settings screen draws its lines with (specs/010-app-settings,
 * contracts/app-screen.md): a line already broken into pieces, a service's
 * rows in sections as a window that keeps the selected row in view, and the
 * `↑ <n> more` and `↓ <n> more` lines of a window, as the lists of single
 * commands draw them (`listWindow`, `moreLine`). The screen showing the
 * settings and the pane of a change both draw rows with these.
 */
import { Box, Text } from "ink"

import type { SettingRow } from "../../settings/types"
import { listWindow, moreLine } from "../../ui/ink/questions"
import type { Piece } from "../../ui/ink/wrap"
import { useTheme } from "../../ui/terminal/theme"
import { Marker } from "./parts"
import {
  labelWidth,
  lineOfRow,
  rowLines,
  type RowLine,
} from "./settings-layout"

/** One line of pieces, each in its look, never wrapped again. */
export function PieceLine({ pieces }: { pieces: readonly Piece[] }) {
  return (
    <Text wrap="truncate-end">
      {pieces.map((piece, index) => (
        <Text
          key={index}
          bold={piece.bold === true}
          dimColor={piece.dim === true}
          color={piece.color}
          inverse={piece.inverse === true}
        >
          {piece.text}
        </Text>
      ))}
    </Text>
  )
}

/** Lines already broken (`linesOf`), one under the other. */
export function Lines({ lines }: { lines: readonly (readonly Piece[])[] }) {
  return (
    <Box flexDirection="column" flexShrink={0}>
      {lines.map((pieces, index) => (
        <PieceLine key={index} pieces={pieces} />
      ))}
    </Box>
  )
}

/** The `↑ <n> more` or `↓ <n> more` line of a window, faint, when lines are hidden that way. */
export const More = ({
  direction,
  count,
}: {
  direction: "↑" | "↓"
  count: number
}) => (count > 0 ? <Text dimColor>{moreLine(direction, count)}</Text> : null)

/** One line of a service's rows: a section's heading, bold, or a row's line with its marker and label. */
function RowLineView({
  line,
  selected,
  label,
}: {
  line: RowLine
  selected: number
  label: number
}) {
  if (line.kind === "heading") return <Text bold>{line.text}</Text>
  const at = line.row === selected && line.label !== undefined
  return (
    <Box>
      <Marker selected={at} />
      <Box width={label} flexShrink={0}>
        <Text bold={at} dimColor={!at}>
          {line.label ?? ""}
        </Text>
      </Box>
      <PieceLine pieces={line.pieces} />
    </Box>
  )
}

/**
 * A service's rows in `height` lines: all of them when they fit, else a
 * window that keeps the selected row's first line in view, with the `more`
 * lines. The label is faint, the selected one bold; a value left out faint;
 * a mark in the theme's warning colour.
 */
export function RowWindow({
  rows,
  selected,
  inner,
  height,
}: {
  rows: readonly SettingRow[]
  selected: number
  inner: number
  height: number
}) {
  const theme = useTheme()
  const lines = rowLines(rows, inner, theme.warning)
  const label = labelWidth(rows, inner)
  const shown = listWindow(
    lines.length,
    lineOfRow(lines, selected),
    Math.max(1, height)
  )
  return (
    <Box flexDirection="column" flexShrink={0}>
      <More direction="↑" count={shown.above} />
      {lines.slice(shown.from, shown.to).map((line, offset) => (
        <RowLineView
          key={shown.from + offset}
          line={line}
          selected={selected}
          label={label}
        />
      ))}
      <More direction="↓" count={shown.below} />
    </Box>
  )
}
