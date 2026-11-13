import { describe, expect, test } from "bun:test"

import {
  confirmationCodesMatch,
  createTeam,
  generateServerKeyPair,
  teamConfirmationCode,
  serverConfirmationCode,
  trustFoundingRoster,
} from "../../src/index"
import { changeTeam, overTheWire, person, setup } from "../helpers"

describe("User Story 4: confirming keys when a server is connected", () => {
  test("the same key gives the same code on two machines", () => {
    const server = generateServerKeyPair()
    const onServer = serverConfirmationCode(server.publicKey)
    const onLaptop = serverConfirmationCode(overTheWire(server.publicKey))
    expect(onServer).toBe(onLaptop)
    expect(onServer).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}$/)
  })

  test("a key substituted by the relay shows a different code", () => {
    const genuine = generateServerKeyPair()
    const substituted = generateServerKeyPair()
    const shownOnServer = serverConfirmationCode(genuine.publicKey)
    const shownInCli = serverConfirmationCode(substituted.publicKey)
    expect(confirmationCodesMatch(shownOnServer, shownInCli)).toBe(false)
    // What the check prevents: secrets sealed for the substituted key would be readable by the relay.
    expect(substituted.serverId).not.toBe(genuine.serverId)
  })

  test("a typed code matches regardless of case, separators and look-alike letters", () => {
    const code = serverConfirmationCode(generateServerKeyPair().publicKey)
    expect(confirmationCodesMatch(code, code.toLowerCase())).toBe(true)
    expect(confirmationCodesMatch(code, code.replace(/-/g, " "))).toBe(true)
    expect(confirmationCodesMatch(code, code.replace(/-/g, ""))).toBe(true)
    expect(confirmationCodesMatch(code, code.replace(/0/g, "O").replace(/1/g, "l"))).toBe(true)
    expect(confirmationCodesMatch(code, code.slice(0, -1))).toBe(false)
    expect(confirmationCodesMatch(code, "")).toBe(false)
    const lastDiffers = code.slice(0, -1) + (code.endsWith("Z") ? "Y" : "Z")
    expect(confirmationCodesMatch(code, lastDiffers)).toBe(false)
  })

  test("a server starts from a founding list only when its code was confirmed", async () => {
    const ada = person("Ada")
    const team = await createTeam({ founderName: "Ada", signer: ada.signer })
    expect(teamConfirmationCode(team.trust)).toBe(team.confirmationCode)

    const confirmed = trustFoundingRoster(overTheWire(team.envelope), team.confirmationCode)
    expect(confirmed.ok).toBe(true)
    if (confirmed.ok) expect(confirmed.value).toEqual(team.trust)

    const unconfirmed = trustFoundingRoster(team.envelope, "0000-0000-0000-0000-0000")
    expect(unconfirmed.ok).toBe(false)
    if (!unconfirmed.ok) expect(unconfirmed.error.code).toBe("code_mismatch")
  })

  test("a founding list substituted by the relay does not match the confirmed code", async () => {
    const ada = person("Ada")
    const mallory = person("Mallory")
    const genuine = await createTeam({ founderName: "Ada", signer: ada.signer })
    const substituted = await createTeam({ founderName: "Ada", signer: mallory.signer })

    // The person confirmed Ada's code; the relay delivers Mallory's list.
    const result = trustFoundingRoster(substituted.envelope, genuine.confirmationCode)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("code_mismatch")
  })

  test("the team's code stays the same after the team changes, without asking the relay", async () => {
    const { founder, team, relay, trust } = await setup()
    const grace = person("Grace")
    const later = await changeTeam({ relay, trust, signer: founder.signer, members: [...trust.members, { name: "Grace", publicKey: grace.publicKey, role: "deployer" }] })
    expect(later.version).toBe(3)
    // Any member's client can show the code from its own trust at any version.
    expect(teamConfirmationCode(later)).toBe(team.confirmationCode)

    // A second server is connected while the team is at version 3. The relay
    // serves its own "founding list"; the code a member reads out does not match it.
    const mallory = person("Mallory")
    const substituted = await createTeam({ founderName: "Ada", signer: mallory.signer })
    expect(trustFoundingRoster(substituted.envelope, teamConfirmationCode(later))).toMatchObject({ ok: false, error: { code: "code_mismatch" } })
    // The genuine founding list is accepted, and the server then follows the chain.
    const pinned = trustFoundingRoster(relay.rosters[0], teamConfirmationCode(later))
    expect(pinned.ok).toBe(true)
  })

  test("codes for a key and for a team list never coincide by construction", async () => {
    const codes = new Set<string>()
    for (let index = 0; index < 200; index += 1) codes.add(serverConfirmationCode(generateServerKeyPair().publicKey))
    expect(codes.size).toBe(200)
  })
})
