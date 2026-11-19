/**
 * The `Domains` box of an app's screen, under `Secrets`
 * (specs/015-domains-https, contracts/cli.md, CL6; line E7; board
 * `DomainsApp`): each domain of the app, and under it its state after its
 * mark in its tone, set in as on the board, never colour alone; then, at the
 * foot, where the states come from and where domains are changed. It only
 * shows: it never has the keys, so its border and title are faint. Its rows
 * are those of `zekno domain` (app/effects/domains.ts), and an app without a
 * domain has no box.
 *
 * Below 100 columns it has no foot (`DomainsPane`).
 */
import { Box, Text } from "ink"

import { E7_NOTE, E7_TITLE, STATE_MARKS } from "../../domains/words"
import { useTheme } from "../../ui/terminal/theme"
import type { AppDomainRow, Screen, State } from "../state/types"
import { Marker, Pane, wordsThatFit } from "./parts"

/** The box's rows for the app the screen shows, once read, or undefined when it has no box. */
export function appDomainsOf(
  state: State,
  screen: Extract<Screen, { name: "app" }>
): readonly AppDomainRow[] | undefined {
  const read = state.appDomains
  if (read?.server !== screen.server || read.app !== screen.app)
    return undefined
  return read.rows.length > 0 ? read.rows : undefined
}

/**
 * One domain: its name where a selectable row's would be, and its state on
 * the line under it, two columns further in, in `room` columns: whole, or
 * its first words that fit, as a state cell is cut (`wordsThatFit`).
 */
function DomainRow({ row, room }: { row: AppDomainRow; room: number }) {
  const theme = useTheme()
  const { mark, tone } = STATE_MARKS[row.state]
  const color =
    tone === "success"
      ? theme.success
      : tone === "warning"
        ? theme.warning
        : tone === "danger"
          ? theme.danger
          : undefined
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box>
        <Marker selected={false} />
        <Text wrap="truncate-end">{row.domain}</Text>
      </Box>
      <Box paddingLeft={4}>
        <Text color={color} dimColor={tone === "quiet"} wrap="truncate-end">
          {wordsThatFit(`${mark} ${row.words}`, room)}
        </Text>
      </Box>
    </Box>
  )
}

/** The rows the box keeps however short the window: its borders and its title. */
const KEPT_ROWS = 3

/**
 * The box: its domains, as many as fit, and its foot. It takes the room the
 * `Secrets` box leaves, and in a short window gives up its own rows first,
 * down to its title. Below 100 columns it has no foot: its first line would
 * take two rows of the narrow box, which the domains need more.
 */
export function DomainsPane({
  rows,
  narrow,
  width,
}: {
  rows: readonly AppDomainRow[]
  narrow: boolean
  /** The box's width, the `Secrets` box's above it. */
  width: number
}) {
  // Inside the border and the padding, past the state's own four columns in.
  const room = width - 4 - 4
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexShrink={100}
      minHeight={KEPT_ROWS}
    >
      <Pane title={E7_TITLE} flexGrow={1} flexShrink={1}>
        <Box flexDirection="column" flexShrink={1} overflow="hidden">
          {rows.map((row) => (
            <DomainRow key={row.domain} row={row} room={room} />
          ))}
        </Box>
        {narrow ? null : <Box flexGrow={1} />}
        {narrow ? null : (
          <Box flexDirection="column" flexShrink={0}>
            {E7_NOTE.map((line) => (
              <Text key={line} dimColor>
                {line}
              </Text>
            ))}
          </Box>
        )}
      </Pane>
    </Box>
  )
}
