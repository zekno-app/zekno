/**
 * The registry reader of `digests.ts` (specs/016-build-from-source, plan
 * item 2; rule LC10), run against a registry stand-in served by `Bun.serve`
 * on 127.0.0.1, at a free port above 1024 and never 3000 or 3100: the index
 * digest with the registry's anonymous token, and each refusal. Nothing
 * here runs Docker or reaches the network.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"

import { digestLines, indexDigest } from "./digests"
import { loadPins } from "./pins"

const TOKEN = "stand-in-token"
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const sha256 = (bytes: Uint8Array) =>
  `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`
const entry = (architecture: string, os = "linux") => ({
  mediaType: "application/vnd.oci.image.manifest.v1+json",
  digest: sha256(json(architecture)),
  size: 1,
  platform: { os, architecture },
})
const INDEX = "application/vnd.oci.image.index.v1+json"
const MANIFEST = "application/vnd.oci.image.manifest.v1+json"

/** What the stand-in answers for each tag of `library/<name>`. */
const ANSWERS: Record<
  string,
  {
    type: string
    body: Uint8Array
    digest?: string
    status?: number
    location?: string
  }
> = {
  "both:1": {
    type: INDEX,
    body: json({
      manifests: [entry("amd64"), entry("unknown", "unknown"), entry("arm64")],
    }),
  },
  "one:1": {
    type: INDEX,
    body: json({ manifests: [entry("amd64"), entry("unknown", "unknown")] }),
  },
  "noarm:1": {
    type: INDEX,
    body: json({ manifests: [entry("amd64"), entry("s390x")] }),
  },
  "single:1": { type: MANIFEST, body: json({ layers: [] }) },
  "lying:1": {
    type: INDEX,
    body: json({ manifests: [entry("amd64"), entry("arm64")] }),
    digest: `sha256:${"0".repeat(64)}`,
  },
  "away:1": {
    type: INDEX,
    body: new Uint8Array(),
    status: 307,
    location: "http://registry.invalid/v2/library/away/manifests/1",
  },
  "here:1": {
    type: INDEX,
    body: new Uint8Array(),
    status: 307,
    location: "/v2/library/both/manifests/1",
  },
  "loop:1": {
    type: INDEX,
    body: new Uint8Array(),
    status: 307,
    location: "/v2/library/loop/manifests/1",
  },
  "text:1": { type: INDEX, body: new TextEncoder().encode("not json") },
  "page:1": { type: "text/html", body: new TextEncoder().encode("<p>") },
}

let server: ReturnType<typeof Bun.serve>
let registry = ""
const tokenScopes: string[] = []

beforeAll(() => {
  // A free port above 1024 chosen by the system; never 3000 or 3100.
  for (;;) {
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: answer })
    if (server.port! > 1024 && server.port !== 3000 && server.port !== 3100)
      break
    server.stop(true)
  }
  registry = `http://127.0.0.1:${server.port}`
})
afterAll(() => server.stop(true))

/** The challenge of a 401 for `library/<name>`: most names get a token from /token. */
function challenge(name: string): string {
  if (name === "notoken")
    return `Bearer realm="${registry}/empty-token",service="stand-in"`
  if (name === "basic") return 'Basic realm="stand-in"'
  if (name === "far")
    return 'Bearer realm="http://auth.invalid/token",service="stand-in"'
  if (name === "norealm") return 'Bearer service="stand-in"'
  return `Bearer realm="${registry}/token",service="stand-in",scope="repository:library/${name}:pull"`
}

function answer(request: Request): Response {
  const url = new URL(request.url)
  if (url.pathname === "/token") {
    tokenScopes.push(
      `${url.searchParams.get("service")} ${url.searchParams.get("scope")}`
    )
    return Response.json({ token: TOKEN })
  }
  if (url.pathname === "/empty-token") {
    tokenScopes.push(
      `${url.searchParams.get("service")} ${url.searchParams.get("scope")}`
    )
    return Response.json({})
  }
  const match = /^\/v2\/library\/([a-z]+)\/manifests\/([0-9]+)$/.exec(
    url.pathname
  )
  if (!match) return new Response("not found", { status: 404 })
  if (request.headers.get("authorization") !== `Bearer ${TOKEN}`)
    return new Response("", {
      status: 401,
      headers: { "www-authenticate": challenge(match[1]!) },
    })
  const found = ANSWERS[`${match[1]}:${match[2]}`]
  if (!found) return new Response("unknown", { status: 404 })
  if (found.status)
    return new Response("", {
      status: found.status,
      headers: { location: found.location! },
    })
  return new Response(found.body, {
    headers: {
      "content-type": found.type,
      "docker-content-digest": found.digest ?? sha256(found.body),
    },
  })
}

/** The one line `indexDigest` refuses `tag` with. */
async function digestRefusal(tag: string): Promise<string> {
  try {
    await indexDigest(tag, { registry })
  } catch (error) {
    return (error as Error).message
  }
  throw new Error(`${tag} was accepted`)
}

describe("digests.ts", () => {
  test("gives the index digest, with the registry's anonymous token", async () => {
    expect(await indexDigest("both:1", { registry })).toBe(
      `both@${sha256(ANSWERS["both:1"]!.body)}`
    )
    expect(tokenScopes).toContain("stand-in repository:library/both:pull")
  })

  test("follows a redirect on the registry's own host", async () => {
    expect(await indexDigest("here:1", { registry })).toBe(
      `here@${sha256(ANSWERS["both:1"]!.body)}`
    )
  })

  const refused: [string, string][] = [
    ["an index with one processor only", "one:1"],
    ["an index without linux/arm64", "noarm:1"],
    ["a manifest for one processor", "single:1"],
    ["a redirect to another host", "away:1"],
    ["redirects that do not end", "loop:1"],
    ["a body whose digest is not the one the registry names", "lying:1"],
    ["a body that is not JSON", "text:1"],
    ["an answer that is neither an index nor a manifest", "page:1"],
    ["a tag the registry does not have", "both:2"],
    ["a token service that gives no token", "notoken:1"],
    ["a sign-in other than an anonymous token", "basic:1"],
    ["a token service over plain HTTP elsewhere", "far:1"],
    ["a challenge with no token service", "norealm:1"],
  ]
  for (const [what, tag] of refused)
    test(`refuses ${what}`, async () => {
      const line = await digestRefusal(tag)
      expect(line).toStartWith(`${tag}: `)
      expect(line).not.toContain("\n")
    })

  test("names what each refusal saw", async () => {
    expect(await digestRefusal("one:1")).toContain("one processor only")
    expect(await digestRefusal("noarm:1")).toContain("no linux/arm64")
    expect(await digestRefusal("away:1")).toContain("registry.invalid")
    expect(await digestRefusal("lying:1")).toContain("docker-content-digest")
    expect(await digestRefusal("far:1")).toContain("plain HTTP")
    expect(tokenScopes).toContain("stand-in repository:library/notoken:pull")
  })

  test("words a failure of the connection as one line that starts with the tag", async () => {
    const line = await indexDigest("both:1", {
      registry,
      fetch: () => Promise.reject(new Error("the connection was reset")),
    }).catch((error: Error) => error.message)
    expect(line).toBe("both:1: the connection was reset")
  })

  test("refuses a tag it cannot read, and a registry over plain HTTP elsewhere than 127.0.0.1", async () => {
    await expect(indexDigest("both", { registry })).rejects.toThrow("both:")
    await expect(indexDigest("both:latest", { registry })).rejects.toThrow(
      "latest"
    )
    await expect(
      indexDigest("both:1", { registry: "http://registry.invalid" })
    ).rejects.toThrow("plain HTTP")
  })

  test("prints one line per image, and says when one differs from pins.json", async () => {
    const pins = loadPins()
    const same = await digestLines(pins, async (tag) =>
      tag === pins.images.ubuntu.tag
        ? pins.images.ubuntu.image
        : pins.images.fixtures.image
    )
    expect(same.ok).toBe(true)
    expect(same.lines).toEqual([
      `${pins.images.ubuntu.tag} ${pins.images.ubuntu.image} (as pins.json)`,
      `${pins.images.fixtures.tag} ${pins.images.fixtures.image} (as pins.json)`,
    ])
    const other = `ubuntu@sha256:${"1".repeat(64)}`
    const differs = await digestLines(pins, async (tag) => {
      if (tag === pins.images.ubuntu.tag) return other
      throw new Error(`${tag}: the registry did not answer`)
    })
    expect(differs.ok).toBe(false)
    expect(differs.lines).toEqual([
      `${pins.images.ubuntu.tag} ${other} (pins.json has ${pins.images.ubuntu.image})`,
      `${pins.images.fixtures.tag}: the registry did not answer`,
    ])
  })
})
