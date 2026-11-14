import { describe, expect, test } from "bun:test"

import { CoreError, generateServerKeyPair, LIMITS } from "../src/index"
import { decodeKey } from "../src/keys"
import { openSealedSecret, sealSecret } from "../src/secrets"

function open(sealed: ReturnType<typeof sealSecret>, server: ReturnType<typeof generateServerKeyPair>, app = "web") {
  return openSealedSecret(sealed, { serverId: server.serverId, app }, decodeKey("serverPublic", server.publicKey), decodeKey("serverSecret", server.secretKey))
}

describe("sealed secrets", () => {
  const server = generateServerKeyPair()

  test("round-trips ordinary, empty, multi-line, non-Latin and maximum-size values", () => {
    const values = ["postgres://demo@db/app", "", "line one\nline two\ttabbed", "пароль-密码-🔑", "\u0001".repeat(64), "\uFEFFstarts-with-a-byte-order-mark", "x".repeat(LIMITS.secretValueBytes)]
    for (const value of values) {
      const sealed = sealSecret({ serverPublicKey: server.publicKey, app: "web", name: "VALUE", value })
      expect(open(sealed, server)).toEqual({ ok: true, value })
    }
  })

  test("sealing the same value twice gives different ciphertexts", () => {
    const input = { serverPublicKey: server.publicKey, app: "web", name: "VALUE", value: "same" }
    expect(sealSecret(input).ciphertext).not.toBe(sealSecret(input).ciphertext)
  })

  test("any change to the ciphertext fails closed with no partial content", () => {
    const sealed = sealSecret({ serverPublicKey: server.publicKey, app: "web", name: "VALUE", value: "demo-value" })
    const raw = Buffer.from(sealed.ciphertext, "base64url")
    for (const index of [0, 31, 40, raw.length - 1]) {
      const copy = Buffer.from(raw)
      copy[index] = copy[index]! ^ 1
      const result = open({ ...sealed, ciphertext: copy.toString("base64url") }, server)
      expect(result).toMatchObject({ ok: false, error: { code: "decrypt_failed" } })
    }
    expect(open({ ...sealed, ciphertext: raw.subarray(0, -1).toString("base64url") }, server).ok).toBe(false)
  })

  test("a secret opens only under its own name, app and server", () => {
    const sealed = sealSecret({ serverPublicKey: server.publicKey, app: "web", name: "DATABASE_URL", value: "demo-value" })
    expect(open({ ...sealed, name: "PUBLIC_URL" }, server)).toMatchObject({ ok: false, error: { code: "binding_mismatch" } })
    expect(open(sealed, server, "worker")).toMatchObject({ ok: false, error: { code: "binding_mismatch" } })
    const other = generateServerKeyPair()
    expect(open(sealed, other)).toMatchObject({ ok: false, error: { code: "decrypt_failed" } })
  })

  test("illegal names, values and sizes are rejected when sealing", () => {
    const base = { serverPublicKey: server.publicKey, app: "web", name: "OK", value: "v" }
    const codeOf = (input: typeof base) => {
      try {
        sealSecret(input)
        return "sealed"
      } catch (error) {
        return (error as CoreError).code
      }
    }
    for (const name of ["", "1ABC", "A-B", "A B", "A.B", "É", "A".repeat(LIMITS.secretNameLength + 1)]) {
      expect(codeOf({ ...base, name })).toBe("invalid_name")
    }
    expect(codeOf({ ...base, value: "\ud800" })).toBe("invalid_value")
    expect(codeOf({ ...base, value: 42 as never })).toBe("invalid_value")
    expect(codeOf({ ...base, value: "x".repeat(LIMITS.secretValueBytes + 1) })).toBe("too_large")
    expect(codeOf({ ...base, app: "Web App" })).toBe("invalid_argument")
    expect(codeOf({ ...base, serverPublicKey: "zk_spk_nope" as never })).toBe("invalid_key")
    expect(codeOf({ ...base, name: "__proto__" })).toBe("sealed")
  })

  test("an error about a secret never contains its value", () => {
    const value = "x".repeat(LIMITS.secretValueBytes + 1)
    try {
      sealSecret({ serverPublicKey: server.publicKey, app: "web", name: "BIG", value })
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("xxxx")
    }
  })
})
