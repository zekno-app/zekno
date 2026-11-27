/**
 * `stillAllowed` (specs/016-build-from-source, contracts/core.md CO9, CO19;
 * FR-043, FR-044): K8 and K13 again, against the team lists the runner holds
 * now, for a deploy that was verified before they changed. The runner asks
 * it at K17, before and during each build, and at B3, so a member removed
 * mid-build stops counting, and so does every secret that member set. The
 * team hash is never compared: every team list update changes it.
 */
import { describe, expect, test } from "bun:test"

import {
  applyRosterUpdate,
  createSecret,
  type SecretRecord,
  type TeamTrust,
} from "../../src/index"
import type { Signer } from "../../src/crypto/keys"
import { DEPLOY_ROLES } from "../../src/deploy/deploy"
import {
  createDeployV2,
  type VerifiedDeployV2,
} from "../../src/deploy/deploy-v2"
import { stillAllowed } from "../../src/deploy/gate"
import type { StoredRunnerState } from "../../src/deploy/state"
import type { Member } from "../../src/team/roster"
import { changeTeam, COMPOSE, person } from "../support/helpers"
import {
  deployV2,
  holding,
  NOW,
  verify,
  world,
  type World,
} from "../support/deploy-v2"

function follow(team: TeamTrust, envelope: unknown): TeamTrust {
  const applied = applyRosterUpdate(team, envelope)
  if (!applied.ok) throw new Error(applied.error.code)
  return applied.value
}

/**
 * The world after an admin changes the team list, as the admin and the
 * runner each hold it; the runner's numbers and secrets are `state`'s.
 */
async function changed(
  w: World,
  trust: TeamTrust,
  state: StoredRunnerState,
  change: { members?: readonly Member[]; servers?: TeamTrust["servers"] }
) {
  const next = await changeTeam({
    relay: w.relay,
    trust,
    signer: w.founder.signer,
    ...change,
  })
  return {
    trust: next,
    state: { ...state, team: follow(state.team, w.relay.rosters.at(-1)) },
  }
}

/** The world with Bea in the team list as `role`, as the admin and the runner hold it. */
async function withBea(w: World, role: Member["role"] = "deployer") {
  const bea = person("Bea")
  const after = await changed(w, w.trust, w.state, {
    members: [
      ...w.trust.members,
      { name: "Bea", publicKey: bea.publicKey, role },
    ],
  })
  return { bea, ...after }
}

/** A deploy of `web` made against `previous` by `signer`, verified on `state`. */
async function verified(
  w: World,
  input: {
    trust: TeamTrust
    state: StoredRunnerState
    signer: Signer
    previous?: number
    statements?: readonly SecretRecord[]
    records?: readonly SecretRecord[]
    held?: readonly SecretRecord[]
  }
): Promise<VerifiedDeployV2> {
  const envelope = await createDeployV2({
    trust: input.trust,
    serverId: w.server.serverId,
    app: "web",
    previous: input.previous ?? 0,
    compose: COMPOSE,
    statements: (input.statements ?? []).map((record) => record.envelope),
    removals: [],
    expiresAt: null,
    signer: input.signer,
    now: NOW,
  })
  const result = verify(w, envelope, {
    state: input.state,
    records: input.records ?? [],
    held: holding(input.held ?? []),
  })
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

/** A secret of `web` set by `signer` on the team list `trust`. */
const secretBy = (
  w: World,
  trust: TeamTrust,
  signer: Signer,
  name: string,
  value = `value of ${name}`
) =>
  createSecret({
    trust,
    serverId: w.server.serverId,
    app: "web",
    name,
    value,
    version: 1,
    signer,
  })

describe("verifyDeployV2 keeps the records K13 verified as `used`", () => {
  test("supplied and held, in name order", async () => {
    const w = await world()
    const { records } = await deployV2(w, { values: { B: "b", A: "a" } })
    const [b, a] = records as [SecretRecord, SecretRecord]
    const first = await verified(w, {
      trust: w.trust,
      state: w.state,
      signer: w.founder.signer,
      statements: [b, a],
      records: [b, a],
    })
    expect(first.used).toEqual([a, b])
    // The next deploy sends A again and leaves B to what the runner holds.
    const next = await verified(w, {
      trust: w.trust,
      state: first.nextState,
      signer: w.founder.signer,
      previous: 1,
      statements: [b, a],
      records: [a],
      held: [b],
    })
    expect(next.used).toEqual([a, b])
    expect(Object.isFrozen(next.used)).toBe(true)
  })

  test("none for a deploy with no secrets", async () => {
    const w = await world()
    const result = await verified(w, {
      trust: w.trust,
      state: w.state,
      signer: w.founder.signer,
    })
    expect(result.used).toEqual([])
  })
})

describe("stillAllowed: allowed while the team lists still allow it", () => {
  test("with the same lists, and after an unrelated member is added", async () => {
    const w = await world()
    const secret = await secretBy(w, w.trust, w.founder.signer, "A")
    const result = await verified(w, {
      trust: w.trust,
      state: w.state,
      signer: w.founder.signer,
      statements: [secret],
      records: [secret],
    })
    expect(stillAllowed(w.state, result)).toBe(true)
    expect(stillAllowed(result.nextState, result)).toBe(true)
    const { state } = await withBea({ ...w, state: result.nextState })
    // The team hash changed; it is never compared.
    expect(state.team.hash).not.toBe(result.deploy.teamHash)
    expect(stillAllowed(state, result)).toBe(true)
  })
})

describe("stillAllowed: K8 again", () => {
  test("not allowed once the signer is removed, for a deploy with no secrets", async () => {
    const w = await world()
    const team = await withBea(w)
    const result = await verified(w, { ...team, signer: team.bea.signer })
    expect(result.deploy.secrets).toEqual([])
    expect(stillAllowed(team.state, result)).toBe(true)
    const without = await changed(w, team.trust, team.state, {
      members: w.trust.members,
    })
    expect(stillAllowed(without.state, result)).toBe(false)
  })

  test("not allowed once the signer's role becomes one that may not deploy", async () => {
    const w = await world()
    const team = await withBea(w, "admin")
    const result = await verified(w, { ...team, signer: team.bea.signer })
    const demoted = await changed(w, team.trust, team.state, {
      members: [
        ...w.trust.members,
        { name: "Bea", publicKey: team.bea.publicKey, role: "deployer" },
      ],
    })
    // Every role there is today may deploy, so this test stands in for a
    // role that may not: while it runs, only an admin may deploy.
    const roles = DEPLOY_ROLES as Member["role"][]
    const kept = [...roles]
    roles.splice(0, roles.length, "admin")
    try {
      expect(stillAllowed(team.state, result)).toBe(true)
      expect(stillAllowed(demoted.state, result)).toBe(false)
    } finally {
      roles.splice(0, roles.length, ...kept)
    }
    expect(stillAllowed(demoted.state, result)).toBe(true)
  })

  test("not allowed once the server is removed from the team list", async () => {
    const w = await world()
    const result = await verified(w, {
      trust: w.trust,
      state: w.state,
      signer: w.founder.signer,
    })
    const removed = await changed(w, w.trust, w.state, { servers: [] })
    expect(stillAllowed(removed.state, result)).toBe(false)
  })
})

describe("stillAllowed: K13 again, for every record the deploy used", () => {
  test("not allowed once the member who set a supplied secret is removed", async () => {
    const w = await world()
    const team = await withBea(w)
    const beas = await secretBy(w, team.trust, team.bea.signer, "A")
    const result = await verified(w, {
      ...team,
      signer: w.founder.signer,
      statements: [beas],
      records: [beas],
    })
    expect(result.used).toEqual([beas])
    expect(stillAllowed(team.state, result)).toBe(true)
    const without = await changed(w, team.trust, team.state, {
      members: w.trust.members,
    })
    // The signer, the founder, is still an admin: only Bea's secret stops counting.
    expect(stillAllowed(without.state, result)).toBe(false)
  })

  test("not allowed once the member who set a held secret is removed", async () => {
    const w = await world()
    const team = await withBea(w)
    const beas = await secretBy(w, team.trust, team.bea.signer, "A")
    const mine = await secretBy(w, team.trust, w.founder.signer, "B")
    const first = await verified(w, {
      ...team,
      signer: w.founder.signer,
      statements: [beas, mine],
      records: [beas, mine],
    })
    // The next deploy sends nothing: both records are the ones the runner holds.
    const next = await verified(w, {
      trust: team.trust,
      state: first.nextState,
      signer: w.founder.signer,
      previous: 1,
      statements: [beas, mine],
      held: [beas, mine],
    })
    expect(next.used).toEqual([beas, mine])
    expect(stillAllowed(first.nextState, next)).toBe(true)
    const without = await changed(w, team.trust, first.nextState, {
      members: w.trust.members,
    })
    expect(stillAllowed(without.state, next)).toBe(false)
  })
})
