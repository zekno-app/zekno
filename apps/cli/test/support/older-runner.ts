/**
 * The runner of this repository as an older runner would be to this zekno
 * (specs/014-deploy-v2, research R23 (c)): answering `version` as another
 * release and protocol (`reportingRunner`), and, for runner 0.1.0, with its
 * state rewritten as runner 0.1.0 writes it (`olderState`), so this zekno
 * signs version 1 and the runner takes it for the apps that state holds.
 * Everything else is the runner of this repository, with the stand-in
 * Docker. And the release before feature 016, zekno 0.1.1 and runner 0.1.1,
 * taken from git (specs/016-build-from-source, CL13): `olderMachine`,
 * `olderRunnerScript` and the older zekno's own words (`olderModule`).
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { olderState } from "../../../runner/test/support/deploy-v2"
import {
  fakeDocker,
  RUNNER_MAIN,
  tempDir,
} from "../../../runner/test/support/helpers"
import {
  olderRunner,
  olderZekno,
  type OlderDeps,
} from "../../../runner/test/support/older-programs"
import type { machine } from "./helpers"
import { reportingRunner } from "./stand-in-server"

type Machine = ReturnType<typeof machine>

/** The runner of this repository, with the stand-in Docker at `docker`, as a zekno's `localRunner`. */
export const todaysRunner = (docker: string): string[] => [
  "env",
  `ZEKNO_DOCKER=${docker}`,
  process.execPath,
  RUNNER_MAIN,
]

/** Makes `m`'s local runner answer `version` as `version` of `protocol`. Gives what puts today's runner back. */
export function reportingAs(
  m: Machine,
  version: string,
  protocol: number
): () => void {
  const path = join(tempDir("reporting"), "zekno-runner")
  writeFileSync(path, reportingRunner(m.docker.path, version, protocol), {
    mode: 0o755,
  })
  const before = m.deps.localRunner
  m.deps.localRunner = ["sh", path]
  return () => {
    m.deps.localRunner = before
  }
}

/**
 * `m`'s runner as runner 0.1.0 leaves it: its state without a mark, holding
 * `lastSequence` (each app at 1 or more takes version 1 here, research R2),
 * and answering as 0.1.0 of protocol 2. Gives what puts today's runner back;
 * the state stays as the runner last wrote it.
 */
export function asReleased(
  m: Machine,
  lastSequence: Record<string, number>
): () => void {
  olderState(m.runnerHome, lastSequence)
  return reportingAs(m, "0.1.0", 2)
}

/**
 * Runner 0.1.1 and zekno 0.1.1, the release before feature 016, both of
 * this tag: protocol 5, no build (specs/016-build-from-source, contracts/cli.md
 * CL13; core.md CO18).
 */
export const RELEASED = "runner-v0.1.1"

/** A shell script that starts the runner of `tree` with the stand-in Docker at `docker`, for a stand-in server's runner path. */
export const olderRunnerScript = (tree: string, docker: string): string =>
  `#!/bin/sh\nexec ${olderRunner(tree, docker)
    .map((word) => `'${word.replaceAll("'", `'\\''`)}'`)
    .join(" ")} "$@"\n`

/** One module of the older zekno of `tree`, such as the words it says: read from its own source, never copied here. */
export const olderModule = <T>(tree: string, path: string): Promise<T> =>
  import(join(tree, "apps/cli/src", path)) as Promise<T>

/**
 * The older zekno of `tree`, run in this process, with a profile folder, a
 * project folder and a stand-in Docker of its own, never `~/.zekno`, and the
 * runner `runner(docker)` gives on this machine. `says` runs one command
 * and gives its status and its last line on each stream.
 */
export async function olderMachine(
  tree: string,
  runner: (docker: string) => string[]
) {
  const older = await olderZekno(tree)
  const docker = fakeDocker()
  const out: string[] = []
  const err: string[] = []
  const deps: OlderDeps = {
    home: tempDir("older-profile"),
    cwd: tempDir("older-project"),
    keyStore: older.memoryKeyStore(),
    connect: older.connect,
    ui: older.plainUi(
      (line) => out.push(line),
      (line) => err.push(line)
    ),
    localRunner: runner(docker.path),
  }
  return {
    deps,
    docker,
    out,
    err,
    runnerHome: join(deps.home, "runner", "dev"),
    says: async (...args: string[]) => {
      const code = await older.run(args, deps)
      return { code, out: out.at(-1), err: err.at(-1) }
    },
  }
}
