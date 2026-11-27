/**
 * Pass 2's reading: each file of the folder sent read once, never through a
 * link, and streamed into core's tar writer (specs/016-build-from-source,
 * contracts/cli.md CL2, "Pass 2"; data-model.md, "The pack"; FR-016,
 * FR-019, FR-020).
 *
 * A file is opened with `O_NOFOLLOW` and `O_NONBLOCK`, so neither a link nor
 * a pipe put in its place is read; held to a regular file; and compared with
 * what pass 1 saw (`pack/walk.ts`) before the read and after it: the same
 * file (device and inode), the same size, time and change time. A difference is
 * C6, a fault of the read C5, each a stop before signing. Never more than
 * the size pass 1 saw is given on, so what is packed is exactly what was
 * counted. The bytes are held only in memory: no plain copy of the code is
 * ever written (FR-020); `pack/chunks.ts` seals them.
 */
import {
  type BigIntStats,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs"

import { createTarWriter } from "@workspace/core"

import { BuildStop } from "../shared/build-lines"
import type { SentEntry } from "./walk"

/**
 * What pass 1 saw of a file, which pass 2 compares (CL2): which file it is,
 * its size and its time, and its change time, which no one can set back
 * (`utimes` sets only the others), so a file written over in place with its
 * size kept and its time put back is still C6.
 */
export type Seen = {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
  readonly ctimeNs: bigint
}

/** What pass 2 compares of a file's `lstat` or `fstat`. */
export const seenOf = (stats: BigIntStats): Seen => ({
  dev: stats.dev,
  ino: stats.ino,
  size: stats.size,
  mtimeNs: stats.mtimeNs,
  ctimeNs: stats.ctimeNs,
})

/** The most read at once: a file passes through in pieces of this size, never held whole. */
export const READ_BYTES = 1024 * 1024

/** Whether two looks at a file saw the same file, size, time and change time. */
const same = (a: Seen, b: Seen): boolean =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs

/** Whether an error says the path is not there any more, or is no longer what it was (a link, which `O_NOFOLLOW` refuses). */
const gone = (error: unknown): boolean =>
  ["ENOENT", "ENOTDIR", "ELOOP", "EMLINK", "EFTYPE"].includes(
    (error as NodeJS.ErrnoException).code ?? ""
  )

/**
 * Reads the file at `path` once, giving its bytes in order to `take`, each
 * piece a view valid only during the call. `name` is its path in the folder
 * sent, which a stop names; `seen` is what pass 1 saw of it. A file that is
 * no longer that regular file with that size and time, before, during or
 * after the read, is C6; one that cannot be opened or read is C5 (CL2,
 * FR-019). At most the size pass 1 saw is given.
 */
export function readOnce(
  path: string,
  name: string,
  seen: Seen,
  take: (bytes: Uint8Array) => void
): void {
  const changed = () => new BuildStop({ id: "C6", path: name })
  const unreadable = () => new BuildStop({ id: "C5", path: name })
  let before: BigIntStats
  try {
    before = lstatSync(path, { bigint: true })
  } catch (error) {
    throw gone(error) ? changed() : unreadable()
  }
  if (!before.isFile() || !same(seenOf(before), seen)) throw changed()
  let fd: number
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
  } catch (error) {
    throw gone(error) ? changed() : unreadable()
  }
  try {
    const opened = fstatSync(fd, { bigint: true })
    if (!opened.isFile() || !same(seenOf(opened), seen)) throw changed()
    const size = Number(seen.size)
    // A plain Uint8Array, not a Buffer: a taker's `slice` then copies, where Buffer's gives a view of bytes read over next.
    const buffer = new Uint8Array(Math.max(1, Math.min(size, READ_BYTES)))
    let total = 0
    for (;;) {
      // One byte more than the size is asked for at the end, to find a file that grew.
      const want = Math.min(buffer.length, Math.max(size - total, 1))
      let read: number
      try {
        read = readSync(fd, buffer, 0, want, null)
      } catch {
        throw unreadable()
      }
      if (read === 0) break
      if (total + read > size) throw changed()
      take(buffer.subarray(0, read))
      total += read
    }
    if (total !== size) throw changed()
    const after = fstatSync(fd, { bigint: true })
    if (!same(seenOf(after), seen)) throw changed()
  } finally {
    closeSync(fd)
  }
}

/**
 * What sees each file as pass 2 reads it, with its name and its bytes in
 * order (CL4's blob hash attaches here, tasks T122; no git code is in this
 * folder). `data`'s bytes are a view valid only during the call.
 */
export interface FileHook {
  /** A file starts: its name as packed and its size. */
  begin(name: string, size: number): void
  /** Its next bytes. */
  data(bytes: Uint8Array): void
  /** Every byte of it was given. */
  end(): void
}

/** Bytes given on between two pauses, so a screen drawn meanwhile is not held up by a large pack. */
const PAUSE_BYTES = 8 * 1024 * 1024

/** Gives the event loop a turn. */
const pause = () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * Streams the pack of pass 1's entries through core's tar writer (CO5):
 * every byte of the tar, in order, to `write`, and each file's bytes to
 * `hook`. Each file is read once with `readOnce`. Its result is the tar's
 * size. Throws C5 or C6 for a file that cannot be read or that changed
 * since pass 1, and whatever `write` throws.
 */
export async function spoolPack(
  entries: readonly SentEntry[],
  write: (bytes: Uint8Array) => void,
  hook?: FileHook
): Promise<number> {
  const writer = createTarWriter()
  let size = 0
  let sincePause = 0
  const give = (bytes: Uint8Array) => {
    if (bytes.length === 0) return
    write(bytes)
    size += bytes.length
    sincePause += bytes.length
  }
  for (const entry of entries) {
    give(
      writer.begin({
        name: entry.name,
        kind: entry.kind,
        mode: entry.mode,
        size: entry.size,
      })
    )
    if (entry.kind === "file") {
      hook?.begin(entry.name, entry.size)
      readOnce(entry.path, entry.name, entry.seen, (bytes) => {
        give(writer.data(bytes))
        hook?.data(bytes)
      })
      hook?.end()
    }
    give(writer.finish())
    if (sincePause >= PAUSE_BYTES) {
      sincePause = 0
      await pause()
    }
  }
  give(writer.end())
  return size
}
