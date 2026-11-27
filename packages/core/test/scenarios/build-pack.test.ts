/**
 * Building from source, the whole path in core as a hostile relay meets it
 * (specs/016-build-from-source, User Story 4; SC-006, SC-007; FR-026,
 * FR-029, FR-030; contracts/core.md CO5, CO8, CO9): files made in memory are
 * written in the one form, hashed, cut, sealed for server B and signed; on B
 * each piece passes the gate, opens, and the checker gives back the same
 * files. The relay reads every piece and every payload, and may change,
 * swap or re-send any of them, and nothing it does gets code into a build.
 * Everything here comes from the library's one entry point but
 * `signEnvelope`, which only a careless or hostile member reaches for. No
 * Docker, no network, nothing written to disk; a 512 MiB pack is not run
 * here (the pack and pieces tests bound each part).
 */
import { beforeAll, describe, expect, test } from "bun:test"

import {
  admitPiece,
  buildKey,
  builtImageName,
  compareNames,
  createDeployV2,
  createPackChecker,
  createTarWriter,
  cutPieces,
  generateServerKeyPair,
  hashStream,
  LIMITS,
  openPiece,
  PAYLOAD_TYPES,
  pieceLength,
  sealPiece,
  type Build,
  type Envelope,
  type PackItem,
  type ServerPublicKey,
  type VerifiedDeployV2,
} from "../../src/index"
import { signEnvelope } from "../../src/crypto/envelope"
import {
  NOW,
  payloadOf,
  reason,
  verify,
  world,
  type World,
} from "../support/deploy-v2"

const KiB = 1024
const APP = "web"

/** A string the developer's code holds: it must never be readable outside a sealed piece. */
const MARKER = "zekno-scenario-marker-5c1e9b-only-inside-sealed-pieces"

type File = {
  name: string
  kind: "file" | "folder"
  mode: 0o644 | 0o755
  data: Uint8Array
}

const text = (value: string) => new TextEncoder().encode(value)

/** Bytes no compressor shrinks, so the pack spans two pieces. */
function noise(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  for (let at = 0; at < length; at += 64 * KiB)
    crypto.getRandomValues(bytes.subarray(at, Math.min(at + 64 * KiB, length)))
  return bytes
}

/** The project folder as zekno would pack it, in the order of the names' UTF-8 bytes. */
function projectFiles(): File[] {
  const file = (name: string, data: Uint8Array, mode: 0o644 | 0o755 = 0o644) =>
    ({ name, kind: "file", mode, data }) as const
  const folder = (name: string) =>
    ({ name, kind: "folder", mode: 0o755, data: new Uint8Array() }) as const
  return [
    file(
      "Dockerfile",
      text('FROM scratch\nCOPY . /app\nCMD ["/app/start.sh"]\n')
    ),
    folder("assets/"),
    // Past 8 MiB, so the tar is cut into two pieces.
    file("assets/noise.bin", noise(LIMITS.chunkBytes + 100 * KiB)),
    folder("src/"),
    file("src/config.ts", text(`export const token = "${MARKER}"\n`)),
    file("start.sh", text("#!/bin/sh\nexec /app/server\n"), 0o755),
  ].sort((a, b) => compareNames(a.name, b.name))
}

/** The pack of these files, written with `createTarWriter`, and its fingerprint by `hashStream`. */
function packOf(files: readonly File[]): { tar: Uint8Array; hash: string } {
  const writer = createTarWriter()
  const parts: Uint8Array[] = []
  for (const file of files) {
    parts.push(
      writer.begin({
        name: file.name,
        kind: file.kind,
        mode: file.mode,
        size: file.data.length,
      })
    )
    if (file.data.length > 0) parts.push(writer.data(file.data))
    parts.push(writer.finish())
  }
  parts.push(writer.end())
  const tar = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  const fingerprint = hashStream("zekno/v1/pack")
  let at = 0
  for (const part of parts) {
    tar.set(part, at)
    fingerprint.update(part)
    at += part.length
  }
  return { tar, hash: Buffer.from(fingerprint.digest()).toString("hex") }
}

/** The tar's pieces, each sealed for one server's key. */
const sealAll = (tar: Uint8Array, serverKey: ServerPublicKey) =>
  cutPieces(tar).map((piece) => sealPiece(piece, serverKey))

/** The Dockerfile build of a pack: the pack's fingerprint signed, with the pieces' fingerprints. */
function buildOf(hash: string, size: number, chunks: string[]): Build {
  const recipe: Omit<Build, "key"> = {
    pack: { hash, size, chunks },
    builder: { name: "dockerfile", dockerfile: "Dockerfile", target: null },
    args: [{ name: "NODE_ENV", value: "production" }],
    secrets: [],
    network: "default",
    timeout: 1800,
    fresh: null,
  }
  return { key: buildKey(recipe, []), ...recipe }
}

/** The Compose text zekno writes for the build: its service runs the image by its Compose name. */
const composeOf = (key: string) =>
  `services:\n  web:\n    image: "${builtImageName(APP, key)}"\n    pull_policy: "never"\n`

/** A deploy to this world's server B, signed by its admin, of this one build. */
const deployOf = (w: World, build: Build): Promise<Envelope> =>
  createDeployV2({
    trust: w.trust,
    serverId: w.server.serverId,
    app: APP,
    previous: 0,
    compose: composeOf(build.key),
    statements: [],
    removals: [],
    expiresAt: null,
    builds: [build],
    signer: w.founder.signer,
    now: NOW,
  })

/** `verifyDeployV2` on B's state; the test fails on any refusal. */
function verified(w: World, envelope: Envelope): VerifiedDeployV2 {
  const result = verify(w, envelope)
  if (!result.ok) throw new Error(`refused: ${result.error.code}`)
  return result.value
}

/** `admitPiece` as the runner's `pack` asks it, on B's state before the deploy. */
const admit = (w: World, envelope: unknown, piece: Uint8Array) =>
  admitPiece({ envelope, state: w.state, now: NOW, piece })

/** Each sealed piece opened with B's key to its signed length, in order. */
function openAll(
  w: World,
  deploy: VerifiedDeployV2,
  sealed: readonly Uint8Array[]
) {
  const { size } = deploy.deploy.builds[0]!.pack
  return sealed.map((piece, index) =>
    openPiece(deploy, piece, pieceLength(size, index), w.server.secretKey)
  )
}

/** The files the checker's items describe, each file's data joined. */
function filesOf(items: readonly PackItem[]) {
  const files: {
    name: string
    kind: string
    mode: number
    parts: Uint8Array[]
  }[] = []
  for (const item of items) {
    if (item.kind === "data") files.at(-1)?.parts.push(item.bytes)
    else
      files.push({
        name: item.name,
        kind: item.kind,
        mode: item.kind === "file" ? item.mode : 0o755,
        parts: [],
      })
  }
  return files.map(({ parts, ...file }) => ({
    ...file,
    data: Buffer.concat(parts),
  }))
}

const holds = (bytes: Uint8Array, marker: string) =>
  Buffer.from(bytes).includes(Buffer.from(text(marker)))

/** What the honest path made: the files, the pack, its pieces sealed for B, and the deploy to B. */
let w: World
let files: File[]
let pack: { tar: Uint8Array; hash: string }
let pieces: { sealed: Uint8Array; fingerprint: string }[]
let build: Build
let envelope: Envelope

beforeAll(async () => {
  w = await world()
  files = projectFiles()
  pack = packOf(files)
  pieces = sealAll(pack.tar, w.server.publicKey)
  build = buildOf(
    pack.hash,
    pack.tar.length,
    pieces.map((piece) => piece.fingerprint)
  )
  envelope = await deployOf(w, build)
})

describe("User Story 4: the code reaches server B as it was packed", () => {
  test("every piece passes the gate, opens, and the checker gives back the same files", () => {
    expect(pieces.length).toBe(2)
    // RB2: each piece is staged for a deploy that passes K4 to K10 and lists it.
    for (const piece of pieces) {
      const admitted = admit(w, envelope, piece.sealed)
      expect(reason(admitted)).toBe("accepted")
      if (admitted.ok)
        expect(admitted.value.fingerprint).toBe(piece.fingerprint)
    }
    const deploy = verified(w, envelope)
    expect(deploy.deploy.builds).toEqual([build])

    const checker = createPackChecker(build.pack)
    const items: PackItem[] = []
    const again = hashStream("zekno/v1/pack")
    for (const opened of openAll(
      w,
      deploy,
      pieces.map((piece) => piece.sealed)
    )) {
      if (!opened.ok) throw new Error(`refused: ${opened.error.code}`)
      again.update(opened.value)
      const written = checker.write(opened.value)
      if (!written.ok) throw new Error(`refused: ${written.error.code}`)
      items.push(...written.value)
    }
    const ended = checker.end()
    expect(reason(ended)).toBe("accepted")
    if (ended.ok) expect(ended.value.entries).toBe(files.length)
    expect(Buffer.from(again.digest()).toString("hex")).toBe(build.pack.hash)

    const back = filesOf(items)
    expect(back.map(({ name, kind, mode }) => [name, kind, mode])).toEqual(
      files.map(({ name, kind, mode }) => [name, kind, mode])
    )
    back.forEach((file, index) =>
      expect([
        file.name,
        file.data.equals(Buffer.from(files[index]!.data)),
      ]).toEqual([file.name, true])
    )
  })
})

describe("User Story 4: what a hostile relay holds and does", () => {
  test("the marker is in the pack, and in no sealed piece and not in the payload's text (SC-007)", () => {
    expect(holds(pack.tar, MARKER)).toBe(true)
    for (const piece of pieces) expect(holds(piece.sealed, MARKER)).toBe(false)
    const payload = Buffer.from(envelope.payload, "base64url").toString("utf8")
    expect(payload).toContain(build.pack.hash)
    expect(payload).not.toContain(MARKER)
    expect(JSON.stringify(envelope)).not.toContain(MARKER)
  })

  test("one byte of one sealed piece changed: pack_mismatch, the piece is not listed", () => {
    for (const at of [0, pieces[1]!.sealed.length >> 1]) {
      const changed = pieces[1]!.sealed.slice()
      changed[at]! ^= 0x01
      const admitted = admit(w, envelope, changed)
      expect(reason(admitted)).toBe("pack_mismatch")
      if (!admitted.ok)
        expect(admitted.error.message).toBe(
          "The deploy does not list this piece."
        )
    }
    // The piece as sealed is still listed: the change alone was refused.
    expect(reason(admit(w, envelope, pieces[1]!.sealed))).toBe("accepted")
  })

  test("pieces sealed for server A, in a deploy to B: openPiece answers pack_mismatch (FR-026)", async () => {
    const serverA = generateServerKeyPair()
    const forA = sealAll(pack.tar, serverA.publicKey)
    // Offered for the honest deploy to B, A's pieces are not listed.
    for (const piece of forA)
      expect(reason(admit(w, envelope, piece.sealed))).toBe("pack_mismatch")
    // Signed into a deploy to B, they pass the gate, and do not open with B's key.
    const toB = await deployOf(
      w,
      buildOf(
        pack.hash,
        pack.tar.length,
        forA.map((piece) => piece.fingerprint)
      )
    )
    for (const piece of forA)
      expect(reason(admit(w, toB, piece.sealed))).toBe("accepted")
    const deploy = verified(w, toB)
    for (const opened of openAll(
      w,
      deploy,
      forA.map((piece) => piece.sealed)
    ))
      expect(reason(opened)).toBe("pack_mismatch")
  })

  test("one file changed after signing, its pieces sealed honestly: the checker answers pack_mismatch by fingerprint", async () => {
    // The same names, sizes and form; one byte of the marked file differs.
    const changed = files.map((file) =>
      file.name === "src/config.ts"
        ? {
            ...file,
            data: text(`export const token = "${MARKER.toUpperCase()}"\n`),
          }
        : file
    )
    const after = packOf(changed)
    expect(after.tar.length).toBe(pack.tar.length)
    expect(after.hash).not.toBe(pack.hash)
    const sealed = sealAll(after.tar, w.server.publicKey)
    // Signed with the fingerprint read before the change, and the pieces sealed after it.
    const signed = await deployOf(
      w,
      buildOf(
        pack.hash,
        pack.tar.length,
        sealed.map((piece) => piece.fingerprint)
      )
    )
    for (const piece of sealed)
      expect(reason(admit(w, signed, piece.sealed))).toBe("accepted")
    const deploy = verified(w, signed)
    const checker = createPackChecker(deploy.deploy.builds[0]!.pack)
    for (const opened of openAll(
      w,
      deploy,
      sealed.map((piece) => piece.sealed)
    )) {
      if (!opened.ok) throw new Error(`refused: ${opened.error.code}`)
      // Every byte is in the one form: only the fingerprint can tell.
      expect(reason(checker.write(opened.value))).toBe("accepted")
    }
    const ended = checker.end()
    expect(reason(ended)).toBe("pack_mismatch")
    if (!ended.ok) expect(ended.error.message).toContain("fingerprint")
  })

  test("a payload whose key does not match, signed by a member directly with signEnvelope: malformed", async () => {
    const payload = payloadOf(envelope) as {
      compose: string
      builds: { key: string }[]
    }
    const real = payload.builds[0]!.key
    const wrong = `${real.slice(0, -1)}${real.endsWith("0") ? "1" : "0"}`
    payload.builds[0]!.key = wrong
    // The Compose text names the wrong key too, so only the key rule (CO2) refuses it.
    payload.compose = composeOf(wrong)
    const forged = await signEnvelope(
      PAYLOAD_TYPES.deployV2,
      text(JSON.stringify(payload)),
      w.founder.signer
    )
    expect(reason(verify(w, forged))).toBe("malformed")
    expect(reason(admit(w, forged, pieces[0]!.sealed))).toBe("malformed")
  })
})
