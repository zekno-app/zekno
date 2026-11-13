import { Box, Text, useAnimation } from "ink"
import type { ReactNode } from "react"

import type { DeployStage } from "../../ops/deploy"
import type { KeyHint } from "../../ui/key-hints"
import { Panel } from "../../ui/panel"
import { Stages, type Stage, type StageState } from "../../ui/stages"
import { Frame, Header, NoticeLine, Trail } from "../frame"
import type { DeployProgress, Screen, State } from "../state"
import { seconds } from "../time"
import { Fields } from "./parts"
import { HINTS } from "./placeholder"

type DeployScreenState = Extract<Screen, { name: "deploy" }>

const LABELS = ["Checked", "Signed", "Sent", "Starting"] as const
/** How many stages are done once each stage has been reached. */
const DONE: Record<DeployStage, number> = { checked: 1, signed: 2, sent: 3, starting: 3, started: 4, failed: 3 }

/**
 * The stage row: done, the one in progress, and those not reached yet. A
 * deploy that started ends with ✔ Started; one that did not start, or was
 * refused, marks the stage it stopped at with ✖ (data-model.md, "Stages of
 * a deploy").
 */
export function stagesOf(deploy: DeployProgress): Stage[] {
  const done = deploy.stage === undefined ? 0 : DONE[deploy.stage]
  return LABELS.map((label, index): Stage => {
    let state: StageState = "pending"
    if (index < done) state = "done"
    else if (index === done) state = deploy.running ? "active" : deploy.outcome === "started" ? "done" : "failed"
    return { label: index === 3 && deploy.outcome === "started" ? "Started" : label, state }
  })
}

/** The number is used once the deploy was signed, whatever happened after. */
export function numberUsed(deploy: DeployProgress): boolean {
  return !deploy.running && deploy.outcome !== "started" && deploy.sequence !== undefined && deploy.stage !== undefined && deploy.stage !== "checked"
}

/** How long the deploy has taken: counting while it runs, fixed once it ended. */
function Elapsed({ deploy }: { deploy: DeployProgress }) {
  // Redraws this one line ten times a second while the deploy runs, and never after.
  useAnimation({ interval: 100, isActive: deploy.running })
  const end = deploy.endedAt ?? Date.now()
  return <Text dimColor>{seconds(end - deploy.since)}</Text>
}

/** The summary panel: the number, app, server, where the definition comes from, the secrets and what it replaces. */
function Summary({ deploy, width }: { deploy: DeployProgress; width: number }) {
  const names = deploy.secretNames ?? []
  const count = deploy.secrets ?? names.length
  const secrets = (
    <Text>
      {count === 0 ? "none" : count}
      {count > 0 && names.length > 0 ? <Text dimColor> ({names.join(", ")})</Text> : null}
    </Text>
  )
  const rows: [string, ReactNode][] = [
    ["app", deploy.app],
    ["server", deploy.server],
  ]
  if (deploy.from) rows.push(["from", deploy.from])
  rows.push(["secrets", secrets])
  if (deploy.replaces !== undefined) rows.push(["replaces", `deploy ${deploy.replaces}`])
  return (
    <Box width={width}>
      <Panel title={deploy.sequence === undefined ? "Deploy" : `Deploy ${deploy.sequence}`} tone="focus" flexGrow={1}>
        <Fields rows={rows} labelWidth={10} />
      </Panel>
    </Box>
  )
}

/** Columns one character takes, generously: every character from the first wide script on counts as two. */
const columnsOf = (char: string) => (char.codePointAt(0)! >= 0x1100 ? 2 : 1)

/** How many terminal lines a line of text takes at `width` columns, never thought shorter than it is drawn. */
function linesFor(text: string, width: number): number {
  let columns = 0
  for (const char of text) columns += columnsOf(char)
  return Math.max(1, Math.ceil(columns / Math.max(width, 1)))
}

/** The end of a line that is too long for `rows` lines on its own, after `…`. */
function tailOf(text: string, rows: number, width: number): string {
  const chars = [...text]
  let room = rows * Math.max(width, 1) - 1
  let start = chars.length
  while (start > 0 && room - columnsOf(chars[start - 1]!) >= 0) room -= columnsOf(chars[--start]!)
  return `…${chars.slice(start).join("")}`
}

/**
 * The last of Docker's lines that fit in `rows` lines at `width` columns,
 * whole: the end of Docker's output is where it says what went wrong. A last
 * line too long by itself is shown by its end.
 */
export function lastLines(lines: readonly string[], rows: number, width: number): string[] {
  const kept: string[] = []
  let used = 0
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!
    const needs = linesFor(line, width)
    if (kept.length === 0 && needs > rows) return [tailOf(line, rows, width)]
    if (used + needs > rows) break
    used += needs
    kept.unshift(line)
  }
  return kept
}

/** Docker's lines, the last that fit. */
function DockerLines({ lines, rows, width }: { lines: readonly string[]; rows: number; width: number }) {
  return (
    <Box flexDirection="column">
      {lastLines(lines, rows, width).map((line, index) => (
        <Text key={index}>{line}</Text>
      ))}
    </Box>
  )
}

/** How it ended: the result line and, when its number was used without the app starting, that the number is used. */
function Outcome({ deploy }: { deploy: DeployProgress }) {
  if (!deploy.result) return null
  return (
    <Box flexDirection="column">
      <NoticeLine notice={deploy.result} />
      {numberUsed(deploy) ? (
        <Box paddingLeft={2}>
          <Text dimColor>
            Number {deploy.sequence} is used, so the next deploy will be {deploy.sequence! + 1}.
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

/**
 * Lines of the window the deploy screen uses besides Docker's lines: the
 * app's margin rows, the header and the key hints with the gaps between,
 * the summary panel, the stage row, the result and the gaps between them.
 */
function outputRows(rows: number, deploy: DeployProgress, status: boolean): number {
  const panel = 2 + 2 + (deploy.from ? 1 : 0) + 1 + (deploy.replaces !== undefined ? 1 : 0)
  const frame = 3 + 1 + 1 + 1 + (status ? 2 : 0)
  const result = deploy.running ? 2 : numberUsed(deploy) ? 3 : 2
  const footer = deploy.running ? 2 : 0
  return Math.max(1, rows - frame - panel - 1 - 1 - 1 - result - 1 - 2 - footer)
}

/**
 * Board "A deploy in progress": the summary panel, the stage row and one
 * live line, the latest of Docker's lines. `o` shows the lines kept so far
 * instead. When the app did not start, what Docker reported is shown and the
 * number is said to be used. Leaving does not cancel the deploy.
 */
export function DeployScreen({
  state,
  screen,
  columns,
  rows,
  status,
}: {
  state: State
  screen: DeployScreenState
  columns: number
  rows: number
  status?: ReactNode
}) {
  const deploy = state.deploy
  if (!deploy) return null
  const failed = !deploy.running && deploy.outcome === "start_failed"
  // Once it ended, the result is drawn in full here; a line about it below would say it twice.
  const shownStatus = deploy.running || state.quitting ? status : undefined
  const showLines = (screen.output || failed) && deploy.lines.length > 0
  const count = outputRows(rows, deploy, shownStatus !== undefined)
  const hints: readonly KeyHint[] = [
    ["o", screen.output ? "hide Docker's output" : "show Docker's output"],
    ["esc", deploy.running ? "back, deploy keeps going" : "back"],
  ]
  const header = (
    <Header place={<Trail parts={[deploy.server, deploy.app, "deploy"]} />} right={<Elapsed deploy={deploy} />} />
  )
  return (
    <Frame header={header} hints={screen.output || !deploy.running ? hints : HINTS.deploy} status={shownStatus}>
      <Box flexDirection="column" flexGrow={1} rowGap={1} paddingX={2}>
        <Summary deploy={deploy} width={Math.min(columns - 6, 64)} />
        <Stages stages={stagesOf(deploy)} />
        {deploy.running ? (
          screen.output ? null : (
            <Text dimColor wrap="truncate-end">
              {deploy.lines.at(-1) ?? " "}
            </Text>
          )
        ) : (
          <Outcome deploy={deploy} />
        )}
        {showLines ? (
          <Panel title={failed ? "Docker said" : "Docker's output"} tone={failed ? "danger" : "quiet"}>
            {/* The app's margins, this body's padding, and the panel's border and padding. */}
            <DockerLines lines={deploy.lines} rows={count} width={columns - 2 - 4 - 4} />
          </Panel>
        ) : null}
        {deploy.running ? (
          <>
            <Box flexGrow={1} />
            <Text dimColor>Leaving this screen does not cancel the deploy. Quitting zekno waits for it to finish.</Text>
          </>
        ) : null}
      </Box>
    </Frame>
  )
}
