/**
 * `build-reuse.ts` (specs/016-build-from-source, T012): the packs of L3, L4
 * and L4b exactly, and the reading of what an L3 step saw. Nothing here
 * runs Docker.
 */
import { describe, expect, test } from "bun:test"

import {
  BUILD_ARG,
  CACHE_TAG,
  cacheMountDockerfile,
  FIRST_TIME,
  identityPack,
  sawOf,
  sawWords,
  SECOND_TIME,
  seenList,
  timesPacks,
} from "./build-reuse"
import { packOf } from "../build-runs/pack-tar"

const BASE =
  "busybox@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662"
const TOKEN = "0a1b2c3d4e5f"

describe("L3's Dockerfile", () => {
  test("one step on a cache mount: lists this run's files, then writes the build's own", () => {
    expect(cacheMountDockerfile(BASE, TOKEN)).toBe(
      [
        `FROM ${BASE}`,
        "ARG ZEKNO_CHECK_BUILD",
        `RUN --mount=type=cache,target=/cache echo "zekno-check-cache saw: $(ls -1 /cache | grep '^0a1b2c3d4e5f-' | tr '\\n' ' ')" && touch "/cache/0a1b2c3d4e5f-$ZEKNO_CHECK_BUILD"`,
        "",
      ].join("\n")
    )
    expect(BUILD_ARG).toBe("ZEKNO_CHECK_BUILD")
    expect(CACHE_TAG).toBe("zekno-check-cache saw:")
  })

  test("refuses a base or a token that could change the step", () => {
    expect(() => cacheMountDockerfile("busybox\nRUN x", TOKEN)).toThrow(
      "is not an image"
    )
    expect(() => cacheMountDockerfile(BASE, "a'b")).toThrow(
      "is not a check's token"
    )
    expect(() => cacheMountDockerfile(BASE, "short")).toThrow(
      "is not a check's token"
    )
    expect(() => identityPack("FROM x", TOKEN)).toThrow("is not an image")
    expect(() => timesPacks(BASE, "")).toThrow("is not a check's token")
  })

  test("what a step saw: this run's builds only, in the order listed", () => {
    expect(sawOf(`${TOKEN}-a1 ${TOKEN}-b1  other-x`, TOKEN)).toEqual([
      "a1",
      "b1",
    ])
    expect(sawOf("", TOKEN)).toEqual([])
    expect(sawOf(undefined, TOKEN)).toBeUndefined()
  })

  test("the words: whether a build's file was seen, and all that was", () => {
    expect(sawWords(["a1"], "a1")).toBe("saw a1's file: yes (saw a1)")
    expect(sawWords(["b1"], "a1")).toBe("saw a1's file: no (saw b1)")
    expect(sawWords([], "a1")).toBe("saw a1's file: no (saw nothing)")
    expect(sawWords(undefined, "a1")).toBe("the step printed no list")
    expect(seenList(["a1", "b1"])).toBe("saw a1, b1")
    expect(seenList([])).toBe("saw nothing")
    expect(seenList(undefined)).toBe("the step printed no list")
  })
})

describe("L4's and L4b's packs", () => {
  test("L4: a base, the run's file, and a step that reads it", () => {
    expect(identityPack(BASE, TOKEN)).toEqual([
      {
        path: "Dockerfile",
        data: `FROM ${BASE}\nCOPY hello.txt /hello.txt\nRUN cat /hello.txt > /seen.txt\n`,
      },
      { path: "hello.txt", data: "zekno check L4 0a1b2c3d4e5f\n" },
    ])
  })

  test("L4b: the same bytes in both tars but for every header's time, one day apart", () => {
    const [first, second] = timesPacks(BASE, TOKEN)
    expect(first.map((file) => file.mtime)).toEqual([FIRST_TIME, FIRST_TIME])
    expect(second.map((file) => file.mtime)).toEqual([SECOND_TIME, SECOND_TIME])
    expect(SECOND_TIME - FIRST_TIME).toBe(86_400)
    expect(first.map(({ path, data }) => ({ path, data }))).toEqual(
      second.map(({ path, data }) => ({ path, data }))
    )
    expect(first[0]!.data).toBe(`FROM ${BASE}\nCOPY a.txt /a.txt\n`)
    const a = packOf(first)
    const b = packOf(second)
    expect(a.length).toBe(b.length)
    const differ = [...a.keys()].filter((at) => a[at] !== b[at])
    // Only the time field (136 to 147) and the checksum (148 to 155) of each header differ.
    for (const at of differ)
      expect(at % 512 >= 136 && at % 512 < 156).toBe(true)
    expect(differ.length).toBeGreaterThan(0)
  })
})
