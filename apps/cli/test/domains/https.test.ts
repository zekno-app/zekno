/**
 * Asking a domain over HTTPS, and the wait after a deploy
 * (specs/015-domains-https, contracts/cli.md, CL3 and CL5; research R28;
 * tasks T054): the probe through a stand-in for `node:tls` (a certificate
 * the roots and the name both accept, one either refuses, nothing answering,
 * something answering that is not TLS), then against a server of this test
 * on 127.0.0.1 with a throwaway certificate made by `openssl` when this
 * machine has it; and the wait, on a clock of the test's own. Never a public
 * host.
 */
import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { mkdtempSync, readFileSync } from "node:fs"
import { createServer as tcpServer, type AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer as tlsServer } from "node:tls"

import {
  probeOf,
  WAIT_MS,
  waitForHttps,
  type HttpsAnswer,
  type ProbeSocket,
} from "../../src/domains/https"

const LAST_DAY = "Feb 17 12:00:00 2027 GMT"

/** A stand-in TLS socket: what it emits, in order, and what it holds. */
function socket(
  emits: ("connect" | "secureConnect" | "error")[],
  holds: { authorized?: boolean; cert?: Record<string, unknown> } = {}
) {
  const events = new EventEmitter()
  let destroyed = false
  const made: ProbeSocket & { destroyed: () => boolean } = {
    authorized: holds.authorized ?? true,
    getPeerCertificate: () =>
      (holds.cert ?? { valid_to: LAST_DAY, subject: {} }) as never,
    once: (event: string, listener: (error: Error) => void) =>
      events.once(event, listener),
    destroy: () => {
      destroyed = true
    },
    destroyed: () => destroyed,
  }
  queueMicrotask(() => {
    for (const event of emits)
      events.emit(event, event === "error" ? new Error("no") : undefined)
  })
  return made
}

describe("probeHttps (CL5, R28)", () => {
  test("valid: authorized and the name checked, with the last day; nothing more is read, the connection is closed", async () => {
    const asked: unknown[] = []
    const made = socket(["connect", "secureConnect"])
    const probe = probeOf({
      connect: (options) => (asked.push(options), made),
      check: () => undefined,
    })
    expect(await probe("shop.example.com")).toEqual({
      state: "valid",
      until: new Date(LAST_DAY),
    })
    expect(asked).toEqual([
      {
        host: "shop.example.com",
        port: 443,
        servername: "shop.example.com",
        rejectUnauthorized: false,
        ALPNProtocols: ["http/1.1"],
      },
    ])
    expect(made.destroyed()).toBe(true)
  })

  test("invalid: the roots refuse it, the name does not match, or the handshake fails once something answered", async () => {
    const answers: HttpsAnswer[] = [
      await probeOf({
        connect: () =>
          socket(["connect", "secureConnect"], { authorized: false }),
        check: () => undefined,
      })("shop.example.com"),
      await probeOf({
        connect: () => socket(["connect", "secureConnect"]),
        check: () => new Error("ERR_TLS_CERT_ALTNAME_INVALID"),
      })("shop.example.com"),
      await probeOf({
        connect: () => socket(["connect", "error"]),
      })("shop.example.com"),
      await probeOf({
        connect: () => socket(["connect", "secureConnect"], { cert: {} }),
        check: () => undefined,
      })("shop.example.com"),
    ]
    expect(answers).toEqual([
      { state: "invalid" },
      { state: "invalid" },
      { state: "invalid" },
      { state: "invalid" },
    ])
  })

  test("none: refused or not found before anything answered, nothing within the time, or a connection that could not be opened", async () => {
    expect(
      await probeOf({ connect: () => socket(["error"]) })("shop.example.com")
    ).toEqual({ state: "none" })
    expect(
      await probeOf({ connect: () => socket(["connect"]), ms: 30 })(
        "shop.example.com"
      )
    ).toEqual({ state: "none" })
    expect(
      await probeOf({
        connect: () => {
          throw new Error("no")
        },
      })("shop.example.com")
    ).toEqual({ state: "none" })
  })
})

/** A throwaway certificate for `name`, made by openssl in a folder of the test's, or undefined without openssl. */
function throwaway(name: string): { key: string; cert: string } | undefined {
  const dir = mkdtempSync(join(tmpdir(), "zekno-tls-"))
  const made = Bun.spawnSync(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(dir, "key.pem"),
      "-out",
      join(dir, "cert.pem"),
      "-days",
      "2",
      "-subj",
      `/CN=${name}`,
      "-addext",
      `subjectAltName=DNS:${name}`,
    ],
    { stdout: "ignore", stderr: "ignore" }
  )
  if (!made.success) return undefined
  return {
    key: readFileSync(join(dir, "key.pem"), "utf8"),
    cert: readFileSync(join(dir, "cert.pem"), "utf8"),
  }
}

const listening = <S extends { listen: (...args: never[]) => unknown }>(
  server: S & { address(): AddressInfo | string | null }
) =>
  new Promise<number>((resolve) =>
    (server.listen as (port: number, host: string, done: () => void) => void)(
      0,
      "127.0.0.1",
      () => resolve((server.address() as AddressInfo).port)
    )
  )

describe("probeHttps against a server of this test on 127.0.0.1", () => {
  const pair = (() => {
    try {
      return throwaway("shop.example.com")
    } catch {
      return undefined
    }
  })()

  test.skipIf(pair === undefined)(
    "a certificate the bundled roots do not know is invalid; a port where nothing listens, or where nothing speaks TLS, is none",
    async () => {
      const tls = tlsServer({ key: pair!.key, cert: pair!.cert }, (each) =>
        each.end()
      )
      const silent = tcpServer(() => {})
      const tlsPort = await listening(tls)
      const silentPort = await listening(silent)
      const at = (port: number) => probeOf({ host: "127.0.0.1", port, ms: 500 })
      try {
        expect(await at(tlsPort)("shop.example.com")).toEqual({
          state: "invalid",
        })
        expect(await at(silentPort)("shop.example.com")).toEqual({
          state: "none",
        })
        expect(await at(1)("shop.example.com")).toEqual({ state: "none" })
      } finally {
        tls.close()
        silent.close()
      }
    }
  )
})

/** A clock of the test's own: `sleep` moves it on. */
function clock() {
  let now = 1_000_000
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms
    },
    at: () => now,
  }
}

describe("the wait for HTTPS after a start (CL3, B4 to B6)", () => {
  test("each domain in order: waited for, asked every 2 seconds until valid, then the next", async () => {
    const time = clock()
    const told: string[] = []
    const asked: string[] = []
    const answers: Record<string, HttpsAnswer[]> = {
      "a.example.com": [
        { state: "none" },
        { state: "invalid" },
        { state: "valid", until: new Date(LAST_DAY) },
      ],
      "b.example.com": [{ state: "valid", until: new Date(LAST_DAY) }],
    }
    const began = time.now()
    const done = await waitForHttps({
      probe: async (domain) => (asked.push(domain), answers[domain]!.shift()!),
      domains: ["a.example.com", "b.example.com"],
      began,
      now: time.now,
      sleep: time.sleep,
      waiting: (domain, since) =>
        told.push(`waiting ${domain} ${since - began}`),
      answered: (result) =>
        told.push(
          `${result.domain} ${result.until === undefined ? "not ready" : "live"}`
        ),
    })
    expect(asked).toEqual([
      "a.example.com",
      "a.example.com",
      "a.example.com",
      "b.example.com",
    ])
    expect(told).toEqual([
      "waiting a.example.com 0",
      "a.example.com live",
      "waiting b.example.com 4000",
      "b.example.com live",
    ])
    expect(done).toEqual([
      { domain: "a.example.com", until: new Date(LAST_DAY) },
      { domain: "b.example.com", until: new Date(LAST_DAY) },
    ])
  })

  test("60 seconds from when it began: a domain not valid by then is not ready, and one after it is still asked once", async () => {
    const time = clock()
    const asked: string[] = []
    const done = await waitForHttps({
      probe: async (domain) => {
        asked.push(domain)
        if (domain === "late.example.com") throw new Error("reset")
        return domain === "b.example.com"
          ? { state: "valid", until: new Date(LAST_DAY) }
          : { state: "none" }
      },
      domains: ["late.example.com", "b.example.com", "c.example.com"],
      began: time.now(),
      now: time.now,
      sleep: time.sleep,
    })
    expect(done).toEqual([
      { domain: "late.example.com" },
      { domain: "b.example.com", until: new Date(LAST_DAY) },
      { domain: "c.example.com" },
    ])
    // Every 2 seconds for 60 seconds: 31 tries of the first, then one of each after it.
    expect(asked.filter((domain) => domain === "late.example.com").length).toBe(
      WAIT_MS / 2000 + 1
    )
    expect(asked.slice(-2)).toEqual(["b.example.com", "c.example.com"])
  })
})
