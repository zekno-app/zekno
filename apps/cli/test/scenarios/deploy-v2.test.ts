/**
 * A deploy that was overtaken can never run (specs/014-deploy-v2, User Story
 * 1; contracts/cli.md CL1 to CL11; tasks T031, T060), with `ready()` and the
 * plain interface against the runner of this repository, which speaks
 * protocol 3: each deploy is signed one above the runner's number, read on
 * its own connection; one that reaches the runner after another made after
 * the same number is refused, uses no number, leaves this machine's history
 * and says C1 or C2.
 */
import { describe, expect, test } from "bun:test"
import {
  PAYLOAD_TYPES,
  readSignedDeployV2,
  type Envelope,
} from "@workspace/core"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { waitFor } from "../../../runner/test/support/helpers"
import { openTeam } from "../../src/cli/context"
import { explainDeploy } from "../../src/cli/errors"
import { AppTaken, prepareDeploy, sendDeploy } from "../../src/ops/deploy"
import { ENDED } from "../../src/server/session"
import { C1, C2 } from "../../src/shared/deploy-words"
import {
  entriesOf,
  historyFile,
  historyOf,
  payloadOf,
  setNumber,
  stateBytes,
  stateOf,
} from "../support/deploys"
import {
  COMPOSE_V1,
  COMPOSE_V2,
  ready,
  secondTerminal,
} from "../support/helpers"
import { asReleased } from "../support/older-runner"
import { wire } from "../support/wire"

const where = ["--app", "web", "--server", "dev"]

/** Sets `name` to `value` for web on dev, as a person would. */
async function set(
  m: Awaited<ReturnType<typeof ready>>,
  name: string,
  value: string
) {
  m.typing(value)
  expect(await m.zekno("secret", "set", name, ...where)).toBe(0)
}

/**
 * A machine with two secrets whose runner holds deploy 41 of web: one deploy
 * from here, then the number as 40 more from elsewhere would leave it.
 */
async function atFortyOne() {
  const m = await ready()
  await set(m, "GREETING", "hello")
  await set(m, "API_KEY", "key-one")
  expect(await m.zekno("deploy", ...where)).toBe(0)
  setNumber(m, "web", 41)
  return m
}

/** Every version-2 deploy in the history names no later field (tasks T058: this CLI never passes `later`). */
async function noLaterFields(m: Awaited<ReturnType<typeof ready>>) {
  for (const entry of historyOf(m, "web")) {
    if (entry.envelope.payloadType !== PAYLOAD_TYPES.deployV2) continue
    const payload = payloadOf(entry.envelope)
    expect({
      builds: payload.builds,
      predeploy: payload.predeploy,
      health: payload.health,
      routes: payload.routes,
    }).toEqual({ builds: [], predeploy: null, health: null, routes: [] })
  }
}

describe("US1: each deploy is made after the runner's number", () => {
  test("scenario 1: with deploy 41 on the runner, the next is signed after 41, as 42", async () => {
    const m = await atFortyOne()
    m.compose(COMPOSE_V2)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.lastOut()).toBe(
      "Deploy 42 of web is running on dev with 2 secrets."
    )
    const last = (await entriesOf(m, "web")).at(-1)!
    expect(last.format).toBe(2)
    expect(last.outcome).toBe("started")
    expect(last.deploy).toMatchObject({
      app: "web",
      previous: 41,
      sequence: 42,
      compose: COMPOSE_V2,
    })
    expect(last.deploy.secrets.map((secret) => secret.name)).toEqual([
      "API_KEY",
      "GREETING",
    ])
    expect(stateOf(m).lastSequence.web).toBe(42)
    expect(stateOf(m).formats).toEqual({ web: 2 })
    await noLaterFields(m)
  })

  test("scenario 2: of two deploys of one machine made after 41, the one that reaches the runner second is C1, ran nothing and leaves the history", async () => {
    const m = await atFortyOne()
    const b = secondTerminal(m)
    const bWire = wire(b.deps)
    const line = bWire.hold("deploy")
    const bRun = b.zekno("deploy", ...where)
    await line.reached
    const ups = m.docker.calls().length

    m.compose(COMPOSE_V2)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.lastOut()).toBe(
      "Deploy 42 of web is running on dev with 2 secrets."
    )
    line.release()
    expect(await bRun).toBe(1)
    expect(b.err).toEqual([C1("web", "dev", 42, false)])

    expect(m.docker.calls().length).toBe(ups + 1)
    expect(stateOf(m).lastSequence.web).toBe(42)
    // B was signed after 41, as 42, and sent once; it is not in the history.
    const [sent] = bWire.requests("deploy") as {
      input: { envelope: Envelope }
    }[]
    expect(payloadOf(sent!.input.envelope)).toMatchObject({
      previous: 41,
      sequence: 42,
      compose: COMPOSE_V1,
    })
    const entries = await entriesOf(m, "web")
    expect(
      entries.map((entry) => [
        entry!.deploy.sequence,
        entry!.deploy.compose,
        entry!.outcome,
      ])
    ).toEqual([
      [1, COMPOSE_V1, "started"],
      [42, COMPOSE_V2, "started"],
    ])
    expect(
      historyOf(m, "web").some(
        (entry) =>
          entry.envelope.signature.sig === sent!.input.envelope.signature.sig
      )
    ).toBe(false)
    await noLaterFields(m)
  })

  test("the spec's first edge case: B's request reaching the runner while A is starting is `busy`, and leaves the history", async () => {
    const m = await atFortyOne()
    const b = secondTerminal(m)
    const line = wire(b.deps).hold("deploy")
    const bRun = b.zekno("deploy", ...where)
    await line.reached

    m.docker.holdUp()
    const aRun = m.zekno("deploy", ...where)
    await waitFor(() => m.docker.upStarted(), "A's up")
    line.release()
    expect(await bRun).toBe(1)
    expect(b.err).toEqual([explainDeploy("busy", 2)])
    m.docker.releaseUp()
    expect(await aRun).toBe(0)
    expect(m.lastOut()).toBe(
      "Deploy 42 of web is running on dev with 2 secrets."
    )
    expect(
      (await entriesOf(m, "web")).map((entry) => entry!.deploy.sequence)
    ).toEqual([1, 42])
  })

  test("scenario 3: when A's answer never came, B's refusal is C2: this machine cannot tell which of the two ran", async () => {
    const m = await atFortyOne()
    const b = secondTerminal(m)
    const line = wire(b.deps).hold("deploy")
    const bRun = b.zekno("deploy", ...where)
    await line.reached

    const aWire = wire(m.deps)
    aWire.cutAnswer("deploy")
    m.compose(COMPOSE_V2)
    expect(await m.zekno("deploy", ...where)).toBe(1)
    expect(m.lastErr()).toBe(ENDED)
    aWire.restore()
    // The runner took A: its number is 42, and A's entry is still `sent`.
    expect(stateOf(m).lastSequence.web).toBe(42)

    line.release()
    expect(await bRun).toBe(1)
    expect(b.err).toEqual([C2("web", "dev", 42)])
    const entries = await entriesOf(m, "web")
    expect(
      entries.map((entry) => [entry!.deploy.sequence, entry!.outcome])
    ).toEqual([
      [1, "started"],
      [42, "sent"],
    ])
    expect(entries.at(-1)!.deploy.compose).toBe(COMPOSE_V2)
  })

  test("scenario 4: a name typed as new that the runner holds stops the deploy before anything is signed", async () => {
    const m = await ready()
    expect(await m.zekno("deploy", ...where)).toBe(0)
    const plan = await prepareDeploy(m.deps, { app: "web", server: "dev" })
    const history = historyOf(m, "web")
    const state = stateBytes(m)
    const ups = m.docker.calls().length
    let thrown: unknown
    await sendDeploy(m.deps, { ...plan, fresh: true }).catch(
      (error: unknown) => (thrown = error)
    )
    expect(thrown).toBeInstanceOf(AppTaken)
    expect(historyOf(m, "web")).toEqual(history)
    expect(stateBytes(m)).toBe(state)
    expect(m.docker.calls().length).toBe(ups)
  })

  test("scenario 5: a rollback is a new deploy made after the runner's number, with the current secrets", async () => {
    const m = await ready()
    await set(m, "GREETING", "first")
    expect(await m.zekno("deploy", ...where)).toBe(0)
    setNumber(m, "web", 40)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    m.compose(COMPOSE_V2)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.lastOut()).toBe(
      "Deploy 42 of web is running on dev with 1 secret."
    )
    await set(m, "GREETING", "second")

    expect(await m.zekno("rollback", ...where)).toBe(0)
    expect(m.out).toContain("Rolling back web to what deploy 41 ran.")
    expect(m.lastOut()).toBe(
      "Deploy 43 of web is running on dev with 1 secret."
    )
    const last = (await entriesOf(m, "web")).at(-1)!
    expect(last.format).toBe(2)
    expect(last.deploy).toMatchObject({
      previous: 42,
      sequence: 43,
      compose: COMPOSE_V1,
    })
    expect(last.deploy.secrets).toMatchObject([
      { name: "GREETING", version: 2 },
    ])
    expect(
      readFileSync(join(m.runnerHome, "apps/web/compose.yaml"), "utf8")
    ).toBe(COMPOSE_V1)
    expect(m.docker.calls().at(-1)!.env.GREETING).toBe("second")
    await noLaterFields(m)
  })

  test("scenario 5, FR-012: a rollback to a deploy of version 1 is signed in version 2", async () => {
    const m = await ready()
    // Runner 0.1.0 held web at 1; this zekno deploys to it in version 1.
    const today = asReleased(m, { web: 1 })
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.lastOut()).toBe(
      "Deploy 2 of web is running on dev with no secrets."
    )
    // The runner is updated: from now on it speaks protocol 3.
    today()
    m.compose(COMPOSE_V2)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.lastOut()).toBe(
      "Deploy 3 of web is running on dev with no secrets."
    )

    expect(await m.zekno("rollback", ...where, "--to", "2")).toBe(0)
    expect(m.out).toContain("Rolling back web to what deploy 2 ran.")
    const entries = await entriesOf(m, "web")
    expect(
      entries.map((entry) => [
        entry!.format,
        entry!.deploy.previous,
        entry!.deploy.sequence,
        entry!.deploy.compose,
      ])
    ).toEqual([
      [1, undefined, 2, COMPOSE_V1],
      [2, 2, 3, COMPOSE_V2],
      [2, 3, 4, COMPOSE_V1],
    ])
    expect(stateOf(m).formats).toEqual({ web: 2 })
  })

  test("scenario 6: a runner whose `status` says a lower number gets R1 through `replayed`; a higher one R2; neither uses a number", async () => {
    const m = await ready()
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    const state = stateBytes(m)
    const history = historyOf(m, "web")
    const ups = m.docker.calls().length
    const w = wire(m.deps)
    const saying = (n: number) => (status: Record<string, unknown>) => ({
      ...status,
      lastSequence: { ...(status.lastSequence as object), web: n },
    })

    w.rewrite("status", saying(1))
    expect(await m.zekno("deploy", ...where)).toBe(1)
    expect(m.lastErr()).toBe(explainDeploy("replayed", 2))
    expect(w.requests("status")).toHaveLength(2)
    expect(stateBytes(m)).toBe(state)

    w.rewrite("status", saying(5))
    expect(await m.zekno("deploy", ...where)).toBe(1)
    expect(m.lastErr()).toBe(explainDeploy("sequence_jump", 2))
    expect(stateBytes(m)).toBe(state)
    expect(historyOf(m, "web")).toEqual(history)
    expect(m.docker.calls().length).toBe(ups)
  })
})

describe("US6: this CLI signs no expiry (FR-015)", () => {
  /** Every file under `dir`, with its text. */
  const files = (dir: string): { path: string; text: string }[] =>
    readdirSync(dir, { recursive: true, encoding: "utf8" })
      .map((path) => join(dir, path))
      .filter((path) => statSync(path).isFile())
      .map((path) => ({ path, text: readFileSync(path, "utf8") }))

  test("every deploy it signs has `expiresAt: null`, and its signature is only in the history and in the one `deploy` request of its session", async () => {
    const m = await ready()
    await set(m, "GREETING", "hello")
    const w = wire(m.deps)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    m.compose(COMPOSE_V2)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(await m.zekno("rollback", ...where)).toBe(0)

    const { trust } = await openTeam(m.deps)
    const history = historyOf(m, "web")
    expect(history).toHaveLength(3)
    const historyPath = join(m.home, historyFile(m, "web"))
    for (const entry of history) {
      const read = readSignedDeployV2({ envelope: entry.envelope, trust })
      expect(read.ok && read.value.deploy.expiresAt).toBeNull()
      const sig = entry.envelope.signature.sig
      const holding = [...files(m.home), ...files(m.runnerHome)].filter(
        (file) => file.text.includes(sig)
      )
      expect(holding.map((file) => file.path)).toEqual([historyPath])
      const lines = w.lines.filter((line) => line.includes(sig))
      expect(lines).toHaveLength(1)
      expect(JSON.parse(lines[0]!).command).toBe("deploy")
      expect([...m.out, ...m.err].some((line) => line.includes(sig))).toBe(
        false
      )
    }
  })
})
