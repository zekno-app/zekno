/**
 * What the app's deploy screen draws of a deploy with a domain or a health
 * check (specs/015-domains-https, contracts/cli.md, CL3 and CL6; lines B1,
 * B4 to B6, C2, E8; board `DomainsApp`), with the parts `zekno deploy` draws
 * them with at a terminal (ui/ink/deploy-view.tsx), so both look the same:
 *
 * - B1, each new domain that points to the server, above the panel, as the
 *   terminal says it before its panel (board `DomainsDeploy`);
 * - while the deploy runs, in the live line's place: each new domain's wait
 *   for HTTPS (B4, then B5 or B6), or C2 while a service's health is waited
 *   for, without the seconds the header already counts; else Docker's line;
 * - once it started, each new domain's end of the wait under the result.
 *
 * The rows each takes, for the screen to give Docker's output what is left.
 * A deploy without a domain or a health check draws none of them.
 */
import { Box, Text } from "ink"

import { B1 } from "../../domains/words"
import type { DeployProgress } from "../../shared/deploy"
import {
  HealthWait,
  healthWaitShown,
  HttpsLine,
  httpsRows,
} from "../../ui/ink/deploy-view"
import { MARK, MarkedLine } from "../../ui/ink/marks"
import { wrapPieces, type Piece } from "../../ui/ink/wrap"
import { useTheme } from "../../ui/terminal/theme"

/** B1's words after ✔, the address dim two spaces after them, as the terminal draws its line. */
const pointedPieces = (
  deploy: DeployProgress,
  each: { domain: string; address: string }
): Piece[] => {
  const said = B1(each.domain, deploy.server, each.address)
  return [{ text: `${said.text}  ` }, { text: said.detail, dim: true }]
}

/**
 * How many of the new domains' lines the window has room for, and the rows
 * they take beyond those the screen keeps for its live line or its result:
 * the wait for HTTPS first, from the first domain; then B1, from the first,
 * with the empty line under it. What does not fit is left out, never drawn
 * over the panel or past the window (the screen at 80 columns, and windows
 * of the smallest size the app draws in).
 */
export type Fit = { pointed: number; https: number; rows: number }

/** The rows B1's line for `each` takes `columns` wide. */
const pointedLineRows = (
  deploy: DeployProgress,
  each: { domain: string; address: string },
  columns: number
): number =>
  wrapPieces(pointedPieces(deploy, each), Math.max(1, columns - 2)).length

/** What fits in `spare` rows besides those the screen keeps, `columns` wide (`Fit`). */
export function fitted(
  deploy: DeployProgress,
  spare: number,
  columns: number
): Fit {
  // While it runs, the wait for HTTPS takes the live line's row, which the screen keeps already.
  const kept = deploy.running && deploy.https !== undefined ? 1 : 0
  let room = spare + kept
  let https = 0
  for (const shown of deploy.https ?? []) {
    const rows = httpsRows(shown, columns)
    if (rows > room) break
    room -= rows
    https++
  }
  let pointed = 0
  // The empty line under B1's lines comes with the first.
  room -= 1
  for (const each of deploy.pointed ?? []) {
    const rows = pointedLineRows(deploy, each, columns)
    if (rows > room) break
    room -= rows
    pointed++
  }
  // An empty line is taken only under B1's lines that are drawn.
  const used = spare + kept - room - (pointed === 0 ? 1 : 0)
  return { pointed, https, rows: used - kept }
}

/** B1, a line a new domain that fits (`Fit`), above the panel; nothing for a deploy that has none. */
export function PointedLines({
  deploy,
  columns,
  fit,
}: {
  deploy: DeployProgress
  columns: number
  fit: Fit
}) {
  const theme = useTheme()
  const pointed = (deploy.pointed ?? []).slice(0, fit.pointed)
  if (pointed.length === 0) return null
  return (
    <Box flexDirection="column" flexShrink={0}>
      {pointed.map((each) => (
        <MarkedLine
          key={each.domain}
          mark={MARK.success}
          color={theme.success}
          pieces={pointedPieces(deploy, each)}
          columns={columns}
        />
      ))}
    </Box>
  )
}

/** Each new domain's line of the wait for HTTPS that fits: B4 while it is waited for, B5 or B6 once it is over. */
export function HttpsLines({
  deploy,
  columns,
  fit,
}: {
  deploy: DeployProgress
  columns: number
  fit: Fit
}) {
  const https = (deploy.https ?? []).slice(0, fit.https)
  if (https.length === 0) return null
  return (
    <Box flexDirection="column" flexShrink={0}>
      {https.map((shown) => (
        <HttpsLine key={shown.domain} shown={shown} columns={columns} />
      ))}
    </Box>
  )
}

/**
 * The live line's place while the deploy runs: the wait for HTTPS, C2, or
 * the latest of Docker's lines, which is left out while Docker's output is
 * shown in full (`output`).
 */
export function LiveLines({
  deploy,
  output,
  columns,
  fit,
}: {
  deploy: DeployProgress
  output: boolean
  columns: number
  fit: Fit
}) {
  if (deploy.https !== undefined)
    return <HttpsLines deploy={deploy} columns={columns} fit={fit} />
  if (healthWaitShown(deploy))
    return <HealthWait deploy={deploy} seconds={false} />
  if (output) return null
  return (
    <Text dimColor wrap="truncate-end">
      {deploy.lines.at(-1) ?? " "}
    </Text>
  )
}
