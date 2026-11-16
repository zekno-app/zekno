/** Home's key hints (home.tsx), for the width, the pane that has the keys and the selected server. */
import type { KeyHint } from "../../../ui/parts/key-hints"
import type { ServerRow } from "../../state/types"
import { HINTS } from "../placeholder"
import { needsAnswerHere } from "./servers"

/**
 * Home's key hints below 100 columns, as on the board "Home at 80 columns":
 * there is no details pane, so its actions are keys here.
 */
export const NARROW_HOME_HINTS: readonly KeyHint[] = [
  ["↑↓", "move"],
  ["←→", "pane"],
  ["enter", "open"],
  ["d", "deploy"],
  ["r", "roll back"],
  ["l", "logs"],
  ["s", "secrets"],
  ["a", "add"],
  ["?", "help"],
  ["q", "quit"],
]

/**
 * Home's key hints: the board's for the width; `u` while the selected
 * server's runner is older than this zekno (contracts/versions.md); and `enter connect` in
 * place of `enter open` while the servers pane has the keys and its marked
 * server is one SSH needs an answer to reach.
 */
export function homeHints(
  server: ServerRow | undefined,
  narrow = false,
  pane: "servers" | "apps" = "apps"
): readonly KeyHint[] {
  const board = narrow ? NARROW_HOME_HINTS : HINTS.home
  const hints =
    pane === "servers" && needsAnswerHere(server)
      ? board.map((hint): KeyHint =>
          hint[0] === "enter" ? ["enter", "connect"] : hint
        )
      : board
  if (server?.runner?.relation !== "older") return hints
  const at = hints.findIndex(([key]) => key === "?")
  return [...hints.slice(0, at), ["u", "update runner"], ...hints.slice(at)]
}
