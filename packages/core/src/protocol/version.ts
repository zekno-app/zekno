/**
 * Runner versions (specs/005-runner-release/contracts/release.md, "Versions
 * and tags"). One grammar for every place a version is checked: the session
 * protocol, the CLI and its installer, the release scripts. The installer's
 * shell script carries its own copy, tested against this one.
 *
 * Three numbers, or three numbers followed by `-dev.<count>`, and nothing
 * else. No leading zero and at most 9 digits in any number, so each version
 * has one spelling and every number fits a shell's arithmetic.
 *
 * This module imports nothing.
 */

/** The whole grammar. No `g` or `y` flag: `test` keeps no state between calls. */
export const RUNNER_VERSION_PATTERN =
  /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(-dev\.[1-9][0-9]{0,8})?$/

/** A version's numbers. `dev` is the count of a dev version, undefined for a prod version. */
export type ParsedRunnerVersion = {
  major: number
  minor: number
  patch: number
  dev: number | undefined
}

/** The numbers of `text`, or undefined when it is not a version. */
export function parseRunnerVersion(
  text: string
): ParsedRunnerVersion | undefined {
  if (typeof text !== "string") return undefined
  const match = RUNNER_VERSION_PATTERN.exec(text)
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    dev:
      match[4] === undefined
        ? undefined
        : Number(match[4].slice("-dev.".length)),
  }
}

/**
 * Negative when `a` is older than `b`, 0 when they are the same, positive
 * when `a` is newer. With the same three numbers a dev version is older than
 * the plain one, and two dev versions go by their count. Throws when either
 * is not a version: an order is never guessed.
 */
export function compareRunnerVersions(a: string, b: string): number {
  const x = parseRunnerVersion(a)
  const y = parseRunnerVersion(b)
  if (!x || !y) throw new Error("Only runner versions can be compared.")
  const order = (n: number, m: number) => (n === m ? 0 : n < m ? -1 : 1)
  const core =
    order(x.major, y.major) ||
    order(x.minor, y.minor) ||
    order(x.patch, y.patch)
  if (core !== 0) return core
  if (x.dev === undefined || y.dev === undefined)
    return x.dev === y.dev ? 0 : x.dev === undefined ? 1 : -1
  return order(x.dev, y.dev)
}

/** True for a valid dev version, such as 0.1.0-dev.1. */
export function isDevVersion(text: string): boolean {
  return parseRunnerVersion(text)?.dev !== undefined
}
