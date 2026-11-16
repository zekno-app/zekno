/**
 * The selected app's details on Home (home.tsx): its deploy, who signed it,
 * its secrets and its Compose file, and its actions; in the details pane at
 * 100 columns and more, and at the foot of the apps pane below that.
 */
import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { secretsWords } from "../../../shared/deploy"
import { useTheme } from "../../../ui/terminal/theme"
import type { ServerRow, State } from "../../state/types"
import type { AppRow } from "../../../shared/views"
import { Fields } from "../../../ui/parts/fields"
import { Pane, Rule } from "../parts"
import { DETAILS_WIDTH } from "./widths"

/** What a deploy's result is called in the details pane. */
export const OUTCOME_WORDS = {
  started: "started",
  start_failed: "did not start",
  sent: "no answer recorded",
} as const

/** The second line of the selected app's details below 100 columns: its secrets, and its Compose file when this folder is linked to it. Empty when there is neither. */
export function detailsSecondLine(app: AppRow, file?: string): string {
  return [
    app.secrets === undefined ? undefined : secretsWords(app.secrets),
    file,
    file === undefined ? undefined : "this folder is linked",
  ]
    .filter((part) => part !== undefined)
    .join(", ")
}

/**
 * The selected app's details at the foot of the apps pane, below 100
 * columns, as on the board "Home at 80 columns": `demo deploy 4, started,
 * signed by ada` and `2 secrets, compose.yaml, this folder is linked`.
 */
export function AppDetailsFoot({ app, file }: { app: AppRow; file?: string }) {
  const deploy =
    app.deploy === undefined
      ? "none yet"
      : `${app.deploy}${app.outcome ? `, ${OUTCOME_WORDS[app.outcome]}` : ""}`
  const signed = app.signer === undefined ? "" : `, signed by ${app.signer}`
  const second = detailsSecondLine(app, file)
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Rule />
      <Text wrap="truncate-end">
        <Text bold>{app.name}</Text>{" "}
        <Text dimColor>
          deploy {deploy}
          {signed}
        </Text>
      </Text>
      {second ? (
        <Text dimColor wrap="truncate-end">
          {second}
        </Text>
      ) : null}
    </Box>
  )
}

/** One action of the details pane: its letter in the brand colour, and what it does. */
function Action({ letter, children }: { letter: string; children: ReactNode }) {
  const theme = useTheme()
  return (
    <Box>
      <Box width={3} flexShrink={0}>
        <Text color={theme.brand} bold>
          {letter}
        </Text>
      </Box>
      <Text wrap="truncate-end">{children}</Text>
    </Box>
  )
}

export function DetailsPane({ app, file }: { app?: AppRow; file?: string }) {
  if (!app) {
    return (
      <Pane title=" " width={DETAILS_WIDTH}>
        <Text dimColor>No app selected.</Text>
      </Pane>
    )
  }
  const deploy =
    app.deploy === undefined
      ? "none yet"
      : `${app.deploy}${app.outcome ? `, ${OUTCOME_WORDS[app.outcome]}` : ""}`
  const rows: [string, ReactNode][] = [["deploy", deploy]]
  if (app.signer !== undefined) rows.push(["signed by", app.signer])
  if (app.secrets !== undefined) rows.push(["secrets", String(app.secrets)])
  if (file !== undefined) rows.push(["file", file])
  return (
    <Pane title={app.name} width={DETAILS_WIDTH}>
      <Fields rows={rows} labelWidth={11} />
      <Rule />
      <Box flexDirection="column">
        <Action letter="d">Deploy this folder</Action>
        {app.previous !== undefined ? (
          <Action letter="r">Roll back to deploy {app.previous}</Action>
        ) : null}
        <Action letter="l">Logs</Action>
        <Action letter="s">Secrets</Action>
      </Box>
    </Pane>
  )
}

/** The Compose file `d` deploys for an app: known when this folder is linked to that app on that server. */
export function linkedFile(
  state: State,
  server: ServerRow | undefined,
  app: AppRow | undefined
): string | undefined {
  const linked = state.linked
  return linked && linked.server === server?.name && linked.app === app?.name
    ? linked.compose
    : undefined
}
