/**
 * This zekno beside the released programs (specs/014-deploy-v2, User Story
 * 4; research R22, R24; tasks T055): runner 0.1.0 and the zekno from before
 * version 2, each taken from this clone's history (`older-programs.ts` of
 * the runner's tests), with the stand-in Docker. Every case is skipped, with
 * the reason printed once, in a clone without that history.
 *
 * SC-005: the deploy flows of `apps/cli/tests/deploy.e2e.ts`,
 * `rollback.e2e.ts` and `link.e2e.ts`, as plain commands, against runner
 * 0.1.0: each works, in version 1, and says C6. SC-006 and US4 scenarios 2,
 * 3 and 5: the older zekno against this runner, on the folder runner 0.1.0
 * wrote, and runner 0.1.0 put back after this runner wrote.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { fakeDocker, tempDir } from "../../../runner/test/support/helpers"
import {
  BEFORE,
  OLDER_RUNNER,
  olderRunner,
  olderTree,
  olderZekno,
  type OlderDeps,
} from "../../../runner/test/support/older-programs"
import { run } from "../../src/cli/cli"
import type { Deps } from "../../src/cli/context"
import { memoryKeyStore } from "../../src/profile/keystore"
import { connect } from "../../src/server/transport"
import { C6 } from "../../src/shared/deploy-words"
import { plainUi } from "../../src/ui/plain/plain"
import { COMPOSE_V1, COMPOSE_V2, machine } from "../support/helpers"
import { todaysRunner } from "../support/older-runner"

const runnerTree = olderTree(OLDER_RUNNER)
const zeknoTree = olderTree(BEFORE)

/** C6 against runner 0.1.0 named prod, for this zekno carrying 0.1.1. */
const C6_PROD = C6("prod", "0.1.0", "0.1.1")

/** A runner folder's stored state, parsed. */
const stateIn = (home: string) =>
  JSON.parse(readFileSync(join(home, "state.json"), "utf8")) as {
    lastSequence: Record<string, number>
    secrets: Record<string, { version: number; hash: string | null }>
    v?: number
  }

/** Every file under `dir`, with its text. */
const files = (dir: string): { path: string; text: string }[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((path) => join(dir, path))
    .filter((path) => statSync(path).isFile())
    .map((path) => ({ path, text: readFileSync(path, "utf8") }))

/** This zekno, carrying runner 0.1.1, with a team and runner 0.1.0 on this machine named prod. */
async function onRunnerZeroOneZero() {
  const m = machine()
  m.deps.localRunner = olderRunner(runnerTree!, m.docker.path)
  m.deps.release = {
    version: "0.1.1",
    files: { "linux-x64": { sha256: null }, "linux-arm64": { sha256: null } },
  }
  expect(await m.zekno("init", "--name", "Ada")).toBe(0)
  expect(await m.zekno("server", "add", "prod", "--local")).toBe(0)
  const runnerHome = join(m.home, "runner", "prod")
  /** Each warning C6 since `from`, counted. */
  const c6Since = (from: number) =>
    m.err.slice(from).filter((line) => line === C6_PROD).length
  return { m, runnerHome, c6Since }
}

describe("SC-005: this zekno with runner 0.1.0, the deploy flows of today's end-to-end tests", () => {
  test.skipIf(runnerTree === undefined)(
    "a linked folder deploys (deploy.e2e.ts), in version 1, and says C6",
    async () => {
      const { m, runnerHome, c6Since } = await onRunnerZeroOneZero()
      m.compose(COMPOSE_V1)
      expect(await m.zekno("link", "--app", "demo", "--server", "prod")).toBe(0)
      const from = m.err.length
      expect(await m.zekno("deploy")).toBe(0)
      expect(m.lastOut()).toBe(
        "Deploy 1 of demo is running on prod with no secrets."
      )
      expect(c6Since(from)).toBe(1)
      expect(stateIn(runnerHome).lastSequence).toEqual({ demo: 1 })
      expect(stateIn(runnerHome).v).toBeUndefined()
      expect(m.docker.calls().map((call) => call.args)).toEqual([
        expect.stringContaining("compose -p zekno-demo "),
      ])
    }
  )

  test.skipIf(runnerTree === undefined)(
    "a secret reaches the container, and no file holds its value but the stand-in Docker's record (deploy.e2e.ts)",
    async () => {
      const { m, runnerHome, c6Since } = await onRunnerZeroOneZero()
      const value = "a greeting from the pairing test"
      m.compose(COMPOSE_V1)
      m.typing(value)
      expect(
        await m.zekno(
          "secret",
          "set",
          "GREETING",
          "--app",
          "demo",
          "--server",
          "prod"
        )
      ).toBe(0)
      const from = m.err.length
      expect(await m.zekno("deploy", "--app", "demo", "--server", "prod")).toBe(
        0
      )
      expect(c6Since(from)).toBe(1)
      expect(m.docker.calls().map((call) => call.env.GREETING)).toEqual([value])
      expect(stateIn(runnerHome).secrets).toMatchObject({
        "demo/GREETING": { version: 1 },
      })
      const forms = [value, Buffer.from(value).toString("base64url")]
      expect(
        files(m.home).filter((file) =>
          forms.some((form) => file.text.includes(form))
        )
      ).toEqual([])
      expect([...m.out, ...m.err].some((line) => line.includes(value))).toBe(
        false
      )
    }
  )

  test.skipIf(runnerTree === undefined)(
    "two deploys and a rollback to deploy 1 (rollback.e2e.ts): number 3, three starts, each saying C6",
    async () => {
      const { m, runnerHome, c6Since } = await onRunnerZeroOneZero()
      const where = ["--app", "demo", "--server", "prod"]
      m.compose(COMPOSE_V1)
      const from = m.err.length
      expect(await m.zekno("deploy", ...where)).toBe(0)
      m.compose(COMPOSE_V2)
      expect(await m.zekno("deploy", ...where)).toBe(0)
      expect(await m.zekno("rollback", ...where, "--to", "1")).toBe(0)
      expect(m.lastOut()).toBe(
        "Deploy 3 of demo is running on prod with no secrets."
      )
      expect(c6Since(from)).toBe(3)
      expect(stateIn(runnerHome).lastSequence).toEqual({ demo: 3 })
      expect(m.docker.calls()).toHaveLength(3)
      expect(
        readFileSync(join(runnerHome, "apps/demo/compose.yaml"), "utf8")
      ).toBe(COMPOSE_V1)
    }
  )

  test.skipIf(runnerTree === undefined)(
    "two apps (link.e2e.ts): one deploy each",
    async () => {
      const { m, runnerHome, c6Since } = await onRunnerZeroOneZero()
      m.compose(COMPOSE_V1)
      const from = m.err.length
      for (const app of ["demo", "api"])
        expect(await m.zekno("deploy", "--app", app, "--server", "prod")).toBe(
          0
        )
      expect(c6Since(from)).toBe(2)
      expect(stateIn(runnerHome).lastSequence).toEqual({ demo: 1, api: 1 })
      expect(m.docker.calls()).toHaveLength(2)
    }
  )
})

describe("SC-006: the zekno from before version 2, and runner 0.1.0 put back", () => {
  test.skipIf(runnerTree === undefined || zeknoTree === undefined)(
    "on the folder runner 0.1.0 wrote, this runner takes the older zekno's deploys of the apps held before, and refuses every other; runner 0.1.0 put back refuses all",
    async () => {
      const older = await olderZekno(zeknoTree!)
      const home = tempDir("older-profile")
      const cwd = tempDir("older-project")
      writeFileSync(join(cwd, "compose.yaml"), COMPOSE_V1)
      const docker = fakeDocker()
      const keyStore = older.memoryKeyStore()
      const out: string[] = []
      const err: string[] = []
      const olderDeps: OlderDeps = {
        home,
        cwd,
        keyStore,
        connect: older.connect,
        ui: older.plainUi(
          (line) => out.push(line),
          (line) => err.push(line)
        ),
        localRunner: olderRunner(runnerTree!, docker.path),
      }
      const olderSays = async (...args: string[]) => {
        const code = await older.run(args, olderDeps)
        return { code, out: out.at(-1), err: err.at(-1) }
      }
      const web = ["--app", "web", "--server", "dev"]
      const runnerHome = join(home, "runner", "dev")
      const state = () => readFileSync(join(runnerHome, "state.json"), "utf8")

      // The older zekno and runner 0.1.0, as every server runs today.
      expect((await olderSays("init", "--name", "Ada")).code).toBe(0)
      expect((await olderSays("server", "add", "dev", "--local")).code).toBe(0)
      expect((await olderSays("deploy", ...web)).code).toBe(0)

      // The runner is updated to this one, on the same folder: the app held before still deploys (US4 scenario 2).
      olderDeps.localRunner = todaysRunner(docker.path)
      expect(await olderSays("deploy", ...web)).toMatchObject({
        code: 0,
        out: "Deploy 2 of web is running on dev with no secrets.",
      })
      // A new app is refused, and nothing is written (US4 scenario 3).
      let before = state()
      expect(
        await olderSays("deploy", "--app", "other", "--server", "dev")
      ).toMatchObject({
        code: 1,
        err: "The runner refused the request (unsupported_version).",
      })
      expect(state()).toBe(before)
      // Its `zekno status` reads this runner (FR-033).
      expect((await olderSays("status", "--server", "dev")).code).toBe(0)

      // This zekno, on the same profile, deploys web in version 2.
      const mine: string[] = []
      const mineErr: string[] = []
      const deps: Deps = {
        home,
        cwd,
        keyStore: memoryKeyStore(),
        connect,
        ui: plainUi(
          (line) => mine.push(line),
          (line) => mineErr.push(line)
        ),
        localRunner: todaysRunner(docker.path),
      }
      const keyName = JSON.parse(
        readFileSync(join(home, "profile.json"), "utf8")
      ).keyName as string
      await deps.keyStore.set(keyName, (await keyStore.get(keyName))!)
      expect(await run(["deploy", ...web], deps)).toBe(0)
      expect(mine.at(-1)).toBe(
        "Deploy 3 of web is running on dev with no secrets."
      )
      expect(
        await run(["deploy", "--app", "other", "--server", "dev"], deps)
      ).toBe(0)
      expect(mine.at(-1)).toBe(
        "Deploy 1 of other is running on dev with no secrets."
      )
      // Protocol 6's runner writes the state marked 5 (specs/016-build-from-source, contracts/core.md CO9).
      expect(stateIn(runnerHome).v).toBe(5)

      // The older zekno can no longer deploy either app, and says why it skipped the newer entry of each history.
      for (const app of ["web", "other"]) {
        before = state()
        const from = err.length
        expect(
          await olderSays("deploy", "--app", app, "--server", "dev")
        ).toMatchObject({
          code: 1,
          err: "The runner refused the request (unsupported_version).",
        })
        expect(err.slice(from)).toContain(
          "Ignored 1 entry in the deploy history that could not be verified."
        )
        expect(state()).toBe(before)
      }

      // Runner 0.1.0 put back after this runner wrote: it refuses to act, and says so to either zekno (US4 scenario 5).
      const damaged =
        "The runner's stored state is damaged or incomplete, so it refuses to act."
      olderDeps.localRunner = olderRunner(runnerTree!, docker.path)
      deps.localRunner = olderRunner(runnerTree!, docker.path)
      before = state()
      expect(await run(["deploy", ...web], deps)).toBe(1)
      expect(mineErr.at(-1)).toBe(damaged)
      expect(await run(["status", "--server", "dev"], deps)).toBe(1)
      expect(mineErr.at(-1)).toBe(damaged)
      expect(await olderSays("deploy", ...web)).toMatchObject({
        code: 1,
        err: damaged,
      })
      expect(state()).toBe(before)
    },
    60_000
  )
})
