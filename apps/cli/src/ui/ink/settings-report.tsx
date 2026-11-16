/**
 * `zekno settings` at a terminal (specs/010-app-settings, contracts/commands.md,
 * "At a terminal"; board `CmdSettings`, left column): the first line, then
 * each service with its rows in sections; and the change line `set` and
 * `unset` show before they ask (the board's middle column).
 *
 * Every value was cleaned where the rows were made (settings/rows.ts); names
 * and the file are cleaned here again, as everything from a file is before
 * it is drawn.
 */
import { Box, Text } from "ink"

import { sanitize } from "../../server/sanitize"
import type { SettingsReport } from "../../settings/types"
import { AS3, AS8 } from "../../settings/words"
import { useTheme } from "../terminal/theme"
import type { SettingChangeShown } from "../types"
import { Wrapped, type Piece } from "./wrap"

/** Where the section column starts: two columns in, as every line of the board. */
const INDENT = 2
/** The section column, from column 2: `Networking` and two spaces with room to spare (board: 110 px and its gap). */
export const SECTION_WIDTH = 14
/** The narrowest label column (contracts/commands.md: `max(10, longest label + 2)`). */
const LABEL_LEAST = 10

/** The label column of a report: `max(10, longest label of the report + 2)`. */
export function labelWidth(report: SettingsReport): number {
  const longest = Math.max(
    0,
    ...report.services.flatMap((service) =>
      service.rows.map((row) => [...row.label].length)
    )
  )
  return Math.max(LABEL_LEAST, longest + 2)
}

/**
 * The report as the board draws it: the app's name bold and `from <file>`
 * dim, or the file alone, bold, when the app is not known; an empty line
 * before each service, its name bold in the brand colour; each row its
 * section bold on the section's first row, its label dim, its value in the
 * text colour, which goes on under itself, never under the labels, when it
 * is wider than the window. A value changed since this machine's last deploy
 * is followed by two spaces and `! changed, not deployed (was <old>)` in the
 * warning colour; a setting, a plain variable or a volume that deploy had
 * and the file no longer has, by `! removed, not deployed (was <old>)`, and
 * a service it had, after the others, by the same (security review S3).
 */
export function SettingsBlock({
  report,
  columns,
}: {
  report: SettingsReport
  columns: number
}) {
  const theme = useTheme()
  const label = labelWidth(report)
  const value = columns - INDENT - SECTION_WIDTH - label
  return (
    <Box flexDirection="column" width={columns}>
      <Box paddingLeft={INDENT}>
        {report.app === undefined ? (
          <Text bold>{sanitize(report.file)}</Text>
        ) : (
          <Text>
            <Text bold>{sanitize(report.app)}</Text>
            <Text dimColor>
              {"  from "}
              {sanitize(report.file)}
            </Text>
          </Text>
        )}
      </Box>
      {report.services.map((service, at) => (
        <Box key={`service-${at}`} flexDirection="column">
          <Text> </Text>
          <Box paddingLeft={INDENT}>
            <Text bold color={theme.brand}>
              {sanitize(service.name)}
            </Text>
          </Box>
          {service.rows.map((row, index) => {
            const first =
              index === 0 || service.rows[index - 1]!.section !== row.section
            // A setting no longer set reads as the words of one left out, dim, as on the screen.
            const pieces: Piece[] = [{ text: row.shown, dim: !row.set }]
            if (row.changed !== undefined)
              pieces.push(
                { text: "  " },
                { text: AS3(row.changed.was), color: theme.warning }
              )
            if (row.removed !== undefined)
              pieces.push(
                { text: "  " },
                {
                  text: AS8(row.removed.was, row.path.key === "volume"),
                  color: theme.warning,
                }
              )
            return (
              <Box key={`row-${index}`} paddingLeft={INDENT}>
                <Box width={SECTION_WIDTH} flexShrink={0}>
                  <Text bold>{first ? row.section : ""}</Text>
                </Box>
                <Box width={label} flexShrink={0}>
                  <Text dimColor>{sanitize(row.label)}</Text>
                </Box>
                <Wrapped pieces={pieces} columns={value} />
              </Box>
            )
          })}
        </Box>
      ))}
      {(report.removed ?? []).map((service, at) => (
        // A service the last deploy had and the file no longer has: its name as a service's, and AS8 with its image.
        <Box key={`removed-${at}`} flexDirection="column">
          <Text> </Text>
          <Box paddingLeft={INDENT}>
            <Wrapped
              pieces={[
                {
                  text: sanitize(service.name),
                  bold: true,
                  color: theme.brand,
                },
                { text: "  " },
                { text: AS8(sanitize(service.was)), color: theme.warning },
              ]}
              columns={columns - INDENT}
            />
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/**
 * The change line (board `CmdSettings`, middle column), from column 2:
 * `<svc> · <label>` dim, two spaces, the old value in the text colour, the
 * arrow dim, the new value bold.
 */
export function ChangeLine({
  change,
  columns,
}: {
  change: SettingChangeShown
  columns: number
}) {
  return (
    <Box paddingLeft={INDENT} width={columns}>
      <Wrapped
        pieces={[
          {
            text: `${sanitize(change.service)} · ${sanitize(change.label)}`,
            dim: true,
          },
          { text: `  ${sanitize(change.now)} ` },
          { text: "→", dim: true },
          { text: " " },
          { text: sanitize(change.next), bold: true },
        ]}
        columns={columns - INDENT}
      />
    </Box>
  )
}
