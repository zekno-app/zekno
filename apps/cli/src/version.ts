/**
 * The CLI's own version (specs/006-cli-small-features, research R13): the
 * `version` of apps/cli/package.json, held to the one version grammar the
 * runner's releases use.
 *
 * The JSON is imported, so `Bun.build` puts its content into the compiled
 * program, and run from source it is read by its path from this file. Nothing
 * reads a `package.json` at run time, least of all one in the folder zekno is
 * started in, which may come from anyone (`autoloadPackageJson: false` in
 * build.ts).
 */
import { RUNNER_VERSION_PATTERN } from "@workspace/core"

import cli from "../package.json"

if (typeof cli.version !== "string" || !RUNNER_VERSION_PATTERN.test(cli.version)) {
  throw new Error("apps/cli/package.json has a version zekno does not read.")
}

/** This zekno's version, as `zekno --version` prints it. */
export const CLI_VERSION: string = cli.version

/** The two lines of `zekno --version` (mock-up 6): this zekno, and the runner release it installs. */
export function versionLines(runner: string): [string, string] {
  return [`zekno ${CLI_VERSION}`, `runner ${runner}, the runner release this zekno installs`]
}

/** The same, as one object for `--json`. */
export function versionObject(runner: string): { zekno: string; runner: string } {
  return { zekno: CLI_VERSION, runner }
}
