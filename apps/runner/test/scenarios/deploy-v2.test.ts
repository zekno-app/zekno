/**
 * The runner's `deploy`: a signed deploy of version 2 (specs/014-deploy-v2,
 * US1; contracts/runner-checks.md). A deploy runs only when it was made
 * against the app's last number here, and a refused one uses no number and
 * changes nothing. Each refusal, check by check, is in
 * deploy-v2-refusals.test.ts.
 */
import { describe, expect, test } from "bun:test"
import {
  buildKey,
  PAYLOAD_TYPES,
  type Build,
  type Envelope,
} from "@workspace/core"
import { readFileSync, realpathSync } from "node:fs"
import { join } from "node:path"

import {
  buildDeployV2,
  composeRunning,
  deployV2,
  GREETING,
  leftAsItWas,
  olderState,
  payloadOf,
  signPayload,
  type BuildRecipeInput,
} from "../support/deploy-v2"
import { buildDeploy, filesUnder, runner, world } from "../support/helpers"

type World = Awaited<ReturnType<typeof world>>

const stateOf = (home: string) =>
  JSON.parse(readFileSync(join(home, "state.json"), "utf8")) as Record<
    string,
    unknown
  >

/**
 * A deploy of `app` made against `previous`, with a new record of GREETING at
 * `previous + 1`; `change` for anything else `buildDeployV2` takes.
 */
async function against(
  w: World,
  previous: number,
  app = "web",
  change: Partial<Parameters<typeof buildDeployV2>[0]> = {}
) {
  const { envelope, records } = await buildDeployV2({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    previous,
    app,
    ...change,
  })
  return { rosters: w.rosters, envelope, records }
}

/** A world whose runner accepted a first deploy of `web`, so there is a number to protect. */
async function ready(): Promise<World> {
  const w = await world()
  const answer = await deployV2(w, await against(w, 0))
  if (answer.result.outcome !== "started")
    throw new Error(`the first deploy failed: ${JSON.stringify(answer)}`)
  return w
}

/** The same payload as `envelope`'s with `change`, signed again by a member: a deploy no zekno would sign. */
const resigned = (
  w: World,
  envelope: Envelope,
  change: Record<string, unknown>
): Envelope =>
  signPayload(
    PAYLOAD_TYPES.deployV2,
    JSON.stringify({ ...payloadOf(envelope), ...change }),
    w.signer
  )

/** Sends a deploy that must be refused for `reason`, and checks it left everything as it was. */
async function refused(w: World, input: unknown, reason: string) {
  const before = leftAsItWas(w)
  expect(await deployV2(w, input)).toEqual({
    events: [],
    result: { outcome: "refused", reason },
  })
  expect(leftAsItWas(w)).toEqual(before)
}

describe("the order", () => {
  test("a first deploy against 0 starts; one against 1 after it starts; another against 1 is replayed; one against 5 is sequence_jump", async () => {
    const w = await world()
    expect((await deployV2(w, await against(w, 0))).result).toEqual({
      outcome: "started",
      app: "web",
      sequence: 1,
    })
    expect((await deployV2(w, await against(w, 1))).result).toEqual({
      outcome: "started",
      app: "web",
      sequence: 2,
    })
    await refused(w, await against(w, 1), "replayed")
    await refused(w, await against(w, 5), "sequence_jump")
    expect(stateOf(w.home).lastSequence).toEqual({ web: 2 })
    expect(w.docker.calls()).toHaveLength(2)
  })

  test("a first deploy, against 0, of an app the runner holds is replayed (US1 scenario 4)", async () => {
    const w = await world()
    expect((await deployV2(w, await against(w, 0))).result.outcome).toBe(
      "started"
    )
    expect((await deployV2(w, await against(w, 1))).result.outcome).toBe(
      "started"
    )
    // A machine that believes `web` is new signs against 0.
    await refused(w, await against(w, 0), "replayed")
  })

  test("after a state as runner 0.1.0 leaves it, holding web at 3, a deploy against 3 starts and web is at format 2", async () => {
    const w = await world()
    olderState(w.home, { web: 3 })
    expect((await deployV2(w, await against(w, 3))).result).toEqual({
      outcome: "started",
      app: "web",
      sequence: 4,
    })
    const state = stateOf(w.home)
    expect(state.v).toBe(5)
    expect(state.lastSequence).toEqual({ web: 4 })
    expect(state.formats).toEqual({ web: 2 })
  })

  test("each app has its own number", async () => {
    const w = await world()
    expect((await deployV2(w, await against(w, 0))).result.outcome).toBe(
      "started"
    )
    expect((await deployV2(w, await against(w, 0, "api"))).result).toEqual({
      outcome: "started",
      app: "api",
      sequence: 1,
    })
    expect(stateOf(w.home).lastSequence).toEqual({ web: 1, api: 1 })
    expect(stateOf(w.home).formats).toEqual({ web: 2, api: 2 })
  })
})

describe("Docker Compose's working folder", () => {
  test("deploy runs `docker compose … up` in the runner's own folder, with the secret only in its environment", async () => {
    const w = await world()
    expect((await deployV2(w, await against(w, 0))).result.outcome).toBe(
      "started"
    )
    const [call] = w.docker.calls()
    expect(call!.args).toBe(
      `compose -p zekno-web -f ${join(w.home, "apps/web/compose.yaml")} up -d --remove-orphans --no-build`
    )
    expect(realpathSync(process.cwd())).not.toBe(realpathSync(w.home))
    expect(call!.cwd).toBe(realpathSync(w.home))
    expect(call!.env.GREETING).toBe(GREETING)
    for (const file of filesUnder(w.home))
      expect(file.content).not.toContain(GREETING)
  })

  test("the one-shot apply runs it in the runner's own folder too", async () => {
    const w = await world()
    olderState(w.home, { web: 1 })
    const deploy = await buildDeploy({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      sequence: 2,
    })
    expect(
      (
        await runner(w.home, w.docker.path, "apply", {
          rosters: w.rosters,
          deploy,
        })
      ).json
    ).toEqual({ outcome: "started", app: "web", sequence: 2 })
    const [call] = w.docker.calls()
    expect(call!.cwd).toBe(realpathSync(w.home))
    expect(call!.env.GREETING).toBe(GREETING)
    for (const file of filesUnder(w.home))
      expect(file.content).not.toContain(GREETING)
  })
})

/*
 * Routes and the health check are carried out since feature 015 (specs/
 * 015-domains-https, contracts/core.md, "Carried out"; their scenarios are in
 * routes*.test.ts and health.test.ts). At step 1 of feature 016 (specs/
 * 016-build-from-source, contracts/core.md CO7), a Railpack build, a build
 * with secrets and the pre-deploy command are still refused.
 */
describe("what this runner does not carry out yet (FR-036, FR-083, SC-003)", () => {
  const route = { domain: "demo.example.com", service: "web", port: 3000 }
  const recipe: BuildRecipeInput = {
    pack: { hash: "a".repeat(64), size: 1, chunks: ["b".repeat(64)] },
    builder: { name: "dockerfile", dockerfile: "Dockerfile", target: null },
    args: [],
    secrets: [],
    network: "default",
    timeout: 1800,
    fresh: null,
  }
  const build: Build = { key: buildKey(recipe, []), ...recipe }
  const railpack: BuildRecipeInput = {
    ...recipe,
    builder: {
      name: "railpack",
      version: "0.9.2",
      frontend: `ghcr.io/railwayapp/railpack-frontend:0.9.2@sha256:${"c".repeat(64)}`,
      images: [`ghcr.io/railwayapp/railpack-builder@sha256:${"d".repeat(64)}`],
      plan: { hash: "e".repeat(64), size: 1, piece: "f".repeat(64) },
    },
  }
  const withSecrets: BuildRecipeInput = { ...recipe, secrets: ["GREETING"] }
  const predeploy = { service: "web", command: ["bin/migrate"], timeout: 600 }

  test("a deploy with a Railpack build, a build with secrets or a pre-deploy command, each alone, is unsupported_version: no number used, Docker not called", async () => {
    const w = await ready()
    for (const change of [
      { builds: [railpack] },
      { builds: [withSecrets] },
      { later: { predeploy } },
    ])
      await refused(
        w,
        await against(w, 1, "web", change),
        "unsupported_version"
      )
    expect(stateOf(w.home).lastSequence).toEqual({ web: 1 })
    expect(w.docker.calls()).toHaveLength(1)
  })

  test("a later field that breaks its own rule, an unknown field and v: 3 are malformed first", async () => {
    const w = await ready()
    const { envelope, records } = await against(w, 1)
    const offByOne = `${build.key.slice(0, -1)}${build.key.endsWith("0") ? "1" : "0"}`
    for (const change of [
      { routes: [{ ...route, domain: "demo.invalid" }] },
      {
        builds: [{ ...build, key: offByOne }],
        compose: composeRunning("web", [offByOne]),
      },
      { extra: 1 },
      { v: 3 },
    ])
      await refused(
        w,
        {
          rosters: w.rosters,
          envelope: resigned(w, envelope, change),
          records,
        },
        "malformed"
      )
    expect(stateOf(w.home).lastSequence).toEqual({ web: 1 })
  })
})

describe("expiry, by the runner's own clock (FR-013, FR-016)", () => {
  const DAY = 24 * 60 * 60 * 1000
  const fromNow = (ms: number) => new Date(Date.now() + ms)

  test("an expiry a minute ago, or 8 days ahead, is expired: no number used, nothing changed", async () => {
    const w = await ready()
    for (const expiresAt of [fromNow(-60_000), fromNow(8 * DAY)])
      await refused(w, await against(w, 1, "web", { expiresAt }), "expired")
  })

  test("an expiry 6 days ahead, and none, are accepted", async () => {
    const w = await ready()
    expect(
      (
        await deployV2(
          w,
          await against(w, 1, "web", { expiresAt: fromNow(6 * DAY) })
        )
      ).result
    ).toEqual({ outcome: "started", app: "web", sequence: 2 })
    expect(
      (await deployV2(w, await against(w, 2, "web", { expiresAt: null })))
        .result
    ).toEqual({ outcome: "started", app: "web", sequence: 3 })
  })

  test("a deploy whose previous is wrong and whose expiry has passed is replayed: the order never depends on the clock", async () => {
    const w = await ready()
    expect((await deployV2(w, await against(w, 1))).result.outcome).toBe(
      "started"
    )
    await refused(
      w,
      await against(w, 1, "web", { expiresAt: fromNow(-60_000) }),
      "replayed"
    )
    await refused(
      w,
      await against(w, 5, "web", { expiresAt: fromNow(-60_000) }),
      "sequence_jump"
    )
  })
})
