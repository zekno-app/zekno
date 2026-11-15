/**
 * Home's widths (`HomeScreen`, home.tsx): the panes', and the apps table's
 * columns.
 */
/**
 * Pane widths. At 100 columns and more, as on the board "Home": the servers
 * pane has its 220 px, which hold `deploy@203.0.113.7` whole after the
 * marker's indent (eighteen columns, with the pane's border and padding and
 * that indent six more). Below that, as on the board "Home at 80 columns":
 * the servers pane is as wide (196 px of 720), and there is no details pane;
 * the selected app's details are at the foot of the apps pane and its
 * actions are keys on the last line.
 */
export const SERVERS_WIDTH = { wide: 24, narrow: 22 }
export const DETAILS_WIDTH = 28
/** Below this many columns Home is arranged as on the board "Home at 80 columns". */
export const HOME_WIDE = 100
/** The apps table's fixed columns: deploy, state and when, each with the space after it. The app's name takes what is left. */
export const DEPLOY_WIDTH = 8
/** Both boards' state column (96 px at 80 columns, 110 px at 100): room for `● running`, `● stopped`, `● unknown`. */
const STATE_WIDTH = 12
/** Room for `● partly running`, given when the app's name keeps at least `MIN_APP_WIDTH`. */
const STATE_FULL_WIDTH = 17
/** The app name column of the 80-column board (140 px): never made narrower to widen the state column. */
const MIN_APP_WIDTH = 16
/**
 * The when column of the boards at 100 and at 80 columns (96 px at 100: ten
 * columns and the gap after the state); it widens for a longer time, such as
 * "23 hours ago". At exactly 100 columns this is what leaves `worker` whole
 * beside the servers pane's 24.
 */
export const WHEN_WIDTH = { wide: 11, narrow: 11 }

/**
 * The state column's width: the boards' at 80 and 100 columns, where
 * `● partly running` is cut at a word (`● partly`, parts.tsx `StateCell`),
 * and wide enough for it where the window leaves the app's name as much room
 * as the 80-column board does.
 */
export function stateWidth(columns: number, whenWidth: number): number {
  const wide = columns >= HOME_WIDE
  // The window's margins, the panes beside the apps pane and the gaps between them, the pane's border and padding, the marker.
  const pane = columns - 2 - (wide ? SERVERS_WIDTH.wide : SERVERS_WIDTH.narrow) - (wide ? DETAILS_WIDTH + 2 : 1) - 4 - 2
  return pane - DEPLOY_WIDTH - whenWidth - STATE_FULL_WIDTH >= MIN_APP_WIDTH ? STATE_FULL_WIDTH : STATE_WIDTH
}
