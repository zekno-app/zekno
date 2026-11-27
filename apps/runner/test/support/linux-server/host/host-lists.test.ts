/**
 * What `server.ts` reads of the host (`host-lists.ts`; specs/016-build-from-source,
 * T008): the zekno-check-* names, those that carry a run's label, the
 * host's images and the count of its build records, all read only, and the
 * one line on how to remove what an earlier run left. Docker is stood in
 * for (`fake-host.ts`).
 */
import { describe, expect, test } from "bun:test"

import { fakeHost, imageLine } from "./fake-host"
import {
  buildRecords,
  countRecords,
  differences,
  hostImages,
  labelled,
  labelledLists,
  leftovers,
  removeHint,
  runIdOf,
} from "./host-lists"

const empty = { image: "x", network: undefined, volume: undefined }

describe("the names", () => {
  test("only names that start zekno-check-, though Docker's filter matches anywhere in a name", async () => {
    const host = fakeHost()
    host.containers.set("zekno-check-a1b2c3d4-server", empty)
    host.containers.set("my-zekno-check-a1b2c3d4-server", empty)
    host.containers.set("sessora-db", empty)
    host.volumes.add("zekno-check-a1b2c3d4-data")
    host.volumes.add("old-zekno-check-data")
    host.networks.add("zekno-check-odd")
    const left = await leftovers(host.docker())
    expect(left).toEqual({
      containers: ["zekno-check-a1b2c3d4-server"],
      volumes: ["zekno-check-a1b2c3d4-data"],
      networks: ["zekno-check-odd"],
    })
  })

  test("those that carry the run's label zekno-check=<id>, by a listing filtered on it", async () => {
    const host = fakeHost()
    host.containers.set("zekno-check-a1b2c3d4-server", empty)
    host.labels.set("zekno-check-a1b2c3d4-server", "zekno-check=a1b2c3d4")
    host.containers.set("zekno-check-a1b2c3d4-client", empty)
    host.volumes.add("zekno-check-a1b2c3d4-data")
    host.labels.set("zekno-check-a1b2c3d4-data", "zekno-check=zzzzzzzz")
    host.networks.add("zekno-check-a1b2c3d4-net")
    host.labels.set("zekno-check-a1b2c3d4-net", "zekno-check=a1b2c3d4")
    expect(await labelled(host.docker(), "a1b2c3d4")).toEqual({
      containers: ["zekno-check-a1b2c3d4-server"],
      volumes: [],
      networks: ["zekno-check-a1b2c3d4-net"],
    })
    const lists = labelledLists("a1b2c3d4")
    expect(host.calls.map((call) => call.args)).toEqual([
      lists.containers,
      lists.volumes,
      lists.networks,
    ])
    for (const list of Object.values(lists))
      expect(list).toContain("label=zekno-check=a1b2c3d4")
  })

  test("a run's id only from one of the four names a run makes", () => {
    for (const part of ["server", "data", "net", "client"])
      expect(runIdOf(`zekno-check-a1b2c3d4-${part}`)).toBe("a1b2c3d4")
    for (const name of [
      "zekno-check-a1b2c3d4-other",
      "zekno-check-A1B2C3D4-server",
      "zekno-check-odd",
      "sessora-db",
    ])
      expect(runIdOf(name)).toBeUndefined()
  })

  test("one line on how to remove what is left", () => {
    expect(
      removeHint({
        containers: ["zekno-check-b2c3d4e5-server", "zekno-check-x"],
        volumes: ["zekno-check-a1b2c3d4-data", "zekno-check-b2c3d4e5-data"],
        networks: ["zekno-check-y"],
      })
    ).toBe(
      "Something named zekno-check-* is left from an earlier run: zekno-check-b2c3d4e5-server, zekno-check-x, zekno-check-a1b2c3d4-data, zekno-check-b2c3d4e5-data, zekno-check-y. Remove it with: bun --no-env-file apps/runner/test/support/linux-server/server.ts down --id a1b2c3d4; bun --no-env-file apps/runner/test/support/linux-server/server.ts down --id b2c3d4e5; docker rm --force zekno-check-x; docker network rm zekno-check-y"
    )
  })
})

describe("the host's images and build records", () => {
  test("the images as sorted lines, and what was added or removed", async () => {
    const host = fakeHost()
    const a =
      "busybox@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662"
    const b =
      "ubuntu@sha256:562111b88caa79c71391c0c4d3c2114a7d5c35915c20561fd893cb1e07929e6b"
    host.images.set(b, imageLine(b))
    host.images.set(a, imageLine(a))
    const lines = await hostImages(host.docker())
    expect(lines).toEqual([imageLine(a), imageLine(b)].sort())
    expect(differences([imageLine(a)], [imageLine(b)])).toEqual({
      added: [imageLine(b)],
      removed: [imageLine(a)],
    })
    expect(differences(lines, [...lines].reverse())).toEqual({
      added: [],
      removed: [],
    })
  })

  test("the build records counted from buildx's lines or array, or why they could not be", async () => {
    expect(countRecords("")).toBe(0)
    expect(countRecords("\n")).toBe(0)
    expect(countRecords('{"ref":"a"}\n{"ref":"b"}\n')).toBe(2)
    expect(countRecords('[{"ref":"a"},{"ref":"b"},{"ref":"c"}]\n')).toBe(3)
    expect(() => countRecords("BUILD ID  NAME\n")).toThrow("not JSON")
    const host = fakeHost()
    expect(await buildRecords(host.docker())).toBe(7)
    host.failWhen = () => ({
      code: 1,
      stdout: "",
      stderr:
        "docker: 'buildx history' is not a docker command.\nSee 'docker --help'\n",
    })
    expect(await buildRecords(host.docker())).toBe(
      "docker: 'buildx history' is not a docker command."
    )
  })

  test("a listing that fails throws one line", async () => {
    const host = fakeHost()
    host.answers = false
    await expect(leftovers(host.docker())).rejects.toThrow(
      "docker ps failed (exit 1): Cannot connect to the Docker daemon"
    )
    await expect(hostImages(host.docker())).rejects.toThrow(
      "docker image ls failed (exit 1)"
    )
  })
})
