/**
 * The Deploys pane of the app screen (board "One app: deploys and secrets",
 * and "One app at 80 columns" below 100 columns): the deploy history from
 * this machine's verified history, each deploy's result, and the selected
 * deploy's details. Split from app.tsx with no change of behaviour
 * (specs/016-build-from-source, contracts/cli.md CL14).
 */
import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { clampIndex } from "../../ui/parts/select"
import { secretsWords } from "../../shared/deploy"
import { useTheme } from "../../ui/terminal/theme"
import type { DeployRow } from "../../shared/views"
import { clockTime } from "../../shared/time"
import { Fields } from "../../ui/parts/fields"
import { Cell, Marker, Pane, Rule } from "./parts"

/** The number and when columns at 100 columns and at 80, each with the space after it. Both widen for what is in them. */
const NUMBER_WIDTH = { wide: 6, narrow: 4 }
const WHEN_WIDTH = { wide: 14, narrow: 12 }

/**
 * A deploy's result as the history shows it: a symbol and words, never
 * colour alone. The deploy the runner runs now, while every service of the
 * app is running, is `● running now`, as on the board (`runningNow`).
 */
function Result({
  deploy,
  runningNow,
  narrow,
}: {
  deploy: DeployRow
  runningNow: boolean
  narrow: boolean
}) {
  const theme = useTheme()
  // Below 100 columns, as on the board "One app at 80 columns": a rollback that started is `✔ rollback to 1`, and the others say their result alone.
  const rollback =
    deploy.rollbackTo === undefined || narrow
      ? ""
      : `, a rollback to ${deploy.rollbackTo}`
  if (
    narrow &&
    !runningNow &&
    deploy.outcome === "started" &&
    deploy.rollbackTo !== undefined
  )
    return <Text>✔ rollback to {deploy.rollbackTo}</Text>
  if (runningNow) {
    return (
      <Text>
        <Text color={theme.success}>● running now</Text>
        {rollback}
      </Text>
    )
  }
  switch (deploy.outcome) {
    case "started":
      return <Text>✔ started{rollback}</Text>
    case "start_failed":
      return (
        <Text>
          <Text color={theme.danger}>✖</Text> did not start{rollback}
        </Text>
      )
    case "sent":
      return (
        <Text>
          <Text color={theme.warning}>!</Text> no answer recorded{rollback}
        </Text>
      )
  }
}

/**
 * The selected deploy below 100 columns, as on the board "One app at 80
 * columns": `deploy 4, signed by ada, team list v2` and `web (caddy:2), 1
 * secret`, faint.
 */
function NarrowDeployDetails({ deploy }: { deploy: DeployRow }) {
  const first = [
    `deploy ${deploy.sequence}`,
    deploy.signer ? `signed by ${deploy.signer}` : undefined,
    deploy.teamVersion ? `team list v${deploy.teamVersion}` : undefined,
  ]
  const second = [
    ...(deploy.services ?? []),
    secretsWords(deploy.secrets?.length ?? 0),
  ]
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">
        {first.filter(Boolean).join(", ")}
      </Text>
      <Text dimColor wrap="truncate-end">
        {second.join(", ")}
      </Text>
    </Box>
  )
}

/** The selected deploy: who signed it and from which team list, its services and its secrets. */
function DeployDetails({ deploy }: { deploy: DeployRow }) {
  const label = `deploy ${deploy.sequence}`
  const signed = [
    deploy.signer ? `signed by ${deploy.signer}` : undefined,
    deploy.teamVersion ? `from team list v${deploy.teamVersion}` : undefined,
  ]
    .filter(Boolean)
    .join(", ")
  const secrets = deploy.secrets?.length
    ? deploy.secrets
        .map((secret) => `${secret.name} v${secret.version}`)
        .join(", ")
    : "none"
  const rows: [string, ReactNode][] = [[label, signed]]
  if (deploy.services?.length)
    rows.push(["services", deploy.services.join(", ")])
  rows.push(["secrets", secrets])
  return <Fields rows={rows} labelWidth={Math.max(10, label.length + 2)} />
}

export function DeploysPane({
  deploys,
  selected,
  focused,
  now,
  running,
  narrow,
}: {
  deploys?: readonly DeployRow[]
  selected: number
  focused: boolean
  now: Date
  /** The deploy that runs now, when the app is running. */
  running?: number
  /** Below 100 columns: no column names and no "last 50 are kept", as on the board "One app at 80 columns". */
  narrow: boolean
}) {
  const at = clampIndex(selected, deploys?.length ?? 0)
  const chosen = deploys?.[at]
  const when = (deploys ?? []).map((deploy) => clockTime(deploy.at, now))
  // Wide enough for every number and time shown, and never narrower than the board's.
  const numberWidth = Math.max(
    narrow ? NUMBER_WIDTH.narrow : NUMBER_WIDTH.wide,
    ...(deploys ?? []).map((deploy) => String(deploy.sequence).length + 1)
  )
  const whenWidth = Math.max(
    narrow ? WHEN_WIDTH.narrow : WHEN_WIDTH.wide,
    ...when.map((text) => text.length + 1)
  )
  return (
    <Pane
      title="Deploys"
      right={narrow ? undefined : <Text dimColor>last 50 are kept</Text>}
      focused={focused}
    >
      {deploys && deploys.length === 0 ? (
        <Text dimColor>No deploys from this machine yet.</Text>
      ) : null}
      {deploys && deploys.length > 0 ? (
        <Box flexDirection="column" flexShrink={1} overflow="hidden">
          {narrow ? null : (
            <Box>
              <Box width={2} flexShrink={0} />
              <Cell width={numberWidth}>
                <Text dimColor>no.</Text>
              </Cell>
              <Cell>
                <Text dimColor>result</Text>
              </Cell>
              <Cell width={whenWidth}>
                <Text dimColor>when</Text>
              </Cell>
            </Box>
          )}
          {deploys.map((deploy, index) => (
            <Box key={deploy.sequence}>
              <Marker selected={index === at} />
              <Cell width={numberWidth}>
                <Text bold={index === at}>{deploy.sequence}</Text>
              </Cell>
              <Cell>
                <Result
                  deploy={deploy}
                  runningNow={deploy.sequence === running}
                  narrow={narrow}
                />
              </Cell>
              <Cell width={whenWidth}>
                <Text dimColor>{when[index]}</Text>
              </Cell>
            </Box>
          ))}
        </Box>
      ) : null}
      <Box flexGrow={1} />
      {chosen ? (
        <Box flexDirection="column" flexShrink={0}>
          <Rule />
          {narrow ? (
            <NarrowDeployDetails deploy={chosen} />
          ) : (
            <DeployDetails deploy={chosen} />
          )}
        </Box>
      ) : null}
    </Pane>
  )
}
