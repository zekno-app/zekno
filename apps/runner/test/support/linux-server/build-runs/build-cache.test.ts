/**
 * `build-cache.ts` (specs/016-build-from-source, T012 to T014): reading
 * `docker buildx du --verbose`, the records a check made, and their removal
 * by id only, with a stand-in function for the stand-in. Nothing here runs
 * Docker.
 */
import { describe, expect, test } from "bun:test"

import {
  cacheRecords,
  cacheRecordsOf,
  DU_ARGS,
  madeSince,
  pruneArgs,
  removeCacheMade,
} from "./build-cache"
import type { Answer } from "../host/host-docker"

const HOME = "/tmp/zekno-check-x/home"

const block = (id: string, more: string[] = []) =>
  [`ID:\t\t${id}`, "Created at:\t2026-11-27 10:00:00 +0000 UTC", ...more].join(
    "\n"
  )

const DU = [
  block("wg1pqhcytgcxbjw8cgo2bxegp", [
    "Parents:",
    " - ry1mg9p1rlbd2l1gqgvm7vpzh",
    "Mutable:\tfalse",
    "Description:\t[2/3] RUN --mount=type=cache,target=/cache echo: hi",
    "Type:\t\tregular",
  ]),
  "",
  block("ry1mg9p1rlbd2l1gqgvm7vpzh", [
    'Description:\tcached mount /cache from exec /bin/sh -c echo with id "zekno-check-cache-a//cache"',
    "Type:\t\texec.cachemount",
  ]),
  // A block with no blank line before it, and one whose id is not BuildKit's.
  block("k2l3m4n5o6p7q8r9s0t1u2v3w"),
  "",
  block("NOT/AN-ID", ["Type:\t\tregular"]),
  "",
  "Shared:\t\t0B",
  "Private:\t12.3MB",
  "Reclaimable:\t12.3MB",
  "Total:\t\t12.3MB",
].join("\n")

describe("docker buildx du --verbose, read", () => {
  test("each ID: line starts a record, with its own Type: and Description:", () => {
    expect(cacheRecordsOf(DU)).toEqual([
      {
        id: "wg1pqhcytgcxbjw8cgo2bxegp",
        type: "regular",
        description: "[2/3] RUN --mount=type=cache,target=/cache echo: hi",
      },
      {
        id: "ry1mg9p1rlbd2l1gqgvm7vpzh",
        type: "exec.cachemount",
        description:
          'cached mount /cache from exec /bin/sh -c echo with id "zekno-check-cache-a//cache"',
      },
      { id: "k2l3m4n5o6p7q8r9s0t1u2v3w" },
    ])
    expect(cacheRecordsOf("")).toEqual([])
    expect(cacheRecordsOf("Reclaimable:\t0B\nTotal:\t0B\n")).toEqual([])
  })

  test("what a check made is what was not there before", () => {
    const now = cacheRecordsOf(DU)
    expect(
      madeSince(["ry1mg9p1rlbd2l1gqgvm7vpzh"], now).map((record) => record.id)
    ).toEqual(["wg1pqhcytgcxbjw8cgo2bxegp", "k2l3m4n5o6p7q8r9s0t1u2v3w"])
    expect(madeSince([], [])).toEqual([])
  })

  test("a prune names one record by id, of any type, and takes nothing else", () => {
    expect(pruneArgs("wg1pqhcytgcxbjw8cgo2bxegp")).toEqual([
      ...["docker", "buildx", "prune", "--builder", "default"],
      ...["--force", "--all", "--filter", "id=wg1pqhcytgcxbjw8cgo2bxegp"],
    ])
    for (const id of ["", "a|b", ".*", "short", "UPPERCASEIDXXXXXXXX"])
      expect(() => pruneArgs(id)).toThrow("is not a cache record's id")
  })
})

/** A stand-in whose builder holds `ids`; a record that `rests` on another can go only once that one is gone. */
function builder(ids: string[], rests: Record<string, string> = {}) {
  const held = new Set(ids)
  const calls: string[][] = []
  let failList = false
  const run = async (args: readonly string[]): Promise<Answer> => {
    calls.push([...args])
    const at = args.indexOf("docker")
    const command = args.slice(at)
    expect(args.slice(0, 2)).toEqual(["env", "-i"])
    expect(args).toContain(`BUILDX_CONFIG=${HOME}/buildx`)
    if (command.join(" ") === DU_ARGS.join(" ")) {
      if (failList)
        return { code: 1, stdout: "", stderr: "ERROR: no builder\n" }
      return {
        code: 0,
        stdout: [...held].map((id) => block(id)).join("\n\n"),
        stderr: "",
      }
    }
    const id = command.at(-1)!.replace(/^id=/, "")
    const child = Object.entries(rests).find(
      ([from, on]) => on === id && held.has(from)
    )
    if (child === undefined) held.delete(id)
    return { code: 0, stdout: "", stderr: "" }
  }
  return { run, held, calls, failing: () => (failList = true) }
}

describe("the cache a check made, removed", () => {
  const A = "aaaaaaaaaaaaaaaaaaaaaaaaa"
  const B = "bbbbbbbbbbbbbbbbbbbbbbbbb"
  const C = "ccccccccccccccccccccccccc"
  const OLD = "ooooooooooooooooooooooooo"

  test("lists the records with the check's own BUILDX_CONFIG; a failed listing throws", async () => {
    const stand = builder([A])
    expect(await cacheRecords(stand.run, HOME)).toEqual([{ id: A }])
    stand.failing()
    await expect(cacheRecords(stand.run, HOME)).rejects.toThrow(
      "docker buildx du failed: ERROR: no builder"
    )
  })

  test("only the records made since, each by its id; one resting on another goes in a later pass", async () => {
    const stand = builder([OLD, A, B, C], { [A]: C })
    // A rests on C, listed after it: the first pass removes B and A, the second C.
    expect(await removeCacheMade(stand.run, HOME, [OLD])).toEqual([])
    expect([...stand.held]).toEqual([OLD])
    const pruned = stand.calls
      .filter((call) => call.includes("prune"))
      .map((call) => call.at(-1))
    expect(pruned).toEqual([`id=${C}`, `id=${B}`, `id=${A}`, `id=${C}`])
  })

  test("a record that stays is given back, and the passes stop when none moves", async () => {
    // A rests on B and B on A: neither can go.
    const stand = builder([A, B], { [A]: B, [B]: A })
    expect(await removeCacheMade(stand.run, HOME, [])).toEqual([A, B])
    expect(stand.calls.filter((call) => call.includes("prune"))).toHaveLength(2)
  })

  test("nothing made, nothing pruned; a listing that fails is said, not thrown", async () => {
    const same = builder([OLD])
    expect(await removeCacheMade(same.run, HOME, [OLD])).toEqual([])
    expect(same.calls.filter((call) => call.includes("prune"))).toEqual([])
    const failing = builder([A])
    failing.failing()
    expect(await removeCacheMade(failing.run, HOME, [])).toEqual([
      "the build cache could not be listed: ERROR: no builder",
    ])
  })
})
