/**
 * The build key (specs/016-build-from-source, contracts/core.md CO4; FR-021a,
 * FR-022, FR-037e; SC-006): the text it hashes, written out here so zekno and
 * the runner make the same bytes, and what changes it.
 */
import { describe, expect, test } from "bun:test"

import { toHex, utf8 } from "../../src/crypto/encoding"
import { hash } from "../../src/crypto/hash"
import { baseKey, buildKey, type Build } from "../../src/deploy/builds"
import { readDeployV2Payload } from "../../src/deploy/message"
import { hex, image, payload } from "../support/payload-v2"

const keyOf = (written: string) => toHex(hash("zekno/v1/build", utf8(written)))

/** The design's part 3.2 build, with real hex values and a build secret. */
const DOCKERFILE: Omit<Build, "key"> = {
  pack: { hash: hex(10), size: 18874368, chunks: [hex(11), hex(12), hex(13)] },
  builder: { name: "dockerfile", dockerfile: "web/Dockerfile", target: "prod" },
  args: [{ name: "NODE_ENV", value: "production" }],
  secrets: ["NPM_TOKEN"],
  network: "default",
  timeout: 1800,
  fresh: null,
}

const RAILPACK: Omit<Build, "key"> = {
  pack: { hash: hex(20), size: 1, chunks: [hex(21)] },
  builder: {
    name: "railpack",
    version: "0.9.2",
    frontend: image("railpack-frontend", 22),
    images: [image("railpack-builder", 23), image("railpack-runtime", 24)],
    plan: { hash: hex(25), size: 300, piece: hex(26) },
  },
  args: [],
  secrets: [],
  network: "none",
  timeout: 60,
  fresh: 7,
}

const LISTED = [
  { name: "NPM_TOKEN", hash: hex(8) },
  { name: "OTHER", hash: hex(9) },
]

describe("CO4: the text the key hashes", () => {
  test("a Dockerfile build", () => {
    const written = `["${hex(10)}",["dockerfile","web/Dockerfile","prod"],[["NODE_ENV","production"]],[["NPM_TOKEN","${hex(8)}"]],"default",null]`
    expect(buildKey(DOCKERFILE, LISTED)).toBe(keyOf(written))
  })

  test("a Dockerfile build with no target, no argument and no secret", () => {
    const build = {
      ...DOCKERFILE,
      builder: { name: "dockerfile", dockerfile: "Dockerfile", target: null },
      args: [],
      secrets: [],
      fresh: 12,
    } as const
    const written = `["${hex(10)}",["dockerfile","Dockerfile",null],[],[],"default","12"]`
    expect(buildKey(build, [])).toBe(keyOf(written))
  })

  test("a Railpack build", () => {
    const frontend = `ghcr.io/railwayapp/railpack-frontend@sha256:${hex(22)}`
    const builder = `ghcr.io/railwayapp/railpack-builder@sha256:${hex(23)}`
    const runtime = `ghcr.io/railwayapp/railpack-runtime@sha256:${hex(24)}`
    const written = `["${hex(20)}",["railpack","0.9.2","${frontend}",["${builder}","${runtime}"],"${hex(25)}"],[],[],"none","7"]`
    expect(buildKey(RAILPACK, [])).toBe(keyOf(written))
  })

  test("a build secret the listing does not name throws", () => {
    for (const listed of [[], [{ name: "OTHER", hash: hex(9) }]])
      expect(() => buildKey(DOCKERFILE, listed)).toThrow(
        expect.objectContaining({ code: "invalid_argument" })
      )
    expect(() => buildKey({ ...RAILPACK, secrets: ["NPM_TOKEN"] }, [])).toThrow(
      expect.objectContaining({ code: "invalid_argument" })
    )
  })

  test("anything but text where text goes throws", () => {
    const bad = (change: Record<string, unknown>) => () =>
      buildKey({ ...DOCKERFILE, ...change } as Build, LISTED)
    for (const change of [
      { pack: { hash: 1 } },
      { builder: { name: "dockerfile", dockerfile: 1, target: null } },
      { builder: { name: "dockerfile", dockerfile: "D", target: 1 } },
      { builder: { name: "other", dockerfile: "D", target: null } },
      { builder: { ...RAILPACK.builder, images: [1] } },
      { builder: { ...RAILPACK.builder, plan: {} } },
      { args: [{ name: "A", value: 1 }] },
      { network: null },
      { fresh: "7" },
      { fresh: 1.5 },
    ])
      expect(bad(change)).toThrow(
        expect.objectContaining({ code: "invalid_argument" })
      )
  })
})

/** Two builds with every field of the key filled: two arguments and two build secrets each. */
const FULL = {
  dockerfile: {
    ...DOCKERFILE,
    args: [
      { name: "A_ONE", value: "one" },
      { name: "B_TWO", value: "two" },
    ],
    secrets: ["NPM_TOKEN", "OTHER"],
    fresh: 7,
  },
  railpack: {
    ...RAILPACK,
    args: [
      { name: "A_ONE", value: "one" },
      { name: "B_TWO", value: "two" },
    ],
    secrets: ["NPM_TOKEN", "OTHER"],
  },
} satisfies Record<string, Omit<Build, "key">>

/** The deploy's listing: each secret's name and the fingerprint of its sealed value, as `secrets` lists them. */
const DEPLOY_LISTS = [
  { name: "NPM_TOKEM", hash: hex(8), version: 1 },
  { name: "NPM_TOKEN", hash: hex(8), version: 1 },
  { name: "OTHER", hash: hex(9), version: 2 },
  { name: "OTHES", hash: hex(9), version: 1 },
]

/** The text with its last character changed to another of the same kind. */
const lastChanged = (text: string) =>
  text.slice(0, -1) +
  (text.endsWith("0") ? "1" : text.endsWith("a") ? "b" : "0")

/** What F6 says of a deploy with this build under this key. */
const readWith = (
  recipe: Omit<Build, "key">,
  key: string,
  secrets: readonly {
    name: string
    hash: string
    version: number
  }[] = DEPLOY_LISTS
) => {
  const read = readDeployV2Payload(
    payload({ secrets, builds: [{ key, ...recipe }] })
  )
  return read.ok ? "read" : read.error.code
}

type Change = (build: Omit<Build, "key">) => Omit<Build, "key">

describe.each(Object.entries(FULL))(
  "CO4, SC-006: every field in the key of a %s build changes it",
  (kind, full) => {
    const rail =
      (change: Record<string, unknown>): Change =>
      (build) =>
        ({ ...build, builder: { ...build.builder, ...change } }) as Omit<
          Build,
          "key"
        >
    const builder = full.builder as Record<string, unknown> & {
      images?: string[]
      plan?: { hash: string }
    }
    const changes: [string, Change][] = [
      [
        "pack.hash",
        (b) => ({ ...b, pack: { ...b.pack, hash: lastChanged(b.pack.hash) } }),
      ],
      [
        "args[0].name",
        (b) => ({ ...b, args: [{ ...b.args[0]!, name: "A_ONF" }, b.args[1]!] }),
      ],
      [
        "args[0].value",
        (b) => ({ ...b, args: [{ ...b.args[0]!, value: "onf" }, b.args[1]!] }),
      ],
      [
        "args[1].name",
        (b) => ({ ...b, args: [b.args[0]!, { ...b.args[1]!, name: "B_TWP" }] }),
      ],
      [
        "args[1].value",
        (b) => ({ ...b, args: [b.args[0]!, { ...b.args[1]!, value: "twp" }] }),
      ],
      ["secrets[0]", (b) => ({ ...b, secrets: ["NPM_TOKEM", b.secrets[1]!] })],
      ["secrets[1]", (b) => ({ ...b, secrets: [b.secrets[0]!, "OTHES"] })],
      [
        "network",
        (b) => ({ ...b, network: b.network === "none" ? "default" : "none" }),
      ],
      ["fresh", (b) => ({ ...b, fresh: b.fresh === null ? 1 : b.fresh + 1 })],
      ["fresh to null", (b) => ({ ...b, fresh: null })],
    ]
    if (kind === "dockerfile")
      changes.push(
        ["builder.dockerfile", rail({ dockerfile: "web/Dockerfila" })],
        ["builder.target", rail({ target: "proe" })],
        ["builder.target to null", rail({ target: null })]
      )
    else
      changes.push(
        ["builder.version", rail({ version: "0.9.3" })],
        [
          "builder.frontend",
          rail({ frontend: lastChanged(String(builder.frontend)) }),
        ],
        [
          "builder.images[0]",
          rail({
            images: [lastChanged(builder.images![0]!), builder.images![1]!],
          }),
        ],
        [
          "builder.images[1]",
          rail({
            images: [builder.images![0]!, lastChanged(builder.images![1]!)],
          }),
        ],
        [
          "builder.plan.hash",
          rail({
            plan: { ...builder.plan!, hash: lastChanged(builder.plan!.hash) },
          }),
        ]
      )

    test.each(changes)("%s", (_, change) => {
      const before = buildKey(full, DEPLOY_LISTS)
      const changed = change(full)
      const after = buildKey(changed, DEPLOY_LISTS)
      expect(after).not.toBe(before)
      // Under its own key it keeps every rule; under the old one, F6 refuses it.
      expect(readWith(changed, after)).not.toBe("malformed")
      expect(readWith(changed, before)).toBe("malformed")
    })

    test("the listed hash of each build secret", () => {
      const before = buildKey(full, DEPLOY_LISTS)
      for (const name of ["NPM_TOKEN", "OTHER"]) {
        const listing = DEPLOY_LISTS.map((secret) =>
          secret.name === name ? { ...secret, hash: hex(77) } : secret
        )
        const after = buildKey(full, listing)
        expect([name, after === before]).toEqual([name, false])
        expect(readWith(full, after, listing)).not.toBe("malformed")
        expect(readWith(full, before, listing)).toBe("malformed")
      }
    })

    test("the signed fields outside the key leave it as it is and change the signed text", () => {
      const key = buildKey(full, DEPLOY_LISTS)
      const outside: [string, Change][] = [
        [
          "pack.size",
          (b) => ({ ...b, pack: { ...b.pack, size: b.pack.size + 1 } }),
        ],
        [
          "pack.chunks",
          (b) => ({
            ...b,
            pack: { ...b.pack, chunks: b.pack.chunks.map(lastChanged) },
          }),
        ],
        ["timeout", (b) => ({ ...b, timeout: b.timeout + 1 })],
      ]
      if (kind === "railpack")
        outside.push(
          [
            "builder.plan.size",
            rail({ plan: { ...builder.plan!, size: 301 } }),
          ],
          [
            "builder.plan.piece",
            rail({ plan: { ...builder.plan!, piece: hex(27) } }),
          ]
        )
      for (const [field, change] of outside) {
        const changed = change(full)
        expect([field, buildKey(changed, DEPLOY_LISTS)]).toEqual([field, key])
        expect(JSON.stringify({ key, ...changed })).not.toBe(
          JSON.stringify({ key, ...full })
        )
        expect([field, readWith(changed, key)]).not.toEqual([
          field,
          "malformed",
        ])
      }
    })
  }
)

describe("CO4: the base key", () => {
  test.each(Object.entries(FULL))(
    "fresh 7 and null give two keys with one base key (%s)",
    (_, full) => {
      const fresh = { ...full, fresh: 7 }
      const plain = { ...full, fresh: null }
      expect(buildKey(fresh, DEPLOY_LISTS)).not.toBe(
        buildKey(plain, DEPLOY_LISTS)
      )
      expect(baseKey(fresh, DEPLOY_LISTS)).toBe(baseKey(plain, DEPLOY_LISTS))
      expect(baseKey(fresh, DEPLOY_LISTS)).toBe(buildKey(plain, DEPLOY_LISTS))
    }
  )

  test("a secret set again gives another key and another base key (FR-037e)", () => {
    const again = DEPLOY_LISTS.map((secret) =>
      secret.name === "NPM_TOKEN"
        ? { ...secret, hash: hex(80), version: 2 }
        : secret
    )
    const build = FULL.dockerfile
    expect(buildKey(build, again)).not.toBe(buildKey(build, DEPLOY_LISTS))
    expect(baseKey(build, again)).not.toBe(baseKey(build, DEPLOY_LISTS))
  })

  test("its inputs hold no secret value: the listing's names and fingerprints only", () => {
    const build = FULL.dockerfile
    // The deploy's own listing, and the bare pairs of names and fingerprints, give one key.
    const pairs = DEPLOY_LISTS.map(({ name, hash }) => ({ name, hash }))
    expect(buildKey(build, DEPLOY_LISTS)).toBe(buildKey(build, pairs))
    expect(baseKey(build, DEPLOY_LISTS)).toBe(baseKey(build, pairs))
    // A build secret the listing lacks throws.
    const lacking = pairs.filter((secret) => secret.name !== "OTHER")
    for (const key of [buildKey, baseKey])
      expect(() => key(build, lacking)).toThrow(
        expect.objectContaining({ code: "invalid_argument" })
      )
  })
})
