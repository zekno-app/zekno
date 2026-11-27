/**
 * Version-2 payloads as plain values, for the tests of the reader
 * (`readDeployV2Payload`), which judges JSON alone: no signature, no state.
 */
import {
  buildKey,
  builtImageName,
  type Build,
  type BuildRecipe,
} from "../../src/deploy/builds"
import { COMPOSE } from "./helpers"

export const KiB = 1024
export const MiB = 1024 * KiB

/** A distinct 64-digit hex value for each number. */
export const hex = (n: number): string => n.toString(16).padStart(64, "0")

export const TEAM_ID = `team_${"A".repeat(22)}`
export const SERVER_ID = `srv_${"0".repeat(32)}`

/**
 * A Compose text that runs each build's image, as zekno writes it
 * (specs/016-build-from-source, data-model.md, "The Compose text of a built
 * service"): one service per build. Written here as text, not with
 * `builtImageName`, so a test can name a key that function refuses.
 */
export function composeFor(
  app: string,
  builds: readonly { readonly key: string }[]
): string {
  return `services:\n${builds
    .map(
      (build, n) =>
        `  s${n}:\n    image: "zekno.invalid/${app}:${build.key}"\n    pull_policy: "never"\n`
    )
    .join("")}`
}

/**
 * A payload that reads, with every later field empty, changed by `change`.
 * When `change` gives builds and no Compose text, the text runs each build's
 * image (CO2), so the builds' own rules decide.
 */
export function payload(
  change: Record<string, unknown> = {}
): Record<string, unknown> {
  const builds = Array.isArray(change.builds)
    ? (change.builds as unknown[]).filter(
        (entry): entry is { key: string } =>
          typeof (entry as { key?: unknown } | null)?.key === "string"
      )
    : []
  const app = typeof change.app === "string" ? change.app : "web"
  return {
    v: 2,
    teamId: TEAM_ID,
    teamHash: hex(1),
    serverId: SERVER_ID,
    app,
    previous: 41,
    sequence: 42,
    createdAt: "2026-11-20T10:00:00.000Z",
    expiresAt: null,
    compose: builds.length > 0 ? composeFor(app, builds) : COMPOSE,
    secrets: [],
    removed: [],
    builds: [],
    predeploy: null,
    health: null,
    routes: [],
    ...change,
  }
}

/** Secrets listed by a deploy, named `S000`, `S001`, … in order. */
export function listed(count: number, from = 0) {
  return Array.from({ length: count }, (_, n) => ({
    name: `S${String(from + n).padStart(3, "0")}`,
    hash: hex(1000 + from + n),
    version: 1,
  }))
}

type Recipe = Omit<Build, "key">

/** A reference by digest to an image of Railpack's registry. */
export const image = (name: string, n: number): string =>
  `ghcr.io/railwayapp/${name}@sha256:${hex(n)}`

/**
 * A build that reads beside `secrets`, its key computed from what it holds
 * unless `key` is given: a Dockerfile build (CO1) unless `change` gives
 * another builder. `change` replaces parts of the recipe.
 */
export function build(
  change: Partial<Recipe> & { key?: string } = {},
  secrets: readonly { name: string; hash: string }[] = []
): Build {
  const { key, ...rest } = change
  const recipe: Recipe = {
    pack: { hash: hex(100), size: 1, chunks: [hex(101)] },
    builder: { name: "dockerfile", dockerfile: "Dockerfile", target: null },
    args: [],
    secrets: [],
    network: "default",
    timeout: 1800,
    fresh: null,
    ...rest,
  }
  return { key: key ?? buildKey(recipe, secrets), ...recipe }
}

/** A Railpack build that reads beside `secrets`, as `build` makes a Dockerfile build. */
export function railpackBuild(
  change: Partial<Recipe> & { key?: string } = {},
  secrets: readonly { name: string; hash: string }[] = []
): Build {
  return build(
    {
      builder: {
        name: "railpack",
        version: "0.9.2",
        frontend: image("railpack-frontend", 110),
        images: [
          image("railpack-builder", 111),
          image("railpack-runtime", 112),
        ],
        plan: { hash: hex(113), size: 1, piece: hex(114) },
      },
      ...change,
    },
    secrets
  )
}

/**
 * A build of these fields with the key `buildKey` makes of them, so only the
 * rule under test can refuse it; `hex(0)` when they make no key, which the
 * schema then refuses before the key counts.
 */
export function keyed(
  fields: Record<string, unknown>,
  secrets: readonly { name: string; hash: string }[] = []
): Record<string, unknown> {
  const { key: _key, ...rest } = fields
  let key = hex(0)
  try {
    key = buildKey(rest as unknown as BuildRecipe, secrets)
  } catch {
    // Not a recipe: the schema refuses it first.
  }
  return { key, ...rest }
}

/** A pack of `chunks` chunks of 8 MiB, the last one full, with chunk hashes from `first`. */
export function pack(chunks: number, first = 200) {
  return {
    hash: hex(first - 1),
    size: chunks * 8 * MiB,
    chunks: Array.from({ length: chunks }, (_, n) => hex(first + n)),
  }
}

/**
 * The design's part 3.2 example, with real hex values: it reads, and asks for
 * every later field. Its Compose text runs the build's image by its key
 * (CO2), where the design shortens the key.
 */
export function partThreeTwo(): Record<string, unknown> {
  const secrets = [{ name: "DATABASE_URL", hash: hex(3), version: 3 }]
  const made = build(
    {
      pack: {
        hash: hex(10),
        size: 18874368,
        chunks: [hex(11), hex(12), hex(13)],
      },
      args: [{ name: "NODE_ENV", value: "production" }],
    },
    secrets
  )
  return payload({
    compose: `services:\n  web:\n    image: ${builtImageName("demo", made.key)}\n    pull_policy: never\n`,
    app: "demo",
    secrets,
    builds: [made],
    predeploy: {
      service: "web",
      command: ["bun", "run", "migrate"],
      timeout: 600,
    },
    health: {
      timeout: 120,
      services: [{ service: "web", http: { port: 3000, path: "/health" } }],
    },
    routes: [{ domain: "demo.example.com", service: "web", port: 3000 }],
  })
}
