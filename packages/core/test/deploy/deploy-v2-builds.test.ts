/**
 * Signing a version-2 deploy's builds (specs/016-build-from-source,
 * contracts/core.md CO8; FR-025, FR-063, FR-064a): `createDeployV2` takes
 * them as an input of their own, signs them sorted by key, and reads the
 * payload back before signing (F4 to F6, F41), so a build a runner would call
 * `malformed` is never signed. It adds no F7: what a runner carries out is
 * the runner's table (CO7), kept from a runner that lacks a row by zekno's
 * protocol checks (CL7). The rest of signing and K4 to K10 are in
 * deploy-v2.test.ts, which is near its bound. And the next state
 * `verifyDeployV2` gives, marked 5 (CO13): it carries the builds kept and the
 * build in progress over unchanged, as it carries the routes in force and the
 * released domains, whatever the deploy asks. The runner writes them itself,
 * each under the state lock (`deploy/kept-builds.ts`).
 */
import { describe, expect, test } from "bun:test"

import { createSecretRemoval } from "../../src/index"
import type { Signer } from "../../src/crypto/keys"
import { createDeployV2, readSignedDeployV2 } from "../../src/deploy/deploy-v2"
import type { Build } from "../../src/deploy/builds"
import { readRunnerState, type StoredRunnerState } from "../../src/deploy/state"
import type { SecretRecord } from "../../src/secrets/secret-record"
import { setSecret } from "../support/helpers"
import { AT, building, entry, imageOf, keyOf } from "../support/builds"
import {
  deepFreeze,
  deployV2,
  NOW,
  payloadOf,
  reason,
  verify,
  world,
  type World,
} from "../support/deploy-v2"
import { build, composeFor, hex, railpackBuild } from "../support/payload-v2"

/** The code `CoreError` a promise rejects with, or "signed". */
const refusal = async (promise: Promise<unknown>) =>
  promise.then(
    () => "signed",
    (error: { code?: string }) => error.code
  )

const hashOf = (record: SecretRecord) =>
  payloadOf(record.envelope).hash as string

const keysOf = (envelope: Parameters<typeof payloadOf>[0]) =>
  (payloadOf(envelope).builds as Build[]).map((entry) => entry.key)

/** The founder's signer, counting each signature it makes. */
function counting(w: World): { signer: Signer; count: () => number } {
  let made = 0
  return {
    signer: {
      publicKey: w.founder.signer.publicKey,
      sign: (message) => {
        made += 1
        return w.founder.signer.sign(message)
      },
    },
    count: () => made,
  }
}

/** A good `createDeployV2` call of `web` in this world, with these builds and a Compose text that runs them. */
const signing = (w: World, builds: unknown, signer: Signer) =>
  createDeployV2({
    trust: w.trust,
    serverId: w.server.serverId,
    app: "web",
    previous: 0,
    compose: composeFor(
      "web",
      Array.isArray(builds)
        ? builds.filter(
            (entry): entry is { key: string } =>
              typeof (entry as { key?: unknown } | null)?.key === "string"
          )
        : []
    ),
    statements: [],
    removals: [],
    expiresAt: null,
    builds: builds as readonly Build[],
    signer,
    now: NOW,
  })

describe("createDeployV2: builds are an input of their own (CO8)", () => {
  test("two builds given in reverse key order are signed sorted", async () => {
    const w = await world()
    const one = build()
    const two = build({ pack: { hash: hex(300), size: 1, chunks: [hex(301)] } })
    const [low, high] = [one, two].sort((a, b) => (a.key < b.key ? -1 : 1))
    const { envelope } = await deployV2(w, { builds: [high!, low!] })
    expect(keysOf(envelope)).toEqual([low!.key, high!.key])
    // A Dockerfile build with no secret is carried out at step 1 (CO7).
    expect(reason(verify(w, envelope))).toBe("accepted")
  })

  test("no builds given signs an empty list", async () => {
    const w = await world()
    expect(keysOf((await deployV2(w)).envelope)).toEqual([])
    expect(keysOf((await deployV2(w, { builds: [] })).envelope)).toEqual([])
  })

  test("a key given twice throws invalid_argument", async () => {
    const w = await world()
    const made = build()
    expect(await refusal(deployV2(w, { builds: [made, made] }))).toBe(
      "invalid_argument"
    )
    expect(
      await refusal(deployV2(w, { builds: [made, { ...made, timeout: 60 }] }))
    ).toBe("invalid_argument")
  })

  test("a build with a wrong key throws invalid_argument, and nothing is signed", async () => {
    const w = await world()
    const signer = counting(w)
    const wrong = { ...build(), key: hex(999) }
    expect(await refusal(signing(w, [wrong], signer.signer))).toBe(
      "invalid_argument"
    )
    expect(signer.count()).toBe(0)
    // With its own key, the same build is signed, once.
    expect(await refusal(signing(w, [build()], signer.signer))).toBe("signed")
    expect(signer.count()).toBe(1)
  })

  test("anything that is not a list of objects with a text key throws invalid_argument, and nothing is signed", async () => {
    const w = await world()
    const signer = counting(w)
    for (const builds of [
      "builds",
      { key: hex(1) },
      [null],
      ["text"],
      [{}],
      [{ ...build(), key: 7 }],
      [build(), null],
    ])
      expect(await refusal(signing(w, builds, signer.signer))).toBe(
        "invalid_argument"
      )
    expect(signer.count()).toBe(0)
  })

  test("a rollback that passes an earlier deploy's builds throws once a build secret was set again or removed (FR-064a)", async () => {
    const w = await world()
    const set = (value: string, version: number) =>
      setSecret({
        relay: w.relay,
        trust: w.trust,
        server: w.server,
        signer: w.founder.signer,
        name: "TOKEN",
        value,
        version,
      })
    const first = await set("first value", 1)
    const made = build({ secrets: ["TOKEN"] }, [
      { name: "TOKEN", hash: hashOf(first) },
    ])
    // Deploy 2 builds with the secret as it was then.
    const two = await deployV2(w, {
      previous: 1,
      statements: [first.envelope],
      builds: [made],
    })
    const builds = payloadOf(two.envelope).builds as Build[]
    expect(builds).toEqual([made])

    // With the listing unchanged, its builds are signed again as they were.
    const again = await deployV2(w, {
      previous: 2,
      statements: [first.envelope],
      builds,
    })
    expect(keysOf(again.envelope)).toEqual([made.key])

    // Set again: another listed hash, so the key differs.
    const second = await set("second value", 2)
    expect(hashOf(second)).not.toBe(hashOf(first))
    expect(
      await refusal(
        deployV2(w, { previous: 2, statements: [second.envelope], builds })
      )
    ).toBe("invalid_argument")

    // Removed: the build reads a secret the deploy no longer lists.
    const removal = await createSecretRemoval({
      trust: w.trust,
      serverId: w.server.serverId,
      app: "web",
      name: "TOKEN",
      version: 2,
      signer: w.founder.signer,
    })
    expect(
      await refusal(deployV2(w, { previous: 2, removals: [removal], builds }))
    ).toBe("invalid_argument")
  })

  test("a Railpack build is signed, and verifyDeployV2 answers it unsupported_version (CO7, step 1)", async () => {
    const w = await world()
    const made = railpackBuild()
    const { envelope } = await deployV2(w, { builds: [made] })
    expect(payloadOf(envelope).builds).toEqual([made])
    expect(reason(verify(w, envelope))).toBe("unsupported_version")
    // The history's reader does not judge what a runner carries out.
    expect(reason(readSignedDeployV2({ envelope, trust: w.trust }))).toBe(
      "accepted"
    )
  })
})

describe("verifyDeployV2 and the builds in the state", () => {
  test("the next state is marked 5 and keeps builds and building as they were", async () => {
    const w = await world()
    const state: StoredRunnerState = deepFreeze({
      ...w.state,
      lastSequence: { shop: 3, web: 1 },
      formats: { shop: 2, web: 2 },
      builds: {
        shop: entry({
          running: 2,
          images: [imageOf(1)],
          deploys: [{ sequence: 2, keys: [keyOf(1)] }],
          last: { sequence: 3, outcome: "built", reason: null, at: AT },
        }),
        web: entry({
          running: 1,
          images: [imageOf(2)],
          deploys: [{ sequence: 1, keys: [keyOf(2)] }],
          drop: [imageOf(3)],
          last: { sequence: 1, outcome: "reused", reason: null, at: AT },
        }),
      },
      building: building("shop", 3, { phase: "stopping", stopped: AT }),
    })
    const before = JSON.stringify(state)
    const { envelope } = await deployV2(w, { previous: 1 })
    const result = verify(w, envelope, { state })
    if (!result.ok) throw new Error(result.error.code)
    const next = result.value.nextState
    expect(next.v).toBe(5)
    expect(next.lastSequence).toEqual({ shop: 3, web: 2 })
    expect(next.builds).toEqual(state.builds)
    expect(next.building).toEqual(state.building)
    expect(readRunnerState(next)).toEqual(next)
    expect(Object.isFrozen(next.builds)).toBe(true)
    expect(JSON.stringify(state)).toBe(before)
  })

  test("a state with no builds gives a next state with no builds and no building", async () => {
    const w = await world()
    const { envelope } = await deployV2(w)
    const result = verify(w, envelope)
    if (!result.ok) throw new Error(result.error.code)
    const next = result.value.nextState
    expect(next.v).toBe(5)
    expect(next.builds).toEqual({})
    expect(next.building).toBeNull()
    expect(readRunnerState(next)).toEqual(next)
  })
})
