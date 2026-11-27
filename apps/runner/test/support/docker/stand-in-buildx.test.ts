/**
 * The stand-in for Docker answers the calls that say whether Docker can
 * build (specs/016-build-from-source, T059; contracts/runner.md RB5, RB6,
 * RB17, "Tests" first bullet) in the format Docker 29 prints and the runner
 * reads, as its script says, and records each call in order. A call it is
 * not told about still behaves as `up` did before.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"

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
  const home = tempDir("stand-in-buildx")
  const call = (...args: string[]) => runDocker(home, args)
  return { docker, home, call }
}

/** What Docker 29 prints when the buildx plugin is not installed. */
const NO_BUILDX =
  "docker: unknown command: docker buildx\n\nRun 'docker --help' for more information\n"

describe("whether Docker can build (RB5)", () => {
  test("docker version --format json gives the engine's version and the server's architecture, as Docker 29 prints them", async () => {
    const { docker, call } = setUp()
    const first = await call("version", "--format", "json")
    expect(first.code).toBe(0)
    const shown = JSON.parse(first.stdout) as {
      Client: { Version: string; Arch: string }
      Server: {
        Version: string
        Arch: string
        Os: string
        Components: { Name: string; Version: string }[]
      }
    }
    expect(shown.Server).toMatchObject({
      Version: "29.6.1",
      Arch: "amd64",
      Os: "linux",
    })
    expect(shown.Server.Components[0]).toMatchObject({
      Name: "Engine",
      Version: "29.6.1",
    })
    expect(shown.Client.Version).toBe("29.6.1")

    // Each part of the script is kept, and a later one adds to it.
    docker.script({ docker: { engine: "29.4.3" } })
    docker.script({ docker: { arch: "aarch64" } })
    const later = JSON.parse(
      (await call("version", "--format", "json")).stdout
    ) as { Server: { Version: string; Arch: string } }
    expect(later.Server).toMatchObject({ Version: "29.4.3", Arch: "aarch64" })
    expect((await call("version", "--format", "{{.Server.Arch}}")).stdout).toBe(
      "aarch64\n"
    )
    docker.script({ docker: { arch: "s390x" } })
    expect(
      (await call("version", "--format={{.Server.Version}} {{.Server.Arch}}"))
        .stdout
    ).toBe("29.4.3 s390x\n")
  })

  test("with no engine answering, docker version prints the client's half and Docker's error, exit 1", async () => {
    const { docker, call } = setUp()
    docker.script({ docker: { engine: null } })
    const answer = await call("version", "--format", "json")
    expect(answer.code).toBe(1)
    expect(JSON.parse(answer.stdout)).toMatchObject({ Server: null })
    expect(answer.stderr).toContain(
      "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?"
    )
    expect((await call("info", "--format", "{{.DockerRootDir}}")).code).toBe(1)
  })

  test("docker buildx version prints buildx's one line; without the plugin, Docker's message and exit 1", async () => {
    const { docker, call } = setUp()
    const line = await call("buildx", "version")
    expect(line.code).toBe(0)
    expect(line.stdout).toMatch(
      /^github\.com\/docker\/buildx v0\.34\.1 [0-9a-f]{7}\n$/
    )
    docker.script({ docker: { buildx: "v0.35.0-desktop.2" } })
    expect((await call("buildx", "version")).stdout).toStartWith(
      "github.com/docker/buildx v0.35.0-desktop.2 "
    )
    docker.script({ docker: { buildx: null } })
    for (const args of [
      ["buildx", "version"],
      ["buildx", "inspect", "--builder", "default"],
      ["buildx", "build", "--help"],
      ["buildx", "prune", "--help"],
    ])
      expect(await call(...args)).toEqual({
        code: 1,
        stdout: "",
        stderr: NO_BUILDX,
      })
  })

  test("docker context show names the current context, and buildx inspect --builder that name gives its driver and BuildKit's version", async () => {
    const { docker, call } = setUp()
    expect(await call("context", "show")).toEqual({
      code: 0,
      stdout: "default\n",
      stderr: "",
    })
    const inspected = await call("buildx", "inspect", "--builder", "default")
    expect(inspected.code).toBe(0)
    const lines = inspected.stdout.split("\n")
    expect(lines).toContain("Name:          default")
    expect(lines).toContain("Driver:        docker")
    expect(lines).toContain("BuildKit version: v0.31.1")
    expect(lines).toContain("Status:           running")

    docker.script({
      docker: {
        context: "remote-1",
        driver: "docker-container",
        buildkit: "v0.26.3",
      },
    })
    expect((await call("context", "show")).stdout).toBe("remote-1\n")
    const container = (await call("buildx", "inspect", "--builder", "remote-1"))
      .stdout
    expect(container).toContain("Driver:        docker-container\n")
    expect(container).toContain("BuildKit version: v0.26.3\n")
    // Without --builder, buildx inspects the current context's builder.
    expect((await call("buildx", "inspect")).stdout).toContain(
      "Name:          remote-1\n"
    )
    expect(await call("buildx", "inspect", "--builder", "other")).toEqual({
      code: 1,
      stdout: "",
      stderr: 'ERROR: no builder "other" found\n',
    })
  })

  test("docker info gives DockerRootDir and MemTotal by template, and everything as JSON", async () => {
    const { docker, call } = setUp()
    expect(await call("info", "--format", "{{.DockerRootDir}}")).toEqual({
      code: 0,
      stdout: "/var/lib/docker\n",
      stderr: "",
    })
    expect((await call("info", "--format", "{{.MemTotal}}")).stdout).toBe(
      "8324206592\n"
    )
    docker.script({
      docker: { dockerRootDir: "/srv/docker", memTotal: 2_000_000_000 },
    })
    expect(
      (await call("info", "--format", "{{.DockerRootDir}} {{.MemTotal}}"))
        .stdout
    ).toBe("/srv/docker 2000000000\n")
    const all = JSON.parse((await call("info", "--format", "json")).stdout)
    expect(all).toMatchObject({
      DockerRootDir: "/srv/docker",
      MemTotal: 2_000_000_000,
      Architecture: "x86_64",
      OSType: "linux",
      ServerVersion: "29.6.1",
    })
    docker.script({ docker: { arch: "arm64" } })
    expect(
      (await call("info", "--format", "{{json .Architecture}}")).stdout
    ).toBe('"aarch64"\n')
    const unknown = await call("info", "--format", "{{.NoSuchField}}")
    expect(unknown.code).toBe(1)
    expect(unknown.stderr).toContain("NoSuchField")
  })

  test("the help texts list --policy and --max-used-space as the script says", async () => {
    const { docker, call } = setUp()
    const listed = (text: string, flag: string) =>
      new RegExp(`^\\s+${flag}\\b`, "m").test(text)
    const build = await call("buildx", "build", "--help")
    const prune = await call("buildx", "prune", "--help")
    expect(build.code).toBe(0)
    expect(build.stdout).toStartWith("\nUsage:  docker buildx build [OPTIONS]")
    expect(listed(build.stdout, "--policy")).toBe(true)
    expect(listed(build.stdout, "--metadata-file")).toBe(true)
    expect(listed(prune.stdout, "--max-used-space")).toBe(true)
    docker.script({ docker: { policy: false, maxUsedSpace: false } })
    const older = await call("buildx", "build", "--help")
    const olderPrune = await call("buildx", "prune", "--help")
    expect(listed(older.stdout, "--policy")).toBe(false)
    expect(listed(older.stdout, "--metadata-file")).toBe(true)
    expect(listed(olderPrune.stdout, "--max-used-space")).toBe(false)
    expect(listed(olderPrune.stdout, "--keep-storage")).toBe(true)
  })

  test("each call goes to argv.jsonl and to the call log, in order, beside the calls of feature 015", async () => {
    const { docker, home, call } = setUp()
    await call("version", "--format", "json")
    await call("network", "inspect", "zekno-route-web")
    await call("info", "--format", "{{.DockerRootDir}}")
    await call("context", "show")
    await call("buildx", "version")
    await call("buildx", "inspect", "--builder", "default")
    await call("buildx", "build", "--help")
    await call("buildx", "prune", "--help")
    const expected = [
      ["version", "--format", "json"],
      ["network", "inspect", "zekno-route-web"],
      ["info", "--format", "{{.DockerRootDir}}"],
      ["context", "show"],
      ["buildx", "version"],
      ["buildx", "inspect", "--builder", "default"],
      ["buildx", "build", "--help"],
      ["buildx", "prune", "--help"],
    ]
    expect(docker.argv()).toEqual(expected)
    const calls = docker.calls()
    expect(calls.map((each) => each.args)).toEqual(
      expected.map((args) => args.join(" "))
    )
    for (const each of calls) expect(each.cwd).toBe(realpathSync(home))
    expect(docker.upFinished()).toBe(false)
  })

  test("a call it is not told about still behaves as up", async () => {
    const { docker, call } = setUp()
    docker.failWith(4)
    for (const args of [
      ["context", "ls"],
      ["buildx", "ls"],
      ["buildx", "use", "other"],
      ["system", "df"],
    ])
      expect((await call(...args)).code).toBe(4)
    expect(docker.upFinished()).toBe(true)
    expect(docker.argv()).toEqual([])
    expect(docker.calls()).toHaveLength(4)
  })
})
