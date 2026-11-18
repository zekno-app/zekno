/**
 * Secrets are sent once, and every secret is accounted for (specs/014-deploy-v2,
 * User Story 2; contracts/cli.md CL3, CL4, CL12 to CL17; tasks T039, T041),
 * with `ready()`, the plain interface and the runner of this repository,
 * recording the lines this machine writes to the runner: the server keeps
 * each secret's latest record, a deploy supplies only what the server lacks,
 * lists every secret the server holds, and stops before signing when it
 * cannot account for one.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  createDeployV2,
  createSecret,
  RunnerReportSchema,
  type Envelope,
  type SecretRecord,
} from "@workspace/core"

import { recordFiles } from "../../../runner/test/support/deploy-v2"
import { openTeam, reach } from "../../src/cli/context"
import { explainDeploy, RunnerRefused } from "../../src/cli/errors"
import { deployAnswer } from "../../src/ops/deploy-answer"
import { withSession } from "../../src/server/session"
import { C5 } from "../../src/shared/deploy-words"
import { historyOf, payloadOf, stateBytes, stateOf } from "../support/deploys"
import {
  COMPOSE_V1,
  COMPOSE_V2,
  ready,
  serverIdOf,
  twin,
} from "../support/helpers"
import { asReleased } from "../support/older-runner"
import { signAs } from "../support/signing-team"
import { wire } from "../support/wire"

type Machine = Awaited<ReturnType<typeof ready>>

const where = ["--app", "web", "--server", "dev"]

async function set(m: Machine, name: string, value: string) {
  m.typing(value)
  expect(await m.zekno("secret", "set", name, ...where)).toBe(0)
}

/** A machine with three secrets of web, and the lines it writes to the runner recorded. */
async function threeSecrets() {
  const m = await ready()
  await set(m, "API_KEY", "key-one")
  await set(m, "DATABASE_URL", "postgres://db/one")
  await set(m, "GREETING", "hello")
  return { m, w: wire(m.deps) }
}

/** What each `deploy` request sent: the records it carried, by name, and the payload it signed. */
function deploysSent(w: ReturnType<typeof wire>) {
  return (
    w.requests("deploy") as {
      input: { envelope: Envelope; records: SecretRecord[] }
    }[]
  ).map(({ input }) => ({
    records: input.records.map((record) => record.sealed.name),
    payload: payloadOf(input.envelope) as {
      secrets: { name: string; version: number; hash: string }[]
      removed: { name: string; version: number }[]
    },
  }))
}

/** This machine's secret store of web, as the file holds it. */
const storeOf = async (m: Machine) =>
  (await openTeam(m.deps)).store.secrets(serverIdOf(m), "web")

describe("US2: a record is sent only when the server lacks it", () => {
  test("scenario 1 (SC-004): a second deploy with nothing changed sends no record, and Docker still gets every value", async () => {
    const { m, w } = await threeSecrets()
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.lastOut()).toBe(
      "Deploy 2 of web is running on dev with 3 secrets."
    )
    const [first, second] = deploysSent(w)
    expect(first!.records).toEqual(["API_KEY", "DATABASE_URL", "GREETING"])
    expect(second!.records).toEqual([])
    expect(second!.payload.secrets.map((secret) => secret.name)).toEqual([
      "API_KEY",
      "DATABASE_URL",
      "GREETING",
    ])
    const env = m.docker.calls().at(-1)!.env
    expect([env.API_KEY, env.DATABASE_URL, env.GREETING]).toEqual([
      "key-one",
      "postgres://db/one",
      "hello",
    ])
    expect(recordFiles(m.runnerHome)).toHaveLength(3)
  })

  test("scenario 2: one secret set again sends that one record", async () => {
    const { m, w } = await threeSecrets()
    expect(await m.zekno("deploy", ...where)).toBe(0)
    await set(m, "DATABASE_URL", "postgres://db/two")
    expect(await m.zekno("deploy", ...where)).toBe(0)
    const sent = deploysSent(w).at(-1)!
    expect(sent.records).toEqual(["DATABASE_URL"])
    expect(sent.payload.secrets).toMatchObject([
      { name: "API_KEY", version: 1 },
      { name: "DATABASE_URL", version: 2 },
      { name: "GREETING", version: 1 },
    ])
    expect(m.docker.calls().at(-1)!.env.DATABASE_URL).toBe("postgres://db/two")
    // The old record's file went once the new one was kept.
    expect(recordFiles(m.runnerHome)).toHaveLength(3)
  })

  test("scenario 4: `zekno secret rm` then a deploy lists the removal, and the server's record goes", async () => {
    const { m, w } = await threeSecrets()
    expect(await m.zekno("deploy", ...where)).toBe(0)
    const before = recordFiles(m.runnerHome).map((file) => file.path)
    const hash = stateOf(m).secrets["web/API_KEY"]!.hash!
    expect(await m.zekno("secret", "rm", "API_KEY", ...where)).toBe(0)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    const sent = deploysSent(w).at(-1)!
    expect(sent.payload.removed).toEqual([{ name: "API_KEY", version: 2 }])
    expect(sent.payload.secrets.map((secret) => secret.name)).toEqual([
      "DATABASE_URL",
      "GREETING",
    ])
    expect(sent.records).toEqual([])
    expect(stateOf(m).secrets["web/API_KEY"]).toEqual({
      version: 2,
      hash: null,
    })
    expect(recordFiles(m.runnerHome).map((file) => file.path)).toEqual(
      before.filter((path) => !path.includes(hash))
    )
    expect(m.docker.calls().at(-1)!.env.API_KEY).toBeUndefined()
  })

  test("scenario 5 (FR-022): a second machine with no record deploys every secret from the server's, sending none", async () => {
    const { m } = await threeSecrets()
    expect(await m.zekno("deploy", ...where)).toBe(0)
    const other = await twin(m)
    other.compose(COMPOSE_V1)
    const w = wire(other.deps)
    expect(await other.zekno("deploy", ...where)).toBe(0)
    expect(other.lastOut()).toBe(
      "Deploy 2 of web is running on dev with 3 secrets."
    )
    const [sent] = deploysSent(w)
    expect(sent!.records).toEqual([])
    expect(sent!.payload.secrets.map((secret) => secret.name)).toEqual([
      "API_KEY",
      "DATABASE_URL",
      "GREETING",
    ])
    // The second machine's runner command starts Docker with every value, from the records the server holds.
    const env = other.docker.calls().at(-1)!.env
    expect([env.API_KEY, env.DATABASE_URL, env.GREETING]).toEqual([
      "key-one",
      "postgres://db/one",
      "hello",
    ])
    expect(await storeOf(other)).toEqual({ records: [], removals: [] })
  })
})

describe("US2: every secret the server holds is accounted for", () => {
  test("FR-024: an app deployed only in version 1 gets this machine's records at its first version-2 deploy; a machine without them stops with C5", async () => {
    const m = await ready()
    await set(m, "DATABASE_URL", "postgres://db/one")
    await set(m, "GREETING", "hello")
    // Runner 0.1.0 holds web at 1; this zekno deploys to it in version 1, which keeps no record there.
    const today = asReleased(m, { web: 1 })
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.lastOut()).toBe(
      "Deploy 2 of web is running on dev with 2 secrets."
    )
    today()
    expect(recordFiles(m.runnerHome)).toEqual([])

    // A machine without the records cannot account for what the runner holds.
    const other = await twin(m)
    other.compose(COMPOSE_V1)
    const state = stateBytes(m)
    expect(await other.zekno("deploy", ...where)).toBe(1)
    expect(other.err).toEqual([
      `${C5("DATABASE_URL", "web", "dev").replace(" Nothing was signed.", "")}\n${C5("GREETING", "web", "dev")}`,
    ])
    expect(historyOf(other, "web")).toEqual([])
    expect(stateBytes(m)).toBe(state)

    // This machine has them: its first version-2 deploy supplies both.
    const w = wire(m.deps)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.lastOut()).toBe(
      "Deploy 3 of web is running on dev with 2 secrets."
    )
    expect(deploysSent(w)[0]!.records).toEqual(["DATABASE_URL", "GREETING"])
    expect(stateOf(m).formats).toEqual({ web: 2 })
    expect(recordFiles(m.runnerHome)).toHaveLength(2)
  })

  test("scenario 3: a deploy signed elsewhere that leaves a live secret out is refused, and said with R3", async () => {
    const { m } = await threeSecrets()
    expect(await m.zekno("deploy", ...where)).toBe(0)
    const state = stateBytes(m)
    const team = await openTeam(m.deps)
    const server = team.profile.servers[0]!
    const envelope = await team.withSigner((signer) =>
      createDeployV2({
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
    )
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
    expect((refused as RunnerRefused).reason).toBe("secrets_mismatch")
    expect((refused as RunnerRefused).message).toBe(
      explainDeploy("secrets_mismatch", 2)
    )
    expect(stateBytes(m)).toBe(state)
  })
})

describe("statements a runner kept before their limit (security review S2, probe 4)", () => {
  test("`records` leaves them out: the deploy stops with C5 for each, and `zekno secret set` then fixes it", async () => {
    const m = await ready()
    await set(m, "GREETING", "hello")
    expect(await m.zekno("deploy", ...where)).toBe(0)
    // What a runner from before the limit kept of a member's deploy: four statements padded to 1 MiB each.
    const team = await openTeam(m.deps)
    const serverId = serverIdOf(m)
    const names = ["PAD_A", "PAD_B", "PAD_C", "PAD_D"]
    const statePath = join(m.runnerHome, "state.json")
    const state = JSON.parse(readFileSync(statePath, "utf8"))
    for (const name of names) {
      const plain = await team.withSigner((signer) =>
        createSecret({
          trust: team.trust,
          serverId,
          app: "web",
          name,
          value: "x",
          version: 1,
          signer,
        })
      )
      const json = JSON.stringify(payloadOf(plain.envelope))
      const envelope = await team.withSigner((signer) =>
        signAs(
          "zekno.secret.v1",
          `${json.slice(0, -1)}${" ".repeat(1000 * 1024)}}`,
          signer
        )
      )
      const hash = payloadOf(plain.envelope).hash as string
      writeFileSync(
        join(m.runnerHome, "records", "web", `${hash}.json`),
        JSON.stringify({ envelope, sealed: plain.sealed }),
        { mode: 0o600 }
      )
      state.secrets[`web/${name}`] = { version: 1, hash }
    }
    state.lastSequence.web = 2
    writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 })

    const before = stateBytes(m)
    expect(await m.zekno("deploy", ...where)).toBe(1)
    expect(m.lastErr()).toBe(
      `${names
        .map((name) =>
          C5(name, "web", "dev").replace(" Nothing was signed.", "")
        )
        .join("\n")} Nothing was signed.`
    )
    expect(stateBytes(m)).toBe(before)

    // The fix C5 names, then a deploy that replaces the padded records.
    for (const name of names) {
      await set(m, name, `${name} again`)
      expect(m.lastOut()).toContain("(version 2)")
    }
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.lastOut()).toBe(
      "Deploy 3 of web is running on dev with 5 secrets."
    )
    expect(recordFiles(m.runnerHome)).toHaveLength(5)
    for (const file of recordFiles(m.runnerHome))
      expect(file.content.length).toBeLessThan(64 * 1024)
  })
})

describe("SC-008: a secret's value is never anywhere but sealed, and in Docker's environment", () => {
  const MARKER = "zk_SENTINEL_7c3e"
  const VALUES = {
    DATABASE_URL: `postgres://app:${MARKER}@db/app`,
    GREETING: `hello ${MARKER}`,
  }
  /** The marker and each value, as text and as base64url. */
  const FORMS = [MARKER, ...Object.values(VALUES)].flatMap((text) => [
    text,
    Buffer.from(text).toString("base64url"),
  ])
  const holds = (text: string) => FORMS.some((form) => text.includes(form))

  /** Every file under `dir`, with its text. */
  const files = (dir: string): { path: string; text: string }[] =>
    readdirSync(dir, { recursive: true, encoding: "utf8" })
      .map((path) => join(dir, path))
      .filter((path) => statSync(path).isFile())
      .map((path) => ({ path, text: readFileSync(path, "utf8") }))

  test("deploy, deploy again, roll back, `secret rm`, deploy: the marker is only in the stand-in Docker's environment", async () => {
    const m = await ready()
    const w = wire(m.deps)
    for (const [name, value] of Object.entries(VALUES))
      await set(m, name, value)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    m.compose(COMPOSE_V2)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(await m.zekno("rollback", ...where)).toBe(0)
    expect(await m.zekno("secret", "rm", "GREETING", ...where)).toBe(0)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.lastOut()).toBe("Deploy 4 of web is running on dev with 1 secret.")

    expect([...m.out, ...m.err].filter(holds)).toEqual([])
    expect(w.lines.filter(holds)).toEqual([])
    // The secret store holds the values sealed only; no other file of the profile folder holds them at all.
    expect(files(m.home).filter((file) => holds(file.text))).toEqual([])
    expect(files(m.runnerHome).filter((file) => holds(file.text))).toEqual([])
    expect(recordFiles(m.runnerHome).length).toBeGreaterThan(0)
    for (const entry of historyOf(m, "web"))
      expect(holds(JSON.stringify(entry))).toBe(false)

    // Docker was started with the values, each time, and with none once GREETING was removed.
    const env = m.docker
      .calls()
      .map((call) => [call.env.DATABASE_URL, call.env.GREETING])
    expect(env).toEqual([
      [VALUES.DATABASE_URL, VALUES.GREETING],
      [VALUES.DATABASE_URL, VALUES.GREETING],
      [VALUES.DATABASE_URL, VALUES.GREETING],
      [VALUES.DATABASE_URL, undefined],
    ])
  })
})
