/**
 * `cache-records.ts` (specs/016-build-from-source, T017 and T018), branch
 * by branch: the ids `docker buildx du --verbose` prints, the records a
 * check made, and their pruning by exact id, in passes. A stand-in
 * function answers for the stand-in; nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"

import {
  cacheIds,
  cacheIdsOf,
  DU,
  newIds,
  PASSES,
  pruneArgs,
  pruneNewCache,
} from "./cache-records"
import type { Answer, RunOptions } from "../host/host-docker"
import type { InStandIn } from "./rb7"

const HOME = "/tmp/zekno-check-x/home"

const du = (ids: readonly string[]) =>
  [
    ...ids.flatMap((id) => [
      `ID:\t\t${id}`,
      "Parent:\t\tabc",
      "Created at:\t2026-11-27 10:00:00 +0000 UTC",
      "Mutable:\tfalse",
      "Description:\tmount / from exec /bin/sh -c ID: not-this-one",
      "Type:\t\tregular",
      "",
    ]),
    "Shared:\t\t0B",
    "Total:\t\t1kB",
  ].join("\n")

/** A cache whose records go when pruned, unless `stuck` names them. */
function fakeCache(start: string[], stuck: readonly string[] = []) {
  const records = [...start]
  const calls: { args: readonly string[]; options?: RunOptions }[] = []
  const run: InStandIn = async (args, options) => {
    calls.push({ args, options })
    const command = args.slice(args.indexOf("docker"))
    if (command.join(" ") === DU.join(" "))
      return { code: 0, stdout: du(records), stderr: "" }
    const id = command.at(-1)!.replace(/^id=/, "")
    if (command[2] === "prune" && !stuck.includes(id)) {
      const at = records.indexOf(id)
      if (at !== -1) records.splice(at, 1)
    }
    return { code: 0, stdout: "", stderr: "" } satisfies Answer
  }
  return { run, calls, records }
}

describe("reading the cache", () => {
  test("gives each id once, in order, and nothing else of the listing", () => {
    expect(cacheIdsOf(du(["k1", "k2", "k1"]))).toEqual(["k1", "k2"])
    expect(cacheIdsOf("")).toEqual([])
    expect(cacheIdsOf("ID: has spaces\nID:\n")).toEqual([])
  })

  test("the records a check made are those not listed before", () => {
    expect(newIds(["a", "b"], ["b", "c", "d"])).toEqual(["c", "d"])
    expect(newIds(["a"], ["a"])).toEqual([])
  })

  test("du runs with RB7's environment, BUILDX_CONFIG under the check's home", async () => {
    const { run, calls } = fakeCache(["k1"])
    expect(await cacheIds(run, HOME)).toEqual(["k1"])
    const args = calls[0]!.args
    expect(args.slice(0, 2)).toEqual(["env", "-i"])
    expect(args).toContain(`BUILDX_CONFIG=${HOME}/buildx`)
    expect(args.slice(-DU.length)).toEqual(DU)
  })

  test("a du that fails is the check's own fault", async () => {
    const run: InStandIn = async () => ({
      code: 1,
      stdout: "",
      stderr: "no buildx",
    })
    await expect(cacheIds(run, HOME)).rejects.toThrow(
      "docker buildx du failed (exit 1): no buildx"
    )
  })
})

describe("pruning", () => {
  test("is one record by its exact id, of any type", () => {
    expect(pruneArgs("k8c4q1")).toEqual([
      "docker",
      "buildx",
      "prune",
      "--builder",
      "default",
      "--force",
      "--all",
      "--filter",
      "id=k8c4q1",
    ])
    for (const id of ["", "a,b", "a b", "id=a"])
      expect(() => pruneArgs(id)).toThrow("is not a cache record's id")
  })

  test("removes only what was made since the first listing, and never another", async () => {
    const { run, calls, records } = fakeCache(["old1", "old2", "new1", "new2"])
    expect(await pruneNewCache(run, HOME, ["old1", "old2"])).toEqual([])
    expect(records).toEqual(["old1", "old2"])
    const pruned = calls
      .map((call) => call.args.at(-1)!)
      .filter((arg) => arg.startsWith("id="))
    expect(pruned).toEqual(["id=new1", "id=new2"])
  })

  test("runs another pass for a record whose child went first", async () => {
    const records = ["parent", "child"]
    let tries = 0
    const run: InStandIn = async (args) => {
      const command = args.slice(args.indexOf("docker"))
      if (command[2] === "du")
        return { code: 0, stdout: du(records), stderr: "" }
      const id = command.at(-1)!.replace(/^id=/, "")
      tries++
      if (id === "parent" && records.includes("child"))
        return { code: 1, stdout: "", stderr: "in use" }
      records.splice(records.indexOf(id), 1)
      return { code: 0, stdout: "", stderr: "" }
    }
    expect(await pruneNewCache(run, HOME, [])).toEqual([])
    expect(tries).toBe(3)
  })

  test("gives the ids it could not remove, after a pass that removed nothing", async () => {
    const { run, calls } = fakeCache(["new1", "stuck"], ["stuck"])
    expect(await pruneNewCache(run, HOME, [])).toEqual(["stuck"])
    const prunes = calls.filter((call) => call.args.includes("prune"))
    expect(prunes.length).toBe(3)
    expect(PASSES).toBe(4)
  })

  test("makes no call to prune when nothing new was made", async () => {
    const { run, calls } = fakeCache(["old"])
    expect(await pruneNewCache(run, HOME, ["old"])).toEqual([])
    expect(calls.every((call) => !call.args.includes("prune"))).toBe(true)
  })
})
