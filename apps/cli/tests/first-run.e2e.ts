import { THIS_MACHINE } from "../src/app/effects"
import { expect, test } from "./support/fixtures"

test("first run: create the key, then add this machine as a server", async ({ world, terminal, agent, screen }) => {
  // From nothing: no profile folder, no key.
  await terminal.open(world.launch())
  await expect(screen.getByRole("textbox", { name: "Your name" })).toBeVisible()

  await agent.act("create the signing key with the name {name}", { params: { name: "ada" } })
  await expect(screen.getByRole("textbox", { name: "SSH destination" })).toBeVisible({ timeout: 15_000 })
  expect((await world.zekno(["server", "ls"])).code, "the team exists").toBe(0)

  await agent.act("add a server with the SSH destination {destination}, named {name}", {
    params: { destination: THIS_MACHINE, name: "prod" },
  })
  await expect(screen.getByText(/Added prod to the signed team list|Connected prod and added it to the signed team list/)).toBeVisible({
    timeout: 15_000,
  })

  // What really happened: the signed team list names ada and prod, and prod is a runner on this machine.
  const trust = await world.trust()
  expect(trust.members.map((member) => member.name)).toEqual(["ada"])
  expect(trust.servers.map((server) => server.name)).toEqual(["prod"])
  const servers = await world.zekno(["server", "ls"])
  expect(servers.out).toContain("prod")
  expect(servers.out).toContain(THIS_MACHINE)
  // Nothing reached for SSH: a server on this machine is a runner started here.
  expect(world.spawned().filter((entry) => entry.program === "ssh")).toEqual([])
})
