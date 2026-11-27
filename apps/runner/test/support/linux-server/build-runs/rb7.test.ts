/**
 * `rb7.ts` (specs/016-build-from-source, T011; contracts/runner.md, RB7):
 * one build in the stand-in, step by step, and the removal of what builds
 * made; and that a check finds the list, the pack and the reading of
 * buildx's output in this one file. A stand-in function answers for the
 * stand-in; nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { dirname } from "node:path"

import * as output from "./builder-output"
import type { Answer, RunOptions } from "../host/host-docker"
import * as pack from "./pack-tar"
import * as rb7 from "./rb7"
import {
  type InStandIn,
  packOf,
  rb7Args,
  rb7Build,
  rb7Command,
  rb7Env,
  type Rb7Options,
  refOf,
  removeImages,
  removeRecords,
  secretFileOf,
} from "./rb7"
import * as args from "./rb7-args"
import { WRITE_SCRIPT } from "./stand-in-files"

const WORK = "/tmp/zekno-check-x/k1"
const HOME = "/tmp/zekno-check-x/home"
const TOKEN = "0123456789abcdef0123456789abcdef"
const BASE: Rb7Options = {
  app: "web",
  key: "k1",
  dockerfile: "Dockerfile",
  network: "default",
  work: WORK,
}
const FILES = [
  { path: "Dockerfile", data: "FROM scratch\nCOPY a /a\n" },
  { path: "a", data: "a\n" },
]

type Seen = {
  readonly args: readonly string[]
  readonly options: RunOptions | undefined
  /** The bytes of the file on standard input, read during the call. */
  readonly stdin: Uint8Array | undefined
}

/** Stands in for `open.inStandIn`: records each call and answers as `answer` says. */
function fakeRun(
  answer: (args: readonly string[]) => Partial<Answer> | undefined = () =>
    undefined
) {
  const calls: Seen[] = []
  const run: InStandIn = async (args, options) => {
    const input = options?.stdin
    calls.push({
      args,
      options,
      stdin:
        input !== undefined && "file" in input
          ? new Uint8Array(readFileSync(input.file))
          : undefined,
    })
    return { code: 0, stdout: "", stderr: "", ...answer(args) }
  }
  return { run, calls }
}

describe("rb7.ts, as a check imports it", () => {
  test("gives the list, the environment, the pack and the reading of buildx's output", () => {
    for (const module of [args, pack, output])
      for (const [name, value] of Object.entries(module))
        expect({
          name,
          same: (rb7 as Record<string, unknown>)[name] === value,
        }).toEqual({ name, same: true })
  })
})

describe("a build in the stand-in", () => {
  test("empties its work folder, sends the pack on standard input with RB7's list and environment, and reads meta.json", async () => {
    const { run, calls } = fakeRun((args) =>
      args[0] === "cat"
        ? { stdout: '{"buildx.build.ref":"default/default/r1abcdefghij"}' }
        : undefined
    )
    const built = await rb7Build(run, {
      options: BASE,
      home: HOME,
      files: FILES,
      run: TOKEN,
      timeoutMs: 120_000,
    })
    expect(built.built).toBe(true)
    expect(built.error).toBeUndefined()
    expect(refOf(built.metadata)).toBe("r1abcdefghij")
    expect(calls.map((call) => call.args.slice(0, 3))).toEqual([
      ["rm", "-rf", WORK],
      ["mkdir", "-p", WORK],
      ["timeout", "-k", "5"],
      ["cat", `${WORK}/meta.json`],
    ])
    expect(calls[1]!.args).toEqual(["mkdir", "-p", WORK, `${HOME}/buildx`])
    const build = calls[2]!
    expect(build.args).toEqual([
      ...["timeout", "-k", "5", "120", "env", "-i", `--chdir=${WORK}`],
      ...Object.entries(rb7Env({ home: HOME, run: TOKEN })).map(
        ([name, value]) => `${name}=${value}`
      ),
      ...rb7Args(BASE),
    ])
    expect(build.options?.timeoutMs).toBe(180_000)
    expect(build.stdin).toEqual(packOf(FILES))
    const file = (build.options?.stdin as { file: string }).file
    expect(existsSync(dirname(file))).toBe(false)
  })

  test("a secret's value goes on standard input into its own file, never in an argument, and the file is removed after", async () => {
    const VALUE = "zekno-l12-0123456789abcdef0123456789abcdef"
    const { run, calls } = fakeRun()
    expect(
      (
        await rb7Build(run, {
          options: { ...BASE, secrets: ["NPM_TOKEN"] },
          home: HOME,
          files: FILES,
          run: TOKEN,
          secrets: [VALUE],
          timeoutMs: 120_000,
        })
      ).built
    ).toBe(true)
    const secretFile = secretFileOf(WORK, 0)
    expect(secretFile).toBe(`${WORK}/zekno-secret-0`)
    expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
      ["rm", "-rf"],
      ["mkdir", "-p"],
      ["sh", "-c"],
      ["sh", "-c"],
      ["rm", "-f"],
      ["cat", `${WORK}/meta.json`],
    ])
    expect(calls[2]!.args).toEqual(["sh", "-c", WRITE_SCRIPT, "sh", secretFile])
    expect(calls[2]!.options?.stdin).toEqual({ text: VALUE })
    expect(calls[3]!.args).toEqual(
      rb7Command(
        rb7Args({ ...BASE, secrets: ["NPM_TOKEN"] }),
        rb7Env({ home: HOME, run: TOKEN }),
        {
          work: WORK,
          timeoutSeconds: 120,
          secretFiles: [secretFile],
        }
      )
    )
    expect(calls[3]!.stdin).toEqual(packOf(FILES))
    expect(calls[4]!.args).toEqual(["rm", "-f", "--", secretFile])
    for (const call of calls) expect(call.args.join(" ")).not.toContain(VALUE)
    await expect(
      rb7Build(run, {
        options: { ...BASE, secrets: ["NPM_TOKEN"] },
        home: HOME,
        files: FILES,
        secrets: ["a\0b"],
      })
    ).rejects.toThrow("holds a NUL")
  })

  test("puts a flag a check adds before the final -, and makes a run token when none is given", async () => {
    const { run, calls } = fakeRun()
    await rb7Build(run, {
      options: BASE,
      home: HOME,
      files: FILES,
      extra: ["--iidfile", `${WORK}/iid`],
    })
    const list = calls[2]!.args
    expect(list.slice(-4)).toEqual([
      "--progress=rawjson",
      "--iidfile",
      `${WORK}/iid`,
      "-",
    ])
    expect(list.find((arg) => arg.startsWith("ZEKNO_BUILD_RUN="))).toMatch(
      /^ZEKNO_BUILD_RUN=[0-9a-f]{32}$/
    )
  })

  test("gives the builder's first error, the time limit, or the host's stop", async () => {
    const failed = fakeRun((args) =>
      args[0] === "timeout"
        ? { code: 1, stderr: "ERROR: failed to build: no frontend\n" }
        : args[0] === "cat"
          ? { code: 1, stderr: "cat: no such file" }
          : undefined
    )
    expect(
      await rb7Build(failed.run, { options: BASE, home: HOME, files: FILES })
    ).toMatchObject({
      built: false,
      error: "failed to build: no frontend",
      metadata: undefined,
    })
    const slow = fakeRun((args) =>
      args[0] === "timeout" ? { code: 124 } : undefined
    )
    const limited = await rb7Build(slow.run, {
      options: BASE,
      home: HOME,
      files: FILES,
      timeoutMs: 1500,
    })
    expect(limited.error).toBe("stopped at its time limit of 2 s")
    const killed = fakeRun((args) =>
      args[0] === "timeout" ? { code: -1 } : undefined
    )
    expect(
      (await rb7Build(killed.run, { options: BASE, home: HOME, files: FILES }))
        .error
    ).toBe("the call was stopped on the host after 360 s")
    const odd = fakeRun((args) =>
      args[0] === "cat" ? { stdout: "[1]" } : undefined
    )
    expect(
      (await rb7Build(odd.run, { options: BASE, home: HOME, files: FILES }))
        .metadata
    ).toBeUndefined()
  })

  test("refuses before any call a secret without its value or a flag RB7 never passes, and says when its folder cannot be emptied", async () => {
    const { run, calls } = fakeRun((args) =>
      args[0] === "rm" ? { code: 1, stderr: "rm: busy" } : undefined
    )
    await expect(
      rb7Build(run, {
        options: { ...BASE, secrets: ["NPM_TOKEN"] },
        home: HOME,
        files: FILES,
      })
    ).rejects.toThrow("a value is given for each secret")
    await expect(
      rb7Build(run, {
        options: BASE,
        home: HOME,
        files: FILES,
        extra: ["--load"],
      })
    ).rejects.toThrow("never passes --load")
    await expect(
      rb7Build(run, {
        options: BASE,
        home: HOME,
        files: [{ path: "../x", data: "" }],
      })
    ).rejects.toThrow("not a relative ASCII path")
    expect(calls).toEqual([])
    await expect(
      rb7Build(run, { options: BASE, home: HOME, files: FILES })
    ).rejects.toThrow(
      `rm -rf ${WORK} failed in the stand-in (exit 1): rm: busy`
    )
  })
})

describe("removing what the builds made", () => {
  test("images by name: one that is not there is no fault", async () => {
    const { run, calls } = fakeRun((args) =>
      args[3] === "zekno.invalid/web:gone"
        ? { code: 1, stderr: "Error response from daemon: No such image: x" }
        : args[3] === "zekno.invalid/web:held"
          ? { code: 1, stderr: "Error response from daemon: conflict: in use" }
          : undefined
    )
    expect(
      await removeImages(run, [
        "zekno.invalid/web:k1",
        "zekno.invalid/web:gone",
        "zekno.invalid/web:held",
        "zekno.invalid/web:k1",
      ])
    ).toEqual([
      "zekno.invalid/web:held (Error response from daemon: conflict: in use)",
    ])
    expect(calls.map((call) => call.args)).toEqual([
      ["docker", "image", "rm", "zekno.invalid/web:k1"],
      ["docker", "image", "rm", "zekno.invalid/web:gone"],
      ["docker", "image", "rm", "zekno.invalid/web:held"],
    ])
  })

  test("records by their ids: those given and those buildx kept in the check's own BUILDX_CONFIG", async () => {
    const { run, calls } = fakeRun((args) =>
      args[0] === "sh"
        ? { stdout: "r2abcdefghij\nr1abcdefghij\n\n" }
        : undefined
    )
    expect(
      await removeRecords(run, HOME, ["r1abcdefghij", undefined, "../x"])
    ).toEqual([])
    expect(calls[0]!.args.at(-1)).toBe(`${HOME}/buildx/refs/default/default`)
    const remove = calls[1]!.args
    expect(remove.slice(0, 2)).toEqual(["env", "-i"])
    expect(remove).toContain(`BUILDX_CONFIG=${HOME}/buildx`)
    expect(remove.slice(-8)).toEqual([
      ...["docker", "buildx", "history", "rm", "--builder", "default"],
      ...["r1abcdefghij", "r2abcdefghij"],
    ])

    const none = fakeRun()
    expect(await removeRecords(none.run, HOME)).toEqual([])
    expect(none.calls).toHaveLength(1)

    const old = fakeRun((args) =>
      args.includes("history")
        ? { code: 1, stderr: "unknown command" }
        : undefined
    )
    expect(await removeRecords(old.run, HOME, ["r1abcdefghij"])).toEqual([
      "r1abcdefghij",
    ])
  })
})
