/**
 * This run's own folder (specs/016-build-from-source, data-model.md, "On the
 * developer's machine"; contracts/cli.md CL7 step 11; tasks T109):
 * `tmp/<random>/` in the profile folder, mode 700, deleted when the run
 * ends, Ctrl-C included. There is no single-instance lock, so two runs can
 * overlap: a run deletes only folders in `tmp/` older than 24 hours, never
 * the folder whole. Each test has a profile folder of its own, never
 * `~/.zekno`.
 */
import { describe, expect, test } from "bun:test"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

import {
  openRunFolder,
  RUN_FOLDERS,
  STALE_AFTER_MS,
  withRunFolder,
} from "../../src/profile/run-folder"

const home = () => mkdtempSync(join(tmpdir(), "zekno-run-folder-"))
const mode = (path: string) => statSync(path).mode & 0o777
const HOUR = 60 * 60 * 1000

/** A folder in `tmp/` last changed `age` ago, as an earlier run that never ended leaves it. */
function leftBehind(at: string, name: string, age: number): string {
  const path = join(at, RUN_FOLDERS, name)
  mkdirSync(join(path, "pieces"), { recursive: true })
  writeFileSync(join(path, "pieces", "0"), "sealed")
  const when = new Date(Date.now() - age)
  utimesSync(path, when, when)
  return path
}

describe("openRunFolder", () => {
  test("a folder of its own under tmp/, mode 700 in a tmp/ of mode 700, gone once removed", () => {
    const at = home()
    const run = openRunFolder(at)
    expect(dirname(run.path)).toBe(join(at, RUN_FOLDERS))
    expect(basename(run.path)).toMatch(/^[0-9a-f]{32}$/)
    expect(mode(run.path)).toBe(0o700)
    expect(mode(join(at, RUN_FOLDERS))).toBe(0o700)
    writeFileSync(join(run.path, "piece"), "sealed")
    run.remove()
    expect(existsSync(run.path)).toBe(false)
    // tmp/ stays; removing twice changes nothing.
    expect(existsSync(join(at, RUN_FOLDERS))).toBe(true)
    run.remove()
  })

  test("two runs keep their folders: neither removes the other's, and tmp/ is never emptied", () => {
    const at = home()
    const one = openRunFolder(at)
    const two = openRunFolder(at)
    expect(one.path).not.toBe(two.path)
    expect(existsSync(one.path) && existsSync(two.path)).toBe(true)
    one.remove()
    expect(existsSync(two.path)).toBe(true)
    two.remove()
  })

  test("a folder older than 24 hours goes; a new one stays; nothing but folders is touched", () => {
    const at = home()
    const old = leftBehind(at, "0".repeat(32), 25 * HOUR)
    const recent = leftBehind(at, "1".repeat(32), 23 * HOUR)
    // A file and a link in tmp/, old as they may be, are not folders: left as they are, and the link never followed.
    const elsewhere = mkdtempSync(join(tmpdir(), "zekno-elsewhere-"))
    writeFileSync(join(elsewhere, "keep"), "keep")
    const file = join(at, RUN_FOLDERS, "note")
    writeFileSync(file, "a file")
    const link = join(at, RUN_FOLDERS, "link")
    symlinkSync(elsewhere, link)
    const long = new Date(Date.now() - 48 * HOUR)
    utimesSync(file, long, long)
    const run = openRunFolder(at)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(recent)).toBe(true)
    expect(existsSync(file)).toBe(true)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(elsewhere, "keep"), "utf8")).toBe("keep")
    expect(readdirSync(join(at, RUN_FOLDERS)).sort()).toEqual(
      [basename(recent), basename(run.path), "link", "note"].sort()
    )
    run.remove()
  })

  test("24 hours is the bound: the age is the folder's own time, checked against `now`", () => {
    const at = home()
    const folder = leftBehind(at, "2".repeat(32), 0)
    const { mtimeMs } = statSync(folder)
    openRunFolder(at, mtimeMs + STALE_AFTER_MS).remove()
    expect(existsSync(folder)).toBe(true)
    openRunFolder(at, mtimeMs + STALE_AFTER_MS + 1).remove()
    expect(existsSync(folder)).toBe(false)
  })

  test("a link in the place of tmp/ is replaced by a folder, never followed", () => {
    const at = home()
    const elsewhere = mkdtempSync(join(tmpdir(), "zekno-elsewhere-"))
    symlinkSync(elsewhere, join(at, RUN_FOLDERS))
    const run = openRunFolder(at)
    expect(lstatSync(join(at, RUN_FOLDERS)).isDirectory()).toBe(true)
    expect(readdirSync(elsewhere)).toEqual([])
    run.remove()
  })

  test("withRunFolder removes the folder when the work ends, and when it throws", async () => {
    const at = home()
    let seen = ""
    expect(
      await withRunFolder(at, async (path) => {
        seen = path
        writeFileSync(join(path, "piece"), "sealed")
        return 7
      })
    ).toBe(7)
    expect(existsSync(seen)).toBe(false)
    await expect(
      withRunFolder(at, async (path) => {
        seen = path
        throw new Error("stopped")
      })
    ).rejects.toThrow("stopped")
    expect(existsSync(seen)).toBe(false)
  })
})

/** Runs a process that opens a run folder, says where, and waits or ends as `then` says. */
async function child(at: string, then: string) {
  const module = join(import.meta.dir, "../../src/profile/run-folder.ts")
  const script = `
    import { openRunFolder } from ${JSON.stringify(module)}
    const run = openRunFolder(${JSON.stringify(at)})
    console.log(run.path)
    ${then}
  `
  const proc = Bun.spawn([process.execPath, "--no-env-file", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const reader = proc.stdout.getReader()
  const { value } = await reader.read()
  const path = new TextDecoder().decode(value).trim()
  return { proc, path }
}

describe("the run's end", () => {
  test("a run that ends by itself leaves no folder", async () => {
    const at = home()
    const { proc, path } = await child(at, "process.exitCode = 0")
    expect(await proc.exited).toBe(0)
    expect(path.startsWith(join(at, RUN_FOLDERS))).toBe(true)
    expect(existsSync(path)).toBe(false)
  })

  test("Ctrl-C: the folder goes, and the run still ends by the signal", async () => {
    const at = home()
    const { proc, path } = await child(at, "setInterval(() => {}, 1000)")
    expect(existsSync(path)).toBe(true)
    proc.kill("SIGINT")
    await proc.exited
    expect(proc.signalCode).toBe("SIGINT")
    expect(existsSync(path)).toBe(false)
  })

  test("Ctrl-C where the program handles it itself: the folder goes, and the program's own handler decides", async () => {
    const at = home()
    const { proc, path } = await child(
      at,
      `process.on("SIGINT", () => { console.log("handled"); process.exit(3) })
       setInterval(() => {}, 1000)`
    )
    proc.kill("SIGINT")
    expect(await proc.exited).toBe(3)
    expect(existsSync(path)).toBe(false)
  })
})
