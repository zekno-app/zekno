/**
 * Who may use the three effects of feature 015 (specs/015-domains-https,
 * contracts/cli.md, CL5; research R28; tasks T051), read from the source as
 * `never-fetches.test.ts` reads it for `fetch`: `node:dns`, `node:tls` and
 * `ssh -G` each in its one module of domains/; the real effects handed on by
 * main.ts and nowhere else; and the operations that may ask them, listed, so
 * a new one is a decision. `fetch` stays where it was.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SOURCE = join(import.meta.dir, "../../src")
const FILES = [...new Bun.Glob("**/*.{ts,tsx}").scanSync(SOURCE)].sort()
const using = (pattern: RegExp) =>
  FILES.filter((file) => pattern.test(readFileSync(join(SOURCE, file), "utf8")))

describe("the three effects, and who may use them (CL5)", () => {
  test("node:dns, node:tls and ssh -G each in one module of domains/", () => {
    expect(FILES.length).toBeGreaterThan(40)
    expect(using(/["']node:dns(\/promises)?["']/)).toEqual(["domains/dns.ts"])
    expect(using(/["']node:tls["']/)).toEqual(["domains/https.ts"])
    expect(using(/["']-G["']/)).toEqual(["domains/server-address.ts"])
  })

  test("main.ts hands the real effects on, and is the only place that does", () => {
    const main = readFileSync(join(SOURCE, "main.ts"), "utf8")
    expect(main).toContain("\n  resolveDomain,\n")
    expect(main).toContain("\n  probeHttps,\n")
    expect(main).toContain("\n  sshHost: sshHostOf({ resolveDomain }),\n")
    // The real effects are values of their modules: only main.ts imports them.
    expect(
      using(/import\s*{[^}]*\b(resolveDomain|probeHttps|sshHostOf)\b[^}]*}/)
    ).toEqual(["main.ts"])
  })

  test("the operations that may ask them, and no other file", () => {
    // The DNS check of a deploy, `zekno domain`, and the server's host name, which is looked up with the effect it is given.
    expect(using(/\.resolveDomain\b/)).toEqual([
      "domains/server-address.ts",
      "ops/deploy-domains.ts",
      "ops/domain.ts",
    ])
    // The wait for HTTPS after a deploy, and `zekno domain`.
    expect(using(/\.probeHttps\b/)).toEqual([
      "ops/deploy-https.ts",
      "ops/domain.ts",
    ])
    // The DNS check of a deploy, and `zekno domain` and `zekno domain add`.
    expect(using(/\.sshHost\b/)).toEqual([
      "ops/deploy-domains.ts",
      "ops/domain.ts",
    ])
  })

  test("fetch is not used for any of it", () => {
    expect(using(/\.fetch\b/)).toEqual(["version/newest.ts"])
    expect(using(/\bfetch\([^)\s]/)).toEqual(["main.ts", "version/newest.ts"])
  })
})
