/**
 * Old and new programs together (specs/014-deploy-v2, US4; research R22):
 * runner 0.1.0 and the zekno from before version 2, each taken from this
 * clone's history, beside the runner of this repository. Every case is
 * skipped, with the reason printed once, in a clone without that history.
 */
import { describe, expect, test } from "bun:test"
import {
  createSigner,
  createTeam,
  generateMemberKeyPair,
  proposeRoster,
} from "@workspace/core"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { buildDeployV2, deployV2, recordsOf } from "../support/deploy-v2"
import {
  buildDeploy,
  fakeDocker,
  runner,
  session,
  tempDir,
} from "../support/helpers"
import {
  BEFORE,
  OLDER_RUNNER,
  olderRunner,
  olderTree,
  olderZekno,
} from "../support/older-programs"

const runnerTree = olderTree(OLDER_RUNNER)
const zeknoTree = olderTree(BEFORE)

/** Runs one command of runner 0.1.0 as its own process, the way SSH would. */
async function olderOnce(
  tree: string,
  home: string,
  docker: string,
  command: string,
  message?: unknown
) {
  const child = Bun.spawn([...olderRunner(tree, docker), command], {
    env: { ...process.env, ZEKNO_RUNNER_HOME: home },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (message !== undefined) child.stdin.write(JSON.stringify(message))
  child.stdin.end()
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code: await child.exited, stdout, stderr }
}

describe("the older programs, from git", () => {
  test.skipIf(runnerTree === undefined)(
    "runner 0.1.0 says it is 0.1.0 and speaks protocol 2",
    async () => {
      const run = await olderOnce(
        runnerTree!,
        tempDir("older-runner"),
        fakeDocker().path,
        "version"
      )
      expect(run).toMatchObject({
        code: 0,
        stdout: `${JSON.stringify({ version: "0.1.0", protocol: 2 })}\n`,
      })
    }
  )

  test.skipIf(zeknoTree === undefined || runnerTree === undefined)(
    "the zekno from before version 2 runs in this process and says its versions",
    async () => {
      const zekno = await olderZekno(zeknoTree!)
      const out: string[] = []
      const err: string[] = []
      const code = await zekno.run(["--version"], {
        home: tempDir("older-profile"),
        cwd: tempDir("older-cwd"),
        keyStore: zekno.memoryKeyStore(),
        connect: zekno.connect,
        ui: zekno.plainUi(
          (line) => out.push(line),
          (line) => err.push(line)
        ),
        localRunner: olderRunner(runnerTree!, fakeDocker().path),
      })
      expect({ code, err }).toEqual({ code: 0, err: [] })
      expect(out).toEqual([
        "zekno 0.1.0",
        "runner 0.1.0, the runner release this zekno installs",
      ])
    }
  )
})

/**
 * A team and a server set up by runner 0.1.0, which also accepted deploy 1 of
 * `web`, all through its own one-shot commands, as a zekno from before this
 * feature drives it.
 */
async function setUpByOlderRunner(tree: string) {
  const signer = createSigner(generateMemberKeyPair().secretKey)
  const team = await createTeam({ founderName: "Ada", signer })
  const home = tempDir("runner")
  const docker = fakeDocker()
  const older = (command: string, message?: unknown) =>
    olderOnce(tree, home, docker.path, command, message).then((run) => ({
      ...run,
      json: JSON.parse(run.stdout) as Record<string, unknown>,
    }))

  const setup = await older("setup", {
    founding: team.envelope,
    teamCode: team.confirmationCode,
  })
  const serverId = String(setup.json.serverId)
  const added = await proposeRoster({
    trust: team.trust,
    servers: [
      { name: "prod-1", publicKey: setup.json.serverPublicKey as never },
    ],
    signer,
  })
  const rosters = [team.envelope, added.envelope]
  expect((await older("sync", { rosters })).json).toEqual({ outcome: "ok" })
  const first = await buildDeploy({
    trust: added.trust,
    serverId,
    signer,
    sequence: 1,
  })
  expect((await older("apply", { rosters, deploy: first })).json).toEqual({
    outcome: "started",
    app: "web",
    sequence: 1,
  })
  return {
    signer,
    team,
    trust: added.trust,
    rosters,
    home,
    docker,
    serverId,
    older,
    stateFile: () => readFileSync(join(home, "state.json"), "utf8"),
  }
}

/** Runner 0.1.0 put back on a folder this runner has written: it refuses every request that reads the state. */
async function olderRefusesEverything(
  tree: string,
  w: Awaited<ReturnType<typeof setUpByOlderRunner>>
) {
  const bytes = w.stateFile()
  const calls = w.docker.calls().length
  const invalid = { outcome: "refused", reason: "invalid_state" }
  expect((await w.older("status")).json).toEqual(invalid)
  expect((await w.older("sync", { rosters: w.rosters })).json).toEqual(invalid)
  const deploy = await buildDeploy({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    sequence: 9,
  })
  expect((await w.older("apply", { rosters: w.rosters, deploy })).json).toEqual(
    invalid
  )
  const s = session(w.home, w.docker.path, {}, olderRunner(tree, w.docker.path))
  expect((await s.request({ command: "state" })).result).toEqual(invalid)
  expect(
    (await s.request({ command: "logs", input: { app: "web", tail: 10 } }))
      .result
  ).toEqual(invalid)
  expect((await s.close()).code).toBe(0)
  expect(
    (
      await w.older("setup", {
        founding: w.team.envelope,
        teamCode: w.team.confirmationCode,
      })
    ).json
  ).toEqual({ outcome: "refused", reason: "already_set_up" })
  // It never read the state as empty, wrote nothing and started nothing.
  expect(w.stateFile()).toBe(bytes)
  expect(w.docker.calls()).toHaveLength(calls)
}

describe("runner 0.1.0 and this runner on one folder (ST9, ST10, FR-034, US4 scenario 5)", () => {
  test.skipIf(runnerTree === undefined)(
    "this runner reads what 0.1.0 wrote without writing; after its first write, a deploy, 0.1.0 refuses everything",
    async () => {
      const w = await setUpByOlderRunner(runnerTree!)
      const written = w.stateFile()

      // Reads write nothing, so runner 0.1.0 put back now still reads the state.
      const status = await runner(w.home, w.docker.path, "status")
      expect(status.json).toMatchObject({
        serverId: w.serverId,
        lastSequence: { web: 1 },
        secrets: { "web/GREETING": { version: 1, removed: false } },
      })
      expect(await recordsOf(w, "web")).toEqual({ statements: [] })
      expect(w.stateFile()).toBe(written)
      expect((await w.older("status")).json).toEqual(status.json!)

      // This runner's first write: the app's first deploy of version 2, after the one 0.1.0 accepted.
      const next = await buildDeployV2({
        trust: w.trust,
        serverId: w.serverId,
        signer: w.signer,
        previous: 1,
      })
      expect(
        (await deployV2(w, { rosters: w.rosters, ...next })).result
      ).toEqual({ outcome: "started", app: "web", sequence: 2 })
      expect(JSON.parse(w.stateFile())).toMatchObject({
        v: 5,
        formats: { web: 2 },
      })

      await olderRefusesEverything(runnerTree!, w)
    },
    30_000
  )

  test.skipIf(runnerTree === undefined)(
    "after this runner's first write is a sync of a newer team list, 0.1.0 refuses everything too",
    async () => {
      const w = await setUpByOlderRunner(runnerTree!)
      const newer = await proposeRoster({ trust: w.trust, signer: w.signer })
      w.rosters.push(newer.envelope)
      w.trust = newer.trust
      expect(
        (await runner(w.home, w.docker.path, "sync", { rosters: w.rosters }))
          .json
      ).toEqual({ outcome: "ok" })
      expect(JSON.parse(w.stateFile())).toMatchObject({
        v: 5,
        formats: { web: 1 },
      })
      await olderRefusesEverything(runnerTree!, w)
    },
    30_000
  )
})
