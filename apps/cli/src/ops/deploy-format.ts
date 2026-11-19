/**
 * Which message format a deploy is signed in (specs/014-deploy-v2,
 * contracts/cli.md, "The format"; research R4, R18). Chosen first inside the
 * deploy's own session, from the answer to its first request (`version`),
 * before anything is read or signed: a runner that carries out version 2 gets
 * version 2, an older one version 1, and one that speaks a newer protocol
 * than this zekno gets nothing (C7).
 */
import {
  compareRunnerVersions,
  RUNNER_PROTOCOL,
  type RunnerVersion,
} from "@workspace/core"

import { CliError } from "../cli/errors"
import { B10 } from "../domains/words"
import type { SessionMode } from "../server/session"
import { C7 } from "../shared/deploy-words"

/**
 * The first protocol whose runner carries out version 2 with `previous`,
 * `expiresAt` and secrets by version (contracts/protocol.md, P1). A deploy
 * with neither a route nor a health check needs nothing more.
 */
const VERSION_TWO_PROTOCOL = 3

/**
 * The first protocol whose runner carries out `routes` and `health`
 * (specs/015-domains-https, contracts/core.md, "The protocol"): a deploy
 * with either is signed only for such a runner (CL3, step 1).
 */
export const ROUTES_PROTOCOL = 4

/** The format chosen. `older`: version 1 because the runner, at `version`, is older than the one this zekno carries (C6). */
export type ChosenFormat =
  { format: 1; older?: { version: string } } | { format: 2 }

/**
 * - A protocol above this zekno's: C7, thrown; nothing is signed.
 * - A deploy with a route or a health check (`routed`) for a runner that
 *   does not carry them out, below protocol 4 or run one request at a time:
 *   B10, thrown; nothing is signed (specs/015-domains-https, CL3 step 1). A
 *   deploy with neither is not affected.
 * - A runner that does not speak sessions reports no version: version 1,
 *   nothing said.
 * - Protocol 3 or more: version 2.
 * - Below: version 1, with `older` when the runner reports a version older
 *   than `carried` (research R18: a runner at the version this zekno carries
 *   is not told to update to it).
 */
export function chooseFormat(input: {
  server: string
  mode: SessionMode
  runner: RunnerVersion | undefined
  carried: string
  routed?: boolean
}): ChosenFormat {
  const { runner } = input
  const oneShot = input.mode === "one-shot" || runner === undefined
  if (!oneShot && runner.protocol > RUNNER_PROTOCOL)
    throw new CliError(C7(input.server, runner.version, input.carried))
  if (input.routed === true && (oneShot || runner.protocol < ROUTES_PROTOCOL))
    throw new CliError(B10(input.server, oneShot ? undefined : runner.version))
  if (oneShot) return { format: 1 }
  if (runner.protocol >= VERSION_TWO_PROTOCOL) return { format: 2 }
  return compareRunnerVersions(runner.version, input.carried) < 0
    ? { format: 1, older: { version: runner.version } }
    : { format: 1 }
}
