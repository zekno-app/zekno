/**
 * The answer to a version-2 deploy (specs/014-deploy-v2, contracts/cli.md
 * CL10 and "C1, C2 and R1 after `replayed`"; research R6, R30; tasks T030),
 * with a stand-in `Session`: a refused deploy used no number, so its entry
 * leaves the history; `replayed` reads the runner again on the same session
 * and says C1, C2 or R1; any other reason says its version-2 sentence; an
 * answer that never came leaves the entry `sent`.
 */
import { describe, expect, test } from "bun:test"
import {
  RunnerReportSchema,
  type Envelope,
  type RunnerStatus,
} from "@workspace/core"

import { CliError, explainDeploy, RunnerRefused } from "../../src/cli/errors"
import { deployAnswer } from "../../src/ops/deploy-answer"
import type { History } from "../../src/profile/profile"
import { ENDED, UNEXPECTED, type Session } from "../../src/server/session"
import { C1, C2 } from "../../src/shared/deploy-words"
import { signingTeam } from "../support/signing-team"

const A = "services:\n  web:\n    image: example/web:1\n"
const B = A.replace("web:1", "web:2")
const AT = "2026-11-18T00:00:00.000Z"

/**
 * A session whose answers the test gives, one per request, in order: a
 * value is checked against the request's schema as the real session checks
 * it (an answer that does not match is `UNEXPECTED`), an error is thrown.
 */
function standIn(answers: unknown[]) {
  const asked: string[] = []
  const session: Session = {
    mode: "session",
    runner: { version: "0.1.0", protocol: 3 },
    async request(command, schema) {
      asked.push(command)
      if (answers.length === 0)
        throw new Error(`the test gave no answer for ${command}`)
      const answer = answers.shift()
      if (answer instanceof Error) throw answer
      const parsed = schema.safeParse(answer)
      if (!parsed.success) throw new CliError(UNEXPECTED)
      return parsed.data
    },
    close: async () => undefined,
  }
  return { session, asked }
}

/** A team with deploy 41 of demo answered, and deploy 42, made after it, sent and not yet answered. */
async function deployed(options: { rollback?: boolean } = {}) {
  const t = await signingTeam()
  const store = t.team.store
  const fortyOne = await t.deployV2(40, A)
  const envelope = await t.deployV2(41, B)
  const entry = (
    signed: Envelope,
    outcome: History[number]["outcome"]
  ): History[number] => ({ envelope: signed, at: AT, outcome })
  store.saveHistory(t.server.serverId, "demo", [
    entry(fortyOne, "started"),
    entry(envelope, "sent"),
  ])
  const status = (
    lastSequence: Record<string, number>,
    serverId = t.server.serverId
  ): RunnerStatus => ({
    serverId,
    serverPublicKey: t.serverKeys.publicKey,
    team: {
      teamId: t.trust.teamId,
      version: t.trust.version,
      hash: t.trust.hash,
    },
    lastSequence,
    secrets: {},
  })
  /** Sends this deploy over `session`, then waits for the answer as `sendDeploy` does. */
  const answer = (session: Session) =>
    deployAnswer(
      session.request("deploy", RunnerReportSchema, {
        input: { rosters: [], envelope, records: [] },
      }),
      {
        session,
        team: t.team,
        server: t.server,
        app: "demo",
        previous: 41,
        envelope,
        rollback: options.rollback === true,
      }
    )
  const history = () => store.history(t.server.serverId, "demo")
  return { t, store, envelope, fortyOne, entry, status, answer, history }
}

/** What `work` threw: its class and its sentence, and the reason of a refusal. */
async function thrown(work: () => Promise<unknown>) {
  try {
    await work()
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return {
      kind: error.constructor.name,
      message: error.message,
      ...(error instanceof RunnerRefused ? { reason: error.reason } : {}),
    }
  }
  throw new Error("nothing was thrown")
}

const refused = (reason: string) => new RunnerRefused(reason)

describe("after `replayed`, the runner read again on the same session", () => {
  test("C1: the app is above the deploy it was made after", async () => {
    const d = await deployed()
    const { session, asked } = standIn([
      refused("replayed"),
      d.status({ demo: 43 }),
    ])
    expect(await thrown(() => d.answer(session))).toEqual({
      kind: "CliError",
      message: C1("demo", "dev", 43, false),
    })
    expect(asked).toEqual(["deploy", "status"])
  })

  test("C1's rollback form, for a rollback", async () => {
    const d = await deployed({ rollback: true })
    const { session } = standIn([refused("replayed"), d.status({ demo: 42 })])
    expect(await thrown(() => d.answer(session))).toEqual({
      kind: "CliError",
      message: C1("demo", "dev", 42, true),
    })
    expect(C1("demo", "dev", 42, true)).toContain("Run zekno rollback again")
  })

  test("C2: another entry of the app numbered as the runner's last, whose answer never came", async () => {
    const d = await deployed()
    // Deploy 42 signed from another terminal of this machine, against 41 too, and never answered.
    const other = await d.t.deployV2(41, "services: {}\n")
    d.store.saveHistory(d.t.server.serverId, "demo", [
      d.entry(d.fortyOne, "started"),
      d.entry(other, "sent"),
      d.entry(d.envelope, "sent"),
    ])
    const { session } = standIn([refused("replayed"), d.status({ demo: 42 })])
    expect(await thrown(() => d.answer(session))).toEqual({
      kind: "CliError",
      message: C2("demo", "dev", 42),
    })
    // The other entry is kept as it was; only this deploy's entry is gone.
    expect(d.history()).toEqual([
      d.entry(d.fortyOne, "started"),
      d.entry(other, "sent"),
    ])
  })

  test("C2 counts a version-1 entry whose answer never came (research R30)", async () => {
    const d = await deployed()
    const older = await d.t.deployV1(42, "services: {}\n")
    d.store.saveHistory(d.t.server.serverId, "demo", [
      d.entry(older, "sent"),
      d.entry(d.envelope, "sent"),
    ])
    const { session } = standIn([refused("replayed"), d.status({ demo: 42 })])
    expect((await thrown(() => d.answer(session))).message).toBe(
      C2("demo", "dev", 42)
    )
  })

  test("C1, not C2, when the entry numbered as the runner's last was answered, or is of another number", async () => {
    for (const [sequence, outcome] of [
      [42, "started"],
      [42, "start_failed"],
      [43, "sent"],
    ] as const) {
      const d = await deployed()
      const other = await d.t.deployV1(sequence, "services: {}\n")
      d.store.saveHistory(d.t.server.serverId, "demo", [
        d.entry(other, outcome),
        d.entry(d.envelope, "sent"),
      ])
      const { session } = standIn([refused("replayed"), d.status({ demo: 42 })])
      expect((await thrown(() => d.answer(session))).message).toBe(
        C1("demo", "dev", 42, false)
      )
    }
  })

  test("R1: the second `status` refused, unreadable, of another server, or not above the deploy it was made after", async () => {
    const R1 = explainDeploy("replayed", 2)
    const other = await signingTeam()
    type Deployed = Awaited<ReturnType<typeof deployed>>
    const seconds: [string, (d: Deployed) => unknown][] = [
      ["refused", () => refused("busy")],
      ["unreadable", () => ({ lastSequence: { demo: 43 } })],
      ["ended", () => new CliError(ENDED)],
      [
        "another server",
        (d) => ({
          ...d.status({ demo: 43 }, other.server.serverId),
          serverPublicKey: other.serverKeys.publicKey,
        }),
      ],
      [
        "another team",
        (d) => ({
          ...d.status({ demo: 43 }),
          team: { ...d.status({}).team, teamId: other.trust.teamId },
        }),
      ],
      ["the same number", (d) => d.status({ demo: 41 })],
      ["a lower number", (d) => d.status({ demo: 40 })],
      ["the app not there", (d) => d.status({ shop: 99 })],
    ]
    for (const [why, second] of seconds) {
      const d = await deployed()
      const { session, asked } = standIn([refused("replayed"), second(d)])
      expect({ why, said: await thrown(() => d.answer(session)) }).toEqual({
        why,
        said: { kind: "RunnerRefused", message: R1, reason: "replayed" },
      })
      expect(asked).toEqual(["deploy", "status"])
    }
  })
})

describe("every refusal of a version-2 deploy", () => {
  test("another reason: RunnerRefused with its version-2 sentence, and no second `status`", async () => {
    for (const reason of [
      "sequence_jump",
      "secrets_mismatch",
      "secret_missing",
      "untrusted_secret",
      "expired",
      "unsupported_version",
      "busy",
      "stale_team",
    ]) {
      const d = await deployed()
      const { session, asked } = standIn([refused(reason)])
      expect(await thrown(() => d.answer(session))).toEqual({
        kind: "RunnerRefused",
        message: explainDeploy(reason, 2),
        reason,
      })
      expect(asked).toEqual(["deploy"])
    }
  })

  test("reads the history again and saves it without this deploy's entry, keeping one another call wrote meanwhile", async () => {
    for (const reason of ["replayed", "secrets_mismatch"]) {
      const d = await deployed()
      const meanwhile = d.entry(await d.t.deployV2(41, "x: 1\n"), "sent")
      // While this deploy waits for its answer, another terminal adds an entry.
      const answers: unknown[] = [refused(reason), d.status({ demo: 43 })]
      const { session } = standIn(answers)
      const request = session.request.bind(session)
      session.request = async (command, schema, options) => {
        if (command === "deploy")
          d.store.saveHistory(d.t.server.serverId, "demo", [
            ...d.history(),
            meanwhile,
          ])
        return request(command, schema, options)
      }
      await thrown(() => d.answer(session))
      expect(d.history()).toEqual([d.entry(d.fortyOne, "started"), meanwhile])
    }
  })

  test("an answer that never came: the same error, and the entry stays `sent`", async () => {
    for (const lost of [new CliError(ENDED), new CliError(UNEXPECTED)]) {
      const d = await deployed()
      const before = d.history()
      const { session, asked } = standIn([lost])
      expect(await thrown(() => d.answer(session))).toEqual({
        kind: "CliError",
        message: lost.message,
      })
      expect(asked).toEqual(["deploy"])
      expect(d.history()).toEqual(before)
      expect(d.history().at(-1)).toEqual(d.entry(d.envelope, "sent"))
    }
  })

  test("an answer: given back as it came, the history untouched", async () => {
    const d = await deployed()
    const before = d.history()
    const report = { outcome: "started" as const, app: "demo", sequence: 42 }
    const { session } = standIn([report])
    expect(await d.answer(session)).toEqual(report)
    expect(d.history()).toEqual(before)
  })
})
