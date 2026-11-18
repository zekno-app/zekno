/**
 * `zekno settings` (contracts/screens.md, `settings`): in a folder whose
 * zekno.app.json describes shop with one service, web, linked to shop on
 * prod-1.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import type { Recipe } from "../recipe"
import { atTerminal } from "../scene/command"
import { SHOP_ONE_SERVICE } from "../scene/files"
import { EXAMPLE, withServer } from "../scene/server"

const recipe: Recipe = {
  title: "An app's settings",
  command: "zekno settings",
  columns: 100,
  rows: null,
  alt: "zekno settings in shop's folder: the app, shop, read from zekno.app.json, and its one service, web, with its settings by section: its image, how it starts and restarts, its memory and cpus, its port, not published, the secrets and plain variables it reads, and its volume.",
  async draw() {
    const world = await withServer(null)
    writeFileSync(join(world.project, "zekno.app.json"), SHOP_ONE_SERVICE)
    await world.zekno("link", "--app", EXAMPLE.app, "--server", EXAMPLE.server)
    return { lines: await atTerminal(world, ["settings"]), fixed: [] }
  },
}

export default recipe
