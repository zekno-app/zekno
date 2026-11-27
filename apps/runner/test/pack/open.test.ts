/**
 * K14d's check (specs/016-build-from-source, contracts/runner.md RB4, RB3
 * K14d; FR-026, FR-029, FR-030, FR-031, SC-006): once the move has put a
 * build's pieces in `building/<app>/`, each is opened in order with the
 * server's key, through core's checker, and they must make exactly the pack
 * the deploy signed, in the one form, with the Dockerfile under exactly its
 * signed name, at most 1 MiB. Nothing opened is written, and
 * `building/<app>/` is deleted on `pack_mismatch`. The move itself is
 * `open-move.test.ts`'s.
 *
 * Everything runs in this process: the team, the server's key and its state
 * are made here (`support/verified.ts`), the deploy is signed and verified
 * by core, and the pieces are made by core's writer and sealer
 * (`support/code-packs.ts`). The `# syntax=` rules (T074, T195) are not
 * here: they wait for check L2.
 */
import { describe, expect, test } from "bun:test"
import {
  generateServerKeyPair,
  LIMITS,
  sealPiece,
  type Build,
  type VerifiedDeployV2,
} from "@workspace/core"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { checkBuild } from "../../src/pack/open"
import {
  DOCKERFILE,
  dockerfileBuild,
  file,
  folder,
  packHash,
  packOf,
  project,
  sealAll,
  type PackFile,
  type Piece,
} from "../support/code-packs"
import { filesUnder } from "../support/helpers"
import { deployOf, server } from "../support/verified"

const MIB = 1024 * 1024
const APP = "web"
const MISMATCH = { outcome: "refused", reason: "pack_mismatch" } as const

/** The build of `verified` whose recipe was given first: its key is core's. */
const buildOf = (verified: VerifiedDeployV2): Build =>
  verified.deploy.builds[0]!

/** Puts each piece in `building/<app>/` under its fingerprint, as the move leaves it. */
function placed(home: string, pieces: readonly Piece[]): string {
  const folderPath = join(home, "building", APP)
  mkdirSync(folderPath, { recursive: true, mode: 0o700 })
  for (const piece of pieces)
    writeFileSync(join(folderPath, piece.fingerprint), piece.sealed)
  return folderPath
}

/**
 * A server, a deploy of one Dockerfile build of `files` whose pieces are
 * sealed for that server and placed in `building/web/`, ready to check. With
 * `pack`, the signed pack is that one's (its fingerprint and size) and the
 * pieces are cut from its bytes.
 */
async function ready(
  files: readonly PackFile[] = project(),
  change: Parameters<typeof dockerfileBuild>[2] = {}
) {
  const s = await server()
  const pack = packOf(files)
  const pieces = sealAll(pack.tar, s.keys.publicKey)
  const { verified } = await deployOf(s, [
    dockerfileBuild({ hash: pack.hash, size: pack.tar.length }, pieces, change),
  ])
  const building = placed(s.home, pieces)
  return { ...s, pack, pieces, verified, building }
}

/** The answer of `checkBuild` for this world's first build. */
const check = (w: Awaited<ReturnType<typeof ready>>) =>
  checkBuild(w.home, APP, w.verified, buildOf(w.verified), w.keys.secretKey)

/**
 * A deploy whose signed pack is `tar` exactly, sealed honestly for the
 * server, the pieces placed: for a pack no zekno would make, the checker
 * (not the hash, nor the seal) must refuse it.
 */
async function signedAsIs(tar: Uint8Array, dockerfile = "Dockerfile") {
  const s = await server()
  const pieces = sealAll(tar, s.keys.publicKey)
  const { verified } = await deployOf(s, [
    dockerfileBuild({ hash: packHash(tar), size: tar.length }, pieces, {
      dockerfile,
    }),
  ])
  const building = placed(s.home, pieces)
  return {
    answer: checkBuild(
      s.home,
      APP,
      verified,
      buildOf(verified),
      s.keys.secretKey
    ),
    building,
  }
}

describe("checkBuild (K14d, under the deploy lock alone)", () => {
  test("pieces that make the signed pack: the Dockerfile's bytes, and nothing written under <home>", async () => {
    const w = await ready()
    const before = filesUnder(w.home)
    expect(check(w)).toEqual({
      dockerfile: new TextEncoder().encode(DOCKERFILE),
    })
    expect(filesUnder(w.home)).toEqual(before)
  })

  test("a pack of two pieces, opened in order; a Dockerfile in a folder, under its signed path", async () => {
    const w = await ready(
      [
        folder("deploy/"),
        file("deploy/Dockerfile.prod", DOCKERFILE),
        file("noise.bin", crypto.getRandomValues(new Uint8Array(64 * 1024))),
        file("zeros.bin", new Uint8Array(LIMITS.chunkBytes)),
      ],
      { dockerfile: "deploy/Dockerfile.prod" }
    )
    expect(w.pieces).toHaveLength(2)
    expect(check(w)).toEqual({
      dockerfile: new TextEncoder().encode(DOCKERFILE),
    })
  })

  test("one byte changed in a piece: pack_mismatch, and building/<app>/ deleted", async () => {
    const w = await ready()
    const path = join(w.building, w.pieces[0]!.fingerprint)
    const bytes = new Uint8Array(readFileSync(path))
    bytes[bytes.length - 1]! ^= 0x01
    writeFileSync(path, bytes)
    expect(check(w)).toEqual(MISMATCH)
    expect(existsSync(w.building)).toBe(false)
  })

  test("a piece that opens to one byte more, or one byte less, than signed: pack_mismatch", async () => {
    for (const change of [+1, -1]) {
      const s = await server()
      const pack = packOf(project())
      const wrong = new Uint8Array(pack.tar.length + change)
      wrong.set(pack.tar.subarray(0, Math.min(wrong.length, pack.tar.length)))
      const piece = sealPiece(wrong, s.keys.publicKey)
      const { verified } = await deployOf(s, [
        dockerfileBuild({ hash: pack.hash, size: pack.tar.length }, [piece]),
      ])
      const building = placed(s.home, [piece])
      expect(
        checkBuild(s.home, APP, verified, buildOf(verified), s.keys.secretKey)
      ).toEqual(MISMATCH)
      expect(existsSync(building)).toBe(false)
    }
  })

  test("a piece sealed for another server's key: pack_mismatch (FR-026)", async () => {
    const s = await server()
    const pack = packOf(project())
    const elsewhere = generateServerKeyPair()
    const pieces = sealAll(pack.tar, elsewhere.publicKey)
    const { verified } = await deployOf(s, [
      dockerfileBuild({ hash: pack.hash, size: pack.tar.length }, pieces),
    ])
    const building = placed(s.home, pieces)
    expect(
      checkBuild(s.home, APP, verified, buildOf(verified), s.keys.secretKey)
    ).toEqual(MISMATCH)
    expect(existsSync(building)).toBe(false)
  })

  test("a piece missing from building/<app>/, or over a sealed piece's bound: pack_mismatch", async () => {
    const gone = await ready()
    writeFileSync(join(gone.building, "unrelated"), "")
    const path = join(gone.building, gone.pieces[0]!.fingerprint)
    rmSync(path)
    expect(check(gone)).toEqual(MISMATCH)
    expect(existsSync(gone.building)).toBe(false)

    const large = await ready()
    writeFileSync(
      join(large.building, large.pieces[0]!.fingerprint),
      new Uint8Array(LIMITS.sealedPieceBytes + 1)
    )
    expect(check(large)).toEqual(MISMATCH)
    expect(existsSync(large.building)).toBe(false)
  })

  test("a pack out of the one form, signed as it is: pack_mismatch", async () => {
    const { tar } = packOf(project())
    // A block after the end.
    const longer = new Uint8Array(tar.length + 512)
    longer.set(tar)
    expect((await signedAsIs(longer)).answer).toEqual(MISMATCH)
    // A header with a mode the one form never writes, its checksum made again.
    const header = tar.slice(0, 512)
    header.set(new TextEncoder().encode("0000600\0"), 100)
    header.set(new TextEncoder().encode("        "), 148)
    const sum = header.reduce((total, byte) => total + byte, 0)
    header.set(
      new TextEncoder().encode(`${sum.toString(8).padStart(6, "0")}\0 `),
      148
    )
    const changed = new Uint8Array(tar)
    changed.set(header, 0)
    const answer = await signedAsIs(changed)
    expect(answer.answer).toEqual(MISMATCH)
    expect(existsSync(answer.building)).toBe(false)
  })

  test("a pack whose fingerprint differs from the signed one: pack_mismatch", async () => {
    const s = await server()
    const pack = packOf(project())
    const other = packOf([...project(), file("extra.txt", "x")])
    const pieces = sealAll(pack.tar, s.keys.publicKey)
    const { verified } = await deployOf(s, [
      dockerfileBuild({ hash: other.hash, size: pack.tar.length }, pieces),
    ])
    const building = placed(s.home, pieces)
    expect(
      checkBuild(s.home, APP, verified, buildOf(verified), s.keys.secretKey)
    ).toEqual(MISMATCH)
    expect(existsSync(building)).toBe(false)
  })

  test("the Dockerfile's entry missing, in another case, a folder, or past 1 MiB: pack_mismatch; at 1 MiB it is given whole", async () => {
    const without = project().filter((each) => each.name !== "Dockerfile")
    const cases: PackFile[][] = [
      without,
      [...without, file("dockerfile", DOCKERFILE)],
      [...without, file("DOCKERFILE", DOCKERFILE)],
      [...without, folder("Dockerfile/"), file("Dockerfile/x", DOCKERFILE)],
      [...without, file("Dockerfile", new Uint8Array(MIB + 1).fill(0x23))],
    ]
    for (const files of cases) {
      const w = await ready(files)
      expect(check(w)).toEqual(MISMATCH)
      expect(existsSync(w.building)).toBe(false)
    }
    const whole = new Uint8Array(MIB).fill(0x23)
    const w = await ready([...without, file("Dockerfile", whole)])
    expect(check(w)).toEqual({ dockerfile: whole })
    expect(existsSync(w.building)).toBe(true)
  })
})
