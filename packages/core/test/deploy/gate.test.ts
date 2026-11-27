/**
 * The gate of the runner's `pack` (specs/016-build-from-source,
 * contracts/core.md CO9, CO12; FR-028; runner.md RB2 steps 2 and 3):
 * `admitPiece` bounds the piece before anything is hashed, runs K4 to K10
 * with F7 as a session deploy, and admits only a piece the deploy lists. It
 * uses nothing up, opens no secret, registers nothing and changes no state.
 * K4 to K10 in full are in deploy-v2.test.ts.
 */
import { describe, expect, test } from "bun:test"

import { applyRosterUpdate, openSecrets, type TeamTrust } from "../../src/index"
import { utf8 } from "../../src/crypto/encoding"
import type { StoredRunnerState } from "../../src/deploy/state"
import { admitPiece } from "../../src/deploy/gate"
import { sealPiece } from "../../src/pack/pieces"
import { LIMITS } from "../../src/protocol/limits"
import { changeTeam, person } from "../support/helpers"
import {
  deepFreeze,
  deployV2,
  NOW,
  payloadOf,
  reason,
  signV2,
  world,
  type World,
} from "../support/deploy-v2"
import { build, hex, railpackBuild } from "../support/payload-v2"

const MINUTE = 60 * 1000

/** A piece of `text`, sealed for this world's server. */
const piece = (w: World, text: string) =>
  sealPiece(utf8(text), w.server.publicKey)

/** A Dockerfile build whose one-piece pack lists `fingerprint`. */
const listing = (fingerprint: string, pack = 100) =>
  build({
    pack: { hash: hex(pack), size: 20, chunks: [fingerprint] },
  })

function admit(
  w: World,
  envelope: unknown,
  sealed: Uint8Array,
  options: { state?: StoredRunnerState; now?: Date } = {}
) {
  return admitPiece({
    envelope,
    state: options.state ?? w.state,
    now: options.now ?? NOW,
    piece: sealed,
  })
}

function follow(team: TeamTrust, envelope: unknown): TeamTrust {
  const applied = applyRosterUpdate(team, envelope)
  if (!applied.ok) throw new Error(applied.error.code)
  return applied.value
}

describe("admitPiece: a listed piece of a deploy that passes K4 to K10", () => {
  test("a listed code piece is admitted with its fingerprint, from any build of the deploy", async () => {
    const w = await world()
    const one = piece(w, "the first build's code")
    const two = piece(w, "the second build's code")
    const { envelope } = await deployV2(w, {
      builds: [listing(one.fingerprint, 100), listing(two.fingerprint, 200)],
    })
    for (const { sealed, fingerprint } of [one, two]) {
      const admitted = admit(w, envelope, sealed)
      expect(reason(admitted)).toBe("accepted")
      if (!admitted.ok) continue
      expect(admitted.value.fingerprint).toBe(fingerprint)
      expect(admitted.value.deploy.builds).toEqual(
        payloadOf(envelope).builds as never
      )
    }
  })

  test("the same envelope and piece twice are both admitted: nothing is used up", async () => {
    const w = await world()
    const { sealed, fingerprint } = piece(w, "code")
    const { envelope } = await deployV2(w, { builds: [listing(fingerprint)] })
    expect(reason(admit(w, envelope, sealed))).toBe("accepted")
    expect(reason(admit(w, envelope, sealed))).toBe("accepted")
  })

  test("it opens no secret and registers nothing: openSecrets answers its result not_verified", async () => {
    const w = await world()
    const { sealed, fingerprint } = piece(w, "code")
    const { envelope } = await deployV2(w, { builds: [listing(fingerprint)] })
    const admitted = admit(w, envelope, sealed)
    if (!admitted.ok) throw new Error(admitted.error.code)
    expect(
      reason(openSecrets(admitted.value as never, w.server.secretKey))
    ).toBe("not_verified")
  })

  test("the state is deeply equal before and after", async () => {
    const w = await world()
    const { sealed, fingerprint } = piece(w, "code")
    const { envelope } = await deployV2(w, { builds: [listing(fingerprint)] })
    const before = structuredClone(w.state)
    const state = deepFreeze(structuredClone(w.state))
    expect(reason(admit(w, envelope, sealed, { state }))).toBe("accepted")
    expect(
      reason(admit(w, envelope, piece(w, "other").sealed, { state }))
    ).toBe("pack_mismatch")
    expect(state).toEqual(before)
    expect(w.state).toEqual(before)
  })
})

describe("admitPiece: the K reasons, as for a session deploy", () => {
  test("an expired deploy is expired", async () => {
    const w = await world()
    const { sealed, fingerprint } = piece(w, "code")
    const { envelope } = await deployV2(w, {
      builds: [listing(fingerprint)],
      expiresAt: new Date(NOW.getTime() + MINUTE),
    })
    expect(reason(admit(w, envelope, sealed))).toBe("accepted")
    expect(
      reason(
        admit(w, envelope, sealed, {
          now: new Date(NOW.getTime() + 2 * MINUTE),
        })
      )
    ).toBe("expired")
  })

  test("a deploy for another server is wrong_server", async () => {
    const w = await world()
    const { sealed, fingerprint } = piece(w, "code")
    const good = payloadOf(
      (await deployV2(w, { builds: [listing(fingerprint)] })).envelope
    )
    const other = await signV2(
      { ...good, serverId: `srv_${"0".repeat(32)}` },
      w.founder.signer
    )
    expect(reason(admit(w, other, sealed))).toBe("wrong_server")
  })

  test("a replayed deploy (previous below the app's last number) is replayed", async () => {
    const w = await world()
    const { sealed, fingerprint } = piece(w, "code")
    const state = {
      ...w.state,
      lastSequence: { web: 3 },
      formats: { web: 2 as const },
    }
    const made = async (previous: number) =>
      (await deployV2(w, { previous, builds: [listing(fingerprint)] })).envelope
    expect(reason(admit(w, await made(3), sealed, { state }))).toBe("accepted")
    expect(reason(admit(w, await made(2), sealed, { state }))).toBe("replayed")
  })

  test("a deploy on a stale team list is stale_team", async () => {
    const w = await world()
    const { sealed, fingerprint } = piece(w, "code")
    const { envelope } = await deployV2(w, { builds: [listing(fingerprint)] })
    await changeTeam({
      relay: w.relay,
      trust: w.trust,
      signer: w.founder.signer,
      members: [
        ...w.trust.members,
        { name: "Bea", publicKey: person("Bea").publicKey, role: "deployer" },
      ],
    })
    const state = {
      ...w.state,
      team: follow(w.state.team, w.relay.rosters.at(-1)),
    }
    expect(reason(admit(w, envelope, sealed, { state }))).toBe("stale_team")
  })
})

describe("admitPiece: pack_mismatch", () => {
  test("a piece one byte over the bound is pack_mismatch, before anything is hashed", async () => {
    const w = await world()
    const { fingerprint } = piece(w, "code")
    const { envelope } = await deployV2(w, { builds: [listing(fingerprint)] })
    const over = new Uint8Array(LIMITS.sealedPieceBytes + 1)
    expect(reason(admit(w, envelope, over))).toBe("pack_mismatch")
    // Before the envelope is read: even one that is not an envelope.
    expect(reason(admit(w, "not an envelope", over))).toBe("pack_mismatch")
    expect(reason(admit(w, "not an envelope", over.subarray(0, -1)))).toBe(
      "malformed"
    )
  })

  test("a piece the deploy does not list is pack_mismatch, the same bytes sealed again among them", async () => {
    const w = await world()
    const { sealed, fingerprint } = piece(w, "code")
    const { envelope } = await deployV2(w, { builds: [listing(fingerprint)] })
    expect(reason(admit(w, envelope, sealed))).toBe("accepted")
    expect(reason(admit(w, envelope, piece(w, "code").sealed))).toBe(
      "pack_mismatch"
    )
    expect(reason(admit(w, envelope, new Uint8Array()))).toBe("pack_mismatch")
    // A deploy with no build lists no piece.
    const plain = (await deployV2(w)).envelope
    expect(reason(admit(w, plain, sealed))).toBe("pack_mismatch")
  })

  test("a Railpack deploy's plan piece is unsupported_version in step 1: F7 comes first", async () => {
    const w = await world()
    const plan = piece(w, "a plan")
    const code = piece(w, "code")
    const made = railpackBuild({
      pack: { hash: hex(100), size: 20, chunks: [code.fingerprint] },
      builder: {
        name: "railpack",
        version: "0.9.2",
        frontend: `ghcr.io/railwayapp/railpack-frontend@sha256:${hex(110)}`,
        images: [`ghcr.io/railwayapp/railpack-builder@sha256:${hex(111)}`],
        plan: { hash: hex(113), size: 6, piece: plan.fingerprint },
      },
    })
    const { envelope } = await deployV2(w, { builds: [made] })
    expect(reason(admit(w, envelope, plan.sealed))).toBe("unsupported_version")
    expect(reason(admit(w, envelope, code.sealed))).toBe("unsupported_version")
  })
})
