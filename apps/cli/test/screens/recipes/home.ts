/**
 * The app's Home (contracts/screens.md, `home`): one server, `prod-1`, and
 * one app on it, `shop`, deployed twice and running, with the folder the app
 * was opened in linked to it. The apps pane has the focus, as after → .
 */
import type { Recipe } from "../recipe"
import { homeRead, inApp, window } from "../scene/app"
import { atFixedTimes } from "../scene/clock"
import { EXAMPLE } from "../scene/server"
import { deployedShop } from "../scene/shop"

const SIZE = { columns: 100, rows: 30 } as const

const recipe: Recipe = {
  title: "The app: Home",
  command: "zekno",
  ...SIZE,
  alt: "The full-screen app's Home. A header with the team, Ada's team, at team list version 2. Three panes: the servers, with prod-1 and its address; the apps on prod-1, with shop at deploy 2, running, deployed 2 minutes ago; and shop's details, with the keys to deploy this folder, roll back to deploy 1, read the logs and set secrets. The keys of the screen are on the last line.",
  async draw() {
    const world = await deployedShop()
    const state = await inApp(world, SIZE, async (app) => {
      await homeRead(app, EXAMPLE.server, EXAMPLE.app)
      app.press({ kind: "right" })
      return app.state
    })
    return {
      lines: window(atFixedTimes(state, 2, 60), SIZE.columns, SIZE.rows),
      fixed: [
        {
          what: "when the latest deploy was, read against the clock",
          shown: "2 min ago",
        },
      ],
    }
  },
}

export default recipe
