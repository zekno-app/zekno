/**
 * The history keeps each deploy's builds (specs/016-build-from-source,
 * data-model.md, "The history"; FR-065; tasks T107): a version-2 deploy this
 * machine signed is read back with its builds as signed and the services
 * each build serves; the outcome list gains `build_failed`; an entry written
 * before the feature, with no builds, reads as it did. And the helpers the
 * later tasks use: the builds of the latest accepted deploy, the newest
 * fresh generation this machine holds for a base key (contracts/cli.md CL7
 * step 9), and the fingerprints a build's secrets were listed with. Each
 * test has a profile folder of its own, never `~/.zekno`.
 */
import { describe, expect, test } from "bun:test"
import {
  baseKey,
  buildKey,
  builtImageName,
  createDeployV2,
  type Build,
  type Envelope,
} from "@workspace/core"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { CliError } from "../../src/cli/errors"
import type { History } from "../../src/profile/profile"
import { readDeployEntry } from "../../src/shared/history"
import {
  latestAcceptedBuilds,
  listedFingerprints,
  newestFresh,
} from "../../src/shared/history-builds"
import { appDetails } from "../../src/shared/views"
import { signingTeam } from "../support/signing-team"

type Team = Awaited<ReturnType<typeof signingTeam>>

const hex = (digit: string) => digit.repeat(64)

/** A Dockerfile build of the pack `pack`, its key made by core's `buildKey` (CO4). */
function dockerfileBuild(
  pack: string,
  fresh: number | null = null,
  options: {
    dockerfile?: string
    secrets?: string[]
    listed?: { name: string; hash: string }[]
  } = {}
): Build {
  const recipe = {
    pack: { hash: pack, size: 10, chunks: [hex("c")] },
    builder: {
      name: "dockerfile" as const,
      dockerfile: options.dockerfile ?? "Dockerfile",
      target: null,
    },
    args: [],
    secrets: options.secrets ?? [],
    network: "default" as const,
    timeout: 1800,
    fresh,
  }
  return { key: buildKey(recipe, options.listed ?? []), ...recipe }
}

/** The Compose text zekno writes for built services: each service of `served` runs its build's image. */
function composeOf(
  app: string,
  served: { service: string; key: string }[],
  pulled: { service: string; image: string }[] = []
): string {
  const lines = ["services:"]
  for (const { service, key } of served)
    lines.push(`  ${service}:`, `    image: "${builtImageName(app, key)}"`)
  for (const { service, image } of pulled)
    lines.push(`  ${service}:`, `    image: ${image}`)
  return `${lines.join("\n")}\n`
}

/** A version-2 deploy of `demo` with these builds, signed by the team's member. */
function signed(
  t: Team,
  previous: number,
  builds: Build[],
  served: { service: string; key: string }[],
  statements: readonly Envelope[] = []
): Promise<Envelope> {
  return createDeployV2({
    trust: t.trust,
    serverId: t.server.serverId,
    app: "demo",
    previous,
    compose: composeOf("demo", served, [
      { service: "db", image: "postgres:16" },
    ]),
    statements,
    removals: [],
    expiresAt: null,
    builds,
    signer: t.signer,
  })
}

const entry = (
  envelope: Envelope,
  outcome: History[number]["outcome"] = "started"
): History[number] => ({ envelope, at: "2026-11-28T10:00:00.000Z", outcome })

describe("the history keeps the builds", () => {
  test("a round trip: each build as signed, sorted by key, with the services it serves", async () => {
    const t = await signingTeam()
    const site = dockerfileBuild(hex("1"))
    const api = dockerfileBuild(hex("2"), null, {
      dockerfile: "api/Dockerfile",
    })
    const envelope = await signed(
      t,
      0,
      [site, api],
      [
        { service: "web", key: site.key },
        { service: "worker", key: site.key },
        { service: "api", key: api.key },
      ]
    )
    t.team.store.saveHistory(t.server.serverId, "demo", [entry(envelope)])
    const [kept] = t.team.store.history(t.server.serverId, "demo")
    const read = readDeployEntry(kept!.envelope, t.trust)
    const sorted = [site, api].sort((a, b) => (a.key < b.key ? -1 : 1))
    expect(read?.deploy.builds?.map((each) => each.build)).toEqual(sorted)
    const served = new Map(
      read?.deploy.builds?.map((each) => [each.build.key, each.services])
    )
    expect(served.get(site.key)).toEqual(["web", "worker"])
    expect(served.get(api.key)).toEqual(["api"])
    // The same builds read again, with the latest accepted deploy's helper.
    expect(latestAcceptedBuilds(t.team, t.server, "demo")).toEqual(
      read?.deploy.builds
    )
  })

  test("a Compose text that cannot be read gives each build no service, never an error", async () => {
    const t = await signingTeam()
    const site = dockerfileBuild(hex("1"))
    // The image named in a flow sequence, then an alias flood: read as no services.
    const flood = `${composeOf("demo", [{ service: "web", key: site.key }])}x: &a [${"*a,".repeat(300)}]\n`
    const envelope = await createDeployV2({
      trust: t.trust,
      serverId: t.server.serverId,
      app: "demo",
      previous: 0,
      compose: flood,
      statements: [],
      removals: [],
      expiresAt: null,
      builds: [site],
      signer: t.signer,
    })
    const read = readDeployEntry(envelope, t.trust)
    expect(read?.deploy.builds).toEqual([{ build: site, services: [] }])
  })

  test("an old entry, with no builds, reads as it did: no `builds` at all, and the helpers find none", async () => {
    const t = await signingTeam()
    const compose = "services:\n  web:\n    image: example/web:1\n"
    const v1 = await t.deployV1(1, compose)
    const v2 = await t.deployV2(1, compose)
    // Written as 015 wrote it: outcomes of that feature, no field of this one.
    mkdirSync(join(t.home, "history", t.server.serverId), { recursive: true })
    writeFileSync(
      join(t.home, "history", t.server.serverId, "demo.json"),
      JSON.stringify([entry(v1, "start_failed"), entry(v2, "unhealthy")])
    )
    const history = t.team.store.history(t.server.serverId, "demo")
    expect(history.map((each) => each.outcome)).toEqual([
      "start_failed",
      "unhealthy",
    ])
    for (const each of history)
      expect(
        readDeployEntry(each.envelope, t.trust)?.deploy
      ).not.toHaveProperty("builds")
    // The latest accepted deploy built nothing; no build has a fresh generation.
    expect(latestAcceptedBuilds(t.team, t.server, "demo")).toEqual([])
    expect(newestFresh(t.team, t.server, "demo", hex("1"))).toBeNull()
  })

  test("no deploy accepted from this machine: no builds to compare with", async () => {
    const t = await signingTeam()
    expect(latestAcceptedBuilds(t.team, t.server, "demo")).toBeUndefined()
    const site = dockerfileBuild(hex("1"))
    const envelope = await signed(
      t,
      0,
      [site],
      [{ service: "web", key: site.key }]
    )
    t.team.store.saveHistory(t.server.serverId, "demo", [
      entry(envelope, "sent"),
    ])
    expect(latestAcceptedBuilds(t.team, t.server, "demo")).toBeUndefined()
  })
})

describe("`build_failed`", () => {
  test("kept as itself, and counted as a deploy that did not start: the latest accepted one", async () => {
    const t = await signingTeam()
    const first = dockerfileBuild(hex("1"))
    const second = dockerfileBuild(hex("2"))
    const one = await signed(
      t,
      0,
      [first],
      [{ service: "web", key: first.key }]
    )
    const two = await signed(
      t,
      1,
      [second],
      [{ service: "web", key: second.key }]
    )
    t.team.store.saveHistory(t.server.serverId, "demo", [
      entry(one),
      entry(two, "build_failed"),
    ])
    const history = t.team.store.history(t.server.serverId, "demo")
    expect(history.map((each) => each.outcome)).toEqual([
      "started",
      "build_failed",
    ])
    expect(
      latestAcceptedBuilds(t.team, t.server, "demo")?.map((each) => each.build)
    ).toEqual([second])
    // The app's list of deploys shows it as a deploy that did not start (CL7, "The answer").
    expect(
      appDetails(t.team, t.server, "demo").deploys.map((row) => row.outcome)
    ).toEqual(["start_failed", "started"])
  })

  test("an outcome no zekno writes still makes the history damaged", async () => {
    const t = await signingTeam()
    const compose = "services:\n  web:\n    image: example/web:1\n"
    mkdirSync(join(t.home, "history", t.server.serverId), { recursive: true })
    writeFileSync(
      join(t.home, "history", t.server.serverId, "demo.json"),
      JSON.stringify([entry(await t.deployV1(1, compose), "built" as never)])
    )
    expect(() => t.team.store.history(t.server.serverId, "demo")).toThrow(
      CliError
    )
  })
})

describe("newestFresh", () => {
  test("the newest fresh generation among several deploys, for one base key", async () => {
    const t = await signingTeam()
    const pack = hex("1")
    const other = hex("2")
    const base = baseKey(dockerfileBuild(pack), [])
    const otherBase = baseKey(dockerfileBuild(other), [])
    const plan: { builds: Build[]; outcome: History[number]["outcome"] }[] = [
      // 1: built, no fresh generation.
      { builds: [dockerfileBuild(pack)], outcome: "started" },
      // 2: `--fresh`, its own number.
      { builds: [dockerfileBuild(pack, 2)], outcome: "started" },
      // 3: reuses generation 2.
      { builds: [dockerfileBuild(pack, 2)], outcome: "started" },
      // 4: `--fresh` again, its answer not recorded: the history still holds it.
      { builds: [dockerfileBuild(pack, 4)], outcome: "sent" },
      // 5: another base key's fresh build, newer than 4.
      { builds: [dockerfileBuild(other, 5)], outcome: "started" },
      // 6: the first base key without its generation, as a machine without this history signs it.
      { builds: [dockerfileBuild(pack)], outcome: "started" },
    ]
    const history: History = []
    for (const [index, step] of plan.entries()) {
      const served = step.builds.map((build) => ({
        service: "web",
        key: build.key,
      }))
      history.push(
        entry(await signed(t, index, step.builds, served), step.outcome)
      )
    }
    t.team.store.saveHistory(t.server.serverId, "demo", history)
    expect(newestFresh(t.team, t.server, "demo", base)).toBe(4)
    expect(newestFresh(t.team, t.server, "demo", otherBase)).toBe(5)
    expect(newestFresh(t.team, t.server, "demo", hex("9"))).toBeNull()
    // Another app's history, and another server's, hold none of it.
    expect(newestFresh(t.team, t.server, "other", base)).toBeNull()
    expect(
      newestFresh(
        t.team,
        { ...t.server, serverId: `srv_${"0".repeat(32)}` },
        "demo",
        base
      )
    ).toBeNull()
  })

  test("an entry another team signed is not read", async () => {
    const t = await signingTeam()
    const theirs = await signingTeam()
    const build = dockerfileBuild(hex("1"), 1)
    const foreign = await createDeployV2({
      trust: theirs.trust,
      serverId: theirs.server.serverId,
      app: "demo",
      previous: 0,
      compose: composeOf("demo", [{ service: "web", key: build.key }]),
      statements: [],
      removals: [],
      expiresAt: null,
      builds: [build],
      signer: theirs.signer,
    })
    t.team.store.saveHistory(t.server.serverId, "demo", [entry(foreign)])
    expect(newestFresh(t.team, t.server, "demo", baseKey(build, []))).toBeNull()
  })
})

describe("listedFingerprints", () => {
  test("each secret a build reads, with the fingerprint the deploy listed for it", async () => {
    const t = await signingTeam()
    const token = await t.secret("NPM_TOKEN", "a token", 2)
    const other = await t.secret("DATABASE_URL", "postgres://demo", 1)
    const envelope = await t.deployV2(0, "services: {}\n", [
      token.envelope,
      other.envelope,
    ])
    const listed = readDeployEntry(envelope, t.trust)!.deploy.secrets.map(
      ({ name, hash }) => ({ name, hash })
    )
    const build = dockerfileBuild(hex("1"), null, {
      secrets: ["NPM_TOKEN"],
      listed,
    })
    const withBuild = await signed(
      t,
      0,
      [build],
      [{ service: "web", key: build.key }],
      [token.envelope, other.envelope]
    )
    const deploy = readDeployEntry(withBuild, t.trust)!.deploy
    expect(listedFingerprints(deploy, build)).toEqual([
      listed.find((secret) => secret.name === "NPM_TOKEN")!,
    ])
    // A build that reads no secret.
    expect(listedFingerprints(deploy, dockerfileBuild(hex("2")))).toEqual([])
  })
})
