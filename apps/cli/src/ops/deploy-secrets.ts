/**
 * What a deploy of one app lists, what it supplies, and which secret stops
 * it, for this machine (specs/014-deploy-v2, contracts/cli.md CL12 to CL17
 * and CL16b; research R7, R8). The core library's `secretsForDeploy` works
 * it out from this machine's store, the statements the runner holds and the
 * live names its `status` reports; C5b is worked out here, from that result
 * and this machine's own items, so the core function stays as it is.
 *
 * Versions and hashes come only from items that verify against the team list
 * held now (FR-021): what `status` says, and what an item that does not
 * verify claims, can only stop a deploy.
 */
import {
  keyIdOf,
  peekSecretStatement,
  secretsForDeploy,
  verifySecret,
  verifySecretRemoval,
  verifySecretStatement,
  type Envelope,
  type RunnerStatus,
  type SecretRecord,
} from "@workspace/core"

import type { Team } from "../cli/context"
import { CliError } from "../cli/errors"
import type { SecretStore, Server } from "../profile/profile"
import { blockedLines, type BlockedName } from "../shared/deploy-words"

/** What a deploy lists and supplies. `names`: the listed secrets' names, in the order listed. */
export type Listing = {
  statements: Envelope[]
  removals: Envelope[]
  supply: SecretRecord[]
  names: string[]
}

/**
 * The key ids of former members: members of an earlier team list of this
 * machine's verified chain that the current list lacks (CL15). A member
 * taken out and added again is not one.
 */
export function formerKeyIds(team: Pick<Team, "trust" | "chain">): string[] {
  const now = new Set(team.trust.members.map((member) => member.publicKey))
  const former = new Set<string>()
  for (const list of team.chain)
    for (const member of list.members)
      if (!now.has(member.publicKey)) former.add(keyIdOf(member.publicKey))
  return [...former].sort()
}

/** The names `status` reports live for the app, with their versions: its `<app>/<NAME>` entries not removed (research R31). */
function liveOf(
  status: RunnerStatus,
  app: string
): { name: string; version: number }[] {
  const prefix = `${app}/`
  return Object.entries(status.secrets).flatMap(([key, entry]) =>
    key.startsWith(prefix) && !entry.removed
      ? [{ name: key.slice(prefix.length), version: entry.version }]
      : []
  )
}

/** Whether two envelopes are the same signed bytes. */
const same = (a: Envelope, b: Envelope): boolean =>
  a.payloadType === b.payloadType &&
  a.payload === b.payload &&
  a.signature.keyId === b.signature.keyId &&
  a.signature.sig === b.signature.sig

/**
 * CL16b, C5b: the names whose listed statement is the runner's (not one of
 * this machine's records), while this machine's newest verified item of the
 * name is a record of a lower version and another hash: another machine set
 * it since, and the deploy would quietly replace this machine's value with
 * the server's. A removal here, no item here, or the listed statement being
 * this machine's own never trips it.
 */
function newerOnServer(
  where: { trust: Team["trust"]; serverId: string; app: string },
  store: SecretStore,
  statements: readonly Envelope[]
): string[] {
  const { trust, serverId, app } = where
  /** This machine's verified items, by name: the newest version, and each item at it. */
  const newest = new Map<
    string,
    { version: number; items: ({ hash: string } | { removal: true })[] }
  >()
  const seen = (
    name: string,
    version: number,
    item: { hash: string } | { removal: true }
  ) => {
    const known = newest.get(name)
    if (!known || version > known.version)
      newest.set(name, { version, items: [item] })
    else if (version === known.version) known.items.push(item)
  }
  for (const record of store.records) {
    const checked = verifySecret({ record, trust, serverId, app })
    if (checked.ok)
      seen(checked.value.name, checked.value.version, {
        hash: checked.value.hash,
      })
  }
  for (const removal of store.removals) {
    const checked = verifySecretRemoval({ removal, trust, serverId, app })
    if (checked.ok)
      seen(checked.value.name, checked.value.version, { removal: true })
  }

  const names: string[] = []
  for (const envelope of statements) {
    if (store.records.some((record) => same(record.envelope, envelope)))
      continue
    const listed = verifySecretStatement({ envelope, trust, serverId, app })
    if (!listed.ok) continue
    const here = newest.get(listed.value.name)
    if (
      here !== undefined &&
      here.version < listed.value.version &&
      here.items.every(
        (item) => "hash" in item && item.hash !== listed.value.hash
      )
    )
      names.push(listed.value.name)
  }
  return names
}

/**
 * Lists what a deploy of `app` carries, in `format` (CL4): this machine's
 * records and removals, and for version 2 the runner's statements (`held`,
 * `[]` for version 1). Each item left out that blocks nothing is said
 * through `warning` with today's sentence. A blocked name stops the deploy
 * before anything is signed, with C4, C5 or C5b, one line per name.
 */
export function listForDeploy(input: {
  team: Pick<Team, "trust" | "chain" | "store">
  server: Server
  app: string
  status: RunnerStatus
  held: readonly Envelope[]
  format: 1 | 2
  warning?: (text: string) => void
}): Listing {
  const { team, server, app, format } = input
  const where = { trust: team.trust, serverId: server.serverId, app }
  const store = team.store.secrets(server.serverId, app)
  const listed = secretsForDeploy({
    ...where,
    records: store.records,
    removals: store.removals,
    held: input.held,
    live: liveOf(input.status, app),
    former: formerKeyIds(team),
    format,
  })
  for (const ignored of listed.ignored) {
    input.warning?.(
      `Left out a ${ignored.kind}${ignored.name ? ` for ${ignored.name}` : ""}: ${ignored.reason}.`
    )
  }
  const blocked: BlockedName[] = listed.blocked.map(({ name, why }) => ({
    name,
    why,
  }))
  if (format === 2)
    for (const name of newerOnServer(where, store, listed.statements))
      blocked.push({ name, why: "newer_on_server" })
  if (blocked.length > 0)
    throw new CliError(blockedLines(blocked, { app, server: server.name }))
  return {
    statements: listed.statements,
    removals: listed.removals,
    supply: listed.supply,
    // Each listed statement verified, so it reads.
    names: listed.statements.map(
      (envelope) => peekSecretStatement(envelope)!.name
    ),
  }
}
