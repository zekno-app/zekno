/**
 * `zekno deploy` from nothing (contracts/screens.md, `first-deploy`): a
 * folder `shop` with a Compose file that expects one value, no key, no
 * server. The person answers each question as test/asking/first-deploy.test.ts
 * types them: their name, the server, its name, the app's name filled in,
 * yes to remembering the folder, and the value, which is never drawn.
 */
import type { Recipe } from "../recipe"
import { atTerminal } from "../scene/command"
import {
  DEPLOY_TIME,
  RUNNER_SIZE,
  SERVER_CODE,
  TEAM_CODE,
} from "../scene/codes"
import { applyRules } from "../scene/rules"
import { EXAMPLE, exampleWorld } from "../scene/server"
import { shows, type Terminal } from "../../support/terminal"

/** Types `keys` once `question` is on the screen. */
const answer = async (t: Terminal, question: string, keys: string) => {
  await shows(t, question, 30_000)
  t.keys(keys)
}

const recipe: Recipe = {
  title: "A first deploy, from nothing",
  command: "zekno deploy",
  columns: 100,
  rows: null,
  alt: "zekno deploy in a folder with a Compose file and nothing set up. It asks for your name and makes your key, with its team code; asks where the server is and a name for it, connects over SSH, finds Docker, installs the runner and adds the server, with its server code; asks a name for the app and whether to remember the folder; asks for the one value the Compose file expects without showing it; then deploys, and shop is live on prod-1.",
  async draw() {
    const world = exampleWorld()
    const lines = await atTerminal(world, ["deploy"], async (t) => {
      await answer(t, "? Your name ›", `${EXAMPLE.member}\r`)
      await answer(t, "? Where is the server? ›", `${EXAMPLE.destination}\r`)
      await answer(t, "? A name for it ›", `${EXAMPLE.server}\r`)
      await answer(t, `? Name for this app › ${EXAMPLE.app}`, "\r")
      await answer(
        t,
        `? Remember this folder? It writes zekno.json, so it always deploys ${EXAMPLE.app} to ${EXAMPLE.server}. (y/N)`,
        "y"
      )
      await answer(
        t,
        `? Value for DATABASE_URL (${EXAMPLE.app} on ${EXAMPLE.server}): (hidden)   esc skips it`,
        "postgres://shop:example@db:5432/shop\r"
      )
    })
    return applyRules(lines, [TEAM_CODE, SERVER_CODE, RUNNER_SIZE, DEPLOY_TIME])
  },
}

export default recipe
