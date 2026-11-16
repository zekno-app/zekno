import { serverConfirmationCode } from "@workspace/core"

import { expect, sshTest, test } from "./support/fixtures"
import { sightings } from "./support/sightings"
import { REAL_LOOKING_DESTINATION } from "./support/values"

/** A server code as the add screen shows it: five groups of four. */
const CODE = /\b[0-9A-Z]{4}(?:-[0-9A-Z]{4}){4}\b/

sshTest(
  "add a server over SSH, through the stand-in server, to the server code",
  async ({ world, terminal, agent, screen }) => {
    await world.init("ada")
    await terminal.open(world.launch())
    await expect(screen.getByRole("region", { name: "Servers" })).toBeVisible()

    await agent.act(
      "add a server with the SSH destination {destination}, named {name}, and stop once its server code is shown",
      {
        params: { destination: "deploy@example.test", name: "staging" },
      }
    )
    await expect(
      screen.getByText(/Added staging to the signed team l/)
    ).toBeVisible({ timeout: 20_000 })
    const code = screen
      .getByRole("region", { name: "Server code" })
      .getByText(CODE)
    await expect(code).toBeVisible()

    // The code on screen is the one derived from the key the stand-in server's runner made.
    const shown = CODE.exec((await code.textContent()) ?? "")?.[0]
    const signed = (await world.trust()).servers.find(
      (server) => server.name === "staging"
    )
    expect(signed, "staging is in the signed team list").toBeDefined()
    expect(shown).toBe(serverConfirmationCode(signed!.publicKey))

    // Every SSH connection went to the stand-in, for the destination typed; nothing else ran ssh.
    expect(world.ssh!.calls().length).toBeGreaterThan(0)
    for (const call of world.ssh!.calls())
      expect(call).toContain("-- deploy@example.test ")
    expect(
      world
        .spawned()
        .filter((entry) => entry.program === "ssh" && entry.ran !== "stand-in")
    ).toEqual([])
    expect(world.trapHits()).toBe(0)
  }
)

/**
 * The safety test. Exact steps, no model: what it proves is below the
 * keyboard, in how the test build connects, so it holds for whatever is
 * typed and whoever types it. The world has no stand-in server, so an SSH
 * destination must fail closed.
 */
test("a real-looking SSH destination typed into add a server starts no ssh", async ({
  world,
  terminal,
  screen,
}) => {
  await world.init("ada")
  await terminal.open(world.launch())
  await terminal.press("a")
  await expect(
    screen.getByRole("textbox", { name: "SSH destination" })
  ).toBeVisible()
  await terminal.type(REAL_LOOKING_DESTINATION)
  await terminal.press("Enter")
  await terminal.type("staging")

  // Look for an ssh process or a socket to the address before, while and after the app tries.
  const host = REAL_LOOKING_DESTINATION.split("@")[1]!
  const looks = [await sightings(host)]
  await terminal.press("Enter")
  looks.push(await sightings(host))
  await expect(screen.getByText(/cannot be reached/)).toBeVisible({
    timeout: 10_000,
  })
  looks.push(await sightings(host))

  await expect(screen.getByText("✖ Connect over SSH")).toBeVisible()
  expect(looks.flatMap((look) => look.sshProcesses)).toEqual([])
  expect(looks.flatMap((look) => look.sockets)).toEqual([])
  // The test build was asked for SSH and refused it before any process started; PATH's ssh was never run.
  const ssh = world.spawned().filter((entry) => entry.program === "ssh")
  expect(ssh.length).toBeGreaterThan(0)
  expect(ssh.every((entry) => entry.ran === "refused")).toBe(true)
  expect(world.trapHits()).toBe(0)
  expect((await world.zekno(["server", "ls"])).out).not.toContain("staging")
})
