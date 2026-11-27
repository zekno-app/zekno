/**
 * What a `buildx build` received (specs/016-build-from-source, T063;
 * contracts/runner.md RB7 "Standard input", RB8): the entries of the tar on
 * its standard input, read leniently so that a cut or odd tar still lists
 * what came, or the files of a folder context with their modes. The stand-in
 * for Docker records them; the runner's own checks of the pack are core's.
 */
import { lstatSync, readdirSync } from "node:fs"
import { join } from "node:path"

import type { ContextEntry } from "./model"

const BLOCK = 512

const text = (bytes: Uint8Array, from: number, length: number) => {
  const field = bytes.subarray(from, from + length)
  const end = field.indexOf(0)
  return new TextDecoder().decode(end === -1 ? field : field.subarray(0, end))
}

const octal = (bytes: Uint8Array, from: number, length: number) =>
  Number.parseInt(text(bytes, from, length).trim() || "0", 8) || 0

/** The `path` record of a pax header's data, if it has one. */
function paxPath(data: Uint8Array): string | undefined {
  const records = new TextDecoder().decode(data).split("\n")
  for (const record of records) {
    const pair = record.slice(record.indexOf(" ") + 1)
    if (pair.startsWith("path=")) return pair.slice("path=".length)
  }
  return undefined
}

/** The entries of a tar, in order, up to its end blocks or as far as it goes. */
export function tarEntries(bytes: Uint8Array): ContextEntry[] {
  const entries: ContextEntry[] = []
  let at = 0
  let longName: string | undefined
  while (at + BLOCK <= bytes.length) {
    const header = bytes.subarray(at, at + BLOCK)
    if (header.every((byte) => byte === 0)) break
    const size = octal(header, 124, 12)
    const type = String.fromCharCode(header[156] || 0x30)
    const data = bytes.subarray(at + BLOCK, at + BLOCK + size)
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK
    if (type === "x" || type === "L") {
      longName = type === "x" ? paxPath(data) : text(data, 0, data.length)
      continue
    }
    if (type === "g") continue
    const prefix = text(header, 345, 155)
    const short = text(header, 0, 100)
    entries.push({
      name: longName ?? (prefix ? `${prefix}/${short}` : short),
      kind: type === "0" ? "file" : type === "5" ? "folder" : "other",
      mode: octal(header, 100, 8) & 0o7777,
      size,
      mtime: octal(header, 136, 12),
    })
    longName = undefined
  }
  return entries
}

/** The files and folders under `root`, sorted by name, each folder's name ending with `/`. */
export function folderEntries(root: string, under = ""): ContextEntry[] {
  const entries: ContextEntry[] = []
  for (const name of readdirSync(join(root, under)).sort()) {
    const path = `${under}${name}`
    const stat = lstatSync(join(root, path))
    const folder = stat.isDirectory()
    entries.push({
      name: folder ? `${path}/` : path,
      kind: folder ? "folder" : stat.isFile() ? "file" : "other",
      mode: stat.mode & 0o7777,
      size: folder ? 0 : stat.size,
      mtime: Math.floor(stat.mtimeMs / 1000),
    })
    if (folder) entries.push(...folderEntries(root, `${path}/`))
  }
  return entries
}
