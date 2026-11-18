/**
 * SC-001: a deploy that was overtaken can never run. From a new runner's
 * state, sets of up to three deploys of one app are delivered in every order
 * of every non-empty subset, as a relay that holds them could deliver them,
 * and each acceptance's next state is taken before the next delivery.
 */
import { describe, expect, test } from "bun:test"

import { createDeployV2 } from "../../src/deploy/deploy-v2"
import type { StoredRunnerState } from "../../src/deploy/state"
import type { Envelope } from "../../src/crypto/envelope"
import { deepFreeze, NOW, reason, verify, world } from "../support/deploy-v2"

type Made = { name: string; previous: number; envelope: Envelope }

/** Every ordering of every non-empty subset of `items`. */
function deliveries<T>(items: readonly T[]): T[][] {
  const orders: T[][] = []
  const grow = (order: T[], left: readonly T[]) => {
    if (order.length > 0) orders.push(order)
    left.forEach((item, index) =>
      grow(
        [...order, item],
        [...left.slice(0, index), ...left.slice(index + 1)]
      )
    )
  }
  grow([], items)
  return orders
}

describe("SC-001: the order of deploys", () => {
  test("every ordering of a set of three gives 15 deliveries", () => {
    expect(deliveries([1, 2, 3])).toHaveLength(15)
  })

  test("once a deploy is accepted, nothing made against a lower number is, whatever the order of delivery", async () => {
    const w = await world()
    const made = async (name: string, previous: number): Promise<Made> => ({
      name,
      previous,
      envelope: await createDeployV2({
        trust: w.trust,
        serverId: w.server.serverId,
        app: "web",
        previous,
        compose: `services:\n  web:\n    image: example/web:${name}\n`,
        statements: [],
        removals: [],
        expiresAt: null,
        signer: w.founder.signer,
        now: NOW,
      }),
    })
    const sets: Record<string, Made[]> = {
      "three made against 0": [
        await made("A", 0),
        await made("B", 0),
        await made("C", 0),
      ],
      "a chain made against 0, 1 and 2": [
        await made("A", 0),
        await made("B", 1),
        await made("C", 2),
      ],
      "a chain of two and one more made against 0": [
        await made("A", 0),
        await made("B", 1),
        await made("C", 0),
      ],
    }
    let runs = 0
    for (const [set, deploys] of Object.entries(sets))
      for (const order of deliveries(deploys)) {
        runs++
        let state: StoredRunnerState = deepFreeze(w.state)
        let highest = 0
        const accepted: string[] = []
        for (const deploy of order) {
          const before = state
          const copy = JSON.stringify(state)
          const result = verify(w, deploy.envelope, { state })
          const where = `${set}: ${order.map((d) => d.name).join(", ")}, at ${deploy.name}`
          if (result.ok) {
            // Made against exactly the number before it, never one below what ran.
            expect([where, deploy.previous]).toEqual([where, highest])
            expect([where, result.value.deploy.sequence]).toEqual([
              where,
              highest + 1,
            ])
            highest = result.value.deploy.sequence
            accepted.push(deploy.name)
            state = result.value.nextState
          } else {
            // Refused only for the order, and nothing kept: the state is the one it was given.
            expect([where, reason(result)]).toEqual([
              where,
              deploy.previous < highest ? "replayed" : "sequence_jump",
            ])
            expect([where, state === before]).toEqual([where, true])
            expect([where, JSON.stringify(state)]).toEqual([where, copy])
          }
          expect(state.lastSequence.web ?? 0).toBe(highest)
        }
        // Once a deploy was accepted, every later acceptance was made against it.
        for (const [index, name] of accepted.entries()) {
          const deploy = deploys.find((d) => d.name === name)!
          expect(deploy.previous).toBe(index)
        }
      }
    expect(runs).toBe(45)
  })
})
