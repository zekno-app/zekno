/**
 * Version-2 payloads as plain values, for the tests of the reader
 * (`readDeployV2Payload`), which judges JSON alone: no signature, no state.
 */
import { buildKey, type Build } from "../../src/deploy/later-fields"
import { COMPOSE } from "./helpers"

export const KiB = 1024
export const MiB = 1024 * KiB

/** A distinct 64-digit hex value for each number. */
export const hex = (n: number): string => n.toString(16).padStart(64, "0")

export const TEAM_ID = `team_${"A".repeat(22)}`
export const SERVER_ID = `srv_${"0".repeat(32)}`

/** A payload that reads, with every later field empty, changed by `change`. */
export function payload(
  change: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    v: 2,
    teamId: TEAM_ID,
    teamHash: hex(1),
    serverId: SERVER_ID,
    app: "web",
    previous: 41,
    sequence: 42,
    createdAt: "2026-11-20T10:00:00.000Z",
    expiresAt: null,
    compose: COMPOSE,
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

/**
 * A build that reads beside `secrets`, its key computed from what it holds
 * unless `key` is given. `change` replaces parts of the recipe.
 */
export function build(
  change: Partial<Recipe> & { key?: string } = {},
  secrets: readonly { name: string; hash: string }[] = []
): Build {
  const { key, ...rest } = change
  const recipe: Recipe = {
    pack: { hash: hex(100), size: 1, chunks: [hex(101)] },
    dockerfile: "Dockerfile",
    target: null,
    args: [],
    secrets: [],
    network: "default",
    timeout: 1800,
    ...rest,
  }
  return { key: key ?? buildKey(recipe, secrets), ...recipe }
}

/** A pack of `chunks` chunks of 8 MiB, the last one full, with chunk hashes from `first`. */
export function pack(chunks: number, first = 200) {
  return {
    hash: hex(first - 1),
    size: chunks * 8 * MiB,
    chunks: Array.from({ length: chunks }, (_, n) => hex(first + n)),
  }
}

/** The design's part 3.2 example, with real hex values: it reads, and asks for every later field. */
export function partThreeTwo(): Record<string, unknown> {
  const secrets = [{ name: "DATABASE_URL", hash: hex(3), version: 3 }]
  return payload({
    compose:
      "services:\n  web:\n    image: zekno.invalid/demo:3f9c\n    pull_policy: never\n",
    app: "demo",
    secrets,
    builds: [
      build(
        {
          pack: {
            hash: hex(10),
            size: 18874368,
            chunks: [hex(11), hex(12), hex(13)],
          },
          args: [{ name: "NODE_ENV", value: "production" }],
        },
        secrets
      ),
    ],
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
