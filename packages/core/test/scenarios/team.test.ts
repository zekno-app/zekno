import { describe, expect, test } from "bun:test"

import { applyRosterUpdate, verifyDeploy, type Member } from "../../src/index"
import { overTheWire, person, publish, setup, propose } from "../helpers"

const code = (result: { ok: boolean; error?: { code: string } }) =>
  result.ok ? "accepted" : result.error!.code

describe("User Story 3: team membership the relay cannot forge", () => {
  test("an admin adds a deployer, and servers then accept the deployer's deploys", async () => {
    const { founder, relay, server, trust } = await setup()
    const grace = person("Grace")

    // Before the change reaches the server, Grace's deploy is refused.
    const next: Member[] = [...trust.members, { name: "Grace", publicKey: grace.publicKey, role: "deployer" }]
    const update = await propose({ trust, members: next, signer: founder.signer })
    const clientTrust = applyRosterUpdate(trust, update)
    if (!clientTrust.ok) throw new Error("expected the client to accept its own update")
    const early = await publish({ relay, trust: clientTrust.value, server, signer: grace.signer, sequence: 1 })
    expect(code(verifyDeploy({ ...early, state: server.state }))).toBe("unknown_signer")

    // The server receives the change through the relay and moves forward.
    const serverTrust = applyRosterUpdate(server.state.team, overTheWire(update))
    expect(serverTrust.ok).toBe(true)
    if (!serverTrust.ok) return
    expect(serverTrust.value.version).toBe(trust.version + 1)
    const state = { ...server.state, team: serverTrust.value }
    const verified = verifyDeploy({ ...early, state })
    expect(verified.ok).toBe(true)
    if (verified.ok) expect(verified.value.signer).toMatchObject({ name: "Grace", role: "deployer" })
  })

  test("a change no current admin signed is refused and trust stays as it was", async () => {
    const { server, trust } = await setup()
    const mallory = person("Mallory")
    // The relay invents a list that adds Mallory as admin, signed by Mallory.
    const forged = await propose({
      trust: { ...trust, members: [...trust.members, { name: "Mallory", publicKey: mallory.publicKey, role: "admin" }] },
      members: [...trust.members, { name: "Mallory", publicKey: mallory.publicKey, role: "admin" }],
      signer: mallory.signer,
    })
    const result = applyRosterUpdate(server.state.team, forged)
    expect(code(result)).toBe("unknown_signer")
    expect(server.state.team).toEqual(trust)
  })

  test("a deployer cannot change the team", async () => {
    const { founder, trust } = await setup()
    const grace = person("Grace")
    const withGrace: Member[] = [...trust.members, { name: "Grace", publicKey: grace.publicKey, role: "deployer" }]
    const added = applyRosterUpdate(trust, await propose({ trust, members: withGrace, signer: founder.signer }))
    if (!added.ok) throw new Error("expected acceptance")

    // The library refuses to build it for her...
    const promote: Member[] = withGrace.map((member) => (member.name === "Grace" ? { ...member, role: "admin" } : member))
    await expect(propose({ trust: added.value, members: promote, signer: grace.signer })).rejects.toMatchObject({ code: "not_admin" })

    // ...and a server refuses one built by other means: here, signed as if she were admin.
    const pretend = { ...added.value, members: promote }
    const forged = await propose({ trust: pretend, members: promote, signer: grace.signer })
    expect(code(applyRosterUpdate(added.value, forged))).toBe("not_admin")
  })

  test("a removed member's deploys are refused once the server has the change", async () => {
    const { founder, relay, server, trust } = await setup()
    const grace = person("Grace")
    const withGrace: Member[] = [...trust.members, { name: "Grace", publicKey: grace.publicKey, role: "deployer" }]
    const v2 = await propose({ trust, members: withGrace, signer: founder.signer })
    const trust2 = applyRosterUpdate(trust, v2)
    if (!trust2.ok) throw new Error("expected acceptance")
    const v3 = await propose({ trust: trust2.value, members: trust.members, signer: founder.signer })

    let team = server.state.team
    for (const update of [v2, v3]) {
      const applied = applyRosterUpdate(team, update)
      if (!applied.ok) throw new Error("expected acceptance")
      team = applied.value
    }
    expect(team.members.map((member) => member.name)).toEqual(["Ada"])

    const deploy = await publish({ relay, trust: trust2.value, server, signer: grace.signer, sequence: 1 })
    expect(code(verifyDeploy({ ...deploy, state: { ...server.state, team } }))).toBe("unknown_signer")
  })

  test("a server never goes back to an earlier list, skips one, or applies one twice", async () => {
    const { founder, team, server, trust } = await setup()
    const grace = person("Grace")
    const hedy = person("Hedy")
    const v2 = await propose({ trust, members: [...trust.members, { name: "Grace", publicKey: grace.publicKey, role: "deployer" }], signer: founder.signer })
    const trust2 = applyRosterUpdate(trust, v2)
    if (!trust2.ok) throw new Error("expected acceptance")
    const v3 = await propose({ trust: trust2.value, members: [...trust2.value.members, { name: "Hedy", publicKey: hedy.publicKey, role: "deployer" }], signer: founder.signer })

    // Skipping version 2.
    expect(code(applyRosterUpdate(server.state.team, v3))).toBe("wrong_version")

    const at2 = applyRosterUpdate(server.state.team, v2)
    if (!at2.ok) throw new Error("expected acceptance")
    const at3 = applyRosterUpdate(at2.value, v3)
    if (!at3.ok) throw new Error("expected acceptance")

    // Going back, repeating, and replaying the founding list.
    expect(code(applyRosterUpdate(at3.value, v2))).toBe("wrong_version")
    expect(code(applyRosterUpdate(at3.value, v3))).toBe("wrong_version")
    expect(code(applyRosterUpdate(at3.value, team.envelope))).toBe("wrong_version")
  })

  test("a list with the right number that does not follow the current one is refused", async () => {
    const { founder, server, trust } = await setup()
    const grace = person("Grace")
    const members: Member[] = [...trust.members, { name: "Grace", publicKey: grace.publicKey, role: "deployer" }]
    // The admin signs a version-2 list on top of a different history.
    const otherHistory = { ...trust, hash: "0".repeat(64) }
    const fork = await propose({ trust: otherHistory, members, signer: founder.signer })
    expect(code(applyRosterUpdate(server.state.team, fork))).toBe("wrong_previous")
  })

  test("a list that belongs to another team is refused", async () => {
    const ours = await setup("Ada")
    const theirs = await setup("Bob")
    // Ada is, improbably, an admin of both teams.
    const mixed = { ...theirs.trust, members: ours.trust.members }
    const update = await propose({ trust: mixed, members: ours.trust.members, signer: ours.founder.signer })
    expect(code(applyRosterUpdate(ours.trust, update))).toBe("wrong_team")
  })

  test("a team can never be left without an admin, or hold a key or a name twice", async () => {
    const { founder, trust } = await setup()
    const grace = person("Grace")
    const noAdmin: Member[] = [{ name: "Grace", publicKey: grace.publicKey, role: "deployer" }]
    const sameKey: Member[] = [...trust.members, { name: "Ada again", publicKey: founder.publicKey, role: "deployer" }]
    const sameName: Member[] = [...trust.members, { name: "Ada", publicKey: grace.publicKey, role: "deployer" }]
    for (const members of [noAdmin, sameKey, sameName, []]) {
      await expect(propose({ trust, members, signer: founder.signer })).rejects.toMatchObject({ code: "invalid_members" })
    }
  })

  test("a signed deploy is never accepted as a team change, or the reverse", async () => {
    const { founder, team, relay, server, trust } = await setup()
    const deploy = await publish({ relay, trust, server, signer: founder.signer, sequence: 1 })

    expect(code(applyRosterUpdate(trust, deploy.envelope))).toBe("wrong_payload_type")
    expect(code(verifyDeploy({ envelope: team.envelope, secrets: [], state: server.state }))).toBe("wrong_payload_type")

    // Relabelling the kind does not help: the kind is part of what was signed.
    const relabelled = { ...deploy.envelope, payloadType: "zekno.roster.v1" }
    expect(code(applyRosterUpdate(trust, relabelled))).toBe("bad_signature")
  })
})
