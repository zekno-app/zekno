/**
 * The question Home asks when the runner on a server is older than this
 * zekno (home.tsx), and its answers.
 */
import { Box, Text } from "ink"

import { RUNNER_RELEASE } from "../../../version/runner-release"
import { Confirm } from "../../../ui/parts/confirm"
import type { KeyHint } from "../../../ui/parts/key-hints"
import { CHOICES } from "../../state/questions"
import type { ServerRow } from "../../state/types"

/** What does not work with an older runner until it is updated, as the question `u` asks says it. */
export const MISSING_WORDS = {
  "state and logs":
    "Deploys still work. Running state and logs need the newer runner.",
  some: "Deploys still work. Some of what this zekno does needs the newer runner.",
  nothing: "Everything works with it.",
} as const

/** The answers to "update the runner?", the reducer's own (state/questions.ts `CHOICES`). */
export const UPDATE_HINTS: readonly KeyHint[] = CHOICES["update-runner"].map(
  (choice) => [choice.key, choice.does] as const
)

/**
 * Board "Two questions the app asks", right half: the runner on a server is
 * older than this zekno. What does not work until it is updated is said by
 * what it lacks (contracts/versions.md, "The app"); updating is offered and
 * done only on `u`.
 */
export function UpdateQuestion({
  server,
  columns,
}: {
  server: ServerRow
  columns: number
}) {
  return (
    <Box width={Math.min(columns - 2, 64)}>
      <Confirm
        title={`The runner on ${server.name} is out of date`}
        tone="warning"
        choices={CHOICES["update-runner"]}
      >
        <Box flexDirection="column">
          <Box>
            <Box width={14} flexShrink={0}>
              <Text dimColor>on {server.name}</Text>
            </Box>
            <Text>{server.runner?.version ?? "no version reported"}</Text>
          </Box>
          <Box>
            <Box width={14} flexShrink={0}>
              <Text dimColor>this zekno</Text>
            </Box>
            <Text>{RUNNER_RELEASE.version}</Text>
          </Box>
        </Box>
        <Text>{MISSING_WORDS[server.runner?.missing ?? "state and logs"]}</Text>
        <Text dimColor>
          Updating downloads the runner on {server.name} and checks it before it
          replaces the old one. Your apps keep running.
        </Text>
      </Confirm>
    </Box>
  )
}
