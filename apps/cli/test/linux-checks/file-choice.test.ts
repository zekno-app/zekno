/**
 * Check L17, in record mode (specs/016-build-from-source, T019;
 * contracts/cli.md CL2 and CL3, "Checked against BuildKit"; plan.md "Risks",
 * the row on the Dockerfile reader and the ignore rules). It runs only in
 * the Linux stand-in `gate.ts` names; without ZEKNO_LINUX_SERVER it prints
 * its one skip line. It asserts nothing about Docker: it prints one record
 * line, `L17 <engine> <store>: ...`, and fails only on its own fault (a step
 * of its own that could not be done, or something it made that it could not
 * remove). T163 turns it to assert against zekno's pass 1 and reader.
 *
 * For each `ignore-*` fixture of `apps/runner/test/support/linux-server/
 * fixtures/`, written in the stand-in with the names the repository's
 * `.gitignore` keeps out of a commit, a link and an empty folder beside it:
 * the sorted list of what a `FROM scratch` build copies out with
 * `--output type=local`, and the stages `docker buildx build
 * --call=targets` lists (`file-choice.ts`). Both are the check's own
 * commands, never the runner's, and run on the stand-in's engine.
 *
 * Every command runs in the stand-in. It removes what it made there, by
 * name: its folder, and the build records its builds left in its own
 * BUILDX_CONFIG. Every bun command in apps/cli is `bun --no-env-file ...`.
 */
import { describe, test } from "bun:test"

import {
  CHECK,
  cleanUpFileChoice,
  type FileChoiceMade,
  observeFileChoice,
} from "../../../runner/test/support/linux-server/checks/file-choice"
import { gate } from "../../../runner/test/support/linux-server/gate"
import { record } from "../../../runner/test/support/linux-server/jobs/record"

const open = gate(CHECK)
if (!open.ready) console.log(open.skip)

const MINUTE = 60_000

describe.skipIf(!open.ready)(
  "L17: the files BuildKit copies and the stages it lists, for each ignore-* fixture (record mode)",
  () => {
    test(
      "records what BuildKit did",
      async () => {
        if (!open.ready) return
        const made: FileChoiceMade = { refs: [] }
        let failure: { error: unknown } | undefined
        try {
          record(CHECK, await observeFileChoice(open.inStandIn, made))
        } catch (error) {
          failure = { error }
        }
        const left = await cleanUpFileChoice(open.inStandIn, made)
        if (failure !== undefined) throw failure.error
        if (left.length > 0)
          throw new Error(`L17 left in the stand-in: ${left.join("; ")}`)
      },
      30 * MINUTE
    )
  }
)
