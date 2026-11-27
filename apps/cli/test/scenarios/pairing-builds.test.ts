/**
 * This feature beside the release before it (specs/016-build-from-source,
 * contracts/cli.md CL13; core.md CO18; FR-082 to FR-084; tasks T138): zekno
 * 0.1.1 and runner 0.1.1, taken from this clone's history as the pairing
 * tests of pairing.test.ts take theirs, with the stand-in Docker. Every case
 * is skipped, with the reason printed once, in a clone without that tag.
 *
 * Kept lines are checked against the sentence the program that says it
 * makes, from its own source (zekno 0.1.1's words, this zekno's), and new
 * ones by their row id: no sentence is written here (FR-092).
 */
import { describe, expect, test } from "bun:test"
import {
  buildKey,
  builtImageName,
  createDeployV2,
  RunnerReportSchema,
} from "@workspace/core"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import runnerPackage from "../../../runner/package.json"
import { tempDir } from "../../../runner/test/support/helpers"
import {
  olderRunner,
  olderTree,
} from "../../../runner/test/support/older-programs"
import { openTeam } from "../../src/cli/context"
import { RunnerRefused } from "../../src/cli/errors"
import type { doctorJson } from "../../src/commands/doctor"
import { chooseFormat } from "../../src/ops/deploy-format"
import { buildRefusal } from "../../src/ops/deploy-send-build"
import { runnerOlder, updateRunner } from "../../src/ops/doctor-words"
import { runnerRelation, runnerWarning } from "../../src/ops/server"
import { profileStore } from "../../src/profile/profile"
import { withSession } from "../../src/server/session"
import { connect } from "../../src/server/transport"
import { SETTINGS_FILE } from "../../src/settings/values"
import { BuildStop, exitStatusOf } from "../../src/shared/build-lines"
import { readDeployEntry } from "../../src/shared/history"
import { COMPOSE_V1, COMPOSE_V2, machine } from "../support/helpers"
import {
  olderMachine,
  olderModule,
  olderRunnerScript,
  RELEASED,
  todaysRunner,
} from "../support/older-runner"
import { sshStandIn, standInServer, withSsh } from "../support/stand-in-server"

const releasedTree = olderTree(RELEASED)

/** A settings file of `web`, its lines as given, inside the file's frame: the first key of the service is on line 5. */
const settingsOf = (...web: string[]) =>
  [
    "{",
    '  "zekno": 1,',
    '  "services": {',
    '    "web": {',
    ...web.map((line) => `      ${line}`),
    "    }",
    "  }",
    "}",
    "",
  ].join("\n")

/** The words of zekno 0.1.1 that CL13's rows keep, from its own source. */
type OlderWords = {
  notSettings(file: string, place: string, rule: string): string
  SV6(
    n: number,
    svc?: string,
    section?: string
  ): { place: string; rule: string }
  CS5: string
  C7(server: string, version: string, carried: string): string
}

describe("specs/016-build-from-source, CL13: zekno 0.1.1 beside this feature", () => {
  test.skipIf(releasedTree === undefined)(
    "F8, F9, F10 on a settings file that builds; build_failed makes its history damaged; F7 against this runner, before signing",
    async () => {
      const tree = releasedTree!
      const o = await olderMachine(tree, (docker) => olderRunner(tree, docker))
      const words = {
        ...(await olderModule<OlderWords>(tree, "settings/words.ts")),
        ...(await olderModule<OlderWords>(tree, "shared/deploy-words.ts")),
      }
      const { shownFile } = await olderModule<{
        shownFile(cwd: string, path: string): string
      }>(tree, "project/shown.ts")
      const where = ["--server", "dev"]
      expect((await o.says("init", "--name", "Ada")).code).toBe(0)
      expect((await o.says("server", "add", "dev", "--local")).code).toBe(0)
      writeFileSync(join(o.deps.cwd, "compose.yaml"), COMPOSE_V1)
      expect((await o.says("deploy", "--app", "demo", ...where)).code).toBe(0)
      const serverId = JSON.parse(
        readFileSync(join(o.deps.home, "profile.json"), "utf8")
      ).servers[0].serverId as string
      const history = join(o.deps.home, "history", serverId)

      // A folder whose settings file builds: SV6 at its first key 0.1.1 does not know, nothing signed.
      const project = o.deps.cwd
      o.deps.cwd = tempDir("older-settings")
      const file = join(o.deps.cwd, SETTINGS_FILE)
      const fault = (rule: { place: string; rule: string }) =>
        words.notSettings(shownFile(o.deps.cwd, file), rule.place, rule.rule)
      writeFileSync(
        file,
        settingsOf(
          '"build": { "builder": "dockerfile" },',
          '"networking": { "port": 3000 }'
        )
      )
      expect(await o.says("deploy", "--app", "web", ...where)).toMatchObject({
        code: 1,
        err: fault(words.SV6(5, "web")),
      })
      writeFileSync(
        file,
        settingsOf(
          '"source": {',
          '  "root": ".",',
          '  "image": "example/web:1"',
          "}"
        )
      )
      expect(await o.says("deploy", "--app", "web", ...where)).toMatchObject({
        code: 1,
        err: fault(words.SV6(6, "web", "source")),
      })
      expect(readdirSync(history)).toEqual(["demo.json"])
      // `zekno settings set web.builder dockerfile`: today's list of settings, as for any key 0.1.1 does not know.
      writeFileSync(file, settingsOf('"source": { "image": "example/web:1" }'))
      expect(
        await o.says("settings", "set", "web.builder", "dockerfile")
      ).toMatchObject({ code: 2, err: words.CS5 })

      // A history this zekno wrote with `build_failed`: 0.1.1 calls it damaged, as any outcome it does not know.
      o.deps.cwd = project
      const store = profileStore(o.deps.home)
      const kept = store.history(serverId, "demo")
      store.saveHistory(serverId, "demo", [
        { ...kept[0]!, outcome: "build_failed" },
      ])
      expect(store.history(serverId, "demo")[0]!.outcome).toBe("build_failed")
      // Each run says one line of its own, on standard error.
      const said = async () => {
        const from = o.err.length
        const { code } = await o.says("rollback", "--app", "demo", ...where)
        return { code, lines: o.err.slice(from) }
      }
      const damaged = await said()
      writeFileSync(
        join(history, "demo.json"),
        JSON.stringify([{ ...kept[0]!, outcome: "unknown_to_any_zekno" }])
      )
      const unknown = await said()
      expect(damaged.code).toBe(1)
      expect(damaged.lines).toHaveLength(1)
      expect(damaged).toEqual(unknown)

      // This repository's runner, of protocol 6: C7 before anything is signed, and its state left as it was.
      store.saveHistory(serverId, "demo", kept)
      o.deps.localRunner = todaysRunner(o.docker.path)
      const state = readFileSync(join(o.runnerHome, "state.json"), "utf8")
      const carried = (
        await olderModule<{ default: { version: string } }>(
          tree,
          "version/runner-release.json"
        )
      ).default.version
      expect(await o.says("deploy", "--app", "demo", ...where)).toMatchObject({
        code: 1,
        err: words.C7("dev", runnerPackage.version, carried),
      })
      expect(store.history(serverId, "demo")).toEqual(kept)
      expect(readFileSync(join(o.runnerHome, "state.json"), "utf8")).toBe(state)
    },
    60_000
  )
})

describe("specs/016-build-from-source, CL13: this zekno beside runner 0.1.1", () => {
  test.skipIf(releasedTree === undefined)(
    "F13 and F14 as today; an image deploy as in 015; a build stops with F1 before signing; a signed build handed anyway is malformed, no number used",
    async () => {
      const m = machine()
      const carried = "0.1.2-dev.1"
      m.deps.release = {
        version: carried,
        files: {
          "linux-x64": { sha256: null },
          "linux-arm64": { sha256: null },
        },
      }
      const server = standInServer()
      const ssh = sshStandIn(server)
      server.installed(olderRunnerScript(releasedTree!, m.docker.path))
      const over = <T>(work: () => Promise<T>) => withSsh(ssh, work)
      expect(await m.zekno("init", "--name", "Ada")).toBe(0)
      const added = ["server", "add", "prod", "--ssh", "prod.example"]
      const at = ["--runner-path", "~/.local/bin/zekno-runner"]
      expect(await over(() => m.zekno(...added, ...at))).toBe(0)
      const relation = runnerRelation(
        "session",
        { version: "0.1.1", protocol: 5 },
        carried
      )
      const f13 = runnerWarning("prod", "0.1.1", relation, carried)!
      expect(m.err).toContain(f13)
      m.err.length = 0
      expect(await over(() => m.zekno("status", "--server", "prod"))).toBe(0)
      expect(m.err).toContain(f13)
      m.out.length = 0
      await over(() => m.zekno("doctor", "--server", "prod", "--json"))
      const report = JSON.parse(m.out.at(-1)!) as ReturnType<typeof doctorJson>
      expect(
        report.servers[0]!.checks.find((check) => check.check === "runner")
      ).toEqual({
        check: "runner",
        result: "warning",
        detail: runnerOlder("0.1.1", carried),
        next: updateRunner("prod"),
      })

      // A deploy of images, as in feature 015: version 2, started.
      m.compose(COMPOSE_V1)
      const where = ["--app", "shop", "--server", "prod"]
      expect(await over(() => m.zekno("deploy", ...where))).toBe(0)
      const team = await openTeam(m.deps)
      const prod = team.profile.servers[0]!
      const sent = () => team.store.history(prod.serverId, "shop")
      expect(sent().map((entry) => entry.outcome)).toEqual(["started"])
      expect(readDeployEntry(sent()[0]!.envelope, team.trust)?.format).toBe(2)

      await over(() =>
        withSession(
          connect(prod.target, m.deps.localRunner),
          async (session) => {
            // A deploy that builds stops with F1 before anything is signed; one of images goes on.
            const choose = (builds: boolean) =>
              chooseFormat({
                server: "prod",
                mode: session.mode,
                runner: session.runner,
                carried,
                builds,
              })
            let stop: unknown
            try {
              choose(true)
            } catch (error) {
              stop = error
            }
            expect(stop).toBeInstanceOf(BuildStop)
            expect((stop as BuildStop).line).toEqual({
              id: "F1",
              server: "prod",
              version: "0.1.1",
            })
            expect(exitStatusOf("F1")).toBe(1)
            expect(choose(false)).toEqual({ format: 2 })

            // Handed a signed build anyway, runner 0.1.1 refuses it as malformed, from its strict schema.
            const recipe = {
              pack: {
                hash: "1".repeat(64),
                size: 10,
                chunks: ["2".repeat(64)],
              },
              builder: {
                name: "dockerfile" as const,
                dockerfile: "Dockerfile",
                target: null,
              },
              args: [],
              secrets: [],
              network: "default" as const,
              timeout: 1800,
              fresh: null,
            }
            const key = buildKey(recipe, [])
            const envelope = await team.withSigner((signer) =>
              createDeployV2({
                trust: team.trust,
                serverId: prod.serverId,
                app: "shop",
                previous: 1,
                compose: `services:\n  web:\n    image: "${builtImageName("shop", key)}"\n`,
                statements: [],
                removals: [],
                expiresAt: null,
                builds: [{ key, ...recipe }],
                signer,
              })
            )
            const refused = await session
              .request("deploy", RunnerReportSchema, {
                input: { rosters: team.profile.rosters, envelope, records: [] },
              })
              .catch((error: unknown) => error)
            expect(refused).toBeInstanceOf(RunnerRefused)
            expect((refused as RunnerRefused).reason).toBe("malformed")
            // zekno says it as F11: that runner is below protocol 6 (CL13).
            expect(session.runner?.protocol).toBeLessThan(6)
            expect(buildRefusal(refused, session.runner)).toMatchObject({
              line: { id: "F11" },
            })
          }
        )
      )
      // No number was used: the next deploy of images is number 2.
      m.compose(COMPOSE_V2)
      expect(await over(() => m.zekno("deploy", ...where))).toBe(0)
      expect(
        sent().map(
          (entry) =>
            readDeployEntry(entry.envelope, team.trust)?.deploy.sequence
        )
      ).toEqual([1, 2])
    },
    60_000
  )
})
