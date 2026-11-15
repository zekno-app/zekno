import { describe, expect, test } from "bun:test"
import { parseMessage, RunnerSetupResponseSchema, RunnerStatusSchema, serverConfirmationCode } from "@workspace/core"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { defaultHome, homeDir } from "../src/home"
import { buildDeploy, COMPOSE, fakeDocker, filesUnder, RUNNER_MAIN, runner, tempDir, world } from "./helpers"

describe("the runner", () => {
  test("sets itself up once: its own key, the team pinned by its code, private files", async () => {
    const { home, docker, setup, team } = await world()
    expect(setup.code).toBe(0)
    const answer = parseMessage(RunnerSetupResponseSchema, setup.json)
    expect(answer.ok).toBe(true)
    if (answer.ok) expect(answer.value.code).toBe(serverConfirmationCode(answer.value.serverPublicKey))

    expect(statSync(home).mode & 0o777).toBe(0o700)
    for (const name of ["server.key", "state.json"]) expect(statSync(join(home, name)).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(home, "server.key"), "utf8")).toStartWith("zk_ssk_")

    // A second setup, for this team or any other, is refused and changes nothing.
    const before = readFileSync(join(home, "server.key"), "utf8")
    const again = await runner(home, docker.path, "setup", { founding: team.envelope, teamCode: team.confirmationCode })
    expect(again.code).toBe(1)
    expect(again.json).toEqual({ outcome: "refused", reason: "already_set_up" })
    expect(readFileSync(join(home, "server.key"), "utf8")).toBe(before)
  })

  test("refuses to set up when the team code does not match the list it was given", async () => {
    const { team } = await world()
    const home = tempDir("runner")
    const result = await runner(home, fakeDocker().path, "setup", { founding: team.envelope, teamCode: "0000-0000-0000-0000-0000" })
    expect(result.json).toEqual({ outcome: "refused", reason: "code_mismatch" })
    expect(filesUnder(home)).toEqual([])
  })

  test("starts an accepted deploy with the secrets in Docker's environment and nowhere on disk", async () => {
    const { home, docker, trust, serverId, signer, rosters } = await world()
    const deploy = await buildDeploy({ trust, serverId, signer, sequence: 1, values: { GREETING: "hello from the test", PATH: "/tmp/evil", DOCKER_HOST: "tcp://attacker.example" } })
    const result = await runner(home, docker.path, "apply", { rosters, deploy })
    expect(result.code).toBe(0)
    expect(result.json).toEqual({ outcome: "started", app: "web", sequence: 1 })

    const [call] = docker.calls()
    expect(call!.args).toBe(`compose -p zekno-web -f ${join(home, "apps/web/compose.yaml")} up -d --remove-orphans`)
    expect(call!.env.GREETING).toBe("hello from the test")
    // Reserved names never override what Docker itself runs with.
    expect(call!.env.PATH).not.toBe("/tmp/evil")
    expect(call!.env.DOCKER_HOST).not.toBe("tcp://attacker.example")
    // The runner's own settings are not handed to the app.
    expect(call!.env.ZEKNO_RUNNER_HOME).toBeUndefined()

    expect(readFileSync(join(home, "apps/web/compose.yaml"), "utf8")).toBe(COMPOSE)
    for (const file of filesUnder(home)) expect(file.content).not.toContain("hello from the test")
  })

  test("reports what it holds, without values", async () => {
    const { home, docker, trust, serverId, signer, rosters } = await world()
    await runner(home, docker.path, "apply", { rosters, deploy: await buildDeploy({ trust, serverId, signer, sequence: 1 }) })
    const result = await runner(home, docker.path, "status")
    const status = parseMessage(RunnerStatusSchema, result.json)
    expect(status.ok).toBe(true)
    if (!status.ok) return
    expect(status.value.serverId).toBe(serverId)
    expect(status.value.team.version).toBe(2)
    expect(status.value.lastSequence).toEqual({ web: 1 })
    expect(status.value.secrets).toEqual({ "web/GREETING": { version: 1, removed: false } })
    expect(result.stdout).not.toContain("hello from the test")
  })

  test("when the app does not start, the deploy is still accepted and its number is used", async () => {
    const { home, docker, trust, serverId, signer, rosters } = await world()
    docker.failWith(1)
    const deploy = await buildDeploy({ trust, serverId, signer, sequence: 1 })
    const failed = await runner(home, docker.path, "apply", { rosters, deploy })
    expect(failed.code).toBe(1)
    expect(failed.json).toEqual({ outcome: "start_failed", app: "web", sequence: 1 })
    // The same deploy cannot be delivered again.
    expect((await runner(home, docker.path, "apply", { rosters, deploy })).json).toEqual({ outcome: "refused", reason: "replayed" })
  })

  test("a missing Docker is a failed start, not a crash", async () => {
    const { home, trust, serverId, signer, rosters } = await world()
    const result = await runner(home, "/nonexistent/docker", "apply", { rosters, deploy: await buildDeploy({ trust, serverId, signer, sequence: 1 }) })
    expect(result.json).toEqual({ outcome: "start_failed", app: "web", sequence: 1 })
  })

  test("never acts on damaged or missing state", async () => {
    const { home, docker, trust, serverId, signer, rosters } = await world()
    const deploy = await buildDeploy({ trust, serverId, signer, sequence: 1 })
    const state = join(home, "state.json")
    const good = readFileSync(state, "utf8")

    const parsed = JSON.parse(good) as Record<string, unknown>
    delete parsed.secrets
    for (const damaged of ["", "{", "null", "[]", JSON.stringify(parsed), JSON.stringify({ ...JSON.parse(good), lastSequence: { web: "9" } })]) {
      writeFileSync(state, damaged)
      expect((await runner(home, docker.path, "apply", { rosters, deploy })).json).toEqual({ outcome: "refused", reason: "invalid_state" })
      expect((await runner(home, docker.path, "status")).json).toEqual({ outcome: "refused", reason: "invalid_state" })
    }
    expect(docker.calls()).toEqual([])
    writeFileSync(state, good)
    expect((await runner(home, docker.path, "apply", { rosters, deploy })).json?.outcome).toBe("started")
  })

  test("a runner that was never set up says so", async () => {
    const home = tempDir("runner")
    const docker = fakeDocker()
    for (const command of ["status", "sync", "apply"]) {
      const result = await runner(home, docker.path, command, command === "status" ? undefined : { rosters: [] })
      expect(result.json?.outcome).toBe("refused")
      expect(["not_set_up", "invalid_request"]).toContain(String(result.json?.reason))
    }
    expect((await runner(home, docker.path, "status")).json).toEqual({ outcome: "refused", reason: "not_set_up" })
  })

  test("one run at a time: a held lock reports busy, a stale lock is taken over", async () => {
    const { home, docker, trust, serverId, signer, rosters } = await world()
    const deploy = await buildDeploy({ trust, serverId, signer, sequence: 1 })
    writeFileSync(join(home, "lock"), String(process.pid)) // this test process is alive
    expect((await runner(home, docker.path, "apply", { rosters, deploy })).json).toEqual({ outcome: "refused", reason: "busy" })
    writeFileSync(join(home, "lock"), "999999") // no such process
    expect((await runner(home, docker.path, "apply", { rosters, deploy })).json?.outcome).toBe("started")
    expect(filesUnder(home).some((file) => file.path.endsWith("/lock"))).toBe(false)
  })

  test("wrong usage exits with status 2 and prints nothing on standard output", async () => {
    const { home, docker } = await world()
    for (const args of [["nonsense"], ["apply", "extra"]]) {
      const result = await runner(home, docker.path, args[0]!, undefined, args.slice(1))
      expect(result.code).toBe(2)
      expect(result.stdout).toBe("")
    }
  })
})

describe("the runner's folder", () => {
  const USER = "/home/deploy/.local/state/zekno"

  test("root always uses /var/lib/zekno", () => {
    for (const userFolderSetUp of [false, true]) {
      for (const ownsSystemFolder of [false, true]) {
        expect(defaultHome({ isRoot: true, userHome: "/root", userFolderSetUp, ownsSystemFolder })).toBe("/var/lib/zekno")
      }
    }
  })

  test("a user whose own folder is set up keeps it, even when a system folder appears later, theirs or not", () => {
    expect(defaultHome({ isRoot: false, userHome: "/home/deploy", userFolderSetUp: true, ownsSystemFolder: false })).toBe(USER)
    expect(defaultHome({ isRoot: false, userHome: "/home/deploy", userFolderSetUp: true, ownsSystemFolder: true })).toBe(USER)
  })

  test("a server set up by an earlier version keeps /var/lib/zekno when it belongs to the user running the runner", () => {
    expect(defaultHome({ isRoot: false, userHome: "/home/deploy", userFolderSetUp: false, ownsSystemFolder: true })).toBe("/var/lib/zekno")
  })

  test("anyone else uses a folder in their own home, also when /var/lib/zekno exists but belongs to someone else", () => {
    // `ownsSystemFolder` is false both when the folder is missing and when root or another user owns it.
    expect(defaultHome({ isRoot: false, userHome: "/home/deploy", userFolderSetUp: false, ownsSystemFolder: false })).toBe(USER)
  })

  test("ZEKNO_RUNNER_HOME wins when it is set", () => {
    const saved = process.env.ZEKNO_RUNNER_HOME
    try {
      process.env.ZEKNO_RUNNER_HOME = "/srv/zekno"
      expect(homeDir()).toBe("/srv/zekno")
      // Set but empty counts as not set.
      process.env.ZEKNO_RUNNER_HOME = ""
      expect(homeDir()).not.toBe("")
    } finally {
      if (saved === undefined) delete process.env.ZEKNO_RUNNER_HOME
      else process.env.ZEKNO_RUNNER_HOME = saved
    }
  })

  // Only where running it cannot touch a real runner's folder: not as root, and not when /var/lib/zekno is this user's.
  const systemFolderInPlay = process.getuid?.() === 0 || (existsSync("/var/lib/zekno") && statSync("/var/lib/zekno").uid === process.getuid?.())
  test.skipIf(systemFolderInPlay)("without ZEKNO_RUNNER_HOME, a user who is not root sets up in ~/.local/state/zekno", async () => {
    const { team } = await world()
    const home = tempDir("user-home")
    const env: Record<string, string | undefined> = { ...process.env, HOME: home, ZEKNO_DOCKER: fakeDocker().path }
    delete env.ZEKNO_RUNNER_HOME
    const child = Bun.spawn([process.execPath, RUNNER_MAIN, "setup"], { env, stdin: "pipe", stdout: "pipe", stderr: "pipe" })
    child.stdin.write(JSON.stringify({ founding: team.envelope, teamCode: team.confirmationCode }))
    child.stdin.end()
    const stdout = await new Response(child.stdout).text()
    expect(await child.exited).toBe(0)
    expect(JSON.parse(stdout).serverId).toStartWith("srv_")

    const folder = join(home, ".local", "state", "zekno")
    expect(statSync(folder).mode & 0o777).toBe(0o700)
    expect(readFileSync(join(folder, "server.key"), "utf8")).toStartWith("zk_ssk_")
  })
})
