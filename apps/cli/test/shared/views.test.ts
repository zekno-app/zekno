/**
 * The Compose text of an app's last deploy from this machine
 * (specs/010-app-settings, research R4; tasks T022): read from the history
 * on disk, verified against the team list, with no keychain. A stand-in
 * team signs the deploys.
 */
import { describe, expect, test } from "bun:test"
import {
  createDeploy,
  createSigner,
  createTeam,
  generateMemberKeyPair,
  generateServerKeyPair,
  proposeRoster,
  type TeamTrust,
} from "@workspace/core"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import {
  profileStore,
  type History,
  type Server,
} from "../../src/profile/profile"
import { lastDeployedCompose } from "../../src/shared/views"

/** A team of one, with a server `dev`, that signs deploys. */
async function team() {
  const signer = createSigner(generateMemberKeyPair().secretKey)
  const founded = await createTeam({ founderName: "Ada", signer })
  const keys = generateServerKeyPair()
  const { trust } = await proposeRoster({
    trust: founded.trust,
    servers: [{ name: "dev", publicKey: keys.publicKey }],
    signer,
  })
  const server = { name: "dev", serverId: keys.serverId } as Server
  const deploy = async (
    sequence: number,
    compose: string,
    trustUsed: TeamTrust = trust
  ) =>
    (
      await createDeploy({
        trust: trustUsed,
        serverId: keys.serverId,
        app: "demo",
        sequence,
        compose,
        secrets: [],
        signer,
      })
    ).envelope
  return { trust, server, deploy }
}

const entry = (
  envelope: History[number]["envelope"],
  outcome: History[number]["outcome"]
): History[number] => ({ envelope, at: "2026-11-16T00:00:00.000Z", outcome })

describe("lastDeployedCompose", () => {
  test("the latest entry the runner answered, verified", async () => {
    const { trust, server, deploy } = await team()
    const home = tempDir("views-home")
    const store = profileStore(home)
    store.saveHistory(server.serverId, "demo", [
      entry(await deploy(1, "services: {one: {}}\n"), "started"),
      entry(await deploy(2, "services: {two: {}}\n"), "start_failed"),
      entry(await deploy(3, "services: {three: {}}\n"), "sent"),
    ])
    expect(lastDeployedCompose(store, trust, server, "demo")).toBe(
      "services: {two: {}}\n"
    )
  })

  test("undefined with no history, with only sent deploys, for another app", async () => {
    const { trust, server, deploy } = await team()
    const store = profileStore(tempDir("views-home"))
    expect(lastDeployedCompose(store, trust, server, "demo")).toBeUndefined()
    store.saveHistory(server.serverId, "demo", [
      entry(await deploy(1, "x\n"), "sent"),
    ])
    expect(lastDeployedCompose(store, trust, server, "demo")).toBeUndefined()
    expect(lastDeployedCompose(store, trust, server, "other")).toBeUndefined()
  })

  test("undefined with an entry that does not verify: another team's, or one edited after signing", async () => {
    const ours = await team()
    const theirs = await team()
    const store = profileStore(tempDir("views-home"))
    const edited = await ours.deploy(1, "services: {}\n")
    store.saveHistory(ours.server.serverId, "demo", [
      entry(
        { ...edited, payload: `${edited.payload.slice(0, -2)}AA` },
        "started"
      ),
    ])
    expect(
      lastDeployedCompose(store, ours.trust, ours.server, "demo")
    ).toBeUndefined()
    store.saveHistory(theirs.server.serverId, "demo", [
      entry(await theirs.deploy(1, "x\n"), "started"),
    ])
    expect(
      lastDeployedCompose(store, ours.trust, theirs.server, "demo")
    ).toBeUndefined()
  })

  test("an unverifiable later entry is passed over for the verified one before it", async () => {
    const { trust, server, deploy } = await team()
    const other = await team()
    const store = profileStore(tempDir("views-home"))
    store.saveHistory(server.serverId, "demo", [
      entry(await deploy(1, "first\n"), "started"),
      entry(await other.deploy(2, "theirs\n"), "started"),
    ])
    expect(lastDeployedCompose(store, trust, server, "demo")).toBe("first\n")
  })

  test("undefined with a history that cannot be read", async () => {
    const { trust, server } = await team()
    const home = tempDir("views-home")
    mkdirSync(join(home, "history", server.serverId), { recursive: true })
    writeFileSync(
      join(home, "history", server.serverId, "demo.json"),
      "{not json"
    )
    expect(
      lastDeployedCompose(profileStore(home), trust, server, "demo")
    ).toBeUndefined()
  })
})
