import { readFileSync } from "node:fs"
import { join } from "node:path"

import { expect, test } from "./support/fixtures"

test("roll back to the previous deploy from the app screen", async ({
  world,
  terminal,
  agent,
  screen,
}) => {
  await world.init("ada")
  await world.addThisMachine("prod")
  world.compose("services:\n  web:\n    image: example/web:1\n")
  await world.link("demo", "prod")
  await world.deploy()
  world.compose("services:\n  web:\n    image: example/web:2\n")
  await world.deploy()
  await terminal.open(world.launch())
  // Start on the app screen: Home opens on demo, and enter opens it.
  await expect(
    screen.getByRole("option", { selected: true, name: /^demo\s+2/ })
  ).toBeVisible()
  await terminal.press("Enter")
  await expect(screen.getByRole("banner")).toContainText("prod › demo")
  await expect(screen.getByRole("region", { name: /^Deploys/ })).toBeVisible()

  await agent.act("roll back to deploy {number}", { params: { number: 1 } })
  await expect(screen.getByText(/✔ Started/)).toBeVisible({ timeout: 20_000 })
  await expect(screen.getByText(/what deploy 1 ran/)).toBeVisible()

  // The runner accepted deploy 3, which runs what deploy 1 ran, and Docker started it.
  expect((await world.status()).lastSequence).toEqual({ demo: 3 })
  expect(world.ups()).toHaveLength(3)
  expect(
    readFileSync(
      join(world.runnerHome("prod"), "apps", "demo", "compose.yaml"),
      "utf8"
    )
  ).toContain("example/web:1")
})
