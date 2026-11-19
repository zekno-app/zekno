/**
 * A line of the app about something done elsewhere, or about how something
 * ended: a mark and a sentence, never colour alone. It is drawn from the
 * same parts as the lines of single commands at a terminal
 * (ui/ink/marks.tsx), so an error looks the same in both: its first sentence
 * in bold after ✖, the rest faint below it, and commands without the
 * backticks plain output keeps around them. The words are broken into rows
 * here, each under the words above it, so no row starts with the space it
 * broke at.
 */
import { ErrorLine, errorParts, MarkedLine } from "../ui/ink/marks"
import { Wrapped, wrapPieces } from "../ui/ink/wrap"
import { useTheme } from "../ui/terminal/theme"
import type { Notice } from "../shared/notice"

/** The notice in `columns` columns, the room its line has on the screen. */
export function NoticeLine({
  notice,
  columns,
}: {
  notice: Notice
  columns: number
}) {
  const theme = useTheme()
  if (notice.tone === "info")
    return (
      <Wrapped pieces={[{ text: notice.text, dim: true }]} columns={columns} />
    )
  if (notice.tone === "error")
    return (
      <ErrorLine text={notice.text} columns={columns} color={theme.danger} />
    )
  return (
    <MarkedLine
      mark={notice.tone === "success" ? "✔" : "!"}
      color={notice.tone === "success" ? theme.success : theme.warning}
      pieces={[{ text: notice.text }]}
      columns={columns}
    />
  )
}

/** The rows words take in `columns` columns, as `Wrapped` breaks them. */
const rowsOf = (text: string, columns: number): number =>
  wrapPieces([{ text }], Math.max(columns, 1)).length

/**
 * The rows `NoticeLine` draws the notice in, in `columns` columns: what a
 * screen takes from the rows it gives the rest.
 */
export function noticeRows(notice: Notice, columns: number): number {
  if (notice.tone === "info") return rowsOf(notice.text, columns)
  if (notice.tone !== "error") return rowsOf(notice.text, columns - 2)
  const { first, rest } = errorParts(notice.text)
  return rowsOf(first, columns - 2) + (rest ? rowsOf(rest, columns - 2) : 0)
}
