/**
 * The app's screen for shop (contracts/screens.md, `app-detail`): its
 * deploys, the selected one's details, and its secrets, opened from Home
 * with enter on shop.
 */
import type { Recipe } from "../recipe"
import { homeRead, inApp, window } from "../scene/app"
import { atFixedTimes } from "../scene/clock"
import { EXAMPLE } from "../scene/server"
import { deployedShop } from "../scene/shop"

const SIZE = { columns: 100, rows: 30 } as const

const recipe: Recipe = {
  title: "The app: shop",
  command: "zekno",
  ...SIZE,
  alt: "The full-screen app's screen for shop on prod-1, which is running. Its deploys, newest first, each with its number, result and time, the latest selected with its details; and its secrets by name and version. The keys of the screen are on the last line.",
  async draw() {
    const world = await deployedShop()
    const state = await inApp(world, SIZE, async (app) => {
      await homeRead(app, EXAMPLE.server, EXAMPLE.app)
      app.press({ kind: "right" }, { kind: "enter" })
      await app.until(
        () => app.state.appView?.app === EXAMPLE.app,
        "shop's history"
      )
      return app.state
    })
    return {
      lines: window(atFixedTimes(state, 2, 60), SIZE.columns, SIZE.rows),
      fixed: [
        {
          what: "the time of each deploy, read in UTC against the clock",
          shown: "today 10:28 and today 09:28",
        },
      ],
    }
  },
}

export default recipe
