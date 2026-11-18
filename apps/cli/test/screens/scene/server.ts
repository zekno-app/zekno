/**
 * The example world every screen is drawn in (contracts/screens.md, "The
 * screens"): a developer's machine from test/support/helpers.ts, a project
 * folder named for the app `shop`, and the server `prod-1` at
 * `203.0.113.10`, user `deploy`, which is the stand-in server of
 * test/support/stand-in-server.ts reached over its stand-in `ssh`. Nothing
 * reaches a real server, the network, the keychain or the person's profile.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import runnerPackage from "../../../../runner/package.json"
import { RUNNER_MAIN, tempDir } from "../../../../runner/test/support/helpers"
import type { RunnerRelease } from "../../../src/version/runner-release"
import { machine } from "../../support/helpers"
import {
  sshStandIn,
  standInServer,
  withSsh,
  type StandInServer,
} from "../../support/stand-in-server"

export type Machine = ReturnType<typeof machine>

/** The example values. */
export const EXAMPLE = {
  member: "Ada",
  app: "shop",
  server: "prod-1",
  destination: "deploy@203.0.113.10",
} as const

/** The example app's Compose file: a web service that reads one secret. */
export const SHOP_COMPOSE = `services:
  web:
    image: ghcr.io/example/shop:1.4.2
    environment:
      - DATABASE_URL
`

/**
 * The real runner of this repository as the stand-in server's release: a
 * shell script, as test/support/stand-in-server.ts `realRunner` writes it,
 * with the runner's folder named. Unnamed, a runner started as root keeps
 * its key and state in /var/lib/zekno (apps/runner/src/home/home.ts), shared
 * by every run; named, the screens are drawn the same as root and as anyone
 * else, and nothing is written outside the stand-in server's folder.
 */
function runnerScript(server: StandInServer, docker: string): string {
  return `#!/bin/sh\nexec env ZEKNO_DOCKER="${docker}" ZEKNO_RUNNER_HOME="${server.folder}" "${process.execPath}" "${RUNNER_MAIN}" "$@"\n`
}

/**
 * A machine with nothing set up, whose project folder is `shop` holding
 * `compose`, and the stand-in server with the real runner as its release.
 * `inSsh` runs work with `ssh` meaning the stand-in.
 */
export function exampleWorld(compose: string | null = SHOP_COMPOSE) {
  const m = machine()
  const project = join(tempDir("projects"), EXAMPLE.app)
  mkdirSync(project)
  m.deps.cwd = project
  if (compose !== null) writeFileSync(join(project, "compose.yaml"), compose)
  const server = standInServer()
  const release: RunnerRelease = {
    version: runnerPackage.version,
    files: {
      "linux-x64": {
        sha256: server.release(runnerScript(server, m.docker.path)),
      },
      "linux-arm64": { sha256: null },
    },
  }
  m.deps.release = release
  const ssh = sshStandIn(server)
  return {
    m,
    project,
    server,
    ssh,
    inSsh: <T>(work: () => Promise<T>) => withSsh(ssh, work),
    /** Writes the project folder's compose.yaml. */
    compose: (text: string) =>
      writeFileSync(join(project, "compose.yaml"), text),
    /** Runs `zekno <args>` with the plain interface and throws with what it said when it fails. */
    async zekno(...args: string[]) {
      const code = await withSsh(ssh, () => m.zekno(...args))
      if (code !== 0)
        throw new Error(
          `zekno ${args.join(" ")} failed: ${[...m.out, ...m.err].join("\n")}`
        )
    },
  }
}

export type World = ReturnType<typeof exampleWorld>

/** A world with the team made and `prod-1` added, as after `zekno init` and `zekno server add`. */
export async function withServer(compose: string | null = SHOP_COMPOSE) {
  const world = exampleWorld(compose)
  await world.zekno("init", "--name", EXAMPLE.member)
  await world.zekno(
    "server",
    "add",
    EXAMPLE.server,
    "--ssh",
    EXAMPLE.destination
  )
  return world
}

/** What `ps` says of a running app's web service, as Docker writes it. */
export const RUNNING = (service: string) =>
  `${JSON.stringify({ Service: service, State: "running", ExitCode: 0, Health: "" })}\n`
