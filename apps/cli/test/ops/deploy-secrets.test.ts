/**
 * What a deploy lists, supplies, and which secret stops it (specs/014-deploy-v2,
 * contracts/cli.md CL12 to CL17 and CL16b; research R7, R8; tasks T038, the
 * C4 cases of T045, and T079): `listForDeploy` over this machine's store, the
 * runner's statements and what `status` says is live, for a team from
 * `ready()` in which Bea set secrets and was then taken out of the team list
 * (test/support/team-of-two.ts).
 */
import { beforeAll, describe, expect, test } from "bun:test"
import {
  createSecret,
  createSecretRemoval,
  currentSecrets,
  type Envelope,
  type RunnerStatus,
  type SecretRecord,
} from "@workspace/core"

import { openTeam, type Team } from "../../src/cli/context"
import { CliError } from "../../src/cli/errors"
import { formerKeyIds, listForDeploy } from "../../src/ops/deploy-secrets"
import type { Server } from "../../src/profile/profile"
import { blockedLines, C4, C5, C5b } from "../../src/shared/deploy-words"
import { ready } from "../support/helpers"
import { signingTeam } from "../support/signing-team"
import { teamOfTwo } from "../support/team-of-two"

let team: Team
let server: Server
let two: Awaited<ReturnType<typeof teamOfTwo>>
/** Bea's records, each signed while she was in the team. */
const bea: Record<string, SecretRecord> = {}

beforeAll(async () => {
  const m = await ready()
  two = await teamOfTwo(m)
  for (const [key, app, name, version] of [
    ["own", "c4-own", "DATABASE_URL", 1],
    ["runner", "c4-runner", "DATABASE_URL", 3],
    ["older", "c4-older", "DATABASE_URL", 1],
    ["twoA", "c4-two", "DATABASE_URL", 1],
    ["twoB", "c4-two", "PAYMENTS_KEY", 1],
    ["mixed", "mixed", "DATABASE_URL", 1],
  ] as const)
    bea[key] = await two.sets(app, name, `set by Bea for ${app}`, version)
  await two.remove({ sync: false })
  team = await openTeam(m.deps)
  server = team.profile.servers[0]!
}, 60_000)

/** A secret of `app` Ada sets, with the key this machine holds. */
const ada = (app: string, name: string, version: number) =>
  team.withSigner((signer) =>
    createSecret({
      trust: team.trust,
      serverId: server.serverId,
      app,
      name,
      value: `set by Ada, version ${version}`,
      version,
      signer,
    })
  )

/** The removal of a secret of `app`, signed by Ada. */
const adaRemoves = (app: string, name: string, version: number) =>
  team.withSigner((signer) =>
    createSecretRemoval({
      trust: team.trust,
      serverId: server.serverId,
      app,
      name,
      version,
      signer,
    })
  )

/** This machine's store for `app`, whole. */
const store = (
  app: string,
  records: SecretRecord[],
  removals: Envelope[] = []
) => team.store.saveSecrets(server.serverId, app, { records, removals })

/** The runner's `status`, with these entries of `secrets`, each `app/NAME`. */
function status(
  secrets: Record<string, { version: number; removed?: boolean }> = {}
): RunnerStatus {
  const entry = team.trust.servers.find(
    (known) => known.serverId === server.serverId
  )!
  return {
    serverId: server.serverId,
    serverPublicKey: entry.publicKey,
    team: {
      teamId: team.trust.teamId,
      version: team.trust.version,
      hash: team.trust.hash,
    },
    lastSequence: {},
    secrets: Object.fromEntries(
      Object.entries(secrets).map(([key, value]) => [
        key,
        { version: value.version, removed: value.removed ?? false },
      ])
    ),
  }
}

/** `listForDeploy` of `app`, and the warnings it said. */
function list(
  app: string,
  options: {
    held?: Envelope[]
    live?: Record<string, { version: number; removed?: boolean }>
    format?: 1 | 2
  } = {}
) {
  const warnings: string[] = []
  const listed = listForDeploy({
    team,
    server,
    app,
    status: status(options.live),
    held: options.held ?? [],
    format: options.format ?? 2,
    warning: (text) => warnings.push(text),
  })
  return { ...listed, warnings }
}

/** The sentence `listForDeploy` stopped with, and the warnings it said first. */
function stopped(app: string, options: Parameters<typeof list>[1] = {}) {
  try {
    list(app, options)
  } catch (error) {
    if (!(error instanceof CliError)) throw error
    return error.message
  }
  throw new Error("the deploy was not stopped")
}

const sigs = (envelopes: readonly Envelope[]) =>
  envelopes.map((envelope) => envelope.signature.sig)

describe("formerKeyIds", () => {
  test("the key ids of members of an earlier team list the current one lacks: Bea's", () => {
    expect(formerKeyIds(team)).toEqual([two.keyId])
    expect(team.trust.members.map((member) => member.name)).toEqual(["Ada"])
  })
})

describe("version 2 (CL12 to CL14, CL16, CL17)", () => {
  test("lists this machine's records and the runner's statements, supplies only what the runner lacks, and lists a secret only the runner holds without supplying it", async () => {
    const a = await ada("v2-list", "API_TOKEN", 1)
    const b = await ada("v2-list", "BUCKET", 1)
    // Set on another machine and held by the runner only.
    const c = await ada("v2-list", "CACHE_URL", 2)
    store("v2-list", [a, b])
    const listed = list("v2-list", {
      held: [a.envelope, c.envelope],
      live: {
        "v2-list/API_TOKEN": { version: 1 },
        "v2-list/CACHE_URL": { version: 2 },
        "other/BUCKET": { version: 9 },
      },
    })
    expect(sigs(listed.statements)).toEqual(
      sigs([a.envelope, b.envelope, c.envelope])
    )
    expect(listed.names).toEqual(["API_TOKEN", "BUCKET", "CACHE_URL"])
    expect(sigs(listed.supply.map((record) => record.envelope))).toEqual(
      sigs([b.envelope])
    )
    expect(listed.removals).toEqual([])
    expect(listed.warnings).toEqual([])
  })

  test("a removal of this machine is listed, and a name the runner holds as removed stops nothing", async () => {
    const a = await ada("v2-removal", "API_TOKEN", 1)
    const gone = await adaRemoves("v2-removal", "API_TOKEN", 2)
    store("v2-removal", [a], [gone])
    const listed = list("v2-removal", {
      held: [a.envelope],
      live: {
        "v2-removal/API_TOKEN": { version: 1 },
        "v2-removal/OLD": { version: 4, removed: true },
      },
    })
    expect(listed.statements).toEqual([])
    expect(sigs(listed.removals)).toEqual(sigs([gone]))
    expect(listed.supply).toEqual([])
  })

  test("C5: a live name with nothing verified here, such as a version-1 secret this machine never had", () => {
    store("v2-c5", [])
    expect(
      stopped("v2-c5", { live: { "v2-c5/DATABASE_URL": { version: 1 } } })
    ).toBe(C5("DATABASE_URL", "v2-c5", "dev"))
  })

  test("C5: a live name whose newest verified item is below the version the runner reports", async () => {
    store("v2-c5-older", [await ada("v2-c5-older", "DATABASE_URL", 1)])
    expect(
      stopped("v2-c5-older", {
        live: { "v2-c5-older/DATABASE_URL": { version: 2 } },
      })
    ).toBe(C5("DATABASE_URL", "v2-c5-older", "dev"))
  })

  test("C5 for a live name whose only item is by a key no team list ever had, which is not C4", async () => {
    const stranger = await signingTeam("v2-stranger")
    store("v2-stranger", [await stranger.secret("DATABASE_URL", "not ours", 5)])
    expect(
      stopped("v2-stranger", {
        live: { "v2-stranger/DATABASE_URL": { version: 5 } },
      })
    ).toBe(C5("DATABASE_URL", "v2-stranger", "dev"))
  })

  test("an item that blocks nothing keeps today's warning, and the deploy goes on", async () => {
    const a = await ada("v2-warned", "API_TOKEN", 1)
    const broken = {
      ...a,
      envelope: {
        ...a.envelope,
        signature: {
          ...a.envelope.signature,
          sig: `${a.envelope.signature.sig.slice(0, -2)}AA`,
        },
      },
    }
    const b = await ada("v2-warned", "BUCKET", 1)
    store("v2-warned", [broken, b])
    const listed = list("v2-warned")
    expect(listed.names).toEqual(["BUCKET"])
    expect(listed.warnings).toEqual(["Left out a record: bad_signature."])
  })
})

describe("version 1 (CL14, CL16)", () => {
  test("exactly what currentSecrets gives, with today's warnings, and never C5", async () => {
    const stranger = await signingTeam("v1-same")
    const a1 = await ada("v1-same", "API_TOKEN", 1)
    const a2 = await ada("v1-same", "API_TOKEN", 2)
    const b = await ada("v1-same", "BUCKET", 1)
    const other = await stranger.secret("CACHE_URL", "not ours", 1)
    store("v1-same", [a1, a2, b, other])
    const listed = list("v1-same", {
      format: 1,
      // Live names this machine cannot list: C5 on version 2 only.
      live: {
        "v1-same/CACHE_URL": { version: 1 },
        "v1-same/DATABASE_URL": { version: 7 },
      },
    })
    const current = currentSecrets({
      trust: team.trust,
      serverId: server.serverId,
      app: "v1-same",
      ...team.store.secrets(server.serverId, "v1-same"),
    })
    expect(listed.supply).toEqual(current.secrets)
    expect(listed.removals).toEqual(current.removals)
    expect(sigs(listed.statements)).toEqual(
      sigs(current.secrets.map((record) => record.envelope))
    )
    expect(listed.names).toEqual(["API_TOKEN", "BUCKET"])
    expect(listed.warnings).toEqual(
      current.ignored.map(
        (ignored) =>
          `Left out a ${ignored.kind}${ignored.name ? ` for ${ignored.name}` : ""}: ${ignored.reason}.`
      )
    )
    expect(listed.warnings).toEqual(["Left out a record: unknown_signer."])
  })
})

describe("C4: a secret set by someone who is no longer in the team (CL15, both formats)", () => {
  test("this machine's record of Bea's, the newest of its name", () => {
    store("c4-own", [bea.own!])
    for (const format of [1, 2] as const)
      expect(
        stopped("c4-own", {
          format,
          live: { "c4-own/DATABASE_URL": { version: 1 } },
        })
      ).toBe(C4("DATABASE_URL", "c4-own"))
  })

  test("a statement of Bea's the runner holds, newer than this machine's", async () => {
    store("c4-runner", [await ada("c4-runner", "DATABASE_URL", 2)])
    expect(
      stopped("c4-runner", {
        held: [bea.runner!.envelope],
        live: { "c4-runner/DATABASE_URL": { version: 3 } },
      })
    ).toBe(C4("DATABASE_URL", "c4-runner"))
  })

  test("an older one of Bea's is left out with its warning only", async () => {
    const newer = await ada("c4-older", "DATABASE_URL", 2)
    store("c4-older", [bea.older!, newer])
    for (const format of [1, 2] as const) {
      const listed = list("c4-older", {
        format,
        live: { "c4-older/DATABASE_URL": { version: 2 } },
      })
      expect(sigs(listed.statements)).toEqual(sigs([newer.envelope]))
      expect(listed.warnings).toEqual(["Left out a record: unknown_signer."])
    }
  })

  test("a key no team list ever had is not C4: on version 1 a warning only", async () => {
    const stranger = await signingTeam("c4-stranger")
    store("c4-stranger", [await stranger.secret("DATABASE_URL", "not ours", 1)])
    const listed = list("c4-stranger", { format: 1 })
    expect(listed.statements).toEqual([])
    expect(listed.warnings).toEqual(["Left out a record: unknown_signer."])
  })

  test("two such secrets: two lines, then `Nothing was signed.` once", () => {
    store("c4-two", [bea.twoB!, bea.twoA!])
    const expected = [
      "DATABASE_URL was set by someone who is no longer in the team, so c4-two cannot be deployed with it. Set it again with `zekno secret set DATABASE_URL`, or remove it with `zekno secret rm DATABASE_URL`.",
      "PAYMENTS_KEY was set by someone who is no longer in the team, so c4-two cannot be deployed with it. Set it again with `zekno secret set PAYMENTS_KEY`, or remove it with `zekno secret rm PAYMENTS_KEY`. Nothing was signed.",
    ].join("\n")
    for (const format of [1, 2] as const)
      expect(stopped("c4-two", { format })).toBe(expected)
  })
})

describe("C5b: the server holds a newer secret than the one set on this machine (CL16b)", () => {
  test("this machine's record at version 2 and a statement the runner holds at version 3, of another hash: C5b", async () => {
    store("c5b", [await ada("c5b", "DATABASE_URL", 2)])
    // Set again on another machine of the team, and deployed from there.
    const three = await ada("c5b", "DATABASE_URL", 3)
    expect(
      stopped("c5b", {
        held: [three.envelope],
        live: { "c5b/DATABASE_URL": { version: 3 } },
      })
    ).toBe(C5b("DATABASE_URL", "c5b", "dev"))
  })

  test("this machine's versions 1 and 2, and the runner's version 2, the same statement: listed, no C5b", async () => {
    const one = await ada("c5b-same", "DATABASE_URL", 1)
    const two = await ada("c5b-same", "DATABASE_URL", 2)
    store("c5b-same", [one, two])
    const listed = list("c5b-same", {
      held: [two.envelope],
      live: { "c5b-same/DATABASE_URL": { version: 2 } },
    })
    expect(sigs(listed.statements)).toEqual(sigs([two.envelope]))
    expect(listed.supply).toEqual([])
  })

  test("this machine's version 2 and the runner's version 1: this machine's is listed and supplied, no C5b", async () => {
    const one = await ada("c5b-ahead", "DATABASE_URL", 1)
    const two = await ada("c5b-ahead", "DATABASE_URL", 2)
    store("c5b-ahead", [two])
    const listed = list("c5b-ahead", {
      held: [one.envelope],
      live: { "c5b-ahead/DATABASE_URL": { version: 1 } },
    })
    expect(sigs(listed.statements)).toEqual(sigs([two.envelope]))
    expect(sigs(listed.supply.map((record) => record.envelope))).toEqual(
      sigs([two.envelope])
    )
  })

  test("this machine's removal at version 3 and the runner's version 4: the runner's is listed, no C5b", async () => {
    const removal = await adaRemoves("c5b-removed", "DATABASE_URL", 3)
    store("c5b-removed", [], [removal])
    const four = await ada("c5b-removed", "DATABASE_URL", 4)
    const listed = list("c5b-removed", {
      held: [four.envelope],
      live: { "c5b-removed/DATABASE_URL": { version: 4 } },
    })
    expect(sigs(listed.statements)).toEqual(sigs([four.envelope]))
    expect(listed.removals).toEqual([])
    expect(listed.supply).toEqual([])
  })

  test("nothing of the name here: listed from the runner, nothing supplied (US2 scenario 5)", async () => {
    store("c5b-none", [])
    const held = await ada("c5b-none", "DATABASE_URL", 3)
    const listed = list("c5b-none", {
      held: [held.envelope],
      live: { "c5b-none/DATABASE_URL": { version: 3 } },
    })
    expect(sigs(listed.statements)).toEqual(sigs([held.envelope]))
    expect(listed.names).toEqual(["DATABASE_URL"])
    expect(listed.supply).toEqual([])
  })

  test("version 1: never", async () => {
    store("c5b-v1", [await ada("c5b-v1", "DATABASE_URL", 2)])
    const listed = list("c5b-v1", {
      format: 1,
      live: { "c5b-v1/DATABASE_URL": { version: 3 } },
    })
    expect(listed.names).toEqual(["DATABASE_URL"])
  })
})

describe("several blocked names, each of its kind, in name order", () => {
  test("C5, C4 and C5b joined in name order, `Nothing was signed.` once", async () => {
    store("mixed", [bea.mixed!, await ada("mixed", "PAYMENTS_KEY", 1)])
    const newer = await ada("mixed", "PAYMENTS_KEY", 2)
    expect(
      stopped("mixed", {
        held: [newer.envelope],
        live: {
          "mixed/API_TOKEN": { version: 1 },
          "mixed/DATABASE_URL": { version: 1 },
          "mixed/PAYMENTS_KEY": { version: 2 },
        },
      })
    ).toBe(
      blockedLines(
        [
          { name: "API_TOKEN", why: "cannot_check" },
          { name: "DATABASE_URL", why: "former_member" },
          { name: "PAYMENTS_KEY", why: "newer_on_server" },
        ],
        { app: "mixed", server: "dev" }
      )
    )
  })
})
