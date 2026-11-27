/**
 * The check of Docker's apt key (`apt-key.ts`), run with `sh` on key files
 * the test writes: OpenPGP packets in each length form, armored as Docker
 * serves its key. Nothing here reaches the network or runs Docker.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { keyCheck } from "./apt-key"

/** An OpenPGP packet: `form` is the old format with 1, 2 or 4 length bytes, or the new format. */
function packet(
  tag: number,
  body: Uint8Array,
  form: "old1" | "old2" | "old4" | "new"
): Uint8Array {
  const n = body.length
  const head =
    form === "old1"
      ? [0x80 | (tag << 2), n]
      : form === "old2"
        ? [0x80 | (tag << 2) | 1, n >> 8, n & 255]
        : form === "old4"
          ? [0x80 | (tag << 2) | 2, 0, 0, n >> 8, n & 255]
          : n < 192
            ? [0xc0 | tag, n]
            : n < 8384
              ? [0xc0 | tag, ((n - 192) >> 8) + 192, (n - 192) & 255]
              : [0xc0 | tag, 255, 0, n >> 16, (n >> 8) & 255, n & 255]
  return Uint8Array.from([...head, ...body])
}
const bytes = (length: number, first: number) =>
  Uint8Array.from({ length }, (_, i) => (i === 0 ? first : (i * 7) & 255))
const concat = (...parts: Uint8Array[]) =>
  Uint8Array.from(parts.flatMap((part) => [...part]))
/** A version 4 fingerprint: SHA-1 of the primary key packet as written with 0x99 and two length bytes. */
const fingerprint = (primary: Uint8Array) =>
  new Bun.CryptoHasher("sha1").update(primary).digest("hex").toUpperCase()
/** The packets as an armored key, with a header line, CRLF ends and a checksum line. */
function armored(data: Uint8Array): string {
  const lines =
    Buffer.from(data)
      .toString("base64")
      .match(/.{1,64}/g) ?? []
  return [
    "-----BEGIN PGP PUBLIC KEY BLOCK-----",
    "Comment: written by the test",
    "",
    ...lines,
    "=AAAA",
    "-----END PGP PUBLIC KEY BLOCK-----",
    "",
  ].join("\r\n")
}

const PRIMARY = packet(6, bytes(269, 4), "old2")
const REST = concat(
  packet(
    13,
    new TextEncoder().encode("stand-in <key@example.invalid>"),
    "old1"
  ),
  packet(2, bytes(540, 4), "old2"),
  packet(14, bytes(269, 4), "new"),
  packet(2, bytes(9000, 4), "new"),
  packet(13, bytes(20, 0x41), "old4")
)
const KEY = concat(PRIMARY, REST)

function check(
  content: string | Uint8Array,
  pinned = fingerprint(PRIMARY)
): { code: number; said: string } {
  const folder = mkdtempSync(join(tmpdir(), "zekno-key-check-"))
  try {
    const key = join(folder, "docker.asc")
    writeFileSync(key, content)
    const run = Bun.spawnSync(
      ["sh", "-c", `set -eu\n${keyCheck(key, pinned)}`],
      {
        stderr: "pipe",
        stdout: "pipe",
      }
    )
    return {
      code: run.exitCode,
      said: run.stderr.toString() + run.stdout.toString(),
    }
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

describe("the key check", () => {
  test("passes the pinned key, with its subkeys, user ids and signatures", () => {
    expect(check(armored(KEY))).toEqual({ code: 0, said: "" })
  })

  const changed = bytes(269, 4).map((b, i) => (i === 9 ? b ^ 1 : b))
  const refusals: [string, string | Uint8Array, string][] = [
    [
      "another key's fingerprint",
      armored(concat(packet(6, changed, "old2"), REST)),
      "its fingerprint is",
    ],
    [
      "a second primary key",
      armored(concat(KEY, PRIMARY)),
      "it holds 2 primary keys, not one",
    ],
    [
      "a primary key in the new format",
      armored(concat(packet(6, bytes(269, 4), "new"), REST)),
      "its first packet is not a version 4 public key",
    ],
    [
      "a version 5 key",
      armored(concat(packet(6, bytes(269, 5), "old2"), REST)),
      "its first packet is not a version 4 public key",
    ],
    [
      "a last packet that runs past the end",
      armored(KEY.slice(0, KEY.length - 3)),
      "runs past its end",
    ],
    [
      "a partial length",
      armored(concat(KEY, Uint8Array.from([0xc2, 230, 1]))),
      "partial length",
    ],
    [
      "an old packet with no length",
      armored(concat(KEY, Uint8Array.from([0x80 | (2 << 2) | 3, 1]))),
      "has no length",
    ],
    [
      "a byte that starts no packet",
      armored(concat(KEY, Uint8Array.from([0x10, 1]))),
      "does not start a packet",
    ],
    ["an empty file", "", "it holds no packet"],
    [
      "text that is not base64",
      "-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n!!!!\n-----END PGP PUBLIC KEY BLOCK-----\n",
      "it is not an armored key",
    ],
  ]
  for (const [what, content, says] of refusals)
    test(`stops, in one line, on ${what}`, () => {
      const { code, said } = check(content)
      expect(code).toBe(1)
      expect(said).toStartWith("Docker's apt key: ")
      expect(said).toContain(says)
      expect(said.trimEnd()).not.toContain("\n")
    })

  test("stops on the pinned fingerprint of another key", () => {
    const { code, said } = check(armored(KEY), "0".repeat(40))
    expect(code).toBe(1)
    expect(said).toContain(
      `its fingerprint is ${fingerprint(PRIMARY)}, not the pinned ${"0".repeat(40)}`
    )
  })

  test("is written only for a fingerprint of forty hex digits and a plain path", () => {
    expect(() => keyCheck("/etc/apt/keyrings/docker.asc", "9DC8 5822")).toThrow(
      "forty"
    )
    expect(() =>
      keyCheck("/etc/apt/keyrings/$(id).asc", fingerprint(PRIMARY))
    ).toThrow("a character sh would read")
  })
})
