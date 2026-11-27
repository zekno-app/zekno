/**
 * Repositories with a work tree, written by the uncommitted-changes tests
 * with no `git` run (specs/016-build-from-source, tasks T122): files on disk,
 * a commit of them in loose objects, and an index whose entries carry the
 * files' own stat, as `git add` writes them, with the `TREE` extension when
 * asked. Pass 2 is stood in for by `packOf`, which hands each file to a hook
 * as `pack/spool.ts` does and gives the pack's fingerprint.
 */
import { createTarWriter, compareNames, hashStream } from "@workspace/core"
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
  type BigIntStats,
} from "node:fs"
import { dirname, join } from "node:path"

import { gitFolder, objectId, writeLoose } from "./repository"

/** A file of the work tree: its text, and whether its owner may run it; or a submodule, by its commit. */
export type FileSpec = { content: string; runs?: boolean } | { gitlink: string }
export type Files = Record<string, string | FileSpec>

const specOf = (file: string | FileSpec): FileSpec =>
  typeof file === "string" ? { content: file } : file

/** A time well before any index a test writes, so no entry is racy unless a test makes it so. */
export const PAST = new Date("2023-01-02T03:04:05.678Z")

/** Files written under `top`, each with its mode and the time `PAST`; a submodule is a folder. */
export function writeWorktree(top: string, files: Files): void {
  for (const [path, file] of Object.entries(files)) {
    const spec = specOf(file)
    const full = join(top, path)
    if ("gitlink" in spec) {
      mkdirSync(full, { recursive: true })
      continue
    }
    const { content, runs } = spec
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content, { mode: runs === true ? 0o755 : 0o644 })
    utimesSync(full, PAST, PAST)
  }
}

/** A tree object of entries: git's order, a folder's name compared with a `/` after it. */
function treeObject(
  entries: { name: string; mode: string; oid: string }[]
): Buffer {
  const key = (entry: { name: string; mode: string }) =>
    entry.mode === "40000" ? `${entry.name}/` : entry.name
  const sorted = [...entries].sort((a, b) =>
    Buffer.compare(Buffer.from(key(a)), Buffer.from(key(b)))
  )
  return Buffer.concat(
    sorted.flatMap((entry) => [
      Buffer.from(`${entry.mode} ${entry.name}\0`),
      Buffer.from(entry.oid, "hex"),
    ])
  )
}

/** The trees of a set of files, written loose: each folder's id by its path, "" for the top. */
export function writeTrees(git: string, files: Files): Map<string, string> {
  const trees = new Map<string, string>()
  const write = (folder: string): string => {
    const prefix = folder === "" ? "" : `${folder}/`
    const entries: { name: string; mode: string; oid: string }[] = []
    const folders = new Set<string>()
    for (const [path, file] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      const slash = rest.indexOf("/")
      if (slash >= 0) {
        folders.add(rest.slice(0, slash))
        continue
      }
      const spec = specOf(file)
      entries.push(
        "gitlink" in spec
          ? { name: rest, mode: "160000", oid: spec.gitlink }
          : {
              name: rest,
              mode: spec.runs === true ? "100755" : "100644",
              oid: writeLoose(git, "blob", Buffer.from(spec.content)),
            }
      )
    }
    for (const name of folders)
      entries.push({ name, mode: "40000", oid: write(`${prefix}${name}`) })
    const oid = writeLoose(git, "tree", treeObject(entries))
    trees.set(folder, oid)
    return oid
  }
  write("")
  return trees
}

/**
 * A repository at `top` whose HEAD is branch `main`: `committed` as its one
 * commit (none: a branch with no commit), and a config; `.git` returned.
 */
export function writeRepository(
  top: string,
  committed: Files | null,
  config = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n"
): { git: string; trees: Map<string, string> } {
  const git = gitFolder(top)
  writeFileSync(join(git, "HEAD"), "ref: refs/heads/main\n")
  writeFileSync(join(git, "config"), config)
  if (committed === null) return { git, trees: new Map() }
  const trees = writeTrees(git, committed)
  const commit = writeLoose(
    git,
    "commit",
    Buffer.from(
      `tree ${trees.get("")}\nauthor A <a@example.com> 0 +0000\ncommitter A <a@example.com> 0 +0000\n\nfirst\n`
    )
  )
  writeFileSync(join(git, "refs", "heads", "main"), `${commit}\n`)
  return { git, trees }
}

/** One entry of the index: a path, and what it holds (a submodule by its commit); its stat is the file's on disk, when there is one. */
export type Staged = {
  path: string
  content: string
  runs?: boolean
  intentToAdd?: boolean
  gitlink?: string
}

/** The stat fields of an entry as git writes them, from the file's own stat. */
function statFields(stat: BigIntStats | undefined, size: number): Buffer {
  const fields = Buffer.alloc(40)
  if (stat === undefined) {
    fields.writeUInt32BE(size, 36)
    return fields
  }
  const cut = (value: bigint) => Number(value & 0xffffffffn)
  const time = (ns: bigint, at: number) => {
    fields.writeUInt32BE(cut(ns / 1_000_000_000n), at)
    fields.writeUInt32BE(Number(ns % 1_000_000_000n), at + 4)
  }
  time(stat.ctimeNs, 0)
  time(stat.mtimeNs, 8)
  fields.writeUInt32BE(cut(stat.dev), 16)
  fields.writeUInt32BE(cut(stat.ino), 20)
  fields.writeUInt32BE(cut(stat.uid), 28)
  fields.writeUInt32BE(cut(stat.gid), 32)
  fields.writeUInt32BE(cut(stat.size), 36)
  return fields
}

/**
 * An index of version 3 holding `staged` (sorted by path), each entry's stat
 * read from `top` as `git add` would record it, and, with `trees`, a `TREE`
 * extension whose every folder has the id given there (-1 entries: not
 * valid). The trailing checksum is SHA-1 of the rest.
 */
export function writeStatIndex(
  top: string,
  git: string,
  staged: Staged[],
  trees?: Map<string, string | null>
): void {
  const sorted = [...staged].sort((a, b) =>
    Buffer.compare(Buffer.from(a.path), Buffer.from(b.path))
  )
  const header = Buffer.alloc(12)
  header.write("DIRC", 0)
  header.writeUInt32BE(3, 4)
  header.writeUInt32BE(sorted.length, 8)
  const parts: Buffer[] = [header]
  for (const entry of sorted) {
    const content = Buffer.from(entry.content)
    let stat: BigIntStats | undefined
    try {
      if (entry.gitlink === undefined)
        stat = lstatSync(join(top, entry.path), { bigint: true })
    } catch {
      stat = undefined
    }
    const fields = statFields(stat, content.length)
    const mode =
      entry.gitlink !== undefined
        ? 0o160000
        : entry.runs === true
          ? 0o100755
          : 0o100644
    fields.writeUInt32BE(mode, 24)
    fields.writeUInt32BE(content.length, 36)
    const name = Buffer.from(entry.path)
    const extended = entry.intentToAdd === true
    const flags = Buffer.alloc(extended ? 4 : 2)
    flags.writeUInt16BE((extended ? 0x4000 : 0) | name.length, 0)
    if (extended) flags.writeUInt16BE(0x2000, 2)
    const fixed = 40 + 20 + flags.length
    const length = (fixed + name.length + 8) & ~7
    parts.push(
      fields,
      Buffer.from(entry.gitlink ?? objectId("blob", content), "hex"),
      flags,
      name,
      Buffer.alloc(length - fixed - name.length)
    )
  }
  if (trees !== undefined) {
    const data = cacheTree(
      "",
      sorted.map((entry) => entry.path),
      trees
    )
    const head = Buffer.alloc(8)
    head.write("TREE", 0)
    head.writeUInt32BE(data.length, 4)
    parts.push(head, data)
  }
  const body = Buffer.concat(parts)
  writeFileSync(
    join(git, "index"),
    Buffer.concat([
      body,
      Buffer.from(new Bun.CryptoHasher("sha1").update(body).digest()),
    ])
  )
}

/** The `TREE` extension's bytes for the folder `folder` of the paths given, and each folder under it. */
function cacheTree(
  folder: string,
  paths: string[],
  trees: Map<string, string | null>
): Buffer {
  const prefix = folder === "" ? "" : `${folder}/`
  const under = paths.filter((path) => path.startsWith(prefix))
  const children = [
    ...new Set(
      under
        .map((path) => path.slice(prefix.length))
        .filter((rest) => rest.includes("/"))
        .map((rest) => rest.slice(0, rest.indexOf("/")))
    ),
  ].sort()
  const oid = trees.get(folder) ?? null
  const name = folder === "" ? "" : folder.slice(folder.lastIndexOf("/") + 1)
  return Buffer.concat([
    Buffer.from(
      `${name}\0${oid === null ? -1 : under.length} ${children.length}\n`
    ),
    oid === null ? Buffer.alloc(0) : Buffer.from(oid, "hex"),
    ...children.map((child) => cacheTree(`${prefix}${child}`, paths, trees)),
  ])
}

/** Pass 2's per-file hook, as `pack/spool.ts` calls it. */
export type Hook = {
  begin(name: string, size: number): void
  data(bytes: Uint8Array): void
  end(): void
}

/**
 * The fingerprint of the pack of every file and folder under `root` but
 * `.git`, as pass 2 makes it: core's tar writer and pack hash, each file's
 * bytes handed to `hook` in pieces of 5 bytes, as a view of a buffer used
 * again, as pass 2's reads hand them.
 */
export function packOf(root: string, hook?: Hook): string {
  const names: { name: string; full: string; folder: boolean }[] = []
  const walk = (folder: string, prefix: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === ".git") continue
      const full = join(folder, entry.name)
      if (entry.isDirectory()) {
        names.push({ name: `${prefix}${entry.name}/`, full, folder: true })
        walk(full, `${prefix}${entry.name}/`)
      } else names.push({ name: `${prefix}${entry.name}`, full, folder: false })
    }
  }
  walk(root, "")
  names.sort((a, b) => compareNames(a.name, b.name))
  const writer = createTarWriter()
  const hash = hashStream("zekno/v1/pack")
  const scratch = new Uint8Array(5)
  for (const { name, full, folder } of names) {
    if (folder) {
      hash.update(writer.begin({ name, kind: "folder", mode: 0o755, size: 0 }))
      hash.update(writer.finish())
      continue
    }
    const bytes = readFileSync(full)
    const mode = lstatSync(full).mode & 0o100 ? 0o755 : 0o644
    hash.update(writer.begin({ name, kind: "file", mode, size: bytes.length }))
    hook?.begin(name, bytes.length)
    for (let at = 0; at < bytes.length; at += scratch.length) {
      const piece = bytes.subarray(at, at + scratch.length)
      scratch.set(piece)
      hash.update(writer.data(piece))
      hook?.data(scratch.subarray(0, piece.length))
      scratch.fill(0)
    }
    hook?.end()
    hash.update(writer.finish())
  }
  hash.update(writer.end())
  return Buffer.from(hash.digest()).toString("hex")
}
