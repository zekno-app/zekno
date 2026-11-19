/**
 * The first `zekno deploy` of shop with a domain (board `DomainsDeploy`,
 * "the first deploy with a domain"): in shop's folder, linked to shop on
 * prod-1, whose zekno.app.json gives web the domain shop.example.com, with
 * both of shop's secrets set. The DNS check and HTTPS are answered by the
 * stand-ins, never the network: the domain points to prod-1, and HTTPS
 * answers at once with a valid certificate.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import type { Recipe } from "../recipe"
import { atTerminal } from "../scene/command"
import { DEPLOY_TIME } from "../scene/codes"
import { SHOP_APP_FILE, SHOP_VALUES } from "../scene/files"
import { applyRules } from "../scene/rules"
import { EXAMPLE, withServer } from "../scene/server"
import { standIns } from "../../support/domain-stand-ins"

/** shop's settings file with the domain shop.example.com on web. */
export const SHOP_WITH_DOMAIN = SHOP_APP_FILE.replace(
  '"networking": { "port": 3000 }',
  '"networking": { "port": 3000, "domains": ["shop.example.com"] }'
)

const recipe: Recipe = {
  title: "A deploy with a domain",
  command: "zekno deploy",
  columns: 100,
  rows: null,
  alt: "zekno deploy in shop's folder, the first deploy since shop.example.com was added. Before anything is signed, a line says shop.example.com points to prod-1, at 203.0.113.7. The summary panel names the app, the server, the secrets and the domains row with shop.example.com; the four stages Checked, Signed, Sent and Started; shop is live on prod-1; then https://shop.example.com is live with a certificate until 17 Feb 2027, and how to watch the logs or roll back.",
  async draw() {
    const world = await withServer(null)
    writeFileSync(join(world.project, "zekno.app.json"), SHOP_WITH_DOMAIN)
    const on = ["--app", EXAMPLE.app, "--server", EXAMPLE.server]
    for (const [name, value] of Object.entries(SHOP_VALUES)) {
      world.m.typing(value)
      await world.zekno("secret", "set", name, ...on)
    }
    await world.zekno("link", ...on)
    world.m.docker.app(EXAMPLE.app, { web: 1, worker: 1 })
    standIns(world.m.deps)
    return applyRules(await atTerminal(world, ["deploy"]), [DEPLOY_TIME])
  },
}

export default recipe
