/**
 * HEAD, refs and objects, read from a repository's files with no `git` run
 * (specs/016-build-from-source, contracts/cli.md CL4 steps 2 and 3; plan.md
 * item 9 (a)):
 *
 * - HEAD as a branch, its ref loose or in `packed-refs`, or as a commit id;
 *   a branch with no commit yet, against which every file counts as new;
 * - objects from loose files (inflated with `node:zlib`) and from packs
 *   (`git/packs.ts`), each checked against its id;
 * - a commit's tree, a tree's entries, a subtree by its path, and every file
 *   of a tree.
 *
 * Anything malformed, missing (alternates and partial clones are not
 * followed) or past a bound gives up, which leaves the uncommitted-changes
 * line out: an object of more than 16 MiB inflated, a delta chain of more
 * than 64, a tree of more than 1,000,000 files.
 */
import { join } from "node:path"
import { inflateSync } from "node:zlib"

import { POINTER_BYTES, readBounded } from "./find"
import { INDEX_ENTRIES } from "./index-file"
import {
  DELTA_DEPTH,
  Malformed,
  OBJECT_BYTES,
  Packs,
  type RawObject,
} from "./packs"

export { DELTA_DEPTH, OBJECT_BYTES }

/** The most a `packed-refs` file may hold, in bytes. */
export const PACKED_REFS_BYTES = 32 * 1024 * 1024

/** The kinds of object. */
export type ObjectType = "commit" | "tree" | "blob" | "tag"

/** An object: its kind and its bytes. */
export type GitObject = { readonly type: ObjectType; readonly data: Buffer }

/** The kinds by their number in a pack. */
const KINDS: Record<RawObject["kind"], ObjectType> = {
  1: "commit",
  2: "tree",
  3: "blob",
  4: "tag",
}
const NUMBERS: Record<ObjectType, RawObject["kind"]> = {
  commit: 1,
  tree: 2,
  blob: 3,
  tag: 4,
}

const OBJECT_ID = /^[0-9a-f]{40}$/

/** An object's id, as git names it: SHA-1 of its kind, size and bytes. */
function idOf(type: ObjectType, data: Buffer): string {
  return new Bun.CryptoHasher("sha1")
    .update(`${type} ${data.length}\0`)
    .update(data)
    .digest("hex")
}

/** A repository's objects, loose first, then in its packs. Close it when done: it holds its packs open. */
export class ObjectReader {
  private readonly objects: string
  private readonly packs: Packs

  constructor(commonDir: string) {
    this.objects = join(commonDir, "objects")
    this.packs = new Packs(this.objects)
  }

  /** An object by its id, checked against it, or undefined when the reader gives up. */
  read(oid: string): GitObject | undefined {
    if (!OBJECT_ID.test(oid)) return undefined
    try {
      const raw = this.raw(oid, 0)
      const type = KINDS[raw.kind]
      return idOf(type, raw.data) === oid ? { type, data: raw.data } : undefined
    } catch (error) {
      if (error instanceof Malformed) return undefined
      throw error
    }
  }

  close(): void {
    this.packs.close()
  }

  /** An object loose or packed, `depth` deltas down; one that is in neither place gives up. */
  private raw(oid: string, depth: number): RawObject {
    const loose = this.loose(oid)
    if (loose !== undefined) return loose
    const packed = this.packs.find(oid, depth, (base, deeper) =>
      this.raw(base, deeper)
    )
    if (packed === undefined) throw new Malformed()
    return packed
  }

  /** A loose object, `<kind> <size>\0<bytes>` deflated, or undefined when there is none. */
  private loose(oid: string): RawObject | undefined {
    const read = readBounded(
      join(this.objects, oid.slice(0, 2), oid.slice(2)),
      OBJECT_BYTES + (OBJECT_BYTES >>> 10) + 128
    )
    if (read === "missing") return undefined
    if (read === "unreadable") throw new Malformed()
    const whole = inflateLoose(read)
    const nul = whole.indexOf(0)
    const header = /^(commit|tree|blob|tag) (0|[1-9][0-9]{0,8})$/.exec(
      whole.toString("latin1", 0, Math.max(nul, 0))
    )
    if (nul < 0 || header === null) throw new Malformed()
    const size = Number(header[2])
    if (size > OBJECT_BYTES || whole.length - nul - 1 !== size)
      throw new Malformed()
    return {
      kind: NUMBERS[header[1] as ObjectType],
      data: whole.subarray(nul + 1),
    }
  }
}

/** A loose object inflated, its header and bytes together, never more than the bound and a header's length. */
function inflateLoose(compressed: Buffer): Buffer {
  try {
    return inflateSync(compressed, { maxOutputLength: OBJECT_BYTES + 32 })
  } catch {
    throw new Malformed()
  }
}

/** A commit's tree, from its first line, or undefined when it has none. */
export function commitTree(data: Buffer): string | undefined {
  return /^tree ([0-9a-f]{40})\n/.exec(data.toString("latin1", 0, 46))?.[1]
}

/** One entry of a tree: its mode (`0o040000` a tree, `0o100644`, `0o100755`, `0o120000`, `0o160000`), its name and its id. */
export type TreeEntry = {
  readonly mode: number
  readonly name: string
  readonly oid: string
}

/** The modes a tree may hold, by their top bits; a regular file's other bits say only whether it may run. */
const TREE_MODES = new Set([0o040000, 0o100000, 0o120000, 0o160000])

/** A tree's entries, or undefined when it cannot be read: `<mode> <name>\0<20 bytes>`, again and again. */
export function parseTree(data: Buffer): TreeEntry[] | undefined {
  const entries: TreeEntry[] = []
  let at = 0
  while (at < data.length) {
    const space = data.indexOf(0x20, at)
    const nul = space < 0 ? -1 : data.indexOf(0, space + 1)
    if (nul < 0 || nul + 21 > data.length) return undefined
    const written = data.toString("latin1", at, space)
    if (!/^[1-7][0-7]{4,5}$/.test(written)) return undefined
    const mode = parseInt(written, 8)
    const kind = mode & 0o170000
    if (!TREE_MODES.has(kind)) return undefined
    const name = data.toString("utf8", space + 1, nul)
    if (name === "" || name === "." || name === ".." || name.includes("/"))
      return undefined
    entries.push({
      mode: kind === 0o100000 ? (mode & 0o111 ? 0o100755 : 0o100644) : kind,
      name,
      oid: data.toString("hex", nul + 1, nul + 21),
    })
    at = nul + 21
  }
  return entries
}

/** A tree's entries by its id, or undefined when it is not a tree that can be read. */
function treeEntries(
  reader: ObjectReader,
  oid: string
): TreeEntry[] | undefined {
  const object = reader.read(oid)
  return object?.type === "tree" ? parseTree(object.data) : undefined
}

/**
 * Whether the time of the check that reads the trees has run out. It is asked
 * before each tree is read, so a `.git` made to make one reading last for
 * hours (one tree named again and again) is given up within the check's time
 * (CL4 step 2), and Ctrl-C is not held for longer.
 */
export type Expired = () => boolean

/**
 * The tree at a path (`/` between folders, "" for the top) under a tree: its
 * id, null when nothing is there or what is there is not a tree, undefined
 * when the reader gives up or the time runs out.
 */
export function subtreeOf(
  reader: ObjectReader,
  tree: string,
  path: string,
  expired: Expired = () => false
): string | null | undefined {
  let here = tree
  for (const part of path === "" ? [] : path.split("/")) {
    if (expired()) return undefined
    const entries = treeEntries(reader, here)
    if (entries === undefined) return undefined
    const found = entries.find((entry) => entry.name === part)
    if (found === undefined || found.mode !== 0o040000) return null
    here = found.oid
  }
  return here
}

/**
 * Every file of a tree, by its path from it, with its mode and id (links and
 * submodules among them), or undefined when the reader gives up, the time
 * runs out, or the tree holds more than 1,000,000 of them. Every entry read
 * counts toward that bound, a name given twice too, so a tree that names one
 * file again and again cannot stay under it while being read for hours.
 */
export function filesOf(
  reader: ObjectReader,
  tree: string,
  expired: Expired = () => false
): Map<string, { mode: number; oid: string }> | undefined {
  const files = new Map<string, { mode: number; oid: string }>()
  const stack: { path: string; oid: string }[] = [{ path: "", oid: tree }]
  let counted = 0
  while (stack.length > 0) {
    const { path, oid } = stack.pop()!
    if (expired()) return undefined
    const entries = treeEntries(reader, oid)
    if (entries === undefined) return undefined
    const folders: { path: string; oid: string }[] = []
    for (const entry of entries) {
      const full = path === "" ? entry.name : `${path}/${entry.name}`
      if (entry.mode === 0o040000) folders.push({ path: full, oid: entry.oid })
      else {
        files.set(full, { mode: entry.mode, oid: entry.oid })
        counted++
      }
      if (counted + stack.length + folders.length > INDEX_ENTRIES)
        return undefined
    }
    stack.push(...folders.reverse())
  }
  return files
}

/** What HEAD stands for: a commit, or a branch with no commit yet. */
export type Head = { kind: "commit"; oid: string } | { kind: "unborn" }

/** The folders a repository keeps HEAD and its refs in. */
export type RefFolders = { readonly gitDir: string; readonly commonDir: string }

/** How many refs naming refs are followed, as git's own bound. */
const REF_STEPS = 5

/** A ref's name git takes (`check_refname_format`, under `refs/`); anything else, a path out of the repository among them, is refused. */
function validRef(name: string): boolean {
  if (!name.startsWith("refs/") || name.endsWith("/") || name.endsWith("."))
    return false
  if (
    /[\x00-\x20\x7f~^:?*[\\]/.test(name) ||
    name.includes("..") ||
    name.includes("@{")
  )
    return false
  return name
    .split("/")
    .every(
      (part) => part !== "" && !part.startsWith(".") && !part.endsWith(".lock")
    )
}

/** A worktree's own refs are in its git folder; the rest in the common folder. */
const ownRef = (name: string): boolean =>
  /^refs\/(?:worktree|bisect|rewritten)\//.test(name)

/** What a HEAD or a loose ref holds: a commit id, or `ref: <name>` to follow. */
function pointer(
  text: string,
  folders: RefFolders,
  steps: number
): Head | undefined {
  const content = text.replace(/\s+$/, "")
  if (OBJECT_ID.test(content)) return { kind: "commit", oid: content }
  const named = /^ref:\s*(\S+)$/.exec(content)
  return named === null ? undefined : resolve(named[1]!, folders, steps)
}

/** A ref by its name: its loose file, else its line in `packed-refs`; a ref in neither is a branch with no commit. */
function resolve(
  name: string,
  folders: RefFolders,
  steps: number
): Head | undefined {
  if (steps >= REF_STEPS || !validRef(name)) return undefined
  const folder = ownRef(name) ? folders.gitDir : folders.commonDir
  const loose = readBounded(join(folder, name), POINTER_BYTES)
  if (loose === "unreadable") return undefined
  if (loose !== "missing")
    return pointer(loose.toString("utf8"), folders, steps + 1)
  const packed = readBounded(
    join(folders.commonDir, "packed-refs"),
    PACKED_REFS_BYTES
  )
  if (packed === "unreadable") return undefined
  if (packed === "missing") return { kind: "unborn" }
  for (const line of packed.toString("utf8").split("\n")) {
    if (line === "" || line.startsWith("#") || /^\^[0-9a-f]{40}$/.test(line))
      continue
    const found = /^([0-9a-f]{40}) (\S+)$/.exec(line)
    if (found === null) return undefined
    if (found[2] === name) return { kind: "commit", oid: found[1]! }
  }
  return { kind: "unborn" }
}

/** What HEAD stands for, read from the git folder's `HEAD`, or undefined when the reader gives up. */
export function readHead(folders: RefFolders): Head | undefined {
  const head = readBounded(join(folders.gitDir, "HEAD"), POINTER_BYTES)
  if (typeof head === "string") return undefined
  return pointer(head.toString("utf8"), folders, 0)
}
