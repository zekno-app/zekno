/**
 * K14d's move (specs/016-build-from-source, contracts/runner.md RB4 first
 * bullet, RB3 K14d; FR-028): under the state lock, the pieces of the builds
 * not kept are moved from `packs/<app>/` to `building/<app>/`, emptied
 * first, only when every one is staged for this deploy (its payload's hash
 * and number, as `pack` names it); else `pack_missing` names the pieces not
 * staged, sorted, each once, at most 72, with the images K14a found gone or
 * changed, and nothing moves. Everything runs in this process, with pieces
 * made by core's writer and sealer.
 */
import { describe, expect, test } from "bun:test"
import { LIMITS } from "@workspace/core"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { moveToBuilding, stagedDeployOf } from "../../src/pack/open"
import { stagePiece } from "../../src/pack/stage"
import {
  dockerfileBuild,
  file,
  packOf,
  project,
  sealAll,
} from "../support/code-packs"
import type { BuildRecipeInput } from "../support/deploy-v2"
import { filesUnder } from "../support/helpers"
import { deployOf, server } from "../support/verified"

const APP = "web"

/** 64 hex characters made of one: a fingerprint no piece has. */
const hex = (c: string) => c.repeat(64)

describe("moveToBuilding (K14d, under the state lock)", () => {
  /** A server, a deploy with the build given, and its staged deploy as `pack` names it. */
  async function staged(builds: BuildRecipeInput[]) {
    const s = await server()
    const { envelope, verified } = await deployOf(s, builds)
    const deploy = stagedDeployOf(envelope, 0)
    return { ...s, envelope, verified, deploy }
  }

  test("every piece staged for this deploy: building/<app>/ emptied first, the pieces moved there, packs/ keeps the rest; the state lock released", async () => {
    const s = await server()
    const pack = packOf(project())
    const pieces = sealAll(pack.tar, s.keys.publicKey)
    const { envelope, verified } = await deployOf(s, [
      dockerfileBuild({ hash: pack.hash, size: pack.tar.length }, pieces),
    ])
    const deploy = stagedDeployOf(envelope, 0)
    for (const piece of pieces)
      stagePiece(s.home, APP, deploy, piece.fingerprint, piece.sealed)
    // A piece of no build of this deploy stays staged, and a file a stopped check left in building/ goes.
    stagePiece(s.home, APP, deploy, hex("9"), new Uint8Array([1, 2, 3]))
    mkdirSync(join(s.home, "building", APP), { recursive: true })
    writeFileSync(join(s.home, "building", APP, hex("8")), "left before")

    expect(
      await moveToBuilding(s.home, APP, deploy, verified.deploy.builds)
    ).toEqual({ moved: pieces.map((piece) => piece.fingerprint).sort() })
    expect(readdirSync(join(s.home, "building", APP)).sort()).toEqual(
      pieces.map((piece) => piece.fingerprint).sort()
    )
    for (const piece of pieces)
      expect(
        Buffer.from(
          readFileSync(join(s.home, "building", APP, piece.fingerprint))
        ).equals(piece.sealed)
      ).toBe(true)
    expect(readdirSync(join(s.home, "packs", APP)).sort()).toEqual([
      hex("9"),
      "deploy.json",
    ])
    expect(existsSync(join(s.home, "state.lock"))).toBe(false)
  })

  test("what a runner that died before K17 left in building/ for another app goes too: only this deploy's pieces stay there", async () => {
    const s = await server()
    const pack = packOf(project())
    const pieces = sealAll(pack.tar, s.keys.publicKey)
    const { envelope, verified } = await deployOf(s, [
      dockerfileBuild({ hash: pack.hash, size: pack.tar.length }, pieces),
    ])
    const deploy = stagedDeployOf(envelope, 0)
    for (const piece of pieces)
      stagePiece(s.home, APP, deploy, piece.fingerprint, piece.sealed)
    // Moved for a check of `api`, then the runner died before the number: no `building` names it.
    mkdirSync(join(s.home, "building", "api"), { recursive: true })
    writeFileSync(join(s.home, "building", "api", hex("7")), "left before")
    writeFileSync(join(s.home, "building", "stray"), "left before")

    expect(
      await moveToBuilding(s.home, APP, deploy, verified.deploy.builds)
    ).toHaveProperty("moved")
    expect(readdirSync(join(s.home, "building"))).toEqual([APP])
  })

  test("a piece two builds list is moved once", async () => {
    const s = await server()
    const pack = packOf(project())
    const pieces = sealAll(pack.tar, s.keys.publicKey)
    const signed = { hash: pack.hash, size: pack.tar.length }
    const { envelope, verified } = await deployOf(s, [
      dockerfileBuild(signed, pieces),
      // Another key: the same code built without a network.
      dockerfileBuild(signed, pieces, { network: "none" }),
    ])
    const deploy = stagedDeployOf(envelope, 0)
    for (const piece of pieces)
      stagePiece(s.home, APP, deploy, piece.fingerprint, piece.sealed)
    expect(verified.deploy.builds).toHaveLength(2)
    expect(
      await moveToBuilding(s.home, APP, deploy, verified.deploy.builds)
    ).toEqual({ moved: [pieces[0]!.fingerprint] })
  })

  test("a piece not staged: pack_missing names it, with the images given, and nothing moves", async () => {
    const s = await server()
    const big = packOf([
      ...project(),
      // Past 8 MiB of bytes no compressor shrinks, so the pack has two pieces.
      file("noise.bin", crypto.getRandomValues(new Uint8Array(64 * 1024))),
      file("zeros.bin", new Uint8Array(LIMITS.chunkBytes)),
    ])
    const pieces = sealAll(big.tar, s.keys.publicKey)
    expect(pieces).toHaveLength(2)
    const { envelope, verified } = await deployOf(s, [
      dockerfileBuild({ hash: big.hash, size: big.tar.length }, pieces),
    ])
    const deploy = stagedDeployOf(envelope, 0)
    stagePiece(s.home, APP, deploy, pieces[0]!.fingerprint, pieces[0]!.sealed)
    const before = filesUnder(s.home)
    const images = [{ key: hex("a"), state: "gone" as const }]

    expect(
      await moveToBuilding(s.home, APP, deploy, verified.deploy.builds, images)
    ).toEqual({
      outcome: "refused",
      reason: "pack_missing",
      missing: { pieces: [pieces[1]!.fingerprint], images },
    })
    expect(filesUnder(s.home)).toEqual(before)
    expect(existsSync(join(s.home, "building"))).toBe(false)
    expect(existsSync(join(s.home, "state.lock"))).toBe(false)
  })

  test("pieces staged for another deploy of the app count as none", async () => {
    const s = await server()
    const pack = packOf(project())
    const pieces = sealAll(pack.tar, s.keys.publicKey)
    const { envelope, verified } = await deployOf(s, [
      dockerfileBuild({ hash: pack.hash, size: pack.tar.length }, pieces),
    ])
    const other = { payload: hex("f"), previous: 0 }
    for (const piece of pieces)
      stagePiece(s.home, APP, other, piece.fingerprint, piece.sealed)
    expect(
      await moveToBuilding(
        s.home,
        APP,
        stagedDeployOf(envelope, 0),
        verified.deploy.builds
      )
    ).toEqual({
      outcome: "refused",
      reason: "pack_missing",
      missing: {
        pieces: pieces.map((piece) => piece.fingerprint).sort(),
        images: [],
      },
    })
    expect(readdirSync(join(s.home, "packs", APP)).sort()).toEqual(
      [...pieces.map((piece) => piece.fingerprint), "deploy.json"].sort()
    )

    // The same payload's hash under another number: not this deploy's either.
    const deploy = stagedDeployOf(envelope, 0)
    for (const piece of pieces)
      stagePiece(
        s.home,
        APP,
        { ...deploy, previous: 3 },
        piece.fingerprint,
        piece.sealed
      )
    expect(
      await moveToBuilding(s.home, APP, deploy, verified.deploy.builds)
    ).toMatchObject({ reason: "pack_missing" })
    expect(existsSync(join(s.home, "building"))).toBe(false)
  })

  test("72 missing fingerprints are each named, sorted and once; past 72, the first 72 by their order", async () => {
    const w = await staged([])
    const fingerprints = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        (index * 7919).toString(16).padStart(64, "0")
      )
    // Listed in reverse order, one of them twice, by builds as `moveToBuilding` takes them.
    const listing = (list: string[]) => [
      { pack: { chunks: [...list].reverse() } },
      { pack: { chunks: list.slice(0, 1) } },
    ]
    const seventyTwo = fingerprints(72)
    const named = await moveToBuilding(
      w.home,
      APP,
      w.deploy,
      listing(seventyTwo)
    )
    expect(named).toMatchObject({ reason: "pack_missing" })
    expect((named as { missing: { pieces: string[] } }).missing.pieces).toEqual(
      [...seventyTwo].sort()
    )

    const many = fingerprints(100)
    const cut = await moveToBuilding(w.home, APP, w.deploy, listing(many))
    expect((cut as { missing: { pieces: string[] } }).missing.pieces).toEqual(
      [...many].sort().slice(0, LIMITS.missingPieces)
    )
    expect(LIMITS.missingPieces).toBe(72)
  })

  test("the state lock held past the wait: busy, and nothing moves", async () => {
    const s = await server()
    const pack = packOf(project())
    const pieces = sealAll(pack.tar, s.keys.publicKey)
    const { envelope, verified } = await deployOf(s, [
      dockerfileBuild({ hash: pack.hash, size: pack.tar.length }, pieces),
    ])
    const deploy = stagedDeployOf(envelope, 0)
    for (const piece of pieces)
      stagePiece(s.home, APP, deploy, piece.fingerprint, piece.sealed)
    writeFileSync(join(s.home, "state.lock"), `${process.pid}:held`)
    expect(
      await moveToBuilding(s.home, APP, deploy, verified.deploy.builds, [], {
        waitMs: 200,
      })
    ).toEqual({ outcome: "refused", reason: "busy" })
    expect(existsSync(join(s.home, "building"))).toBe(false)
    expect(readFileSync(join(s.home, "state.lock"), "utf8")).toBe(
      `${process.pid}:held`
    )
  })

  test("stagedDeployOf names a deploy by its payload's SHA-256 and its previous", async () => {
    const w = await staged([])
    const payload = Buffer.from(w.envelope.payload, "base64url")
    expect(stagedDeployOf(w.envelope, 0)).toEqual({
      payload: new Bun.CryptoHasher("sha256").update(payload).digest("hex"),
      previous: 0,
    })
  })
})
