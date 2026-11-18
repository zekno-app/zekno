/**
 * The runner of this repository as an older runner would be to this zekno
 * (specs/014-deploy-v2, research R23 (c)): answering `version` as another
 * release and protocol (`reportingRunner`), and, for runner 0.1.0, with its
 * state rewritten as runner 0.1.0 writes it (`olderState`), so this zekno
 * signs version 1 and the runner takes it for the apps that state holds.
 * Everything else is the runner of this repository, with the stand-in
 * Docker.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { olderState } from "../../../runner/test/support/deploy-v2"
import { tempDir } from "../../../runner/test/support/helpers"
import type { machine } from "./helpers"
import { reportingRunner } from "./stand-in-server"

type Machine = ReturnType<typeof machine>

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
