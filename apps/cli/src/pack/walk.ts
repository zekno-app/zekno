/**
 * Pass 1: the walk of the folder sent (specs/016-build-from-source,
 * contracts/cli.md CL2, "Entries", "The Dockerfile's name", "Names", "Pass
 * 1"; data-model.md, "The pack"; FR-013 to FR-015, FR-018).
 *
 * The folder a person deploys is hostile until they have seen what is sent.
 * So each entry is looked at with `lstat` and a link is never followed: a
 * regular file is sent with mode 0755 when its owner may run it, else 0644;
 * a folder with 0755, even when empty. A link, a FIFO, a socket or a device
 * is never sent, never opened, and is listed as left out with its kind.
 * Names are read as bytes, so a name that is not UTF-8 is found, not
 * guessed at.
 *
 * What is sent is what `docker build` would send, with the ignore file
 * applied as `pack/ignore.ts` matches it, narrowed by zekno's own rules:
 * zekno's own folder never, whatever the rules say; `.git` at any depth
 * unless `source.include` names it and the person agreed; a secret-looking
 * file (`pack/secret-looking.ts`) unless named and agreed. The Dockerfile and
 * the ignore file in use are always sent. Each entry left out is kept with
 * its rule, for B5.
 *
 * A name that is not valid UTF-8, holds a control character, or does not fit
 * the pack's form (core's `splitsAsUstar`, a folder's `/` counted) stops the
 * deploy before signing with C7, its place cleaned; only a name that would be
 * sent is held to it. A folder that cannot be listed, or a small file that
 * cannot be read for its content, is C5. Entries come out in the order of
 * core's `compareNames`.
 */
import {
  type BigIntStats,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs"
import { dirname, resolve } from "node:path"

import { compareNames, splitsAsUstar } from "@workspace/core"

import { BuildStop, type LineOf } from "../shared/build-lines"
import type {
  LeftOut,
  NamedSecret,
  NotAFile,
  SentEntry,
  SentFile,
  SentFolder,
  Walk,
  WalkOptions,
} from "./entries"
import { entersExcluded, type MatchInfo, matchPath } from "./ignore"
import { namedIn, secretLookingFile } from "./secret-looking"
import { seenOf } from "./spool"

/** The types of what pass 1 finds live in entries.ts, and are given on from here, where their readers take them. */
export type {
  LeftOut,
  NamedSecret,
  NotAFile,
  SentEntry,
  SentFile,
  SentFolder,
  Walk,
  WalkOptions,
} from "./entries"

/**
 * How `.git`'s rule stands in a part of the walk: not inside one (`none`);
 * inside one the person agreed to send (`agreed`); inside one walked only
 * toward the paths under it `source.include` names (`partial`).
 */
type GitScope = "none" | "agreed" | "partial"

const STRICT = new TextDecoder("utf-8", { fatal: true })
const LOSSY = new TextDecoder("utf-8")
const SLASH = Buffer.from("/")

/**
 * A name as a person may be shown it (C7, B5): a byte that is not UTF-8, a
 * control character, and what drawing would hide (`holdsHidden` in
 * server/sanitize.ts: format characters such as a right-to-left override, line
 * and paragraph separators, characters drawn as nothing), as `?`.
 */
const cleaned = (text: string): string =>
  text.replace(
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\uFFFD]|\p{Default_Ignorable_Code_Point}/gu,
    "?"
  )

/** What a stop names a place by: the root itself as `.`. */
const placeOf = (path: string): string => (path === "" ? "." : path)

function notAFileKind(stats: BigIntStats): NotAFile {
  if (stats.isFIFO()) return "fifo"
  if (stats.isSocket()) return "socket"
  if (stats.isBlockDevice() || stats.isCharacterDevice()) return "device"
  return "other"
}

/** The device and inode of zekno's own folder, through any link to it, or undefined when it is not there. */
function identityOf(path: string): { dev: bigint; ino: bigint } | undefined {
  try {
    const stats = statSync(path, { bigint: true })
    return stats.isDirectory() ? { dev: stats.dev, ino: stats.ino } : undefined
  } catch {
    return undefined
  }
}

/** One entry of a folder, as `lstat` saw it. */
type Child = {
  readonly bytes: Buffer
  /** Its name, decoded; a name that is not UTF-8 decoded with replacements. */
  readonly text: string
  readonly utf8: boolean
  readonly abs: Buffer
  readonly stats: BigIntStats
}

/**
 * The walk of the folder sent (CL2, pass 1). `root` is resolved to its real
 * path first; nothing under it is followed. Throws C5 for a folder that
 * cannot be listed or a small file that cannot be read, C6 for one that
 * changed while it was read, and C7 for a name that would be sent and cannot
 * be.
 */
export function walkFolder(root: string, options: WalkOptions): Walk {
  let real: string
  try {
    real = realpathSync(root)
  } catch {
    throw new BuildStop({ id: "C5", path: "." })
  }
  const always = [options.dockerfile, options.ignore.file].filter(
    (path): path is string => path !== null
  )
  const home = identityOf(options.zeknoHome)
  const entries: SentEntry[] = []
  const leftOut: LeftOut[] = []
  const secretsSent: NamedSecret[] = []
  const unagreed: NamedSecret[] = []
  // Folders left out by the ignore file or `.git`'s rule but walked, sent only once something under them is.
  const pending: { folder: SentFolder; child: Child; sent: boolean }[] = []

  /** Sends an entry, its pending folders first, each name held to CL2's rule. */
  const send = (entry: SentEntry, child: Child) => {
    for (const waiting of pending)
      if (!waiting.sent) {
        nameRule(waiting.folder.name, waiting.child)
        entries.push(waiting.folder)
        waiting.sent = true
      }
    nameRule(entry.name, child)
    entries.push(entry)
  }

  /** Whether a path is inside the folder sent. */
  const inside = (path: string) => path === real || path.startsWith(`${real}/`)

  /** Whether a link leads out of the folder sent: where it resolves to, or, left dangling, where it points. */
  const leadsOut = (abs: Buffer): boolean => {
    try {
      return !inside(realpathSync(abs.toString()))
    } catch {
      try {
        const target = readlinkSync(abs)
        return !inside(resolve(dirname(abs.toString()), target))
      } catch {
        return true
      }
    }
  }

  const visit = (
    abs: Buffer,
    path: string,
    info: MatchInfo | undefined,
    git: GitScope
  ): void => {
    let listed: Buffer[]
    try {
      listed = readdirSync(abs, { encoding: "buffer" })
    } catch {
      throw new BuildStop({ id: "C5", path: placeOf(cleaned(path)) })
    }
    const children: (Child & { key: Buffer })[] = []
    for (const bytes of listed) {
      const childAbs = Buffer.concat([abs, SLASH, bytes])
      let text: string
      let utf8 = true
      try {
        text = STRICT.decode(bytes)
      } catch {
        text = LOSSY.decode(bytes)
        utf8 = false
      }
      let stats: BigIntStats
      try {
        stats = lstatSync(childAbs, { bigint: true })
      } catch (error) {
        // Gone since the folder was listed: nothing to send. Anything else (EACCES, EIO) is there and unseen: C5.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
        const child = path === "" ? text : `${path}/${text}`
        throw new BuildStop({ id: "C5", path: cleaned(child) })
      }
      // A folder's name as packed ends with `/`, so siblings sort as the pack's names do.
      const key = stats.isDirectory() ? Buffer.concat([bytes, SLASH]) : bytes
      children.push({ bytes, text, utf8, abs: childAbs, stats, key })
    }
    children.sort((a, b) => Buffer.compare(a.key, b.key))
    for (const child of children)
      entry(
        child,
        path === "" ? child.text : `${path}/${child.text}`,
        info,
        git
      )
  }

  const entry = (
    child: Child,
    path: string,
    info: MatchInfo | undefined,
    git: GitScope
  ): void => {
    const { stats } = child
    const shown = cleaned(path)
    const folder = stats.isDirectory()
    if (
      folder &&
      home !== undefined &&
      stats.dev === home.dev &&
      stats.ino === home.ino
    ) {
      leftOut.push({ rule: "zekno", path: shown, why: "zekno_home" })
      return
    }
    const isAlways = always.includes(path)
    const towardAlways =
      folder && always.some((each) => each.startsWith(`${path}/`))
    const match = matchPath(options.ignore, path, info)
    const excluded = match.excluded && !isAlways
    if (
      excluded &&
      !(folder && (towardAlways || entersExcluded(options.ignore, path)))
    ) {
      leftOut.push({ rule: "ignore_file", path: shown, folder })
      return
    }
    if (stats.isSymbolicLink()) {
      leftOut.push({ rule: "link", path: shown, out: leadsOut(child.abs) })
      return
    }
    if (!folder && !stats.isFile()) {
      leftOut.push({
        rule: "not_a_file",
        path: shown,
        kind: notAFileKind(stats),
      })
      return
    }

    let scope = git
    // A folder the ignore file leaves out is walked for what comes back, and sent only with it.
    let held = excluded
    if (git !== "agreed") {
      const inGit = git !== "none" || path.split("/").at(-1) === ".git"
      if (inGit) {
        const named = options.include.find((each) => each === path)
        const toward = options.include.some((each) =>
          each.startsWith(`${path}/`)
        )
        if (named !== undefined) {
          if (!options.agreed(named)) {
            leftOut.push({
              rule: "secret_looking",
              path: shown,
              kind: "git",
              named,
            })
            if (sendable(folder ? `${path}/` : path, child))
              unagreed.push({ path, kind: "git", named })
            return
          }
          secretsSent.push({ path, kind: "git", named })
          scope = "agreed"
        } else if (folder && toward) {
          scope = "partial"
          held = true
        } else {
          leftOut.push({ rule: "zekno", path: shown, why: "git" })
          return
        }
      }
    }

    if (folder) {
      const sent: SentFolder = {
        name: `${path}/`,
        kind: "folder",
        mode: 0o755,
        size: 0,
      }
      if (held) {
        pending.push({ folder: sent, child, sent: false })
        visit(child.abs, path, match.info, scope)
        pending.pop()
      } else {
        send(sent, child)
        visit(child.abs, path, match.info, scope)
      }
      return
    }

    const file: SentFile = {
      name: path,
      kind: "file",
      mode: (stats.mode & 0o100n) !== 0n ? 0o755 : 0o644,
      size: Number(stats.size),
      path: child.abs.toString(),
      seen: seenOf(stats),
    }
    if (scope !== "agreed" && !isAlways) {
      // Only a name that could be sent is read for its content: one that is not UTF-8 stops below.
      // The folders above the folder sent count for the list's folder rules: a root that is `.ssh` sends none of its files.
      const kind = child.utf8
        ? secretLookingFile(file.path, path, file.seen, real)
        : undefined
      if (kind !== undefined) {
        const named = namedIn(path, options.include)
        if (named === undefined) {
          leftOut.push({
            rule: "secret_looking",
            path: shown,
            kind,
            named: null,
          })
          return
        }
        if (!options.agreed(path)) {
          leftOut.push({ rule: "secret_looking", path: shown, kind, named })
          if (sendable(path, child)) unagreed.push({ path, kind, named })
          return
        }
        secretsSent.push({ path, kind, named })
      }
    }
    send(file, child)
  }

  /** CL2's rule for a name that is sent: valid UTF-8, no control character, one the pack's form holds. */
  const nameRule = (name: string, child: Child) => {
    const path = name.endsWith("/") ? name.slice(0, -1) : name
    const stop = (why: LineOf<"C7">["why"]) =>
      new BuildStop({ id: "C7", path: cleaned(path), why })
    if (!child.utf8) throw stop("not_utf8")
    if (/\p{Cc}/u.test(name)) throw stop("control_character")
    if (!splitsAsUstar(name)) throw stop("too_long")
  }

  /** Whether a name passes CL2's rule. One that does not is never asked about (B26, C19): agreeing would only stop with C7. */
  const sendable = (name: string, child: Child): boolean => {
    try {
      nameRule(name, child)
      return true
    } catch {
      return false
    }
  }

  let rootStats: BigIntStats
  try {
    rootStats = lstatSync(real, { bigint: true })
  } catch {
    throw new BuildStop({ id: "C5", path: "." })
  }
  if (!rootStats.isDirectory()) throw new BuildStop({ id: "C5", path: "." })
  visit(Buffer.from(real), "", undefined, "none")
  // The walk's order is the pack's already; sorting by core's rule keeps it so whatever a file system lists.
  entries.sort((a, b) => compareNames(a.name, b.name))
  const dockerfileSent =
    options.dockerfile !== null &&
    entries.some(
      (each) => each.kind === "file" && each.name === options.dockerfile
    )
  return {
    root: real,
    entries,
    leftOut,
    secretsSent,
    unagreed,
    ignoreFile: options.ignore.file,
    dockerfileSent,
    dockerfile: options.dockerfile,
  }
}

/**
 * C20 when `build.dockerfile` was not found under exactly its name as a
 * regular file the pack holds (CL2, "The Dockerfile's name"): on a system
 * that ignores case a file `dockerfile` does not stand for `Dockerfile`, and
 * the runner refuses a pack without the exact entry (RB4).
 */
export function requireDockerfile(
  found: Walk,
  at: Omit<LineOf<"C20">, "id" | "dockerfile">
): void {
  if (found.dockerfile !== null && !found.dockerfileSent)
    throw new BuildStop({ id: "C20", ...at, dockerfile: found.dockerfile })
}
