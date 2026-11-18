/**
 * A second member, for the tests of a secret set by someone no longer in the
 * team (specs/014-deploy-v2, User Story 3; tasks T043). From a machine made
 * by `ready()`: Ada, the admin, adds Bea as a deployer; Bea sets secrets for
 * an app, which the test puts in this machine's store or has a deploy carry
 * to the runner; then Ada takes Bea out of the team list, and the runner
 * hears of it or not, as the test chooses.
 *
 * The CLI has no command for a second member yet, so each team list is
 * signed here with Ada's key from the machine's key store and saved to the
 * profile's `rosters` as `addServer` saves one (`team.store.save`). Bea's key
 * lives only in this process.
 */
import {
  createSecret,
  createSecretRemoval,
  createSigner,
  generateMemberKeyPair,
  keyIdOf,
  proposeRoster,
  RunnerReportSchema,
  type Member,
  type SecretRecord,
} from "@workspace/core"

import { openTeam, reach } from "../../src/cli/context"
import { withSession } from "../../src/server/session"
import type { machine } from "./helpers"

type Machine = ReturnType<typeof machine>

/** Sends the profile's team lists to the machine's first server, as `zekno server add` does after it signs one. */
export async function syncRunner(m: Machine): Promise<void> {
  const team = await openTeam(m.deps)
  const server = team.profile.servers[0]!
  await withSession(reach(m.deps, server.target), (session) =>
    session.request("sync", RunnerReportSchema, {
      input: { rosters: team.profile.rosters },
    })
  )
}

/** Adds Bea to the team list of `m`'s team, as a deployer, and gives what she can sign. */
export async function teamOfTwo(m: Machine) {
  const before = await openTeam(m.deps)
  const server = before.profile.servers[0]!
  const signer = createSigner(generateMemberKeyPair().secretKey)
  const bea: Member = {
    name: "Bea",
    publicKey: signer.publicKey,
    role: "deployer",
  }
  const added = await before.withSigner((admin) =>
    proposeRoster({
      trust: before.trust,
      members: [...before.trust.members, bea],
      signer: admin,
    })
  )
  before.store.save({
    ...before.profile,
    rosters: [...before.profile.rosters, added.envelope],
  })
  const trust = added.trust
  const serverId = server.serverId

  return {
    server,
    /** Bea's key id, as a statement she signed carries it. */
    keyId: keyIdOf(signer.publicKey),
    /** A secret of `app` Bea sets, signed against the team list that has her. */
    sets: (app: string, name: string, value: string, version: number) =>
      createSecret({ trust, serverId, app, name, value, version, signer }),
    /** The removal of a secret of `app`, signed by Bea. */
    removes: (app: string, name: string, version: number) =>
      createSecretRemoval({ trust, serverId, app, name, version, signer }),
    /** Puts records in this machine's store for `app`, beside what is there, as a `secret set` here would keep them. */
    keep(app: string, ...records: SecretRecord[]): void {
      const store = before.store.secrets(serverId, app)
      before.store.saveSecrets(serverId, app, {
        ...store,
        records: [...store.records, ...records],
      })
    },
    /** Takes records out of this machine's store for `app`, as a machine that never had them. */
    forget(app: string, ...records: SecretRecord[]): void {
      const store = before.store.secrets(serverId, app)
      const gone = new Set(
        records.map((record) => record.envelope.signature.sig)
      )
      before.store.saveSecrets(serverId, app, {
        ...store,
        records: store.records.filter(
          (record) => !gone.has(record.envelope.signature.sig)
        ),
      })
    },
    /**
     * Ada takes Bea out of the team list, saved to the profile. With `sync`,
     * the runner is sent the new list at once; without, it hears of it with
     * the next deploy, which carries every team list.
     */
    async remove(options: { sync: boolean }): Promise<void> {
      const team = await openTeam(m.deps)
      const next = await team.withSigner((admin) =>
        proposeRoster({
          trust: team.trust,
          members: team.trust.members.filter(
            (member) => member.publicKey !== signer.publicKey
          ),
          signer: admin,
        })
      )
      team.store.save({
        ...team.profile,
        rosters: [...team.profile.rosters, next.envelope],
      })
      if (options.sync) await syncRunner(m)
    },
  }
}
