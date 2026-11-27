/**
 * Check L18, asserting from its first run (specs/016-build-from-source,
 * T020; FR-033, SC-008; quickstart.md phase 0, item 3; contracts/runner.md
 * RB7, "Never passed"). It runs only in the Linux stand-in `gate.ts` names;
 * without ZEKNO_LINUX_SERVER it prints its one skip line.
 *
 * With RB7's list (`rb7.ts`), Dockerfiles holding `RUN --network=host`,
 * `RUN --security=insecure`, `RUN --device=<a device of the stand-in that a
 * container does not get>` and `RUN --mount=type=ssh`, each step printing
 * its interfaces, `ip -o addr`, `/dev`, `CapEff`, `SSH_AUTH_SOCK` and any
 * socket under `/run/buildkit`. Each build must fail, or run with none of
 * the stand-in's own addresses, no device beyond the control's, not the
 * stand-in's full capability set and no SSH agent socket. Then a build
 * signed `--network none` whose step asks `RUN --network=default` and tries
 * the stand-in's own address on its sshd's port: no network. A control, a
 * plain step under `--network default`, must build and print first, or no
 * case can be judged (`sandbox-run.ts`, `sandbox-probe.ts`). It prints its
 * record line, `L18 <engine> <store>: ...`, then asserts.
 *
 * Every command runs in the stand-in. It removes what it made there, by
 * name: the images its builds tagged, the base when its builds brought it,
 * the build records in its own BUILDX_CONFIG, and its folder.
 */
import { describe, expect, test } from "bun:test"

import { gate } from "../support/linux-server/gate"
import { record } from "../support/linux-server/jobs/record"
import {
  CHECK,
  cleanUpSandbox,
  observeSandbox,
  type SandboxMade,
  type SandboxSeen,
} from "../support/linux-server/checks/sandbox-run"

const open = gate(CHECK)
if (!open.ready) console.log(open.skip)

const MINUTE = 60_000

describe.skipIf(!open.ready)(
  "L18: no host network, device, insecure step or SSH agent through RB7's list (asserts)",
  () => {
    test(
      "each build fails or stays in the sandbox, and a signed none has no network",
      async () => {
        if (!open.ready) return
        const made: SandboxMade = { options: [], results: [] }
        let seen: SandboxSeen | undefined
        let failure: { error: unknown } | undefined
        try {
          seen = await observeSandbox(open.inStandIn, made)
          record(CHECK, seen.words)
        } catch (error) {
          failure = { error }
        }
        const left = await cleanUpSandbox(open.inStandIn, made)
        if (failure !== undefined) throw failure.error
        if (left.length > 0)
          throw new Error(`L18 left in the stand-in: ${left.join("; ")}`)
        expect(seen?.violations).toEqual([])
      },
      20 * MINUTE
    )
  }
)
