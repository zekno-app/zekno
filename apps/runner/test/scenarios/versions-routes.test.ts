/**
 * Old and new programs with routes (specs/015-domains-https, US7; core.md,
 * "The state"): a version-1 deploy can never be taken for an app that holds a
 * domain; a state marked 2 is read and written as 3; the runner of feature
 * 014 put back on a folder this runner wrote refuses everything; and the
 * zekno of feature 014 stops before signing for this runner. The programs of
 * feature 014 are taken from this clone's history; those cases are skipped,
 * with the reason printed once, in a clone without it.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { leftAsItWas, olderState } from "../support/deploy-v2"
import {
  buildDeploy,
  fakeDocker,
  RUNNER_MAIN,
  runner,
  session,
  tempDir,
  world,
} from "../support/helpers"
import {
  DEPLOY_V2,
  olderRunner,
  olderTree,
  olderZekno,
} from "../support/older-programs"
import { ask, deployRoutes, route, stateOf } from "../support/routes"

const APP = route("app.example.com")
const tip = olderTree(DEPLOY_V2)
const stateFile = (home: string) => join(home, "state.json")

describe("a version-1 deploy and the routes in force (FR-036)", () => {
  test("a version-1 deploy for an app that holds a domain is unsupported_version, the state's bytes unchanged", async () => {
    const w = await world()
    olderState(w.home, { web: 1 })
    w.docker.app("web", { web: 1 })
    expect((await deployRoutes(w, 1, { routes: [APP] })).result.outcome).toBe(
      "started"
    )
    const before = leftAsItWas(w)
    const deploy = await buildDeploy({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      sequence: 3,
    })
    expect(
      (
        await runner(w.home, w.docker.path, "apply", {
          rosters: w.rosters,
          deploy,
        })
      ).json
    ).toEqual({ outcome: "refused", reason: "unsupported_version" })
    expect(leftAsItWas(w)).toEqual(before)
  })

  test("a version-1 deploy of another app held before keeps the routes in force", async () => {
    const w = await world()
    olderState(w.home, { web: 0, api: 1 })
    w.docker.app("web", { web: 1 })
    expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
      "started"
    )
    const routes = stateOf(w.home).routes
    const deploy = await buildDeploy({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      sequence: 2,
      app: "api",
    })
    expect(
      (
        await runner(w.home, w.docker.path, "apply", {
          rosters: w.rosters,
          deploy,
        })
      ).json
    ).toEqual({ outcome: "started", app: "api", sequence: 2 })
    expect(stateOf(w.home)).toMatchObject({ v: 3, routes })
  })
})

describe('a state marked 2 (core.md, "The state")', () => {
  test("is read with no routes and left as it is by reads; the first write marks it 3", async () => {
    const w = await world()
    const marked = JSON.parse(
      readFileSync(stateFile(w.home), "utf8")
    ) as Record<string, unknown>
    const { routes: _routes, ...rest } = marked
    writeFileSync(stateFile(w.home), JSON.stringify({ ...rest, v: 2 }))
    const bytes = readFileSync(stateFile(w.home), "utf8")

    expect(await ask(w, "status", { routes: true })).toMatchObject({
      routes: {},
      health: {},
      proxy: "none",
    })
    expect((await runner(w.home, w.docker.path, "status")).json).toMatchObject({
      serverId: w.serverId,
    })
    expect(readFileSync(stateFile(w.home), "utf8")).toBe(bytes)

    w.docker.app("web", { web: 1 })
    expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
      "started"
    )
    expect(stateOf(w.home)).toMatchObject({
      v: 3,
      lastSequence: { web: 1 },
      routes: { web: { routes: [APP] } },
    })
  })
})

describe("the programs of feature 014 beside this runner (US7)", () => {
  test.skipIf(tip === undefined)(
    "runner 014 put back on a folder this runner wrote refuses everything; this runner read what 014 wrote",
    async () => {
      const w = await world()
      const older = (command: string, message?: unknown) => {
        const child = Bun.spawn(
          [...olderRunner(tip!, w.docker.path), command],
          {
            env: { ...process.env, ZEKNO_RUNNER_HOME: w.home },
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
          }
        )
        if (message !== undefined) child.stdin.write(JSON.stringify(message))
        child.stdin.end()
        return new Response(child.stdout)
          .text()
          .then((text) => JSON.parse(text) as Record<string, unknown>)
      }
      // Runner 014 writes the state marked 2; this runner reads it, then writes mark 3.
      const marked = JSON.parse(
        readFileSync(stateFile(w.home), "utf8")
      ) as Record<string, unknown>
      const { routes: _routes, ...rest } = marked
      writeFileSync(stateFile(w.home), JSON.stringify({ ...rest, v: 2 }))
      expect(await older("status")).toMatchObject({ serverId: w.serverId })
      expect(await older("version")).toEqual({ version: "0.1.0", protocol: 3 })
      w.docker.app("web", { web: 1 })
      expect((await deployRoutes(w, 0, { routes: [APP] })).result.outcome).toBe(
        "started"
      )
      expect(stateOf(w.home).v).toBe(3)

      const bytes = readFileSync(stateFile(w.home), "utf8")
      const invalid = { outcome: "refused", reason: "invalid_state" }
      expect(await older("status")).toEqual(invalid)
      expect(await older("sync", { rosters: w.rosters })).toEqual(invalid)
      const s = session(
        w.home,
        w.docker.path,
        {},
        olderRunner(tip!, w.docker.path)
      )
      expect(
        (await s.request({ command: "records", input: { app: "web" } })).result
      ).toEqual(invalid)
      expect((await s.request({ command: "state" })).result).toEqual(invalid)
      expect((await s.close()).code).toBe(0)
      expect(readFileSync(stateFile(w.home), "utf8")).toBe(bytes)
    },
    60_000
  )

  test.skipIf(tip === undefined)(
    "the zekno of feature 014 stops before signing for this runner, with the sentence it has for a newer protocol",
    async () => {
      const zekno = await olderZekno(tip!)
      const docker = fakeDocker()
      const home = tempDir("tip-profile")
      const cwd = tempDir("tip-project")
      writeFileSync(
        join(cwd, "compose.yaml"),
        "services:\n  web:\n    image: example/web:1\n"
      )
      const out: string[] = []
      const err: string[] = []
      const deps = {
        home,
        cwd,
        keyStore: zekno.memoryKeyStore(),
        connect: zekno.connect,
        ui: zekno.plainUi(
          (line) => out.push(line),
          (line) => err.push(line)
        ),
        localRunner: [
          "env",
          `ZEKNO_DOCKER=${docker.path}`,
          process.execPath,
          RUNNER_MAIN,
        ],
      }
      expect(await zekno.run(["init", "--name", "Ada"], deps)).toBe(0)
      expect(await zekno.run(["server", "add", "dev", "--local"], deps)).toBe(0)
      const runnerHome = join(home, "runner", "dev")
      const before = readFileSync(join(runnerHome, "state.json"), "utf8")
      const code = await zekno.run(
        ["deploy", "--app", "web", "--server", "dev"],
        deps
      )
      expect(code).not.toBe(0)
      expect(err.at(-1)).toBe(
        "The runner on dev is version 0.1.0, newer than this zekno's 0.1.0, and speaks a newer protocol. Update zekno to deploy to dev. Nothing was signed."
      )
      // Nothing was signed, sent or started.
      expect(readFileSync(join(runnerHome, "state.json"), "utf8")).toBe(before)
      expect(docker.calls()).toEqual([])
    },
    60_000
  )
})
