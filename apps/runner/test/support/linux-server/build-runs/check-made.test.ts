/**
 * `check-made.ts` (specs/016-build-from-source, T012 to T014): the record
 * first, then the removal by name of everything a check noted, also after
 * its failure, each part whatever an earlier one threw, with a stand-in
 * function for the stand-in. Nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"

import { DU_ARGS } from "./build-cache"
import {
  cleanUp,
  newMade,
  prepare,
  recordCheck,
  type RecordDeps,
} from "./check-made"
import type { Answer } from "../host/host-docker"
import { TAGGED_SCRIPT } from "./stand-in-processes"

const HOME = "/tmp/zekno-check-x/home"
const ROOT = "/tmp/zekno-check-x"
const BASE =
  "busybox@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662"
const OLD = "ooooooooooooooooooooooooo"
const NEW = "nnnnnnnnnnnnnnnnnnnnnnnnn"

type Reply = Partial<Answer> | undefined

/** A stand-in that answers every call with success unless `reply` says otherwise. */
function stand(reply: (args: readonly string[]) => Reply = () => undefined) {
  const calls: string[][] = []
  const run = async (args: readonly string[]): Promise<Answer> => {
    calls.push([...args])
    const answer = reply(args)
    return { code: 0, stdout: "", stderr: "", ...answer }
  }
  return { run, calls }
}

/** What a call does, in a word, for the order. */
const kind = (args: readonly string[]) => {
  const docker = args.indexOf("docker")
  if (args[2] === TAGGED_SCRIPT) return "list processes"
  if (args[2]?.startsWith("kill")) return "kill"
  if (args[0] === "sh" && args.at(-1)?.endsWith("/refs/default/default"))
    return "list records"
  if (args[0] === "rm") return `rm ${args.at(-1)}`
  return args.slice(docker, docker + 3).join(" ")
}

describe("the removal of what a check made", () => {
  test("in order, each by its name: processes, containers, images, records, cache, the pulled base, folders", async () => {
    let listed = 0
    const cache = new Set([OLD, NEW])
    const { run, calls } = stand((args) => {
      if (args[2] === TAGGED_SCRIPT)
        return { stdout: listed++ === 0 ? "10 (docker) S 1\n" : "" }
      if (args.join(" ").endsWith(DU_ARGS.join(" ")))
        return { stdout: [...cache].map((id) => `ID:\t${id}\n`).join("\n") }
      if (args.includes("prune")) cache.delete(args.at(-1)!.slice(3))
      if (args[0] === "sh" && args.at(-1)?.endsWith("/refs/default/default"))
        return { stdout: "r1abcdefghij\n" }
      return undefined
    })
    const made = newMade()
    made.tags.push("ZEKNO_BUILD_RUN=0123456789abcdef0123456789abcdef")
    made.containers.push("zekno-check-memory-app")
    made.images.push("zekno.invalid/check-x:k1")
    made.homes.set(HOME, ["r1abcdefghij"])
    made.cache = { home: HOME, before: [OLD] }
    made.bases.push({ image: BASE, pulled: true })
    made.folders.push(ROOT, ROOT)
    const said: string[] = []
    expect(
      await cleanUp(run, made, "L3", {
        say: (line) => said.push(line),
        wait: async () => undefined,
      })
    ).toEqual([])
    expect(said).toEqual([])
    expect(calls.map(kind)).toEqual([
      "list processes",
      "kill",
      "list processes",
      "docker rm --force",
      "docker image rm",
      "list records",
      "docker buildx history",
      "docker buildx du",
      "docker buildx prune",
      "docker buildx du",
      "docker image rm",
      `rm ${ROOT}`,
    ])
    expect(calls[3]).toEqual([
      "docker",
      "rm",
      "--force",
      "zekno-check-memory-app",
    ])
    expect(calls[8]!.at(-1)).toBe(`id=${NEW}`)
    expect(calls[10]).toEqual(["docker", "image", "rm", BASE])
  })

  test("nothing noted, nothing called; a base that was there already stays", async () => {
    const { run, calls } = stand()
    const made = newMade()
    made.bases.push({ image: BASE, pulled: false })
    expect(await cleanUp(run, made, "L3")).toEqual([])
    expect(calls).toEqual([])
  })

  test("what stays fails the check; records and cache that stay are said; a part that throws does not stop the rest", async () => {
    const { run, calls } = stand((args) => {
      if (args[0] === "docker" && args[1] === "rm")
        return { code: 1, stderr: "Error response from daemon: busy\n" }
      if (args[0] === "docker" && args[1] === "image")
        return {
          code: 1,
          stderr: "Error response from daemon: conflict: in use\n",
        }
      if (args.includes("history"))
        return { code: 1, stderr: "unknown command\n" }
      if (args.join(" ").endsWith(DU_ARGS.join(" ")))
        return { code: 1, stderr: "ERROR: no builder\n" }
      if (args[0] === "rm") return { code: 1, stderr: "rm: busy\n" }
      return undefined
    })
    const made = newMade()
    made.containers.push("zekno-check-gone", "sessora-db")
    made.images.push("zekno.invalid/check-x:k1")
    made.homes.set(HOME, ["r1abcdefghij"])
    made.cache = { home: HOME, before: [] }
    made.folders.push("/etc", ROOT)
    const said: string[] = []
    expect(
      await cleanUp(run, made, "L4", { say: (line) => said.push(line) })
    ).toEqual([
      "zekno-check-gone (Error response from daemon: busy)",
      "sessora-db: not a check's container, left alone",
      "zekno.invalid/check-x:k1 (Error response from daemon: conflict: in use)",
      '/etc: the folder "/etc" is not a folder under /tmp/zekno-check-* in the stand-in',
      `${ROOT} (rm: busy)`,
    ])
    expect(said).toEqual([
      "L4 could not remove its build records r1abcdefghij; they go with the stand-in",
      "L4 could not remove its build cache the build cache could not be listed: ERROR: no builder; it goes with the stand-in",
    ])
    expect(calls.some((call) => call.includes("sessora-db"))).toBe(false)
    expect(calls.some((call) => call.includes("/etc"))).toBe(false)
  })

  test("a container already gone is no fault; a process that will not stop is", async () => {
    const { run } = stand((args) => {
      if (args[2] === TAGGED_SCRIPT) return { stdout: "12 (docker) S 1\n" }
      if (args[1] === "rm")
        return {
          code: 1,
          stderr: "Error response from daemon: No such container: x\n",
        }
      return undefined
    })
    const made = newMade()
    made.tags.push("ZEKNO_CHECK_PARENT=p1")
    made.containers.push("zekno-check-memory-app")
    // This stand-in never lets go of the process; the rounds do not wait.
    expect(
      await cleanUp(run, made, "L5", { wait: async () => undefined })
    ).toEqual(["process 12 (alive (docker, S))"])
  })
})

describe("prepare", () => {
  test("empties the folder, makes its home, notes both, and lists the cache as it was", async () => {
    const { run, calls } = stand((args) => {
      if (args.includes("version"))
        return { stdout: "github.com/docker/buildx v0.34.1 8a7c1d2e\n" }
      if (args.join(" ").endsWith(DU_ARGS.join(" ")))
        return { stdout: `ID:\t${OLD}\n` }
      return undefined
    })
    const made = newMade()
    expect(await prepare(run, made, ROOT)).toEqual({
      home: HOME,
      buildx: "buildx 0.34.1",
    })
    expect(calls.slice(0, 2)).toEqual([
      ["rm", "-rf", ROOT],
      ["mkdir", "-p", HOME],
    ])
    expect(calls[2]).toContain(`BUILDX_CONFIG=${HOME}/buildx`)
    expect(made.folders).toEqual([ROOT])
    expect([...made.homes]).toEqual([[HOME, []]])
    expect(made.cache).toEqual({ home: HOME, before: [OLD] })
  })

  test("an engine without buildx: said, and no cache listed", async () => {
    const { run, calls } = stand((args) =>
      args.includes("version")
        ? { code: 1, stderr: "docker: 'buildx' is not a docker command.\n" }
        : undefined
    )
    const made = newMade()
    expect(await prepare(run, made, ROOT)).toEqual({
      none: "no buildx (docker: 'buildx' is not a docker command.); nothing built",
    })
    expect(calls).toHaveLength(3)
    expect(made.cache).toBeUndefined()
    expect(made.folders).toEqual([ROOT])
  })

  test("a folder that cannot be emptied, or one not of a check, throws", async () => {
    const { run } = stand((args) =>
      args[0] === "rm" ? { code: 1, stderr: "rm: busy\n" } : undefined
    )
    await expect(prepare(run, newMade(), ROOT)).rejects.toThrow(
      `rm -rf ${ROOT} failed: rm: busy`
    )
    await expect(prepare(run, newMade(), "/var/lib")).rejects.toThrow(
      "is not a folder under /tmp/zekno-check-*"
    )
  })
})

describe("recordCheck", () => {
  const deps = () => {
    const written: string[] = []
    const said: string[] = []
    const record: RecordDeps = {
      write: (id, seen) => written.push(`${id}: ${seen}`),
      say: (line) => said.push(line),
    }
    return { written, said, record }
  }

  test("records what was seen, then removes what was made", async () => {
    const { run, calls } = stand()
    const { written, record } = deps()
    await recordCheck(
      "L4",
      run,
      async (_, made) => {
        made.folders.push(ROOT)
        return "the iidfile equals .Id"
      },
      record
    )
    expect(written).toEqual(["L4: the iidfile equals .Id"])
    expect(calls).toEqual([["rm", "-rf", ROOT]])
  })

  test("a failure half way still removes what was noted, then is thrown as it was", async () => {
    const { run, calls } = stand()
    const { written, record } = deps()
    await expect(
      recordCheck(
        "L3",
        run,
        async (_, made) => {
          made.images.push("zekno.invalid/check-cache-a:a1")
          throw new Error("docker pull failed")
        },
        record
      )
    ).rejects.toThrow("docker pull failed")
    expect(written).toEqual([])
    expect(calls).toEqual([
      ["docker", "image", "rm", "zekno.invalid/check-cache-a:a1"],
    ])
  })

  test("what stayed fails the check after its record", async () => {
    const { run } = stand(() => ({ code: 1, stderr: "rm: busy\n" }))
    const { written, record } = deps()
    await expect(
      recordCheck(
        "L7",
        run,
        async (_, made) => {
          made.folders.push(ROOT)
          return "seen"
        },
        record
      )
    ).rejects.toThrow(`L7 left in the stand-in: ${ROOT} (rm: busy)`)
    expect(written).toEqual(["L7: seen"])
  })
})
