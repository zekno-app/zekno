/**
 * The app's settings screen for `shop` (contracts/screens.md,
 * `settings-screen`): shop described by its zekno.app.json, deployed once,
 * then web's memory changed with `zekno settings set` and not deployed yet.
 * Opened from Home with enter on shop and `e`, as a person opens it.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { top } from "../../../src/app/state/reading"
import type { Recipe } from "../recipe"
import { homeRead, inApp, window } from "../scene/app"
import { SHOP_APP_FILE, SHOP_VALUES } from "../scene/files"
import { EXAMPLE, RUNNING, withServer } from "../scene/server"

const SIZE = { columns: 100, rows: 30 } as const

const recipe: Recipe = {
  title: "The app: settings of shop",
  command: "zekno",
  ...SIZE,
  alt: "The settings screen of shop on prod-1, which is running. On the left its services, web and worker, web selected. On the right web's settings by section: its image, its start command, restart, memory and cpus, its port, the secrets and plain variables it reads, and its volume. The memory shows 1g, changed and not deployed, where it was 512m. The keys of the screen are on the last line.",
  async draw() {
    const world = await withServer(null)
    writeFileSync(join(world.project, "zekno.app.json"), SHOP_APP_FILE)
    const on = ["--app", EXAMPLE.app, "--server", EXAMPLE.server]
    for (const [name, value] of Object.entries(SHOP_VALUES)) {
      world.m.typing(value)
      await world.zekno("secret", "set", name, ...on)
    }
    await world.zekno("deploy", ...on)
    await world.zekno("link", ...on)
    await world.zekno("settings", "set", "web.memory", "1g", "--yes")
    world.m.docker.ps(EXAMPLE.app, RUNNING("web") + RUNNING("worker"))
    const state = await inApp(world, SIZE, async (app) => {
      await homeRead(app, EXAMPLE.server, EXAMPLE.app)
      app.press({ kind: "right" }, { kind: "enter" })
      await app.until(
        () => app.state.appView?.app === EXAMPLE.app,
        "shop's history"
      )
      app.type("e")
      await app.until(
        () =>
          top(app.state).name === "settings" &&
          app.state.settingsView?.outcome.kind === "read",
        "shop's settings"
      )
      return app.state
    })
    return { lines: window(state, SIZE.columns, SIZE.rows), fixed: [] }
  },
}

export default recipe
