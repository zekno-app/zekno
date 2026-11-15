/**
 * A `zekno logs` process for the tests in state-logs.test.tsx (L1, L2 of
 * security-review.md), run with the plain interface exactly as `main.ts`
 * builds it when output is piped: this process's own standard output. It
 * sets up a team, a runner on this machine and a deploy of `demo` in
 * `<folder>`, with an in-memory key store, never the real keychain, and the
 * stand-in Docker, whose log command prints without pause, as a container
 * that logs in a loop. Argument: a folder.
 *
 * - `<folder>/runner.pids`: the process id of each runner started.
 * - `<folder>/logs.pid`: Docker's log command, once it has started.
 * - `<folder>/ready`: appears once the logs are asked for.
 */
import { chmodSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { fakeDocker, RUNNER_MAIN } from "../../runner/test/helpers"
import { run } from "../src/cli"
import type { Deps } from "../src/context"
import { memoryKeyStore } from "../src/keystore"
import { connect } from "../src/transport"
import { plainUi, processPlainUi } from "../src/ui/plain"
import { COMPOSE_V1 } from "./helpers"

const [dir] = process.argv.slice(2) as [string]
const docker = fakeDocker()
const flooding = join(dir, "docker")
writeFileSync(
  flooding,
  `#!/bin/sh\nif [ "$4" = logs ]; then echo $$ > "${join(dir, "logs.pid")}"; exec yes "web-1  | 2026-11-14T00:00:00Z ${"x".repeat(200)}"; fi\nexec "${docker.path}" "$@"\n`
)
chmodSync(flooding, 0o755)
writeFileSync(join(dir, "compose.yaml"), COMPOSE_V1)

const quiet = plainUi(
  () => {},
  (line) => console.error(line)
)
const deps: Deps = {
  home: join(dir, "home"),
  cwd: dir,
  keyStore: memoryKeyStore(),
  connect,
  ui: quiet,
  localRunner: ["sh", "-c", 'echo $$ >> "$0"; exec "$@"', join(dir, "runner.pids"), "env", `ZEKNO_DOCKER=${flooding}`, process.execPath, RUNNER_MAIN],
}
for (const args of [
  ["init", "--name", "Ada"],
  ["server", "add", "dev", "--local"],
  ["deploy", "--app", "demo", "--server", "dev"],
]) {
  if ((await run(args, deps)) !== 0) process.exit(3)
}
writeFileSync(join(dir, "ready"), "")
process.exit(await run(["logs", "--app", "demo", "--server", "dev"], { ...deps, ui: processPlainUi() }))
