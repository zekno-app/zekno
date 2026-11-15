import { Box, Text } from "ink"
import type { ReactNode } from "react"

import type { KeyHint } from "../../ui/parts/key-hints"
import { Panel } from "../../ui/parts/panel"
import { StageMark, type StageState } from "../../ui/parts/stages"
import { useTheme } from "../../ui/terminal/theme"
import { Frame, Header, Trail } from "../frame"
import { ADD_STEPS, LOCAL_ADD_STEPS, type AddProgress, type AddStepName, type Screen, type State } from "../state/state"
import { lastLines } from "./deploy"
import { HINTS } from "./placeholder"
import { FirstRunSteps } from "./welcome"

type AddServerState = Extract<Screen, { name: "add-server" }>

/** The width of the label column of the destination and the name, and of the right-hand detail of each step. */
const LABEL_WIDTH = 18
const DETAIL_WIDTH = 24
/** At 100 columns and more, the codes' column and the steps' details have the room the board gives them. */
const WIDE = 100
/** Once the server was added: the screen stays for its code to be read, and enter leaves it (esc does too). */
const DONE_HINTS: readonly KeyHint[] = [["enter", "done"]]

/** What each step is called before it starts, while it runs, and once done; the board shows one of each. */
function wordsOf(step: AddStepName, name: string, local: boolean): { todo: string; doing: string; done: string; found?: string } {
  switch (step) {
    case "connect":
      return local
        ? { todo: "Start the runner on this machine", doing: "Starting the runner on this machine", done: "Runner started on this machine" }
        : { todo: "Connect over SSH", doing: "Connecting over SSH", done: "Connected over SSH" }
    case "docker":
      return { todo: "Find Docker with Compose", doing: "Looking for Docker with Compose", done: "Docker with Compose found" }
    case "runner":
      return { todo: "Install the runner", doing: "Installing the runner", done: "Runner installed", found: "Runner found" }
    case "set_up":
      return { todo: "Set the runner up for your team", doing: "Setting the runner up for your team", done: "Runner set up for your team" }
    case "added":
      return { todo: `Add ${name} to the signed team list`, doing: `Adding ${name} to the signed team list`, done: `Added ${name} to the signed team list` }
  }
}

/** One row of the steps: its mark and words, and what was found on the right. */
export type AddRow = { step: AddStepName; label: string; state: StageState; detail?: string }

/**
 * The steps as the board shows them: done with ✔ and what was found, the one
 * in progress with the spinner, the one it stopped at with ✖, the rest ○.
 */
export function addRows(adding: AddProgress | undefined, name: string, local: boolean): AddRow[] {
  const steps = local ? LOCAL_ADD_STEPS : ADD_STEPS
  let current = adding?.running === true
  return steps.map((step) => {
    const words = wordsOf(step, name || "the server", local)
    const ended = adding?.steps[step]
    if (ended?.state === "done") return { step, label: ended.found && words.found ? words.found : words.done, state: "done", detail: ended.detail }
    if (ended?.state === "failed") return { step, label: words.todo, state: "failed" }
    if (current) {
      current = false
      return { step, label: words.doing, state: "active" }
    }
    return { step, label: words.todo, state: "pending" }
  })
}

/** The destination and the name: answered with ✔, being asked with ? and the cursor, not asked yet ○. */
function Answers({ screen }: { screen: AddServerState }) {
  const theme = useTheme()
  const row = (label: string, value: string, state: "answered" | "asking" | "later") => (
    <Box key={label}>
      <Box width={2} flexShrink={0}>
        {state === "answered" ? <Text color={theme.success}>✔</Text> : state === "asking" ? <Text color={theme.brand}>?</Text> : <Text dimColor>○</Text>}
      </Box>
      <Box width={LABEL_WIDTH} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Text wrap="truncate-end">
        {value}
        {state === "asking" ? <Text inverse> </Text> : null}
      </Text>
    </Box>
  )
  const destination = screen.step === "destination" ? "asking" : "answered"
  const name = screen.step === "destination" ? "later" : screen.step === "name" ? "asking" : "answered"
  return (
    <Box flexDirection="column" flexShrink={0}>
      {row("SSH destination", screen.destination, destination)}
      {row("Name it", screen.serverName, name)}
    </Box>
  )
}

/**
 * The steps, one line each. Wide, what was found is in a column of its own
 * on the right, as on the board; narrower, it follows the step's words.
 */
function Steps({ rows, wide }: { rows: readonly AddRow[]; wide: boolean }) {
  return (
    <Box flexDirection="column" flexShrink={0}>
      {rows.map((row) => {
        const stage = <StageMark stage={{ label: row.label, state: row.state }} />
        if (!wide) {
          return (
            <Text key={row.step} wrap="truncate-end">
              {stage}
              {row.detail ? <Text dimColor>{`  ${row.detail}`}</Text> : null}
            </Text>
          )
        }
        return (
          <Box key={row.step}>
            <Box flexGrow={1} flexShrink={1} flexBasis={0} paddingRight={1}>
              <Text wrap="truncate-end">{stage}</Text>
            </Box>
            <Box width={DETAIL_WIDTH} flexShrink={0}>
              <Text dimColor wrap="truncate-end">
                {row.detail ?? ""}
              </Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

/** A code in its own faint box: the code, or why it is not there yet, and what it identifies. */
function CodePanel({ title, code, waiting, about, roomy }: { title: string; code?: string; waiting: string; about: string; roomy: boolean }) {
  return (
    <Panel title={title} tone="quiet">
      <Box flexDirection="column" rowGap={roomy ? 1 : 0}>
        {code ? <Text bold>{code}</Text> : <Text dimColor>{waiting}</Text>}
        <Text dimColor>{about}</Text>
      </Box>
    </Panel>
  )
}

/** The lines the server printed while it was added, the last that fit, cleaned when they arrived. */
function Details({ lines, rows, width }: { lines: readonly string[]; rows: number; width: number }) {
  return (
    <Panel title="Details" tone="quiet">
      {lines.length === 0 ? (
        <Text dimColor>The server has printed nothing.</Text>
      ) : (
        <Box flexDirection="column">
          {lastLines(lines, rows, width).map((line, index) => (
            <Text key={index}>{line}</Text>
          ))}
        </Box>
      )}
    </Panel>
  )
}

/**
 * Board "Add a server": the destination and the name, each step as it
 * completes with what was found, and the team code and the server code each
 * with what it identifies. `o` shows what the server printed. As step 2 of
 * first run, the header shows the three steps. Once the server is added the
 * screen stays, every step ticked and the server code in its panel, until
 * enter (or esc) goes to Home.
 */
export function AddServerScreen({
  state,
  screen,
  columns,
  rows,
  status,
}: {
  state: State
  screen: AddServerState
  columns: number
  rows: number
  status?: ReactNode
}) {
  const adding = state.adding
  const local = adding?.local ?? false
  const working = screen.step === "working"
  const wide = columns >= WIDE
  const right = wide ? 30 : 28
  const hints: readonly KeyHint[] =
    screen.step === "done"
      ? DONE_HINTS
      : !working
        ? [
            ["enter", "continue"],
            ["esc", "cancel"],
          ]
        : screen.output
          ? [
              ["o", "hide details"],
              ["esc", "cancel"],
            ]
          : HINTS["add-server"]
  // As step 2 of first run the three steps are on the header's right, as on the board; narrower, they open the body.
  const steps = screen.firstRun ? <FirstRunSteps current={2} /> : null
  const header = <Header place={<Trail parts={["add a server"]} />} {...(steps && wide ? { right: steps } : {})} />
  // The app's margins, the body's padding and gap, the right-hand column, and a panel's border and padding.
  const detailWidth = columns - 2 - 2 - 3 - right - 4
  const detailRows = Math.max(2, rows - 22 - (status ? 2 : 0) - (steps && !wide ? 2 : 0))
  return (
    <Frame header={header} hints={hints} status={status}>
      <Box flexGrow={1} columnGap={3} paddingX={1}>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} rowGap={1}>
          {steps && !wide ? steps : null}
          <Answers screen={screen} />
          <Steps rows={addRows(adding, screen.serverName.trim(), local)} wide={wide} />
          {working && screen.output ? (
            <Details lines={adding?.lines ?? []} rows={detailRows} width={detailWidth} />
          ) : (
            <>
              <Box flexGrow={1} />
              {local ? null : (
                <Text dimColor>
                  You do not need to log in to the server. The runner is downloaded by the server itself and checked before it is installed.
                </Text>
              )}
            </>
          )}
        </Box>
        <Box flexDirection="column" width={right} flexShrink={0} rowGap={wide ? 1 : 0}>
          <CodePanel
            title="Team code"
            code={state.team?.code}
            waiting="Appears once your key is created."
            about="Identifies your team. A server checks it before it agrees to obey your team."
            roomy={wide}
          />
          <CodePanel
            title="Server code"
            code={adding?.serverCode}
            waiting="Appears when setup finishes."
            about="Identifies this server's key. Teammates compare it before they trust the server."
            roomy={wide}
          />
        </Box>
      </Box>
    </Frame>
  )
}
