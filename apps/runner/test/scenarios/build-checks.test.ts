/**
 * The steps before the number for a deploy that builds (specs/016-build-
 * from-source, T072; contracts/runner.md RB3, in its table's order: K1 to
 * K14, K14a, K14b, K14c, K15, K16, K14d, K17), against the real runner
 * program and the stand-in for Docker: each refusal before the number, in
 * that order. K14b (can Docker build) and K14c (free disk) run only when a
 * build is not kept. A refusal before K17 changes nothing but the team
 * lists the request carried, uses no number, calls Docker only to read,
 * never holding the state lock, and leaves no piece in `building/<app>/`.
 * K17 itself, and the state it writes, are `build-checks-k17.test.ts`'s.
 */
import { describe, expect, test } from "bun:test"
import {
  builtImageName,
  createSecret,
  generateServerKeyPair,
  LIMITS,
  PAYLOAD_TYPES,
  type SecretRecord,
} from "@workspace/core"
import { readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  APP,
  FACTS_AND_DISK,
  FLOOR,
  ready,
  recordKept,
  refusedWith,
  stage,
  stateFile,
  stateOf,
  withBuild,
} from "../support/build-checks"
import { buildDeployV2, payloadOf, signPayload } from "../support/deploy-v2"
import { tempDir } from "../support/helpers"
import {
  dockerfileBuild,
  packOf,
  project,
  sealAll,
} from "../support/code-packs"

describe("each refusal before the number uses none and changes nothing but the team lists", () => {
  test("docker_too_old: the engine below 29.5.0, with the engine's and buildx's versions; nothing asked of the disk", async () => {
    const w = await ready()
    w.docker.script({ docker: { engine: "29.4.3" } })
    const { input, envelope, pieces } = await withBuild(w)
    stage(w, envelope, 1, pieces)
    expect(
      await refusedWith(w, input, {
        outcome: "refused",
        reason: "docker_too_old",
        docker: { engine: "29.4.3", buildx: "0.34.1" },
      })
    ).toEqual(FACTS_AND_DISK.slice(0, -1))
  })

  test("no_build_plugin: no buildx, a builder whose driver is not docker, or no engine at all", async () => {
    for (const docker of [
      { buildx: null },
      { driver: "docker-container" as const },
      { engine: null },
    ]) {
      const w = await ready()
      w.docker.script({ docker })
      const { input } = await withBuild(w)
      const calls = await refusedWith(w, input, {
        outcome: "refused",
        reason: "no_build_plugin",
      })
      expect(calls).not.toContain("info --format {{.DockerRootDir}}")
    }
  })

  test("low_disk: a place a build writes to that cannot be read counts as no free space, and comes before pack_missing", async () => {
    const w = await ready()
    w.docker.script({
      docker: { dockerRootDir: join(tempDir("gone"), "not-there") },
    })
    // No piece is staged: the disk is said first.
    const { input } = await withBuild(w)
    expect(
      await refusedWith(w, input, {
        outcome: "refused",
        reason: "low_disk",
        disk: { free: 0, floor: FLOOR },
      })
    ).toEqual(FACTS_AND_DISK)
  })

  test("too_large: today's limits, after Docker and the disk were asked", async () => {
    const w = await ready()
    const held = stateOf(w.home)
    const lastSequence = held.lastSequence as Record<string, number>
    const formats = held.formats as Record<string, number>
    for (let n = 1; n < LIMITS.appsPerServer; n++) {
      lastSequence[`app-${n}`] = 1
      formats[`app-${n}`] = 1
    }
    writeFileSync(stateFile(w.home), JSON.stringify(held), { mode: 0o600 })
    const { input } = await withBuild(w, { previous: 0, app: "one-more" })
    expect(
      await refusedWith(w, input, { outcome: "refused", reason: "too_large" })
    ).toEqual(FACTS_AND_DISK)
  })

  test("secrets_mismatch: a listed secret that does not open, said before pack_missing", async () => {
    const w = await ready()
    const forApi = await createSecret({
      trust: w.newer.trust,
      serverId: w.serverId,
      app: "api",
      name: "GREETING",
      value: "sealed for api",
      version: 2,
      signer: w.signer,
    })
    // A member signs a statement for web over it: it verifies, and does not open.
    const crossed: SecretRecord = {
      envelope: signPayload(
        PAYLOAD_TYPES.secret,
        JSON.stringify({ ...payloadOf(forApi.envelope), app: APP }),
        w.signer
      ),
      sealed: forApi.sealed,
    }
    const { envelope } = await buildDeployV2({
      trust: w.newer.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 1,
      values: {},
      statements: [crossed.envelope],
      builds: [
        dockerfileBuild({ hash: "1".repeat(64), size: 1024 }, [
          { fingerprint: "2".repeat(64) },
        ]),
      ],
    })
    expect(
      await refusedWith(
        w,
        { rosters: w.newer.rosters, envelope, records: [crossed] },
        { outcome: "refused", reason: "secrets_mismatch" }
      )
    ).toEqual(FACTS_AND_DISK)
  })

  test("pack_missing: the pieces not staged, sorted; a recorded build whose image is gone named in `images`; nothing moved", async () => {
    const w = await ready()
    const { input, pieces, key } = await withBuild(w)
    // Staged for another deploy of the app: they count as none, and stay.
    const other = await withBuild(w, { values: { GREETING: "other" } })
    stage(w, other.envelope, 1, pieces)
    const staged = readdirSync(join(w.home, "packs", APP)).sort()
    expect(
      await refusedWith(w, input, {
        outcome: "refused",
        reason: "pack_missing",
        missing: {
          pieces: pieces.map((piece) => piece.fingerprint).sort(),
          images: [],
        },
      })
    ).toEqual(FACTS_AND_DISK)
    expect(readdirSync(join(w.home, "packs", APP)).sort()).toEqual(staged)

    // The state recorded this build, and its image is gone: a rollback says why it needs the pieces again.
    recordKept(w, key, {
      manifest: `sha256:${"3".repeat(64)}`,
      config: `sha256:${"4".repeat(64)}`,
    })
    expect(
      await refusedWith(w, input, {
        outcome: "refused",
        reason: "pack_missing",
        missing: {
          pieces: pieces.map((piece) => piece.fingerprint).sort(),
          images: [{ key, state: "gone" }],
        },
      })
    ).toEqual([
      `image inspect --format {{.Id}} ${builtImageName(APP, key)}`,
      ...FACTS_AND_DISK,
    ])
  })

  test("pack_mismatch: pieces sealed for another server; moved for the check, then deleted, so the same deploy sent again is pack_missing", async () => {
    const w = await ready()
    const { input, envelope, pieces } = await withBuild(w)
    const pack = packOf(project())
    const elsewhere = sealAll(pack.tar, generateServerKeyPair().publicKey)
    // The deploy lists the honest pieces; the bytes under their names were sealed for another server.
    stage(
      w,
      envelope,
      1,
      pieces.map((piece, index) => ({
        fingerprint: piece.fingerprint,
        sealed: elsewhere[index]!.sealed,
      }))
    )
    expect(
      await refusedWith(w, input, {
        outcome: "refused",
        reason: "pack_mismatch",
      })
    ).toEqual(FACTS_AND_DISK)
    expect(readdirSync(join(w.home, "packs", APP))).toEqual(["deploy.json"])
    expect(
      await refusedWith(w, input, {
        outcome: "refused",
        reason: "pack_missing",
        missing: {
          pieces: pieces.map((piece) => piece.fingerprint).sort(),
          images: [],
        },
      })
    ).toEqual(FACTS_AND_DISK)
  })

  test("a core reason (K9): made against a number this server does not hold, before Docker is asked anything", async () => {
    const w = await ready()
    const { input } = await withBuild(w, { previous: 5 })
    expect(
      await refusedWith(w, input, {
        outcome: "refused",
        reason: "sequence_jump",
      })
    ).toEqual([])
  })
})
