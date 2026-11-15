/**
 * The check for a newer release (specs/006-cli-small-features,
 * contracts/version.md, "The check"; FR-033 to FR-035). Every answer here
 * comes from a stand-in `fetch` handed in as `deps.fetch`: no test reaches
 * the network. Each case is awaited without `try`, because `checkNewest`
 * never rejects.
 */
import { describe, expect, test } from "bun:test"

import { checkNewest, RELEASES_LATEST, type Latest } from "../../src/version/newest"

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

const answer = (body: string | Uint8Array, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers })
const release = (fields: Record<string, unknown>) => answer(JSON.stringify(fields))
const tagged = (tag: unknown) => release({ tag_name: tag, prerelease: false, draft: false })

/** What one answer gives, for a zekno that carries `carried`. */
async function given(response: () => Response | Promise<Response>, carried = "0.1.0", limitMs?: number): Promise<Latest> {
  const { fetch } = standIn(response)
  return checkNewest({ fetch }, carried, limitMs === undefined ? {} : { limitMs })
}

const NOT_CHECKED: Latest = { state: "not_checked" }
const LIMIT = 262_144

/**
 * A body sent in chunks of `chunk` bytes from `bytes`, read only as it is
 * asked for (no read ahead), that notes how much was taken and whether the
 * reading was cancelled. `stopAt` sends that many bytes and then nothing,
 * never ending.
 */
function streamed(bytes: Uint8Array, options: { chunk?: number; stopAt?: number } = {}) {
  const chunk = options.chunk ?? 16_384
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
  test("one GET of the fixed address, with exactly the three headers, no credentials, no body, manual redirects and a time limit", async () => {
    const { fetch, calls } = standIn(() => tagged("runner-v0.1.0"))
    expect(await checkNewest({ fetch }, "0.1.0")).toEqual({ state: "newest" })
    expect(calls).toHaveLength(1)
    const [{ url, init }] = calls as [Call]
    expect(url).toBe("https://api.github.com/repos/zekno-app/zekno/releases/latest")
    expect(RELEASES_LATEST).toBe(url)
    expect(init.method === undefined || init.method === "GET").toBe(true)
    expect([...new Headers(init.headers).entries()].sort()).toEqual([
      ["accept", "application/vnd.github+json"],
      ["user-agent", "zekno"],
      ["x-github-api-version", "2026-03-10"],
    ])
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
  test("a newer published release is newer; the same or an older one is the newest", async () => {
    expect(await given(() => release({ tag_name: "runner-v0.2.0", prerelease: false, draft: false }))).toEqual({ state: "newer", version: "0.2.0" })
    expect(await given(() => tagged("runner-v0.1.0"))).toEqual({ state: "newest" })
    expect(await given(() => tagged("runner-v0.0.9"))).toEqual({ state: "newest" })
    expect(await given(() => tagged("runner-v1.0.0"))).toEqual({ state: "newer", version: "1.0.0" })
  })

  test("a development build is compared the same way: 0.1.0-dev.1 is told that 0.1.0 exists", async () => {
    expect(await given(() => tagged("runner-v0.1.0"), "0.1.0-dev.1")).toEqual({ state: "newer", version: "0.1.0" })
    expect(await given(() => tagged("runner-v0.1.0"), "0.2.0-dev.1")).toEqual({ state: "newest" })
  })

  test("without the prerelease and draft fields it still counts; a pre-release, a draft or a development version does not", async () => {
    expect(await given(() => release({ tag_name: "runner-v0.2.0" }))).toEqual({ state: "newer", version: "0.2.0" })
    expect(await given(() => tagged("runner-v0.2.0-dev.1"))).toEqual(NOT_CHECKED)
    expect(await given(() => release({ tag_name: "runner-v0.2.0", prerelease: true, draft: false }))).toEqual(NOT_CHECKED)
    expect(await given(() => release({ tag_name: "runner-v0.2.0", prerelease: false, draft: true }))).toEqual(NOT_CHECKED)
    expect(await given(() => release({ tag_name: "runner-v0.2.0", prerelease: "false" }))).toEqual(NOT_CHECKED)
    expect(await given(() => release({ tag_name: "runner-v0.2.0", draft: null }))).toEqual(NOT_CHECKED)
  })

  test("a tag that is not runner-v and a version of the grammar is not checked", async () => {
    const tags: unknown[] = [
      "v0.2.0",
      "runner-v0.2",
      "runner-v0.2.0 ",
      "runner-v0.2.0\n",
      " runner-v0.2.0",
      "runner-v01.2.0",
      "runner-v0.2.0+1",
      `runner-v${"1".repeat(200)}`,
      "runner-v٠.٢.٠",
      "Runner-v0.2.0",
      "runner-v0.2.0\u0000",
      2,
      null,
      ["runner-v0.2.0"],
      { tag: "runner-v0.2.0" },
    ]
    for (const tag of tags) expect({ tag, latest: await given(() => tagged(tag)) }).toEqual({ tag, latest: NOT_CHECKED })
    expect(await given(() => release({ name: "runner-v0.2.0", prerelease: false, draft: false }))).toEqual(NOT_CHECKED)
  })

  test("a body that is not one JSON object in UTF-8 is not checked", async () => {
    for (const body of ["[]", '"x"', "null", "2", "not json", "", '{"tag_name":"runner-v0.2.0"', new Uint8Array([0xff]), new Uint8Array([0x7b, 0xff, 0x7d])]) {
      expect(await given(() => answer(body))).toEqual(NOT_CHECKED)
    }
  })

  test("a body larger than 262,144 bytes is not read past the limit: the reading stops and is cancelled", async () => {
    const head = '{"tag_name":"runner-v0.2.0","prerelease":false,"draft":false,"pad":"'
    const text = `${head}${"x".repeat(LIMIT + 1 - head.length - 2)}"}`
    const bytes = new TextEncoder().encode(text)
    expect(bytes.length).toBe(LIMIT + 1)
    const huge = streamed(bytes)
    expect(await given(() => huge.response)).toEqual(NOT_CHECKED)
    expect(huge.pulled()).toBeLessThanOrEqual(LIMIT + 16_384)
    expect(huge.cancelled()).toBe(true)
    // Just within the limit, the same object is read.
    const fits = new TextEncoder().encode(`${head}${"x".repeat(LIMIT - head.length - 2)}"}`)
    expect(fits.length).toBe(LIMIT)
    expect(await given(() => streamed(fits).response)).toEqual({ state: "newer", version: "0.2.0" })
  })

  test("other fields of the answer are never kept: only the version of tag_name comes back", async () => {
    const latest = await given(() =>
      release({ tag_name: "runner-v0.2.0", prerelease: false, draft: false, name: "\x1b[2J", body: "\x1b]52;c;ZXZpbA==\x07", version: "9.9.9", assets: [{ url: "https://evil.example/x" }] })
    )
    expect(latest).toEqual({ state: "newer", version: "0.2.0" })
    expect(Object.keys(latest)).toEqual(["state", "version"])
  })

  test("only status 200 counts", async () => {
    for (const status of [201, 204, 304, 403, 404, 410, 429, 500, 503]) {
      const body = status === 204 || status === 304 ? null : JSON.stringify({ tag_name: "runner-v0.2.0", prerelease: false, draft: false })
      expect({ status, latest: await given(() => new Response(body, { status })) }).toEqual({ status, latest: NOT_CHECKED })
    }
  })
})

describe("redirects", () => {
  const moved = (status: number, location?: string) => new Response(null, { status, headers: location === undefined ? {} : { location } })

  test("a redirect to https on api.github.com is followed once, with the same headers", async () => {
    for (const status of [301, 302, 307, 308]) {
      const { fetch, calls } = standIn((_call, index) => (index === 0 ? moved(status, "https://api.github.com/repositories/1/releases/latest") : tagged("runner-v0.2.0")))
      expect(await checkNewest({ fetch }, "0.1.0")).toEqual({ state: "newer", version: "0.2.0" })
      expect(calls.map((call) => call.url)).toEqual([RELEASES_LATEST, "https://api.github.com/repositories/1/releases/latest"])
      expect([...new Headers(calls[1]!.init.headers).entries()]).toEqual([...new Headers(calls[0]!.init.headers).entries()])
      expect(calls[1]!.init.redirect).toBe("manual")
    }
  })

  test("a redirect anywhere else, or with no Location, is not followed", async () => {
    for (const location of [
      "http://api.github.com/repositories/1/releases/latest",
      "https://evil.example/repos/zekno-app/zekno/releases/latest",
      "https://api.github.com.evil.example/x",
      "https://api.github.com:8443/x",
      "https://user:pass@api.github.com/x",
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
    const { fetch, calls } = standIn((_call, index) => moved(302, `https://api.github.com/hop/${index + 1}`))
    expect(await checkNewest({ fetch }, "0.1.0")).toEqual(NOT_CHECKED)
    expect(calls.map((call) => call.url)).toEqual([RELEASES_LATEST, "https://api.github.com/hop/1", "https://api.github.com/hop/2", "https://api.github.com/hop/3"])
    const three = standIn((_call, index) => (index < 3 ? moved(301, `https://api.github.com/hop/${index + 1}`) : tagged("runner-v0.2.0")))
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
    const half = streamed(new TextEncoder().encode(JSON.stringify({ tag_name: "runner-v0.2.0", prerelease: false, draft: false })), { stopAt: 20 })
    const started = Date.now()
    expect(await given(() => half.response, "0.1.0", 100)).toEqual(NOT_CHECKED)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(half.cancelled()).toBe(true)
  })

  test("the limit covers redirects too: a slow second answer ends at the limit", async () => {
    const started = Date.now()
    const { fetch } = standIn((_call, index) => (index === 0 ? new Response(null, { status: 301, headers: { location: "https://api.github.com/x" } }) : new Promise<Response>(() => {})))
    expect(await checkNewest({ fetch }, "0.1.0", { limitMs: 100 })).toEqual(NOT_CHECKED)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  test("a carried version that is not one cannot be compared, and is not checked", async () => {
    expect(await given(() => tagged("runner-v0.2.0"), "zero")).toEqual(NOT_CHECKED)
  })
})
