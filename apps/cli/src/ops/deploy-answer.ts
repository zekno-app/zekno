/**
 * The answer to a version-2 deploy (specs/014-deploy-v2, contracts/cli.md
 * CL10 and "C1, C2 and R1 after `replayed`"; research R6, R30).
 *
 * On version 2 a refusal uses no number and nothing of the deploy ran, so
 * its entry leaves this machine's history: left `sent`, it would make C2 say
 * an answer never came when it did. The history is read again first, since
 * another terminal may have written it meanwhile. `replayed` means another
 * deploy of the app reached the runner after this one was made; the runner
 * is asked again on the same session which number it holds now, and the
 * person is told which deploy that was (C1), or that this machine cannot
 * tell which of two deploys with that number ran (C2). An answer that never
 * came leaves the entry `sent`, as today.
 */
import {
  RunnerStatusSchema,
  type Envelope,
  type RunnerReport,
} from "@workspace/core"

import type { Team } from "../cli/context"
import { CliError, explainDeploy, RunnerRefused } from "../cli/errors"
import type { History, Server } from "../profile/profile"
import type { Session } from "../server/session"
import { C1, C2 } from "../shared/deploy-words"
import { readDeployEntry, sameEnvelope } from "../shared/history"
import { checkIdentity } from "./status"

/** What a version-2 deploy's answer is read against. `previous`: the number it was made after; `rollback`: it was signed by `zekno rollback`. */
export type Answering = {
  session: Pick<Session, "request">
  team: Pick<Team, "store" | "trust">
  server: Server
  app: string
  previous: number
  envelope: Envelope
  rollback: boolean
}

/**
 * Takes the refused deploy's entry out of the history as it is on disk now,
 * keeping every entry another call wrote since, and gives what is left. A
 * history that cannot be read again is left as it is: the refusal is still
 * said, and nothing is counted from it.
 */
function forget(answering: Answering): History {
  const { team, server, app, envelope } = answering
  let history: History
  try {
    history = team.store.history(server.serverId, app)
  } catch {
    return []
  }
  const kept = history.filter(
    (entry) => !sameEnvelope(entry.envelope, envelope)
  )
  if (kept.length !== history.length)
    team.store.saveHistory(server.serverId, app, kept)
  return kept
}

/**
 * Whether the history holds a deploy of this app, for this team and server,
 * numbered `n` and never answered: one this machine signed, perhaps from
 * another terminal, of either kind (research R30).
 */
function unanswered(answering: Answering, history: History, n: number) {
  const { team, server, app } = answering
  return history.some((entry) => {
    if (entry.outcome !== "sent") return false
    const deploy = readDeployEntry(entry.envelope, team.trust)?.deploy
    return (
      deploy?.teamId === team.trust.teamId &&
      deploy.serverId === server.serverId &&
      deploy.app === app &&
      deploy.sequence === n
    )
  })
}

/**
 * What to say after `replayed`: C1 or C2 when the runner, read again, holds
 * a number of the app above the one this deploy was made after; R1 when that
 * read fails in any way, is another server's, or holds no such number.
 */
async function afterReplayed(
  answering: Answering,
  history: History
): Promise<CliError> {
  const { session, team, server, app, previous } = answering
  const R1 = new RunnerRefused("replayed", explainDeploy("replayed", 2))
  let n: number
  try {
    const status = await session.request("status", RunnerStatusSchema)
    checkIdentity(team, server, status)
    n = Object.hasOwn(status.lastSequence, app) ? status.lastSequence[app]! : 0
  } catch {
    return R1
  }
  if (n <= previous) return R1
  if (unanswered(answering, history, n))
    return new CliError(C2(app, server.name, n))
  return new CliError(C1(app, server.name, n, answering.rollback))
}

/**
 * Waits for the runner's answer to a version-2 deploy, `answer` being the
 * `deploy` request already handed to it. An answer is given back as it came,
 * for the caller to check and record. A refusal takes the deploy's entry out
 * of the history, then throws: C1, C2 or R1 for `replayed`, and the reason's
 * version-2 sentence for any other. Anything else is thrown as it came, and
 * the entry stays `sent`.
 */
export async function deployAnswer(
  answer: Promise<RunnerReport>,
  answering: Answering
): Promise<RunnerReport> {
  try {
    return await answer
  } catch (error) {
    if (!(error instanceof RunnerRefused)) throw error
    const history = forget(answering)
    if (error.reason === "replayed")
      throw await afterReplayed(answering, history)
    throw new RunnerRefused(error.reason, explainDeploy(error.reason, 2))
  }
}
