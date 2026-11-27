/**
 * The saved output of an app's last build from this machine
 * (specs/016-build-from-source, data-model.md, "The saved build output";
 * contracts/cli.md CL7 step 13 and CL9; FR-071a): `builds/<server
 * id>/<app>.log` in the profile folder, mode 600, one file for each app on
 * each server, read by `zekno logs --build`.
 *
 * At a terminal and in the app, each line the runner sends is appended to
 * `<app>.log.<random>` beside it as it comes, and that file replaces the old
 * one by a rename when the deploy ends; until then the old one stays the
 * saved output. Its first line is the head: the deploy, the server, the
 * time and how many of the oldest lines were dropped, as data (a line for a
 * person is made from it when it is printed). The file is at most
 * `BUILD_OUTPUT_BYTES`: past it the oldest lines go. The raw text is kept,
 * escape sequences and all, since every line is cleaned when it is printed
 * (CL9, CL14); nothing in it is ever run or followed.
 */
import { randomBytes } from "node:crypto"
import {
  closeSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs"
import { join } from "node:path"
import { z } from "zod"

import { CliError } from "../cli/errors"
import { readOwnFile } from "../project/accepted"
import { sanitize } from "../server/sanitize"
import { NAME } from "./profile"
import { privateFolder, STALE_AFTER_MS } from "./run-folder"

/** The folder of the profile folder that holds the saved output, a folder for each server. */
export const BUILD_OUTPUTS = "builds"
/** The most a saved output holds, its head included (data-model.md). */
export const BUILD_OUTPUT_BYTES = 32 * 1024 * 1024
/** The head's room at the top of the file, written last, in place, once the number of lines dropped is known. */
const HEAD_BYTES = 256
/** What is copied or searched at once. */
const CHUNK = 1024 * 1024

const SERVER_ID = /^srv_[0-9a-f]{32}$/
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

const HeadSchema = z.strictObject({
  deploy: count.min(1),
  /** The server's name in the profile when the deploy ran. */
  server: z.string().regex(NAME),
  /** When the deploy was signed, as it signed it. */
  at: z.iso.datetime(),
  /** How many of the oldest lines were dropped to keep the file in its bound. */
  dropped: count,
})
export type BuildOutputHead = z.infer<typeof HeadSchema>

/** A saved output as read: its head and the builder's lines, raw. */
export type SavedBuildOutput = { head: BuildOutputHead; lines: string[] }

/** The output of one deploy as it is saved. Nothing more happens once it ended or was discarded. */
export type BuildOutput = {
  /** One line of the builder's, as the runner sent it. */
  line(text: string): void
  /** The deploy ended: this output becomes the saved one. */
  end(): void
  /** Nothing of it is kept, and the saved output before it stays. */
  discard(): void
}

/** Where the saved output of `app` on the server `serverId` is, or undefined unless both names hold to their rules, so neither is a path. */
function savedPath(
  home: string,
  serverId: string,
  app: string
): string | undefined {
  if (!SERVER_ID.test(serverId) || !NAME.test(app)) return undefined
  return join(home, BUILD_OUTPUTS, serverId, `${app}.log`)
}

function writeAll(fd: number, bytes: Uint8Array, at?: number): void {
  let done = 0
  while (done < bytes.length) {
    const position = at === undefined ? null : at + done
    done += writeSync(fd, bytes, done, bytes.length - done, position)
  }
}

/** Opens a new file beside `path` under a name nobody can predict, mode 600, with room for the head. */
function openBeside(path: string): { fd: number; temporary: string } {
  const temporary = `${path}.${randomBytes(16).toString("hex")}`
  // `wx+` refuses a file or link that is already there under this name; it is read back when the oldest lines go.
  const fd = openSync(temporary, "wx+", 0o600)
  fchmodSync(fd, 0o600)
  writeAll(fd, Buffer.from(`${" ".repeat(HEAD_BYTES - 1)}\n`))
  return { fd, temporary }
}

/** Deletes the files beside an app's saved output that a run which never ended left, once they are 24 hours old. */
function sweep(folder: string, app: string, now: number): void {
  const beside = new RegExp(`^${app}\\.log\\.[0-9a-f]{32}$`)
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return
  }
  for (const name of names) {
    if (!beside.test(name)) continue
    try {
      const path = join(folder, name)
      if (now - lstatSync(path).mtimeMs > STALE_AFTER_MS) rmSync(path)
    } catch {
      // Left for a later run.
    }
  }
}

/**
 * Starts the saved output of one deploy of `app` to the server `serverId`
 * (CL7 step 13): the folders made folders of mode 700, a link in the place
 * of one replaced; the lines appended beside the saved output; and `end`
 * puts them in its place. `limit` is the file's bound, `BUILD_OUTPUT_BYTES`.
 */
export function startBuildOutput(
  home: string,
  serverId: string,
  app: string,
  head: Omit<BuildOutputHead, "dropped">,
  limit = BUILD_OUTPUT_BYTES
): BuildOutput {
  const path = savedPath(home, serverId, app)
  if (path === undefined)
    throw new CliError(
      `Could not write ${sanitize(join(home, BUILD_OUTPUTS))}.`
    )
  const failed = () => new CliError(`Could not write ${sanitize(path)}.`)
  // The bytes of lines the file may hold under its head.
  const room = limit - HEAD_BYTES
  try {
    mkdirSync(home, { recursive: true, mode: 0o700 })
  } catch {
    throw failed()
  }
  privateFolder(join(home, BUILD_OUTPUTS))
  privateFolder(join(home, BUILD_OUTPUTS, serverId))
  sweep(join(home, BUILD_OUTPUTS, serverId), app, Date.now())

  let file: { fd: number; temporary: string }
  try {
    file = openBeside(path)
  } catch {
    throw failed()
  }
  let body = 0
  let dropped = 0
  let open = true

  /** Reads `length` bytes of the file at `at`. */
  const readAt = (at: number, length: number) => {
    const buffer = Buffer.alloc(length)
    let done = 0
    while (done < length) {
      const read = readSync(file.fd, buffer, done, length - done, at + done)
      if (read === 0) break
      done += read
    }
    return buffer.subarray(0, done)
  }

  /**
   * Keeps the newest lines that fit in `room`, in a new file beside the
   * saved output, and counts the lines left out. Every line ends with a
   * line break, so the kept part starts right after one.
   */
  const cut = () => {
    const end = HEAD_BYTES + body
    let from = end - room - 1
    let keep = end
    for (; from < end; from += CHUNK) {
      const found = readAt(from, Math.min(CHUNK, end - from)).indexOf(0x0a)
      if (found !== -1) {
        keep = from + found + 1
        break
      }
    }
    for (let at = HEAD_BYTES; at < keep; at += CHUNK) {
      const chunk = readAt(at, Math.min(CHUNK, keep - at))
      for (let found = chunk.indexOf(0x0a); found !== -1; dropped++)
        found = chunk.indexOf(0x0a, found + 1)
    }
    const next = openBeside(path)
    for (let at = keep; at < end; at += CHUNK)
      writeAll(next.fd, readAt(at, Math.min(CHUNK, end - at)))
    closeSync(file.fd)
    rmSync(file.temporary, { force: true })
    file = next
    body = end - keep
  }

  const close = () => {
    open = false
    try {
      closeSync(file.fd)
    } catch {
      // Closed already.
    }
  }

  return {
    line(text) {
      if (!open) return
      const bytes = Buffer.from(`${text}\n`)
      try {
        writeAll(file.fd, bytes)
        body += bytes.length
        // Cut while the deploy runs once past twice the room, so the file beside stays bounded too.
        if (body > 2 * room) cut()
      } catch {
        close()
        rmSync(file.temporary, { force: true })
        throw failed()
      }
    },
    end() {
      if (!open) return
      try {
        if (body > room) cut()
        const written = JSON.stringify({ ...head, dropped })
        writeAll(file.fd, Buffer.from(written.padEnd(HEAD_BYTES - 1)), 0)
        close()
        renameSync(file.temporary, path)
      } catch {
        close()
        rmSync(file.temporary, { force: true })
        throw failed()
      }
    },
    discard() {
      if (!open) return
      close()
      rmSync(file.temporary, { force: true })
    },
  }
}

/**
 * The saved output of `app`'s last build on the server `serverId` from this
 * machine, raw, or undefined when none is saved: no file, a link, not a
 * regular file of this user's, past the bound, not UTF-8, or a first line
 * that is not a head (CL9).
 */
export function readBuildOutput(
  home: string,
  serverId: string,
  app: string
): SavedBuildOutput | undefined {
  const path = savedPath(home, serverId, app)
  const text =
    path === undefined ? undefined : readOwnFile(path, BUILD_OUTPUT_BYTES)
  if (text === undefined) return undefined
  const lineBreak = text.indexOf("\n")
  if (lineBreak === -1) return undefined
  let head: unknown
  try {
    head = JSON.parse(text.slice(0, lineBreak))
  } catch {
    return undefined
  }
  const parsed = HeadSchema.safeParse(head)
  if (!parsed.success) return undefined
  const body = text.slice(lineBreak + 1)
  const lines = body === "" ? [] : body.replace(/\n$/, "").split("\n")
  return { head: parsed.data, lines }
}
