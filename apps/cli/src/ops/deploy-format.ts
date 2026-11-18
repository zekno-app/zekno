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
import type { SessionMode } from "../server/session"
import { C7 } from "../shared/deploy-words"

/**
 * The first protocol whose runner carries out version 2 with `previous`,
 * `expiresAt` and secrets by version (contracts/protocol.md, P1). This
 * zekno uses none of the later fields, so that is all it needs.
 */
const VERSION_TWO_PROTOCOL = 3

/** The format chosen. `older`: version 1 because the runner, at `version`, is older than the one this zekno carries (C6). */
export type ChosenFormat =
  { format: 1; older?: { version: string } } | { format: 2 }

/**
 * - A runner that does not speak sessions reports no version: version 1,
 *   nothing said.
 * - A protocol above this zekno's: C7, thrown; nothing is signed.
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
}): ChosenFormat {
  const { runner } = input
  if (input.mode === "one-shot" || runner === undefined) return { format: 1 }
  if (runner.protocol > RUNNER_PROTOCOL)
    throw new CliError(C7(input.server, runner.version, input.carried))
  if (runner.protocol >= VERSION_TWO_PROTOCOL) return { format: 2 }
  return compareRunnerVersions(runner.version, input.carried) < 0
    ? { format: 1, older: { version: runner.version } }
    : { format: 1 }
}
