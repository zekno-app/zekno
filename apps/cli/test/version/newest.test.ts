/**
 * The check for a newer release (specs/006-cli-small-features,
 * contracts/version.md, "The check"; FR-033 to FR-035; the address and the
 * answer's form as specs/008-cli-decisions changed them). Every answer here
 * comes from a stand-in `fetch` handed in as `deps.fetch`: no test reaches
 * the network. Each case is awaited without `try`, because `checkNewest`
 * never rejects.
 */
import { describe, expect, test } from "bun:test"

import { checkNewest, NEWEST_BODY_LIMIT, RELEASE_FILE, type Latest } from "../../src/version/newest"

type Call = { url: string; init: RequestInit }

/** A stand-in for `fetch` that writes down each call and answers from `script`. */
function standIn(script: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    const call = { url, init }
    calls.push(call)
    return Promise.resolve().then(() => script(call, calls.length - 1))
  }
  return { fetch, calls }
}

/** Two checksums in the form the release file holds them: 64 lowercase hex characters. */
const X64 = "0123456789abcdef".repeat(4)
const ARM64 = "fedcba9876543210".repeat(4)

/** The release file's form: a version, and the checksum of each file, or null before its second build. */
const file = (version: unknown, x64: unknown = X64, arm64: unknown = ARM64) => ({ version, files: { "linux-x64": { sha256: x64 }, "linux-arm64": { sha256: arm64 } } })

const answer = (body: string | Uint8Array | null, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers })
const release = (fields: unknown) => answer(JSON.stringify(fields))
/** A file that names `version` with both checksums: a published release. */
const named = (version: unknown) => release(file(version))

/** What one answer gives, for a zekno that carries `carried`. */
async function given(response: () => Response | Promise<Response>, carried = "0.1.0", limitMs?: number): Promise<Latest> {
  const { fetch } = standIn(response)
  return checkNewest({ fetch }, carried, limitMs === undefined ? {} : { limitMs })
}

const NOT_CHECKED: Latest = { state: "not_checked" }
const NEWEST: Latest = { state: "newest" }
const LIMIT = 16_384

/**
 * A body sent in chunks of `chunk` bytes from `bytes`, read only as it is
 * asked for (no read ahead), that notes how much was taken and whether the
 * reading was cancelled. `stopAt` sends that many bytes and then nothing,
 * never ending.
 */
function streamed(bytes: Uint8Array, options: { chunk?: number; stopAt?: number } = {}) {
  const chunk = options.chunk ?? 1024
  let pulled = 0
  let cancelled = false
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (options.stopAt !== undefined && pulled >= options.stopAt) return new Promise<void>(() => {})
        if (pulled >= bytes.length) return controller.close()
        const end = Math.min(pulled + chunk, bytes.length, options.stopAt ?? Infinity)
        controller.enqueue(bytes.slice(pulled, end))
        pulled = end
      },
      cancel() {
        cancelled = true
      },
    },
    { highWaterMark: 0 }
  )
  const response = { status: 200, headers: new Headers(), body } as unknown as Response
  return { response, pulled: () => pulled, cancelled: () => cancelled }
}

describe("the request", () => {
  test("one GET of the fixed address, with exactly the one header, no credentials, no body, manual redirects and a time limit", async () => {
    const { fetch, calls } = standIn(() => named("0.1.0"))
    expect(await checkNewest({ fetch }, "0.1.0")).toEqual(NEWEST)
    expect(calls).toHaveLength(1)
    const [{ url, init }] = calls as [Call]
    expect(url).toBe("https://raw.githubusercontent.com/zekno-app/zekno/refs/heads/main/apps/cli/src/version/runner-release.json")
    expect(RELEASE_FILE).toBe(url)
    expect(init.method === undefined || init.method === "GET").toBe(true)
    // The API's own headers (Accept, X-GitHub-Api-Version) are gone: only the application's name is sent.
    expect([...new Headers(init.headers).entries()].sort()).toEqual([["user-agent", "zekno"]])
    expect(init.body).toBeUndefined()
    expect(init.redirect).toBe("manual")
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(Object.keys(init).sort()).toEqual(["headers", "method", "redirect", "signal"])
  })

  test("with no fetch handed in, nothing is asked and the answer is not checked", async () => {
    expect(await checkNewest({}, "0.1.0")).toEqual(NOT_CHECKED)
    expect(await checkNewest({ fetch: undefined }, "0.1.0")).toEqual(NOT_CHECKED)
  })
})

describe("the answer", () => {
  test("a higher version with both checksums is newer; the same or a lower one is the newest", async () => {
    expect(await given(() => named("0.2.0"))).toEqual({ state: "newer", version: "0.2.0" })
    expect(await given(() => named("0.1.0"))).toEqual(NEWEST)
    expect(await given(() => named("0.0.9"))).toEqual(NEWEST)
    expect(await given(() => named("1.0.0"))).toEqual({ state: "newer", version: "1.0.0" })
  })

  test("a higher version with one checksum or none cannot be installed yet: it is not announced, this is the newest", async () => {
    for (const [x64, arm64] of [
      [null, null],
      [X64, null],
      [null, ARM64],
    ] as const) {
      expect({ x64, arm64, latest: await given(() => release(file("0.2.0", x64, arm64))) }).toEqual({ x64, arm64, latest: NEWEST })
    }
    // The same or a lower version without checksums is the newest too.
    expect(await given(() => release(file("0.1.0", null, null)))).toEqual(NEWEST)
    expect(await given(() => release(file("0.0.9", null, null)))).toEqual(NEWEST)
  })

  test("a development build is compared the same way: 0.1.0-dev.1 is told that 0.1.0 exists, once both checksums are there", async () => {
    expect(await given(() => named("0.1.0"), "0.1.0-dev.1")).toEqual({ state: "newer", version: "0.1.0" })
    expect(await given(() => release(file("0.1.0", null, null)), "0.1.0-dev.1")).toEqual(NEWEST)
    expect(await given(() => named("0.1.0"), "0.2.0-dev.1")).toEqual(NEWEST)
  })

  test("a file that names a development version is not checked: on main it never names one", async () => {
    expect(await given(() => named("0.2.0-dev.1"))).toEqual(NOT_CHECKED)
    expect(await given(() => release(file("0.2.0-dev.1", null, null)))).toEqual(NOT_CHECKED)
    expect(await given(() => named("0.1.0-dev.2"), "0.1.0-dev.1")).toEqual(NOT_CHECKED)
  })

  test("a version that is not one of the grammar is not checked", async () => {
    const versions: unknown[] = [
      "v0.2.0",
      "runner-v0.2.0",
      "0.2",
      "0.2.0 ",
      "0.2.0\n",
      " 0.2.0",
      "01.2.0",
      "0.2.0+1",
      "1234567890.0.0",
      "1".repeat(200),
      "٠.٢.٠",
      "0.2.0\u0000",
      "",
      2,
      null,
      ["0.2.0"],
      { version: "0.2.0" },
    ]
    for (const version of versions) expect({ version, latest: await given(() => named(version)) }).toEqual({ version, latest: NOT_CHECKED })
    expect(await given(() => release({ files: file("0.2.0").files }))).toEqual(NOT_CHECKED)
  })

  test("a checksum that is not null or 64 lowercase hex characters is not checked, for either file", async () => {
    const wrong: unknown[] = [
      X64.toUpperCase(),
      X64.slice(1),
      `${X64}0`,
      "g".repeat(64),
      `${X64}\n`,
      ` ${X64}`,
      `sha256:${X64}`,
      "",
      0,
      true,
      [X64],
      {},
    ]
    for (const sum of wrong) {
      expect({ sum, latest: await given(() => release(file("0.2.0", sum, ARM64))) }).toEqual({ sum, latest: NOT_CHECKED })
      expect({ sum, latest: await given(() => release(file("0.2.0", X64, sum))) }).toEqual({ sum, latest: NOT_CHECKED })
    }
    // A checksum's field left out is not null: the form says null.
    expect(await given(() => release({ version: "0.2.0", files: { "linux-x64": {}, "linux-arm64": { sha256: ARM64 } } }))).toEqual(NOT_CHECKED)
  })

  test("a file with a field the form does not have, or a field of the wrong type, is not checked", async () => {
    const good = file("0.2.0")
    const bodies: unknown[] = [
      { ...good, notes: "\x1b]52;c;ZXZpbA==\x07" },
      { ...good, url: "https://evil.example/x" },
      { ...good, files: { ...good.files, "darwin-arm64": { sha256: X64 } } },
      { ...good, files: { ...good.files, "linux-x64": { sha256: X64, url: "https://evil.example/x" } } },
      { version: "0.2.0" },
      { version: "0.2.0", files: null },
      { version: "0.2.0", files: [] },
      { version: "0.2.0", files: { "linux-x64": null, "linux-arm64": { sha256: ARM64 } } },
      { version: "0.2.0", files: { "linux-x64": { sha256: X64 } } },
      [good],
      { tag_name: "runner-v0.2.0", prerelease: false, draft: false },
    ]
    for (const body of bodies) expect({ body, latest: await given(() => release(body)) }).toEqual({ body, latest: NOT_CHECKED })
    // A `__proto__` key is a field of its own once parsed, and the form has none.
    const proto = `{"__proto__":{"polluted":true},${JSON.stringify(good).slice(1)}`
    expect(await given(() => answer(proto))).toEqual(NOT_CHECKED)
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
  })

  test("only the version comes back: the checksums and the rest of the file are never kept", async () => {
    const latest = await given(() => named("0.2.0"))
    expect(latest).toEqual({ state: "newer", version: "0.2.0" })
    expect(Object.keys(latest)).toEqual(["state", "version"])
  })

  test("a body that is not one JSON object in UTF-8 is not checked", async () => {
    for (const body of ["[]", '"x"', "null", "2", "not json", "<html>\x1b[2J</html>", "", '{"version":"0.2.0"', new Uint8Array([0xff]), new Uint8Array([0x7b, 0xff, 0x7d])]) {
      expect(await given(() => answer(body))).toEqual(NOT_CHECKED)
    }
  })

  test("a body larger than 16,384 bytes is not read past the limit: the reading stops and is cancelled", async () => {
    expect(NEWEST_BODY_LIMIT).toBe(LIMIT)
    // The release file padded with spaces, which JSON allows, to one byte over the limit.
    const text = JSON.stringify(file("0.2.0"))
    const over = new TextEncoder().encode(`${text}${" ".repeat(LIMIT + 1 - text.length)}`)
    expect(over.length).toBe(LIMIT + 1)
    const huge = streamed(over)
    expect(await given(() => huge.response)).toEqual(NOT_CHECKED)
    expect(huge.pulled()).toBeLessThanOrEqual(LIMIT + 1024)
    expect(huge.cancelled()).toBe(true)
    // Far over it, the same: nothing past the limit is taken.
    const mib = streamed(new TextEncoder().encode(`${text}${" ".repeat(1_048_576)}`))
    expect(await given(() => mib.response)).toEqual(NOT_CHECKED)
    expect(mib.pulled()).toBeLessThanOrEqual(LIMIT + 1024)
    expect(mib.cancelled()).toBe(true)
    // Just within the limit, the same file is read.
    const fits = new TextEncoder().encode(`${text}${" ".repeat(LIMIT - text.length)}`)
    expect(fits.length).toBe(LIMIT)
    expect(await given(() => streamed(fits).response)).toEqual({ state: "newer", version: "0.2.0" })
  })

  test("only status 200 counts", async () => {
    for (const status of [201, 204, 304, 403, 404, 410, 429, 500, 503]) {
      const body = status === 204 || status === 304 ? null : JSON.stringify(file("0.2.0"))
      expect({ status, latest: await given(() => answer(body, status)) }).toEqual({ status, latest: NOT_CHECKED })
    }
  })
})

describe("redirects", () => {
  const moved = (status: number, location?: string) => new Response(null, { status, headers: location === undefined ? {} : { location } })
  const ELSEWHERE = "https://raw.githubusercontent.com/zekno-app/zekno/refs/heads/release/apps/cli/src/version/runner-release.json"

  test("a redirect to https on raw.githubusercontent.com is followed, with the same headers", async () => {
    for (const status of [301, 302, 307, 308]) {
      const { fetch, calls } = standIn((_call, index) => (index === 0 ? moved(status, ELSEWHERE) : named("0.2.0")))
      expect(await checkNewest({ fetch }, "0.1.0")).toEqual({ state: "newer", version: "0.2.0" })
      expect(calls.map((call) => call.url)).toEqual([RELEASE_FILE, ELSEWHERE])
      expect([...new Headers(calls[1]!.init.headers).entries()]).toEqual([...new Headers(calls[0]!.init.headers).entries()])
      expect(calls[1]!.init.redirect).toBe("manual")
    }
  })

  test("a redirect anywhere else, or with no Location, is not followed: another host, http, a port, a user name", async () => {
    for (const location of [
      "http://raw.githubusercontent.com/zekno-app/zekno/refs/heads/main/apps/cli/src/version/runner-release.json",
      "https://evil.example/zekno-app/zekno/refs/heads/main/apps/cli/src/version/runner-release.json",
      "https://raw.githubusercontent.com.evil.example/x",
      "https://api.github.com/repos/zekno-app/zekno/releases/latest",
      "https://github.com/zekno-app/zekno/raw/main/apps/cli/src/version/runner-release.json",
      "https://raw.githubusercontent.com:8443/x",
      "https://user:pass@raw.githubusercontent.com/x",
      "https://user@raw.githubusercontent.com/x",
      "//evil.example/x",
      "file:///etc/passwd",
      "https://[::1]/x",
      undefined,
    ]) {
      const { fetch, calls } = standIn(() => moved(302, location))
      expect({ location, latest: await checkNewest({ fetch }, "0.1.0") }).toEqual({ location, latest: NOT_CHECKED })
      expect(calls).toHaveLength(1)
    }
  })

  test("at most three redirects in a row are followed: a fourth is not", async () => {
    const hop = (n: number) => `https://raw.githubusercontent.com/hop/${n}`
    const { fetch, calls } = standIn((_call, index) => moved(302, hop(index + 1)))
    expect(await checkNewest({ fetch }, "0.1.0")).toEqual(NOT_CHECKED)
    expect(calls.map((call) => call.url)).toEqual([RELEASE_FILE, hop(1), hop(2), hop(3)])
    const three = standIn((_call, index) => (index < 3 ? moved(301, hop(index + 1)) : named("0.2.0")))
    expect(await checkNewest({ fetch: three.fetch }, "0.1.0")).toEqual({ state: "newer", version: "0.2.0" })
    expect(three.calls).toHaveLength(4)
  })
})

describe("failures and the time limit", () => {
  test("a fetch that rejects or throws is not checked", async () => {
    expect(await checkNewest({ fetch: () => Promise.reject(new TypeError("fetch failed")) }, "0.1.0")).toEqual(NOT_CHECKED)
    expect(
      await checkNewest(
        {
          fetch: () => {
            throw new Error("no")
          },
        },
        "0.1.0"
      )
    ).toEqual(NOT_CHECKED)
  })

  test("a fetch that never answers ends at the limit", async () => {
    const started = Date.now()
    expect(await checkNewest({ fetch: () => new Promise<Response>(() => {}) }, "0.1.0", { limitMs: 100 })).toEqual(NOT_CHECKED)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test("a body that sends half and stops ends at the limit, and its reading is cancelled", async () => {
    const half = streamed(new TextEncoder().encode(JSON.stringify(file("0.2.0"))), { stopAt: 20 })
    const started = Date.now()
    expect(await given(() => half.response, "0.1.0", 100)).toEqual(NOT_CHECKED)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(half.cancelled()).toBe(true)
  })

  test("the limit covers redirects too: a slow second answer ends at the limit", async () => {
    const started = Date.now()
    const { fetch } = standIn((_call, index) =>
      index === 0 ? new Response(null, { status: 301, headers: { location: "https://raw.githubusercontent.com/x" } }) : new Promise<Response>(() => {})
    )
    expect(await checkNewest({ fetch }, "0.1.0", { limitMs: 100 })).toEqual(NOT_CHECKED)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test("a carried version that is not one cannot be compared, and is not checked", async () => {
    expect(await given(() => named("0.2.0"), "zero")).toEqual(NOT_CHECKED)
    expect(await given(() => release(file("0.2.0", null, null)), "zero")).toEqual(NOT_CHECKED)
  })
})
