/**
 * The site's icon files are ones its build can read. The build decodes
 * `app/favicon.ico` and refuses a picture inside it that is not a PNG with
 * red, green, blue and alpha ("The PNG is not in RGBA format!"), which stops
 * the whole build. The site is never built from here, so this is checked on
 * the files themselves.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const APP = join(import.meta.dir, "../../app")

const PNG_START = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** What a PNG's first chunk says: its size, its depth and whether it carries alpha (colour type 6). */
function pngHead(bytes: Buffer) {
  expect(bytes.subarray(0, 8).equals(PNG_START)).toBe(true)
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    depth: bytes.readUInt8(24),
    colourType: bytes.readUInt8(25),
  }
}

describe("the site's icons", () => {
  test("favicon.ico holds 16, 32 and 48 pixel pictures, each a PNG with alpha", () => {
    const ico = readFileSync(join(APP, "favicon.ico"))
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1])
    const count = ico.readUInt16LE(4)
    const pictures = Array.from({ length: count }, (_, at) => {
      const entry = 6 + 16 * at
      const size = ico.readUInt32LE(entry + 8)
      const offset = ico.readUInt32LE(entry + 12)
      return {
        named: ico.readUInt8(entry),
        ...pngHead(ico.subarray(offset, offset + size)),
      }
    })
    expect(pictures).toEqual(
      [16, 32, 48].map((side) => ({
        named: side,
        width: side,
        height: side,
        depth: 8,
        colourType: 6,
      }))
    )
  })

  test("icon.png is 512 by 512 and apple-icon.png 180 by 180, as the manifest says", () => {
    for (const [file, side] of [
      ["icon.png", 512],
      ["apple-icon.png", 180],
    ] as const) {
      const head = pngHead(readFileSync(join(APP, file)))
      expect({ file, ...head }).toEqual({
        file,
        width: side,
        height: side,
        depth: 8,
        colourType: 6,
      })
    }
  })
})
