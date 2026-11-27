/**
 * `stand-in-files.ts` (specs/016-build-from-source, T015 and T016): the
 * calls that write, read and remove a file in the stand-in, the text on
 * standard input or output only, and the scripts run here by `sh` against a
 * temporary folder of this machine. A stand-in function answers for the
 * stand-in in the other tests; nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Answer, RunOptions } from "../host/host-docker"
import type { InStandIn } from "./rb7"
import {
  READ_SCRIPT,
  readInStandIn,
  removeInStandIn,
  WRITE_SCRIPT,
  writeInStandIn,
} from "./stand-in-files"

function fakeRun(reply: Partial<Answer> = {}) {
  const calls: { args: readonly string[]; options?: RunOptions }[] = []
  const run: InStandIn = async (args, options) => {
    calls.push({ args, options })
    return { code: 0, stdout: "", stderr: "", ...reply }
  }
  return { run, calls }
}

describe("the calls", () => {
  test("write sends the text on standard input, never in an argument", async () => {
    const { run, calls } = fakeRun()
    await writeInStandIn(run, "/root/.docker/config.json", '{"a":"marker"}')
    expect(calls).toEqual([
      {
        args: ["sh", "-c", WRITE_SCRIPT, "sh", "/root/.docker/config.json"],
        options: { stdin: { text: '{"a":"marker"}' } },
      },
    ])
  })

  test("read gives the text, or undefined when there is no file", async () => {
    expect(await readInStandIn(fakeRun({ stdout: "text" }).run, "/a")).toBe(
      "text"
    )
    expect(await readInStandIn(fakeRun({ code: 3 }).run, "/a")).toBeUndefined()
    const { calls, run } = fakeRun()
    await readInStandIn(run, "/a/b")
    expect(calls[0]!.args).toEqual(["sh", "-c", READ_SCRIPT, "sh", "/a/b"])
  })

  test("remove is rm -f of the one path", async () => {
    const { run, calls } = fakeRun()
    await removeInStandIn(run, "/tmp/zekno-check-x/a")
    expect(calls[0]!.args).toEqual(["rm", "-f", "--", "/tmp/zekno-check-x/a"])
  })

  test("a failure names the file, never its text", async () => {
    const failing = fakeRun({
      code: 1,
      stdout: "the text",
      stderr: "denied",
    }).run
    await expect(writeInStandIn(failing, "/a", "the text")).rejects.toThrow(
      "writing /a in the stand-in failed (exit 1): denied"
    )
    await expect(readInStandIn(failing, "/a")).rejects.toThrow(
      "reading /a in the stand-in failed (exit 1): denied"
    )
    await expect(removeInStandIn(failing, "/a")).rejects.toThrow(
      "removing /a in the stand-in failed (exit 1): denied"
    )
  })

  test("a path that is not plain and absolute is refused before any call", async () => {
    const { run, calls } = fakeRun()
    for (const path of ["relative", "/a/../b", "/a b", "/a\nb", "/a;b"]) {
      await expect(writeInStandIn(run, path, "")).rejects.toThrow(
        "not a plain absolute path"
      )
      await expect(readInStandIn(run, path)).rejects.toThrow(
        "not a plain absolute path"
      )
      await expect(removeInStandIn(run, path)).rejects.toThrow(
        "not a plain absolute path"
      )
    }
    expect(calls).toEqual([])
  })
})

describe("the scripts, run by sh here", () => {
  test("write makes the folder, replaces the file whole, mode 0600; read gives it back, or 3", () => {
    const folder = mkdtempSync(join(tmpdir(), "zekno-stand-in-files-"))
    try {
      const file = join(folder, "made", "config.json")
      const write = (text: string) =>
        Bun.spawnSync(["sh", "-c", WRITE_SCRIPT, "sh", file], {
          stdin: new TextEncoder().encode(text),
        }).exitCode
      expect(write("first")).toBe(0)
      expect(write("second")).toBe(0)
      expect(readFileSync(file, "utf8")).toBe("second")
      expect(statSync(file).mode & 0o777).toBe(0o600)
      expect(existsSync(`${file}.zekno-part`)).toBe(false)
      const read = (path: string) =>
        Bun.spawnSync(["sh", "-c", READ_SCRIPT, "sh", path])
      expect(read(file).stdout.toString()).toBe("second")
      expect(read(join(folder, "none")).exitCode).toBe(3)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
