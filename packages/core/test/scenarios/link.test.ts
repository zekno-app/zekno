import { describe, expect, test } from "bun:test"

import { signEnvelope } from "../../src/crypto/envelope"
import {
  applyRosterUpdate,
  createLink,
  createSecretRemoval,
  LIMITS,
  PAYLOAD_TYPES,
  readSignedDeploy,
  teamConfirmationCode,
  trustFoundingRoster,
  verifyDeploy,
  verifyLink,
  verifySecret,
  verifySecretRemoval,
  type Envelope,
  type TeamTrust,
} from "../../src/index"
import {
  addServer,
  catchUp,
  changeTeam,
  overTheWire,
  person,
  propose,
  publish,
  setSecret,
  setup,
} from "../support/helpers"

const code = (result: { ok: boolean; error?: { code: string } }) =>
  result.ok ? "accepted" : result.error!.code

const bytes = (text: string) => new TextEncoder().encode(text)
const decoded = (envelope: Envelope) =>
  JSON.parse(
    Buffer.from(envelope.payload, "base64url").toString("utf8")
  ) as Record<string, unknown>
const encoded = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url")

/** A team with one admin, one server, and a link the admin signed for web on that server. */
async function linked() {
  const first = await setup()
  const link = await createLink({
    trust: first.trust,
    serverId: first.server.serverId,
    app: "web",
    compose: "deploy/compose.yaml",
    signer: first.founder.signer,
  })
  return { ...first, link }
}

describe("a link: a member's signed statement that a folder deploys one app to one server", () => {
  test("a member's link verifies and names who signed it; a deployer's does too; the same content gives the same bytes", async () => {
    const { founder, relay, server, trust, link } = await linked()
    expect(link.payloadType).toBe("zekno.link.v1")
    expect(decoded(link)).toEqual({
      v: 1,
      teamId: trust.teamId,
      serverId: server.serverId,
      app: "web",
      compose: "deploy/compose.yaml",
    })
    const verified = verifyLink(trust, overTheWire(link))
    expect(verified).toEqual({
      ok: true,
      value: {
        serverId: server.serverId,
        app: "web",
        compose: "deploy/compose.yaml",
        signer: { name: "Ada", publicKey: founder.publicKey, role: "admin" },
      },
    })
    // Signed again, the same content gives the same envelope, byte for byte.
    expect(
      await createLink({
        trust,
        serverId: server.serverId,
        app: "web",
        compose: "deploy/compose.yaml",
        signer: founder.signer,
      })
    ).toEqual(link)

    const grace = person("Grace")
    const withGrace = await changeTeam({
      relay,
      trust,
      signer: founder.signer,
      members: [
        ...trust.members,
        { name: "Grace", publicKey: grace.publicKey, role: "deployer" },
      ],
    })
    const hers = await createLink({
      trust: withGrace,
      serverId: server.serverId,
      app: "api",
      compose: "compose.yaml",
      signer: grace.signer,
    })
    expect(verifyLink(withGrace, hers)).toMatchObject({
      ok: true,
      value: { app: "api", signer: { name: "Grace", role: "deployer" } },
    })
    // A later team list that keeps its signer and its server does not change it.
    const { trust: later } = await addServer({
      relay,
      trust: withGrace,
      admin: founder.signer,
      name: "prod-2",
    })
    expect(code(verifyLink(later, link))).toBe("accepted")
    expect(code(verifyLink(later, hers))).toBe("accepted")
  })

  test("another team's link is refused, also when it names our server", async () => {
    const ours = await linked()
    const theirs = await setup("Mallory")
    // Mallory lists our server in her own team and signs a link to it.
    const theirTrust = await changeTeam({
      relay: theirs.relay,
      trust: theirs.trust,
      signer: theirs.founder.signer,
      servers: [
        ...theirs.trust.servers,
        { name: "victim", publicKey: ours.server.publicKey },
      ],
    })
    const forged = await createLink({
      trust: theirTrust,
      serverId: ours.server.serverId,
      app: "web",
      compose: "compose.yaml",
      signer: theirs.founder.signer,
    })
    expect(code(verifyLink(ours.trust, forged))).toBe("unknown_signer")
    // Her link names her team's id: a team list of ours that counted her key would still not take it.
    // (A link is bound to its team by the team's id only: one she signed for our team, as a member of it, would count.)
    expect(
      code(verifyLink({ ...ours.trust, members: theirTrust.members }, forged))
    ).toBe("wrong_team")
    // And ours means nothing to her team.
    expect(code(verifyLink(theirTrust, ours.link))).toBe("unknown_signer")
  })

  test("a removed member's link stops counting, and so does a link to a server taken off the list", async () => {
    const { founder, relay, server, trust } = await setup()
    const grace = person("Grace")
    const withGrace = await changeTeam({
      relay,
      trust,
      signer: founder.signer,
      members: [
        ...trust.members,
        { name: "Grace", publicKey: grace.publicKey, role: "deployer" },
      ],
    })
    const hers = await createLink({
      trust: withGrace,
      serverId: server.serverId,
      app: "web",
      compose: "compose.yaml",
      signer: grace.signer,
    })
    expect(code(verifyLink(withGrace, hers))).toBe("accepted")
    const without = await changeTeam({
      relay,
      trust: withGrace,
      signer: founder.signer,
      members: trust.members,
    })
    expect(code(verifyLink(without, hers))).toBe("unknown_signer")

    const { server: second, trust: two } = await addServer({
      relay,
      trust: without,
      admin: founder.signer,
      name: "prod-2",
    })
    catchUp(server, relay)
    const toSecond = await createLink({
      trust: two,
      serverId: second.serverId,
      app: "web",
      compose: "compose.yaml",
      signer: founder.signer,
    })
    expect(code(verifyLink(two, toSecond))).toBe("accepted")
    const fewer = await changeTeam({
      relay,
      trust: two,
      signer: founder.signer,
      servers: two.servers.filter(
        (entry) => entry.serverId !== second.serverId
      ),
    })
    expect(code(verifyLink(fewer, toSecond))).toBe("unknown_server")
  })

  test("a changed payload, signature or signer is refused", async () => {
    const { relay, founder, trust, link } = await linked()
    const grace = person("Grace")
    const withGrace = await changeTeam({
      relay,
      trust,
      signer: founder.signer,
      members: [
        ...trust.members,
        { name: "Grace", publicKey: grace.publicKey, role: "admin" },
      ],
    })
    const graceKeyId = (
      await createLink({
        trust: withGrace,
        serverId: trust.servers[0]!.serverId,
        app: "web",
        compose: "compose.yaml",
        signer: grace.signer,
      })
    ).signature.keyId
    // Another last character: one the original does not end with.
    const otherEnd = (text: string) =>
      text.replace(/.$/, (last) => (last === "0" ? "1" : "0"))
    for (const field of ["app", "compose", "serverId", "teamId"] as const) {
      const changed = {
        ...decoded(link),
        [field]:
          field === "app"
            ? "api"
            : field === "compose"
              ? "other.yaml"
              : otherEnd(String(decoded(link)[field])),
      }
      expect({
        field,
        result: code(
          verifyLink(withGrace, { ...link, payload: encoded(changed) })
        ),
      }).toEqual({ field, result: "bad_signature" })
    }
    const sig = Buffer.from(link.signature.sig, "base64url")
    sig[10] = sig[10]! ^ 1
    expect(
      code(
        verifyLink(trust, {
          ...link,
          signature: { ...link.signature, sig: sig.toString("base64url") },
        })
      )
    ).toBe("bad_signature")
    // Ada's signature presented as Grace's.
    expect(
      code(
        verifyLink(withGrace, {
          ...link,
          signature: { ...link.signature, keyId: graceKeyId },
        })
      )
    ).toBe("bad_signature")
    expect(code(verifyLink(withGrace, link))).toBe("accepted")
  })

  test("no other kind of signed message is taken as a link, and a link is taken as none of them", async () => {
    const { founder, team, relay, server, trust, link } = await linked()
    const deploy = await publish({
      relay,
      trust,
      server,
      signer: founder.signer,
      sequence: 1,
    })
    const record = await setSecret({
      relay,
      trust,
      server,
      signer: founder.signer,
      name: "DATABASE_URL",
      value: "postgres://demo@db.example/app",
      version: 2,
    })
    const removal = await createSecretRemoval({
      trust,
      serverId: server.serverId,
      app: "web",
      name: "PAYMENTS_KEY",
      version: 2,
      signer: founder.signer,
    })
    const roster = await propose({ trust, signer: founder.signer })
    const genuine: [string, Envelope][] = [
      ["deploy", deploy.envelope],
      ["founding team list", team.envelope],
      ["team list", relay.rosters.at(-1)!],
      ["proposed team list", roster],
      ["secret", record.envelope],
      ["secret removal", removal],
    ]
    // Each, as it is, is refused for its kind; relabelled as a link, its signature no longer matches.
    for (const [kind, envelope] of genuine) {
      expect({ kind, as: code(verifyLink(trust, envelope)) }).toEqual({
        kind,
        as: "wrong_payload_type",
      })
      expect({
        kind,
        relabelled: code(
          verifyLink(trust, { ...envelope, payloadType: PAYLOAD_TYPES.link })
        ),
      }).toEqual({ kind, relabelled: "bad_signature" })
    }

    // A link handed to every other check: refused for its kind, and relabelled, for its signature (or, for a founding list, its code).
    const as = (type: string): Envelope => ({ ...link, payloadType: type })
    const checks: [
      string,
      (envelope: Envelope) => { ok: boolean; error?: { code: string } },
      string,
    ][] = [
      [
        "deploy (runner)",
        (envelope) =>
          verifyDeploy({ envelope, secrets: [], state: server.state }),
        PAYLOAD_TYPES.deploy,
      ],
      [
        "deploy (history)",
        (envelope) => readSignedDeploy({ envelope, trust }),
        PAYLOAD_TYPES.deploy,
      ],
      [
        "team list",
        (envelope) => applyRosterUpdate(trust, envelope),
        PAYLOAD_TYPES.roster,
      ],
      [
        "founding team list",
        (envelope) =>
          trustFoundingRoster(envelope, teamConfirmationCode(trust)),
        PAYLOAD_TYPES.roster,
      ],
      [
        "secret",
        (envelope) =>
          verifySecret({
            record: { envelope, sealed: record.sealed },
            trust,
            serverId: server.serverId,
            app: "web",
          }),
        PAYLOAD_TYPES.secret,
      ],
      [
        "secret removal",
        (envelope) =>
          verifySecretRemoval({
            removal: envelope,
            trust,
            serverId: server.serverId,
            app: "web",
          }),
        PAYLOAD_TYPES.secretRemoval,
      ],
    ]
    for (const [kind, check, type] of checks) {
      expect({ kind, as: code(check(link)) }).toEqual({
        kind,
        as: "wrong_payload_type",
      })
      const relabelled = code(check(as(type)))
      expect({ kind, relabelled }).toEqual({
        kind,
        relabelled:
          kind === "founding team list" ? "code_mismatch" : "bad_signature",
      })
    }

    // A member's signature over one kind's content, made as the other kind, is refused by its content.
    const deployAsLink = await signEnvelope(
      PAYLOAD_TYPES.link,
      Buffer.from(deploy.envelope.payload, "base64url"),
      founder.signer
    )
    expect(code(verifyLink(trust, deployAsLink))).toBe("malformed")
    const linkAsDeploy = await signEnvelope(
      PAYLOAD_TYPES.deploy,
      Buffer.from(link.payload, "base64url"),
      founder.signer
    )
    expect(
      code(
        verifyDeploy({
          envelope: linkAsDeploy,
          secrets: [],
          state: server.state,
        })
      )
    ).toBe("malformed")
    expect(code(readSignedDeploy({ envelope: linkAsDeploy, trust }))).toBe(
      "malformed"
    )
  })

  test("an oversized or malformed envelope is refused without throwing", async () => {
    const { founder, server, trust, link } = await linked()
    const sign = (text: string | Uint8Array) =>
      signEnvelope(
        PAYLOAD_TYPES.link,
        typeof text === "string" ? bytes(text) : text,
        founder.signer
      )
    const content = decoded(link)
    const inputs: [string, unknown, string][] = [
      ["null", null, "malformed"],
      ["undefined", undefined, "malformed"],
      ["a number", 1, "malformed"],
      ["text", "zekno.link.v1", "malformed"],
      ["an array", [link], "malformed"],
      ["an empty object", {}, "malformed"],
      ["a field more", { ...link, note: "hello" }, "malformed"],
      [
        "a signature with a field more",
        { ...link, signature: { ...link.signature, extra: true } },
        "malformed",
      ],
      [
        "a payload that is not base64url",
        { ...link, payload: "not base64url!" },
        "malformed",
      ],
      [
        "a payload past the limit",
        { ...link, payload: "A".repeat(LIMITS.payloadBytes * 2) },
        "too_large",
      ],
      [
        "a payload past the limit, in an envelope of the wrong shape",
        { payload: "A".repeat(LIMITS.payloadBytes * 2) },
        "too_large",
      ],
      ["not JSON", await sign("{not json"), "malformed"],
      [
        "not UTF-8",
        await sign(new Uint8Array([0xff, 0xfe, 0xfd])),
        "malformed",
      ],
      [
        "another version",
        await sign(JSON.stringify({ ...content, v: 2 })),
        "unsupported_version",
      ],
      [
        "a field more, signed",
        await sign(JSON.stringify({ ...content, folder: "/home/ada/shop" })),
        "malformed",
      ],
      [
        "a field missing",
        await sign(JSON.stringify({ ...content, compose: undefined })),
        "malformed",
      ],
      [
        "an app outside the pattern",
        await sign(JSON.stringify({ ...content, app: "../etc" })),
        "malformed",
      ],
      [
        "a Compose path with a control character",
        await sign(JSON.stringify({ ...content, compose: "compose\n.yaml" })),
        "malformed",
      ],
      [
        "a Compose path with a direction override",
        await sign(
          JSON.stringify({ ...content, compose: "\u202elmay.esopmoc" })
        ),
        "malformed",
      ],
      [
        "a Compose path with a lone surrogate",
        await sign(JSON.stringify({ ...content, compose: "\ud800.yaml" })),
        "malformed",
      ],
      [
        "a Compose path of 256 characters",
        await sign(JSON.stringify({ ...content, compose: "c".repeat(256) })),
        "malformed",
      ],
      [
        "an empty Compose path",
        await sign(JSON.stringify({ ...content, compose: "" })),
        "malformed",
      ],
      [
        "a prototype field",
        await sign(
          `{"v":1,"teamId":"${trust.teamId}","serverId":"${server.serverId}","app":"web","compose":"c","__proto__":{"x":1}}`
        ),
        "malformed",
      ],
    ]
    for (const [what, input, expected] of inputs) {
      let result
      expect(() => (result = verifyLink(trust, input))).not.toThrow()
      expect({ what, result: code(result!) }).toEqual({
        what,
        result: expected,
      })
    }
    // The longest Compose path allowed is taken.
    const longest = await sign(
      JSON.stringify({
        ...content,
        compose: "c".repeat(LIMITS.linkComposeLength),
      })
    )
    expect(code(verifyLink(trust, longest))).toBe("accepted")
  })

  test("a link is made only by a member, for a server of the team, with a valid app and Compose path", async () => {
    const { founder, server, trust } = await setup()
    const base = {
      trust,
      serverId: server.serverId,
      app: "web",
      compose: "compose.yaml",
      signer: founder.signer,
    }
    const stranger = person("Mallory")
    await expect(
      createLink({ ...base, signer: stranger.signer })
    ).rejects.toMatchObject({ code: "not_member" })
    await expect(
      createLink({ ...base, serverId: `srv_${"0".repeat(32)}` })
    ).rejects.toMatchObject({ code: "unknown_server" })
    for (const change of [
      { app: "Web App" },
      { app: "" },
      { compose: "" },
      { compose: "a\u0000b" },
      { compose: "\u202ecompose" },
      { compose: "c".repeat(256) },
    ]) {
      await expect(createLink({ ...base, ...change })).rejects.toMatchObject({
        code: "invalid_argument",
      })
    }
    await expect(
      createLink({ ...base, trust: { ...trust, teamId: "nope" } as TeamTrust })
    ).rejects.toMatchObject({ code: "invalid_argument" })
  })

  test("a Compose path that could leave the folder is neither made nor taken: absolute, a backslash, empty, a `.` or `..` part", async () => {
    const { founder, server, trust, link } = await linked()
    const base = {
      trust,
      serverId: server.serverId,
      app: "web",
      signer: founder.signer,
    }
    const sign = (compose: string) =>
      signEnvelope(
        PAYLOAD_TYPES.link,
        bytes(JSON.stringify({ ...decoded(link), compose })),
        founder.signer
      )
    const leaving = [
      "/etc/compose.yaml",
      "/",
      "../../etc/compose.yaml",
      "..",
      "deploy/../../compose.yaml",
      "deploy/..",
      "..\\x.yaml",
      "deploy\\compose.yaml",
      "",
      ".",
      "./compose.yaml",
      "deploy/./compose.yaml",
      "deploy/.",
    ]
    for (const compose of leaving) {
      await expect(createLink({ ...base, compose })).rejects.toMatchObject({
        code: "invalid_argument",
      })
      expect({
        compose,
        verified: code(verifyLink(trust, await sign(compose))),
      }).toEqual({ compose, verified: "malformed" })
    }
    // A name that only starts or ends with dots is a name, not a step up or a step in place.
    for (const compose of [
      "deploy/compose.yaml",
      ".compose.yaml",
      "..compose.yaml",
      "compose.yaml..",
      "deploy/.hidden/c.yaml",
      "a..b/c.yaml",
    ]) {
      expect({
        compose,
        made: code(verifyLink(trust, await createLink({ ...base, compose }))),
      }).toEqual({ compose, made: "accepted" })
      expect({
        compose,
        verified: code(verifyLink(trust, await sign(compose))),
      }).toEqual({ compose, verified: "accepted" })
    }
  })
})
