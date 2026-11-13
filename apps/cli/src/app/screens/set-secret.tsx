import { Box, Text } from "ink"
import type { ReactNode } from "react"

import type { KeyHint } from "../../ui/key-hints"
import { Panel } from "../../ui/panel"
import { TextQuestion } from "../../ui/text-input"
import { Frame, Header, Trail } from "../frame"
import { promptedName, type Screen, type State } from "../state"
import { Cell, Marker } from "./parts"
import { HINTS } from "./placeholder"

type SetSecretState = Extract<Screen, { name: "set-secret" }>

/** The width of the name column in the list of missing values. */
const NAME_WIDTH = 26

/** The names a Compose file expects that have no secret, before a deploy, with the one being asked for marked. */
function Missing({ screen }: { screen: SetSecretState }) {
  return (
    <Box flexDirection="column">
      {screen.missing.map((name, index) => (
        <Box key={name}>
          <Marker selected={index === screen.at} />
          <Cell width={NAME_WIDTH}>
            <Text bold={index === screen.at}>{name}</Text>
          </Cell>
          <Text dimColor>not set</Text>
        </Box>
      ))}
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
    <Box width={width}>
      <Panel title={name} tone="focus" flexGrow={1}>
        <Box flexDirection="column" rowGap={1}>
          <TextQuestion label="Value" hidden note="hidden as you type" />
          <Box flexDirection="column">
            <Text dimColor>Pasting is fine. Nothing shows, not even the length.</Text>
            <Text dimColor>For a value of several lines, use: zekno secret set {name} --stdin &lt; file</Text>
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
 * are listed and asked for one by one.
 */
export function SetSecretScreen({
  state,
  screen,
  columns,
  status,
}: {
  state: State
  screen: SetSecretState
  columns: number
  status?: ReactNode
}) {
  const width = Math.min(columns - 6, 80)
  const asking = promptedName(state)
  const before = screen.missing.length > 0
  const right = before ? <Text dimColor>{`${Math.min(screen.at + 1, screen.missing.length)} of ${screen.missing.length}`}</Text> : undefined
  const hints: readonly KeyHint[] =
    screen.question === "name"
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
  return (
    <Frame header={<Header place={<Trail parts={[screen.server, screen.app, "set a secret"]} />} right={right} />} hints={hints} status={status}>
      <Box flexDirection="column" rowGap={1} paddingX={2}>
        {before ? <Missing screen={screen} /> : null}
        {screen.question === "name" ? <NameQuestion value={screen.secretName} width={width} /> : null}
        {screen.question === "value" && asking !== undefined ? <ValueQuestion name={asking} width={width} /> : null}
        <Box flexDirection="column">
          <Text dimColor>Encrypted on this machine for {screen.server}'s key and signed by you.</Text>
          <Text dimColor>It cannot be shown again after it is set, only replaced.</Text>
        </Box>
      </Box>
    </Frame>
  )
}
