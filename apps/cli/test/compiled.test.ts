/**
 * The compiled zekno reads no configuration from the folder it is started in
 * (specs/005-runner-release/research.md, R16). A program compiled by Bun
 * loads `.env` and runs `bunfig.toml` (with its `preload` scripts) from its
 * working folder unless it was built not to. zekno runs inside project
 * folders, which may be cloned from anyone: such a folder must not be able to
 * run code in zekno or change where it keeps its profile.
 *
 * zekno is compiled once here, with build.ts, into a temporary folder.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../runner/test/helpers"

const BUILD = join(import.meta.dir, "../build.ts")
const MAIN = join(import.meta.dir, "../src/main.ts")

let binary = ""

beforeAll(async () => {
  binary = join(tempDir("compiled-cli"), "zekno")
  const build = Bun.spawn([process.execPath, BUILD, binary], { stdout: "pipe", stderr: "pipe" })
  const [code, err] = await Promise.all([build.exited, new Response(build.stderr).text()])
  if (code !== 0) throw new Error(`zekno did not compile: ${err}`)
}, 120_000)

/**
 * A cloned project folder someone else prepared: a `.env` that points zekno's
 * profile at a folder of theirs, and a `bunfig.toml` whose preload writes a
 * marker.
 */
function hostileFolder() {
  const dir = tempDir("hostile-project")
  const marker = join(tempDir("marker"), "ran")
  const theirs = join(dir, "their-profile")
  mkdirSync(theirs)
  writeFileSync(join(theirs, "profile.json"), "not a profile")
  writeFileSync(join(dir, ".env"), `ZEKNO_HOME=${theirs}\n`)
  writeFileSync(join(dir, "bunfig.toml"), 'preload = ["./evil.ts"]\n')
  writeFileSync(join(dir, "evil.ts"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")\n`)
  return { dir, marker }
}

/**
 * Runs `argv` in `cwd` with an empty home folder and nothing of this
 * process's environment but PATH. With no profile there, zekno stops before
 * it would read the keychain.
 */
async function inFolder(cwd: string, argv: string[]) {
  const child = Bun.spawn(argv, { cwd, env: { HOME: tempDir("home"), PATH: process.env.PATH ?? "/usr/bin:/bin" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code: await child.exited, stdout, stderr }
}

const NO_TEAM = "No team on this machine yet. Run `zekno init --name <you>` first.\n"

describe("the compiled zekno reads no configuration from the folder it starts in", () => {
  test("build.ts turns every config file a compiled program could read off", () => {
    const source = readFileSync(BUILD, "utf8")
    for (const option of ["autoloadDotenv", "autoloadBunfig", "autoloadTsconfig", "autoloadPackageJson"]) expect(source).toContain(`${option}: false,`)
  })

  test("--help: it answers as usual, and the folder's preload never runs", async () => {
    const { dir, marker } = hostileFolder()
    const run = await inFolder(dir, [binary, "--help"])
    expect(run.code).toBe(0)
    expect(run.stdout).toStartWith("zekno: deploy to your own servers.")
    expect(run.stderr).toBe("")
    expect(existsSync(marker)).toBe(false)
  })

  test("the profile the .env names is not used", async () => {
    const { dir, marker } = hostileFolder()
    const run = await inFolder(dir, [binary, "server", "ls"])
    expect(run).toEqual({ code: 1, stdout: "", stderr: NO_TEAM })
    expect(existsSync(marker)).toBe(false)
  })

  test("the same folder does reach zekno run from source, as Bun does for a development checkout", async () => {
    // Shows the folder above is one Bun reads: a negative result for the compiled zekno means something.
    const { dir, marker } = hostileFolder()
    const run = await inFolder(dir, [process.execPath, MAIN, "server", "ls"])
    expect(run.stderr).toBe(`The profile at ${join(dir, "their-profile", "profile.json")} is not readable.\n`)
    expect(existsSync(marker)).toBe(true)
  })
})
