/**
 * The settings screen (specs/010-app-settings, contracts/app-screen.md;
 * board `AppSettings`): the Services pane, 22 columns wide, and the shown
 * service's settings in sections beside it, every setting a row, set or not,
 * with what changed since this machine's last deploy marked. In place of the
 * two panes, one pane holds a sentence when there are no settings to show;
 * while a change is open, the pane of the change (settings-change.tsx).
 *
 * Every line is broken before it is drawn (settings-layout.ts), so the rows
 * that do not fit are a window that keeps the selected row in view, with
 * `↑ <n> more` and `↓ <n> more` lines as the lists of single commands have
 * (`listWindow`). Every colour comes from the theme.
 */
import { Box, Text } from "ink"
import type { ReactNode } from "react"

import type { SettingRow } from "../../settings/types"
import { AS1, AS2 } from "../../settings/words"
import type { RunState } from "../../shared/views"
import { firstSentence, listWindow } from "../../ui/ink/questions"
import type { KeyHint } from "../../ui/parts/key-hints"
import { clampIndex } from "../../ui/parts/select"
import { Frame, Header, Trail } from "../frame"
import {
  settingsViewOf,
  type SettingsScreen as SettingsState,
} from "../state/reading"
import { rowsOf, serviceAt } from "../state/settings"
import type { State } from "../state/types"
import { APP_WIDE } from "./app"
import { Marker, Pane, Rule, StateCell } from "./parts"
import { HINTS } from "./placeholder"
import { ChangePane, changeHints } from "./settings-change"
import {
  bodyRows,
  cut,
  linesOf,
  SENTENCE_HINTS,
  SERVICES_INNER,
  SERVICES_WIDTH,
  serviceInner,
  statusRows,
} from "./settings-layout"
import { Lines, More, RowWindow } from "./settings-rows"

/**
 * The header's right side, as the app screen draws it: the app's state and,
 * at 100 columns and more, the deploy its runner holds (or this machine's
 * latest it accepted).
 */
function AppState({
  state,
  server,
  app,
  narrow,
}: {
  state: State
  server: string
  app: string
  narrow: boolean
}) {
  const row = state.team?.servers
    .find((entry) => entry.name === server)
    ?.apps.find((entry) => entry.name === app)
  const runState: RunState = row?.state ?? "unknown"
  const view =
    state.appView?.server === server && state.appView.app === app
      ? state.appView
      : undefined
  const latest = view?.deploys.find(
    (deploy) => deploy.outcome !== "sent"
  )?.sequence
  const shown = row?.accepted ?? latest
  return (
    <Box columnGap={1}>
      <StateCell state={runState} />
      {shown !== undefined && !narrow ? (
        <Text dimColor>deploy {shown}</Text>
      ) : null}
    </Box>
  )
}

/** The Services pane: one row per service, the one shown marked, and AS2 at its foot. */
function ServicesPane({
  names,
  selected,
  height,
}: {
  names: readonly string[]
  selected: number
  height: number
}) {
  const foot = linesOf([{ text: AS2, dim: true }], SERVICES_INNER)
  // The pane's border and title, and its foot.
  const shown = listWindow(
    names.length,
    selected,
    Math.max(1, height - 3 - foot.length)
  )
  return (
    <Pane title="Services" width={SERVICES_WIDTH} gap={0}>
      <Box flexDirection="column" flexShrink={0}>
        <More direction="↑" count={shown.above} />
        {names.slice(shown.from, shown.to).map((name, offset) => {
          const at = shown.from + offset === selected
          return (
            <Box key={name}>
              <Marker selected={at} />
              <Text bold={at} wrap="truncate-end">
                {cut(name, SERVICES_INNER - 2)}
              </Text>
            </Box>
          )
        })}
        <More direction="↓" count={shown.below} />
      </Box>
      <Box flexGrow={1} />
      <Lines lines={foot} />
    </Pane>
  )
}

/** The shown service: its name and the file on its first line, its rows in sections, and AS1 under a rule. */
function ServicePane({
  name,
  file,
  rows,
  selected,
  inner,
  height,
}: {
  name: string
  file: string
  rows: readonly SettingRow[]
  selected: number
  inner: number
  height: number
}) {
  const foot = linesOf([{ text: AS1, dim: true }], inner)
  return (
    <Pane title={name} right={<Text dimColor>{file}</Text>} focused gap={0}>
      <RowWindow
        rows={rows}
        selected={selected}
        inner={inner}
        // The pane's border, its first line, the rule and the foot.
        height={height - 2 - 1 - 1 - foot.length}
      />
      <Box flexGrow={1} />
      <Rule />
      <Lines lines={foot} />
    </Pane>
  )
}

/** One pane in place of the two: the sentence's first sentence bold, the rest faint on the next line. */
function SentencePane({ first, rest }: { first: string; rest: string }) {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="round"
      borderDimColor
      paddingX={1}
      overflow="hidden"
    >
      <Text bold>{first}</Text>
      {rest === "" ? null : <Text dimColor>{rest}</Text>}
    </Box>
  )
}

/**
 * Board `AppSettings`, board `AppSettingsEdit` while a change is open, and
 * the states no board shows (contracts/app-screen.md): the settings of the
 * app on the screen below, as this folder's settings file holds them, or one
 * sentence in their place.
 */
export function SettingsScreen({
  state,
  screen,
  columns,
  rows,
  status,
}: {
  state: State
  screen: SettingsState
  columns: number
  rows: number
  status?: ReactNode
}) {
  const narrow = columns < APP_WIDE
  const header = (
    <Header
      place={<Trail parts={[screen.server, screen.app, "settings"]} />}
      right={
        <AppState
          state={state}
          server={screen.server}
          app={screen.app}
          narrow={narrow}
        />
      }
    />
  )
  const outcome = settingsViewOf(state, screen)?.outcome
  if (outcome && outcome.kind !== "read") {
    const said =
      outcome.kind === "fault"
        ? outcome
        : (({ first, rest }) => ({ first, rest: rest.trim() }))(
            firstSentence(outcome.sentence)
          )
    return (
      <Frame header={header} hints={SENTENCE_HINTS} status={status}>
        <SentencePane first={said.first} rest={said.rest} />
      </Frame>
    )
  }
  const { change } = screen
  const hints: readonly KeyHint[] =
    outcome && change ? changeHints(change) : HINTS.settings
  const body = bodyRows(
    { columns, rows },
    statusRows(state, columns - 2),
    hints
  )
  const services = outcome?.report.services ?? []
  const shown = outcome ? serviceAt(outcome, screen) : 0
  const service = services[shown]
  const serviceRows = outcome ? rowsOf(outcome, screen) : []
  if (outcome && service && change) {
    return (
      <Frame header={header} hints={hints} status={status}>
        <ChangePane
          read={outcome}
          service={service.name}
          rows={serviceRows}
          change={change}
          columns={columns}
          body={body}
        />
      </Frame>
    )
  }
  return (
    <Frame header={header} hints={hints} status={status}>
      <Box flexGrow={1} columnGap={1}>
        <ServicesPane
          names={services.map((entry) => entry.name)}
          selected={shown}
          height={body}
        />
        {outcome && service ? (
          <ServicePane
            name={service.name}
            file={outcome.report.file}
            rows={serviceRows}
            selected={clampIndex(screen.row, serviceRows.length)}
            inner={serviceInner(columns)}
            height={body}
          />
        ) : (
          // Until the file is read the pane is empty, as the app screen's panes are before their data.
          <Pane title="" focused gap={0} />
        )}
      </Box>
    </Frame>
  )
}
