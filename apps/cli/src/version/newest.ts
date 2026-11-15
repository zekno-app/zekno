/**
 * Whether a release newer than the one this zekno carries has been published
 * (specs/006-cli-small-features, contracts/version.md and research R14). Only
 * `zekno version` and `zekno doctor` ask, once per run each. Nothing checks in
 * the background, nothing is cached and nothing is written.
 *
 * It is one GET of a fixed address on GitHub's REST API, with a fixed generic
 * `User-Agent` and no credentials, so the request says nothing about the
 * developer, their team, their servers or their project. GitHub learns the
 * address and time of the request, and that zekno runs there.
 *
 * The answer is hostile text: whoever answers for api.github.com (GitHub, a
 * proxy, a certificate someone made this machine trust) may send anything.
 * So it is bounded in time and size, parsed as JSON within the bound, and only
 * one field is read: `tag_name`, which must be `runner-v` followed by a prod
 * version of the one version grammar. After that check the version is digits
 * and dots, and it is used for one sentence and the `latest` field only.
 * Nothing is downloaded, installed or run because of it. Any failure, of any
 * kind, is "not checked"; this never throws.
 *
 * The fetch is `deps.fetch`, which only main.ts sets. Without it nothing is
 * requested, so no test and no other code path can reach the network.
 */
import { compareRunnerVersions, isDevVersion, RUNNER_VERSION_PATTERN } from "@workspace/core"

import type { Deps } from "../cli/context"

/** GitHub's latest published release of zekno: the newest that is neither a pre-release nor a draft. */
export const RELEASES_LATEST = "https://api.github.com/repos/zekno-app/zekno/releases/latest"

/** The only host a redirect may lead to. */
const HOST = "api.github.com"

/**
 * Every header the request carries. GitHub asks for a `User-Agent`, and for
 * the application's name in it; it says nothing about this machine. The API
 * version is pinned; once GitHub stops serving it, it answers 410 and the
 * check says it could not check.
 */
const HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "zekno" } as const

/** How long the whole check may take: connecting, every redirect and reading the body. */
export const NEWEST_LIMIT_MS = 3000

/** The most of an answer that is read. A release's answer with its notes is well under it. */
export const NEWEST_BODY_LIMIT = 262_144

/** How many redirects in a row are followed. */
const REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 307, 308])

/** A release tag: `runner-v` and a version of the core's grammar, nothing before or after. */
const TAG = new RegExp(`^runner-v(${RUNNER_VERSION_PATTERN.source.replace(/^\^/, "").replace(/\$$/, "")})$`)

/** What the check found out. */
export type Latest = { state: "newest" } | { state: "newer"; version: string } | { state: "not_checked" }

/** The three sentences of mock-up 6 (V1, V2, V3). */
export const NEWEST = "This is the newest release."
export const newerExists = (version: string): string => `A newer release exists: ${version}. Update zekno to get it.`
export const NOT_CHECKED = "Could not check for a newer release."

const notChecked: Latest = { state: "not_checked" }

/** One HTTPS request, as `fetch` makes it. main.ts hands in Bun's own; tests a stand-in. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>

/** Rejects once `signal` fires, so that a request or a read that does not heed the signal still ends then. */
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true })
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
 * The next address for a redirect, only when it is `https:` on api.github.com
 * itself: no other host, no port, no name and password, which the request
 * would then carry.
 */
function nextAddress(location: string | null, current: string): string | undefined {
  if (location === null) return undefined
  let target: URL
  try {
    target = new URL(location, current)
  } catch {
    return undefined
  }
  if (target.protocol !== "https:" || target.hostname !== HOST || target.port !== "" || target.username !== "" || target.password !== "") return undefined
  return target.href
}

/** The body, read from its stream, or undefined past `NEWEST_BODY_LIMIT` bytes. Past the limit, at the end, or on the time limit the reading is cancelled. */
async function bodyOf(response: Response, stop: Promise<never>): Promise<Uint8Array | undefined> {
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

/** The version a release answer names, when it is one object whose `tag_name` is a prod release tag and that is neither a pre-release nor a draft. */
function versionIn(json: unknown): string | undefined {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return undefined
  const answer = json as { [field: string]: unknown }
  const tag = Object.hasOwn(answer, "tag_name") ? answer.tag_name : undefined
  if (typeof tag !== "string") return undefined
  const version = TAG.exec(tag)?.[1]
  if (version === undefined || isDevVersion(version)) return undefined
  for (const field of ["prerelease", "draft"]) {
    if (Object.hasOwn(answer, field) && answer[field] !== false) return undefined
  }
  return version
}

/** The request and its answer, as "The check" in contracts/version.md says. Throws on anything that is not a good answer. */
async function ask(fetch: Fetch, carried: string, signal: AbortSignal, stop: Promise<never>): Promise<Latest> {
  let address = RELEASES_LATEST
  for (let followed = 0; ; followed++) {
    const response = await Promise.race([fetch(address, { method: "GET", headers: HEADERS, redirect: "manual", signal }), stop])
    if (REDIRECT_STATUSES.has(response.status)) {
      drop(response)
      const next = followed < REDIRECTS ? nextAddress(response.headers.get("location"), address) : undefined
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
    const version = versionIn(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
    if (version === undefined) return notChecked
    return compareRunnerVersions(version, carried) > 0 ? { state: "newer", version } : { state: "newest" }
  }
}

/**
 * Asks once whether a release newer than `carried` (the runner release this
 * zekno carries) is published. Resolves within `limitMs` (3 seconds unless
 * given), and never rejects: any failure is `not_checked`.
 */
export async function checkNewest(deps: Pick<Deps, "fetch">, carried: string, options: { limitMs?: number } = {}): Promise<Latest> {
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
