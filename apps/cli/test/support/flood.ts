/**
 * A `zekno` process for the measurements in plumbing.test.ts (C7). Its
 * standard error is a pipe the test never reads. Arguments: the case and a
 * folder for its files.
 *
 * - `stderr`: `zekno status` against a runner that writes far more on
 *   standard error than anyone reads. The runner's id goes in `<folder>/pid`,
 *   and `<folder>/pid.done` appears if it ever got all of it out.
 * - `progress`: Docker's lines during a deploy, handed over to the deploy
 *   view of plain output as fast as a session reads them, far more than
 *   anyone reads; then the app does not start, so the lines kept are written
 *   on standard error, where nobody reads them.
 *
 * `<folder>/ready` appears once the flood starts, `<folder>/done` once the
 * process has nothing left to do. It uses an in-memory key store, never the
 * real keychain, and the plain interface exactly as `main.ts` builds it.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { RUNNER_MAIN } from "../../../runner/test/support/helpers"
import { run } from "../../src/cli/cli"
import type { Deps } from "../../src/cli/context"
import { memoryKeyStore } from "../../src/profile/keystore"
import { connect } from "../../src/server/transport"
import { processPlainUi } from "../../src/ui/plain/plain"

const [kind, dir] = process.argv.slice(2) as [string, string]
const LINE = "x".repeat(1000)
/** At most this much is sent, so that a build without the fix cannot exhaust the machine. */
const FLOOD_BYTES = 400_000_000

// As `main.ts` builds it for piped output, and closed as `main.ts` closes it.
const ui = processPlainUi()

if (kind === "stderr") {
  const deps: Deps = {
    home: join(dir, "home"),
    cwd: dir,
    keyStore: memoryKeyStore(),
    connect,
    ui,
    localRunner: [process.execPath, RUNNER_MAIN],
  }
  mkdirSync(deps.home, { recursive: true })
  if ((await run(["init", "--name", "Ada"], deps)) !== 0) process.exit(3)
  if ((await run(["server", "add", "dev", "--local"], deps)) !== 0)
    process.exit(3)
  // From here on the runner is one that only writes on standard error.
  deps.localRunner = [
    "sh",
    "-c",
    `echo $$ > "$0"; yes "$1" | head -c ${FLOOD_BYTES} >&2; touch "$0.done"; exit 2`,
    join(dir, "pid"),
    LINE,
  ]
  writeFileSync(join(dir, "ready"), "")
  await run(["status", "--server", "dev"], deps)
} else if (kind === "progress") {
  const view = ui.deploy({
    app: "web",
    server: "dev",
    file: "compose.yaml",
    flags: "",
  })
  writeFileSync(join(dir, "ready"), "")
  for (let index = 0; index < FLOOD_BYTES / LINE.length; index++) {
    view.progress(LINE)
    // A session hands lines over as it reads their frames, and waits for input now and then.
    if (index % 500 === 0) await Bun.sleep(0)
  }
  await view.end({
    outcome: "start_failed",
    sequence: 1,
    app: "web",
    server: "dev",
    secrets: 0,
    ms: 1,
  })
}
await ui.close()
writeFileSync(join(dir, "done"), "")
process.exit(0)
