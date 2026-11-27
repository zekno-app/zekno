/**
 * The answers kept on this machine (specs/016-build-from-source,
 * data-model.md, "Answers kept on this machine"; contracts/cli.md CL5,
 * "Kept answers"; FR-015a, FR-015b, FR-037f): `agreed.json` in the profile
 * folder, the yes a person gave to a question asked before a deploy that
 * builds, so it is not asked again. Three kinds:
 *
 * - `folders`: the real path of the folder sent and of the settings file,
 *   the first deploy that builds from that folder (B24);
 * - `files`: the real path of the folder sent and a file's path inside it,
 *   a secret-looking file the settings name (B26);
 * - `secrets`: a server id, an app, a service and a secret's name, a build
 *   secret given to a build (H4; written from step 1b).
 *
 * Only a yes typed by a person is kept: no option, and no `--yes`, writes it
 * (CL5). The file is unsigned, as `links.json` is, and modelled on it
 * (project/accepted.ts): an entry only spares a person a question about a
 * folder whose files they already control. It is read with a size limit
 * and a strict schema, and anything that does not read counts as empty, so
 * the question is asked again and, with no terminal, the deploy stops. It is
 * written whole, mode 600, at most `AGREED_KEPT` entries of each kind and
 * `AGREED_BYTES` in all, the oldest dropped first; a link in its place is
 * replaced, never written through.
 */
import { LIMITS, SECRET_NAME, SERVICE_NAME } from "@workspace/core"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

import { readOwnFile, writeOwnFile } from "../project/accepted"
import { NAME } from "./profile"

export const AGREED_FILE = "agreed.json"
/** The most entries of each kind kept (data-model.md). */
export const AGREED_KEPT = 1024
/** The longest path kept, in characters. */
export const AGREED_PATH = 4096
/** The most of the file that is read; what is written is held under it, the oldest entries dropped first. */
export const AGREED_BYTES = 8 * 1024 * 1024

const Path = z.string().min(1).max(AGREED_PATH)

const KINDS = {
  folders: z.strictObject({ folder: Path, settings: Path }),
  files: z.strictObject({ folder: Path, path: Path }),
  secrets: z.strictObject({
    server: z.string().regex(/^srv_[0-9a-f]{32}$/),
    app: z.string().regex(NAME),
    service: z.string().regex(SERVICE_NAME),
    name: z.string().max(LIMITS.secretNameLength).regex(SECRET_NAME),
  }),
}

const AgreedSchema = z.strictObject({
  folders: z.array(KINDS.folders).max(AGREED_KEPT),
  files: z.array(KINDS.files).max(AGREED_KEPT),
  secrets: z.array(KINDS.secrets).max(AGREED_KEPT),
})

/** Every kept answer, oldest first in each kind. */
export type Agreed = z.infer<typeof AgreedSchema>
/** A kind of answer kept. */
export type AgreedKind = keyof Agreed
/** One answer of a kind. */
export type AgreedEntry<Kind extends AgreedKind> = Agreed[Kind][number]

const none = (): Agreed => ({ folders: [], files: [], secrets: [] })

/** Every kept answer. A file that is missing or does not read counts as none. */
export function readAgreed(home: string): Agreed {
  const text = readOwnFile(join(home, AGREED_FILE), AGREED_BYTES)
  if (text === undefined) return none()
  try {
    const parsed = AgreedSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : none()
  } catch {
    return none()
  }
}

/** Whether two answers of a kind are the same: every field equal. */
function same(a: object, b: object): boolean {
  const left = Object.entries(a)
  return (
    left.length === Object.keys(b).length &&
    left.every(([key, value]) => (b as Record<string, unknown>)[key] === value)
  )
}

/** Whether this machine kept this answer. */
export function isAgreed<Kind extends AgreedKind>(
  home: string,
  kind: Kind,
  entry: AgreedEntry<Kind>
): boolean {
  return (readAgreed(home)[kind] as readonly object[]).some((kept) =>
    same(kept, entry)
  )
}

/**
 * The text written: each kind at most `AGREED_KEPT` entries, then, while
 * the text is past `AGREED_BYTES`, the oldest tenth of the largest kind left
 * out, so it can always be read back.
 */
function agreedText(agreed: Agreed): string {
  const kept: Agreed = {
    folders: agreed.folders.slice(-AGREED_KEPT),
    files: agreed.files.slice(-AGREED_KEPT),
    secrets: agreed.secrets.slice(-AGREED_KEPT),
  }
  for (;;) {
    const text = `${JSON.stringify(kept)}\n`
    if (Buffer.byteLength(text) <= AGREED_BYTES) return text
    const kinds = Object.keys(kept) as AgreedKind[]
    const largest = kinds.reduce((a, b) =>
      JSON.stringify(kept[b]).length > JSON.stringify(kept[a]).length ? b : a
    )
    const entries = kept[largest]
    kept[largest] = entries.slice(
      Math.max(1, Math.floor(entries.length / 10))
    ) as never
  }
}

/**
 * Keeps a yes a person gave (CL5, "Kept answers"), as the newest of its
 * kind; the same answer kept before is moved, not repeated. The file is
 * written whole (project/accepted.ts `writeOwnFile`). The caller has checked
 * the entry against its kind's rule: one that does not hold to it would
 * make the whole file read as empty, and is refused here instead.
 */
export function agree<Kind extends AgreedKind>(
  home: string,
  kind: Kind,
  entry: AgreedEntry<Kind>
): void {
  const checked = KINDS[kind].parse(entry) as AgreedEntry<Kind>
  const agreed = readAgreed(home)
  const others = (agreed[kind] as readonly object[]).filter(
    (kept) => !same(kept, checked)
  )
  agreed[kind] = [...others, checked] as Agreed[Kind]
  mkdirSync(home, { recursive: true, mode: 0o700 })
  writeOwnFile(home, AGREED_FILE, agreedText(agreed))
}
