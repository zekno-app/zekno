/**
 * Check L1, in record mode, job `released` (specs/016-build-from-source,
 * T021; FR-083, SC-009; contracts/runner.md RB18; research/map-checks.md
 * part 7, L1). It runs only in the Linux stand-in `gate.ts` names; without
 * ZEKNO_LINUX_SERVER it prints its one skip line. It asserts nothing about
 * what runner 0.1.1 does: it prints one record line, `L1 <engine> <store>:
 * ...`, and fails only on its own fault, a SHA-256 that is not the recorded
 * one among them, which stops it with one line.
 *
 * Runner 0.1.1 itself, downloaded in the stand-in for its processor over
 * plain HTTPS with no token, its SHA-256 held to what commit `ee40f7d`
 * recorded in apps/cli/src/version/runner-release.json (`git show`; the job
 * fetches the whole history), is put at `/usr/local/bin/zekno-runner`, set
 * up for a team made in the run, and sent signed version-2 deploys
 * (`../support/deploy-v2.ts`) whose Compose text asks for a build: context
 * `.`, a git address on a name that cannot resolve, and `../..`. For each:
 * the outcome, whether Compose built the image, the images and containers
 * new after it, and the number the runner's state shows
 * (`released-run.ts`, `released-runner.ts`).
 *
 * Every command runs in the stand-in. It removes what it made there, by
 * name: the apps' containers, networks and images, the build records in its
 * own Docker configuration, the runner it put there, with the stand-in's own
 * put back, and its folder.
 */
import { describe, test } from "bun:test"

import { gate } from "../support/linux-server/gate"
import { record } from "../support/linux-server/jobs/record"
import {
  cleanUpReleased,
  observeReleased,
  type ReleasedMade,
} from "../support/linux-server/checks/released-run"
import { CHECK } from "../support/linux-server/checks/released-runner"

const open = gate(CHECK)
if (!open.ready) console.log(open.skip)

const MINUTE = 60_000

describe.skipIf(!open.ready)(
  "L1: runner 0.1.1 itself given a signed Compose text that asks for a build (record mode)",
  () => {
    test(
      "records what runner 0.1.1 and Compose did",
      async () => {
        if (!open.ready) return
        const made: ReleasedMade = { started: false, cases: [] }
        let failure: { error: unknown } | undefined
        try {
          record(CHECK, await observeReleased(open.inStandIn, made))
        } catch (error) {
          failure = { error }
        }
        const left = await cleanUpReleased(open.inStandIn, made)
        if (failure !== undefined) throw failure.error
        if (left.length > 0)
          throw new Error(`L1 left in the stand-in: ${left.join("; ")}`)
      },
      12 * MINUTE
    )
  }
)
