/**
 * A version-2 deploy's payload has one spelling (contracts/message.md, F41;
 * security review S5, S6): its text is exactly `JSON.stringify` of what the
 * reader gives for it, which is what `createDeployV2` signs. A key written
 * twice, `-0`, `1e0`, whitespace, an escape `JSON.stringify` does not write
 * or keys in another order is `malformed`, at both readers of signed bytes:
 * the runner's (`verifyDeployV2`) and the history's (`readSignedDeployV2`).
 * Version 1 and the secret statements read as they did (FR-003).
 */
import { describe, expect, test } from "bun:test"

import {
  createDeploy,
  readSignedDeploy,
  readSignedDeployV2,
  verifySecretStatement,
} from "../../src/index"
import {
  PAYLOAD_TYPES,
  signEnvelope,
  type Envelope,
} from "../../src/crypto/envelope"
import { readDeployV2Format } from "../../src/deploy/message"
import { setSecret } from "../support/helpers"
import {
  deployV2,
  payloadOf,
  reason,
  verify,
  world,
  type World,
} from "../support/deploy-v2"
import { build, listed, partThreeTwo, payload } from "../support/payload-v2"

const bytes = (text: string) => new TextEncoder().encode(text)

/** Signs `text` as a version-2 deploy by the founder, a current member. */
const signed = (w: World, text: string) =>
  signEnvelope(PAYLOAD_TYPES.deployV2, bytes(text), w.founder.signer)

/** What each reader of signed bytes says: the runner's, then the history's. */
const readers = (w: World, envelope: Envelope) => [
  reason(verify(w, envelope)),
  reason(readSignedDeployV2({ envelope, trust: w.trust })),
]

/** The text of a deploy this library signs for `w`, made against 0. */
const signedText = async (w: World) =>
  Buffer.from((await deployV2(w)).envelope.payload, "base64url").toString(
    "utf8"
  )

describe("F41: another spelling of a signed payload is malformed", () => {
  test("the text this library signs reads at both readers", async () => {
    const w = await world()
    expect(readers(w, await signed(w, await signedText(w)))).toEqual([
      "accepted",
      "accepted",
    ])
  })

  test.each([
    ["a key written twice", '"previous":0', '"previous":5,"previous":0'],
    ["-0", '"previous":0', '"previous":-0'],
    ["1e0", '"sequence":1', '"sequence":1e0'],
    ["1.0", '"sequence":1', '"sequence":1.0'],
    ["a space after a colon", '"app":"web"', '"app": "web"'],
    ["a line feed between fields", ',"app"', ',\n"app"'],
    ["`a` written as \\u0061 in a key", '"app":', '"\\u0061pp":'],
    ["`w` written as \\u0077 in a value", '"app":"web"', '"app":"\\u0077eb"'],
    ["`/` written as \\/", '"compose":"', '"compose":"\\/'],
  ])("%s", async (_, from, to) => {
    const w = await world()
    const text = await signedText(w)
    expect(text).toContain(from)
    const changed = text.replace(from, to)
    // Each still parses as JSON, to a payload the schema reads.
    expect(readDeployV2Format(JSON.parse(changed)).ok).toBe(true)
    expect(readers(w, await signed(w, changed))).toEqual([
      "malformed",
      "malformed",
    ])
  })

  test("whitespace around the payload, and its keys in another order", async () => {
    const w = await world()
    const text = await signedText(w)
    const { v, ...rest } = JSON.parse(text) as Record<string, unknown>
    for (const changed of [
      ` ${text}`,
      `${text}\n`,
      JSON.stringify({ ...rest, v }),
    ])
      expect(readers(w, await signed(w, changed))).toEqual([
        "malformed",
        "malformed",
      ])
  })

  test("a later field in another spelling is malformed before it is unsupported_version", async () => {
    const w = await world()
    const later = {
      builds: [],
      predeploy: { service: "web", command: ["bun", "migrate"], timeout: 60 },
      health: null,
      routes: [],
    }
    const text = await signedText(w)
    const good = JSON.stringify({ ...JSON.parse(text), ...later })
    expect(reason(verify(w, await signed(w, good)))).toBe("unsupported_version")
    const spaced = good.replace('"timeout":60', '"timeout": 60')
    expect(reason(verify(w, await signed(w, spaced)))).toBe("malformed")
  })
})

describe("everything this library signs is in that spelling", () => {
  /** Payloads the reader takes, every later field among them, and text JSON escapes. */
  const fixtures = (): Record<string, unknown>[] => [
    payload(),
    payload({ previous: 0, sequence: 1 }),
    payload({
      previous: Number.MAX_SAFE_INTEGER - 1,
      sequence: Number.MAX_SAFE_INTEGER,
    }),
    payload({ expiresAt: "2026-11-21T10:00:00.000Z" }),
    payload({ secrets: listed(256) }),
    payload({
      secrets: listed(2),
      removed: [{ name: "OLD", version: 9 }],
    }),
    payload({
      compose:
        'services:\n\tweb: "quoted \\ back"   é \u{1F680} \u0001 / </script>\n',
    }),
    payload({ builds: [build()] }),
    partThreeTwo(),
  ]

  test("each fixture, signed as createDeployV2 signs it, reads at the history's reader as itself", async () => {
    const w = await world()
    for (const fixture of fixtures()) {
      const read = readDeployV2Format(fixture)
      if (!read.ok)
        throw new Error(`a fixture did not read: ${read.error.code}`)
      const text = JSON.stringify(read.value)
      const envelope = await signed(w, text)
      const again = readSignedDeployV2({ envelope, trust: w.trust })
      expect(again.ok && JSON.stringify(again.value.deploy)).toBe(text)
    }
  })

  test("deploys made by createDeployV2, with secrets, removals, an expiry and every later field, read at both readers", async () => {
    const w = await world()
    const made = await deployV2(w, {
      values: { A: "a", B: "b" },
      expiresAt: new Date("2026-11-21T10:00:00.000Z"),
    })
    expect(reason(verify(w, made.envelope, { records: made.records }))).toBe(
      "accepted"
    )
    expect(
      reason(readSignedDeployV2({ envelope: made.envelope, trust: w.trust }))
    ).toBe("accepted")
    const later = await deployV2(w, {
      later: {
        builds: [build()],
        predeploy: { service: "web", command: ["bun", "x"], timeout: 60 },
        health: {
          timeout: 30,
          services: [{ service: "web", http: { port: 80, path: "/up" } }],
        },
        routes: [{ domain: "demo.example.com", service: "web", port: 80 }],
      },
    })
    expect(readers(w, later.envelope)).toEqual([
      "unsupported_version",
      "accepted",
    ])
  })
})

describe("version 1 and the secret statements read as they did (FR-003)", () => {
  test("a version-1 deploy and a statement with whitespace and a key written twice still read", async () => {
    const w = await world()
    const record = await setSecret({
      relay: w.relay,
      trust: w.trust,
      server: w.server,
      signer: w.founder.signer,
      name: "A",
      value: "a",
      app: "web",
    })
    const statement = JSON.stringify(payloadOf(record.envelope))
    const spaced = await signEnvelope(
      PAYLOAD_TYPES.secret,
      bytes(statement.replace('"name":', '"name":"X", "name":')),
      w.founder.signer
    )
    expect(
      verifySecretStatement({
        envelope: spaced,
        trust: w.trust,
        serverId: w.server.serverId,
        app: "web",
      }).ok
    ).toBe(true)

    const v1 = await createDeploy({
      trust: w.trust,
      serverId: w.server.serverId,
      app: "web",
      sequence: 1,
      compose: "services: {}\n",
      secrets: [],
      removals: [],
      signer: w.founder.signer,
    })
    const text = JSON.stringify(payloadOf(v1.envelope)).replace(
      '"sequence":1',
      '"sequence": 1e0'
    )
    const respelled = await signEnvelope(
      PAYLOAD_TYPES.deploy,
      bytes(text),
      w.founder.signer
    )
    expect(readSignedDeploy({ envelope: respelled, trust: w.trust }).ok).toBe(
      true
    )
  })
})
