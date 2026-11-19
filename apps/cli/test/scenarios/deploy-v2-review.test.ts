/**
 * Properties of a version-2 deploy from this machine that held when the
 * security review of feature 014 read the code, and that no test checked
 * (specs/014-deploy-v2/security-review.md, part 4), with `ready()`, the plain
 * interface and the runner of this repository: an app named `constructor`
 * from end to end; a `records` answer holding statements that are not this
 * team's, app's or signature's, each left out of the listing; and a
 * `records` answer that misses a statement, as a read beside a deploy that
 * replaces record files can, which only stops the deploy with C5.
 */
import { describe, expect, test } from "bun:test"
import { createSecret, type Envelope } from "@workspace/core"

import { openTeam } from "../../src/cli/context"
import { C5 } from "../../src/shared/deploy-words"
import { historyOf, payloadOf, stateBytes, stateOf } from "../support/deploys"
import {
  COMPOSE_V1,
  COMPOSE_V2,
  ready,
  serverIdOf,
  twin,
} from "../support/helpers"
import { signingTeam } from "../support/signing-team"
import { wire } from "../support/wire"

type Machine = Awaited<ReturnType<typeof ready>>

const where = ["--app", "web", "--server", "dev"]

async function set(m: Machine, name: string, value: string, at = where) {
  m.typing(value)
  expect(await m.zekno("secret", "set", name, ...at)).toBe(0)
}

describe("an app named `constructor`", () => {
  test("is set, deployed twice, read by `records` and `status`, and rolled back", async () => {
    const m = await ready()
    const at = ["--app", "constructor", "--server", "dev"]
    await set(m, "GREETING", "hello", at)
    expect(await m.zekno("deploy", ...at)).toBe(0)
    expect(m.lastOut()).toBe(
      "Deploy 1 of constructor is running on dev with 1 secret."
    )
    const w = wire(m.deps)
    m.compose(COMPOSE_V2)
    expect(await m.zekno("deploy", ...at)).toBe(0)
    // The second deploy listed the runner's statement and sent no record.
    const [records] = w.requests("records")
    expect(records).toEqual({
      command: "records",
      input: { app: "constructor" },
    })
    const [sent] = w.requests("deploy") as {
      input: { records: unknown[]; envelope: Envelope }
    }[]
    expect(sent!.input.records).toEqual([])
    expect(payloadOf(sent!.input.envelope)).toMatchObject({
      app: "constructor",
      previous: 1,
      sequence: 2,
    })

    m.out.length = 0
    expect(await m.zekno("status", "--server", "dev")).toBe(0)
    expect(m.out).toContain("constructor/GREETING\tversion 1")
    expect(await m.zekno("rollback", ...at)).toBe(0)
    expect(m.out).toContain("Rolling back constructor to what deploy 1 ran.")
    const state = stateOf(m)
    expect(state.lastSequence).toEqual({ constructor: 3 })
    expect(state.formats).toEqual({ constructor: 2 })
    expect(m.docker.calls().at(-1)!.env.GREETING).toBe("hello")
  })
})

describe("what the CLI takes from a `records` answer", () => {
  test("a statement for another app, one of another team, and one whose signature does not verify are each left out, with today's warning", async () => {
    const m = await ready()
    await set(m, "GREETING", "hello")
    expect(await m.zekno("deploy", ...where)).toBe(0)
    const team = await openTeam(m.deps)
    const serverId = serverIdOf(m)
    const otherApp = await team.withSigner((signer) =>
      createSecret({
        trust: team.trust,
        serverId,
        app: "api",
        name: "API_KEY",
        value: "x",
        version: 1,
        signer,
      })
    )
    const otherTeam = await (await signingTeam("web")).secret("TOKEN", "x", 1)
    const broken: Envelope = {
      ...otherApp.envelope,
      signature: {
        ...otherApp.envelope.signature,
        // The first character, never the last ones: an Ed25519 signature often ends in zero bits, and then "AA" changes nothing.
        sig: `${otherApp.envelope.signature.sig.startsWith("A") ? "B" : "A"}${otherApp.envelope.signature.sig.slice(1)}`,
      },
    }
    const w = wire(m.deps)
    w.rewrite("records", (result) => ({
      statements: [
        ...(result.statements as Envelope[]),
        otherApp.envelope,
        otherTeam.envelope,
        broken,
      ],
    }))
    m.err.length = 0
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.lastOut()).toBe("Deploy 2 of web is running on dev with 1 secret.")
    expect(m.err).toEqual([
      "Left out a record: wrong_app.",
      "Left out a record: unknown_signer.",
      "Left out a record: bad_signature.",
    ])
    const [sent] = w.requests("deploy") as {
      input: { records: unknown[]; envelope: Envelope }
    }[]
    expect(
      (payloadOf(sent!.input.envelope).secrets as { name: string }[]).map(
        (secret) => secret.name
      )
    ).toEqual(["GREETING"])
    expect(sent!.input.records).toEqual([])
  })

  test("an answer that misses a live secret's statement, as a read beside a deploy that replaces its file can, stops with C5 and signs nothing", async () => {
    const m = await ready()
    await set(m, "GREETING", "hello")
    expect(await m.zekno("deploy", ...where)).toBe(0)
    // A second machine, without the record, deploys from the server's statement; here its read missed it.
    const other = await twin(m)
    other.compose(COMPOSE_V1)
    const w = wire(other.deps)
    w.rewrite("records", () => ({ statements: [] }))
    const state = stateBytes(m)
    expect(await other.zekno("deploy", ...where)).toBe(1)
    expect(other.lastErr()).toBe(C5("GREETING", "web", "dev"))
    expect(historyOf(other, "web")).toEqual([])
    expect(stateBytes(m)).toBe(state)
    // Read again in full, the same deploy goes through.
    w.rewrite("records", undefined)
    expect(await other.zekno("deploy", ...where)).toBe(0)
    expect(other.lastOut()).toBe(
      "Deploy 2 of web is running on dev with 1 secret."
    )
  })
})
