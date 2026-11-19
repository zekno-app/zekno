/**
 * The stand-in for Docker answers the calls of feature 015 as Docker 29 does,
 * as far as the runner reads them, can be scripted, and records each call in
 * order (contracts/runner.md, "Tests"). A call it is not told about still
 * behaves as `up` did before.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { runDocker } from "../../../src/docker/run"
import { tempDir } from "../helpers"
import { fakeDocker } from "./fake"

const saved = process.env.ZEKNO_DOCKER
afterEach(() => {
  if (saved === undefined) delete process.env.ZEKNO_DOCKER
  else process.env.ZEKNO_DOCKER = saved
})

function setUp() {
  const docker = fakeDocker()
  process.env.ZEKNO_DOCKER = docker.path
  const home = tempDir("stand-in")
  const call = (...args: string[]) => runDocker(home, args)
  return { docker, home, call }
}

describe("the stand-in for Docker", () => {
  test("compose ps -q lists a service's running containers, and inspect shows them", async () => {
    const { docker, call } = setUp()
    const ids = docker.app("web", { web: 2, worker: 1 })
    const listed = await call("compose", "-p", "zekno-web", "ps", "-q", "web")
    expect(listed.stdout.trim().split("\n").sort()).toEqual(ids.web!.sort())
    const shown = JSON.parse(
      (await call("inspect", "--type", "container", ids.worker![0]!)).stdout
    ) as { Config: { Labels: Record<string, string> } }[]
    expect(shown[0]!.Config.Labels["com.docker.compose.service"]).toBe("worker")
    const missing = await call("inspect", "--type", "container", "nope")
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain("No such container")
  })

  test("networks are made, joined with an alias, left and removed", async () => {
    const { docker, call } = setUp()
    const [id] = docker.app("web", { web: 1 }).web!
    expect((await call("network", "inspect", "zekno-route-web")).code).toBe(1)
    expect(
      (await call("network", "create", "--label", "a=b", "zekno-route-web"))
        .code
    ).toBe(0)
    await call("network", "connect", "--alias", "zabc", "zekno-route-web", id!)
    expect(
      (
        await call(
          "network",
          "connect",
          "--alias",
          "zdef",
          "zekno-route-web",
          id!
        )
      ).stderr
    ).toContain("already exists in network")
    expect(docker.model().containers[0]!.networks["zekno-route-web"]).toEqual({
      aliases: ["zabc"],
    })
    expect((await call("network", "rm", "zekno-route-web")).code).toBe(1)
    await call("network", "disconnect", "zekno-route-web", id!)
    expect((await call("network", "rm", "zekno-route-web")).code).toBe(0)
  })

  test("a proxy starts on its file, reloads on the signal, and keeps its log; each call is recorded in order", async () => {
    const { docker, home, call } = setUp()
    const etc = join(home, "etc")
    mkdirSync(etc)
    writeFileSync(join(etc, "caddy.json"), `{"n":"gen-0000000000000001"}`)
    await call(
      "run",
      "-d",
      "--name",
      "zekno-proxy",
      "--mount",
      `type=bind,source=${etc},target=/etc/zekno-proxy,readonly`,
      "caddy@sha256:x",
      "caddy",
      "run"
    )
    expect((await call("logs", "zekno-proxy")).stderr).toContain(
      "serving initial configuration"
    )
    writeFileSync(join(etc, "caddy.json"), `{"n":"gen-0000000000000002"}`)
    docker.script({ reloads: ["failed"] })
    await call("exec", "zekno-proxy", "kill", "-USR1", "1")
    expect(
      (
        await call(
          "exec",
          "zekno-proxy",
          "grep",
          "-q",
          "-F",
          "gen-0000000000000002",
          "/config/caddy/autosave.json"
        )
      ).code
    ).toBe(1)
    await call("exec", "zekno-proxy", "kill", "-USR1", "1")
    expect(
      (
        await call(
          "exec",
          "zekno-proxy",
          "grep",
          "-q",
          "-F",
          "gen-0000000000000002",
          "/config/caddy/autosave.json"
        )
      ).code
    ).toBe(0)
    const log = (await call("logs", "zekno-proxy")).stderr
    expect(log).toContain("failed to reload config from file")
    expect(log).toContain("successfully reloaded config from file")
    expect(docker.argv().map((argv) => argv.slice(0, 2).join(" "))).toEqual([
      "run -d",
      "logs zekno-proxy",
      "exec zekno-proxy",
      "exec zekno-proxy",
      "exec zekno-proxy",
      "exec zekno-proxy",
      "logs zekno-proxy",
    ])
    expect(docker.calls()).toHaveLength(7)
  })

  test("a run that cannot take its port leaves a container in Created, and a health check answers as told", async () => {
    const { docker, call } = setUp()
    docker.script({
      runFails: { code: 125, stderr: "port is already allocated", leave: true },
      curl: { web: "500|0" },
    })
    const failed = await call(
      "run",
      "-d",
      "--name",
      "zekno-proxy",
      "img",
      "caddy"
    )
    expect(failed).toMatchObject({
      code: 125,
      stderr: "port is already allocated",
    })
    expect(docker.model().containers[0]!.running).toBe(false)
    const [id] = docker.app("web", { web: 1 }).web!
    docker.network("zekno-route-web")
    await call("network", "connect", "--alias", "zname", "zekno-route-web", id!)
    const check = (url: string) =>
      call(
        "run",
        "--rm",
        "--network",
        "zekno-route-web",
        "img",
        "curl",
        "-w",
        "x",
        url
      )
    expect(await check("http://zname:80/health")).toMatchObject({
      code: 0,
      stdout: "500|0",
    })
    expect(await check("http://zother:80/health")).toMatchObject({
      code: 6,
      stdout: "000|6",
    })
  })

  test("a call it is not told about still behaves as up", async () => {
    const { docker, call } = setUp()
    docker.failWith(4)
    expect((await call("kill", "-s", "USR1", "zekno-proxy")).code).toBe(4)
    expect(docker.upFinished()).toBe(true)
    expect(docker.argv()).toEqual([])
  })
})
