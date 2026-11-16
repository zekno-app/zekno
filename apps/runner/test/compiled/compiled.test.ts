/**
 * The compiled runner reads no configuration from the folder it is started
 * in (specs/005-runner-release/research.md, R16). A program compiled by Bun
 * loads `.env` and runs `bunfig.toml` (with its `preload` scripts) from its
 * working folder unless it was built not to. Over SSH the runner starts in
 * the login user's home folder, so a `~/.env` could move its folder or point
 * it at another Docker, and a `~/bunfig.toml` could run code in it.
 *
 * The runner is compiled once here, with the words of its own `compile`
 * script, into a temporary folder.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import pkg from "../../package.json"
import { RUNNER_MAIN, tempDir } from "../support/helpers"

const AUTOLOAD_OFF = [
  "--no-compile-autoload-dotenv",
  "--no-compile-autoload-bunfig",
]
const AUTOLOAD_ON = [
  "--compile-autoload-dotenv",
  "--compile-autoload-bunfig",
  "--compile-autoload-tsconfig",
  "--compile-autoload-package-json",
]

let binary = ""

beforeAll(async () => {
  const words = pkg.scripts.compile.split(" ")
  expect(words.slice(0, 3)).toEqual(["bun", "build", "--compile"])
  const at = words.indexOf("--outfile")
  binary = join(tempDir("compiled-runner"), "zekno-runner")
  const argv = [process.execPath, ...words.slice(1, at), "--outfile", binary]
  const build = Bun.spawn(argv, {
    cwd: join(import.meta.dir, "../.."),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, err] = await Promise.all([
    build.exited,
    new Response(build.stderr).text(),
  ])
  if (code !== 0) throw new Error(`the runner did not compile: ${err}`)
}, 120_000)

/**
 * A folder someone else prepared: a `.env` that moves the runner's folder to
 * one with a damaged state, and a `bunfig.toml` whose preload writes a marker.
 */
function hostileFolder() {
  const dir = tempDir("hostile")
  const marker = join(tempDir("marker"), "ran")
  const elsewhere = join(dir, "elsewhere")
  mkdirSync(elsewhere)
  chmodSync(elsewhere, 0o700)
  writeFileSync(join(elsewhere, "state.json"), "not a state")
  writeFileSync(
    join(dir, ".env"),
    `ZEKNO_RUNNER_HOME=${elsewhere}\nZEKNO_DOCKER=${join(dir, "docker")}\n`
  )
  writeFileSync(join(dir, "bunfig.toml"), 'preload = ["./evil.ts"]\n')
  writeFileSync(
    join(dir, "evil.ts"),
    `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")\n`
  )
  return { dir, marker }
}

/** Runs `argv` in `cwd` with an empty home folder and nothing of this process's environment but PATH. */
async function inFolder(cwd: string, argv: string[]) {
  const child = Bun.spawn(argv, {
    cwd,
    env: { HOME: tempDir("home"), PATH: process.env.PATH ?? "/usr/bin:/bin" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code: await child.exited, stdout, stderr }
}

describe("the compiled runner reads no configuration from the folder it starts in", () => {
  test("each compile script turns .env and bunfig.toml off, and turns nothing on", () => {
    for (const name of [
      "compile",
      "compile:linux-x64",
      "compile:linux-arm64",
    ] as const) {
      const words = pkg.scripts[name].split(" ")
      for (const flag of AUTOLOAD_OFF)
        expect({ name, flag, has: words.includes(flag) }).toEqual({
          name,
          flag,
          has: true,
        })
      for (const flag of AUTOLOAD_ON)
        expect({ name, flag, has: words.includes(flag) }).toEqual({
          name,
          flag,
          has: false,
        })
    }
  })

  test("version: it answers as usual, and the folder's preload never runs", async () => {
    const { dir, marker } = hostileFolder()
    const run = await inFolder(dir, [binary, "version"])
    expect(run).toEqual({
      code: 0,
      stdout: `${JSON.stringify({ version: pkg.version, protocol: 2 })}\n`,
      stderr: "",
    })
    expect(existsSync(marker)).toBe(false)
  })

  test("status: the folder the .env names is not used, so it is not set up", async () => {
    const { dir, marker } = hostileFolder()
    const run = await inFolder(dir, [binary, "status"])
    expect(run.stdout).toBe('{"outcome":"refused","reason":"not_set_up"}\n')
    expect(existsSync(marker)).toBe(false)
  })

  test("the same folder does reach the runner run from source, as Bun does for a development checkout", async () => {
    // Shows the folder above is one Bun reads: a negative result for the compiled runner means something.
    const { dir, marker } = hostileFolder()
    const run = await inFolder(dir, [process.execPath, RUNNER_MAIN, "status"])
    expect(run.stdout).toBe('{"outcome":"refused","reason":"invalid_state"}\n')
    expect(existsSync(marker)).toBe(true)
  })
})
