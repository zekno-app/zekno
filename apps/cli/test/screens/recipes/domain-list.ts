/**
 * `zekno domain` at a terminal (board `DomainsList`, "zekno domain"): shop
 * deployed to prod-1 with three domains, shop.example.com and
 * www.example.com on web and api.example.com on api; then new.example.com
 * added to web in the file and not deployed. Asked from this machine through
 * the stand-ins, never the network: shop.example.com answers HTTPS with a
 * valid certificate, www.example.com points to another address, and
 * api.example.com answers without a valid certificate yet.
 */
import { setSystemTime } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import type { Recipe } from "../recipe"
import { NOW } from "../scene/clock"
import { atTerminal } from "../scene/command"
import { EXAMPLE, withServer } from "../scene/server"
import { ELSEWHERE, pointsTo, standIns } from "../../support/domain-stand-ins"

/** shop's settings file: web on 3000 with `web`'s domains, api on 8080 with api.example.com, and a worker. */
const shopFile = (web: string[]): string =>
  `${JSON.stringify(
    {
      zekno: 1,
      services: {
        web: {
          source: { image: "ghcr.io/example/shop-web:1.4.2" },
          networking: { port: 3000, domains: web },
        },
        api: {
          source: { image: "ghcr.io/example/shop-api:1.4.2" },
          networking: { port: 8080, domains: ["api.example.com"] },
        },
        worker: { source: { image: "ghcr.io/example/shop-worker:1.4.2" } },
      },
    },
    null,
    2
  )}\n`

const recipe: Recipe = {
  title: "An app's domains",
  command: "zekno domain",
  columns: 100,
  rows: null,
  alt: "zekno domain in shop's folder: shop on prod-1, then one row a domain, in domain order, with the service and port it reaches, its state after a mark, and what to do. api.example.com on api:8080 has no certificate yet, prod-1 is asking for one. new.example.com on web:3000 is not deployed. shop.example.com on web:3000 is live, with a certificate until 17 Feb 2027. www.example.com on web:3000 has DNS that points elsewhere, to 198.51.100.9, not prod-1.",
  async draw() {
    const world = await withServer(null)
    const file = join(world.project, "zekno.app.json")
    writeFileSync(file, shopFile(["shop.example.com", "www.example.com"]))
    await world.zekno("link", "--app", EXAMPLE.app, "--server", EXAMPLE.server)
    world.m.docker.app(EXAMPLE.app, { web: 1, api: 1, worker: 1 })
    standIns(world.m.deps)
    await world.zekno("deploy")
    writeFileSync(
      file,
      shopFile(["shop.example.com", "www.example.com", "new.example.com"])
    )
    standIns(world.m.deps, {
      dns: { "www.example.com": pointsTo(ELSEWHERE) },
      https: { "api.example.com": [{ state: "invalid" }] },
    })
    // Set only now: the deploy above is checked against the runner's clock, and nothing here is signed.
    setSystemTime(NOW)
    return {
      lines: await atTerminal(world, ["domain"]),
      fixed: [
        {
          what: "the clock a certificate's last day is measured against, so the certificate stays far from its end",
          shown: "certificate until 17 Feb 2027",
        },
      ],
    }
  },
}

export default recipe
