/**
 * Packs and staged pieces for the runner's tests of `pack` (specs/016-
 * build-from-source, contracts/runner.md RB2; core.md CO5, CO12): a pack
 * written with core's writer and its pieces sealed for the server, a deploy
 * that builds from it, the request zekno sends for each piece, and what
 * `packs/` holds, read or written by hand as the runner writes it.
 */
import {
  createTarWriter,
  cutPieces,
  hashStream,
  sealPiece,
  type Envelope,
  type ServerPublicKey,
} from "@workspace/core"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  truncateSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { buildDeployV2 } from "./deploy-v2"
import type { world } from "./helpers"

type World = Awaited<ReturnType<typeof world>>
/** One sealed piece and its fingerprint, `hash("zekno/v1/pack-chunk", sealed)`. */
export type Sealed = { sealed: Uint8Array; fingerprint: string }

export const base64Url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64url")

/** A pack holding one file, written with core's writer, its pieces sealed for the server (CO5): what zekno uploads. */
export function sealedPack(serverKey: string, text: string) {
  const writer = createTarWriter()
  const data = new TextEncoder().encode(text)
  const tar = Buffer.concat([
    writer.begin({
      name: "builder.dockerfile",
      kind: "file",
      mode: 0o644,
      size: data.length,
    }),
    writer.data(data),
    writer.finish(),
    writer.end(),
  ])
  const fingerprint = hashStream("zekno/v1/pack")
  fingerprint.update(tar)
  const pieces = cutPieces(tar).map((piece) =>
    sealPiece(piece, serverKey as ServerPublicKey)
  )
  return {
    pack: {
      hash: Buffer.from(fingerprint.digest()).toString("hex"),
      size: tar.length,
      chunks: pieces.map((piece) => piece.fingerprint),
    },
    pieces,
  }
}

/** A deploy of `app` made against `previous` that builds one image from each of `texts`, and the sealed pieces it lists. */
export async function buildingDeploy(
  w: World,
  options: { previous?: number; app?: string; texts?: string[] } = {}
): Promise<{ envelope: Envelope; records: unknown[]; pieces: Sealed[] }> {
  const serverKey = String(w.setup.json!.serverPublicKey)
  const packs = (options.texts ?? ["FROM busybox\n"]).map((text) =>
    sealedPack(serverKey, text)
  )
  const built = await buildDeployV2({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    previous: options.previous ?? 0,
    app: options.app,
    builds: packs.map(({ pack }) => ({
      pack,
      builder: { name: "dockerfile", dockerfile: "Dockerfile", target: null },
      args: [],
      secrets: [],
      network: "default",
      timeout: 600,
      fresh: null,
    })),
  })
  return { ...built, pieces: packs.flatMap((each) => each.pieces) }
}

/** A `pack` request as zekno sends it on a session. */
export const packRequest = (envelope: unknown, sealed: Uint8Array) => ({
  command: "pack",
  input: { envelope, piece: base64Url(sealed) },
})

/** The text `pack` reads: what a session hands it for one request. */
export const packText = (envelope: unknown, sealed: Uint8Array) =>
  JSON.stringify({ envelope, piece: base64Url(sealed) })

/** The same deploy with its signature changed: refused at K5 whatever it carries. */
export function badlySigned(envelope: Envelope): Envelope {
  const { sig } = envelope.signature
  const changed = `${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`
  return { ...envelope, signature: { ...envelope.signature, sig: changed } }
}

/** `packs/<app>/` in the runner's folder. */
export const packsOf = (home: string, app: string) => join(home, "packs", app)

/** What `packs/<app>/` holds, sorted; nothing when it is not there. */
export const stagedIn = (home: string, app: string) =>
  existsSync(packsOf(home, app)) ? readdirSync(packsOf(home, app)).sort() : []

/** `packs/<app>/deploy.json`, parsed. */
export const deployFile = (home: string, app: string) =>
  JSON.parse(
    readFileSync(join(packsOf(home, app), "deploy.json"), "utf8")
  ) as Record<string, unknown>

/** The name `deploy.json` gives a deploy, worked out here as RB2 says: SHA-256 of the payload's bytes. */
export const payloadHashOf = (envelope: Envelope) =>
  createHash("sha256")
    .update(Buffer.from(envelope.payload, "base64url"))
    .digest("hex")

/**
 * Another app's deploy staged by hand, as `pack` writes it: `deploy.json`
 * and one piece of `bytes`, sparse, so its length counts toward staging
 * while the disk is not used. Gives the piece's path.
 */
export function stageByHand(
  home: string,
  app: string,
  deploy: { previous: number; staged: Date },
  bytes: number
): string {
  const folder = packsOf(home, app)
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  writeFileSync(
    join(folder, "deploy.json"),
    JSON.stringify({
      payload: "e".repeat(64),
      previous: deploy.previous,
      staged: deploy.staged.toISOString(),
    }),
    { mode: 0o600 }
  )
  const piece = join(folder, "f".repeat(64))
  writeFileSync(piece, "", { mode: 0o600 })
  truncateSync(piece, bytes)
  return piece
}
