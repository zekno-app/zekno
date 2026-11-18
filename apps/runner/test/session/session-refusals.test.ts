/**
 * The cases of refusals.test.ts, each sent through a session instead of a
 * one-shot `apply`: someone with SSH access to the server, but without the
 * team's signing key. Each starts from a runner that took `web` at deploy 1
 * before it was updated, since `apply` takes version 1 only for an app held
 * then (contracts/runner-checks.md, "The version-1 path"). The refusals of
 * `deploy` are in ../scenarios/deploy-v2-refusals.test.ts.
 */
import { describe, expect, test } from "bun:test"
import {
  createDeploy,
  createSigner,
  generateMemberKeyPair,
  parseMessage,
  proposeRoster,
  RUNNER_PROTOCOL,
  RunnerReportSchema,
  RunnerStatusSchema,
} from "@workspace/core"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import pkg from "../../package.json"
import { olderState } from "../support/deploy-v2"
import { buildDeploy, session, world } from "../support/helpers"

type World = Awaited<ReturnType<typeof world>>

async function heldBefore(): Promise<World> {
  const w = await world()
  olderState(w.home, { web: 1 })
  return w
}

describe("through a session, the runner refuses what the team did not sign", () => {
  async function attempt(
    build: (w: World) => Promise<unknown>,
    reason: string
  ) {
    const w = await heldBefore()
    const s = session(w.home, w.docker.path)
    // One genuine deploy first, so there is state to protect.
    const genuine = await buildDeploy({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      sequence: 2,
    })
    expect(
      (
        await s.request({
          command: "apply",
          input: { rosters: w.rosters, deploy: genuine },
        })
      ).result.outcome
    ).toBe("started")
    const state = readFileSync(join(w.home, "state.json"), "utf8")
    const compose = readFileSync(join(w.home, "apps/web/compose.yaml"), "utf8")

    const answer = await s.request({ command: "apply", input: await build(w) })
    expect(answer).toEqual({
      events: [],
      result: { outcome: "refused", reason },
    })
    expect(parseMessage(RunnerReportSchema, answer.result).ok).toBe(true)
    // Nothing was started and nothing the runner remembers changed.
    expect(w.docker.calls()).toHaveLength(1)
    expect(readFileSync(join(w.home, "state.json"), "utf8")).toBe(state)
    expect(readFileSync(join(w.home, "apps/web/compose.yaml"), "utf8")).toBe(
      compose
    )
    // A refusal does not end the session.
    expect(
      parseMessage(
        RunnerStatusSchema,
        (await s.request({ command: "status" })).result
      ).ok
    ).toBe(true)
    expect((await s.close()).code).toBe(0)
  }

  test("a deploy signed by a key that is not in the team list", async () => {
    await attempt(async (w) => {
      const stranger = createSigner(generateMemberKeyPair().secretKey)
      const forgedTrust = {
        ...w.trust,
        members: [
          {
            name: "Mallory",
            publicKey: stranger.publicKey,
            role: "admin" as const,
          },
        ],
      }
      const deploy = await createDeploy({
        trust: forgedTrust,
        serverId: w.serverId,
        app: "web",
        sequence: 3,
        compose: "services:\n  miner:\n    image: example/miner\n",
        secrets: [],
        signer: stranger,
      })
      return { rosters: w.rosters, deploy }
    }, "unknown_signer")
  })

  test("a genuine deploy delivered a second time", async () => {
    const w = await heldBefore()
    const s = session(w.home, w.docker.path)
    const deploy = await buildDeploy({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      sequence: 2,
    })
    expect(
      (
        await s.request({
          command: "apply",
          input: { rosters: w.rosters, deploy },
        })
      ).result.outcome
    ).toBe("started")
    expect(
      await s.request({
        command: "apply",
        input: { rosters: w.rosters, deploy },
      })
    ).toEqual({
      events: [],
      result: { outcome: "refused", reason: "replayed" },
    })
    expect(w.docker.calls()).toHaveLength(1)
    // Delivered again in a new session, it is still refused.
    expect((await s.close()).code).toBe(0)
    const again = session(w.home, w.docker.path)
    expect(
      (
        await again.request({
          command: "apply",
          input: { rosters: w.rosters, deploy },
        })
      ).result
    ).toEqual({ outcome: "refused", reason: "replayed" })
    expect((await again.close()).code).toBe(0)
    expect(w.docker.calls()).toHaveLength(1)
  })

  test("a genuine deploy with one byte of the service definition changed", async () => {
    await attempt(async (w) => {
      const deploy = await buildDeploy({
        trust: w.trust,
        serverId: w.serverId,
        signer: w.signer,
        sequence: 3,
      })
      const payload = Buffer.from(deploy.envelope.payload, "base64url")
      const at = payload.indexOf("example/web:1")
      payload[at] = payload[at]! ^ 1
      return {
        rosters: w.rosters,
        deploy: {
          ...deploy,
          envelope: {
            ...deploy.envelope,
            payload: payload.toString("base64url"),
          },
        },
      }
    }, "bad_signature")
  })

  test("a genuine deploy with two secrets' encrypted values exchanged", async () => {
    await attempt(async (w) => {
      const deploy = await buildDeploy({
        trust: w.trust,
        serverId: w.serverId,
        signer: w.signer,
        sequence: 3,
        values: { A_SECRET: "demo-a", B_SECRET: "demo-b" },
      })
      const [a, b] = deploy.secrets
      return {
        rosters: w.rosters,
        deploy: {
          ...deploy,
          secrets: [
            { ...a!, ciphertext: b!.ciphertext },
            { ...b!, ciphertext: a!.ciphertext },
          ],
        },
      }
    }, "secrets_mismatch")
  })

  test("a team list the attacker signed themselves", async () => {
    await attempt(async (w) => {
      const stranger = createSigner(generateMemberKeyPair().secretKey)
      const pretend = {
        ...w.trust,
        members: [
          ...w.trust.members,
          {
            name: "Mallory",
            publicKey: stranger.publicKey,
            role: "admin" as const,
          },
        ],
      }
      const forged = await proposeRoster({ trust: pretend, signer: stranger })
      const deploy = await buildDeploy({
        trust: w.trust,
        serverId: w.serverId,
        signer: w.signer,
        sequence: 3,
      })
      return { rosters: [...w.rosters, forged.envelope], deploy }
    }, "unknown_signer")
  })

  test("input that is not a request at all", async () => {
    const w = await world()
    const s = session(w.home, w.docker.path)
    const refusal = {
      events: [],
      result: { outcome: "refused", reason: "invalid_request" },
    }
    // The same inputs as the one-shot test, as the input of an `apply` request.
    for (const input of [
      undefined,
      "",
      "garbage",
      {},
      [],
      { rosters: w.rosters },
      { rosters: w.rosters, deploy: {}, extra: 1 },
    ]) {
      expect(
        await s.request(
          input === undefined
            ? { command: "apply" }
            : { command: "apply", input }
        )
      ).toEqual(refusal)
    }
    // And the same text as whole lines, which are not requests either. Two, so the session goes on.
    expect(await s.request("garbage")).toEqual(refusal)
    expect(await s.request("[]")).toEqual(refusal)
    expect((await s.request({ command: "version" })).result).toEqual({
      version: pkg.version,
      protocol: RUNNER_PROTOCOL,
    })
    expect((await s.close()).code).toBe(0)
    expect(w.docker.calls()).toEqual([])
  })
})
