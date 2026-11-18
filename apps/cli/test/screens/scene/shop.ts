/**
 * shop deployed and running on prod-1, as Home and the app's screen show
 * it: two secrets set, deployed twice (the second time with a newer image),
 * the folder linked, and Docker reporting web as running.
 */
import { EXAMPLE, RUNNING, withServer } from "./server"
import { SHOP_VALUES } from "./files"

/** shop's Compose file: a web service that reads two secrets. */
export const SHOP_TWO_SECRETS = `services:
  web:
    image: ghcr.io/example/shop-web:1.4.1
    environment:
      - DATABASE_URL
      - SESSION_KEY
`

export async function deployedShop() {
  const world = await withServer(SHOP_TWO_SECRETS)
  const on = ["--app", EXAMPLE.app, "--server", EXAMPLE.server]
  for (const [name, value] of Object.entries(SHOP_VALUES)) {
    world.m.typing(value)
    await world.zekno("secret", "set", name, ...on)
  }
  await world.zekno("deploy", ...on)
  world.compose(SHOP_TWO_SECRETS.replace("1.4.1", "1.4.2"))
  await world.zekno("deploy", ...on)
  await world.zekno("link", ...on)
  world.m.docker.ps(EXAMPLE.app, RUNNING("web"))
  return world
}
