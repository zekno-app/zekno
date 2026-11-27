/**
 * Whether the folder sent has changes not committed (specs/016-build-from-source,
 * contracts/cli.md CL4 steps 3 and 4; FR-017a), read from the repository's
 * files with no `git` run and no program the repository names (plan.md item
 * 9 (a)): the line B13, or nothing.
 *
 * Step 3, in two parts:
 *
 * - each file pass 2 sends against the index, as `git status` compares them:
 *   no stage-0 entry, or one marked intent-to-add, is a change; a file where
 *   the index has a link or a submodule is one; the executable bit is one when
 *   `core.fileMode` holds; the size, times and git's racy rule decide whether
 *   the stat can be trusted; else the blob id of the very bytes pass 2 read,
 *   `Bun.CryptoHasher("sha1")` over `blob <size>\0` and those bytes, taken
 *   through pass 2's per-file hook (`pack/spool.ts`, `FileHook`). An entry git
 *   does not look at (assume-unchanged, skip-worktree) is not looked at;
 * - the index against HEAD's tree under the folder sent: the `TREE`
 *   extension where it is valid there, else HEAD's subtree read from its
 *   objects (`git/objects.ts`); a branch with no commit makes every entry new.
 *
 * Step 4: any difference gives B13 once. Anything zekno cannot follow
 * (`git/find.ts`, `config.ts`, `index-file.ts` and `objects.ts` give up), and
 * a check past 2 seconds of its own work in all, leaves the line out. It
 * never stops the deploy: nothing here throws into pass 2, and it only reads
 * the bytes it is handed, so it never changes what is sent.
 *
 * Not seen (CL4): files of the index under the folder that pass 2 does not
 * send, deleted ones among them; changes inside a submodule. Files under a
 * `.git` and under a submodule's folder are not compared: git keeps neither.
 */
import { lstatSync, realpathSync, statSync } from "node:fs"
import { isAbsolute, join, relative, sep } from "node:path"

import type { LineOf } from "../shared/build-lines"
import { readConfig } from "./config"
import { findGit } from "./find"
import { type CacheTree, type IndexEntry, readIndex } from "./index-file"
import {
  commitTree,
  type Expired,
  filesOf,
  ObjectReader,
  readHead,
  subtreeOf,
} from "./objects"

/** The most time the check may spend, in milliseconds (CL4 step 2). */
export const CHANGES_MS = 2000

/** Pass 2's per-file hook, as `pack/spool.ts` calls it: a file's name as packed and its size, its bytes in order, its end. */
export interface ChangesHook {
  begin(name: string, size: number): void
  data(bytes: Uint8Array): void
  end(): void
}

/** The uncommitted-changes check of one folder sent. */
export interface ChangesCheck {
  /** Given to pass 2, which hands it each file it reads. */
  readonly hook: ChangesHook
  /** Once pass 2 read every file: B13, or null when nothing changed or zekno could not tell. */
  finish(): LineOf<"B13"> | null
}

export type ChangesOptions = {
  /** The clock, in milliseconds: a test's own, else `performance.now`. */
  readonly now?: () => number
}

/** A nanosecond time as the index keeps it: seconds cut to 32 bits, and nanoseconds. */
function indexTime(ns: bigint): { seconds: number; nanoseconds: number } {
  return {
    seconds: Number((ns / 1_000_000_000n) & 0xffffffffn),
    nanoseconds: Number(ns % 1_000_000_000n),
  }
}

const sameTime = (
  a: { seconds: number; nanoseconds: number },
  b: { seconds: number; nanoseconds: number }
) => a.seconds === b.seconds && a.nanoseconds === b.nanoseconds

/** Whether `later` is at or after `time`. */
const atOrAfter = (
  later: { seconds: number; nanoseconds: number },
  time: { seconds: number; nanoseconds: number }
) =>
  later.seconds > time.seconds ||
  (later.seconds === time.seconds && later.nanoseconds >= time.nanoseconds)

/** What the check knows of the repository, once it found and read it. */
type Repository = {
  gitDir: string
  commonDir: string
  /** The folder sent, from the top of the work tree, `/` between its parts; "" at the top. */
  prefix: string
  fileMode: boolean
  entries: readonly IndexEntry[]
  tree: CacheTree | null
  /** Each stage-0 entry by its path. */
  staged: Map<string, IndexEntry>
  /** Paths of submodules: the files under them are another repository's. */
  submodules: string[]
  /** When the index was written: an entry changed at or after it is racy. */
  written: { seconds: number; nanoseconds: number } | null
}

/** The repository of a folder sent, or undefined when the reader gives up. */
function repositoryOf(root: string): Repository | undefined {
  const place = findGit(root)
  if (place === undefined) return undefined
  const config = readConfig(place.commonDir)
  const index = config === undefined ? undefined : readIndex(place.gitDir)
  if (config === undefined || index === undefined) return undefined
  const path = relative(place.top, realpathSync(root))
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path))
    return undefined
  const staged = new Map<string, IndexEntry>()
  const submodules: string[] = []
  for (const entry of index.entries) {
    if (entry.stage !== 0) continue
    staged.set(entry.path, entry)
    if (entry.mode === 0o160000) submodules.push(`${entry.path}/`)
  }
  let written = null
  try {
    written = indexTime(
      statSync(join(place.gitDir, "index"), { bigint: true }).mtimeNs
    )
  } catch {
    // No index file: no entry, so none is racy.
  }
  return {
    gitDir: place.gitDir,
    commonDir: place.commonDir,
    prefix: path.split(sep).join("/"),
    fileMode: config.fileMode,
    entries: index.entries,
    tree: index.tree,
    staged,
    submodules,
    written,
  }
}

/** What one file sent is to the check: changed, unchanged, or to be hashed against its entry's id. */
type FileState = "changed" | "same" | { oid: string; hasher: Bun.CryptoHasher }

/** One file pass 2 sends against its index entry (CL4 step 3). */
function compareFile(
  repo: Repository,
  root: string,
  name: string,
  size: number
): FileState {
  const path = repo.prefix === "" ? name : `${repo.prefix}/${name}`
  if (
    path.split("/").includes(".git") ||
    repo.submodules.some((folder) => path.startsWith(folder))
  )
    return "same"
  const entry = repo.staged.get(path)
  if (entry === undefined || entry.intentToAdd) return "changed"
  if (entry.assumeUnchanged || entry.skipWorktree) return "same"
  if (entry.mode !== 0o100644 && entry.mode !== 0o100755) return "changed"
  const stat = lstatSync(join(root, name), { bigint: true })
  const runs = (stat.mode & 0o100n) !== 0n
  if (repo.fileMode && runs !== (entry.mode === 0o100755)) return "changed"
  const mtime = indexTime(stat.mtimeNs)
  const racy = repo.written !== null && atOrAfter(entry.mtime, repo.written)
  if (
    entry.size === Number(stat.size & 0xffffffffn) &&
    entry.size === size >>> 0 &&
    sameTime(entry.mtime, mtime) &&
    sameTime(entry.ctime, indexTime(stat.ctimeNs)) &&
    !racy
  )
    return "same"
  // A size the index does not hold is a change, but for a size of 0, which git writes for a racy entry it smudged.
  if (entry.size !== 0 && entry.size !== size >>> 0) return "changed"
  return {
    oid: entry.oid,
    hasher: new Bun.CryptoHasher("sha1").update(`blob ${size}\0`),
  }
}

/** The tree of the `TREE` extension at a path, when it is valid there. */
function validTreeAt(tree: CacheTree | null, path: string): string | null {
  let node = tree
  while (node !== null) {
    if (node.path === path) return node.entryCount >= 0 ? node.oid : null
    node =
      node.subtrees.find(
        (sub) => path === sub.path || path.startsWith(`${sub.path}/`)
      ) ?? null
  }
  return null
}

/**
 * The index against HEAD's tree under the folder sent (CL4 step 3): true
 * when they differ, false when they do not, undefined when the reader gives
 * up or the check's time runs out while the trees are read (`expired`).
 */
function stagedChanges(
  repo: Repository,
  expired: Expired
): boolean | undefined {
  const under = repo.entries.filter(
    (entry) => repo.prefix === "" || entry.path.startsWith(`${repo.prefix}/`)
  )
  if (under.some((entry) => entry.stage !== 0)) return true
  const head = readHead({ gitDir: repo.gitDir, commonDir: repo.commonDir })
  if (head === undefined) return undefined
  if (head.kind === "unborn") return under.length > 0
  const reader = new ObjectReader(repo.commonDir)
  try {
    const commit = reader.read(head.oid)
    const tree = commit?.type === "commit" ? commitTree(commit.data) : undefined
    if (tree === undefined) return undefined
    const subtree = subtreeOf(reader, tree, repo.prefix, expired)
    if (subtree === undefined) return undefined
    if (subtree === null) return under.length > 0
    const cached = validTreeAt(repo.tree, repo.prefix)
    if (cached !== null) return cached !== subtree
    const files = filesOf(reader, subtree, expired)
    if (files === undefined) return undefined
    if (files.size !== under.length) return true
    const cut = repo.prefix === "" ? 0 : repo.prefix.length + 1
    return under.some((entry) => {
      const file = files.get(entry.path.slice(cut))
      return file?.mode !== entry.mode || file.oid !== entry.oid
    })
  } finally {
    reader.close()
  }
}

/**
 * Starts the check of the folder sent, `root`. Pass 2 is given `hook`; once
 * it read every file, `finish` gives B13 or nothing.
 */
export function checkChanges(
  root: string,
  options: ChangesOptions = {}
): ChangesCheck {
  const now = options.now ?? (() => performance.now())
  let spent = 0
  let result: "open" | "changed" | "gave_up" = "open"
  let repo: Repository | undefined
  let file: FileState = "same"
  let received = 0
  let size = 0

  /**
   * Runs a step of the check, counting its time; a fault or the time running
   * out gives up. A step that reads HEAD's trees is handed `expired`, and
   * stops as soon as the time is past, not once it is done.
   */
  const step = (work: (expired: Expired) => void) => {
    if (result !== "open") return
    const started = now()
    const expired = () => spent + (now() - started) > CHANGES_MS
    try {
      work(expired)
    } catch {
      result = "gave_up"
    }
    spent += now() - started
    // Past the time, what the step found is dropped too: the check gave up.
    if (spent > CHANGES_MS) result = "gave_up"
  }

  step(() => {
    repo = repositoryOf(root)
    if (repo === undefined) result = "gave_up"
  })

  return {
    hook: {
      begin(name, length) {
        file = "same"
        received = 0
        size = length
        step(() => {
          file = compareFile(repo!, root, name, length)
          if (file === "changed") result = "changed"
        })
      },
      data(bytes) {
        if (typeof file !== "object") return
        const { hasher } = file
        step(() => {
          hasher.update(bytes)
          received += bytes.length
        })
      },
      end() {
        if (typeof file !== "object") return
        const { hasher, oid } = file
        file = "same"
        step(() => {
          if (received !== size || hasher.digest("hex") !== oid)
            result = "changed"
        })
      },
    },
    finish() {
      step((expired) => {
        const staged = stagedChanges(repo!, expired)
        if (staged === undefined) result = "gave_up"
        else if (staged) result = "changed"
      })
      return result === "changed" ? { id: "B13" } : null
    },
  }
}
