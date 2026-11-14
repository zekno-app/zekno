/**
 * The pixel wordmark "zekno.app" (research R13). The canvas draws it as an
 * SVG of a 5-row bitmap, 41 columns wide. A terminal cell is about twice as
 * tall as it is wide, so two rows share one line, drawn with half blocks:
 * 41 columns by 3 lines. "zekno" is in the terminal's own text colour and
 * ".app" in the brand blue.
 */
import { Box, Text } from "ink"
import { createElement, type ReactElement } from "react"

import { useTheme } from "./theme"

/** The bitmap of specs/004-cli-app/design/*.dc.html, one string per row, `#` for a filled cell. */
export const LOGO_BITMAP: readonly string[] = [
  "####  ##  #  # ###   ##     ##  ###  ### ",
  "   # #  # # #  #  # #  #      # #  # #  #",
  " ##  #### ##   #  # #  #    ### ###  ### ",
  "#    #    # #  #  # #  #   #  # #    #   ",
  "####  ### #  # #  #  ##  #  ### #    #   ",
]

export const LOGO_WIDTH = 41
export const LOGO_HEIGHT = 3
/** Where ".app" begins. Columns before it are "zekno" and the space after it. */
export const APP_COLUMN = 25

const filled = (row: number, column: number): boolean => LOGO_BITMAP[row]?.[column] === "#"

/** The character for one cell of a line: its upper row, its lower row, both, or neither. */
function halfBlock(top: boolean, bottom: boolean): string {
  if (top && bottom) return "█"
  if (top) return "▀"
  if (bottom) return "▄"
  return " "
}

/** The three lines of the wordmark, each 41 characters. */
export function logoLines(): string[] {
  const lines: string[] = []
  for (let line = 0; line < LOGO_HEIGHT; line++) {
    let text = ""
    for (let column = 0; column < LOGO_WIDTH; column++) {
      text += halfBlock(filled(line * 2, column), filled(line * 2 + 1, column))
    }
    lines.push(text)
  }
  return lines
}

/** One line of the wordmark, split where the colour changes. */
export type LogoLine = { name: string; app: string }

/** The three lines, each split into "zekno" (text colour) and ".app" (brand blue). */
export function logoParts(): LogoLine[] {
  return logoLines().map((line) => ({ name: line.slice(0, APP_COLUMN), app: line.slice(APP_COLUMN) }))
}

/** The wordmark, three lines tall and 41 columns wide. It never wraps or shrinks. */
export function Logo(): ReactElement {
  const theme = useTheme()
  return createElement(
    Box,
    { flexDirection: "column", flexShrink: 0, width: LOGO_WIDTH },
    ...logoParts().map((part, line) =>
      createElement(Text, { key: line, wrap: "truncate-end" }, part.name, createElement(Text, { color: theme.brand }, part.app))
    )
  )
}
