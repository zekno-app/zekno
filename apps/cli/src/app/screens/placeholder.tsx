import { Box, Text } from "ink"
import type { ReactNode } from "react"

import type { KeyHint } from "../../ui/parts/key-hints"
import { Frame, Header, Trail } from "../frame"
import type { Screen, State } from "../state/types"

/** Each screen's key hints, as its board's last line shows them. */
export const HINTS: Record<
  Exclude<Screen["name"], "help" | "profile-error">,
  readonly KeyHint[]
> = {
  home: [
    ["↑↓", "move"],
    ["←→", "pane"],
    ["enter", "open"],
    ["a", "add"],
    ["?", "help"],
    ["q", "quit"],
  ],
  app: [
    ["d", "deploy"],
    ["r", "roll back to selected"],
    ["l", "logs"],
    ["s", "set secret"],
    ["x", "remove secret"],
    ["e", "settings"],
    ["tab", "pane"],
    ["esc", "back"],
  ],
  // Showing the settings (board `AppSettings`); its other hint lines are in settings-layout.ts.
  settings: [
    ["↑↓", "move"],
    ["enter", "change"],
    ["tab", "services"],
    ["c", "Compose text"],
    ["d", "deploy"],
    ["esc", "back"],
  ],
  deploy: [
    ["o", "show Docker's output"],
    ["esc", "back, deploy keeps going"],
  ],
  logs: [
    ["f", "pause following"],
    ["/", "filter"],
    ["1-9", "one service"],
    ["↑↓", "scroll"],
    ["esc", "back"],
  ],
  welcome: [
    ["enter", "create the key"],
    ["esc", "quit"],
  ],
  "add-server": [
    ["o", "show details"],
    ["esc", "cancel"],
  ],
  "set-secret": [
    ["enter", "save"],
    ["esc", "cancel"],
  ],
}

/** What each screen is called when it is talked about. */
const TITLES: Record<keyof typeof HINTS, string> = {
  home: "Home",
  app: "The app screen",
  deploy: "The deploy screen",
  logs: "The logs screen",
  welcome: "First run",
  "add-server": "Adding a server",
  "set-secret": "Setting a secret",
  settings: "The settings screen",
}

/** The screen's place in the header, as its board shows it. */
function placeOf(state: State, screen: Screen): ReactNode {
  switch (screen.name) {
    case "home":
      return state.team ? (
        <Text dimColor>{state.team.member}'s team</Text>
      ) : null
    case "app":
      return <Trail parts={[screen.server, screen.app]} />
    case "deploy":
      return (
        <Trail
          parts={[
            state.deploy?.server ?? "",
            state.deploy?.app ?? "",
            "deploy",
          ]}
        />
      )
    case "logs":
      return <Trail parts={[screen.server, screen.app, "logs"]} />
    case "welcome":
      return <Text dimColor>welcome</Text>
    case "add-server":
      return <Trail parts={["add a server"]} />
    case "set-secret":
      return <Trail parts={[screen.server, screen.app, "set a secret"]} />
    case "settings":
      return <Trail parts={[screen.server, screen.app, "settings"]} />
    default:
      return null
  }
}

/**
 * A screen that a later part of this feature draws. Its keys already work;
 * this says plainly that the screen itself is not there yet.
 */
export function Placeholder({
  state,
  screen,
  status,
}: {
  state: State
  screen: Exclude<Screen, { name: "help" | "profile-error" }>
  status?: ReactNode
}) {
  return (
    <Frame
      header={
        <Header
          place={placeOf(state, screen)}
          logo={screen.name !== "welcome"}
        />
      }
      hints={HINTS[screen.name]}
      status={status}
    >
      <Box flexDirection="column" paddingX={2}>
        <Text bold>{TITLES[screen.name]} is not built yet.</Text>
        <Text dimColor>Single commands for scripts: zekno --help</Text>
      </Box>
    </Frame>
  )
}
