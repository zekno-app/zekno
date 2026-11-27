/**
 * A second ustar reader, written for the tests apart from `pack/tar.ts` and
 * `pack/check.ts`, so the one form is read back by two independent readers
 * and no tar program of the machine is used (contracts/core.md CO19, item 2).
 * It reads leniently and reports what it finds; the tests judge it.
 */
export type ReadEntry = {
  name: string
  type: string
  mode: number
  size: number
  data: Uint8Array
  uid: number
  gid: number
  mtime: number
}

const decoder = new TextDecoder("utf-8", { fatal: true })

function text(bytes: Uint8Array, offset: number, length: number): string {
  const field = bytes.subarray(offset, offset + length)
  const end = field.indexOf(0)
  return decoder.decode(end === -1 ? field : field.subarray(0, end))
}

function octal(bytes: Uint8Array, offset: number, length: number): number {
  const digits = text(bytes, offset, length).trim()
  if (!/^[0-7]+$/.test(digits)) throw new Error(`not octal at ${offset}`)
  return parseInt(digits, 8)
}

export function readUstar(bytes: Uint8Array): {
  entries: ReadEntry[]
  endBlocks: number
  after: number
} {
  const entries: ReadEntry[] = []
  let offset = 0
  while (offset + 512 <= bytes.length) {
    const block = bytes.subarray(offset, offset + 512)
    if (block.every((byte) => byte === 0)) break
    let sum = 0
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i]!
    if (octal(block, 148, 8) !== sum)
      throw new Error(`bad checksum at ${offset}`)
    if (text(block, 257, 6) !== "ustar" || text(block, 263, 2) !== "00")
      throw new Error(`not ustar at ${offset}`)
    const prefix = text(block, 345, 155)
    const last = text(block, 0, 100)
    const size = octal(block, 124, 12)
    offset += 512
    entries.push({
      name: prefix === "" ? last : `${prefix}/${last}`,
      type: String.fromCharCode(block[156]!),
      mode: octal(block, 100, 8),
      size,
      data: bytes.slice(offset, offset + size),
      uid: octal(block, 108, 8),
      gid: octal(block, 116, 8),
      mtime: octal(block, 136, 12),
    })
    offset += Math.ceil(size / 512) * 512
  }
  let endBlocks = 0
  while (
    offset + 512 <= bytes.length &&
    bytes.subarray(offset, offset + 512).every((byte) => byte === 0)
  ) {
    endBlocks++
    offset += 512
  }
  return { entries, endBlocks, after: bytes.length - offset }
}
