import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { fakeDocker, filesUnder, RUNNER_MAIN } from "../../runner/test/helpers"
import { run } from "../src/cli"
import type { Deps } from "../src/context"
import { memoryKeyStore } from "../src/keystore"
import { connect } from "../src/transport"
import { plainUi } from "../src/ui/plain"

export { filesUnder }

export const COMPOSE_V1 = "services:\n  web:\n    image: example/web:1\n    environment:\n      - GREETING\n"
export const COMPOSE_V2 = COMPOSE_V1.replace("web:1", "web:2")

/**
 * A developer's machine for tests: a temporary profile folder and project
 * folder, an in-memory key store instead of the real keychain, and a local
 * runner process that uses a stand-in Docker (or the real one).
 */
export function machine(options: { realDocker?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), "zekno-home-"))
  const project = mkdtempSync(join(tmpdir(), "zekno-project-"))
  const docker = fakeDocker()
  const keyStore = memoryKeyStore()
  const out: string[] = []
  const err: string[] = []
  const answers: string[] = []
  const deps: Deps = {
    home,
    cwd: project,
    keyStore,
    connect,
    // The plain interface, as used when output is piped, with typed answers queued by the test.
    ui: {
      ...plainUi(
        (line) => out.push(line),
        (line) => err.push(line)
      ),
      askSecret: async () => {
        const answer = answers.shift()
        if (answer === undefined) throw new Error("the test did not provide a secret value")
        return answer
      },
    },
    localRunner: options.realDocker
      ? [process.execPath, RUNNER_MAIN]
      : ["env", `ZEKNO_DOCKER=${docker.path}`, process.execPath, RUNNER_MAIN],
  }
  return {
    home,
    project,
    runnerHome: join(home, "runner", "dev"),
    docker,
    keyStore,
    out,
    err,
    deps,
    /** Runs `zekno <args>` and returns the exit status. */
    zekno: (...args: string[]) => run(args, deps),
    /** Queues the value the next `secret set` will read. */
    typing: (value: string) => void answers.push(value),
    compose: (content: string, name = "compose.yaml") => writeFileSync(join(project, name), content),
    /** Reads and rewrites one JSON file in the profile folder, as something other than zekno might. */
    tamper(file: string, change: (json: any) => unknown) {
      const path = join(home, file)
      writeFileSync(path, JSON.stringify(change(JSON.parse(readFileSync(path, "utf8")))))
    },
    lastOut: () => out.at(-1) ?? "",
    lastErr: () => err.at(-1) ?? "",
  }
}

/** A machine with a team, a connected local runner, and a Compose file. */
export async function ready(options: { realDocker?: boolean } = {}) {
  const m = machine(options)
  if ((await m.zekno("init", "--name", "Ada")) !== 0) throw new Error(m.lastErr())
  if ((await m.zekno("server", "add", "dev", "--local")) !== 0) throw new Error(m.lastErr())
  m.compose(COMPOSE_V1)
  return m
}
