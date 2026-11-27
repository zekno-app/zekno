/**
 * Pass 2: the pack read once, hashed and sealed (specs/016-build-from-source,
 * contracts/cli.md CL2, "Pass 2"; data-model.md, "The pack" and "A piece";
 * FR-012, FR-016, FR-019, FR-020, FR-026).
 *
 * The tar `spool.ts` streams goes, in the same pass, into core's streaming
 * pack hash and into the pieces: cut at core's 8 MiB boundaries, each sealed
 * with core's `sealPiece` for the server's key from the signed team list on
 * this machine, and written once into this run's own folder
 * (`profile/run-folder.ts`), files mode 600. A piece's plain bytes are held
 * only in memory, and wiped once sealed: no plain copy of the code is ever
 * written. A new run seals again (FR-020).
 *
 * One pack is made for each distinct folder sent (`createPacks`): two
 * services of one folder share its pieces (FR-012). With no sealing the
 * pack gives its fingerprint alone, for `zekno settings compose`.
 */
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  hashStream,
  LIMITS,
  sealPiece,
  type ServerPublicKey,
} from "@workspace/core"

import { type FileHook, spoolPack } from "./spool"
import type { Walk } from "./walk"

/** Where and for whom pieces are sealed: the server's key from the signed team list, and this run's own folder. */
export type Sealing = {
  readonly serverKey: ServerPublicKey
  readonly folder: string
}

/** A sealed piece, written in this run's folder under its fingerprint. */
export type SealedPiece = {
  /** `hash("zekno/v1/pack-chunk", sealed)`, as the build's `pack.chunks` lists it. */
  readonly fingerprint: string
  /** Its file in this run's folder. */
  readonly file: string
  /** The bytes of the tar it holds, L(i). */
  readonly length: number
}

/** A pack as a build entry signs it (core.md CO1): its fingerprint, its size and its sealed pieces in order, none with no sealing. */
export type Pack = {
  /** `hash("zekno/v1/pack", tar)`, in hex. */
  readonly hash: string
  readonly size: number
  readonly pieces: readonly SealedPiece[]
}

/** What pass 2 is given: where to seal, null for the fingerprint alone, and what sees each file. */
export type PackOptions = {
  readonly seal: Sealing | null
  readonly hook?: FileHook
}

/** Cuts the tar at 8 MiB boundaries as it streams, sealing and writing each piece once it is whole. */
function createCutter(seal: Sealing) {
  const piece = new Uint8Array(LIMITS.chunkBytes)
  let filled = 0
  const pieces: SealedPiece[] = []

  const flush = () => {
    if (filled === 0) return
    const { sealed, fingerprint } = sealPiece(
      piece.subarray(0, filled),
      seal.serverKey
    )
    const file = join(seal.folder, fingerprint)
    // `wx`: written once, never over a file already there.
    writeFileSync(file, sealed, { mode: 0o600, flag: "wx" })
    pieces.push({ fingerprint, file, length: filled })
    piece.fill(0, 0, filled)
    filled = 0
  }

  return {
    pieces,
    write(bytes: Uint8Array) {
      let at = 0
      while (at < bytes.length) {
        const taken = Math.min(piece.length - filled, bytes.length - at)
        piece.set(bytes.subarray(at, at + taken), filled)
        filled += taken
        at += taken
        if (filled === piece.length) flush()
      }
    },
    end: flush,
    /** Wipes what is held and deletes what was written, when the pack is not finished. */
    discard() {
      piece.fill(0)
      for (const { file } of pieces) rmSync(file, { force: true })
    },
  }
}

/**
 * Pass 2 of a walk (CL2): every file read once as `spool.ts` reads it, the
 * tar hashed and, with `seal`, cut, sealed and written as it streams. A file
 * that cannot be read is C5, one that changed since pass 1 C6; the pieces
 * already written are then deleted.
 */
export async function packFolder(
  found: Pick<Walk, "entries">,
  options: PackOptions
): Promise<Pack> {
  const hash = hashStream("zekno/v1/pack")
  const cutter = options.seal === null ? undefined : createCutter(options.seal)
  try {
    const size = await spoolPack(
      found.entries,
      (bytes) => {
        hash.update(bytes)
        cutter?.write(bytes)
      },
      options.hook
    )
    cutter?.end()
    return {
      hash: Buffer.from(hash.digest()).toString("hex"),
      size,
      pieces: cutter?.pieces ?? [],
    }
  } catch (error) {
    cutter?.discard()
    throw error
  }
}

/** The packs of one deploy, one for each distinct folder sent and set of entries. */
export interface Packs {
  /** The pack of a walk, made once: a second walk of the same folder with the same entries gets the same pack, and its hook is not called. */
  pack(found: Walk, hook?: FileHook): Promise<Pack>
}

/**
 * One pack for each distinct folder sent (FR-012): services built from one
 * folder share its pieces, so the code travels once. Two walks are one pack
 * when they have the same real root and the same entries, which differ only
 * when each build's Dockerfile chooses another ignore file.
 */
export function createPacks(seal: Sealing | null): Packs {
  const made = new Map<string, Promise<Pack>>()
  return {
    pack(found, hook) {
      // Sent names hold no control character, so a line break joins them unambiguously.
      const key = `${found.root}\n${found.entries.map((entry) => entry.name).join("\n")}`
      let pack = made.get(key)
      if (pack === undefined) {
        pack = packFolder(found, { seal, hook })
        made.set(key, pack)
      }
      return pack
    },
  }
}
