/**
 * Resolves each image tag of `pins.json` to its multi-processor index
 * digest, over plain HTTPS with the registry's anonymous token: no Docker,
 * no credentials, no package (specs/016-build-from-source, plan item 2;
 * rule LC10). It prints one line per image and ends with status 1 when one
 * differs from the file or cannot be read.
 *
 * Every digest is fetched on two networks, the Mac's and GitHub's, and the
 * two prints are compared before the file is trusted (quickstart.md,
 * "Results"; T023).
 *
 *   bun --no-env-file apps/runner/test/support/linux-server/digests.ts
 */
import { loadPins, type Pins } from "./pins"

const DOCKER_HUB = "https://registry-1.docker.io"
const OCI_INDEX = "application/vnd.oci.image.index.v1+json"
const DOCKER_LIST = "application/vnd.docker.distribution.manifest.list.v2+json"
const ONE_PROCESSOR = [
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
]
/** The processors the stand-in runs on: GitHub's x86-64 and the Mac's ARM64. */
const NEEDED = ["linux/amd64", "linux/arm64"]
const MAX_REDIRECTS = 3
const TIMEOUT_MS = 30_000
const TAG =
  /^([a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*):([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})$/
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"])

type Fetch = (url: URL, init: RequestInit) => Promise<Response>
export type Options = {
  /** The registry's address; Docker Hub's unless a test names its stand-in. */
  registry?: string
  fetch?: Fetch
}

/** A refusal already worded as the one line `digests.ts` prints. */
class Refusal extends Error {}

/** HTTPS, or plain HTTP to this machine only (a test's stand-in). */
function allowed(url: URL): boolean {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" && LOOPBACK.has(url.hostname))
  )
}

/** GET `url`, following redirects on its own host only. */
async function get(
  tag: string,
  url: URL,
  headers: Record<string, string>,
  fetcher: Fetch
): Promise<Response> {
  let at = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetcher(at, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status < 300 || response.status >= 400) return response
    const next = new URL(response.headers.get("location") ?? "", at)
    if (next.origin !== at.origin)
      throw new Refusal(
        `${tag}: the registry sent a redirect to another host, ${next.host}`
      )
    at = next
  }
  throw new Refusal(
    `${tag}: the registry sent more than ${MAX_REDIRECTS} redirects`
  )
}

/** The registry's anonymous token, from the challenge of its 401. */
async function anonymousToken(
  tag: string,
  challenge: string,
  repository: string,
  fetcher: Fetch
): Promise<string> {
  if (!challenge.startsWith("Bearer "))
    throw new Refusal(
      `${tag}: the registry asks for a sign-in other than an anonymous token`
    )
  const params = Object.fromEntries(
    [...challenge.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!])
  )
  if (params.realm === undefined || !URL.canParse(params.realm))
    throw new Refusal(`${tag}: the registry's challenge names no token service`)
  const realm = new URL(params.realm)
  if (!allowed(realm))
    throw new Refusal(
      `${tag}: the registry's token service ${realm.origin} is plain HTTP`
    )
  realm.searchParams.set("service", params.service ?? "")
  realm.searchParams.set(
    "scope",
    params.scope ?? `repository:${repository}:pull`
  )
  const response = await get(
    tag,
    realm,
    { accept: "application/json" },
    fetcher
  )
  const body = (await response.json()) as {
    token?: unknown
    access_token?: unknown
  }
  const token = body.token ?? body.access_token
  if (typeof token !== "string" || token === "")
    throw new Refusal(`${tag}: the registry's token service gave no token`)
  return token
}

async function resolve(tag: string, options: Options): Promise<string> {
  const parts = TAG.exec(tag)
  if (!parts) throw new Refusal(`${tag}: not a name and a version tag`)
  const [, name, version] = parts as unknown as [string, string, string]
  if (version === "latest") throw new Refusal(`${tag}: latest is not a version`)
  const base = new URL(options.registry ?? DOCKER_HUB)
  if (!allowed(base))
    throw new Refusal(
      `${tag}: the registry ${base.origin} is plain HTTP and not on 127.0.0.1`
    )
  const fetcher = options.fetch ?? ((url, init) => fetch(url, init))
  const repository = name.includes("/") ? name : `library/${name}`
  const manifest = new URL(`/v2/${repository}/manifests/${version}`, base)
  const accept = { accept: `${OCI_INDEX}, ${DOCKER_LIST}` }

  let response = await get(tag, manifest, accept, fetcher)
  if (response.status === 401) {
    const challenge = response.headers.get("www-authenticate") ?? ""
    const token = await anonymousToken(tag, challenge, repository, fetcher)
    response = await get(
      tag,
      manifest,
      { ...accept, authorization: `Bearer ${token}` },
      fetcher
    )
  }
  if (response.status !== 200)
    throw new Refusal(`${tag}: the registry answered ${response.status}`)

  const type = (response.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim()
  if (ONE_PROCESSOR.includes(type))
    throw new Refusal(
      `${tag}: the registry gave a manifest for one processor, not an index`
    )
  if (type !== OCI_INDEX && type !== DOCKER_LIST)
    throw new Refusal(
      `${tag}: the registry gave ${type || "no type"}, not an index`
    )

  const bytes = new Uint8Array(await response.arrayBuffer())
  const digest = `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`
  const named = response.headers.get("docker-content-digest")
  if (named !== null && named !== digest)
    throw new Refusal(
      `${tag}: the index's digest is ${digest}, not the docker-content-digest ${named}`
    )

  let index: {
    manifests?: { platform?: { os?: string; architecture?: string } }[]
  }
  try {
    index = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Refusal(`${tag}: the index is not JSON`)
  }
  // Attestations sit in the index as `unknown/unknown`; they run on no processor.
  const platforms = new Set(
    (index.manifests ?? [])
      .filter(
        ({ platform }) =>
          platform?.os !== undefined && platform.os !== "unknown"
      )
      .map(({ platform }) => `${platform!.os}/${platform!.architecture}`)
  )
  if (platforms.size === 1)
    throw new Refusal(
      `${tag}: the registry's index names one processor only, ${[...platforms][0]}`
    )
  for (const needed of NEEDED)
    if (!platforms.has(needed))
      throw new Refusal(`${tag}: the registry's index names no ${needed}`)
  return `${name}@${digest}`
}

/**
 * The multi-processor index digest of `tag`, as `name@sha256:<64 hex>`.
 * Throws one line that starts with the tag.
 */
export async function indexDigest(
  tag: string,
  options: Options = {}
): Promise<string> {
  try {
    return await resolve(tag, options)
  } catch (error) {
    if (error instanceof Refusal) throw error
    throw new Refusal(`${tag}: ${(error as Error).message}`)
  }
}

/** One line per image of `pins`, and whether every one matched the file. */
export async function digestLines(
  pins: Pins,
  lookUp: (tag: string) => Promise<string> = (tag) => indexDigest(tag)
): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = []
  let ok = true
  for (const { tag, image } of Object.values(pins.images)) {
    try {
      const found = await lookUp(tag)
      if (found === image) lines.push(`${tag} ${found} (as pins.json)`)
      else {
        ok = false
        lines.push(`${tag} ${found} (pins.json has ${image})`)
      }
    } catch (error) {
      ok = false
      lines.push((error as Error).message)
    }
  }
  return { ok, lines }
}

if (import.meta.main) {
  const { ok, lines } = await digestLines(loadPins())
  for (const line of lines) console.log(line)
  process.exitCode = ok ? 0 : 1
}
