/**
 * A runner's version against the one this zekno carries
 * (specs/005-runner-release/contracts/versions.md): how the two stand, and
 * what `server add`, `status` and the app say about it. Split from
 * ops/server.ts with no change of behaviour, since that file was past 500
 * lines; server.ts re-exports what is imported from it.
 */
import {
  compareRunnerVersions,
  isDevVersion,
  RUNNER_PROTOCOL,
  type RunnerVersion,
} from "@workspace/core"

import type { SessionMode } from "../server/session"

/** Compares two runner versions: negative when `a` is older (packages/core, `compareRunnerVersions`). */
export function compareVersions(a: string, b: string): number {
  return compareRunnerVersions(a, b)
}

/**
 * A runner against the one this CLI carries (specs/005-runner-release/contracts/versions.md,
 * "The relation"): older, the same or newer, and what does not work until it is updated.
 */
export type RunnerRelation = {
  relation: "older" | "same" | "newer"
  /**
   * What needs the runner this CLI carries: with no sessions, running state
   * and logs; with sessions of a lower protocol, some of what this CLI does;
   * otherwise nothing.
   */
  missing: "state and logs" | "some" | "nothing"
  /** It speaks a newer protocol than this CLI: this CLI is updated before it deploys there. */
  newerProtocol: boolean
}

/**
 * How a runner stands to the version this CLI carries. One that does not
 * speak sessions does not report its version, and sessions came before every
 * release, so it is older. Otherwise the versions are compared by the one
 * order of packages/core, and the protocols say what works in between.
 */
export function runnerRelation(
  mode: SessionMode,
  runner: RunnerVersion | undefined,
  carried: string
): RunnerRelation {
  if (mode === "one-shot" || runner === undefined)
    return {
      relation: "older",
      missing: "state and logs",
      newerProtocol: false,
    }
  const order = compareRunnerVersions(runner.version, carried)
  return {
    relation: order < 0 ? "older" : order > 0 ? "newer" : "same",
    missing: runner.protocol < RUNNER_PROTOCOL ? "some" : "nothing",
    newerProtocol: runner.protocol > RUNNER_PROTOCOL,
  }
}

/**
 * What `server add`, `status` and the app say about a runner of another
 * version than this CLI's (contracts/versions.md, "Single commands"): W1 to
 * W5 by the relation, then D1 or D2 when exactly one of the two versions is
 * a development release. Undefined when it has this CLI's version. A runner
 * that reports no version is not said to be a development release or not.
 */
export function runnerWarning(
  server: string,
  version: string | undefined,
  relation: RunnerRelation,
  carried: string
): string | undefined {
  if (relation.relation === "same") return undefined
  const update = `run \`zekno server update ${server}\`.`
  if (version === undefined) {
    return `The runner on ${server} does not report its version, so it is older than this zekno's ${carried}. Deploys still work. Running state and logs need the newer runner: ${update}`
  }
  let sentence: string
  if (relation.relation === "older") {
    sentence =
      relation.missing === "some"
        ? `The runner on ${server} is version ${version}, older than this zekno's ${carried}. Deploys still work. Some of what this zekno does needs the newer runner: ${update}`
        : `The runner on ${server} is version ${version}, older than this zekno's ${carried}. Everything works with it. To bring it to ${carried}, ${update}`
  } else {
    sentence = relation.newerProtocol
      ? `The runner on ${server} is version ${version}, newer than this zekno's ${carried}, and speaks a newer protocol. Update zekno before you deploy to ${server}.`
      : `The runner on ${server} is version ${version}, newer than this zekno's ${carried}. It works with this zekno. Update zekno to match it; \`zekno server update\` never replaces a newer runner.`
  }
  if (isDevVersion(version) && !isDevVersion(carried))
    return `${sentence} Version ${version} is a development release.`
  if (isDevVersion(carried) && !isDevVersion(version))
    return `${sentence} This zekno carries a development release.`
  return sentence
}

/**
 * What is said beside a runner that was already on the server, in the app's
 * add-server screen and in `zekno deploy`'s first run (contracts/versions.md,
 * "The app"): its version, and whether it is out of date or newer than this
 * zekno. The installer reports a version only, already held to the version
 * grammar, and never a protocol.
 */
export function foundDetail(
  version: string | undefined,
  carried: string
): string {
  if (version === undefined) return "no version reported, out of date"
  const { relation } = runnerRelation(
    "session",
    { version, protocol: RUNNER_PROTOCOL },
    carried
  )
  if (relation === "older") return `version ${version}, out of date`
  if (relation === "newer") return `version ${version}, newer than this zekno`
  return `version ${version}`
}
