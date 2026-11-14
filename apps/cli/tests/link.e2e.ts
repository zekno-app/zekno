import { copyFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { expect, test } from "./support/fixtures"
import type { World } from "./support/world"

/** A team, prod on this machine, and the project folder linked to demo on prod and deployed once. */
async function deployedLink(world: World) {
  await world.init("ada")
  await world.addThisMachine("prod")
  world.compose("services:\n  web:\n    image: example/web:1\n")
  await world.link("demo", "prod")
  await world.deploy()
}

test("a linked folder with another app selected asks first, and n deploys nothing", async ({ world, terminal, agent, screen }) => {
  await deployedLink(world)
  const api = world.folder("api")
  world.compose("services:\n  api:\n    image: example/api:1\n", api)
  await world.deploy(["--app", "api", "--server", "prod"], api)
  await terminal.open(world.launch())
  await expect(screen.getByRole("option", { selected: true, name: /^demo/ })).toBeVisible()

  await agent.act("select the app api")
  await expect(screen.getByRole("option", { selected: true, name: /^api/ })).toBeVisible()

  // The question, then no: exact keys, the words of the contract checked as they are.
  await terminal.press("d")
  await expect(screen.getByRole("region", { name: "This folder is linked to demo on prod" })).toBeVisible()
  await expect(screen.getByText("You selected api. Deploy this folder to api?")).toBeVisible()
  await terminal.press("n")
  await expect(screen.getByRole("status")).toHaveText("Nothing was deployed.")

  expect((await world.status()).lastSequence).toEqual({ demo: 1, api: 1 })
  expect(world.ups()).toHaveLength(2)
})

/**
 * Exact steps, no model: the question is answered with one key, and the
 * test checks a refusal (nothing used, nothing deployed). There is nothing
 * to judge.
 */
test("a team-signed zekno.json copied into another folder is asked about, and n leaves it unused", async ({ world, terminal, screen }) => {
  await deployedLink(world)
  const copy = world.folder("copy")
  world.compose("services:\n  web:\n    image: example/other:1\n", copy)
  copyFileSync(join(world.project, "zekno.json"), join(copy, "zekno.json"))
  await terminal.open(world.launch({ cwd: copy }))

  await expect(screen.getByRole("region", { name: "ada linked this folder to demo on prod" })).toBeVisible()
  await expect(screen.getByText(/It has not been used in this folder on/)).toBeVisible()
  await terminal.press("n")
  await expect(screen.getByRole("region", { name: "Servers" })).toBeVisible()
  await terminal.press("d")
  await expect(screen.getByRole("status")).toHaveText("This folder's zekno.json is not in use. Open zekno here again to be asked.")

  // Not recorded as used there, and nothing deployed from it.
  expect(world.links()).not.toContain(copy)
  expect((await world.status()).lastSequence).toEqual({ demo: 1 })
  expect(world.ups()).toHaveLength(1)
})

/** Exact steps, no model: a refusal on opening and on `d`, with nothing to judge. */
test("a zekno.json with no signature is named on Home, and d deploys nothing", async ({ world, terminal, screen }) => {
  await deployedLink(world)
  const other = world.folder("other")
  world.compose("services:\n  web:\n    image: example/other:1\n", other)
  writeFileSync(join(other, "zekno.json"), `${JSON.stringify({ app: "demo", server: "prod" })}\n`)
  await terminal.open(world.launch({ cwd: other }))

  const notSigned = "✖ zekno.json here is not signed by your team, so zekno does not use it. It names demo on prod."
  await expect(screen.getByRole("status")).toHaveText(notSigned)
  await terminal.press("d")
  await expect(screen.getByRole("status")).toHaveText(notSigned)

  expect((await world.status()).lastSequence).toEqual({ demo: 1 })
  expect(world.ups()).toHaveLength(1)
})
