/**
 * Whether a release newer than the one this zekno carries has been published
 * (specs/006-cli-small-features, contracts/version.md and research R14, as
 * changed by specs/008-cli-decisions). Only `zekno version` and `zekno doctor`
 * ask, once per run each. Nothing checks in the background, nothing is cached
 * and nothing is written.
 *
 * It is one GET of a fixed address: the runner release file on the
 * repository's `main`, on GitHub's raw file host, with a fixed generic
 * `User-Agent` and no credentials, so the request says nothing about the
 * developer, their team, their servers or their project. GitHub learns the
 * address and time of the request, and that zekno runs there. The raw file
 * host is used rather than GitHub's REST API because the API allows 60
 * unauthenticated requests an hour per network address, and a shared address
 * (a VPN, a relay, an office) runs out of them.
 *
 * The answer is hostile text: whoever answers for raw.githubusercontent.com
 * (GitHub, a proxy, a certificate someone made this machine trust) may send
 * anything. So it is bounded in time and size, parsed as JSON within the
 * bound, and held to the form of the release file by the CLI's own strict
 * reader of it (`RunnerReleaseSchema`, runner-release.ts): no other field,
 * a version of the one version grammar, each checksum null or 64 lowercase
 * hex characters. A version counts as published only when both checksums are
 * there. After that check the version is digits and dots, and it is used for
 * one sentence and the `latest` field only; the checksums are only looked at.
 * Nothing is downloaded, installed or run because of it. Any failure, of any
 * kind, is "not checked"; this never throws.
 *
 * The fetch is `deps.fetch`, which only main.ts sets. Without it nothing is
 * requested, so no test and no other code path can reach the network.
 */
import { compareRunnerVersions, isDevVersion } from "@workspace/core"

import type { Deps } from "../cli/context"
import { RunnerReleaseSchema } from "./runner-release"

/**
 * The runner release file on `main`, where feature 007 put it. On `main` it
 * never names a development version (the `check-main` workflow holds that).
 * The branch is named by its full ref, `refs/heads/main`, so a tag named
 * `main` can never stand in for it. If the file moves again, older builds say
 * they could not check; they never say something false.
 */
export const RELEASE_FILE =
  "https://raw.githubusercontent.com/zekno-app/zekno/refs/heads/main/apps/cli/src/version/runner-release.json"

/** The only host a redirect may lead to. */
const HOST = "raw.githubusercontent.com"

/** Every header the request carries: the application's name, and nothing about this machine. */
const HEADERS = { "User-Agent": "zekno" } as const

/** How long the whole check may take: connecting, every redirect and reading the body. */
export const NEWEST_LIMIT_MS = 3000

/** The most of an answer that is read: 16 KiB. The release file is under 300 bytes. */
export const NEWEST_BODY_LIMIT = 16_384

/** How many redirects in a row are followed. */
const REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 307, 308])

/** What the check found out. */
export type Latest =
  | { state: "newest" }
  | { state: "newer"; version: string }
  | { state: "not_checked" }

/** The three sentences of mock-up 6 (V1, V2, V3). */
export const NEWEST = "This is the newest release."
export const newerExists = (version: string): string =>
  `A newer release exists: ${version}. Update zekno to get it.`
export const NOT_CHECKED = "Could not check for a newer release."

const notChecked: Latest = { state: "not_checked" }

/** One HTTPS request, as `fetch` makes it. main.ts hands in Bun's own; tests a stand-in. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>

/** Rejects once `signal` fires, so that a request or a read that does not heed the signal still ends then. */
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    else
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      })
  })
}

/** Lets go of a body that is not read. Whatever that does, it is not this check's concern. */
function drop(response: Response): void {
  try {
    void response.body?.cancel().catch(() => {})
  } catch {
    // Nothing more to let go of.
  }
}

/**
 * The next address for a redirect, only when it is `https:` on
 * raw.githubusercontent.com itself: no other host, no port, no name and
 * password, which the request would then carry.
 */
function nextAddress(
  location: string | null,
  current: string
): string | undefined {
  if (location === null) return undefined
  let target: URL
  try {
    target = new URL(location, current)
  } catch {
    return undefined
  }
  if (
    target.protocol !== "https:" ||
    target.hostname !== HOST ||
    target.port !== "" ||
    target.username !== "" ||
    target.password !== ""
  )
    return undefined
  return target.href
}

/** The body, read from its stream, or undefined past `NEWEST_BODY_LIMIT` bytes. Past the limit, at the end, or on the time limit the reading is cancelled. */
async function bodyOf(
  response: Response,
  stop: Promise<never>
): Promise<Uint8Array | undefined> {
  const body = response.body
  if (!body) return new Uint8Array(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), stop])
      if (done) break
      size += value.byteLength
      if (size > NEWEST_BODY_LIMIT) return undefined
      chunks.push(value)
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return bytes
}

/**
 * The release a file names: its version, and whether it is published (both
 * checksums there). Undefined when the file is not in the form the CLI's own
 * reader accepts, or names a development version.
 */
function releaseIn(
  json: unknown
): { version: string; published: boolean } | undefined {
  const read = RunnerReleaseSchema.safeParse(json)
  if (!read.success) return undefined
  const { version, files } = read.data
  if (isDevVersion(version)) return undefined
  return {
    version,
    published:
      files["linux-x64"].sha256 !== null &&
      files["linux-arm64"].sha256 !== null,
  }
}

/** The request and its answer, as "The check" in contracts/version.md says. Throws on anything that is not a good answer. */
async function ask(
  fetch: Fetch,
  carried: string,
  signal: AbortSignal,
  stop: Promise<never>
): Promise<Latest> {
  let address = RELEASE_FILE
  for (let followed = 0; ; followed++) {
    const response = await Promise.race([
      fetch(address, {
        method: "GET",
        headers: HEADERS,
        redirect: "manual",
        signal,
      }),
      stop,
    ])
    if (REDIRECT_STATUSES.has(response.status)) {
      drop(response)
      const next =
        followed < REDIRECTS
          ? nextAddress(response.headers.get("location"), address)
          : undefined
      if (next === undefined) return notChecked
      address = next
      continue
    }
    if (response.status !== 200) {
      drop(response)
      return notChecked
    }
    const bytes = await bodyOf(response, stop)
    if (bytes === undefined) return notChecked
    const release = releaseIn(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    )
    if (release === undefined) return notChecked
    const higher = compareRunnerVersions(release.version, carried) > 0
    // A higher version without both checksums cannot be installed yet (its second build has not run): it is not announced.
    return higher && release.published
      ? { state: "newer", version: release.version }
      : { state: "newest" }
  }
}

/**
 * Asks once whether a release newer than `carried` (the runner release this
 * zekno carries) is published. Resolves within `limitMs` (3 seconds unless
 * given), and never rejects: any failure is `not_checked`.
 */
export async function checkNewest(
  deps: Pick<Deps, "fetch">,
  carried: string,
  options: { limitMs?: number } = {}
): Promise<Latest> {
  const fetch = deps.fetch
  if (fetch === undefined) return notChecked
  try {
    const signal = AbortSignal.timeout(options.limitMs ?? NEWEST_LIMIT_MS)
    const stop = whenAborted(signal)
    // Nothing waits for it once the check is over; its rejection is not a failure of anything.
    stop.catch(() => {})
    return await ask(fetch, carried, signal, stop)
  } catch {
    return notChecked
  }
}
