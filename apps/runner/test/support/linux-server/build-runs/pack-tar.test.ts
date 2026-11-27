/**
 * `pack-tar.ts` (specs/016-build-from-source, T011; contracts/runner.md
 * RB7, "Standard input"): each header as the POSIX format writes it, read
 * back by this machine's own `tar`, and the paths it refuses. Nothing here
 * runs Docker.
 */
import { describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { packOf } from "./pack-tar"

/** The fields of one tar header block, read as the format writes them. */
function readHeader(block: Uint8Array) {
  const text = (from: number, length: number) =>
    new TextDecoder()
      .decode(block.slice(from, from + length))
      .replace(/\0.*$/s, "")
  const computed = block.reduce(
    (sum, byte, at) => sum + (at >= 148 && at < 156 ? 32 : byte),
    0
  )
  return {
    name: text(0, 100),
    mode: parseInt(text(100, 8), 8),
    size: parseInt(text(124, 12), 8),
    mtime: parseInt(text(136, 12), 8),
    checksum: parseInt(text(148, 8), 8),
    computed,
    type: text(156, 1),
    magic: text(257, 6),
    version: text(263, 2),
  }
}

describe("the pack on standard input", () => {
  test("is a POSIX tar: each header checked, the data padded, two empty blocks at the end", () => {
    const tar = packOf([
      { path: "Dockerfile", data: "FROM scratch\n" },
      {
        path: "app/run.sh",
        data: new Uint8Array(513).fill(65),
        mode: 0o755,
        mtime: 7,
      },
    ])
    expect(tar.length).toBe(512 + 512 + 512 + 1024 + 1024)
    const first = readHeader(tar.slice(0, 512))
    expect(first).toMatchObject({
      name: "Dockerfile",
      mode: 0o644,
      size: 13,
      mtime: Date.UTC(2026, 10, 27) / 1000,
      type: "0",
      magic: "ustar",
      version: "00",
    })
    expect(first.checksum).toBe(first.computed)
    expect(new TextDecoder().decode(tar.slice(512, 525))).toBe("FROM scratch\n")
    expect(tar.slice(525, 1024).every((byte) => byte === 0)).toBe(true)
    const second = readHeader(tar.slice(1024, 1536))
    expect(second).toMatchObject({
      name: "app/run.sh",
      mode: 0o755,
      size: 513,
      mtime: 7,
    })
    expect(second.checksum).toBe(second.computed)
    expect(tar.slice(1536, 2049).every((byte) => byte === 65)).toBe(true)
    expect(tar.slice(-1024).every((byte) => byte === 0)).toBe(true)
  })

  test("is read back whole by this machine's tar", () => {
    const folder = mkdtempSync(join(tmpdir(), "zekno-check-pack-test-"))
    try {
      const file = join(folder, "pack.tar")
      writeFileSync(
        file,
        packOf([
          { path: "Dockerfile", data: "# syntax=x\nFROM scratch\n" },
          { path: "Dockerfile.rego", data: "package docker\n" },
          { path: "a/b/hello.txt", data: "héllo\n" },
        ])
      )
      const out = join(folder, "out")
      mkdirSync(out)
      expect(Bun.spawnSync(["tar", "-xf", file, "-C", out]).exitCode).toBe(0)
      expect(readFileSync(join(out, "Dockerfile"), "utf8")).toBe(
        "# syntax=x\nFROM scratch\n"
      )
      expect(readFileSync(join(out, "Dockerfile.rego"), "utf8")).toBe(
        "package docker\n"
      )
      expect(readFileSync(join(out, "a/b/hello.txt"), "utf8")).toBe("héllo\n")
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  test("refuses a path it cannot write plainly, a path twice, a mode beyond permissions and a time before 1970", () => {
    for (const path of [
      "/abs",
      "../up",
      "a/../b",
      "./a",
      "",
      "a//b",
      "-f",
      "é",
      "x".repeat(101),
    ])
      expect(() => packOf([{ path, data: "" }])).toThrow(
        "not a relative ASCII path"
      )
    expect(() =>
      packOf([
        { path: "a", data: "" },
        { path: "a", data: "" },
      ])
    ).toThrow("packed twice")
    expect(() => packOf([{ path: "a", data: "", mode: 0o4755 }])).toThrow(
      "the mode is 0 to 0777"
    )
    expect(() => packOf([{ path: "a", data: "", mtime: -1 }])).toThrow(
      "does not fit a tar header"
    )
    expect(packOf([{ path: "x".repeat(100), data: "" }]).length).toBe(
      512 + 1024
    )
    expect(packOf([]).length).toBe(1024)
  })
})
