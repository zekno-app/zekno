/**
 * `zekno doctor`'s lines of each server (contracts/doctor.md, research R11
 * and R12): over SSH, the fixed read-only `CHECK_SCRIPT` and then a session
 * with the runner; on this machine, the session alone. Split from
 * ops/doctor.ts with no change of behaviour (specs/016-build-from-source,
 * contracts/cli.md CL14): what doctor.ts says of every check holds here.
 */
import type { RunnerVersion } from "@workspace/core"

import { reach, type OpDeps, type Team } from "../cli/context"
import type { Server } from "../profile/profile"
import { batchOnly, wouldHaveAsked } from "../server/batch"
import { runCheck, type CheckRead } from "../server/check-script"
import { sanitize } from "../server/sanitize"
import { openSession, type Session } from "../server/session"
import type { CheckLine } from "./doctor"
import { proxyLine } from "./doctor-proxy"
import {
  answerInApp,
  checkDestination,
  checkSpace,
  checkWith,
  composeDetail,
  freeForUpdate,
  freeSpace,
  freeText,
  good,
  installDocker,
  LABELS,
  LOG_IN_WITH_HOME,
  MATCH_ZEKNO,
  NEEDS_ANSWER,
  NO_ANSWER,
  NO_COMPOSE,
  NO_HOME,
  NOT_EXPECTED,
  notChecked,
  noVersionReported,
  ON_THIS_MACHINE,
  otherServer,
  OVER_SSH,
  problem,
  PUT_RUNNER_BACK,
  quietLogin,
  replaceRunner,
  runnerMissing,
  runnerNewer,
  runnerNewerProtocol,
  runnerOlder,
  seeWhyHere,
  sessionSentence,
  SPACE_UNKNOWN,
  UNREACHABLE,
  updateRunner,
  updateZekno,
  warning,
} from "./doctor-words"
import { runnerRelation } from "./server"
import { askStatus, checkIdentity } from "./status"

/** Free space, in KiB, below which a warning and a problem are said: 1 GiB, and the 256 MiB the installer needs. */
const SPACE_WARNING_KIB = 1_048_576
const SPACE_PROBLEM_KIB = 262_144

/** The Runner line from a runner that answered as the server that was connected: how its version stands to this zekno's. */
function relationLine(
  server: string,
  mode: Session["mode"],
  runner: RunnerVersion | undefined,
  carried: string
): CheckLine {
  const { relation, newerProtocol } = runnerRelation(mode, runner, carried)
  const found = runner === undefined ? undefined : sanitize(runner.version)
  if (relation === "same" && found !== undefined) return good("runner", found)
  if (relation === "newer" && found !== undefined) {
    return newerProtocol
      ? problem(
          "runner",
          runnerNewerProtocol(found, carried),
          updateZekno(server)
        )
      : warning("runner", runnerNewer(found, carried), MATCH_ZEKNO)
  }
  if (found === undefined)
    return warning("runner", noVersionReported(carried), updateRunner(server))
  return warning("runner", runnerOlder(found, carried), updateRunner(server))
}

/**
 * Asks a runner `version` (every session's first request) and `status`, in
 * SSH's batch mode, within the limit, and closes the session: the Runner
 * line. `local`: a runner on this machine, never compared with this zekno.
 */
async function runnerCheck(
  deps: OpDeps,
  team: Team,
  server: Server,
  carried: string,
  limitMs: number
): Promise<{ line: CheckLine; opened: boolean; proxy?: CheckLine }> {
  const local = server.target.kind === "local"
  const where =
    server.target.kind === "ssh" ? server.target.destination : ON_THIS_MACHINE
  // What SSH writes is kept here and never shown: batch mode never asks, so there is nothing for the person to answer.
  const lines: string[] = []
  const signal = AbortSignal.timeout(limitMs)
  let session: Session | undefined
  try {
    session = await openSession(
      reach(
        { ...deps, connect: batchOnly(deps.connect, lines) },
        server.target
      ),
      { signal }
    )
    // With the routes in force, from a runner of protocol 4: the Proxy line (specs/015-domains-https, CL6; doctor-proxy.ts).
    const { status, held } = await askStatus(session, true)
    try {
      checkIdentity(team, server, status)
    } catch {
      return {
        line: problem(
          "runner",
          otherServer(server.name),
          local ? seeWhyHere(server.name) : checkDestination(where, server.name)
        ),
        opened: true,
      }
    }
    if (local)
      return {
        line: good(
          "runner",
          `${session.runner === undefined ? "no version reported" : sanitize(session.runner.version)}, ${ON_THIS_MACHINE}`
        ),
        opened: true,
        proxy: proxyLine(held),
      }
    return {
      line: relationLine(server.name, session.mode, session.runner, carried),
      opened: true,
      proxy: proxyLine(held),
    }
  } catch (error) {
    const detail = signal.aborted ? NO_ANSWER : sessionSentence(error)
    return {
      line: problem(
        "runner",
        detail,
        local ? seeWhyHere(server.name) : replaceRunner(server.name)
      ),
      opened: session !== undefined,
    }
  } finally {
    await session?.close().catch(() => undefined)
  }
}

/** The Disk line from the script's `space` line. */
function diskLine(
  server: string,
  destination: string,
  space: CheckRead["space"]
): CheckLine {
  if (space === undefined) return notChecked("disk")
  if (space === "unknown")
    return warning("disk", SPACE_UNKNOWN, checkSpace(destination))
  const detail = `${freeText(space)} free`
  if (space >= SPACE_WARNING_KIB) return good("disk", detail)
  return space < SPACE_PROBLEM_KIB
    ? problem("disk", detail, freeForUpdate(server))
    : warning("disk", detail, freeSpace(server))
}

/** The lines of a runner on this machine: reached by its local runner, as every command reaches it; no script, so Docker and Disk are not checked. */
export async function localChecks(
  deps: OpDeps,
  team: Team,
  server: Server,
  carried: string,
  limitMs: number
): Promise<CheckLine[]> {
  const runner = await runnerCheck(deps, team, server, carried, limitMs)
  if (!runner.opened) {
    // Nothing answered: the Reachable line says why, and the rest is not checked.
    return [
      { ...runner.line, check: "reachable", label: LABELS.reachable },
      notChecked("docker"),
      notChecked("runner"),
      notChecked("disk"),
    ]
  }
  return [
    good("reachable", ON_THIS_MACHINE),
    notChecked("docker"),
    runner.line,
    ...(runner.proxy === undefined ? [] : [runner.proxy]),
    notChecked("disk"),
  ]
}

/** A server reached over SSH. */
export type SshServer = Server & {
  target: Extract<Server["target"], { kind: "ssh" }>
}

/** The lines of a server over SSH: `CHECK_SCRIPT` first, then, when a runner is at its path, a session. */
export async function sshChecks(
  deps: OpDeps,
  team: Team,
  server: SshServer,
  carried: string,
  limitMs: number
): Promise<CheckLine[]> {
  const { destination, runnerPath } = server.target
  const rest = [notChecked("docker"), notChecked("runner"), notChecked("disk")]
  const lines: string[] = []
  const signal = AbortSignal.timeout(limitMs)
  let read: CheckRead
  try {
    read = await runCheck(
      reach(
        { ...deps, connect: batchOnly(deps.connect, lines) },
        server.target
      ),
      runnerPath,
      signal
    )
  } catch (error) {
    return [
      problem(
        "reachable",
        signal.aborted ? NO_ANSWER : sessionSentence(error),
        checkWith(destination)
      ),
      ...rest,
    ]
  }
  if (signal.aborted)
    return [problem("reachable", NO_ANSWER, checkWith(destination)), ...rest]
  if (!read.reached && !read.unread && read.exitCode === 255) {
    // SSH ended with its own status before the script started: it would have asked, or it could not connect.
    const reachable = wouldHaveAsked(lines)
      ? problem("reachable", NEEDS_ANSWER, answerInApp(server.name))
      : problem("reachable", UNREACHABLE, checkWith(destination))
    return [reachable, ...rest]
  }
  if (!read.reached || read.unread)
    return [
      problem("reachable", NOT_EXPECTED, quietLogin(server.name)),
      ...rest,
    ]

  const docker =
    read.docker === undefined
      ? notChecked("docker")
      : read.docker === "none"
        ? problem("docker", NO_COMPOSE, installDocker(server.name))
        : good("docker", composeDetail(read.docker.version))
  if (read.home === false) {
    return [
      good("reachable", OVER_SSH),
      docker,
      problem("runner", NO_HOME, LOG_IN_WITH_HOME),
      problem("disk", NO_HOME, LOG_IN_WITH_HOME),
    ]
  }
  const runner =
    read.runner === "none"
      ? { line: problem("runner", runnerMissing(runnerPath), PUT_RUNNER_BACK) }
      : await runnerCheck(deps, team, server, carried, limitMs)
  return [
    good("reachable", OVER_SSH),
    docker,
    runner.line,
    ...("proxy" in runner && runner.proxy ? [runner.proxy] : []),
    diskLine(server.name, destination, read.space),
  ]
}
