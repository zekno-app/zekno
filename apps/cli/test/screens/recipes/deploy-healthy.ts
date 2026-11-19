/**
 * A deploy that waits for a health check (board `DomainsHealth`, "healthy"):
 * shop deployed once with the domain shop.example.com, as the recipe
 * `deploy-domain` deploys it, then web given the health check `GET /health`
 * and deployed again. The second deploy has the fifth stage, Healthy; the
 * domain is held already, so nothing is said of DNS or HTTPS. web answers
 * the path at once, as the stand-in Docker answers a health check.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import type { Recipe } from "../recipe"
import { atTerminal } from "../scene/command"
import { DEPLOY_TIME } from "../scene/codes"
import { SHOP_VALUES } from "../scene/files"
import { applyRules } from "../scene/rules"
import { EXAMPLE, withServer } from "../scene/server"
import { standIns } from "../../support/domain-stand-ins"
import { SHOP_WITH_DOMAIN } from "./deploy-domain"

/** shop's settings file with the domain on web, and web's health check: GET /health within the 60 seconds left out. */
const WITH_HEALTH = SHOP_WITH_DOMAIN.replace(
  '"cpus": 1',
  '"cpus": 1,\n        "healthcheck": { "path": "/health" }'
)

const recipe: Recipe = {
  title: "A deploy with a health check",
  command: "zekno deploy",
  columns: 100,
  rows: null,
  alt: "zekno deploy in shop's folder after web was given the health check GET /health. The summary panel of deploy 2 names the app, the server, the secrets and the domain shop.example.com, which the server holds already. The stage row has a fifth stage: Checked, Signed, Sent, Started and Healthy. Then shop is live on prod-1, and how to watch the logs or roll back.",
  async draw() {
    const world = await withServer(null)
    const file = join(world.project, "zekno.app.json")
    writeFileSync(file, SHOP_WITH_DOMAIN)
    const on = ["--app", EXAMPLE.app, "--server", EXAMPLE.server]
    for (const [name, value] of Object.entries(SHOP_VALUES)) {
      world.m.typing(value)
      await world.zekno("secret", "set", name, ...on)
    }
    await world.zekno("link", ...on)
    world.m.docker.app(EXAMPLE.app, { web: 1, worker: 1 })
    standIns(world.m.deps)
    await world.zekno("deploy")
    writeFileSync(file, WITH_HEALTH)
    return applyRules(await atTerminal(world, ["deploy"]), [DEPLOY_TIME])
  },
}

export default recipe
