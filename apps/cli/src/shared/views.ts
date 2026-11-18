/**
 * What Home and the app screen show about apps, deploys and secrets, read
 * from this machine's profile folder. Nothing there reaches a server.
 *
 * The folder is ordinary files that something other than zekno could have
 * changed (attacker B in specs/003-cli-runner/security-review.md), so
 * nothing is taken as it stands. A deploy of either kind counts only when it
 * is signed by a current team member for this team, server and app, exactly
 * as ops/deploy.ts reads the history for a rollback, and its number, time,
 * signer, service definition and secrets are read from under that
 * signature. Only whether the runner accepted it is the file's word. A
 * secret counts only when its record verifies. A file name counts only when
 * it is an app name. Text that is drawn is cleaned.
 */
import {
  currentSecrets,
  verifySecret,
  verifySecretRemoval,
  type TeamTrust,
} from "@workspace/core"
import { readdirSync } from "node:fs"
import { join } from "node:path"

import { aliasesTooMany, COMPOSE_READ_BYTES } from "../project/compose-file"
import type { Team } from "../cli/context"
import type { History, ProfileStore, Server } from "../profile/profile"
import { sanitize } from "../server/sanitize"
import { readDeployEntry, type HistoryDeploy } from "./history"

/** Whether an app's services are running, as the runner last said (data-model.md). */
export type RunState = "running" | "stopped" | "partly running" | "unknown"

/**
 * One app on Home. The deploy number, time, result, signer and secret count
 * are those of the latest deploy in this machine's history that verifies
 * (`appsOf`), so they are known even when the server cannot be reached.
 */
export type AppRow = {
  name: string
  deploy?: number
  at?: string
  state: RunState
  outcome?: DeployRow["outcome"]
  /** Who signed the latest deploy. */
  signer?: string
  /** How many secrets the latest deploy carried. */
  secrets?: number
  /** The deploy `r` returns to on Home: the accepted one before the latest. */
  previous?: number
  /**
   * The last deploy its runner accepted, as the runner last said. Undefined
   * until the server answers, and once it cannot be reached: then `deploy`,
   * from this machine's history, is shown instead.
   */
  accepted?: number
}

/** One deploy in an app's history. Everything but `outcome` is read from under the deploy's signature. */
export type DeployRow = {
  sequence: number
  outcome: "sent" | "started" | "start_failed"
  at: string
  signer?: string
  /** The version of the team list it was signed with. */
  teamVersion?: number
  /** Each service of its Compose file, as `web (caddy:2)`. */
  services?: string[]
  secrets?: { name: string; version: number }[]
  /** It ran the same service definition as this earlier deploy, and not the one just before it. */
  rollbackTo?: number
}
export type SecretRow = {
  name: string
  version: number
  removed: boolean
  /** Set or removed after the latest deploy the runner accepted: it takes effect on the next deploy. */
  afterDeploy?: boolean
}

/** A history file's name: an app name and `.json`. Anything else in the folder is not an app. */
const HISTORY_FILE = /^([a-z0-9][a-z0-9-]{0,62})\.json$/

type Verified = {
  deploy: HistoryDeploy
  signer: string
  outcome: History[number]["outcome"]
}

/**
 * The deploys this machine sent for one app on one server that verify,
 * oldest first, one per number, of either kind (`readDeployEntry`). A history
 * file that cannot be read shows no deploys here; the deploy and rollback
 * operations say what is wrong with it. Only the profile's files and the team
 * list are needed, never the keychain.
 */
export function verifiedDeploys(
  team: Pick<Team, "store" | "trust">,
  server: Server,
  app: string
): Verified[] {
  let history: History
  try {
    history = team.store.history(server.serverId, app)
  } catch {
    return []
  }
  const byNumber = new Map<number, Verified>()
  for (const entry of history) {
    const read = readDeployEntry(entry.envelope, team.trust)
    if (!read) continue
    const { deploy, signer } = read
    if (
      deploy.teamId !== team.trust.teamId ||
      deploy.serverId !== server.serverId ||
      deploy.app !== app
    )
      continue
    // The same number twice is not something zekno writes. The later entry is the one it would have written last.
    byNumber.set(deploy.sequence, {
      deploy,
      signer: sanitize(signer.name),
      outcome: entry.outcome,
    })
  }
  return [...byNumber.values()].sort(
    (a, b) => a.deploy.sequence - b.deploy.sequence
  )
}

const accepted = (entries: readonly Verified[]) =>
  entries.filter((entry) => entry.outcome !== "sent")

/**
 * The apps this machine has a history for on one server, by the name of each
 * history file. Nothing is verified: it only chooses which of a runner's
 * answers to keep, for the apps Home may show.
 */
export function appNames(home: string, server: Server): string[] {
  let files: string[]
  try {
    files = readdirSync(join(home, "history", server.serverId))
  } catch {
    return []
  }
  return files.flatMap((file) => HISTORY_FILE.exec(file)?.slice(1, 2) ?? [])
}

/**
 * Home's order of apps, which `zekno status` keeps too: the one this machine
 * deployed most recently first, then by name; one with no deploy time last.
 */
export const latestFirst = (
  a: { name: string; at?: string },
  b: { name: string; at?: string }
): number =>
  (b.at ?? "").localeCompare(a.at ?? "") || a.name.localeCompare(b.name)

/**
 * One server's apps for Home, the most recently deployed first. An app with
 * no deploy that verifies is not listed. The state is "unknown": what is
 * running is read from the server, which this does not do.
 */
export function appsOf(team: Team, server: Server, home: string): AppRow[] {
  const rows: AppRow[] = []
  for (const app of appNames(home, server)) {
    const entries = verifiedDeploys(team, server, app)
    const latest = entries.at(-1)
    if (!latest) continue
    rows.push({
      name: app,
      deploy: latest.deploy.sequence,
      at: latest.deploy.createdAt,
      state: "unknown",
      outcome: latest.outcome,
      signer: latest.signer,
      secrets: latest.deploy.secrets.length,
      previous: accepted(entries).at(-2)?.deploy.sequence,
    })
  }
  return rows.sort(latestFirst)
}

/**
 * Each service of a Compose file as `web (caddy:2)`, or as `web` when it is
 * built rather than pulled. Empty when the file is not a Compose file this
 * can read: it is only shown, never acted on. It is read for every deploy of
 * an app each time the app screen opens or is read again, so a file with more
 * aliases than any Compose file needs is not parsed at all (compose-file.ts
 * `aliasesTooMany`): Bun's parser copies what each alias stands for. Text in
 * the form zekno writes from settings holds none, whatever its values hold.
 */
export function composeServices(compose: string): string[] {
  if (compose.length > COMPOSE_READ_BYTES || aliasesTooMany(compose)) return []
  let parsed: unknown
  try {
    parsed = Bun.YAML.parse(compose)
  } catch {
    return []
  }
  const services = (parsed as { services?: unknown } | null)?.services
  if (
    typeof services !== "object" ||
    services === null ||
    Array.isArray(services)
  )
    return []
  return Object.entries(services).map(([name, service]) => {
    const image = (service as { image?: unknown } | null)?.image
    return sanitize(typeof image === "string" ? `${name} (${image})` : name)
  })
}

/** The version of the team list a deploy was signed with, when this machine holds that list. */
function teamVersionOf(team: Team, hash: string): number | undefined {
  const index = team.chain.findIndex((trust) => trust.hash === hash)
  return index === -1 ? undefined : index + 1
}

/** One deploy for the app screen. */
function deployRow(
  team: Team,
  entries: readonly Verified[],
  index: number
): DeployRow {
  const { deploy, signer, outcome } = entries[index]!
  // A rollback deploys an earlier deploy's service definition again. A
  // definition equal to the one just before is a deploy of the same thing.
  const before = entries[index - 1]
  const earlier =
    before && before.deploy.compose !== deploy.compose
      ? accepted(entries.slice(0, index - 1))
          .filter((entry) => entry.deploy.compose === deploy.compose)
          .at(-1)
      : undefined
  return {
    sequence: deploy.sequence,
    outcome,
    at: deploy.createdAt,
    signer,
    teamVersion: teamVersionOf(team, deploy.teamHash),
    services: composeServices(deploy.compose),
    secrets: deploy.secrets.map(({ name, version }) => ({ name, version })),
    rollbackTo: earlier?.deploy.sequence,
  }
}

/**
 * The secrets an app has now, by name, and those removed, after them. A
 * value is never read: records are verified, not opened. Each is marked when
 * it changed after the latest deploy the runner accepted.
 */
function secretRows(
  team: Team,
  server: Server,
  app: string,
  latest: HistoryDeploy | undefined
): SecretRow[] {
  const { trust } = team
  const serverId = server.serverId
  let current
  try {
    current = currentSecrets({
      trust,
      serverId,
      app,
      ...team.store.secrets(serverId, app),
    })
  } catch {
    return []
  }
  const deployed = (name: string) =>
    latest?.secrets.find((secret) => secret.name === name)
  const rows: SecretRow[] = []
  for (const record of current.secrets) {
    const checked = verifySecret({ record, trust, serverId, app })
    if (!checked.ok) continue
    const { name, version } = checked.value
    const before = deployed(name)
    rows.push({
      name,
      version,
      removed: false,
      afterDeploy:
        latest !== undefined &&
        (before === undefined || before.version < version),
    })
  }
  for (const removal of current.removals) {
    const checked = verifySecretRemoval({ removal, trust, serverId, app })
    if (!checked.ok) continue
    const { name, version } = checked.value
    rows.push({
      name,
      version,
      removed: true,
      afterDeploy: latest !== undefined && deployed(name) !== undefined,
    })
  }
  return rows
}

/** An app's deploy history, newest first, and its secrets. */
export function appDetails(
  team: Team,
  server: Server,
  app: string
): { deploys: DeployRow[]; secrets: SecretRow[] } {
  const entries = verifiedDeploys(team, server, app)
  const deploys = entries
    .map((_, index) => deployRow(team, entries, index))
    .reverse()
  return {
    deploys,
    secrets: secretRows(team, server, app, accepted(entries).at(-1)?.deploy),
  }
}

/** The names of the secrets the next deploy of an app carries. */
export function secretNamesOf(
  team: Team,
  server: Server,
  app: string
): string[] {
  return secretRows(team, server, app, undefined)
    .filter((secret) => !secret.removed)
    .map((secret) => secret.name)
}

/**
 * The Compose text of the latest deploy of an app this machine sent that its
 * runner answered (`outcome` not `sent`) and that verifies against the team
 * list given, read from under its signature (specs/010-app-settings,
 * research R4). Undefined with none, or a history that cannot be read.
 * Needs no keychain: the store and the team list only.
 */
export function lastDeployedCompose(
  store: ProfileStore,
  trust: TeamTrust,
  server: Server,
  app: string
): string | undefined {
  return accepted(verifiedDeploys({ store, trust }, server, app)).at(-1)?.deploy
    .compose
}

/** The latest deploy of an app the runner accepted, from this machine's history. */
export function latestAccepted(
  team: Team,
  server: Server,
  app: string
): number | undefined {
  return accepted(verifiedDeploys(team, server, app)).at(-1)?.deploy.sequence
}
