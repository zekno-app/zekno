/**
 * `released-runner.ts` (specs/016-build-from-source, T021; check L1): the
 * release file for the stand-in's processor and the SHA-256 recorded for
 * it, the download over HTTPS only with no token, the runner put in place
 * and taken back (both scripts run here with this machine's own `sh`, in a
 * temporary folder), the Compose texts that ask for a build, and the
 * reading of the runner's answers. Nothing here runs Docker or reaches the
 * network.
 */
import { describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  answerOf,
  appOf,
  archOf,
  BUILD_CASES,
  caseWords,
  composeText,
  DOCKER_CONFIG,
  downloadScript,
  hashIn,
  imageOf,
  INLINE_DOCKERFILE,
  lastWords,
  mismatchLine,
  networkOf,
  newLines,
  placeScript,
  projectOf,
  recordedHash,
  releaseUrl,
  restoreScript,
  RUNNER,
  RUNNER_HOME,
  runnerCommand,
  RUNNER_MAX_BYTES,
  sequenceOf,
  sessionLine,
  unpackLines,
} from "./released-runner"

const X64 = "717f041499890b387084bb1371ec601a4490e482496c8af23a261f9096191613"
const ARM64 = "984f60c1c046465d85aeb47a3e49a4c84721ef1f12c892d3c01f1df9de47efc3"
/** apps/cli/src/version/runner-release.json as commit ee40f7d recorded it (`git show`). */
const RELEASE_JSON = JSON.stringify({
  version: "0.1.1",
  files: { "linux-x64": { sha256: X64 }, "linux-arm64": { sha256: ARM64 } },
})

describe("the release file", () => {
  test("is the one for the stand-in's processor, at the address zekno installs from", () => {
    expect(archOf("x86_64\n")).toBe("x64")
    expect(archOf("aarch64")).toBe("arm64")
    expect(() => archOf("riscv64")).toThrow(
      'L1 stopped: the stand-in\'s processor "riscv64" has no runner 0.1.1'
    )
    expect(releaseUrl("x64")).toBe(
      "https://github.com/zekno-app/zekno/releases/download/runner-v0.1.1/zekno-runner-linux-x64.gz"
    )
    expect(releaseUrl("arm64")).toBe(
      "https://github.com/zekno-app/zekno/releases/download/runner-v0.1.1/zekno-runner-linux-arm64.gz"
    )
  })

  test("is held to the SHA-256 ee40f7d recorded; anything else stops with one line", () => {
    expect(recordedHash(RELEASE_JSON, "x64")).toBe(X64)
    expect(recordedHash(RELEASE_JSON, "arm64")).toBe(ARM64)
    const other = JSON.stringify({
      version: "0.1.2",
      files: { "linux-x64": { sha256: X64 } },
    })
    for (const json of [
      other,
      JSON.stringify({
        version: "0.1.1",
        files: { "linux-x64": { sha256: null } },
      }),
      "not json",
    ])
      expect(() => recordedHash(json, "x64")).toThrow(/^L1 stopped: [^\n]+$/)
    expect(mismatchLine("x64", "a".repeat(64), X64)).toBe(
      `L1 stopped: the runner 0.1.1 downloaded for linux-x64 has SHA-256 ${"a".repeat(64)}, not ${X64} as ee40f7d recorded`
    )
    expect(hashIn(`${X64}\n`)).toBe(X64)
    expect(hashIn("sha256sum: no such file")).toBeUndefined()
  })

  test("is downloaded over HTTPS only, redirects too, with no token, at most 256 MiB, then checked as gzip, unpacked at most 256 MiB, and hashed", () => {
    const script = downloadScript(releaseUrl("x64"))
    expect(script).toContain(
      "curl --fail --silent --show-error --location --proto =https --proto-redir =https --tlsv1.2 --max-time 300 --max-filesize 268435456"
    )
    expect(RUNNER_MAX_BYTES).toBe(256 * 1024 * 1024)
    const unpack = unpackLines(
      "/tmp/zekno-check-released-runner/zekno-runner.gz",
      "/tmp/zekno-check-released-runner/zekno-runner"
    ).join("\n")
    expect(script).toContain(unpack)
    expect(script.indexOf(unpack)).toBeLessThan(script.indexOf("sha256sum"))
    expect(unpack).toContain("| head -c 268435457 >")
    expect(script).toContain(`'${releaseUrl("x64")}'`)
    expect(script).not.toMatch(/token|authorization|--header|-H /i)
    expect(script.split("\n").at(-1)).toBe(
      "sha256sum /tmp/zekno-check-released-runner/zekno-runner | cut -d ' ' -f 1"
    )
    for (const url of [
      "http://github.com/a.gz",
      "https://example.com/a.gz",
      "https://github.com/a.gz; rm -rf /",
    ])
      expect(() => downloadScript(url)).toThrow(
        "is not a release file on github.com"
      )
  })
})

describe("unpacking the release file", () => {
  const sh = (script: string) =>
    Bun.spawnSync(["sh", "-c", `set -eu\n${script}`], {
      stdout: "pipe",
      stderr: "pipe",
    })

  test("unpacks a file within the bound whole, and stops past it before any hash, leaving nothing unpacked: run here with sh", () => {
    const root = mkdtempSync(join(tmpdir(), "zekno-unpack-"))
    try {
      const gz = join(root, "runner.gz")
      const out = join(root, "runner")
      writeFileSync(gz, Bun.gzipSync(new Uint8Array(1000).fill(7)))
      const fits = sh(unpackLines(gz, out, 1000).join("\n"))
      expect(fits.exitCode).toBe(0)
      expect(readFileSync(out)).toEqual(
        Buffer.from(new Uint8Array(1000).fill(7))
      )
      expect(existsSync(gz)).toBe(false)

      writeFileSync(gz, Bun.gzipSync(new Uint8Array(1001).fill(7)))
      const over = sh(`${unpackLines(gz, out, 1000).join("\n")}\necho hashed`)
      expect(over.exitCode).toBe(1)
      expect(over.stderr.toString()).toBe(
        "the release file unpacks to more than 1000 bytes\n"
      )
      expect(over.stdout.toString()).toBe("")
      expect(existsSync(out)).toBe(false)

      writeFileSync(gz, "not gzip")
      expect(sh(unpackLines(gz, out, 1000).join("\n")).exitCode).not.toBe(0)
      expect(existsSync(out)).toBe(false)
      expect(() => unpackLines(gz, out, 0)).toThrow("whole number of bytes")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("putting the runner in place and taking it back", () => {
  const hasSha256sum =
    Bun.spawnSync(["sh", "-c", "command -v sha256sum"], { stdout: "ignore" })
      .exitCode === 0

  function folder() {
    const root = mkdtempSync(join(tmpdir(), "zekno-released-"))
    const paths = {
      runner: join(root, "zekno-runner"),
      kept: join(root, "zekno-runner.zekno-check-kept"),
      download: join(root, "download"),
    }
    writeFileSync(paths.download, "runner 0.1.1\n")
    const hash = new Bun.CryptoHasher("sha256")
      .update("runner 0.1.1\n")
      .digest("hex")
    return { root, paths, hash }
  }
  const sh = (script: string) =>
    Bun.spawnSync(["sh", "-c", script], { stdout: "pipe", stderr: "pipe" })

  test.skipIf(!hasSha256sum)(
    "keeps the stand-in's runner aside, places the download, and puts the kept one back",
    () => {
      const { root, paths, hash } = folder()
      try {
        writeFileSync(paths.runner, "the commit's runner\n")
        expect(sh(placeScript(paths)).exitCode).toBe(0)
        expect(readFileSync(paths.runner, "utf8")).toBe("runner 0.1.1\n")
        expect(statSync(paths.runner).mode & 0o777).toBe(0o755)
        expect(readFileSync(paths.kept, "utf8")).toBe("the commit's runner\n")
        expect(sh(restoreScript(hash, paths)).exitCode).toBe(0)
        expect(readFileSync(paths.runner, "utf8")).toBe("the commit's runner\n")
        expect(existsSync(paths.kept)).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

  test.skipIf(!hasSha256sum)(
    "never overwrites a runner kept before, and never removes a runner that is not 0.1.1",
    () => {
      const { root, paths, hash } = folder()
      try {
        writeFileSync(paths.kept, "kept earlier\n")
        writeFileSync(paths.runner, "something else\n")
        const placed = sh(placeScript(paths))
        expect(placed.exitCode).toBe(3)
        expect(readFileSync(paths.kept, "utf8")).toBe("kept earlier\n")
        const restored = sh(restoreScript(hash, paths))
        expect(restored.exitCode).toBe(1)
        expect(restored.stderr.toString()).toContain("is not runner 0.1.1")
        expect(readFileSync(paths.runner, "utf8")).toBe("something else\n")
        expect(readFileSync(paths.kept, "utf8")).toBe("kept earlier\n")
        writeFileSync(paths.runner, "runner 0.1.1\n")
        expect(sh(restoreScript(hash, paths)).exitCode).toBe(0)
        expect(readFileSync(paths.runner, "utf8")).toBe("kept earlier\n")
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

  test.skipIf(!hasSha256sum)(
    "with no runner there before, leaves none after",
    () => {
      const { root, paths, hash } = folder()
      try {
        expect(sh(placeScript(paths)).exitCode).toBe(0)
        expect(existsSync(paths.kept)).toBe(false)
        expect(sh(restoreScript(hash, paths)).exitCode).toBe(0)
        expect(existsSync(paths.runner)).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

  test("runs the runner with exactly its home and Docker's configuration in the check's folder", () => {
    expect(runnerCommand("session")).toEqual([
      "env",
      "-i",
      "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "HOME=/root",
      `DOCKER_CONFIG=${DOCKER_CONFIG}`,
      `ZEKNO_RUNNER_HOME=${RUNNER_HOME}`,
      RUNNER,
      "session",
    ])
    expect(() => runnerCommand("apply")).toThrow()
    expect(() => restoreScript("x")).toThrow("64 hex")
  })
})

describe("the deploys", () => {
  test("ask Compose for a build of ., a git address that cannot resolve, and ../.., each with its own name", () => {
    expect(BUILD_CASES.map((item) => item.context)).toEqual([
      ".",
      "https://zekno.invalid/repo.git",
      "../..",
    ])
    expect(composeText(BUILD_CASES[0]!)).toBe(
      [
        "services:",
        "  web:",
        '    image: "zekno.invalid/check-released-dot:1"',
        "    pull_policy: never",
        "    build:",
        '      context: "."',
        '      dockerfile_inline: "FROM scratch\\nLABEL zekno.check=\\"L1\\"\\n"',
        "",
      ].join("\n")
    )
    expect(INLINE_DOCKERFILE).not.toMatch(/COPY|ADD|RUN/)
    expect(composeText(BUILD_CASES[1]!)).toContain(
      'context: "https://zekno.invalid/repo.git"'
    )
    expect([
      appOf("dot"),
      imageOf("dot"),
      projectOf("dot"),
      networkOf("dot"),
    ]).toEqual([
      "check-released-dot",
      "zekno.invalid/check-released-dot:1",
      "zekno-check-released-dot",
      "zekno-check-released-dot_default",
    ])
    expect(sessionLine({ a: 1 })).toBe('{"command":"deploy","input":{"a":1}}\n')
  })
})

describe("reading the answers", () => {
  test("the result and Docker's lines of a session; lines that are not frames are passed over", () => {
    const stdout = [
      JSON.stringify({ event: "progress", line: " web Built" }),
      "not a frame",
      JSON.stringify({
        event: "progress",
        line: "Error response from daemon: no command specified",
      }),
      JSON.stringify({
        result: {
          outcome: "start_failed",
          app: "check-released-dot",
          sequence: 1,
        },
      }),
      "",
    ].join("\n")
    expect(answerOf(stdout)).toEqual({
      result: {
        outcome: "start_failed",
        app: "check-released-dot",
        sequence: 1,
      },
      lines: [" web Built", "Error response from daemon: no command specified"],
    })
    expect(answerOf("")).toEqual({ result: undefined, lines: [] })
  })

  test("what is new after, Compose's last line, and the number the state shows", () => {
    expect(newLines("a\nb\n", "b\nc\na\nc\n")).toEqual(["c"])
    expect(lastWords(["one", "two\u001b[0m", ""])).toBe('"two [0m"')
    expect(lastWords([])).toBe("nothing")
    expect(lastWords(["x".repeat(400)])).toBe(
      JSON.stringify(`${"x".repeat(300)}…`)
    )
    const status = JSON.stringify({
      serverId: "s",
      lastSequence: { "check-released-dot": 1 },
    })
    expect(sequenceOf(status, "check-released-dot")).toBe("number 1 used")
    expect(sequenceOf(status, "check-released-git")).toBe("no number used")
    expect(sequenceOf('{"outcome":"refused","reason":"not_set_up"}', "a")).toBe(
      "no state (refused)"
    )
    expect(sequenceOf("", "a")).toBe("the state could not be read")
  })

  test("words a case for the record line", () => {
    expect(
      caseWords({
        item: BUILD_CASES[0]!,
        result: {
          outcome: "start_failed",
          app: "check-released-dot",
          sequence: 1,
        },
        code: 0,
        lines: ["Error response from daemon: no command specified"],
        built: true,
        images: ["zekno.invalid/check-released-dot:1"],
        containers: [],
        sequence: "number 1 used",
      })
    ).toBe(
      'context .: start_failed, Compose built the image, Compose\'s last line "Error response from daemon: no command specified", images after: zekno.invalid/check-released-dot:1, containers after: none new, state: number 1 used'
    )
    expect(
      caseWords({
        item: BUILD_CASES[2]!,
        result: undefined,
        code: 1,
        lines: [],
        built: false,
        images: [],
        containers: [],
        sequence: "no number used",
      })
    ).toBe(
      "context ../..: no answer (exit 1), no image built, Compose's last line nothing, images after: none new, containers after: none new, state: no number used"
    )
  })
})
