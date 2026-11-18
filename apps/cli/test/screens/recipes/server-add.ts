/**
 * `zekno server add` installing the runner (contracts/screens.md,
 * `server-add`): a team made with `zekno init`, then prod-1 added over SSH,
 * the runner installed from the stand-in release.
 */
import type { Recipe } from "../recipe"
import { atTerminal } from "../scene/command"
import { SERVER_CODE } from "../scene/codes"
import { applyRules } from "../scene/rules"
import { EXAMPLE, exampleWorld } from "../scene/server"

const recipe: Recipe = {
  title: "Adding a server",
  command: `zekno server add ${EXAMPLE.server} --ssh ${EXAMPLE.destination}`,
  columns: 100,
  rows: null,
  alt: "zekno server add prod-1 over SSH: it installs the runner at ~/.local/bin/zekno-runner after the file matched the checksum this zekno holds, connects prod-1 and adds it to the team list, shows the server code, and says that the server's identity rests on SSH's host verification.",
  async draw() {
    const world = exampleWorld()
    await world.zekno("init", "--name", EXAMPLE.member)
    const lines = await atTerminal(world, [
      "server",
      "add",
      EXAMPLE.server,
      "--ssh",
      EXAMPLE.destination,
    ])
    return applyRules(lines, [SERVER_CODE])
  },
}

export default recipe
