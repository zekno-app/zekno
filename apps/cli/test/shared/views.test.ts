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
import { appDetails, appsOf, lastDeployedCompose } from "../../src/shared/views"
import { payloadOf, signingTeam } from "../support/signing-team"

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

describe("a history of version-1 then version-2 entries (specs/014-deploy-v2, tasks T026)", () => {
  const A = "services:\n  web:\n    image: example/web:1\n"
  const B = A.replace("web:1", "web:2")
  const C = A.replace("web:1", "web:3")

  test("Home's row, the app's deploy rows with rollback marks across the two kinds, and secret rows from a version-2 latest", async () => {
    const t = await signingTeam()
    const db1 = await t.secret("DATABASE_URL", "postgres://one", 1)
    const db2 = await t.secret("DATABASE_URL", "postgres://two", 2)
    const old = await t.secret("OLD", "old", 1)
    const pay = await t.secret("PAYMENTS_KEY", "demo-key", 1)
    const oldGone = await t.removal("OLD", 2)
    const five = await t.deployV2(4, C, [db2.envelope, pay.envelope], [oldGone])
    t.team.store.saveHistory(t.server.serverId, "demo", [
      entry(await t.deployV1(1, A, [db1, old]), "started"),
      entry(await t.deployV1(2, B, [db1, old]), "started"),
      // 3 runs deploy 1's definition again, 4 deploy 2's: rollbacks across the two kinds.
      entry(await t.deployV2(2, A, [db1.envelope, old.envelope]), "started"),
      entry(
        await t.deployV2(3, B, [db1.envelope, pay.envelope], [oldGone]),
        "start_failed"
      ),
      // Its answer never came.
      entry(five, "sent"),
    ])
    t.team.store.saveSecrets(t.server.serverId, "demo", {
      records: [db1, db2, old, pay],
      removals: [oldGone],
    })

    expect(appsOf(t.team, t.server, t.home)).toEqual([
      {
        name: "demo",
        deploy: 5,
        at: payloadOf(five).createdAt as string,
        state: "unknown",
        outcome: "sent",
        signer: "Ada",
        secrets: 2,
        previous: 3,
      },
    ])

    const { deploys, secrets } = appDetails(t.team, t.server, "demo")
    expect(
      deploys.map((row) => ({
        sequence: row.sequence,
        outcome: row.outcome,
        rollbackTo: row.rollbackTo,
        teamVersion: row.teamVersion,
        signer: row.signer,
        services: row.services,
        secrets: row.secrets,
      }))
    ).toEqual([
      {
        sequence: 5,
        outcome: "sent",
        rollbackTo: undefined,
        teamVersion: 2,
        signer: "Ada",
        services: ["web (example/web:3)"],
        secrets: [
          { name: "DATABASE_URL", version: 2 },
          { name: "PAYMENTS_KEY", version: 1 },
        ],
      },
      {
        sequence: 4,
        outcome: "start_failed",
        rollbackTo: 2,
        teamVersion: 2,
        signer: "Ada",
        services: ["web (example/web:2)"],
        secrets: [
          { name: "DATABASE_URL", version: 1 },
          { name: "PAYMENTS_KEY", version: 1 },
        ],
      },
      {
        sequence: 3,
        outcome: "started",
        rollbackTo: 1,
        teamVersion: 2,
        signer: "Ada",
        services: ["web (example/web:1)"],
        secrets: [
          { name: "DATABASE_URL", version: 1 },
          { name: "OLD", version: 1 },
        ],
      },
      {
        sequence: 2,
        outcome: "started",
        rollbackTo: undefined,
        teamVersion: 2,
        signer: "Ada",
        services: ["web (example/web:2)"],
        secrets: [
          { name: "DATABASE_URL", version: 1 },
          { name: "OLD", version: 1 },
        ],
      },
      {
        sequence: 1,
        outcome: "started",
        rollbackTo: undefined,
        teamVersion: 2,
        signer: "Ada",
        services: ["web (example/web:1)"],
        secrets: [
          { name: "DATABASE_URL", version: 1 },
          { name: "OLD", version: 1 },
        ],
      },
    ])
    // Against deploy 4, the latest the runner answered, a version-2 deploy.
    expect(secrets).toEqual([
      { name: "DATABASE_URL", version: 2, removed: false, afterDeploy: true },
      { name: "PAYMENTS_KEY", version: 1, removed: false, afterDeploy: false },
      { name: "OLD", version: 2, removed: true, afterDeploy: false },
    ])
    expect(lastDeployedCompose(t.team.store, t.trust, t.server, "demo")).toBe(B)
  })
})
