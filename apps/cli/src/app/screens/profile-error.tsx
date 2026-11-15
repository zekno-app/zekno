import { Box, Text } from "ink"

import { Panel } from "../../ui/parts/panel"
import { useTheme } from "../../ui/terminal/theme"
import { Frame, Header } from "../frame"

/** The width of the labels "folder" and "file", and a space. */
const LABEL_WIDTH = 9

/**
 * Board "Profile could not be verified": shown when `openTeam` fails at
 * start. `reason` is the error's own sentence. There is nothing to do here
 * but quit: nothing is signed or sent from a profile that does not verify.
 */
export function ProfileErrorScreen({ reason, folder }: { reason: string; folder: string }) {
  const theme = useTheme()
  return (
    <Frame header={<Header />} hints={[["q", "quit"]]}>
      <Box flexDirection="column" rowGap={1} paddingX={2}>
        <Box flexDirection="column">
          <Text>
            <Text color={theme.danger}>✖</Text> <Text bold>This machine's Zekno profile could not be verified.</Text>
          </Text>
          <Box paddingLeft={2}>
            <Text dimColor>Nothing was signed and nothing was sent to any server.</Text>
          </Box>
        </Box>

        <Panel title="What was found" tone="danger">
          <Box flexDirection="column" rowGap={1}>
            <Text>{reason}</Text>
            <Box flexDirection="column">
              <Box>
                <Box width={LABEL_WIDTH} flexShrink={0}>
                  <Text dimColor>folder</Text>
                </Box>
                <Text>{folder}</Text>
              </Box>
              <Box>
                <Box width={LABEL_WIDTH} flexShrink={0}>
                  <Text dimColor>file</Text>
                </Box>
                <Text>profile.json</Text>
              </Box>
            </Box>
          </Box>
        </Panel>

        <Text dimColor>
          The profile folder is ordinary files. Zekno checks them against your key every time, and stops when they do not match. This
          usually means the folder was changed, synced or restored by something other than zekno.
        </Text>

        <Box flexDirection="column">
          <Text>If you restored the folder from a backup, restore the matching one.</Text>
          <Text>If you did not expect this, do not deploy from this machine until you know why.</Text>
        </Box>
      </Box>
    </Frame>
  )
}
