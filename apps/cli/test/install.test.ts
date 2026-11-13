import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, truncateSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../runner/test/helpers"
import {
  followsOrder,
  INSTALL_SCRIPT,
  INSTALL_UNEXPECTED,
  installWords,
  NO_RELEASE,
  parseInstallLine,
  readRunnerFile,
  releaseFiles,
  RUNNER_FILE_LIMIT,
  RUNNER_PATHS,
  runInstaller,
  unreachable,
  type InstallEvent,
  type InstallRequest,
} from "../src/install"
import { releaseUrl, RUNNER_RELEASE } from "../src/runner-release"
import { connect, type RunnerProcess, type Transport } from "../src/transport"
import { fakeRunner, sha256, sshStandIn, standInServer, withSsh } from "./stand-in-server"

const VERSION = RUNNER_RELEASE.version
const OTHER = "0".repeat(64)

/** The shells the script is run with: this machine's `sh`, and `dash` where there is one (Debian's and Ubuntu's `sh`). */
const SHELLS = ["/bin/sh", ...(existsSync("/bin/dash") ? ["/bin/dash"] : [])]

/** What a fresh install says, step by step. */
const freshInstall = (bytes: number, place = "user") => [
  "connected",
  "docker ok 2.40.3",
  "runner none",
  "platform ok x64",
  `download ok ${bytes}`,
  "checksum ok",
  "install ok",
  "version ok",
  "folder ok",
  `done ${place}`,
]

describe("the script, run with sh against stand-ins", () => {
  test("we know which shells it was run with", () => {
    // Recorded for the report: dash was there on the machine these tests were written on.
    expect(SHELLS[0]).toBe("/bin/sh")
  })

  for (const shell of SHELLS) {
    describe(shell, () => {
      test("a fresh install as a user who is not root: ~/.local/bin/zekno-runner with mode 755, the folder with 700, then the session on the same connection", async () => {
        const server = standInServer()
        const runner = fakeRunner(VERSION)
        const sha = server.release(runner)
        const run = await server.run(["add", VERSION, "release", "x64", sha, "arm64", OTHER], { shell, afterDone: "first request\n" })
        expect(run.lines).toEqual([...freshInstall(runner.length), "session", "got first request"])
        expect(run.code).toBe(0)
        expect(readFileSync(server.runnerPath, "utf8")).toBe(runner)
        expect(server.mode(server.runnerPath)).toBe(0o755)
        expect(server.mode(server.folder)).toBe(0o700)
        expect(server.leftovers()).toEqual([])
        // It downloaded the address this CLI names, over HTTPS only, redirects to HTTPS only.
        const [curl] = server.calls("curl")
        expect(curl).toContain("--proto =https --proto-redir =https")
        expect(curl?.endsWith(releaseUrl(VERSION, "x64"))).toBe(true)
      })

      test("ARM64 gets the ARM64 file and its checksum", async () => {
        const server = standInServer()
        server.uname("Linux aarch64")
        const runner = fakeRunner(VERSION)
        const run = await server.run(["add", VERSION, "release", "x64", OTHER, "arm64", server.release(runner)], { shell })
        expect(run.lines).toContain("platform ok arm64")
        expect(run.lines).toContain("install ok")
        expect(server.calls("curl")[0]?.endsWith(releaseUrl(VERSION, "arm64"))).toBe(true)
      })

      test("a runner already at this version is kept as it is, and nothing is downloaded", async () => {
        const server = standInServer()
        const runner = `${fakeRunner(VERSION)}# installed earlier\n`
        server.installed(runner)
        const run = await server.run(["add", VERSION, "release", "x64", server.release(fakeRunner(VERSION))], { shell })
        expect(run.lines.slice(0, 6)).toEqual(["connected", "docker ok 2.40.3", `runner found user ${VERSION}`, "version ok", "folder ok", "done user"])
        expect(readFileSync(server.runnerPath, "utf8")).toBe(runner)
        expect(server.calls("curl")).toEqual([])
      })

      test("an older runner, or one that does not say its version, is used as it is: never updated unasked", async () => {
        for (const [version, said] of [
          ["0.1.0", "0.1.0"],
          [undefined, "unknown"],
        ] as const) {
          const server = standInServer()
          const runner = fakeRunner(version)
          server.installed(runner)
          const run = await server.run(["add", VERSION, "release", "x64", server.release(fakeRunner(VERSION))], { shell })
          expect(run.lines.slice(0, 5)).toEqual(["connected", "docker ok 2.40.3", `runner found user ${said}`, "folder ok", "done user"])
          expect(readFileSync(server.runnerPath, "utf8")).toBe(runner)
          expect(server.calls("curl")).toEqual([])
        }
      })

      test("no Docker, or Docker without Compose: it stops there and installs nothing", async () => {
        const noDocker = standInServer()
        noDocker.remove("docker")
        const sha = noDocker.release(fakeRunner(VERSION))
        expect((await noDocker.run(["add", VERSION, "release", "x64", sha], { shell })).lines).toEqual(["connected", "fail docker"])
        const noCompose = standInServer()
        noCompose.noCompose()
        const run = await noCompose.run(["add", VERSION, "release", "x64", noCompose.release(fakeRunner(VERSION))], { shell })
        expect(run.lines).toEqual(["connected", "fail docker"])
        expect(run.code).toBe(1)
        for (const server of [noDocker, noCompose]) {
          expect(existsSync(server.runnerPath)).toBe(false)
          expect(server.calls("curl")).toEqual([])
        }
      })

      test("an unsupported processor or a system that is not Linux: it stops before downloading", async () => {
        for (const uname of ["Linux mips64", "Linux armv7l", "Darwin arm64", "FreeBSD amd64"]) {
          const server = standInServer()
          server.uname(uname)
          const run = await server.run(["add", VERSION, "release", "x64", server.release(fakeRunner(VERSION))], { shell })
          expect(run.lines).toEqual(["connected", "docker ok 2.40.3", "runner none", "fail platform"])
          expect(existsSync(server.runnerPath)).toBe(false)
          expect(server.calls("curl")).toEqual([])
        }
      })

      test("no published checksum for this processor: it stops, and downloads nothing", async () => {
        const server = standInServer()
        const run = await server.run(["add", VERSION, "release", "arm64", server.release(fakeRunner(VERSION))], { shell })
        expect(run.lines).toEqual(["connected", "docker ok 2.40.3", "runner none", "platform ok x64", "fail release"])
        expect(server.calls("curl")).toEqual([])
        expect(server.leftovers()).toEqual([])
      })

      test("a download that fails: nothing is installed and nothing is left behind", async () => {
        const server = standInServer()
        server.fetch("fail")
        const run = await server.run(["add", VERSION, "release", "x64", server.release(fakeRunner(VERSION))], { shell })
        expect(run.lines.at(-1)).toBe("fail download")
        expect(run.stderr).toContain("Could not resolve host")
        expect(existsSync(server.runnerPath)).toBe(false)
        expect(server.leftovers()).toEqual([])
      })

      test("a checksum that does not match: the file is deleted, nothing is installed and the temporary folder is gone", async () => {
        const server = standInServer()
        server.release(fakeRunner(VERSION))
        const run = await server.run(["add", VERSION, "release", "x64", sha256("something else")], { shell })
        expect(run.lines.slice(-2)).toEqual([`download ok ${fakeRunner(VERSION).length}`, "fail checksum"])
        expect(existsSync(server.runnerPath)).toBe(false)
        expect(existsSync(server.folder)).toBe(false)
        expect(server.leftovers()).toEqual([])
      })

      test("a redirect to plain HTTP is not followed, by curl or by wget", async () => {
        const viaCurl = standInServer()
        viaCurl.fetch("redirect-http")
        const curl = await viaCurl.run(["add", VERSION, "release", "x64", viaCurl.release(fakeRunner(VERSION))], { shell })
        expect(curl.lines.at(-1)).toBe("fail download")
        expect(existsSync(viaCurl.runnerPath)).toBe(false)

        const viaWget = standInServer()
        viaWget.remove("curl")
        viaWget.fetch("redirect-http")
        const wget = await viaWget.run(["add", VERSION, "release", "x64", viaWget.release(fakeRunner(VERSION))], { shell })
        expect(wget.lines.at(-1)).toBe("fail download")
        expect(viaWget.wgetUrls()).toEqual([releaseUrl(VERSION, "x64")])
        expect(existsSync(viaWget.runnerPath)).toBe(false)
        expect(viaWget.leftovers()).toEqual([])
      })

      test("wget follows a redirect to HTTPS, one hop at a time, and the file is checked as any other", async () => {
        const server = standInServer()
        server.remove("curl")
        const runner = fakeRunner(VERSION)
        const run = await server.run(["add", VERSION, "release", "x64", server.release(runner)], { shell })
        expect(run.lines).toEqual([...freshInstall(runner.length), "session"])
        expect(server.wgetUrls()).toEqual([releaseUrl(VERSION, "x64"), "https://objects.example/zekno-runner.gz"])
        expect(server.calls("wget")[0]).toContain("--max-redirect=0")
      })

      test("neither sha256sum nor shasum: nothing is installed", async () => {
        const server = standInServer()
        server.remove("sha256sum")
        const run = await server.run(["add", VERSION, "release", "x64", server.release(fakeRunner(VERSION))], { shell })
        expect(run.lines.at(-1)).toBe("fail tools")
        expect(existsSync(server.runnerPath)).toBe(false)
        expect(server.leftovers()).toEqual([])
      })

      test("--runner-file: the file is sent after `ready` and checked on arrival", async () => {
        const server = standInServer()
        const runner = fakeRunner(VERSION)
        const bytes = new TextEncoder().encode(runner)
        const run = await server.run(["add", VERSION, "file", sha256(bytes)], { shell, file: bytes })
        expect(run.lines).toEqual([
          "connected",
          "docker ok 2.40.3",
          "runner none",
          "platform ok x64",
          "ready",
          `download ok ${bytes.length}`,
          "checksum ok",
          "install ok",
          "version ok",
          "folder ok",
          "done user",
        ])
        expect(run.code).toBe(0)
        expect(readFileSync(server.runnerPath, "utf8")).toBe(runner)
        expect(server.calls("curl")).toEqual([])
      })

      test("--runner-file changed in transit: it does not match, and nothing is installed", async () => {
        const server = standInServer()
        const sent = new TextEncoder().encode(fakeRunner(VERSION))
        const changed = new TextEncoder().encode(fakeRunner(VERSION).replace("session", "sessiom"))
        const run = await server.run(["add", VERSION, "file", sha256(sent)], { shell, file: changed })
        expect(run.lines.at(-1)).toBe("fail checksum")
        expect(existsSync(server.runnerPath)).toBe(false)
        expect(server.leftovers()).toEqual([])
      })

      test("a runner that installs but does not answer with this version is reported", async () => {
        const server = standInServer()
        const run = await server.run(["add", VERSION, "release", "x64", server.release(fakeRunner("9.9.9"))], { shell })
        expect(run.lines.slice(-2)).toEqual(["install ok", "fail version"])
      })

      test("update: an older runner is replaced in place; one at this version is left; a missing one is said", async () => {
        const server = standInServer()
        server.installed(fakeRunner("0.1.0"))
        const runner = fakeRunner(VERSION)
        const sha = server.release(runner)
        const run = await server.run(["update", VERSION, server.runnerPath, "release", "x64", sha], { shell })
        expect(run.lines).toEqual([
          "connected",
          "docker ok 2.40.3",
          "runner found target 0.1.0",
          "platform ok x64",
          `download ok ${runner.length}`,
          "checksum ok",
          "install ok",
          "version ok",
          "folder ok",
          "done target",
        ])
        expect(readFileSync(server.runnerPath, "utf8")).toBe(runner)
        expect(server.mode(server.runnerPath)).toBe(0o755)

        const again = await server.run(["update", VERSION, server.runnerPath, "release", "x64", sha], { shell })
        expect(again.lines).toEqual(["connected", "docker ok 2.40.3", `runner found target ${VERSION}`, "version ok", "folder ok", "done target"])
        expect(server.calls("curl")).toHaveLength(1)

        const missing = await server.run(["update", VERSION, join(server.home, "nowhere", "zekno-runner"), "release", "x64", sha], { shell })
        expect(missing.lines.at(-1)).toBe("fail missing")
      })

      test("update through `~/`, as the profile keeps a runner the installer put in a home folder", async () => {
        const server = standInServer()
        server.installed(fakeRunner("0.1.0"))
        const runner = fakeRunner(VERSION)
        const run = await server.run(["update", VERSION, RUNNER_PATHS.user, "release", "x64", server.release(runner)], { shell })
        expect(run.lines.at(-1)).toBe("done target")
        expect(readFileSync(server.runnerPath, "utf8")).toBe(runner)
      })

      test("words that do not fit are refused by the script itself, before it looks at anything", async () => {
        const server = standInServer()
        const sha = server.release(fakeRunner(VERSION))
        for (const words of [
          ["add", "0.2", "release"],
          ["add", "0.2.0.1", "release"],
          ["add", "1..2", "release"],
          ["add", VERSION, "release", "x86", sha],
          ["add", VERSION, "release", "x64", sha.toUpperCase()],
          ["add", VERSION, "release", "x64", sha.slice(1)],
          ["add", VERSION, "release", "x64"],
          ["add", VERSION, "elsewhere"],
          ["update", VERSION, "-rf", "release"],
          ["remove", VERSION, "release"],
        ]) {
          const run = await server.run(words, { shell })
          expect({ words, lines: run.lines }).toEqual({ words, lines: ["connected", "fail usage"] })
        }
        expect(server.calls("docker")).toEqual([])
      })
    })
  }

  test("its text has nothing a template could have put in it: no `${`, no backquote", () => {
    const source = readFileSync(join(import.meta.dir, "../src/install.ts"), "utf8")
    const start = source.indexOf("String.raw`") + "String.raw`".length
    const text = source.slice(start, source.indexOf("`", start))
    expect(text).toBe(INSTALL_SCRIPT)
    expect(text).not.toContain("${")
    expect(text).not.toContain("sudo")
    expect(text.startsWith("{\n")).toBe(true)
    expect(text.endsWith("\n}\n")).toBe(true)
    // The address it downloads from is the one this CLI names, with nothing but the version and the architecture varying.
    expect(text).toContain("url=https://github.com/zekno-app/zekno-monorepo/releases/download/runner-v$version/zekno-runner-linux-$arch.gz")
    expect(releaseUrl("1.2.3", "arm64")).toBe("https://github.com/zekno-app/zekno-monorepo/releases/download/runner-v1.2.3/zekno-runner-linux-arm64.gz")
  })
})

// ---------------------------------------------------------------------------
// What is placed into it

const release = (files: InstallRequest["source"]): InstallRequest => ({ mode: "add", version: VERSION, source: files })
const SHA = "a".repeat(64)

/** Inputs that must never reach a script: shell syntax of every kind, a line break, a leading dash. */
const HOSTILE = ["$(touch /tmp/pwned)", "`touch /tmp/pwned`", "'; rm -rf ~; '", '"quoted"', "a b", "x\ny", "-rf", "x;y", "x|y", "x&y", "x>y", "*", "", "\u001b[2J"]

describe("what is placed into the script", () => {
  test("the words for each kind of install", () => {
    expect(installWords(release({ kind: "release", files: [{ arch: "x64", sha256: SHA }] }))).toEqual(["add", VERSION, "release", "x64", SHA])
    expect(installWords(release({ kind: "release", files: [] }))).toEqual(["add", VERSION, "release"])
    expect(installWords(release({ kind: "file", file: { bytes: new Uint8Array(1), sha256: SHA } }))).toEqual(["add", VERSION, "file", SHA])
    expect(
      installWords({ mode: "update", version: VERSION, runnerPath: "~/.local/bin/zekno-runner", source: { kind: "release", files: [{ arch: "arm64", sha256: SHA }] } })
    ).toEqual(["update", VERSION, "~/.local/bin/zekno-runner", "release", "arm64", SHA])
  })

  test("each of the four values that does not fit its pattern throws before anything is placed", () => {
    const versions = [...HOSTILE, "1.2", "1.2.3.4", "v1.2.3", "1.2.3-rc1", "01.2.3x"]
    for (const version of versions) {
      expect(() => installWords({ mode: "add", version, source: { kind: "release", files: [] } })).toThrow("The version for the installer is not valid")
    }
    for (const arch of [...HOSTILE, "x86", "X64", "amd64", "x64 "]) {
      expect(() => installWords(release({ kind: "release", files: [{ arch: arch as "x64", sha256: SHA }] }))).toThrow("The architecture for the installer is not valid")
    }
    for (const sha of [...HOSTILE, SHA.toUpperCase(), SHA.slice(1), `${SHA}0`, `${SHA.slice(1)}g`]) {
      expect(() => installWords(release({ kind: "release", files: [{ arch: "x64", sha256: sha }] }))).toThrow("The SHA-256 for the installer is not valid")
      expect(() => installWords(release({ kind: "file", file: { bytes: new Uint8Array(1), sha256: sha } }))).toThrow("The SHA-256 for the installer is not valid")
    }
    for (const runnerPath of [...HOSTILE, "-x", "--help", "~user/$(x)"]) {
      expect(() => installWords({ mode: "update", version: VERSION, runnerPath, source: { kind: "release", files: [] } })).toThrow(
        "The runner path for the installer is not valid"
      )
    }
  })

  test("a value that does not fit never reaches a script: nothing is started", async () => {
    const started: unknown[] = []
    const recording: Transport = {
      run: async () => ({ exitCode: 0, stdout: "" }),
      open: () => {
        throw new Error("not used")
      },
      script(words) {
        started.push(words)
        throw new Error("a script was started")
      },
    }
    const requests: InstallRequest[] = [
      { mode: "add", version: "$(reboot)", source: { kind: "release", files: [] } },
      release({ kind: "release", files: [{ arch: "`id`" as "x64", sha256: SHA }] }),
      release({ kind: "release", files: [{ arch: "x64", sha256: "x\n; reboot" }] }),
      { mode: "update", version: VERSION, runnerPath: "-oProxyCommand=reboot", source: { kind: "release", files: [] } },
    ]
    for (const request of requests) {
      await expect(runInstaller(recording, request, { destination: "deploy@example.test" })).rejects.toThrow("is not valid, so nothing was sent to the server")
    }
    expect(started).toEqual([])
  })

  test("the transport checks the words again, and puts SSH's options before `--`", () => {
    const transport = connect({ kind: "ssh", destination: "deploy@example.test", runnerPath: "zekno-runner" }, [])
    for (const word of HOSTILE) expect(() => transport.script!(["add", word])).toThrow("The installer's arguments are not valid")
    expect(() => transport.script!([])).toThrow()
    expect(connect({ kind: "local", home: tempDir("runner") }, []).script).toBeUndefined()
  })

  test("the release files are those with a published checksum, and today there are none", () => {
    expect(releaseFiles()).toEqual(
      (["x64", "arm64"] as const).flatMap((arch) => {
        const sha = RUNNER_RELEASE.files[`linux-${arch}`].sha256
        return sha ? [{ arch, sha256: sha }] : []
      })
    )
    expect(releaseFiles({ files: { "linux-x64": { sha256: SHA }, "linux-arm64": { sha256: null } } })).toEqual([{ arch: "x64", sha256: SHA }])
    expect(NO_RELEASE).toContain("--runner-file")
    expect(NO_RELEASE).toContain("README")
  })

  test("a runner file must be a regular file of at most 256 MiB, and is hashed as read", async () => {
    const dir = tempDir("file")
    await Bun.write(join(dir, "runner"), "binary")
    expect(await readRunnerFile(join(dir, "runner"))).toEqual({ bytes: new TextEncoder().encode("binary"), sha256: sha256("binary") })
    await expect(readRunnerFile(dir)).rejects.toThrow("must be a regular file")
    await expect(readRunnerFile(join(dir, "missing"))).rejects.toThrow("There is no runner file at that path.")
    await Bun.write(join(dir, "empty"), "")
    await expect(readRunnerFile(join(dir, "empty"))).rejects.toThrow("is empty")
    const big = join(dir, "big")
    writeFileSync(big, "x")
    // A sparse file one byte over the limit: its size is checked before anything is read.
    truncateSync(big, RUNNER_FILE_LIMIT + 1)
    await expect(readRunnerFile(big)).rejects.toThrow("larger than 256 MiB")
  })
})

// ---------------------------------------------------------------------------
// What it prints, read

describe("what the script prints is read strictly", () => {
  test("each of its lines, and nothing else", () => {
    expect(parseInstallLine("connected")).toEqual({ kind: "connected" })
    expect(parseInstallLine("docker ok 2.40.3")).toEqual({ kind: "docker", version: "2.40.3" })
    expect(parseInstallLine("docker ok v5.6.0")).toEqual({ kind: "docker", version: "5.6.0" })
    expect(parseInstallLine("docker ok unknown")).toEqual({ kind: "docker" })
    expect(parseInstallLine("runner found user 0.1.0")).toEqual({ kind: "runner", place: "user", version: "0.1.0" })
    expect(parseInstallLine("runner found path unknown")).toEqual({ kind: "runner", place: "path" })
    expect(parseInstallLine("download ok 27000000")).toEqual({ kind: "download", bytes: 27_000_000 })
    expect(parseInstallLine("done system")).toEqual({ kind: "done", place: "system" })
    expect(parseInstallLine("fail checksum")).toEqual({ kind: "fail", reason: "checksum" })
    for (const line of [
      "",
      "connected ",
      " connected",
      "docker ok $(id)",
      "docker ok \u001b[2J",
      "runner found /usr/bin 0.1.0",
      "runner found user 0.1",
      "download ok 0",
      "download ok -1",
      "done /tmp/x",
      "fail nope",
      "fail constructor",
      "constructor",
      "toString",
      "Server code: AAAA-BBBB",
      `docker ok ${"1".repeat(40)}`,
    ]) {
      expect({ line, event: parseInstallLine(line) }).toEqual({ line, event: undefined })
    }
  })

  test("in the script's order, each step once, an install only after a matching checksum", () => {
    const add = release({ kind: "release", files: [] })
    const read = (lines: string[], request: InstallRequest = add) => {
      const seen: InstallEvent[] = []
      for (const line of lines) {
        const event = parseInstallLine(line)
        if (!event || !followsOrder(seen, event, request)) return false
        seen.push(event)
      }
      return true
    }
    expect(read(freshInstall(10))).toBe(true)
    expect(read(["connected", "docker ok 1.0.0", "runner found path 0.1.0", "folder ok", "done path"])).toBe(true)
    expect(read(["connected", "fail docker"])).toBe(true)
    expect(read(["docker ok 1.0.0"])).toBe(false)
    expect(read(["fail docker"])).toBe(false)
    expect(read(["connected", "connected"])).toBe(false)
    expect(read(["connected", "docker ok 1.0.0", "runner none", "install ok"])).toBe(false)
    expect(read(["connected", "docker ok 1.0.0", "runner none", "folder ok", "done user"])).toBe(false)
    expect(read(["connected", "docker ok 1.0.0", "runner none", "platform ok x64", "ready"])).toBe(false)
    expect(read(["connected", "docker ok 1.0.0", "runner found target 0.1.0"])).toBe(false)
    const update: InstallRequest = { mode: "update", version: VERSION, runnerPath: "zekno-runner", source: { kind: "release", files: [] } }
    expect(read(["connected", "docker ok 1.0.0", "runner found target 0.1.0"], update)).toBe(true)
    expect(read(["connected", "docker ok 1.0.0", "runner none"], update)).toBe(false)
    expect(read(["connected", "docker ok 1.0.0", `runner found target ${VERSION}`, "version ok", "folder ok", "done user"], update)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Run as the CLI runs it, over a stand-in for ssh

describe("running the installer over SSH", () => {
  test("`ssh -- <destination> sh -s -- <words>`: one connection, which becomes the session", async () => {
    const server = standInServer()
    const ssh = sshStandIn(server)
    const runner = fakeRunner(VERSION)
    const sha = server.release(runner)
    const events: string[] = []
    await withSsh(ssh, async () => {
      const transport = connect({ kind: "ssh", destination: "deploy@example.test", runnerPath: "zekno-runner" }, [], { errorLines: () => {} })
      const done = await runInstaller(transport, release({ kind: "release", files: [{ arch: "x64", sha256: sha }] }), { destination: "deploy@example.test" }, (event) =>
        events.push(event.kind)
      )
      expect(done.place).toBe("user")
      // The script handed its connection over to the runner's session: what is written next reaches the runner.
      const session = done.session as RunnerProcess
      session.write("hello\n")
      session.end()
      const reader = session.output.getReader()
      let text = ""
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) text += new TextDecoder().decode(chunk.value)
      expect(text).toBe("session\ngot hello\n")
    })
    expect(events).toEqual(["connected", "docker", "no-runner", "platform", "download", "checksum", "install", "version", "folder", "done"])
    expect(ssh.calls()).toEqual([`-- deploy@example.test sh -s -- add ${VERSION} release x64 ${sha}`])
  })

  test("a step that fails is said in the contract's words; SSH that cannot connect is said as such", async () => {
    const server = standInServer()
    server.noCompose()
    const ssh = sshStandIn(server)
    const transport = connect({ kind: "ssh", destination: "deploy@example.test", runnerPath: "zekno-runner" }, [], { errorLines: () => {} })
    await withSsh(ssh, async () => {
      await expect(runInstaller(transport, release({ kind: "release", files: [] }), { destination: "deploy@example.test" })).rejects.toThrow(
        "Docker with Compose was not found on the server."
      )
    })
    const nowhere = connect({ kind: "ssh", destination: "deploy@example.test", runnerPath: "zekno-runner" }, [], { errorLines: () => {} })
    await withSsh({ path: "/usr/bin/false" }, async () => {
      // `false` exits with 1, not SSH's 255: whatever that is, it did not answer as the installer does.
      await expect(runInstaller(nowhere, release({ kind: "release", files: [] }), { destination: "deploy@example.test" })).rejects.toThrow(INSTALL_UNEXPECTED)
    })
    const refused = sshStandIn(standInServer())
    refused.ask()
    const batch = connect({ kind: "ssh", destination: "deploy@example.test", runnerPath: "zekno-runner" }, [], { errorLines: () => {}, batch: true })
    await withSsh(refused, async () => {
      await expect(runInstaller(batch, release({ kind: "release", files: [] }), { destination: "deploy@example.test" })).rejects.toThrow(
        unreachable("deploy@example.test")
      )
    })
    expect(refused.calls()).toEqual([`-o BatchMode=yes -- deploy@example.test sh -s -- add ${VERSION} release`])
  })

  test("a line that is not the script's ends the install, and is passed on cleaned", async () => {
    const lying: Transport = {
      run: async () => ({ exitCode: 0, stdout: "" }),
      open: () => {
        throw new Error("not used")
      },
      script: () => connect({ kind: "local", home: tempDir("runner") }, ["sh", "-c", "cat >/dev/null & printf 'connected\\nServer code: \\033[31mFAKE\\n'"]).open(),
    }
    const details: string[] = []
    await expect(
      runInstaller(lying, release({ kind: "release", files: [] }), { destination: "deploy@example.test" }, () => {}, (line) => details.push(line))
    ).rejects.toThrow(INSTALL_UNEXPECTED)
    expect(details).toEqual(["Server code: FAKE"])
  })
})
