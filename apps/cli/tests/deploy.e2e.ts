import { dirname, join } from "node:path"

import { expect, secrets, test } from "./support/fixtures"
import { GREETING_VALUE } from "./support/values"
import { COMPOSE_GREETING, COMPOSE_PLAIN, type World } from "./support/world"

/** A team, a runner on this machine named prod, and the project folder linked to demo on prod. */
async function linkedFolder(world: World, compose: string) {
  await world.init("ada")
  await world.addThisMachine("prod")
  world.compose(compose)
  await world.link("demo", "prod")
}

test("deploy a linked folder from Home", async ({ world, terminal, agent, screen }) => {
  await linkedFolder(world, COMPOSE_PLAIN)
  await terminal.open(world.launch())
  await expect(screen.getByText(/This folder is linked to demo on prod/)).toBeVisible()

  await agent.act("deploy this folder")
  await expect(screen.getByText(/✔ Started/)).toBeVisible({ timeout: 20_000 })
  await expect(screen.getByRole("region", { name: "Deploy 1" })).toBeVisible()

  // The runner accepted deploy 1 of demo, and Docker was asked to start it once.
  expect((await world.status()).lastSequence).toEqual({ demo: 1 })
  expect(world.ups().map((call) => call.args)).toEqual([expect.stringContaining("compose -p zekno-demo ")])
})

test("a value the Compose file expects is set at the hidden prompt, then deployed", async ({ world, terminal, agent, screen }) => {
  await linkedFolder(world, COMPOSE_GREETING)
  await terminal.open(world.launch())
  await expect(screen.getByText(/This folder is linked to demo on prod/)).toBeVisible()

  // The model gets the secret's name only; the runner types the value into the hidden prompt.
  await agent.act("deploy this folder, setting GREETING to {value} when it is asked for", {
    params: { value: secrets.get("greeting") },
  })
  await expect(screen.getByText(/✔ Started/)).toBeVisible({ timeout: 20_000 })
  await expect(screen.getByText(/1 \(GREETING\)/)).toBeVisible()

  // It reached the container: the stand-in Docker was started with it.
  const ups = world.ups()
  expect(ups).toHaveLength(1)
  expect(ups[0]!.env.GREETING).toBe(GREETING_VALUE)
  expect((await world.status()).secrets).toEqual({ "demo/GREETING": { version: 1, removed: false } })
  // It was never written to the terminal, so it was never on screen.
  expect(terminal.output()).not.toContain(GREETING_VALUE)
  // No file holds it but the stand-in Docker's record of the environment it was started with:
  // the profile, the history, the runner's folder and the project hold it sealed or not at all.
  const stillPlain = world.files().filter((file) => file.content.includes(GREETING_VALUE))
  expect(stillPlain.map((file) => file.path)).toEqual([join(dirname(world.docker.path), "calls.log")])
})

test("declining a missing value deploys nothing", async ({ world, terminal, agent, screen }) => {
  await linkedFolder(world, COMPOSE_GREETING)
  await terminal.open(world.launch())
  await expect(screen.getByText(/This folder is linked to demo on prod/)).toBeVisible()

  await agent.act("start a deploy of this folder, then cancel it: do not set GREETING, and answer no when asked to deploy without it")
  await expect(screen.getByRole("status")).toHaveText("Nothing was deployed.", { timeout: 10_000 })

  // Nothing was signed or sent: the runner has no deploy, and Docker ran nothing.
  expect((await world.status()).lastSequence).toEqual({})
  expect(world.ups()).toEqual([])
})
