/**
 * What `zekno doctor` runs on a server (specs/006-cli-small-features,
 * contracts/doctor.md, "CHECK_SCRIPT"; research R11): the fixed read-only
 * script, run with `sh` and `dash` against the stand-in server as the
 * installer's tests run the installer, and the way its lines are read. After
 * every run, every file of the stand-in server is byte for byte what it was.
 */
import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { CliError } from "../../src/errors"
import { INSTALL_SCRIPT } from "../../src/install"
import { RUNNER_RELEASE } from "../../src/runner-release"
import { CHECK_PATH_INVALID, CHECK_SCRIPT, checkWords, runCheck } from "../../src/server/check-script"
import type { RunnerProcess, Transport } from "../../src/transport"
import { fakeRunner, snapshot, standInServer, type StandInServer } from "../stand-in-server"

/** The shells the script is run with: this machine's `sh`, and `dash` where there is one (Debian's and Ubuntu's `sh`). */
const SHELLS = ["/bin/sh", ...(existsSync("/bin/dash") ? ["/bin/dash"] : [])]

/** The runner's path as the installer records it for a user who is not root. */
const USER_PATH = "~/.local/bin/zekno-runner"

/** Runs the check as `server.run` runs the installer, and checks that nothing on the server changed. */
async function check(server: StandInServer, words: string[], options: { shell?: string; env?: Record<string, string> } = {}) {
  const before = snapshot(server.root)
  const run = await server.run(words, { ...options, script: CHECK_SCRIPT })
  expect(snapshot(server.root)).toEqual(before)
  expect(server.leftovers()).toEqual([])
  return run
}

describe("the script's text (contracts/doctor.md)", () => {
  test("it is the contract's, word for word: one block, nothing a template could put in it, nothing that writes", () => {
    const contract = readFileSync(join(import.meta.dir, "../../../../specs/006-cli-small-features/contracts/doctor.md"), "utf8")
    const start = contract.indexOf("```sh\n") + "```sh\n".length
    expect(CHECK_SCRIPT).toBe(contract.slice(start, contract.indexOf("```", start)))
    const source = readFileSync(join(import.meta.dir, "../../src/server/check-script.ts"), "utf8")
    const from = source.indexOf("String.raw`") + "String.raw`".length
    expect(source.slice(from, source.indexOf("`", from))).toBe(CHECK_SCRIPT)
    expect(CHECK_SCRIPT).not.toContain("${")
    expect(CHECK_SCRIPT).not.toContain("`")
    expect(CHECK_SCRIPT.startsWith("{\nset -eu\nLC_ALL=C\nexport LC_ALL\n")).toBe(true)
    expect(CHECK_SCRIPT.endsWith("}\n")).toBe(true)
    for (const word of ["mkdir", "mv ", "rm ", "mktemp", "chmod", "curl", "wget", "exec", " > ", ">>", "sudo"]) {
      expect({ word, found: CHECK_SCRIPT.includes(word) }).toEqual({ word, found: false })
    }
    // Every redirection is of a stream to /dev/null, or of standard error to standard output.
    const redirections = [...CHECK_SCRIPT.matchAll(/[0-9]?[<>]&?[^\s;)]*/g)].map((match) => match[0])
    expect(redirections.every((redirection) => /^(?:[0-9]?[<>]\/dev\/null|2>&1)$/.test(redirection))).toBe(true)
  })

  test("the lines it shares with the installer are the installer's, word for word", () => {
    const shared = [
      "command -v docker >/dev/null 2>&1",
      "docker compose version </dev/null >/dev/null 2>&1",
      "compose=$(docker compose version --short </dev/null 2>/dev/null | head -n 1 | cut -c 1-32) || compose=",
      "case $compose in ''|*[!0-9A-Za-z.+-]*) compose=unknown ;; esac",
      'say "docker ok $compose"',
      "set +u\nhome=$HOME\nset -u",
      'if [ "$(id -u)" = 0 ]; then',
      "case $home in /*) ;; *) fail home ;; esac",
      "'~/'*) runner=$home/$(printf '%s' \"$target\" | cut -c 3-) ;;",
      "*/*) runner=$target ;;",
      '*) runner=$(command -v "$target" 2>/dev/null) || runner= ;;',
      "case $runner in */*) ;; *) runner= ;; esac",
      "df -Pk \"$",
      "</dev/null 2>/dev/null | tail -n 1 | tr -s ' ' | cut -d ' ' -f 4) || free=",
    ]
    for (const line of shared) expect({ line, check: CHECK_SCRIPT.includes(line), installer: INSTALL_SCRIPT.includes(line) }).toEqual({ line, check: true, installer: true })
  })
})

for (const shell of SHELLS) {
  describe(`the script, run with ${shell} against the stand-in server`, () => {
    test("with the stand-in Docker and no runner: its five lines", async () => {
      const server = standInServer()
      const run = await check(server, ["check", USER_PATH], { shell })
      expect(run.lines).toEqual(["connected", "docker ok 2.40.3", "runner none", "space unknown", "done"])
      expect(run.code).toBe(0)
    })

    test("a runner at its path, by ~/, by an absolute path, and on PATH by its name, is here; one that cannot run is not", async () => {
      const server = standInServer()
      server.installed(fakeRunner(RUNNER_RELEASE.version))
      expect((await check(server, ["check", USER_PATH], { shell })).lines[2]).toBe("runner here")
      expect((await check(server, ["check", server.runnerPath], { shell })).lines[2]).toBe("runner here")
      expect((await check(server, ["check", "zekno-runner"], { shell })).lines[2]).toBe("runner none")
      const onPath = { PATH: `${join(server.home, ".local", "bin")}:${server.env().PATH}` }
      expect((await check(server, ["check", "zekno-runner"], { shell, env: onPath })).lines[2]).toBe("runner here")
      chmodSync(server.runnerPath, 0o644)
      expect((await check(server, ["check", USER_PATH], { shell })).lines[2]).toBe("runner none")
    })

    test("no Compose, and no Docker at all: docker none", async () => {
      const noCompose = standInServer()
      noCompose.noCompose()
      expect((await check(noCompose, ["check", USER_PATH], { shell })).lines).toEqual(["connected", "docker none", "runner none", "space unknown", "done"])
      const noDocker = standInServer()
      noDocker.remove("docker")
      expect((await check(noDocker, ["check", USER_PATH], { shell })).lines[1]).toBe("docker none")
    })

    test("a Compose version of another shape is said as unknown, as the installer says it", async () => {
      const server = standInServer()
      server.composeVersion("v2.40.3-desktop.1 extra")
      expect((await check(server, ["check", USER_PATH], { shell })).lines[1]).toBe("docker ok unknown")
    })

    test("free space: df of the nearest folder above the runner's that exists, then of that folder once it exists", async () => {
      const server = standInServer()
      server.df(133000000)
      expect((await check(server, ["check", USER_PATH], { shell })).lines[3]).toBe("space 133000000")
      expect(server.calls("df")).toEqual([`-Pk ${server.home}`])
      mkdirSync(server.folder, { recursive: true })
      expect((await check(server, ["check", USER_PATH], { shell })).lines[3]).toBe("space 133000000")
      expect(server.calls("df").at(-1)).toBe(`-Pk ${server.folder}`)
      server.df("lots")
      expect((await check(server, ["check", USER_PATH], { shell })).lines[3]).toBe("space unknown")
    })

    test("an empty HOME: fail home, after the Docker line", async () => {
      const server = standInServer()
      const run = await check(server, ["check", USER_PATH], { shell, env: { HOME: "" } })
      expect(run.lines).toEqual(["connected", "docker ok 2.40.3", "fail home"])
      expect(run.code).toBe(1)
    })

    test("words it does not take: fail usage, right after connected", async () => {
      const server = standInServer()
      for (const words of [["check"], ["check", "-x"], ["install", "x"], ["check", "a", "b"], ["check", ""]]) {
        const run = await check(server, words, { shell })
        expect({ words, lines: run.lines, code: run.code }).toEqual({ words, lines: ["connected", "fail usage"], code: 1 })
      }
    })

    test("the installer, run on the same kind of server, finds the same Docker", async () => {
      const server = standInServer()
      const checked = await check(server, ["check", USER_PATH], { shell })
      const installed = await server.run(["add", RUNNER_RELEASE.version, "release", "x64", "a".repeat(64)], { shell })
      expect(installed.lines[1]).toBe(checked.lines[1]!)
      expect(installed.lines[1]).toBe("docker ok 2.40.3")
    })
  })
}

describe("checkWords: the only words placed after `sh -s --`", () => {
  test("check and the runner's path, for each kind of path the profile holds", () => {
    for (const path of [USER_PATH, "/usr/local/bin/zekno-runner", "zekno-runner"]) expect(checkWords(path)).toEqual(["check", path])
  })

  test("a path that cannot be an argument throws before anything is sent", () => {
    for (const path of ["-x", "", "a b", "$(touch x)", "x;y", "x\ny", "`id`"]) {
      expect(() => checkWords(path)).toThrow(new CliError(CHECK_PATH_INVALID))
    }
  })

  test("runCheck with such a path starts nothing", async () => {
    let started = 0
    const transport: Transport = { run: () => Promise.reject(new Error("no")), open: () => ((started++, undefined) as never), script: () => ((started++, undefined) as never) }
    expect(runCheck(transport, "-x", AbortSignal.timeout(1000))).rejects.toThrow(CHECK_PATH_INVALID)
    expect(started).toBe(0)
  })
})

/** A transport whose script prints `output` (bytes or text) and exits with `code`, and records what it was sent. */
function scripted(output: string | Uint8Array, code = 0, options: { hang?: boolean } = {}) {
  const sent: string[] = []
  const words: (readonly string[])[] = []
  let killed = false
  let exit: (code: number) => void = () => {}
  const exited = new Promise<number>((resolve) => (exit = resolve))
  const transport: Transport = {
    run: () => Promise.reject(new Error("not this")),
    open: () => {
      throw new Error("not this")
    },
    script(given) {
      words.push(given)
      const bytes = typeof output === "string" ? new TextEncoder().encode(output) : output
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if (bytes.length > 0) controller.enqueue(bytes)
          if (!options.hang) {
            controller.close()
            exit(code)
          }
        },
      })
      const child: RunnerProcess = {
        output: stream,
        write: (text) => void sent.push(text),
        send: async () => {},
        end: () => {},
        kill: () => {
          killed = true
          exit(143)
        },
        exited,
        errorsRead: Promise.resolve(),
      }
      return child
    },
  }
  return { transport, sent, words, killed: () => killed }
}

describe("runCheck: each line read against its pattern, in order", () => {
  const signal = () => AbortSignal.timeout(5000)

  test("the five lines become the result; the script is sent once, after the words", async () => {
    const stand = scripted("connected\ndocker ok 2.40.3\nrunner here\nspace 133000000\ndone\n")
    expect(await runCheck(stand.transport, USER_PATH, signal())).toEqual({ reached: true, docker: { version: "2.40.3" }, runner: "here", space: 133000000, exitCode: 0 })
    expect(stand.words).toEqual([["check", USER_PATH]])
    expect(stand.sent).toEqual([CHECK_SCRIPT])
  })

  test("docker none, runner none, space unknown; a version of another shape is no version", async () => {
    expect(await runCheck(scripted("connected\ndocker none\nrunner none\nspace unknown\ndone\n").transport, USER_PATH, signal())).toEqual({
      reached: true,
      docker: "none",
      runner: "none",
      space: "unknown",
      exitCode: 0,
    })
    expect((await runCheck(scripted("connected\ndocker ok unknown\nrunner none\nspace 1\ndone\n").transport, USER_PATH, signal())).docker).toEqual({})
    expect((await runCheck(scripted("connected\ndocker ok v5.6.0\nrunner none\nspace 1\ndone\n").transport, USER_PATH, signal())).docker).toEqual({ version: "5.6.0" })
  })

  test("fail home and fail usage", async () => {
    expect(await runCheck(scripted("connected\ndocker ok 2.40.3\nfail home\n", 1).transport, USER_PATH, signal())).toEqual({
      reached: true,
      docker: { version: "2.40.3" },
      home: false,
      exitCode: 1,
    })
    expect(await runCheck(scripted("connected\nfail usage\n", 1).transport, USER_PATH, signal())).toEqual({ reached: true, unread: true, exitCode: 1 })
  })

  test("a line it does not know, one out of order, one too long, a line before connected, and an end before done: answered, but not as zekno expects", async () => {
    const unread = [
      "connected\ndocker ok 2.40.3\nrunner here\nspace 1\nhello\n",
      "connected\nrunner here\ndocker ok 2.40.3\nspace 1\ndone\n",
      "connected\ndocker ok 2.40.3\ndocker ok 2.40.3\n",
      `connected\ndocker ok ${"1".repeat(300)}\n`,
      `connected\n${"x".repeat(300)}\n`,
      "Welcome to the server!\nconnected\ndocker ok 2.40.3\nrunner here\nspace 1\ndone\n",
      "connected\ndocker ok 2.40.3\nrunner here\n",
      "connected\ndocker ok 2.40.3\r\nrunner here\nspace 1\ndone\n",
      "connected\nspace 9999999999999999\n",
      "connected\ndocker ok \u001b[2J\n",
    ]
    for (const output of unread) {
      const read = await runCheck(scripted(output).transport, USER_PATH, signal())
      expect({ output, unread: read.unread }).toEqual({ output, unread: true })
    }
    // A last line without a line feed is still a line: `done` at the very end counts.
    expect((await runCheck(scripted("connected\ndocker none\nrunner none\nspace 1\ndone").transport, USER_PATH, signal())).unread).toBeUndefined()
  })

  test("nothing at all, with SSH's own status: not reached", async () => {
    expect(await runCheck(scripted("", 255).transport, USER_PATH, signal())).toEqual({ reached: false, exitCode: 255 })
  })

  test("a script that never ends is stopped on the signal", async () => {
    const stand = scripted("connected\n", 0, { hang: true })
    const started = Date.now()
    const read = await runCheck(stand.transport, USER_PATH, AbortSignal.timeout(100))
    expect(Date.now() - started).toBeLessThan(2000)
    expect(stand.killed()).toBe(true)
    expect(read.reached).toBe(true)
  })

  test("bytes that are not UTF-8 are not a line of the script", async () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("connected\ndocker ok "), 0xff, 0x0a])
    expect((await runCheck(scripted(bytes).transport, USER_PATH, signal())).unread).toBe(true)
  })
})
