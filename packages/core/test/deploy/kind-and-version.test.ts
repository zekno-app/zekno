/**
 * SC-002: every pairing of kind (`zekno.deploy.v1`, `zekno.deploy.v2`) and
 * `v` (1, 2, 3), each signed with `signEnvelope`, through both versions'
 * verifiers and readers (contracts/message.md, F3). Only the two matching
 * pairs are read; the kind is inside the signature, so neither version's
 * envelope is ever taken for the other's.
 */
import { describe, expect, test } from "bun:test"

import {
  createDeploy,
  PAYLOAD_TYPES,
  readSignedDeploy,
  verifyDeploy,
} from "../../src/index"
import { readSignedDeployV2 } from "../../src/deploy/deploy-v2"
import { versionOneView } from "../../src/deploy/state"
import { COMPOSE } from "../support/helpers"
import {
  deployV2,
  payloadOf,
  reason,
  signAs,
  verify,
  world,
} from "../support/deploy-v2"

describe("SC-002: kind and v, through both versions' readers", () => {
  test("only the two matching pairs are read", async () => {
    const w = await world()
    const v1 = payloadOf(
      (
        await createDeploy({
          trust: w.trust,
          serverId: w.server.serverId,
          app: "web",
          sequence: 1,
          compose: COMPOSE,
          secrets: [],
          signer: w.founder.signer,
        })
      ).envelope
    )
    const v2 = payloadOf((await deployV2(w)).envelope)
    const state = w.state
    for (const kind of [PAYLOAD_TYPES.deploy, PAYLOAD_TYPES.deployV2])
      for (const [body, shape] of [
        [v1, 1],
        [v2, 2],
      ] as const)
        for (const v of [1, 2, 3]) {
          const envelope = await signAs(kind, { ...body, v }, w.founder.signer)
          const isV1 = kind === PAYLOAD_TYPES.deploy
          const label = `${kind}, body of ${shape}, v ${v}`
          const seen = {
            verifyDeploy: reason(
              verifyDeploy({
                envelope,
                secrets: [],
                state: versionOneView(state),
              })
            ),
            readSignedDeploy: reason(
              readSignedDeploy({ envelope, trust: w.trust })
            ),
            verifyDeployV2: reason(verify(w, envelope)),
            readSignedDeployV2: reason(
              readSignedDeployV2({ envelope, trust: w.trust })
            ),
          }
          const asV1 = !isV1
            ? "wrong_payload_type"
            : v === 1 && shape === 1
              ? "accepted"
              : undefined
          const asV2 = isV1
            ? "wrong_payload_type"
            : v === 2 && shape === 2
              ? "accepted"
              : "malformed"
          expect([label, seen]).toEqual([
            label,
            {
              verifyDeploy:
                asV1 ?? (v === 1 ? "malformed" : "unsupported_version"),
              readSignedDeploy: asV1 ?? "malformed",
              verifyDeployV2: asV2,
              readSignedDeployV2: asV2,
            },
          ])
        }
  })
})
