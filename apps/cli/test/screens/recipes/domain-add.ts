/**
 * `zekno domain add shop.example.com` at a terminal (board `DomainsAdd`, "the
 * first domain"): in shop's folder, linked to shop on prod-1, whose
 * zekno.app.json has web on port 3000 and a worker with no port, so the
 * domain goes to web without a question. The person answers yes. The
 * server's public address is what the stand-in for `ssh -G` gives; nothing
 * is looked up on the network.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import type { Recipe } from "../recipe"
import { atTerminal } from "../scene/command"
import { SHOP_APP_FILE } from "../scene/files"
import { EXAMPLE, withServer } from "../scene/server"
import { standIns } from "../../support/domain-stand-ins"
import { shows } from "../../support/terminal"

const DOMAIN = "shop.example.com"

const recipe: Recipe = {
  title: "Giving an app a domain",
  command: `zekno domain add ${DOMAIN}`,
  columns: 100,
  rows: null,
  alt: "zekno domain add shop.example.com in shop's folder: the change to web's domains, from none to shop.example.com; the question whether to write it to zekno.app.json, answered yes; Written, with what to run next; then the one DNS record to create before deploying, an A record for shop.example.com with the value 203.0.113.7.",
  async draw() {
    const world = await withServer(null)
    writeFileSync(join(world.project, "zekno.app.json"), SHOP_APP_FILE)
    await world.zekno("link", "--app", EXAMPLE.app, "--server", EXAMPLE.server)
    standIns(world.m.deps)
    const lines = await atTerminal(
      world,
      ["domain", "add", DOMAIN],
      async (t) => {
        await shows(
          t,
          "? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N)",
          30_000
        )
        t.keys("y")
      }
    )
    return { lines, fixed: [] }
  },
}

export default recipe
