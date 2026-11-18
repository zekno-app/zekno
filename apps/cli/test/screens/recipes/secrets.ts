/**
 * `zekno secret ls` (contracts/screens.md, `secrets`): in shop's folder,
 * linked to shop on prod-1, with two secrets set, one of them twice.
 */
import type { Recipe } from "../recipe"
import { atTerminal } from "../scene/command"
import { SHOP_VALUES } from "../scene/files"
import { EXAMPLE, SHOP_COMPOSE, withServer } from "../scene/server"

const recipe: Recipe = {
  title: "An app's secrets",
  command: "zekno secret ls",
  columns: 100,
  rows: null,
  alt: "zekno secret ls in shop's folder: the names of shop's secrets on prod-1, DATABASE_URL and SESSION_KEY, each with its version, and never a value.",
  async draw() {
    const world = await withServer(SHOP_COMPOSE)
    const on = ["--app", EXAMPLE.app, "--server", EXAMPLE.server]
    await world.zekno("link", ...on)
    world.m.typing(SHOP_VALUES.DATABASE_URL)
    await world.zekno("secret", "set", "DATABASE_URL", ...on)
    world.m.typing(SHOP_VALUES.SESSION_KEY)
    await world.zekno("secret", "set", "SESSION_KEY", ...on)
    world.m.typing(`${SHOP_VALUES.SESSION_KEY}-2`)
    await world.zekno("secret", "set", "SESSION_KEY", ...on)
    return { lines: await atTerminal(world, ["secret", "ls"]), fixed: [] }
  },
}

export default recipe
