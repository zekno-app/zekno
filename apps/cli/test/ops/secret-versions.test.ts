/**
 * `zekno secret set` and `zekno secret rm` stay offline and take their
 * version from this machine and what it remembers of the server
 * (specs/014-deploy-v2, contracts/cli.md CL18 to CL20; research R9; decision
 * B; tasks T047). Every command here runs with `deps.connect` made to throw:
 * neither ever connects. `held/` is a floor only: it raises the next version
 * and makes `rm` know a name, and never gives what is signed.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import {
  verifySecret,
  verifySecretRemoval,
  type SecretRecord,
} from "@workspace/core"

import { openTeam, type Team } from "../../src/cli/context"
import type { Held, SecretStore, Server } from "../../src/profile/profile"
import { ready } from "../support/helpers"
import { payloadOf, signingTeam } from "../support/signing-team"
import { teamOfTwo } from "../support/team-of-two"

let m: Awaited<ReturnType<typeof ready>>
let team: Team
let server: Server
/** Records Bea set while she was in the team; she is not in it now. */
const bea: Record<string, SecretRecord> = {}
const connected: string[] = []

beforeAll(async () => {
  m = await ready()
  const two = await teamOfTwo(m)
  for (const [key, app, name, version] of [
    ["heldStatement", "floor-statement", "DATABASE_URL", 7],
    ["here", "floor-here", "DATABASE_URL", 4],
    ["rmStatement", "rm-statement", "DATABASE_URL", 3],
    ["rmHere", "rm-here", "DATABASE_URL", 1],
    ["highest", "floor-highest", "DATABASE_URL", 6],
  ] as const)
    bea[key] = await two.sets(app, name, `set by Bea for ${app}`, version)
  await two.remove({ sync: false })
  team = await openTeam(m.deps)
  server = team.profile.servers[0]!
  // Neither command ever connects (decision B): a connection fails the test.
  m.deps.connect = (target) => {
    connected.push(JSON.stringify(target))
    throw new Error("zekno secret set and rm never connect")
  }
}, 60_000)

const EMPTY: Held = { statements: [], versions: [] }

/** Remembers, for `app`, what a version-2 deploy read of the server. */
const remember = (app: string, held: Partial<Held>) =>
  team.store.saveHeld(server.serverId, app, { ...EMPTY, ...held })

const storeOf = (app: string): SecretStore =>
  team.store.secrets(server.serverId, app)

/** `zekno secret set <name>` for `app`, typing `value`: its status and its line. */
async function set(app: string, name: string, value = "a new value") {
  m.typing(value)
  const code = await m.zekno(
    "secret",
    "set",
    name,
    "--app",
    app,
    "--server",
    "dev"
  )
  return { code, said: code === 0 ? m.lastOut() : m.lastErr() }
}

/** `zekno secret rm <name>` for `app`: its status and its line. */
async function rm(app: string, name: string) {
  const code = await m.zekno(
    "secret",
    "rm",
    name,
    "--app",
    app,
    "--server",
    "dev"
  )
  return { code, said: code === 0 ? m.lastOut() : m.lastErr() }
}

const S3 = (name: string, version: number, app: string) =>
  `Set ${name} (version ${version}) for ${app} on dev. It takes effect on the next deploy.`
const S1 = (name: string, app: string) =>
  `Removed ${name} from ${app} on dev. It takes effect on the next deploy.`

/** The version of the last record this machine stored for `app`, verified. */
function lastRecord(app: string) {
  const record = storeOf(app).records.at(-1)!
  const checked = verifySecret({
    record,
    trust: team.trust,
    serverId: server.serverId,
    app,
  })
  if (!checked.ok) throw new Error("the record set did not verify")
  return checked.value
}

/** The version of the last removal this machine stored for `app`, verified. */
function lastRemoval(app: string) {
  const removal = storeOf(app).removals.at(-1)!
  const checked = verifySecretRemoval({
    removal,
    trust: team.trust,
    serverId: server.serverId,
    app,
  })
  if (!checked.ok) throw new Error("the removal did not verify")
  return checked.value
}

describe("zekno secret set: one above the highest this machine holds or remembers (CL18)", () => {
  test("a brand-new name with no held/ gets version 1, as today", async () => {
    expect(await set("brand-new", "DATABASE_URL")).toEqual({
      code: 0,
      said: S3("DATABASE_URL", 1, "brand-new"),
    })
  })

  test("above this machine's verified records and removals, as today", async () => {
    await set("today", "DATABASE_URL")
    await set("today", "DATABASE_URL")
    await rm("today", "DATABASE_URL")
    expect(await set("today", "DATABASE_URL")).toEqual({
      code: 0,
      said: S3("DATABASE_URL", 4, "today"),
    })
  })

  test("above the version held/ remembers for the name, removed or not", async () => {
    remember("floor-version", {
      versions: [
        { name: "DATABASE_URL", version: 5, removed: false },
        { name: "OTHER", version: 40, removed: true },
      ],
    })
    expect((await set("floor-version", "DATABASE_URL")).said).toBe(
      S3("DATABASE_URL", 6, "floor-version")
    )
    expect((await set("floor-version", "OTHER")).said).toBe(
      S3("OTHER", 41, "floor-version")
    )
  })

  test("above a statement held/ remembers, by a member the team list no longer has", async () => {
    remember("floor-statement", { statements: [bea.heldStatement!.envelope] })
    expect((await set("floor-statement", "DATABASE_URL")).said).toBe(
      S3("DATABASE_URL", 8, "floor-statement")
    )
  })

  test("above a statement held/ remembers, by a key no team list ever had", async () => {
    const stranger = await signingTeam("floor-stranger")
    const record = await stranger.secret("DATABASE_URL", "not ours", 9)
    remember("floor-stranger", { statements: [record.envelope] })
    expect((await set("floor-stranger", "DATABASE_URL")).said).toBe(
      S3("DATABASE_URL", 10, "floor-stranger")
    )
  })

  test("above this machine's record of the name that does not verify", async () => {
    team.store.saveSecrets(server.serverId, "floor-here", {
      records: [bea.here!],
      removals: [],
    })
    expect((await set("floor-here", "DATABASE_URL")).said).toBe(
      S3("DATABASE_URL", 5, "floor-here")
    )
  })

  test("the highest of all of them", async () => {
    await set("floor-highest", "DATABASE_URL")
    team.store.saveSecrets(server.serverId, "floor-highest", {
      ...storeOf("floor-highest"),
      records: [...storeOf("floor-highest").records, bea.highest!],
    })
    remember("floor-highest", {
      versions: [{ name: "DATABASE_URL", version: 3, removed: false }],
    })
    expect((await set("floor-highest", "DATABASE_URL")).said).toBe(
      S3("DATABASE_URL", 7, "floor-highest")
    )
  })

  test("nothing of held/ changes what is signed: the record's hash is its own value's", async () => {
    const sameApp = await signingTeam("floor-hash")
    remember("floor-hash", {
      statements: [
        (await sameApp.secret("DATABASE_URL", "theirs", 5)).envelope,
      ],
      versions: [{ name: "DATABASE_URL", version: 2, removed: false }],
    })
    await set("floor-hash", "DATABASE_URL", "mine")
    const made = lastRecord("floor-hash")
    expect(made.version).toBe(6)
    const remembered = team.store
      .held(server.serverId, "floor-hash")
      .statements.map((envelope) => payloadOf(envelope).hash)
    expect(remembered).not.toContain(made.hash)
    expect(made.sealed.name).toBe("DATABASE_URL")
  })

  test("a held/ version of 2^53 - 1: `That could not be done (invalid_argument).`, and nothing stored", async () => {
    remember("floor-max", {
      versions: [
        {
          name: "DATABASE_URL",
          version: Number.MAX_SAFE_INTEGER,
          removed: false,
        },
      ],
    })
    expect(await set("floor-max", "DATABASE_URL")).toEqual({
      code: 1,
      said: "That could not be done (invalid_argument).",
    })
    expect(storeOf("floor-max")).toEqual({ records: [], removals: [] })
  })
})

describe("zekno secret rm: a name this machine holds or remembers (CL19)", () => {
  test("a name only held/ names, by a statement: the removal is signed above it, and S1", async () => {
    remember("rm-statement", { statements: [bea.rmStatement!.envelope] })
    expect(await rm("rm-statement", "DATABASE_URL")).toEqual({
      code: 0,
      said: S1("DATABASE_URL", "rm-statement"),
    })
    expect(lastRemoval("rm-statement")).toMatchObject({
      name: "DATABASE_URL",
      version: 4,
    })
  })

  test("a name only held/ names, by a version not removed: signed above it, and S1", async () => {
    remember("rm-version", {
      versions: [{ name: "DATABASE_URL", version: 2, removed: false }],
    })
    expect(await rm("rm-version", "DATABASE_URL")).toEqual({
      code: 0,
      said: S1("DATABASE_URL", "rm-version"),
    })
    expect(lastRemoval("rm-version").version).toBe(3)
  })

  test("a name whose only record here does not verify: signed above it, and S1", async () => {
    team.store.saveSecrets(server.serverId, "rm-here", {
      records: [bea.rmHere!],
      removals: [],
    })
    expect(await rm("rm-here", "DATABASE_URL")).toEqual({
      code: 0,
      said: S1("DATABASE_URL", "rm-here"),
    })
    expect(lastRemoval("rm-here").version).toBe(2)
  })

  test("a current secret of this machine, as today, above what held/ remembers", async () => {
    await set("rm-today", "DATABASE_URL")
    remember("rm-today", {
      versions: [{ name: "DATABASE_URL", version: 4, removed: true }],
    })
    expect(await rm("rm-today", "DATABASE_URL")).toEqual({
      code: 0,
      said: S1("DATABASE_URL", "rm-today"),
    })
    expect(lastRemoval("rm-today").version).toBe(5)
  })

  test("a name in neither, or remembered only as removed: today's sentence, nothing stored", async () => {
    remember("rm-neither", {
      versions: [{ name: "OLD", version: 3, removed: true }],
    })
    for (const name of ["NEVER", "OLD"]) {
      expect(await rm("rm-neither", name)).toEqual({
        code: 1,
        said: `rm-neither on dev has no secret named ${name}.`,
      })
    }
    expect(storeOf("rm-neither")).toEqual({ records: [], removals: [] })
  })

  test("a held/ version of 2^53 - 1: `That could not be done (invalid_argument).`, and nothing stored", async () => {
    remember("rm-max", {
      versions: [
        {
          name: "DATABASE_URL",
          version: Number.MAX_SAFE_INTEGER,
          removed: false,
        },
      ],
    })
    expect(await rm("rm-max", "DATABASE_URL")).toEqual({
      code: 1,
      said: "That could not be done (invalid_argument).",
    })
    expect(storeOf("rm-max")).toEqual({ records: [], removals: [] })
  })
})

describe("neither command connects (decision B)", () => {
  test("no connection was opened by any command of this file", () => {
    expect(connected).toEqual([])
  })
})
