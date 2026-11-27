/**
 * The pack a Linux check sends a build on standard input
 * (specs/016-build-from-source, T011; contracts/runner.md RB7, "Standard
 * input"): a POSIX tar of regular files, written here because the runner
 * declares no package for it. `rb7.ts` re-exports it; `rb7Build` writes it
 * to a temporary file on this machine and hands it to `docker exec -i`.
 *
 *   packOf([{ path: "Dockerfile", data: "FROM scratch\n" }, { path: "a", data: bytes, mode: 0o755, mtime: 0 }])
 */

export type PackFile = {
  /** Relative, `/` between its parts, ASCII, at most 100 bytes. */
  readonly path: string
  readonly data: string | Uint8Array
  /** 0644 when absent. */
  readonly mode?: number
  /** Seconds since 1970; 2026-11-27 when absent. */
  readonly mtime?: number
}

/** A relative path with no `.` or `..` part, no empty part, nothing that reads as a flag. */
export const PACK_PATH =
  /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/

const BLOCK = 512
const DEFAULT_MTIME = Date.UTC(2026, 10, 27) / 1000
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0))

/** `value` in octal, `width - 1` digits and a NUL. */
function octal(value: number, width: number, what: string): string {
  const digits = value.toString(8)
  if (!Number.isSafeInteger(value) || value < 0 || digits.length > width - 1)
    throw new Error(`${what} ${value} does not fit a tar header`)
  return `${digits.padStart(width - 1, "0")}\0`
}

function header(file: PackFile, size: number): Uint8Array {
  const block = new Uint8Array(BLOCK)
  const put = (at: number, text: string) => block.set(ascii(text), at)
  put(0, file.path)
  put(100, octal(file.mode ?? 0o644, 8, "the mode"))
  put(108, octal(0, 8, "the user"))
  put(116, octal(0, 8, "the group"))
  put(124, octal(size, 12, "the size"))
  put(136, octal(file.mtime ?? DEFAULT_MTIME, 12, "the time"))
  put(148, " ".repeat(8))
  put(156, "0")
  put(257, "ustar\0")
  put(263, "00")
  const sum = block.reduce((total, byte) => total + byte, 0)
  put(148, `${sum.toString(8).padStart(6, "0")}\0 `)
  return block
}

/** The pack as a POSIX tar of regular files, in the order given, as `docker buildx build -` reads it. */
export function packOf(files: readonly PackFile[]): Uint8Array {
  const seen = new Set<string>()
  const parts: Uint8Array[] = []
  for (const file of files) {
    if (!PACK_PATH.test(file.path) || file.path.length > 100)
      throw new Error(
        `${JSON.stringify(file.path)} is not a relative ASCII path of at most 100 bytes`
      )
    if (seen.has(file.path)) throw new Error(`${file.path} is packed twice`)
    seen.add(file.path)
    if (file.mode !== undefined && (file.mode & ~0o777) !== 0)
      throw new Error(`${file.path}: the mode is 0 to 0777`)
    const data =
      typeof file.data === "string"
        ? new TextEncoder().encode(file.data)
        : file.data
    parts.push(header(file, data.length), data)
    const rest = data.length % BLOCK
    if (rest !== 0) parts.push(new Uint8Array(BLOCK - rest))
  }
  parts.push(new Uint8Array(2 * BLOCK))
  const tar = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0)
  )
  let at = 0
  for (const part of parts) {
    tar.set(part, at)
    at += part.length
  }
  return tar
}
