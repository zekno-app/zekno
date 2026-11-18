/**
 * Signing a deploy and handing it to the runner, in the format chosen for
 * that runner (specs/014-deploy-v2, contracts/cli.md CL4 to CL11). Version 2
 * is made after the runner's number for the app, read on the deploy's own
 * connection, so a deploy that was overtaken can never run, and a refusal
 * uses no number. Version 1 is signed as before this feature, for a runner
 * that does not carry out version 2. `sendDeploy` (deploy.ts) opens the
 * session, chooses the format and reads `status` first.
 */
import {
  CoreError,
  createDeploy,
  createDeployV2,
  peekSecretStatement,
  RunnerRecordsSchema,
  RunnerReportSchema,
  SECRET_NAME,
  type Envelope,
  type RunnerReport,
  type RunnerStatus,
  type Signer,
} from "@workspace/core"

import { CliError, explainDeploy, RunnerRefused } from "../cli/errors"
import {
  HELD_PAYLOAD_LENGTH,
  type Held,
  type History,
} from "../profile/profile"
import type { Session } from "../server/session"
import type { DeployInfo } from "../shared/deploy"
import { C6 } from "../shared/deploy-words"
import { sameEnvelope } from "../shared/history"
import type { DeployCallbacks, DeployPlan, DeployResult } from "./deploy"
import { deployAnswer } from "./deploy-answer"
import { listForDeploy, type Listing } from "./deploy-secrets"

/**
 * What a deploy of either format starts from, once the session is open and
 * the runner's `status` was read and checked: `accepted` is the runner's
 * number for the app (0 when it holds none), `history` this machine's history
 * of the app as read then.
 */
export type Going = {
  session: Session
  plan: DeployPlan
  status: RunnerStatus
  accepted: number
  history: History
  callbacks: DeployCallbacks
}

/**
 * How far a runner's last deploy number may be ahead of the highest one this
 * machine signed, on version 1. A runner far beyond that is not one this
 * machine has been deploying to, and its word is not a reason to sign a far
 * higher number. Version 2 has no such bound: it is made after the runner's
 * number, and a runner that lied about it refuses the deploy (FR-010).
 */
const MAX_AHEAD = 1000

/** Signs with the member's key. A refusal of the core library is said as one sentence (CL7). */
function sign<T>(
  plan: DeployPlan,
  work: (signer: Signer) => Promise<T>
): Promise<T> {
  return plan.team.withSigner(work).catch((error: unknown) => {
    if (error instanceof CoreError)
      throw new CliError(`The deploy could not be signed (${error.code}).`)
    throw error
  })
}

/**
 * CL8: the history with this deploy's entry `sent`, saved before it leaves:
 * once signed, it may run, whatever comes back. Gives the entry's time.
 */
function recordSent(going: Going, envelope: Envelope): string {
  const { team, server, app } = going.plan
  const at = new Date().toISOString()
  team.store.saveHistory(server.serverId, app, [
    ...going.history,
    { envelope, at, outcome: "sent" },
  ])
  return at
}

/**
 * The history with a version-2 deploy's answer in place of its `sent` entry,
 * as the history is on disk now: another terminal may have written since,
 * and a refused deploy of that terminal has taken its own entry out
 * (deploy-answer.ts), which the copy read before signing still holds. A
 * history that cannot be read again is the copy with the answer added, as
 * version 1 records it.
 */
function answered(going: Going, entry: History[number]): History {
  const { team, server, app } = going.plan
  let now: History
  try {
    now = team.store.history(server.serverId, app)
  } catch {
    return [...going.history, entry]
  }
  const index = now.findIndex((kept) =>
    sameEnvelope(kept.envelope, entry.envelope)
  )
  if (index === -1) return [...now, entry]
  return now.map((kept, at) => (at === index ? entry : kept))
}

/**
 * CL9 to CL11: hands the signed deploy to the runner as `command`, says each
 * stage, and reads the answer through `wait`, which says what a refusal
 * means for the format. Only an answer for this app and this number counts;
 * it is recorded in the history in place of the `sent` entry.
 */
async function deliver(
  going: Going,
  info: DeployInfo,
  sending: {
    command: "apply" | "deploy"
    input: unknown
    envelope: Envelope
    at: string
    wait: (answer: Promise<RunnerReport>) => Promise<RunnerReport>
  }
): Promise<DeployResult> {
  const { session, plan, callbacks } = going
  let starting = false
  const start = () => {
    if (starting) return
    starting = true
    callbacks.stage?.("starting", info)
  }
  const answer = session.request(sending.command, RunnerReportSchema, {
    input: sending.input,
    onEvent: (event) => {
      if (event.event !== "progress") return
      start()
      return callbacks.progress?.(event.line)
    },
  })
  callbacks.stage?.("sent", info)
  const report = await sending.wait(answer)

  const outcome = report.outcome
  if (
    (outcome !== "started" && outcome !== "start_failed") ||
    report.app !== plan.app ||
    report.sequence !== info.sequence
  ) {
    throw new CliError(
      "The runner did not answer as expected, so it is not known whether the deploy was accepted."
    )
  }
  start()
  const entry = { envelope: sending.envelope, at: sending.at, outcome }
  plan.team.store.saveHistory(
    plan.server.serverId,
    plan.app,
    info.format === 2 ? answered(going, entry) : [...going.history, entry]
  )
  callbacks.stage?.(outcome === "started" ? "started" : "failed", info)
  return { ...info, outcome, report, mode: session.mode }
}

/**
 * CL3b: what the server said it holds for the app, as this deploy read it on
 * its own connection: the statements of its `records` answer that read as
 * statements, each within `HELD_PAYLOAD_LENGTH`, and the app's entries of its
 * `status` answer. Kept so that `zekno secret set` and `zekno secret rm` can
 * take their version above it offline (research R9); never a value, and never
 * read as what a deploy lists.
 */
function heldOf(going: Going, statements: readonly Envelope[]): Held {
  const prefix = `${going.plan.app}/`
  return {
    statements: statements.filter(
      (envelope) =>
        envelope.payload.length <= HELD_PAYLOAD_LENGTH &&
        peekSecretStatement(envelope) !== undefined
    ),
    versions: Object.entries(going.status.secrets).flatMap(([key, entry]) => {
      const name = key.slice(prefix.length)
      return key.startsWith(prefix) && SECRET_NAME.test(name)
        ? [{ name, version: entry.version, removed: entry.removed }]
        : []
    }),
  }
}

/**
 * CL4: what the deploy lists and supplies, from this machine's store and, on
 * version 2, the statements the runner holds (`held`). A secret this machine
 * cannot account for stops the deploy here, before anything is signed (C4,
 * C5, C5b); an item that blocks nothing is said with today's warning.
 */
const listing = (going: Going, format: 1 | 2, held: readonly Envelope[]) =>
  listForDeploy({
    team: going.plan.team,
    server: going.plan.server,
    app: going.plan.app,
    status: going.status,
    held,
    format,
    warning: going.callbacks.warning,
  })

/** The stage info of a deploy numbered `sequence` that lists `listed`. */
const infoOf = (
  going: Going,
  sequence: number,
  listed: Listing,
  format: 1 | 2
): DeployInfo => ({
  app: going.plan.app,
  server: going.plan.server.name,
  sequence,
  secrets: listed.statements.length,
  secretNames: listed.names,
  format,
})

/**
 * Version 1 (CL5, CL7 to CL11): one above both what the runner accepted and
 * what this machine signed (`signed`, entries of both kinds counted), so a
 * number is never signed twice whatever the runner says; sent with `apply`.
 * Against a runner older than the one this zekno carries it says C6 once
 * signed. A refusal says today's sentence, or R7 or R8, and the entry stays
 * `sent`.
 */
export async function deployVersionOne(
  going: Going & {
    signed: number
    /** Set when version 1 is signed because the runner, at this version, is older than the one this zekno carries (C6). */
    older?: { version: string }
    /** The runner version this zekno carries. */
    carried: string
  }
): Promise<DeployResult> {
  const { plan, accepted, signed, callbacks } = going
  const { team, server, app, compose } = plan
  if (accepted > signed + MAX_AHEAD) {
    throw new CliError(
      `${server.name} says it has accepted deploy ${accepted} of ${app}, far beyond the ${signed} this machine has signed. Nothing was signed.`
    )
  }
  const sequence = Math.max(accepted, signed) + 1
  // Version 1 reads no statement of the runner, and supplies every record it lists (CL14).
  const listed = listing(going, 1, [])
  const info = infoOf(going, sequence, listed, 1)
  callbacks.stage?.("checked", info)

  const deploy = await sign(plan, (signer) =>
    createDeploy({
      trust: team.trust,
      serverId: server.serverId,
      app,
      sequence,
      compose,
      secrets: listed.supply,
      removals: listed.removals,
      signer,
    })
  )
  const at = recordSent(going, deploy.envelope)
  callbacks.stage?.("signed", info)
  // CL8. Said once it is signed, before its answer: nothing is downgraded unsaid (research R16, R18).
  if (going.older !== undefined)
    callbacks.warning?.(C6(server.name, going.older.version, going.carried))

  return deliver(going, info, {
    command: "apply",
    input: { rosters: team.profile.rosters, deploy },
    envelope: deploy.envelope,
    at,
    wait: (answer) =>
      answer.catch((error: unknown) => {
        if (error instanceof RunnerRefused)
          throw new RunnerRefused(error.reason, explainDeploy(error.reason, 1))
        throw error
      }),
  })
}

/**
 * Version 2 (CL5 to CL11): made after the runner's number for the app
 * (`previous`), numbered one above it, with no expiry and no later field;
 * sent with `deploy` and the records the runner lacks. A refusal used no
 * number: the entry leaves the history, and `replayed` says C1, C2 or R1
 * (deploy-answer.ts).
 */
export async function deployVersionTwo(going: Going): Promise<DeployResult> {
  const { session, plan, accepted, callbacks } = going
  const { team, server, app, compose } = plan
  // CL3. What the server holds for the app: the statement of each record it keeps, never a value.
  const records = await session.request("records", RunnerRecordsSchema, {
    input: { app },
  })
  // CL3b. Kept before anything can stop the deploy: a deploy that stops with C4, C5 or C5b needs it most.
  team.store.saveHeld(server.serverId, app, heldOf(going, records.statements))
  const listed = listing(going, 2, records.statements)
  // CL5. Made after the runner's number, read on this connection; no bound (FR-010).
  const previous = accepted
  const sequence = previous + 1
  const info = infoOf(going, sequence, listed, 2)
  callbacks.stage?.("checked", info)

  const envelope = await sign(plan, (signer) =>
    createDeployV2({
      trust: team.trust,
      serverId: server.serverId,
      app,
      previous,
      compose,
      statements: listed.statements,
      removals: listed.removals,
      expiresAt: null,
      signer,
    })
  )
  const at = recordSent(going, envelope)
  callbacks.stage?.("signed", info)

  return deliver(going, info, {
    command: "deploy",
    input: {
      rosters: team.profile.rosters,
      envelope,
      records: listed.supply,
    },
    envelope,
    at,
    wait: (answer) =>
      deployAnswer(answer, {
        session,
        team,
        server,
        app,
        previous,
        envelope,
        rollback: plan.rollback === true,
      }),
  })
}
