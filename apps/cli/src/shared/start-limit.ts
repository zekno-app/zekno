/**
 * What the CLI says when the runner stopped waiting for an app to start at
 * its time limit (specs/015-domains-https, design/lines.md, B20; security
 * review, lead A10): the report of a version-2 deploy then carries
 * `startLimit`, the limit in whole seconds, with `start_failed`. The wording
 * was approved by the maintainer on 2026-11-20; it lives here only, so it
 * changes in one place. Everything else said about a start that failed
 * stays as it is.
 *
 * A sentence is given names that passed their rule (a server, an app), a
 * deploy number and the limit the runner reported, already held to its
 * schema: never a piece of Docker's output.
 */

const plural = (count: number, unit: string): string =>
  `${count} ${unit}${count === 1 ? "" : "s"}`

/** A limit in whole seconds as B20 says it: `30 minutes`, `1 minute`; `90 seconds` when it is not whole minutes. */
export const limitWords = (seconds: number): string =>
  seconds % 60 === 0
    ? plural(seconds / 60, "minute")
    : plural(seconds, "second")

/** B20 at a terminal and in the app: the lead line, in place of `{server} accepted deploy {n}, but the app did not start.` */
export const stoppedWaiting = (
  server: string,
  sequence: number,
  app: string,
  seconds: number
): string =>
  `${server} accepted deploy ${sequence}, but ${app} did not start within ${limitWords(seconds)}, so ${server} stopped waiting.`

/** B20 in plain output: the line on standard error, in place of the one of a start that failed for another reason. */
export const stoppedWaitingPlain = (
  server: string,
  sequence: number,
  app: string,
  seconds: number
): string =>
  `Deploy ${sequence} of ${app} was accepted by ${server}, but the app did not start within ${limitWords(seconds)}, so ${server} stopped waiting. Check Docker on the server.`
