/**
 * The limits of a pack, from pass 1 alone (specs/016-build-from-source,
 * contracts/cli.md CL2, "Pass 1"; data-model.md, "The pack"; FR-017,
 * FR-018): the pack's exact size as core's tar writer lays it out, the stops
 * C1 to C4 before signing, the warning B12 above 100 MB, and the largest
 * top-level folders B4 and C1 name.
 *
 * A folder's bytes are those it adds to the pack, its own header and every
 * entry under it with its header and its data padded to whole blocks, so
 * many small files weigh what they cost to send. Sizes come from `lstat`:
 * a sparse file counts its whole size, as the pack holds it.
 */
import { LIMITS } from "@workspace/core"

import { BuildStop, type FolderBytes, type LineOf } from "../shared/build-lines"
import type { SentEntry, Walk } from "./walk"

/** A tar block: every header is one, and data is padded to whole ones (CO5). */
const BLOCK = 512

/** The end of a tar: two zero blocks. */
const END = 2 * BLOCK

/** Above this, the summary warns (B12; FR-018: 100 MB, as zekno prints sizes). */
export const WARN_BYTES = 100 * 1000 * 1000

/** How many folders B4, B12 and C1 name. */
export const LARGEST = 3

/** A top-level folder with the number of entries it adds to the pack, itself among them (C2). */
export type FolderEntries = { folder: string; entries: number }

/** What pass 1 says of a pack's size. */
export type PackLimits = {
  /** The pack's exact size in bytes, as core's writer lays it out. */
  readonly bytes: number
  /** Its entries, files and folders. */
  readonly entries: number
  /** Its files. */
  readonly files: number
  /** The largest top-level folders by bytes, largest first, at most three. */
  readonly largest: readonly FolderBytes[]
  /** The top-level folders with the most entries, most first, at most three. */
  readonly mostEntries: readonly FolderEntries[]
}

/** The bytes an entry adds to the pack: its header, then its data padded to whole blocks. */
const bytesOf = (entry: Pick<SentEntry, "size">): number =>
  BLOCK + Math.ceil(entry.size / BLOCK) * BLOCK

/** The exact size of the pack of these entries, as core's writer lays it out (CO5): no name changes it, since every name fits a header. */
export function packSize(entries: readonly Pick<SentEntry, "size">[]): number {
  return entries.reduce((total, entry) => total + bytesOf(entry), END)
}

/** The top-level folder an entry is in, or undefined for a top-level file. */
function topFolder(name: string): string | undefined {
  const slash = name.indexOf("/")
  return slash === -1 ? undefined : name.slice(0, slash)
}

/** The first `LARGEST` of a tally, largest first, the order of names breaking ties. */
function firstOf<Key extends "bytes" | "entries">(
  tally: Map<string, number>,
  key: Key
): ({ folder: string } & Record<Key, number>)[] {
  return [...tally]
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, LARGEST)
    .map(
      ([folder, value]) =>
        ({ folder, [key]: value }) as { folder: string } & Record<Key, number>
    )
}

/** The limits of a walk's pack (CL2, pass 1). */
export function limitsOf(found: Pick<Walk, "entries">): PackLimits {
  const bytes = new Map<string, number>()
  const entries = new Map<string, number>()
  let files = 0
  for (const entry of found.entries) {
    if (entry.kind === "file") files++
    const folder = topFolder(entry.name)
    if (folder === undefined) continue
    bytes.set(folder, (bytes.get(folder) ?? 0) + bytesOf(entry))
    entries.set(folder, (entries.get(folder) ?? 0) + 1)
  }
  return {
    bytes: packSize(found.entries),
    entries: found.entries.length,
    files,
    largest: firstOf(bytes, "bytes"),
    mostEntries: firstOf(entries, "entries"),
  }
}

/**
 * The stops of pass 1, before anything is shown (CL2; FR-018): no file to
 * send is C3 when nothing was left out, else C4, every file having been
 * left out; more entries than a pack holds is C2, naming the folders with
 * the most; more bytes is C1, naming the largest.
 */
export function checkLimits(
  found: Pick<Walk, "entries" | "leftOut">,
  limits: PackLimits = limitsOf(found)
): void {
  if (limits.files === 0)
    throw new BuildStop(
      found.leftOut.length === 0 ? { id: "C3" } : { id: "C4" }
    )
  if (limits.entries > LIMITS.packEntries)
    throw new BuildStop({
      id: "C2",
      entries: limits.entries,
      largest: [...limits.mostEntries],
    })
  if (limits.bytes > LIMITS.packBytes)
    throw new BuildStop({
      id: "C1",
      bytes: limits.bytes,
      largest: [...limits.largest],
    })
}

/** B12, the warning of a pack above 100 MB with its largest folders, or undefined. */
export function sizeWarning(limits: PackLimits): LineOf<"B12"> | undefined {
  return limits.bytes > WARN_BYTES
    ? { id: "B12", bytes: limits.bytes, largest: [...limits.largest] }
    : undefined
}
