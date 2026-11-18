/**
 * `zekno status` (contracts/screens.md, `status`): shop deployed to prod-1
 * and running, as Docker reports it to the runner.
 */
import type { Recipe } from "../recipe"
import { atTerminal } from "../scene/command"
import { SHOP_VALUES } from "../scene/files"
import { EXAMPLE, RUNNING, SHOP_COMPOSE, withServer } from "../scene/server"

const recipe: Recipe = {
  title: "What is running",
  command: "zekno status",
  columns: 100,
  rows: null,
  alt: "zekno status, which uses prod-1 as the only server: prod-1 is reachable and holds team list version 2, shop is at deploy 1 and running, and shop's secret DATABASE_URL is at version 1.",
  async draw() {
    const world = await withServer(SHOP_COMPOSE)
    const on = ["--app", EXAMPLE.app, "--server", EXAMPLE.server]
    world.m.typing(SHOP_VALUES.DATABASE_URL)
    await world.zekno("secret", "set", "DATABASE_URL", ...on)
    await world.zekno("deploy", ...on)
    world.m.docker.ps(EXAMPLE.app, RUNNING("web"))
    return { lines: await atTerminal(world, ["status"]), fixed: [] }
  },
}

export default recipe
