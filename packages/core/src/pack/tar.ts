/**
 * The one form of a pack (specs/016-build-from-source, contracts/core.md CO5;
 * data-model.md, "The pack"): POSIX ustar with plain files and folders only,
 * fixed modes, owner and time, names in the order of their UTF-8 bytes. The
 * same files give the same bytes on every machine (FR-016), and the runner
 * accepts nothing else (FR-030).
 */
import { isWellFormed, utf8 } from "../crypto/encoding"
import { LIMITS } from "../protocol/limits"
import { CoreError } from "../protocol/result"

/** What an entry of the pack is: a plain file or a folder. */
export type PackKind = "file" | "folder"

/** Bytes of a header's `name` field, and of its `prefix` field (ustar). */
export const USTAR_NAME_BYTES = 100
export const USTAR_PREFIX_BYTES = 155

const SLASH = 0x2f

/**
 * Orders two names by their UTF-8 bytes, the one order of the pack (FR-016).
 * JavaScript's `<` compares UTF-16 units and puts U+1F600 before U+FF5E,
 * which UTF-8 does not, so it is never used for names.
 */
export function compareNames(a: string, b: string): number {
  return compareBytes(utf8(a), utf8(b))
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const shorter = Math.min(a.length, b.length)
  for (let i = 0; i < shorter; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!
  }
  return a.length - b.length
}

// Unicode's control characters: C0, DEL and C1.
const CONTROL = /\p{Cc}/u

/**
 * True when `name` is a name the one form holds (CO5, FR-030): valid UTF-8,
 * relative, no empty, `.` or `..` part, no control character; a folder's
 * name ends with exactly one `/`, a file's never. Whether it fits a header is
 * `splitsAsUstar`'s question, asked apart.
 */
export function isPackName(name: string, kind: PackKind): boolean {
  if (typeof name !== "string" || !isWellFormed(name)) return false
  if (CONTROL.test(name)) return false
  const endsWithSlash = name.endsWith("/")
  if (endsWithSlash !== (kind === "folder")) return false
  const path = endsWithSlash ? name.slice(0, -1) : name
  return path
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== "..")
}

/**
 * Where a name as packed (a folder's trailing `/` counted) is split between
 * the header's `prefix` and `name` fields: -1 when the whole name fits in
 * `name`, else the byte offset of the last `/` that leaves a prefix of at
 * most 155 bytes and a name of 1 to 100 bytes, or undefined when none does.
 */
export function ustarSplit(bytes: Uint8Array): number | undefined {
  if (bytes.length <= USTAR_NAME_BYTES) return -1
  const last = Math.min(USTAR_PREFIX_BYTES, bytes.length - 2)
  for (let at = last; at > 0; at--) {
    if (bytes[at] !== SLASH) continue
    const rest = bytes.length - at - 1
    return rest <= USTAR_NAME_BYTES ? at : undefined
  }
  return undefined
}

/**
 * True when the name as packed fits a ustar header (CO5, item 16): the whole
 * name is at most 100 bytes, or some `/` leaves a prefix of at most 155 bytes
 * and a name of 1 to 100 bytes. The one rule for which names fit: zekno's
 * walk (C7), the writer and the checker all use it, in place of separate
 * limits on a path and on its last part.
 */
export function splitsAsUstar(name: string): boolean {
  return ustarSplit(utf8(name)) !== undefined
}

/** The one time every entry carries: 2000-01-01, in seconds (FR-016; item 14). */
export const PACK_TIME = 946684800

/** A tar block: every header is one, and data is padded to whole ones. */
export const BLOCK_BYTES = 512

/** The end of a tar: two zero blocks, then nothing. */
export const TAR_END: Uint8Array = new Uint8Array(2 * BLOCK_BYTES)

/** One entry of the pack, as its header describes it. */
export type TarEntry = {
  name: string
  kind: PackKind
  /** 0755 for a folder and for a file its owner may run, else 0644. */
  mode: 0o644 | 0o755
  /** Bytes of a file's data; 0 for a folder. */
  size: number
}

// Offsets and lengths of the ustar header's fields.
const FIELD = {
  name: [0, 100],
  mode: [100, 8],
  uid: [108, 8],
  gid: [116, 8],
  size: [124, 12],
  mtime: [136, 12],
  checksum: [148, 8],
  typeflag: [156, 1],
  magic: [257, 6],
  version: [263, 2],
  devmajor: [329, 8],
  devminor: [337, 8],
  prefix: [345, 155],
} as const

const TYPEFLAG = { file: "0", folder: "5" } as const

function refuse(message: string): never {
  throw new CoreError("invalid_argument", message)
}

/** `value` as `digits` octal digits and a NUL, the form of every number field. */
function octal(value: number, digits: number): string {
  return `${value.toString(8).padStart(digits, "0")}\0`
}

/**
 * The 512-byte header of an entry in the one form (CO5; data-model.md, "The
 * pack"): the name split as `splitsAsUstar` finds it, the mode, owner 0 with
 * empty names, the size, `PACK_TIME`, the checksum, typeflag `0` or `5`, no
 * link, magic `ustar\0` and version `00`. Throws for a name the walk would
 * have refused before signing (C7), a folder that is not 0755 or has a size,
 * and any other mode, size or kind: the checker rebuilds every header it
 * reads with this function, so whatever it makes is the one form.
 */
export function header(entry: TarEntry): Uint8Array {
  const { name, kind, mode, size } = entry
  if (kind !== "file" && kind !== "folder")
    refuse("A pack entry is a file or a folder.")
  if (!isPackName(name, kind))
    refuse("A pack entry's name is not one the pack holds.")
  const bytes = utf8(name)
  const split = ustarSplit(bytes)
  if (split === undefined)
    refuse("A pack entry's name does not fit a ustar header.")
  if (mode !== 0o644 && mode !== 0o755)
    refuse("A pack entry's mode is 0644 or 0755.")
  if (kind === "folder" && mode !== 0o755)
    refuse("A folder in the pack has mode 0755.")
  if (!Number.isSafeInteger(size) || size < 0 || size > LIMITS.packBytes)
    refuse("A pack entry's size is a whole number of bytes within the pack.")
  if (kind === "folder" && size !== 0)
    refuse("A folder in the pack has no size.")

  const out = new Uint8Array(BLOCK_BYTES)
  const put = (field: keyof typeof FIELD, value: Uint8Array | string) =>
    out.set(typeof value === "string" ? utf8(value) : value, FIELD[field][0])
  if (split === -1) {
    put("name", bytes)
  } else {
    put("prefix", bytes.subarray(0, split))
    put("name", bytes.subarray(split + 1))
  }
  put("mode", octal(mode, 7))
  put("uid", octal(0, 7))
  put("gid", octal(0, 7))
  put("size", octal(size, 11))
  put("mtime", octal(PACK_TIME, 11))
  put("typeflag", TYPEFLAG[kind])
  put("magic", "ustar\0")
  put("version", "00")
  put("devmajor", octal(0, 7))
  put("devminor", octal(0, 7))
  // The checksum is the sum of every byte with its own field read as spaces.
  put("checksum", "        ")
  const sum = out.reduce((total, byte) => total + byte, 0)
  put("checksum", `${sum.toString(8).padStart(6, "0")}\0 `)
  return out
}

/** The zero bytes after `size` bytes of data, up to a whole block. */
export function paddingFor(size: number): Uint8Array {
  return new Uint8Array((BLOCK_BYTES - (size % BLOCK_BYTES)) % BLOCK_BYTES)
}

/** The folder an entry sits in, with its trailing `/`, or undefined at the top. */
export function parentOf(name: string): string | undefined {
  const path = name.endsWith("/") ? name.slice(0, -1) : name
  const slash = path.lastIndexOf("/")
  return slash === -1 ? undefined : path.slice(0, slash + 1)
}

/** Writes the one form piece by piece; every piece it gives goes into the pack in order. */
export interface TarWriter {
  /** The entry's header. */
  begin(entry: TarEntry): Uint8Array
  /** The same bytes, counted against the open entry's size. */
  data(bytes: Uint8Array): Uint8Array
  /** The zero padding that closes the open entry. */
  finish(): Uint8Array
  /** `TAR_END`, once every entry is closed. */
  end(): Uint8Array
}

/**
 * The writer of the one form (CO5; FR-016, SC-013). It refuses, with
 * `invalid_argument`, an entry that is not after the one before by the
 * UTF-8 bytes of its name, an entry whose folder was not an earlier entry,
 * a folder with the name of an earlier file, more than `LIMITS.packEntries`
 * entries, data past an entry's size, an entry closed short, and anything out
 * of turn.
 */
export function createTarWriter(): TarWriter {
  const folders = new Set<string>()
  const files = new Set<string>()
  let previous: string | undefined
  let entries = 0
  let open: { size: number; written: number } | undefined
  let ended = false

  return {
    begin(entry) {
      if (ended) refuse("The pack has ended.")
      if (open) refuse("The entry before is still open.")
      if (entries >= LIMITS.packEntries)
        refuse(`A pack holds at most ${LIMITS.packEntries} entries.`)
      const bytes = header(entry)
      if (previous !== undefined && compareNames(previous, entry.name) >= 0)
        refuse("Pack entries are in the order of their names' UTF-8 bytes.")
      const parent = parentOf(entry.name)
      if (parent !== undefined && !folders.has(parent))
        refuse("A pack entry's folder comes before it.")
      // The file `x` comes before the folder `x/` by the order: one check finds both.
      if (entry.kind === "folder" && files.has(entry.name.slice(0, -1)))
        refuse("A folder in the pack never has a file's name.")
      if (entry.kind === "folder") folders.add(entry.name)
      else files.add(entry.name)
      previous = entry.name
      entries++
      open = { size: entry.size, written: 0 }
      return bytes
    },
    data(bytes) {
      if (!open) refuse("No entry is open.")
      if (open.written + bytes.length > open.size)
        refuse("More data than the entry's size.")
      open.written += bytes.length
      return bytes
    },
    finish() {
      if (!open) refuse("No entry is open.")
      if (open.written !== open.size) refuse("Less data than the entry's size.")
      const padding = paddingFor(open.size)
      open = undefined
      return padding
    },
    end() {
      if (ended) refuse("The pack has ended.")
      if (open) refuse("An entry is still open.")
      ended = true
      return TAR_END.slice()
    },
  }
}
