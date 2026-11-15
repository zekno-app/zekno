import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { Confirm } from "../../ui/parts/confirm"
import type { KeyHint } from "../../ui/parts/key-hints"
import { Panel } from "../../ui/parts/panel"
import { TextQuestion } from "../../ui/parts/text-input"
import { useTheme } from "../../ui/terminal/theme"
import { Frame, Header, Trail } from "../frame"
import { CHOICES, promptedName, skipValuesTitle, type Question, type Screen, type State } from "../state/state"
import { Cell, Marker } from "./parts"
import { HINTS } from "./placeholder"

type SetSecretState = Extract<Screen, { name: "set-secret" }>
type SkipQuestion = Extract<Question, { kind: "skip-values" }>

/** The width of the name column in the list of missing values. */
const NAME_WIDTH = 26

/** The answers to "deploy without them?", the reducer's own (state.ts `CHOICES`). */
const SKIP_HINTS: readonly KeyHint[] = CHOICES["skip-values"].map((choice) => [choice.key, choice.does] as const)

const PASTING = "Pasting is fine. Nothing shows, not even the length."
const stdinHint = (name: string) => `For a value of several lines, use: zekno secret set ${name} --stdin < file`
const encrypted = (server: string) => `Encrypted on this machine for ${server}'s key and signed by you.`
const ONCE = "It cannot be shown again after it is set, only replaced."

/**
 * How many lines a text takes in `width` columns, wrapped at spaces as Ink
 * wraps it, a word longer than a line broken where the line ends. The texts
 * measured here hold names of plain ASCII letters, so a character is a column.
 */
export function wrappedLines(text: string, width: number): number {
  const room = Math.max(width, 1)
  let lines = 1
  let used = 0
  for (const word of text.split(" ")) {
    if (used > 0 && used + 1 + word.length <= room) {
      used += 1 + word.length
      continue
    }
    if (used > 0) lines++
    used = word.length
    while (used > room) {
      lines++
      used -= room
    }
  }
  return lines
}

/**
 * Which of `count` names are drawn in `rows` lines, so that the one at `at`
 * always is: all of them when they fit; otherwise a window around it, and a
 * last line saying how many are not drawn.
 */
export function nameWindow(count: number, at: number, rows: number): { start: number; end: number; hidden: number } {
  if (count <= rows) return { start: 0, end: count, hidden: 0 }
  const shown = Math.max(1, rows - 1)
  const start = Math.min(Math.max(0, at - Math.floor(shown / 2)), count - shown)
  return { start, end: start + shown, hidden: count - shown }
}

/**
 * The lines the list of missing names may take: what the window leaves after
 * the header, the line above the key hints (kept whether or not it says
 * something, so the list does not jump), the two lines that say what is
 * missing, the question that is open and the two lines at the foot, with the
 * gaps between them. Never fewer than two, so the marked name is always drawn.
 */
function listRows(screen: SetSecretState, name: string, columns: number, rows: number, asked: "value" | "skip" | undefined, status: boolean): number {
  const frame = 3 + 1 + 1 + 1 + (status ? 2 : 0)
  // The app's margins and this body's padding.
  const body = columns - 2 - 4
  const panel = Math.min(columns - 6, 80) - 4
  const question = asked === "value" ? 1 + 4 + wrappedLines(PASTING, panel) + wrappedLines(stdinHint(name), panel) : asked === "skip" ? 1 + 3 : 0
  const foot = 1 + wrappedLines(encrypted(screen.server), body) + wrappedLines(ONCE, body)
  return Math.max(2, rows - frame - 2 - 1 - question - foot)
}

/** What the list before a deploy is about: how many values the Compose file expects that are not set yet, and what esc does. */
function MissingNote({ screen }: { screen: SetSecretState }) {
  const theme = useTheme()
  const left = screen.missing.filter((name) => !screen.done.includes(name)).length
  const one = left === 1
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text color={theme.warning} wrap="truncate-end">
        ! {screen.file ?? "The Compose file"} expects {left} value{one ? "" : "s"} that {one ? "is" : "are"} not set yet.
      </Text>
      <Text dimColor wrap="truncate-end">
        {one ? "Set it now, or press esc and deploy without it." : "Set them now, or press esc and deploy without them."}
      </Text>
    </Box>
  )
}

/**
 * The names a Compose file expects that have no secret, before a deploy, with
 * the one being asked for marked, and whether each has been set since. Names
 * only: a value is never shown. Only as many as fit in `rows` are drawn, the
 * marked one always among them.
 */
function Missing({ screen, rows }: { screen: SetSecretState; rows: number }) {
  const { start, end, hidden } = nameWindow(screen.missing.length, screen.at, rows)
  return (
    <Box flexDirection="column" flexShrink={0}>
      {screen.missing.slice(start, end).map((name, offset) => {
        const index = start + offset
        return (
          <Box key={name}>
            <Marker selected={index === screen.at} />
            <Cell width={NAME_WIDTH}>
              <Text bold={index === screen.at}>{name}</Text>
            </Cell>
            <Text dimColor>{screen.done.includes(name) ? "set" : "not set"}</Text>
          </Box>
        )
      })}
      {hidden > 0 ? (
        <Box paddingLeft={2}>
          <Text dimColor>and {hidden} more</Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** Esc on the list before a deploy: whether to go ahead without the values not set (board "Two questions the app asks"). */
function SkipQuestion({ question, width }: { question: SkipQuestion; width: number }) {
  return (
    <Box width={width} flexShrink={0}>
      <Confirm title={skipValuesTitle(question)} tone="warning" choices={CHOICES["skip-values"]} />
    </Box>
  )
}

/**
 * The hidden question, as on the board: nothing of the value is drawn, not
 * even its length. The value is never passed in here; app.tsx keeps it out
 * of the state, and only the cursor shows.
 */
function ValueQuestion({ name, width }: { name: string; width: number }) {
  return (
    <Box width={width} flexShrink={0}>
      <Panel title={name} tone="focus" flexGrow={1}>
        <Box flexDirection="column" rowGap={1}>
          <TextQuestion label="Value" hidden note="hidden as you type" />
          <Box flexDirection="column">
            <Text dimColor>{PASTING}</Text>
            <Text dimColor>{stdinHint(name)}</Text>
          </Box>
        </Box>
      </Panel>
    </Box>
  )
}

/** The question for a new secret's name. Letters type into it. */
function NameQuestion({ value, width }: { value: string; width: number }) {
  return (
    <Box width={width}>
      <Panel title="New secret" tone="focus" flexGrow={1}>
        <Box flexDirection="column" rowGap={1}>
          <TextQuestion label="Name" value={value} />
          <Text dimColor>Letters, digits and underscore. It does not start with a digit.</Text>
        </Box>
      </Panel>
    </Box>
  )
}

/**
 * Board "Set a secret": the name, then the hidden value, for one app on one
 * server. Before a deploy (`missing`), the names the Compose file expects
 * and that have no secret are listed under a line that says so, and asked
 * for one by one. Esc at the prompt goes back to the list; esc on the list
 * asks whether to deploy without the rest, and only "y" does.
 */
export function SetSecretScreen({
  state,
  screen,
  columns,
  rows,
  status,
}: {
  state: State
  screen: SetSecretState
  columns: number
  rows: number
  status?: ReactNode
}) {
  const width = Math.min(columns - 6, 80)
  const asking = promptedName(state)
  const before = screen.missing.length > 0
  const skip = state.question?.kind === "skip-values" ? state.question : undefined
  const right = before ? <Text dimColor>{`${Math.min(screen.at + 1, screen.missing.length)} of ${screen.missing.length}`}</Text> : undefined
  const hints: readonly KeyHint[] = skip
    ? SKIP_HINTS
    : screen.question === "name"
      ? [
          ["enter", "continue"],
          ["esc", "cancel"],
        ]
      : screen.question === undefined && before
        ? [
            ["↑↓", "move"],
            ["enter", "set"],
            ["esc", "deploy without them"],
          ]
        : HINTS["set-secret"]
  const asked = skip ? "skip" : screen.question === "value" && asking !== undefined ? "value" : undefined
  return (
    <Frame header={<Header place={<Trail parts={[screen.server, screen.app, "set a secret"]} />} right={right} />} hints={hints} status={status}>
      <Box flexDirection="column" rowGap={1} paddingX={2}>
        {before ? <MissingNote screen={screen} /> : null}
        {before ? <Missing screen={screen} rows={listRows(screen, asking ?? "", columns, rows, asked, status !== undefined)} /> : null}
        {skip ? <SkipQuestion question={skip} width={width} /> : null}
        {!skip && screen.question === "name" ? <NameQuestion value={screen.secretName} width={width} /> : null}
        {!skip && asked === "value" ? <ValueQuestion name={asking!} width={width} /> : null}
        <Box flexDirection="column" flexShrink={0}>
          <Text dimColor>{encrypted(screen.server)}</Text>
          <Text dimColor>{ONCE}</Text>
        </Box>
      </Box>
    </Frame>
  )
}
