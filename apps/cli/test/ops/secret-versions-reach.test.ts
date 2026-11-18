/**
 * How far a version nobody verified may raise the next one (specs/014-deploy-v2,
 * security review S1; contracts/cli.md CL18, CL19). A version only `held/`
 * gives, or a record here that does not verify, counts up to 1,000 above the
 * highest version of the name that verifies on this machine (0 when none);
 * past that it is ignored, as if it were not there, so one number in `held/`
 * or a lying server's answer cannot make `zekno secret set` or `rm` sign
 * 2^53 - 1. Every command here runs with `deps.connect` made to throw.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import {
  createSecret,
  verifySecret,
  verifySecretRemoval,
  type SecretRecord,
} from "@workspace/core"

import { openTeam, type Team } from "../../src/cli/context"
import type { Held, SecretStore, Server } from "../../src/profile/profile"
import { ready } from "../support/helpers"
import { signingTeam } from "../support/signing-team"
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
  for (const [key, app, version] of [
    ["at", "reach-record-at", 1000],
    ["past", "reach-record-past", 1001],
  ] as const)
    bea[key] = await two.sets(app, "DATABASE_URL", `set by Bea`, version)
  await two.remove({ sync: false })
  team = await openTeam(m.deps)
  server = team.profile.servers[0]!
  m.deps.connect = (target) => {
    connected.push(JSON.stringify(target))
    throw new Error("zekno secret set and rm never connect")
  }
}, 60_000)

const FAR = Number.MAX_SAFE_INTEGER - 1

const remember = (app: string, held: Partial<Held>) =>
  team.store.saveHeld(server.serverId, app, {
    statements: [],
    versions: [],
    ...held,
  })

const storeOf = (app: string): SecretStore =>
  team.store.secrets(server.serverId, app)

/** `zekno secret <command> DATABASE_URL` for `app`: its status and its line. */
async function secret(command: "set" | "rm", app: string) {
  if (command === "set") m.typing("a new value")
  const code = await m.zekno(
    "secret",
    command,
    "DATABASE_URL",
    "--app",
    app,
    "--server",
    "dev"
  )
  return { code, said: code === 0 ? m.lastOut() : m.lastErr() }
}

const S3 = (version: number, app: string) =>
  `Set DATABASE_URL (version ${version}) for ${app} on dev. It takes effect on the next deploy.`
const S1 = (app: string) =>
  `Removed DATABASE_URL from ${app} on dev. It takes effect on the next deploy.`
const NONE = (app: string) => `${app} on dev has no secret named DATABASE_URL.`

/** The version of the last record, or removal, this machine stored for `app`, verified. */
function lastVersion(app: string, of: "records" | "removals"): number {
  const where = { trust: team.trust, serverId: server.serverId, app }
  const store = storeOf(app)
  const checked =
    of === "records"
      ? verifySecret({ record: store.records.at(-1), ...where })
      : verifySecretRemoval({ removal: store.removals.at(-1), ...where })
  if (!checked.ok) throw new Error(`the last of ${of} did not verify`)
  return checked.value.version
}

/** Signs and keeps here a verified record of DATABASE_URL for `app` at 2^53 - 1001: 1,000 below the highest version there is. */
async function highRecord(app: string): Promise<SecretRecord> {
  const record = await team.withSigner((signer) =>
    createSecret({
      trust: team.trust,
      serverId: server.serverId,
      app,
      name: "DATABASE_URL",
      value: "a value far up",
      version: Number.MAX_SAFE_INTEGER - 1000,
      signer,
    })
  )
  team.store.saveSecrets(server.serverId, app, {
    records: [record],
    removals: [],
  })
  return record
}

describe("at 1,000 above what verifies here a claim counts; at 1,001 it is ignored", () => {
  test("held/'s version, above two records set here", async () => {
    for (const app of ["reach-version-at", "reach-version-past"]) {
      await secret("set", app)
      await secret("set", app)
    }
    remember("reach-version-at", {
      versions: [{ name: "DATABASE_URL", version: 1002, removed: false }],
    })
    remember("reach-version-past", {
      versions: [{ name: "DATABASE_URL", version: 1003, removed: false }],
    })
    expect((await secret("set", "reach-version-at")).said).toBe(
      S3(1003, "reach-version-at")
    )
    expect((await secret("set", "reach-version-past")).said).toBe(
      S3(3, "reach-version-past")
    )
  })

  test("a statement held/ remembers, with nothing here", async () => {
    const stranger = await signingTeam("reach-statement")
    remember("reach-statement-at", {
      statements: [(await stranger.secret("DATABASE_URL", "x", 1000)).envelope],
    })
    remember("reach-statement-past", {
      statements: [(await stranger.secret("DATABASE_URL", "x", 1001)).envelope],
    })
    expect((await secret("set", "reach-statement-at")).said).toBe(
      S3(1001, "reach-statement-at")
    )
    expect((await secret("set", "reach-statement-past")).said).toBe(
      S3(1, "reach-statement-past")
    )
  })

  test("this machine's record that does not verify, with nothing here that does", async () => {
    for (const [app, key] of [
      ["reach-record-at", "at"],
      ["reach-record-past", "past"],
    ] as const)
      team.store.saveSecrets(server.serverId, app, {
        records: [bea[key]!],
        removals: [],
      })
    expect((await secret("set", "reach-record-at")).said).toBe(
      S3(1001, "reach-record-at")
    )
    expect((await secret("set", "reach-record-past")).said).toBe(
      S3(1, "reach-record-past")
    )
  })

  test("rm of a name only held/ names: at 1,000 it is removed above it; at 1,001 today's sentence, nothing stored", async () => {
    remember("reach-rm-at", {
      versions: [{ name: "DATABASE_URL", version: 1000, removed: false }],
    })
    remember("reach-rm-past", {
      versions: [{ name: "DATABASE_URL", version: 1001, removed: false }],
    })
    expect(await secret("rm", "reach-rm-at")).toEqual({
      code: 0,
      said: S1("reach-rm-at"),
    })
    expect(lastVersion("reach-rm-at", "removals")).toBe(1001)
    expect(await secret("rm", "reach-rm-past")).toEqual({
      code: 1,
      said: NONE("reach-rm-past"),
    })
    expect(storeOf("reach-rm-past")).toEqual({ records: [], removals: [] })
  })
})

describe("2^53 - 2 remembered (the review's probe 2)", () => {
  test("as held/'s version, with nothing here: set signs version 1; rm says today's sentence", async () => {
    for (const app of ["far-version-set", "far-version-rm"])
      remember(app, {
        versions: [{ name: "DATABASE_URL", version: FAR, removed: false }],
      })
    expect(await secret("set", "far-version-set")).toEqual({
      code: 0,
      said: S3(1, "far-version-set"),
    })
    expect(lastVersion("far-version-set", "records")).toBe(1)
    expect(await secret("rm", "far-version-rm")).toEqual({
      code: 1,
      said: NONE("far-version-rm"),
    })
    expect(storeOf("far-version-rm")).toEqual({ records: [], removals: [] })
  })

  test("as a statement held/ remembers, with nothing here: set signs version 1; rm says today's sentence", async () => {
    const stranger = await signingTeam("far-statement")
    const far = (await stranger.secret("DATABASE_URL", "x", FAR)).envelope
    for (const app of ["far-statement-set", "far-statement-rm"])
      remember(app, { statements: [far] })
    expect(await secret("set", "far-statement-set")).toEqual({
      code: 0,
      said: S3(1, "far-statement-set"),
    })
    expect(await secret("rm", "far-statement-rm")).toEqual({
      code: 1,
      said: NONE("far-statement-rm"),
    })
    expect(storeOf("far-statement-rm")).toEqual({ records: [], removals: [] })
  })

  test("beside a current secret here: rm signs the removal one above this machine's own", async () => {
    await secret("set", "far-current")
    remember("far-current", {
      versions: [{ name: "DATABASE_URL", version: FAR, removed: false }],
    })
    expect(await secret("rm", "far-current")).toEqual({
      code: 0,
      said: S1("far-current"),
    })
    expect(lastVersion("far-current", "removals")).toBe(2)
  })
})

describe("at the highest version there is, the core library still refuses (CL18)", () => {
  test("a verified record at 2^53 - 1001 and held/ at 2^53 - 1, exactly 1,000 above: set and rm say `That could not be done (invalid_argument).`, and nothing more is stored", async () => {
    for (const command of ["set", "rm"] as const) {
      const app = `top-${command}`
      const record = await highRecord(app)
      remember(app, {
        versions: [
          {
            name: "DATABASE_URL",
            version: Number.MAX_SAFE_INTEGER,
            removed: false,
          },
        ],
      })
      expect(await secret(command, app)).toEqual({
        code: 1,
        said: "That could not be done (invalid_argument).",
      })
      expect(storeOf(app)).toEqual({ records: [record], removals: [] })
    }
  })
})

describe("neither command connects (decision B)", () => {
  test("no connection was opened by any command of this file", () => {
    expect(connected).toEqual([])
  })
})
