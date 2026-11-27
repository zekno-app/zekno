/**
 * Free disk before and during a build (specs/016-build-from-source,
 * contracts/runner.md RB6, RB2 step 5; FR-040): the least free space of the
 * places a build writes to, held to `LIMITS.diskFloorBytes`. Every figure
 * here comes from a stand-in `statfs`, as a deploy's options pass one, so
 * no test depends on this machine's disk. Docker's root is asked of the
 * stand-in for Docker; check L7 measures what a real build uses.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { LIMITS } from "@workspace/core"
import { realpathSync, statSync } from "node:fs"
import { join } from "node:path"

import {
  belowFloor,
  buildPlaces,
  dockerRoot,
  freeBytes,
  leastFree,
  type StatFs,
} from "../../src/disk/free"
import { fakeDocker } from "../support/docker/fake"
import { tempDir } from "../support/helpers"

const GIB = 1024 * 1024 * 1024
const FLOOR = LIMITS.diskFloorBytes

const saved = process.env.ZEKNO_DOCKER
afterEach(() => {
  if (saved === undefined) delete process.env.ZEKNO_DOCKER
  else process.env.ZEKNO_DOCKER = saved
})

/** A `statfs` that knows only the places given, each with its free bytes in blocks of 4 KiB; any other path cannot be read. */
function disks(free: Record<string, number>): StatFs {
  return (path) => {
    const bytes = free[path]
    if (bytes === undefined)
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" })
    return { bavail: bytes / 4096, bsize: 4096 }
  }
}

describe("freeBytes", () => {
  test("is the blocks free to the runner times their size", () => {
    expect(
      freeBytes("/x", () => ({ bavail: 1000, bsize: 4096, blocks: 9 }))
    ).toBe(4_096_000)
  })

  test("is undefined when the place cannot be read", () => {
    expect(freeBytes("/x", disks({}))).toBeUndefined()
  })

  test("reads a real folder through the system's statfs when none is given", () => {
    const free = freeBytes(tempDir("free-real"))
    expect(typeof free).toBe("number")
    expect(free!).toBeGreaterThanOrEqual(0)
  })
})

describe("buildPlaces", () => {
  test("Docker's root, containerd's folder when it exists, the runner's folder and the work folders' parent", () => {
    expect(
      buildPlaces("/home/r", "/var/lib/docker", {
        unpacked: "/var/lib/zekno-unpacked",
        exists: (path) => path === "/var/lib/containerd",
      })
    ).toEqual([
      "/var/lib/docker",
      "/var/lib/containerd",
      "/home/r",
      "/var/lib/zekno-unpacked",
    ])
  })

  test("leaves containerd's folder out when it is not there", () => {
    expect(
      buildPlaces("/home/r", "/var/lib/docker", {
        unpacked: "/u",
        exists: () => false,
      })
    ).toEqual(["/var/lib/docker", "/home/r", "/u"])
  })

  test("the work folders' parent is the runner's unpacked folder when none is given", () => {
    const before = process.env.ZEKNO_RUNNER_UNPACKED
    const unpacked = join(tempDir("free-unpacked"), "zekno-unpacked")
    process.env.ZEKNO_RUNNER_UNPACKED = unpacked
    try {
      expect(
        buildPlaces("/home/r", "/var/lib/docker", { exists: () => false })
      ).toEqual(["/var/lib/docker", "/home/r", unpacked])
      // Made, mode 700, so its disk can be read before the first build.
      expect(statSync(unpacked).mode & 0o777).toBe(0o700)
    } finally {
      if (before === undefined) delete process.env.ZEKNO_RUNNER_UNPACKED
      else process.env.ZEKNO_RUNNER_UNPACKED = before
    }
  })

  test("keeps Docker's root as a place that cannot be read when Docker did not say it", () => {
    expect(
      buildPlaces("/home/r", undefined, { unpacked: "/u", exists: () => false })
    ).toEqual([undefined, "/home/r", "/u"])
  })
})

describe("leastFree", () => {
  test("is the least of four places", () => {
    const statfs = disks({
      "/var/lib/docker": 40 * GIB,
      "/var/lib/containerd": 9 * GIB,
      "/home/r": 3 * GIB,
      "/u": 12 * GIB,
    })
    expect(
      leastFree(
        ["/var/lib/docker", "/var/lib/containerd", "/home/r", "/u"],
        statfs
      )
    ).toBe(3 * GIB)
  })

  test("an unreadable place gives 0, as a remote Docker's root does", () => {
    const statfs = disks({ "/home/r": 30 * GIB, "/u": 30 * GIB })
    expect(leastFree(["/var/lib/docker", "/home/r", "/u"], statfs)).toBe(0)
    expect(leastFree([undefined, "/home/r", "/u"], statfs)).toBe(0)
  })
})

describe("belowFloor", () => {
  test("the floor is 2 GiB", () => {
    expect(FLOOR).toBe(2 * GIB)
  })

  test("exactly at the floor is not below it", () => {
    expect(belowFloor(FLOOR)).toBe(false)
    expect(belowFloor(FLOOR - 1)).toBe(true)
    expect(belowFloor(FLOOR + 1)).toBe(false)
  })

  test("a piece that would bring free space below the floor is below it", () => {
    const piece = 8 * 1024 * 1024
    expect(belowFloor(FLOOR + piece, piece)).toBe(false)
    expect(belowFloor(FLOOR + piece - 1, piece)).toBe(true)
    expect(belowFloor(FLOOR + 5 * GIB, piece)).toBe(false)
  })
})

describe("dockerRoot", () => {
  /** The stand-in for Docker, used by the calls that follow. */
  function standIn() {
    const d = fakeDocker()
    process.env.ZEKNO_DOCKER = d.path
    return d
  }

  test("asks docker info for its root folder, once, in the runner's folder", async () => {
    const d = standIn()
    d.script({ docker: { dockerRootDir: "/srv/docker" } })
    const dir = tempDir("free-home")
    expect(await dockerRoot(dir)).toBe("/srv/docker")
    expect(d.argv()).toEqual([["info", "--format", "{{.DockerRootDir}}"]])
    expect(d.calls().map((call) => call.cwd)).toEqual([realpathSync(dir)])
  })

  test("is undefined for an answer that is not one absolute folder", async () => {
    const d = standIn()
    for (const answer of ["", "docker", "/a\n/b", "relative/path"]) {
      d.script({ docker: { dockerRootDir: answer } })
      expect(await dockerRoot(tempDir("free-home"))).toBeUndefined()
    }
  })

  test("docker info failing gives 0", async () => {
    const d = standIn()
    d.script({ docker: { engine: null } })
    const dir = tempDir("free-home")
    const root = await dockerRoot(dir)
    expect(root).toBeUndefined()
    expect(d.argv()).toEqual([["info", "--format", "{{.DockerRootDir}}"]])
    const statfs = disks({ [dir]: 50 * GIB, "/u": 50 * GIB })
    const places = buildPlaces(dir, root, {
      unpacked: "/u",
      exists: () => false,
    })
    expect(leastFree(places, statfs)).toBe(0)
    expect(belowFloor(leastFree(places, statfs))).toBe(true)
  })
})
