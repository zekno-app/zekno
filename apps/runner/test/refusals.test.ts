import { describe, expect, test } from "bun:test"
import { createDeploy, createSigner, generateMemberKeyPair } from "@workspace/core"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { buildDeploy, runner, world } from "./helpers"

/** Someone with SSH access to the server, but without the team's signing key. */
describe("the runner refuses what the team did not sign", () => {
  async function attempt(build: (w: Awaited<ReturnType<typeof world>>) => Promise<unknown>, reason: string) {
    const w = await world()
    // One genuine deploy first, so there is state to protect.
    const genuine = await buildDeploy({ trust: w.trust, serverId: w.serverId, signer: w.signer, sequence: 1 })
    expect((await runner(w.home, w.docker.path, "apply", { rosters: w.rosters, deploy: genuine })).json?.outcome).toBe("started")
    const state = readFileSync(join(w.home, "state.json"), "utf8")
    const compose = readFileSync(join(w.home, "apps/web/compose.yaml"), "utf8")

    const result = await runner(w.home, w.docker.path, "apply", await build(w))
    expect(result.code).toBe(1)
    expect(result.json).toEqual({ outcome: "refused", reason })
    // Nothing was started and nothing the runner remembers changed.
    expect(w.docker.calls()).toHaveLength(1)
    expect(readFileSync(join(w.home, "state.json"), "utf8")).toBe(state)
    expect(readFileSync(join(w.home, "apps/web/compose.yaml"), "utf8")).toBe(compose)
    return { w, genuine }
  }

  test("a deploy signed by a key that is not in the team list", async () => {
    await attempt(async (w) => {
      const stranger = createSigner(generateMemberKeyPair().secretKey)
      const forgedTrust = { ...w.trust, members: [{ name: "Mallory", publicKey: stranger.publicKey, role: "admin" as const }] }
      const deploy = await createDeploy({ trust: forgedTrust, serverId: w.serverId, app: "web", sequence: 2, compose: "services:\n  miner:\n    image: example/miner\n", secrets: [], signer: stranger })
      return { rosters: w.rosters, deploy }
    }, "unknown_signer")
  })

  test("a genuine deploy delivered a second time", async () => {
    const w = await world()
    const deploy = await buildDeploy({ trust: w.trust, serverId: w.serverId, signer: w.signer, sequence: 1 })
    expect((await runner(w.home, w.docker.path, "apply", { rosters: w.rosters, deploy })).json?.outcome).toBe("started")
    const again = await runner(w.home, w.docker.path, "apply", { rosters: w.rosters, deploy })
    expect(again.json).toEqual({ outcome: "refused", reason: "replayed" })
    expect(w.docker.calls()).toHaveLength(1)
  })

  test("a genuine deploy with one byte of the service definition changed", async () => {
    await attempt(async (w) => {
      const deploy = await buildDeploy({ trust: w.trust, serverId: w.serverId, signer: w.signer, sequence: 2 })
      const payload = Buffer.from(deploy.envelope.payload, "base64url")
      const at = payload.indexOf("example/web:1")
      payload[at] = payload[at]! ^ 1
      return { rosters: w.rosters, deploy: { ...deploy, envelope: { ...deploy.envelope, payload: payload.toString("base64url") } } }
    }, "bad_signature")
  })

  test("a genuine deploy with two secrets' encrypted values exchanged", async () => {
    await attempt(async (w) => {
      const deploy = await buildDeploy({ trust: w.trust, serverId: w.serverId, signer: w.signer, sequence: 2, values: { A_SECRET: "demo-a", B_SECRET: "demo-b" } })
      const [a, b] = deploy.secrets
      return { rosters: w.rosters, deploy: { ...deploy, secrets: [{ ...a!, ciphertext: b!.ciphertext }, { ...b!, ciphertext: a!.ciphertext }] } }
    }, "secrets_mismatch")
  })

  test("a team list the attacker signed themselves", async () => {
    await attempt(async (w) => {
      const { proposeRoster } = await import("@workspace/core")
      const stranger = createSigner(generateMemberKeyPair().secretKey)
      const pretend = { ...w.trust, members: [...w.trust.members, { name: "Mallory", publicKey: stranger.publicKey, role: "admin" as const }] }
      const forged = await proposeRoster({ trust: pretend, signer: stranger })
      const deploy = await buildDeploy({ trust: w.trust, serverId: w.serverId, signer: w.signer, sequence: 2 })
      return { rosters: [...w.rosters, forged.envelope], deploy }
    }, "unknown_signer")
  })

  test("input that is not a request at all", async () => {
    const w = await world()
    for (const input of ["", "garbage", "{}", "[]", JSON.stringify({ rosters: w.rosters }), JSON.stringify({ rosters: w.rosters, deploy: {}, extra: 1 })]) {
      const result = await runner(w.home, w.docker.path, "apply", input)
      expect(result.code).toBe(1)
      expect(result.json).toEqual({ outcome: "refused", reason: "invalid_request" })
    }
    expect(w.docker.calls()).toEqual([])
  })
})
