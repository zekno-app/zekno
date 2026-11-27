/**
 * The saved output of an app's last build (specs/016-build-from-source,
 * data-model.md, "The saved build output"; contracts/cli.md CL9; FR-071a;
 * tasks T109): `builds/<server id>/<app>.log` in the profile folder, mode
 * 600, appended to `<app>.log.<random>` as lines come and renamed over the
 * old file when the deploy ends; its first line names the deploy, the
 * server and the time; at most 32 MiB, the oldest lines dropped and their
 * count in that first line; the raw text kept. Each test has a profile
 * folder of its own, never `~/.zekno`.
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
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  BUILD_OUTPUT_BYTES,
  BUILD_OUTPUTS,
  readBuildOutput,
  startBuildOutput,
  type BuildOutputHead,
} from "../../src/profile/build-output"

const home = () => mkdtempSync(join(tmpdir(), "zekno-build-output-"))
const mode = (path: string) => statSync(path).mode & 0o777
const PROD = `srv_${"a".repeat(32)}`
const STAGING = `srv_${"b".repeat(32)}`
const HEAD = { deploy: 7, server: "prod", at: "2026-11-28T10:00:00.000Z" }
const folderOf = (at: string, server = PROD) => join(at, BUILD_OUTPUTS, server)

describe("startBuildOutput", () => {
  test("lines go to a file of their own while the deploy runs, then replace the old file; mode 600 in folders of mode 700", () => {
    const at = home()
    const first = startBuildOutput(at, PROD, "shop", HEAD)
    first.line("#1 [internal] load build definition from Dockerfile")
    first.end()
    expect(readBuildOutput(at, PROD, "shop")).toEqual({
      head: { ...HEAD, dropped: 0 },
      lines: ["#1 [internal] load build definition from Dockerfile"],
    })
    const second = startBuildOutput(at, PROD, "shop", { ...HEAD, deploy: 8 })
    second.line("#1 the next build")
    // The old file is the saved one until the deploy ends; the lines so far are in a file beside it.
    expect(readBuildOutput(at, PROD, "shop")?.head.deploy).toBe(7)
    const beside = readdirSync(folderOf(at)).filter((name) =>
      /^shop\.log\.[0-9a-f]{32}$/.test(name)
    )
    expect(beside).toHaveLength(1)
    expect(readFileSync(join(folderOf(at), beside[0]!), "utf8")).toContain(
      "#1 the next build\n"
    )
    second.line("#2 done")
    second.end()
    expect(readBuildOutput(at, PROD, "shop")).toEqual({
      head: { ...HEAD, deploy: 8, dropped: 0 },
      lines: ["#1 the next build", "#2 done"],
    })
    expect(readdirSync(folderOf(at))).toEqual(["shop.log"])
    expect(mode(join(folderOf(at), "shop.log"))).toBe(0o600)
    expect(mode(join(at, BUILD_OUTPUTS))).toBe(0o700)
    expect(mode(folderOf(at))).toBe(0o700)
  })

  test("a deploy that ends without its output, `discard`: the old file stays, and nothing is left beside it", () => {
    const at = home()
    const first = startBuildOutput(at, PROD, "shop", HEAD)
    first.line("kept")
    first.end()
    const second = startBuildOutput(at, PROD, "shop", { ...HEAD, deploy: 8 })
    second.line("not kept")
    second.discard()
    expect(readBuildOutput(at, PROD, "shop")?.lines).toEqual(["kept"])
    expect(readdirSync(folderOf(at))).toEqual(["shop.log"])
  })

  test("the raw text is kept: an escape sequence stays as the builder wrote it", () => {
    const at = home()
    const osc52 = "step \u001b]52;c;ZXZpbA==\u0007 done"
    const output = startBuildOutput(at, PROD, "shop", HEAD)
    output.line(osc52)
    output.end()
    expect(readBuildOutput(at, PROD, "shop")?.lines).toEqual([osc52])
  })

  test("the same app on two servers is kept apart", () => {
    const at = home()
    const prod = startBuildOutput(at, PROD, "shop", HEAD)
    const staging = startBuildOutput(at, STAGING, "shop", {
      ...HEAD,
      server: "staging",
    })
    prod.line("on prod")
    staging.line("on staging")
    staging.end()
    prod.end()
    expect(readBuildOutput(at, PROD, "shop")?.lines).toEqual(["on prod"])
    expect(readBuildOutput(at, STAGING, "shop")).toEqual({
      head: { ...HEAD, server: "staging", dropped: 0 },
      lines: ["on staging"],
    })
    expect(readBuildOutput(at, PROD, "blog")).toBeUndefined()
  })

  test("at most 32 MiB: the oldest lines go, and the first line says how many", () => {
    const at = home()
    const output = startBuildOutput(at, PROD, "shop", HEAD)
    const line = (index: number) =>
      `${String(index).padStart(8, "0")} ${"x".repeat(4000)}`
    // Past twice the bound, so the file beside is cut while the deploy runs as well.
    const count = Math.ceil((2.5 * BUILD_OUTPUT_BYTES) / 4010)
    for (let index = 0; index < count; index++) output.line(line(index))
    output.end()
    const path = join(folderOf(at), "shop.log")
    expect(statSync(path).size).toBeLessThanOrEqual(BUILD_OUTPUT_BYTES)
    const saved = readBuildOutput(at, PROD, "shop")!
    const kept = saved.lines.length
    expect(saved.head.dropped).toBe(count - kept)
    expect(saved.lines[0]).toBe(line(count - kept))
    expect(saved.lines.at(-1)).toBe(line(count - 1))
    // Within one line of the bound: no more is dropped than needs to be.
    expect(statSync(path).size + 4010).toBeGreaterThan(BUILD_OUTPUT_BYTES)
  })

  test("a link in the place of a folder is replaced, never followed", () => {
    const at = home()
    const elsewhere = mkdtempSync(join(tmpdir(), "zekno-elsewhere-"))
    mkdirSync(join(at, BUILD_OUTPUTS), { recursive: true })
    symlinkSync(elsewhere, folderOf(at))
    const output = startBuildOutput(at, PROD, "shop", HEAD)
    output.line("here")
    output.end()
    expect(lstatSync(folderOf(at)).isDirectory()).toBe(true)
    expect(readdirSync(elsewhere)).toEqual([])
    expect(readBuildOutput(at, PROD, "shop")?.lines).toEqual(["here"])
  })
})

describe("readBuildOutput", () => {
  const plant = (at: string, text: string | Buffer) => {
    mkdirSync(folderOf(at), { recursive: true })
    writeFileSync(join(folderOf(at), "shop.log"), text)
  }
  const head = (fields: BuildOutputHead) => JSON.stringify(fields)

  test("nothing saved, or a file that is not a saved output: undefined", () => {
    const at = home()
    expect(readBuildOutput(at, PROD, "shop")).toBeUndefined()
    for (const text of [
      "",
      "a line\n",
      `${head({ ...HEAD, dropped: 0 }).slice(1)}\nline\n`,
      `${JSON.stringify({ ...HEAD, dropped: -1 })}\nline\n`,
      Buffer.from([0xff, 0x0a]),
    ]) {
      plant(at, text)
      expect(readBuildOutput(at, PROD, "shop")).toBeUndefined()
    }
  })

  test("a link in its place is not read", () => {
    const at = home()
    const elsewhere = join(home(), "elsewhere.log")
    writeFileSync(elsewhere, `${head({ ...HEAD, dropped: 0 })}\nline\n`)
    mkdirSync(folderOf(at), { recursive: true })
    symlinkSync(elsewhere, join(folderOf(at), "shop.log"))
    expect(readBuildOutput(at, PROD, "shop")).toBeUndefined()
    expect(existsSync(elsewhere)).toBe(true)
  })

  test("a name that is not an app's or a server id's is never a path: nothing saved to read, and nothing written", () => {
    const at = home()
    expect(readBuildOutput(at, PROD, "../shop")).toBeUndefined()
    expect(readBuildOutput(at, "../srv", "shop")).toBeUndefined()
    expect(() => startBuildOutput(at, PROD, "../shop", HEAD)).toThrow()
    expect(() => startBuildOutput(at, "srv_x/..", "shop", HEAD)).toThrow()
    expect(existsSync(join(at, BUILD_OUTPUTS))).toBe(false)
  })

  test("a file past the bound is not read", () => {
    const at = home()
    plant(
      at,
      `${head({ ...HEAD, dropped: 0 })}\n${"x".repeat(BUILD_OUTPUT_BYTES)}\n`
    )
    expect(readBuildOutput(at, PROD, "shop")).toBeUndefined()
  })
})
