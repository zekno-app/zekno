/**
 * Pass 2: read once, packed, hashed and sealed (specs/016-build-from-source,
 * contracts/cli.md CL2, "Pass 2"; data-model.md, "The pack" and "A piece";
 * FR-016, FR-019, FR-020, FR-026; tasks T118). Every folder is written at
 * run time, every profile folder is a temporary `ZEKNO_HOME`, never
 * `~/.zekno`, and no key leaves the test. No sentence is checked: a stop is
 * checked by its id.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  createPackChecker,
  generateServerKeyPair,
  hashStream,
  LIMITS,
  pieceFingerprint,
} from "@workspace/core"

import { BuildStop, type BuildLine } from "../../src/shared/build-lines"
import { createPacks, packFolder, type Sealing } from "../../src/pack/chunks"
import { readIgnoreFile } from "../../src/pack/ignore"
import { spoolPack } from "../../src/pack/spool"
import { walkFolder, type Walk } from "../../src/pack/walk"
import { openRunFolder, type RunFolder } from "../../src/profile/run-folder"

let root: string
let home: string
let run: RunFolder

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "zekno-chunks-")))
  home = realpathSync(mkdtempSync(join(tmpdir(), "zekno-chunks-home-")))
  run = openRunFolder(home)
})

afterEach(() => {
  run.remove()
  rmSync(root, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

function write(path: string, content: string | Uint8Array = "x"): string {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
  return full
}

function walk(): Walk {
  return walkFolder(root, {
    dockerfile: "Dockerfile",
    ignore: readIgnoreFile(root, {
      builder: "dockerfile",
      dockerfile: "Dockerfile",
    }),
    include: [],
    agreed: () => false,
    zeknoHome: home,
  })
}

const sealing = (): Sealing => ({
  serverKey: generateServerKeyPair().publicKey,
  folder: run.path,
})

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex")

/** The tar of a walk, gathered whole: only a test holds it. */
async function tarOf(found: Walk): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  await spoolPack(found.entries, (bytes) => parts.push(bytes.slice()))
  return new Uint8Array(Buffer.concat(parts))
}

/** Deterministic bytes that do not compress away. */
function noise(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length)
  let state = seed >>> 0 || 1
  for (let at = 0; at < length; at++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    out[at] = state & 0xff
  }
  return out
}

/** Every file under a folder, with its bytes. */
function filesUnder(folder: string): { path: string; bytes: Buffer }[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      return { path, bytes: readFileSync(path) }
    })
}

async function stopOf(work: () => Promise<unknown>): Promise<BuildLine> {
  try {
    await work()
  } catch (error) {
    expect(error).toBeInstanceOf(BuildStop)
    expect((error as BuildStop).message).toBe((error as BuildStop).line.id)
    return (error as BuildStop).line
  }
  throw new Error("expected a stop")
}

describe("the pack's fingerprint (CO5, FR-016)", () => {
  test("the streamed fingerprint equals core's hash of the same tar, made whole", async () => {
    write("Dockerfile", "FROM scratch\nCOPY . /app\n")
    write("src/app.txt", "hello\n")
    write("data/noise.bin", noise(9 * 1024 * 1024 + 123, 7))
    const found = walk()
    const tar = await tarOf(found)
    const whole = hashStream("zekno/v1/pack")
    whole.update(tar)

    const pack = await packFolder(found, { seal: null })
    expect(pack.size).toBe(tar.length)
    expect(pack.hash).toBe(hex(whole.digest()))
    // The runner's checker takes it with that size and fingerprint.
    const checker = createPackChecker({ size: pack.size, hash: pack.hash })
    expect(checker.write(tar).ok).toBe(true)
    expect(checker.end().ok).toBe(true)
  })

  test("a mode with no sealing gives the fingerprint alone, and writes nothing", async () => {
    write("Dockerfile", "FROM scratch\n")
    write("src/app.txt", "hello\n")
    const found = walk()
    const plain = await packFolder(found, { seal: null })
    expect(plain.pieces).toEqual([])
    expect(readdirSync(run.path)).toEqual([])
    const sealed = await packFolder(found, { seal: sealing() })
    expect(sealed.hash).toBe(plain.hash)
    expect(sealed.size).toBe(plain.size)
  })
})

describe("the pieces (data-model.md, A piece; FR-026)", () => {
  test("cut at 8 MiB boundaries, each sealed and written once into this run's folder, mode 600", async () => {
    write("Dockerfile", "FROM scratch\n")
    write("data/a.bin", noise(LIMITS.chunkBytes + 4096, 3))
    write("data/b.bin", noise(LIMITS.chunkBytes, 5))
    const found = walk()
    const pack = await packFolder(found, { seal: sealing() })
    expect(pack.pieces).toHaveLength(Math.ceil(pack.size / LIMITS.chunkBytes))
    expect(pack.pieces.map((piece) => piece.length)).toEqual([
      LIMITS.chunkBytes,
      LIMITS.chunkBytes,
      pack.size - 2 * LIMITS.chunkBytes,
    ])
    expect(statSync(run.path).mode & 0o777).toBe(0o700)
    const written = readdirSync(run.path).sort()
    expect(written).toEqual(
      pack.pieces.map((piece) => piece.fingerprint).sort()
    )
    for (const piece of pack.pieces) {
      expect(piece.file).toBe(join(run.path, piece.fingerprint))
      expect(statSync(piece.file).mode & 0o777).toBe(0o600)
      const sealed = readFileSync(piece.file)
      expect(pieceFingerprint(sealed)).toBe(piece.fingerprint)
      expect(sealed.length).toBeLessThanOrEqual(LIMITS.sealedPieceBytes)
    }
  })

  test("no plain copy of the code: a marker from a source file is in no sealed piece and no file of the run folder (SC-007)", async () => {
    const marker = `zekno-marker-${hex(crypto.getRandomValues(new Uint8Array(16)))}`
    write("Dockerfile", "FROM scratch\n")
    write("src/secret-plan.txt", `${marker}\n`.repeat(1000))
    write("data/noise.bin", noise(LIMITS.chunkBytes + 1, 11))
    const found = walk()
    // The tar itself holds it: the check below would find it in a plain copy.
    expect(Buffer.from(await tarOf(found)).includes(marker)).toBe(true)

    const pack = await packFolder(found, { seal: sealing() })
    expect(pack.pieces.length).toBe(2)
    const files = filesUnder(home)
    expect(files.length).toBe(pack.pieces.length)
    for (const { bytes } of files) expect(bytes.includes(marker)).toBe(false)
  })

  test("two services of one folder share its pieces: one pack, sealed once (FR-012)", async () => {
    write("Dockerfile", "FROM scratch\n")
    write("src/app.txt", "hello\n")
    const packs = createPacks(sealing())
    const web = await packs.pack(walk())
    const worker = await packs.pack(walk())
    expect(worker).toBe(web)
    expect(readdirSync(run.path)).toHaveLength(web.pieces.length)

    write("src/other.txt", "another file\n")
    const changed = await packs.pack(walk())
    expect(changed.hash).not.toBe(web.hash)
  })
})

describe("each file read once (CL2, Pass 2; FR-019)", () => {
  test("the per-file hook receives each file's name and bytes, in the pack's order", async () => {
    write("Dockerfile", "FROM scratch\n")
    write("src/a.txt", "alpha\n")
    write("src/b.bin", noise(3 * 1024 * 1024, 13))
    write("empty.txt", "")
    const seen: { name: string; size: number; bytes: Buffer }[] = []
    let open: { name: string; size: number; parts: Uint8Array[] } | undefined
    await packFolder(walk(), {
      seal: null,
      hook: {
        begin: (name, size) => {
          expect(open).toBeUndefined()
          open = { name, size, parts: [] }
        },
        data: (bytes) => open!.parts.push(bytes.slice()),
        end: () => {
          seen.push({ ...open!, bytes: Buffer.concat(open!.parts) })
          open = undefined
        },
      },
    })
    expect(seen.map(({ name }) => name)).toEqual([
      "Dockerfile",
      "empty.txt",
      "src/a.txt",
      "src/b.bin",
    ])
    for (const { name, size, bytes } of seen) {
      const onDisk = readFileSync(join(root, name))
      expect(size).toBe(onDisk.length)
      expect(bytes.equals(onDisk)).toBe(true)
    }
  })

  test("a file that cannot be read is C5", async () => {
    if (process.getuid?.() === 0) return
    write("Dockerfile", "FROM scratch\n")
    const locked = write("public/video.mp4", noise(100 * 1024, 17))
    // Locked before pass 1, which does not read a file past 64 KiB: a mode changed between the passes is C6, a change.
    chmodSync(locked, 0o000)
    const found = walk()
    try {
      expect(await stopOf(() => packFolder(found, { seal: null }))).toEqual({
        id: "C5",
        path: "public/video.mp4",
      })
    } finally {
      chmodSync(locked, 0o644)
    }
  })

  test("a file that changed since pass 1 is C6: grown, removed, or a link in its place", async () => {
    write("Dockerfile", "FROM scratch\n")
    const app = write("src/app.txt", "one\n")
    let found = walk()
    appendFileSync(app, "two\n")
    expect(await stopOf(() => packFolder(found, { seal: null }))).toEqual({
      id: "C6",
      path: "src/app.txt",
    })

    found = walk()
    unlinkSync(app)
    expect(await stopOf(() => packFolder(found, { seal: null }))).toEqual({
      id: "C6",
      path: "src/app.txt",
    })

    write("src/app.txt", "one\n")
    found = walk()
    unlinkSync(app)
    writeFileSync(join(root, "elsewhere.txt"), "one\n")
    symlinkSync(join(root, "elsewhere.txt"), app)
    expect(await stopOf(() => packFolder(found, { seal: sealing() }))).toEqual({
      id: "C6",
      path: "src/app.txt",
    })
    // What was sealed before the stop is not left in the run folder.
    expect(readdirSync(run.path)).toEqual([])
  })

  test("a file written over in place since pass 1, its size kept and its time put back, is C6", async () => {
    write("Dockerfile", "FROM scratch\n")
    const before = "plain text, nothing secret in it at all\n"
    const after = "-----BEGIN OPENSSH PRIVATE KEY-----xxxx\n"
    expect(after.length).toBe(before.length)
    const file = write("src/notes.txt", before)
    // A whole second, so the time put back is exactly the one pass 1 saw.
    const time = new Date("2024-01-02T03:04:05.000Z")
    utimesSync(file, time, time)
    const seen = statSync(file, { bigint: true })
    const found = walk()
    writeFileSync(file, after)
    // As `touch -r` does: the time is put back, the change time cannot be.
    utimesSync(file, time, time)
    const now = statSync(file, { bigint: true })
    expect([now.size, now.mtimeNs, now.ino]).toEqual([
      seen.size,
      seen.mtimeNs,
      seen.ino,
    ])
    expect(await stopOf(() => packFolder(found, { seal: null }))).toEqual({
      id: "C6",
      path: "src/notes.txt",
    })
  })

  test("a file that changes while it is read is C6", async () => {
    write("Dockerfile", "FROM scratch\n")
    const big = write("data/log.bin", noise(3 * 1024 * 1024, 19))
    const found = walk()
    let grown = false
    const line = await stopOf(() =>
      packFolder(found, {
        seal: null,
        hook: {
          begin: () => {},
          data: () => {
            if (grown) return
            grown = true
            appendFileSync(big, "more\n")
          },
          end: () => {},
        },
      })
    )
    expect(line).toEqual({ id: "C6", path: "data/log.bin" })
  })
})
