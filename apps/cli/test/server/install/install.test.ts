import { describe, expect, test } from "bun:test"
import { compareRunnerVersions } from "@workspace/core"
import { chmodSync, existsSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { ORDERED_VERSIONS, REFUSED_VERSIONS } from "../../../../../packages/core/test/fixtures/versions"
import { tempDir } from "../../../../runner/test/support/helpers"
import {
  followsOrder,
  INSTALL_SCRIPT,
  INSTALL_UNEXPECTED,
  installFailure,
  installWords,
  NO_RELEASE,
  parseInstallLine,
  readRunnerFile,
  releaseFiles,
  RUNNER_FILE_LIMIT,
  RUNNER_PATHS,
  runInstaller,
  unreachable,
  VERSION_PATTERN,
  type InstallEvent,
  type InstallRequest,
} from "../../../src/server/install/install"
import { releaseUrl, RUNNER_RELEASE } from "../../../src/version/runner-release"
import { connect, type RunnerProcess, type Transport } from "../../../src/server/transport"
import { fakeRunner, sha256, sshStandIn, standInServer, withSsh, type StandInServer } from "../../support/stand-in-server"

const VERSION = RUNNER_RELEASE.version
const OTHER = "0".repeat(64)
/** Older than any version this CLI can carry. */
const OLDER = "0.0.9"

/** The shells the script is run with: this machine's `sh`, and `dash` where there is one (Debian's and Ubuntu's `sh`). */
const SHELLS = ["/bin/sh", ...(existsSync("/bin/dash") ? ["/bin/dash"] : [])]

/** A runner that reports `version`, in a folder of its own on `server`: its path. */
function runnerAt(server: StandInServer, version: string): string {
  const dir = join(server.home, "runners", version)
  const path = join(dir, "zekno-runner")
  if (!existsSync(path)) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, fakeRunner(version))
    chmodSync(path, 0o755)
  }
  return path
}

/**
 * A small .gz that unpacks to 257 MiB of zeros: one member of 1 MiB, 257
 * times over, which gzip reads as one stream. Made once, on first use.
 */
let oversized: Uint8Array | undefined
const OVERSIZED_GZ = (): Uint8Array => {
  if (!oversized) {
    const member = Bun.gzipSync(new Uint8Array(1024 * 1024))
    oversized = new Uint8Array(Buffer.concat(Array.from({ length: 257 }, () => member)))
  }
  return oversized
}

/** Runs `work` on each item, a few at a time, and gives the results in order. */
async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>, size = 16): Promise<R[]> {
  const results: R[] = []
  for (let at = 0; at < items.length; at += size) results.push(...(await Promise.all(items.slice(at, at + size).map(work))))
  return results
}

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
          [OLDER, OLDER],
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

      test("neither sha256sum nor shasum: it stops before anything is downloaded or read, and nothing is installed", async () => {
        const server = standInServer()
        server.remove("sha256sum")
        const sha = server.release(fakeRunner(VERSION))
        const run = await server.run(["add", VERSION, "release", "x64", sha], { shell })
        expect(run.lines).toEqual(["connected", "docker ok 2.40.3", "runner none", "platform ok x64", "fail tools"])
        expect(server.calls("curl")).toEqual([])
        expect(existsSync(server.runnerPath)).toBe(false)
        expect(server.leftovers()).toEqual([])
        // The runner file is never asked for: the script stops before `ready`.
        const bytes = new TextEncoder().encode(fakeRunner(VERSION))
        const file = await server.run(["add", VERSION, "file", sha256(bytes)], { shell, file: bytes })
        expect(file.lines.at(-1)).toBe("fail tools")
        expect(file.lines).not.toContain("ready")
        // An update leaves the runner that was there.
        const working = fakeRunner(OLDER)
        server.installed(working)
        const update = await server.run(["update", VERSION, server.runnerPath, "release", "x64", sha], { shell })
        expect(update.lines.at(-1)).toBe("fail tools")
        expect(readFileSync(server.runnerPath, "utf8")).toBe(working)
        expect(server.calls("curl")).toEqual([])
      })

      test("a download that fails: with little room left it says space, otherwise download", async () => {
        const full = standInServer()
        full.fetch("fail")
        full.df(1000)
        const sha = full.release(fakeRunner(VERSION))
        const run = await full.run(["add", VERSION, "release", "x64", sha], { shell })
        expect(run.lines.at(-1)).toBe("fail space")
        expect(full.calls("df")).toEqual([`-Pk ${join(full.home, ".local", "bin")}`])
        expect(existsSync(full.runnerPath)).toBe(false)
        expect(full.leftovers()).toEqual([])

        const roomy = standInServer()
        roomy.fetch("fail")
        roomy.df(10_000_000)
        expect((await roomy.run(["add", VERSION, "release", "x64", roomy.release(fakeRunner(VERSION))], { shell })).lines.at(-1)).toBe("fail download")
        expect(roomy.leftovers()).toEqual([])

        // An answer of another shape is no answer: it says download.
        const odd = standInServer()
        odd.fetch("fail")
        odd.df("-")
        expect((await odd.run(["add", VERSION, "release", "x64", odd.release(fakeRunner(VERSION))], { shell })).lines.at(-1)).toBe("fail download")
      })

      test("a runner one byte different from the published one is never installed, and nothing is left (SC-002)", async () => {
        const server = standInServer()
        const published = fakeRunner(VERSION)
        const at = published.indexOf("session")
        const changed = `${published.slice(0, at)}${String.fromCharCode(published.charCodeAt(at) ^ 1)}${published.slice(at + 1)}`
        expect(changed).not.toBe(published)
        expect(changed.length).toBe(published.length)
        server.release(changed)
        const run = await server.run(["add", VERSION, "release", "x64", sha256(published)], { shell })
        expect(run.lines.slice(-2)).toEqual([`download ok ${published.length}`, "fail checksum"])
        expect(existsSync(server.runnerPath)).toBe(false)
        expect(existsSync(server.folder)).toBe(false)
        expect(server.leftovers()).toEqual([])
      })

      test("a .gz that unpacks to more than 256 MiB is cut there and refused, and nothing is left", async () => {
        const server = standInServer()
        server.releaseGz(OVERSIZED_GZ())
        const run = await server.run(["add", VERSION, "release", "x64", sha256("anything")], { shell })
        expect(run.lines.at(-1)).toBe("fail download")
        expect(run.lines).not.toContain("checksum ok")
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

      test("a runner that matches the checksum but does not answer with this version is never put in place", async () => {
        const server = standInServer()
        const run = await server.run(["add", VERSION, "release", "x64", server.release(fakeRunner("9.9.9"))], { shell })
        expect(run.lines.slice(-2)).toEqual(["checksum ok", "fail version"])
        expect(existsSync(server.runnerPath)).toBe(false)
        expect(server.leftovers()).toEqual([])
      })

      test("update: a new runner that cannot run here leaves the working one in place", async () => {
        const server = standInServer()
        const working = fakeRunner(OLDER)
        server.installed(working)
        const broken = "#!/bin/sh\nexit 1\n"
        const run = await server.run(["update", VERSION, server.runnerPath, "release", "x64", server.release(broken)], { shell })
        expect(run.lines.slice(-2)).toEqual(["checksum ok", "fail version"])
        expect(readFileSync(server.runnerPath, "utf8")).toBe(working)
        expect(server.leftovers()).toEqual([])
      })

      test("update: a runner newer than the one carried is never replaced", async () => {
        const carried = "0.1.0"
        for (const newer of ["0.9.0", "1.0.0", "0.1.1", "0.1.1-dev.1", "0.10.0"]) {
          const server = standInServer()
          const there = fakeRunner(newer)
          server.installed(there)
          const run = await server.run(["update", carried, server.runnerPath, "release", "x64", server.release(fakeRunner(carried))], { shell })
          expect({ newer, lines: run.lines }).toEqual({ newer, lines: ["connected", "docker ok 2.40.3", `runner found target ${newer}`, "fail newer"] })
          expect(readFileSync(server.runnerPath, "utf8")).toBe(there)
          expect(server.calls("curl")).toEqual([])
        }
      })

      test("update: only a file named zekno-runner is ever replaced, whatever the profile says the path is", async () => {
        const server = standInServer()
        // A program that is not a runner, where an edited profile could point: it must come to no harm.
        const victim = join(server.home, "sshd")
        const program = "#!/bin/sh\necho 'I am not a runner'\n"
        writeFileSync(victim, program)
        chmodSync(victim, 0o755)
        const sha = server.release(fakeRunner(VERSION))
        for (const path of [victim, "sshd", "~/sshd", join(server.home, "zekno-runner.sh"), join(server.home, "zekno-runner", "x")]) {
          const run = await server.run(["update", VERSION, path, "release", "x64", sha], { shell })
          expect({ path, lines: run.lines }).toEqual({ path, lines: ["connected", "fail name"] })
        }
        expect(readFileSync(victim, "utf8")).toBe(program)
        expect(server.calls("docker")).toEqual([])
        expect(server.calls("curl")).toEqual([])
      })

      test("update: an older runner is replaced in place; one at this version is left; a missing one is said", async () => {
        const server = standInServer()
        server.installed(fakeRunner(OLDER))
        const runner = fakeRunner(VERSION)
        const sha = server.release(runner)
        const run = await server.run(["update", VERSION, server.runnerPath, "release", "x64", sha], { shell })
        expect(run.lines).toEqual([
          "connected",
          "docker ok 2.40.3",
          `runner found target ${OLDER}`,
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
        server.installed(fakeRunner(OLDER))
        const runner = fakeRunner(VERSION)
        const run = await server.run(["update", VERSION, RUNNER_PATHS.user, "release", "x64", server.release(runner)], { shell })
        expect(run.lines.at(-1)).toBe("done target")
        expect(readFileSync(server.runnerPath, "utf8")).toBe(runner)
      })

      test("words that do not fit are refused by the script itself, before it looks at anything", async () => {
        const server = standInServer()
        const sha = server.release(fakeRunner(VERSION))
        for (const words of [
          ["add", "0.1", "release"],
          ["add", "0.1.0.1", "release"],
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

      test("the version word: every form the grammar refuses stops at once, and a dev version is taken", async () => {
        const server = standInServer()
        const runs = await Promise.all(REFUSED_VERSIONS.map((version) => server.run(["add", version, "release"], { shell })))
        for (const [at, run] of runs.entries()) {
          const version = REFUSED_VERSIONS[at]
          expect({ version, lines: run.lines }).toEqual({ version, lines: ["connected", "fail usage"] })
        }
        expect(server.calls("docker")).toEqual([])
        const dev = await server.run(["add", "0.1.0-dev.1", "release"], { shell })
        expect(dev.lines).toEqual(["connected", "docker ok 2.40.3", "runner none", "platform ok x64", "fail release"])
      })

      test("in a UTF-8 locale, digits of other scripts are not version digits, as in JavaScript (security review RV8)", async () => {
        const server = standInServer()
        // Arabic-Indic, Devanagari and full-width digits, where a version's digits go.
        const hostile = ["٣.2.3", "1.2.3-dev.١", "١.٢.٣", "१.2.3", "１.2.3", "0.1.0-dev.٣"]
        for (const version of hostile) expect({ version, js: VERSION_PATTERN.test(version) }).toEqual({ version, js: false })
        for (const locale of ["en_US.UTF-8", "C.UTF-8"]) {
          const runs = await Promise.all(hostile.map((version) => server.run(["add", version, "release"], { shell, env: { LANG: locale, LC_ALL: locale } })))
          for (const [at, run] of runs.entries()) {
            expect({ locale, version: hostile[at], lines: run.lines }).toEqual({ locale, version: hostile[at], lines: ["connected", "fail usage"] })
          }
        }
        expect(server.calls("docker")).toEqual([])
      })

      test("the script's order of versions is the TypeScript one: an update stops with newer exactly when the runner there is newer", async () => {
        // One server, one runner per version, each in its own folder. No checksum is carried, so an
        // update that goes ahead stops at `fail release`, before anything is downloaded. The runner's
        // folder exists already, so the runs that get that far do not race to make it.
        const server = standInServer()
        mkdirSync(server.folder, { recursive: true, mode: 0o700 })
        const pairs = ORDERED_VERSIONS.flatMap((there) => ORDERED_VERSIONS.map((carried) => ({ there, carried, path: runnerAt(server, there) })))
        const runs = await inBatches(pairs, ({ there, carried, path }) => server.run(["update", carried, path, "release"], { shell }))
        for (const [at, run] of runs.entries()) {
          const { there, carried } = pairs[at]!
          const newer = compareRunnerVersions(there, carried) > 0
          expect({ there, carried, found: run.lines[2], last: run.lines.at(-1) }).toEqual({
            there,
            carried,
            found: `runner found target ${there}`,
            last: newer ? "fail newer" : there === carried ? "done target" : "fail release",
          })
        }
        expect(pairs.filter(({ there, carried }) => compareRunnerVersions(there, carried) > 0)).toHaveLength(55)
        expect(server.calls("curl")).toEqual([])
        // 121 runs of the script: a second or two alone, more when the whole suite runs beside it.
      }, 30_000)

      test("a runner's own version is read with the same grammar: anything else is unknown", async () => {
        const server = standInServer()
        const cases = [
          ["0.1.0-dev.1", "0.1.0-dev.1"],
          ["0.1.0-dev.0", "unknown"],
          ["1.2", "unknown"],
          ["0.1.0-dev.01", "unknown"],
          ["01.1.0", "unknown"],
          ["0.1.0-rc.1", "unknown"],
        ] as const
        const runs = await Promise.all(cases.map(([reports]) => server.run(["update", "0.1.0", runnerAt(server, reports), "release"], { shell })))
        for (const [at, run] of runs.entries()) {
          const [reports, found] = cases[at]!
          expect({ reports, line: run.lines[2] }).toEqual({ reports, line: `runner found target ${found}` })
        }
      })

      test("a prod version replaces the dev version before it; a dev version never replaces the prod one after it", async () => {
        const server = standInServer()
        server.installed(fakeRunner("0.1.0-dev.1"))
        const prod = fakeRunner("0.1.0")
        const run = await server.run(["update", "0.1.0", server.runnerPath, "release", "x64", server.release(prod)], { shell })
        expect(run.lines.slice(2, 4)).toEqual(["runner found target 0.1.0-dev.1", "platform ok x64"])
        expect(run.lines.at(-1)).toBe("done target")
        expect(readFileSync(server.runnerPath, "utf8")).toBe(prod)

        const back = await server.run(["update", "0.1.0-dev.2", server.runnerPath, "release", "x64", server.release(fakeRunner("0.1.0-dev.2"))], { shell })
        expect(back.lines).toEqual(["connected", "docker ok 2.40.3", "runner found target 0.1.0", "fail newer"])
        expect(readFileSync(server.runnerPath, "utf8")).toBe(prod)
        expect(server.calls("curl")).toHaveLength(1)
      })

      test("a C library older than glibc 2.17, or musl, is said before anything is downloaded or put in place", async () => {
        const stopped = ["connected", "docker ok 2.40.3", "runner none", "platform ok x64", "fail libc"]
        const servers = {
          old: standInServer(),
          older: standInServer(),
          musl: standInServer(),
          muslOut: standInServer(),
        }
        servers.old.getconf("glibc 2.16")
        servers.older.getconf("glibc 1.99")
        // As on Alpine: getconf knows no GNU_LIBC_VERSION, and musl's ldd says what it is on standard error.
        servers.musl.ldd("musl libc (x86_64)\nVersion 1.2.5\nDynamic Program Path: /lib/ld-musl-x86_64.so.1")
        servers.muslOut.ldd("musl libc (aarch64)", "stdout")
        const runs = await Promise.all(
          Object.values(servers).map((server) => server.run(["add", VERSION, "release", "x64", server.release(fakeRunner(VERSION))], { shell }))
        )
        for (const [at, [name, server]] of Object.entries(servers).entries()) {
          expect({ name, lines: runs[at]!.lines }).toEqual({ name, lines: stopped })
          expect(server.calls("curl")).toEqual([])
          expect(existsSync(server.runnerPath)).toBe(false)
          expect(existsSync(join(server.home, ".local"))).toBe(false)
          expect(server.leftovers()).toEqual([])
        }
        // A runner file is never asked for.
        const bytes = new TextEncoder().encode(fakeRunner(VERSION))
        const file = await servers.old.run(["add", VERSION, "file", sha256(bytes)], { shell, file: bytes })
        expect(file.lines).toEqual(stopped)
        // An update leaves the runner that was there, and it still answers.
        const working = fakeRunner(OLDER)
        servers.musl.installed(working)
        const update = await servers.musl.run(["update", VERSION, servers.musl.runnerPath, "release", "x64", sha256("x")], { shell })
        expect(update.lines).toEqual(["connected", "docker ok 2.40.3", `runner found target ${OLDER}`, "platform ok x64", "fail libc"])
        expect(readFileSync(servers.musl.runnerPath, "utf8")).toBe(working)
        expect(servers.musl.calls("curl")).toEqual([])
        expect(servers.musl.leftovers()).toEqual([])
      })

      test("glibc 2.17 or newer goes on; so does a server where neither getconf nor ldd answers, or answers in another shape", async () => {
        const cases: [string, (server: StandInServer) => void][] = [
          ["glibc 2.17", (server) => server.getconf("glibc 2.17")],
          ["glibc 2.39", (server) => server.getconf("glibc 2.39")],
          ["glibc 3.0", (server) => server.getconf("glibc 3.0")],
          ["glibc's ldd", (server) => server.ldd("ldd (Debian GLIBC 2.36-9+deb12u4) 2.36", "stdout")],
          ["neither", () => {}],
          // Not the strict shape `glibc <x>.<y>`: no answer, so it is left to the runner itself to answer with its version.
          ...["glibc 2.16.1", "glibc 02.16", "glibc 2", "glibc 2.16x", "glibc 2.16 2.16", " glibc 2.16", "GLIBC 2.16", "glibc 2.1000000000", "musl 2.16"].map(
            (line): [string, (server: StandInServer) => void] => [line, (server) => server.getconf(line)]
          ),
          ["ldd that only mentions musl", (server) => server.ldd("ldd: this is not musl libc")],
        ]
        const servers = cases.map(([, setUp]) => {
          const server = standInServer()
          setUp(server)
          return server
        })
        const runner = fakeRunner(VERSION)
        const runs = await Promise.all(servers.map((server) => server.run(["add", VERSION, "release", "x64", server.release(runner)], { shell })))
        for (const [at, run] of runs.entries()) {
          expect({ answer: cases[at]![0], lines: run.lines }).toEqual({ answer: cases[at]![0], lines: [...freshInstall(runner.length), "session"] })
        }
      })

      test("what getconf and ldd say is only matched, never run or used: shell syntax in it does nothing", async () => {
        const marker = join(tempDir("marker"), "pwned")
        // Each is no answer of the expected shape, so the install goes on, and nothing in it is ever run.
        const lines = [`glibc $(touch ${marker})`, `glibc \`touch ${marker}\``, `glibc 2.16;touch ${marker}`, "glibc %s%n%s", `glibc ${"9".repeat(5000)}.1`]
        const cases: [string, (server: StandInServer) => void, string][] = [
          ...lines.map((line): [string, (server: StandInServer) => void, string] => [line, (server) => server.getconf(line), "session"]),
          // musl's own words come first, so this one says libc; what follows them is still never run.
          [`musl libc $(touch ${marker})`, (server) => server.ldd(`musl libc $(touch ${marker})`), "fail libc"],
        ]
        const runs = await Promise.all(
          cases.map(([, setUp]) => {
            const server = standInServer()
            setUp(server)
            return server.run(["add", VERSION, "release", "x64", server.release(fakeRunner(VERSION))], { shell })
          })
        )
        for (const [at, [line, , last]] of cases.entries()) {
          expect({ line: line.slice(0, 40), last: runs[at]!.lines.at(-1) }).toEqual({ line: line.slice(0, 40), last })
        }
        expect(existsSync(marker)).toBe(false)
      })

      test("a runner that matched its checksum but does not start: why is said from how it ended, and nothing is put in place", async () => {
        const glibc = "zekno-runner: /lib/x86_64-linux-gnu/libc.so.6: version 'GLIBC_2.99' not found (required by zekno-runner)"
        const cases = [
          // No loader for the C library it is built for: the shell cannot start it at all.
          { name: "127", runner: "#!/bin/sh\necho 'zekno-runner: not found' >&2\nexit 127\n", reason: "libc", said: "zekno-runner: not found" },
          { name: "GLIBC_", runner: `#!/bin/sh\necho "${glibc}" >&2\nexit 1\n`, reason: "libc", said: glibc },
          // The loader's line may come after another, or past what is passed on: it is still found.
          { name: "GLIBC_ later", runner: `#!/bin/sh\necho "${"x".repeat(300)}" >&2\necho "${glibc}" >&2\nexit 1\n`, reason: "libc", said: "x".repeat(200) },
          // An instruction this processor does not have.
          { name: "illegal instruction", runner: "#!/bin/sh\nkill -ILL $$\n", reason: "cpu", said: undefined },
          { name: "silent", runner: "#!/bin/sh\nexit 1\n", reason: "version", said: undefined },
        ] as const
        const servers = cases.map(() => standInServer())
        const runs = await Promise.all(cases.map(({ runner }, at) => servers[at]!.run(["add", VERSION, "release", "x64", servers[at]!.release(runner)], { shell })))
        for (const [at, { name, runner, reason, said }] of cases.entries()) {
          const run = runs[at]!
          const server = servers[at]!
          expect({ name, lines: run.lines }).toEqual({
            name,
            lines: ["connected", "docker ok 2.40.3", "runner none", "platform ok x64", `download ok ${runner.length}`, "checksum ok", `fail ${reason}`],
          })
          // Its first line, cut to 200 characters, is passed on before the script stops; nothing more of it.
          const passed = run.stderr.split("\n").filter((line) => line.startsWith("zekno-runner") || line.startsWith("xxx"))
          expect({ name, passed }).toEqual({ name, passed: said === undefined ? [] : [said] })
          expect(existsSync(server.runnerPath)).toBe(false)
          expect(existsSync(server.folder)).toBe(false)
          expect(server.leftovers()).toEqual([])
        }

        // In an update the runner that was there stays, and still answers.
        const working = fakeRunner(OLDER)
        const updated = cases.map(() => standInServer())
        const updates = await Promise.all(
          cases.map(({ runner }, at) => {
            const server = updated[at]!
            server.installed(working)
            return server.run(["update", VERSION, server.runnerPath, "release", "x64", server.release(runner)], { shell })
          })
        )
        expect(updates.map((run) => run.lines.at(-1))).toEqual(cases.map(({ reason }) => `fail ${reason}`))
        for (const server of updated) {
          expect(readFileSync(server.runnerPath, "utf8")).toBe(working)
          expect(Bun.spawnSync([server.runnerPath, "version"]).stdout.toString()).toBe(`{"version":"${OLDER}","protocol":2}\n`)
          expect(server.leftovers()).toEqual([])
        }
      })
    })
  }

  test("its text has nothing a template could have put in it: no `${`, no backquote", () => {
    const source = readFileSync(join(import.meta.dir, "../../../src/server/install/install.ts"), "utf8")
    const start = source.indexOf("String.raw`") + "String.raw`".length
    const text = source.slice(start, source.indexOf("`", start))
    expect(text).toBe(INSTALL_SCRIPT)
    expect(text).not.toContain("${")
    expect(text).not.toContain("sudo")
    expect(text.startsWith("{\n")).toBe(true)
    expect(text.endsWith("\n}\n")).toBe(true)
    // The address it downloads from is the one this CLI names, with nothing but the version and the architecture varying.
    expect(text).toContain("url=https://github.com/zekno-app/zekno/releases/download/runner-v$version/zekno-runner-linux-$arch.gz")
    expect(releaseUrl("1.2.3", "arm64")).toBe("https://github.com/zekno-app/zekno/releases/download/runner-v1.2.3/zekno-runner-linux-arm64.gz")
  })

  test("before anything else it works in the C locale, whatever locale SSH hands it (security review RV8)", () => {
    // In a UTF-8 locale, bash 4.2's `[0-9]` also matched digits of other scripts, so `is_version`
    // took a version JavaScript refuses. Exported, so `expr` and `sed` read bytes too.
    expect(INSTALL_SCRIPT.startsWith("{\nset -eu\nLC_ALL=C\nexport LC_ALL\n")).toBe(true)
  })

  test("the installer's script is the one features 004 and 005 reviewed", () => {
    // Measured at 03443f2 (specs/006-cli-small-features, T037): `zekno doctor` has a script of its own
    // (server/check-script.ts), so no feature after 005 changes this one unseen.
    expect(INSTALL_SCRIPT.length).toBe(8810)
    expect(sha256(INSTALL_SCRIPT)).toBe("46bbf2f774a427f4e0140e2bd0746a7f2400cc6696ad2526892e0d209996f548")
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

  test("an update names only a file called zekno-runner: any other path throws before anything is placed", () => {
    const update = (runnerPath: string): InstallRequest => ({ mode: "update", version: VERSION, runnerPath, source: { kind: "release", files: [] } })
    for (const path of ["zekno-runner", "/usr/local/bin/zekno-runner", "~/.local/bin/zekno-runner", "/opt/zekno/zekno-runner"]) {
      expect(installWords(update(path))[2]).toBe(path)
    }
    for (const path of ["/usr/sbin/sshd", "/bin/sh", "docker", "/usr/bin/sudo", "~/zekno-runner.sh", "/opt/my-zekno-runner", "/opt/zekno-runner/run"]) {
      expect(() => installWords(update(path))).toThrow("not valid")
    }
  })

  test("a dev version is placed as a word, as a prod version is", () => {
    for (const version of ["0.1.0-dev.1", "0.1.0", "1.0.0-dev.999999999"]) {
      expect(installWords({ mode: "add", version, source: { kind: "release", files: [{ arch: "x64", sha256: SHA }] } })).toEqual(["add", version, "release", "x64", SHA])
    }
  })

  test("each of the four values that does not fit its pattern throws before anything is placed", () => {
    const versions = [...HOSTILE, ...REFUSED_VERSIONS, "1.2", "1.2.3.4", "v1.2.3", "1.2.3-rc1", "01.2.3x"]
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

  test("the transport's own check lets a dev version through as it is", async () => {
    const ssh = sshStandIn(standInServer())
    await withSsh(ssh, async () => {
      const transport = connect({ kind: "ssh", destination: "deploy@example.test", runnerPath: "zekno-runner" }, [], { errorLines: () => {} })
      const child = transport.script!(["add", "0.1.0-dev.1", "release"])
      child.end()
      await child.exited
    })
    expect(ssh.calls()).toEqual(["-- deploy@example.test sh -s -- add 0.1.0-dev.1 release"])
  })

  test("the release files are those with a published checksum, and none without one", () => {
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

describe("what a person is told when the install stops", () => {
  const add: InstallRequest = { mode: "add", version: VERSION, source: { kind: "release", files: [] } }
  const update: InstallRequest = { mode: "update", version: VERSION, runnerPath: "~/.local/bin/zekno-runner", source: { kind: "release", files: [] } }
  const where = { destination: "deploy@example.test", server: "prod" }

  test("no checksum tool, and no room: the sentences of contracts/versions.md, and what is left in an update", () => {
    expect(installFailure("tools", add, where)).toBe(
      "The server has neither sha256sum nor shasum to check the runner with, so nothing was downloaded or installed."
    )
    expect(installFailure("tools", update, where)).toBe(
      "The server has neither sha256sum nor shasum to check the runner with, so nothing was downloaded or installed. The runner that was there is still in place."
    )
    expect(installFailure("space", add, where)).toBe(
      "The server ran out of disk space for the runner. It needs at least 256 MiB free in /usr/local/bin as root, or in ~/.local/bin for another user. Nothing was installed."
    )
    expect(installFailure("space", update, where)).toBe(
      "The server ran out of disk space for the runner. It needs at least 256 MiB free in /usr/local/bin as root, or in ~/.local/bin for another user. The runner that was there is still in place."
    )
    expect(parseInstallLine("fail space")).toEqual({ kind: "fail", reason: "space" })
    expect(parseInstallLine("fail tools")).toEqual({ kind: "fail", reason: "tools" })
  })

  test("what the server lacks to run the runner: the C library or the processor, in the sentences of contracts/versions.md", () => {
    expect(installFailure("libc", add, where)).toBe(
      "This server does not have the GNU C library (glibc) 2.17 or newer that the runner needs. Alpine and other Linux systems with musl are not supported yet. Nothing was installed."
    )
    expect(installFailure("libc", update, where)).toBe(
      "This server does not have the GNU C library (glibc) 2.17 or newer that the runner needs. Alpine and other Linux systems with musl are not supported yet. The runner that was there is still in place."
    )
    expect(installFailure("cpu", add, where)).toBe(
      "This server's processor cannot run the runner. On x86-64 it needs SSE4.2: Intel Nehalem, AMD Bulldozer or newer. Nothing was installed."
    )
    expect(installFailure("cpu", update, where)).toBe(
      "This server's processor cannot run the runner. On x86-64 it needs SSE4.2: Intel Nehalem, AMD Bulldozer or newer. The runner that was there is still in place."
    )
    expect(parseInstallLine("fail libc")).toEqual({ kind: "fail", reason: "libc" })
    expect(parseInstallLine("fail cpu")).toEqual({ kind: "fail", reason: "cpu" })
  })

  test("the line a runner that did not start wrote reaches the person cleaned, as any line from the server, then the sentence", async () => {
    const server = standInServer()
    const runner = "#!/bin/sh\nprintf 'zekno-runner: \\033[31mversion GLIBC_2.99 not found\\n' >&2\nexit 1\n"
    const sha = server.release(runner)
    const lines: string[] = []
    await withSsh(sshStandIn(server), async () => {
      const transport = connect({ kind: "ssh", destination: "deploy@example.test", runnerPath: "zekno-runner" }, [], { errorLines: (line) => void lines.push(line) })
      await expect(runInstaller(transport, release({ kind: "release", files: [{ arch: "x64", sha256: sha }] }), where)).rejects.toThrow(
        installFailure("libc", add, where)
      )
    })
    expect(lines).toContain("zekno-runner: version GLIBC_2.99 not found")
    expect(existsSync(server.runnerPath)).toBe(false)
  })
})

describe("what the script prints is read strictly", () => {
  test("each of its lines, and nothing else", () => {
    expect(parseInstallLine("connected")).toEqual({ kind: "connected" })
    expect(parseInstallLine("docker ok 2.40.3")).toEqual({ kind: "docker", version: "2.40.3" })
    expect(parseInstallLine("docker ok v5.6.0")).toEqual({ kind: "docker", version: "5.6.0" })
    expect(parseInstallLine("docker ok unknown")).toEqual({ kind: "docker" })
    expect(parseInstallLine("runner found user 0.1.0")).toEqual({ kind: "runner", place: "user", version: "0.1.0" })
    expect(parseInstallLine("runner found path unknown")).toEqual({ kind: "runner", place: "path" })
    expect(parseInstallLine("runner found user 0.1.0-dev.1")).toEqual({ kind: "runner", place: "user", version: "0.1.0-dev.1" })
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
      "runner found user 0.1.0-dev.0",
      "runner found user 01.1.0",
      "runner found user 0.1.0-rc.1",
      "runner found user 0.1.0 ",
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
