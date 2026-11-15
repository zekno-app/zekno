/**
 * The record of first use (data-model.md, "When a project file is used"):
 * `links.json` in the profile folder, a list of the real path of each
 * `zekno.json` used in its folder on this machine and the SHA-256 of its
 * exact bytes. A zekno.json counts only when it is signed by the team
 * (signed.ts `signerOf`); this list says whether it was used here before,
 * byte for byte. A signed file copied into another folder, or changed by an
 * edit or a `git pull`, is not in it, so the person is asked about it once.
 *
 * The list is not signed, on purpose. Someone who can write the profile
 * folder and also plant a project folder gains nothing from forging an entry
 * that they do not have already: whoever controls a project folder the
 * developer deploys from controls the Compose file that is deployed, and an
 * entry alone never makes a file count. The list protects against the other
 * case: a teammate's signed file copied into a folder the developer did not
 * make, on a machine nobody else can write to. It holds no key and no secret.
 *
 * It is read with a size limit and a strict schema; a file that is missing,
 * too large, a link, not this user's or not readable counts as empty, so
 * nothing is accepted, and the next write replaces it. It is written as a
 * whole file or not at all, mode 600, and a link in its place is replaced,
 * never written through.
 */
import { createHash, randomBytes } from "node:crypto"
import { closeSync, constants, fchmodSync, fstatSync, openSync, readSync, renameSync, rmSync, writeSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

import { CliError } from "../cli/errors"
import { sanitize } from "../server/sanitize"

export const LINKS_FILE = "links.json"
/** The most entries kept. The oldest are dropped first. */
export const LINKS_KEPT = 500
/** The most of the file that is read. What is written is held under it, the oldest entries dropped first. */
export const LINKS_BYTES = 1024 * 1024

/** One accepted project file: its real path, and the SHA-256 of its bytes as they were accepted. */
export type AcceptedLink = { path: string; sha256: string }

const LinksSchema = z
  .array(
    z.strictObject({
      path: z.string().min(1).max(4096),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    })
  )
  .max(LINKS_KEPT)

/** The SHA-256 of text or bytes, in lowercase hex. */
export const sha256Of = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex")

/** Whether a file belongs to the user running zekno. Where there are no user ids, there is nothing to compare. */
function ownedByMe(uid: number): boolean {
  const mine = process.getuid?.()
  return mine === undefined || uid === mine
}

/** The text of `links.json`, or undefined when it cannot be taken as it is. Never through a link, never more than `LINKS_BYTES`. */
function readLinksText(path: string): string | undefined {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch {
    return undefined
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || !ownedByMe(stat.uid) || stat.size > LINKS_BYTES) return undefined
    const buffer = Buffer.alloc(LINKS_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null)
      if (read === 0) break
      length += read
    }
    if (length > LINKS_BYTES) return undefined
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length))
  } catch {
    return undefined
  } finally {
    closeSync(fd)
  }
}

/** Every accepted project file, oldest first. Anything that does not read and match the schema counts as none. */
export function acceptedLinks(home: string): AcceptedLink[] {
  const text = readLinksText(join(home, LINKS_FILE))
  if (text === undefined) return []
  try {
    const parsed = LinksSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

/** Whether this machine accepted the project file at `link.path` with exactly these bytes. */
export function isAccepted(home: string, link: AcceptedLink): boolean {
  return acceptedLinks(home).some((entry) => entry.path === link.path && entry.sha256 === link.sha256)
}

/**
 * The list as it is written: newest last, at most `LINKS_KEPT` entries and
 * `LINKS_BYTES` of text, the oldest left out first, so it can always be read back.
 */
function linksText(entries: readonly AcceptedLink[]): string {
  let kept = entries.slice(-LINKS_KEPT)
  for (;;) {
    const text = `${JSON.stringify(kept, null, 1)}\n`
    if (Buffer.byteLength(text) <= LINKS_BYTES || kept.length <= 1) return text
    kept = kept.slice(Math.max(1, Math.floor(kept.length / 10)))
  }
}

/**
 * Records a project file as accepted, replacing any earlier entry for the
 * same path: a new file under a name nobody can predict, mode 600, then put
 * in place by a rename, which replaces a link instead of writing through it.
 */
export function accept(home: string, link: AcceptedLink): void {
  const entries = acceptedLinks(home).filter((entry) => entry.path !== link.path)
  writeLinks(home, [...entries, { path: link.path, sha256: link.sha256 }])
}

/**
 * Takes back the record of a project file accepted with exactly these bytes,
 * as the first deploy does with a zekno.json it wrote and then removed
 * (asking/first-deploy.ts). An entry for the same path with other bytes is
 * left as it is; with no matching entry nothing is written.
 */
export function forget(home: string, link: AcceptedLink): void {
  const entries = acceptedLinks(home)
  const kept = entries.filter((entry) => entry.path !== link.path || entry.sha256 !== link.sha256)
  if (kept.length !== entries.length) writeLinks(home, kept)
}

/** Writes the list whole, as `accept` describes. */
function writeLinks(home: string, entries: readonly AcceptedLink[]): void {
  const text = linksText(entries)
  const path = join(home, LINKS_FILE)
  const temporary = join(home, `.${LINKS_FILE}.${randomBytes(8).toString("hex")}.tmp`)
  try {
    // `wx` refuses a file or link that is already there under this name.
    const fd = openSync(temporary, "wx", 0o600)
    try {
      fchmodSync(fd, 0o600)
      writeSync(fd, text)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, path)
  } catch {
    throw new CliError(`Could not write ${sanitize(path)}.`)
  } finally {
    rmSync(temporary, { force: true })
  }
}
