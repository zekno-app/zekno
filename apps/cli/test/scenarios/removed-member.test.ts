/**
 * A secret set by someone no longer in the team stops the deploy
 * (specs/014-deploy-v2, User Story 3; contracts/cli.md CL15, CL18 to CL21;
 * tasks T045, T047), with `team-of-two.ts`: Ada, the admin, adds Bea as a
 * deployer; Bea sets DATABASE_URL for web; Ada takes her out of the team
 * list. A deploy then stops before signing with C4, on both formats, until
 * the secret is set again or removed, which `zekno secret set` and
 * `zekno secret rm` do without connecting (decision B). A deploy signed
 * anyway is refused by the runner with R5.
 */
import { describe, expect, test } from "bun:test"
import {
  createDeployV2,
  PAYLOAD_TYPES,
  RunnerReportSchema,
  type SecretRecord,
} from "@workspace/core"

import {
  hashOf,
  payloadOf,
  recordFiles,
  signPayload,
} from "../../../runner/test/support/deploy-v2"
import { openTeam, reach } from "../../src/cli/context"
import { explainDeploy, RunnerRefused } from "../../src/cli/errors"
import { deployAnswer } from "../../src/ops/deploy-answer"
import { withSession } from "../../src/server/session"
import { C4 } from "../../src/shared/deploy-words"
import { historyOf, stateBytes, stateOf } from "../support/deploys"
import { ready } from "../support/helpers"
import { asReleased } from "../support/older-runner"
import { teamOfTwo } from "../support/team-of-two"

type Machine = Awaited<ReturnType<typeof ready>>

const where = ["--app", "web", "--server", "dev"]

/** `zekno secret <args>` with `deps.connect` made to throw: these commands never connect (decision B). */
async function offline(m: Machine, ...args: string[]): Promise<number> {
  const connect = m.deps.connect
  m.deps.connect = () => {
    throw new Error("`zekno secret` tried to connect")
  }
  try {
    return await m.zekno("secret", ...args)
  } finally {
    m.deps.connect = connect
  }
}

/** What a stopped deploy must leave as it was: the history, the runner's state and records, Docker's calls. */
const untouched = (m: Machine) => ({
  history: historyOf(m, "web"),
  state: stateBytes(m),
  records: recordFiles(m.runnerHome),
  ups: m.docker.calls().length,
})

/**
 * Ada's machine after Bea set `names` for web (version 1 each) and deploy 1
 * carried them to the runner while she was a member; then Bea taken out of
 * the team list, the runner not told. With `keepHere` false, this machine no
 * longer holds her records, so only the runner's statements say who set them.
 */
async function afterBeaLeft(
  options: { names?: string[]; keepHere?: boolean } = {}
) {
  const m = await ready()
  const t = await teamOfTwo(m)
  const hers: SecretRecord[] = []
  for (const name of options.names ?? ["DATABASE_URL"])
    hers.push(await t.sets("web", name, `set-by-bea-${name}`, 1))
  t.keep("web", ...hers)
  expect(await m.zekno("deploy", ...where)).toBe(0)
  expect(m.lastOut()).toContain("Deploy 1 of web")
  if (options.keepHere === false) t.forget("web", ...hers)
  await t.remove({ sync: false })
  return { m, t, hers }
}

describe("US3: C4 stops the deploy before anything is signed", () => {
  test("scenario 1: a secret Bea set, on this machine and on the server, is C4; nothing signed, nothing changed", async () => {
    const { m } = await afterBeaLeft()
    const before = untouched(m)
    expect(await m.zekno("deploy", ...where)).toBe(1)
    expect(m.lastErr()).toBe(C4("DATABASE_URL", "web"))
    expect(untouched(m)).toEqual(before)
  })

  test("scenario 1, from the server's statement alone: this machine no longer holds her record", async () => {
    const { m } = await afterBeaLeft({ keepHere: false })
    const before = untouched(m)
    expect(await m.zekno("deploy", ...where)).toBe(1)
    expect(m.lastErr()).toBe(C4("DATABASE_URL", "web"))
    expect(untouched(m)).toEqual(before)
  })

  test("scenario 1, on the version-1 path (decision 8): a runner answering protocol 2 over a state from before version 2", async () => {
    const m = await ready()
    const t = await teamOfTwo(m)
    t.keep("web", await t.sets("web", "DATABASE_URL", "set-by-bea", 1))
    asReleased(m, { web: 1 })
    await t.remove({ sync: false })
    const before = untouched(m)
    expect(await m.zekno("deploy", ...where)).toBe(1)
    expect(m.lastErr()).toBe(C4("DATABASE_URL", "web"))
    expect(untouched(m)).toEqual(before)
  })

  test("two such secrets: one line each, in name order, then `Nothing was signed.` once", async () => {
    const { m } = await afterBeaLeft({ names: ["DATABASE_URL", "API_KEY"] })
    expect(await m.zekno("deploy", ...where)).toBe(1)
    expect(m.lastErr()).toBe(
      `${C4("API_KEY", "web").replace(" Nothing was signed.", "")}\n${C4("DATABASE_URL", "web")}`
    )
  })
})

describe("US3: the runner refuses what the CLI would have stopped", () => {
  test("scenario 2: a deploy signed anyway, listing Bea's secret, is refused with R5, and uses no number", async () => {
    const { m, hers } = await afterBeaLeft()
    const before = untouched(m)
    const team = await openTeam(m.deps)
    const server = team.profile.servers[0]!
    // No zekno of this feature signs it (C4); the admin's key signs it here by hand.
    const envelope = await team.withSigner(async (signer) => {
      const bare = await createDeployV2({
        trust: team.trust,
        serverId: server.serverId,
        app: "web",
        previous: 1,
        compose: "services: {}\n",
        statements: [],
        removals: [],
        expiresAt: null,
        signer,
      })
      return signPayload(
        PAYLOAD_TYPES.deployV2,
        JSON.stringify({
          ...payloadOf(bare),
          secrets: [
            { name: "DATABASE_URL", hash: hashOf(hers[0]!), version: 1 },
          ],
        }),
        signer
      )
    })
    let refused: unknown
    await withSession(reach(m.deps, server.target), (session) =>
      deployAnswer(
        session.request("deploy", RunnerReportSchema, {
          input: { rosters: team.profile.rosters, envelope, records: [] },
        }),
        {
          session,
          team,
          server,
          app: "web",
          previous: 1,
          envelope,
          rollback: false,
        }
      )
    ).catch((error: unknown) => (refused = error))
    expect(refused).toBeInstanceOf(RunnerRefused)
    expect((refused as RunnerRefused).reason).toBe("untrusted_secret")
    expect((refused as RunnerRefused).message).toBe(
      explainDeploy("untrusted_secret", 2)
    )
    // The runner followed the team lists the deploy carried, and nothing else changed.
    expect(stateOf(m).lastSequence).toEqual({ web: 1 })
    expect(recordFiles(m.runnerHome)).toEqual(before.records)
    expect(m.docker.calls().length).toBe(before.ups)
  })
})

describe("US3: set again or removed, offline, the deploy goes through (CL21)", () => {
  for (const keepHere of [true, false]) {
    const where_ = keepHere ? "on this machine and" : "only"
    test(`scenario 3: after \`zekno secret set DATABASE_URL\`, with her secret ${where_} on the server, the deploy starts`, async () => {
      const { m } = await afterBeaLeft({ keepHere })
      expect(await m.zekno("deploy", ...where)).toBe(1)
      m.typing("postgres://set-by-ada")
      expect(await offline(m, "set", "DATABASE_URL", ...where)).toBe(0)
      expect(m.lastOut()).toBe(
        "Set DATABASE_URL (version 2) for web on dev. It takes effect on the next deploy."
      )
      expect(await m.zekno("deploy", ...where)).toBe(0)
      expect(m.lastOut()).toBe(
        "Deploy 2 of web is running on dev with 1 secret."
      )
      expect(m.docker.calls().at(-1)!.env.DATABASE_URL).toBe(
        "postgres://set-by-ada"
      )
      expect(stateOf(m).secrets["web/DATABASE_URL"]!.version).toBe(2)
    })

    test(`scenario 4: after \`zekno secret rm DATABASE_URL\`, with her secret ${where_} on the server, the deploy starts without it and lists the removal`, async () => {
      const { m, hers } = await afterBeaLeft({ keepHere })
      expect(await m.zekno("deploy", ...where)).toBe(1)
      expect(await offline(m, "rm", "DATABASE_URL", ...where)).toBe(0)
      expect(m.lastOut()).toBe(
        "Removed DATABASE_URL from web on dev. It takes effect on the next deploy."
      )
      expect(await m.zekno("deploy", ...where)).toBe(0)
      expect(m.lastOut()).toBe(
        "Deploy 2 of web is running on dev with no secrets."
      )
      const last = historyOf(m, "web").at(-1)!
      expect(payloadOf(last.envelope)).toMatchObject({
        secrets: [],
        removed: [{ name: "DATABASE_URL", version: 2 }],
      })
      expect(stateOf(m).secrets["web/DATABASE_URL"]).toEqual({
        version: 2,
        hash: null,
      })
      expect(
        recordFiles(m.runnerHome).some((file) =>
          file.path.includes(hashOf(hers[0]!))
        )
      ).toBe(false)
      expect(m.docker.calls().at(-1)!.env.DATABASE_URL).toBeUndefined()
    })
  }
})
