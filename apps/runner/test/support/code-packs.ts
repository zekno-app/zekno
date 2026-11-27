/**
 * Packs of a project's code for the runner's tests of checking it before
 * the number (specs/016-build-from-source, contracts/runner.md RB4, RB3
 * K14d; core.md CO5; data-model.md, "The pack" and "A piece"): files made
 * in memory, written in the one form with core's writer, fingerprinted with
 * its streaming hash, cut and sealed for a server's key, as a zekno of this
 * feature makes them, and a Dockerfile build that names them. A test can
 * also take the bytes and change them, to make what no zekno would.
 */
import {
  compareNames,
  createTarWriter,
  cutPieces,
  hashStream,
  sealPiece,
  type ServerPublicKey,
} from "@workspace/core"

import type { BuildRecipeInput } from "./deploy-v2"

/** One entry of a pack as a test gives it: a folder's name ends with `/`. */
export type PackFile = {
  name: string
  kind: "file" | "folder"
  mode: 0o644 | 0o755
  data: Uint8Array
}

const encoder = new TextEncoder()

/** A file of the pack, its text as UTF-8 or its bytes as given. */
export const file = (
  name: string,
  data: string | Uint8Array,
  mode: 0o644 | 0o755 = 0o644
): PackFile => ({
  name,
  kind: "file",
  mode,
  data: typeof data === "string" ? encoder.encode(data) : data,
})

/** A folder of the pack: its name ends with `/`. */
export const folder = (name: string): PackFile => ({
  name,
  kind: "folder",
  mode: 0o755,
  data: new Uint8Array(),
})

/** A Dockerfile a build could run. */
export const DOCKERFILE = 'FROM scratch\nCOPY . /app\nCMD ["/app/start.sh"]\n'

/** A small project: its Dockerfile, a folder and two files. */
export const project = (): PackFile[] => [
  file("Dockerfile", DOCKERFILE),
  folder("src/"),
  file("src/index.ts", 'console.log("hello")\n'),
  file("start.sh", "#!/bin/sh\nexec /app/server\n", 0o755),
]

/** The fingerprint of `bytes` as a pack's: the hex of `hash("zekno/v1/pack", …)`, streamed. */
export function packHash(bytes: Uint8Array): string {
  const stream = hashStream("zekno/v1/pack")
  stream.update(bytes)
  return Buffer.from(stream.digest()).toString("hex")
}

/** The pack of `files`, sorted by their names' UTF-8 bytes and written with `createTarWriter`, and its fingerprint. */
export function packOf(files: readonly PackFile[]): {
  tar: Uint8Array
  hash: string
} {
  const writer = createTarWriter()
  const parts: Uint8Array[] = []
  for (const each of [...files].sort((a, b) => compareNames(a.name, b.name))) {
    parts.push(
      writer.begin({
        name: each.name,
        kind: each.kind,
        mode: each.mode,
        size: each.data.length,
      })
    )
    if (each.data.length > 0) parts.push(writer.data(each.data))
    parts.push(writer.finish())
  }
  parts.push(writer.end())
  const tar = new Uint8Array(Buffer.concat(parts))
  return { tar, hash: packHash(tar) }
}

/** One sealed piece and its fingerprint, as `pack` stages it. */
export type Piece = { sealed: Uint8Array; fingerprint: string }

/** The tar's pieces, cut at 8 MiB and each sealed for the server's key. */
export const sealAll = (tar: Uint8Array, server: ServerPublicKey): Piece[] =>
  cutPieces(tar).map((piece) => sealPiece(piece, server))

/**
 * A Dockerfile build of a pack, without its key: the pack's fingerprint and
 * size signed with the pieces' fingerprints, the Dockerfile named
 * `dockerfile`, no argument, no secret, the default network, 600 seconds
 * and no fresh build, unless `change` says otherwise.
 */
export function dockerfileBuild(
  pack: { hash: string; size: number },
  pieces: readonly Pick<Piece, "fingerprint">[],
  change: Partial<BuildRecipeInput> & { dockerfile?: string } = {}
): BuildRecipeInput {
  const { dockerfile = "Dockerfile", ...rest } = change
  return {
    pack: {
      hash: pack.hash,
      size: pack.size,
      chunks: pieces.map((piece) => piece.fingerprint),
    },
    builder: { name: "dockerfile", dockerfile, target: null },
    args: [],
    secrets: [],
    network: "default",
    timeout: 600,
    fresh: null,
    ...rest,
  }
}
