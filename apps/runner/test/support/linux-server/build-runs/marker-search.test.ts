/**
 * `marker-search.ts` (specs/016-build-from-source, T016 and T018), branch
 * by branch: markers and their hash, the `grep` the stand-in runs, the
 * reading of its answer, and the words a record says of what was found. A
 * stand-in function answers for the stand-in; nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Answer, RunOptions } from "../host/host-docker"
import {
  CONTAINERD_ROOT,
  dockerRoot,
  foundWords,
  isUnder,
  listWords,
  newMarker,
  PATTERN_FILE,
  printingDockerfile,
  randomHex,
  SEARCH_SCRIPT,
  SEARCH_SECONDS,
  searchArgs,
  searchPlaces,
  searchResult,
  searchStandIn,
  sha256Hex,
  type Place,
} from "./marker-search"
import type { InStandIn } from "./rb7"

const MARKER = "zekno-l10-0123456789abcdef0123456789abcdef"
const answer = (code: number, stdout = "", stderr = ""): Answer => ({
  code,
  stdout,
  stderr,
})

function fakeRun(reply: (args: readonly string[]) => Partial<Answer>) {
  const calls: { args: readonly string[]; options?: RunOptions }[] = []
  const run: InStandIn = async (args, options) => {
    calls.push({ args, options })
    return { code: 0, stdout: "", stderr: "", ...reply(args) }
  }
  return { run, calls }
}

const PLACES: Place[] = [
  { path: "/var/lib/docker", name: "Docker's root" },
  { path: CONTAINERD_ROOT, name: "the containerd's data" },
  { path: "/tmp/zekno-check-x", name: "the check's runner folder" },
]

describe("markers", () => {
  test("are their prefix and 32 random hex, new each time", () => {
    const one = newMarker("zekno-l10")
    expect(one).toMatch(/^zekno-l10-[0-9a-f]{32}$/)
    expect(newMarker("zekno-l10")).not.toBe(one)
    expect(randomHex()).toMatch(/^[0-9a-f]{32}$/)
    expect(randomHex(4)).toMatch(/^[0-9a-f]{8}$/)
  })

  test("refuse a prefix that is not lower-case words and hyphens", () => {
    for (const prefix of ["", "Zekno", "zekno_l10", "-zekno", "zekno-", "a b"])
      expect(() => newMarker(prefix)).toThrow("is not a marker's prefix")
  })

  test("are compared by their SHA-256", () => {
    expect(sha256Hex(MARKER)).toBe(
      createHash("sha256").update(MARKER).digest("hex")
    )
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )
  })
})

describe("printingDockerfile", () => {
  const BASE = `busybox@sha256:${"ab".repeat(32)}`

  test("prints the marker from a step whose text never holds it", () => {
    const marker = newMarker("zekno-l10")
    const text = printingDockerfile(BASE, marker)
    expect(text).not.toContain(marker)
    const lines = text.split("\n")
    expect(lines[0]).toBe(`FROM ${BASE}`)
    expect(lines[1]).toStartWith("RUN printf '%s%s%s\\n' zekno-l10- ")
    const printed = Bun.spawnSync(["sh", "-c", lines[1]!.slice("RUN ".length)])
    expect(printed.stdout.toString()).toBe(`${marker}\n`)
  })

  test("refuses a base not by digest, and a marker newMarker did not make", () => {
    const marker = newMarker("zekno-l10")
    expect(() => printingDockerfile("busybox:1.36.1", marker)).toThrow(
      "not an image by digest"
    )
    expect(() => printingDockerfile(`${BASE}\nRUN x`, marker)).toThrow(
      "not an image by digest"
    )
    for (const bad of [
      "zekno-l10",
      "zekno-l10-abc",
      `${marker} x`,
      "ZEKNO-0123456789abcdef0123456789abcdef",
    ])
      expect(() => printingDockerfile(BASE, bad)).toThrow(
        "not one newMarker made"
      )
  })
})

describe("searchArgs", () => {
  test("is grep over the places with the value from standard input, stopped in the stand-in; the value is in no argument", () => {
    expect(searchArgs(["/var/lib/docker", "/tmp/zekno-check-x"], 30)).toEqual([
      "sh",
      "-c",
      SEARCH_SCRIPT,
      "sh",
      "30",
      "/var/lib/docker",
      "/tmp/zekno-check-x",
    ])
    expect(SEARCH_SCRIPT).toContain(
      'timeout -k 5 "$seconds" grep -r -a -l -F -s -D skip -f "$f" -- "$@"'
    )
    expect(searchArgs(["/a"])[4]).toBe(String(SEARCH_SECONDS))
  })

  test("refuses no place, a path that is not plain or holds the search's own file, a time that is not whole", () => {
    expect(() => searchArgs([])).toThrow("names its places")
    for (const path of ["relative", "/a/../b", "/a b", "/a;rm"])
      expect(() => searchArgs([path])).toThrow("not a plain absolute path")
    for (const path of ["/", "/run"])
      expect(() => searchArgs([path])).toThrow("the search's own file")
    expect(() => searchArgs(["/a"], 0)).toThrow("whole number")
    expect(() => searchArgs(["/a"], 1.5)).toThrow("whole number")
  })

  test("the script, run here with sh: finds the files that hold the value, keeps it in a file of its own, removes that file, and ends with grep's status", () => {
    const folder = mkdtempSync(join(tmpdir(), "zekno-marker-search-"))
    try {
      const keep = join(folder, "keep")
      const place = join(folder, "place")
      mkdirSync(keep)
      mkdirSync(join(place, "deep"), { recursive: true })
      writeFileSync(join(place, "deep", "has"), `before ${MARKER} after\n`)
      writeFileSync(join(place, "not"), "nothing here\n")
      // This machine may have no `timeout` and no /run: both stood in for.
      const script = `timeout() { shift 3; "$@"; }\n${SEARCH_SCRIPT.replace(
        PATTERN_FILE,
        join(keep, "zekno-check-search.XXXXXXXX")
      )}`
      const search = (value: string) =>
        Bun.spawnSync(["sh", "-c", script, "sh", "30", place], {
          stdin: new TextEncoder().encode(value),
          stdout: "pipe",
          stderr: "pipe",
        })
      const found = search(MARKER)
      expect(found.exitCode).toBe(0)
      expect(found.stdout.toString()).toBe(`${join(place, "deep", "has")}\n`)
      expect(readdirSync(keep)).toEqual([])
      const none = search("zekno-l10-ffffffffffffffffffffffffffffffff")
      expect(none.exitCode).toBe(1)
      expect(none.stdout.toString()).toBe("")
      expect(readdirSync(keep)).toEqual([])
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

describe("searchResult", () => {
  test("found files, none, files unread, and a stop at the limit", () => {
    expect(
      searchResult(answer(0, "/var/lib/docker/a\n/tmp/zekno-check-x/b\n"))
    ).toEqual({
      files: ["/var/lib/docker/a", "/tmp/zekno-check-x/b"],
    })
    expect(searchResult(answer(1))).toEqual({ files: [] })
    expect(searchResult(answer(2, "/a\n"))).toEqual({
      files: ["/a"],
      note: "grep could not read some files",
    })
    expect(searchResult(answer(124), 30)).toEqual({
      files: [],
      note: "the search stopped at its time limit of 30 s",
    })
    expect(searchResult(answer(-1), 30).note).toContain("time limit")
  })

  test("another status is the check's own fault, and never names the marker", () => {
    expect(() =>
      searchResult(answer(125, "", "timeout: failed to run command 'grep'"))
    ).toThrow(
      "the search failed (exit 125): timeout: failed to run command 'grep'"
    )
  })

  test("keeps only lines that are paths", () => {
    expect(searchResult(answer(0, "Binary file matches\n/a\n")).files).toEqual([
      "/a",
    ])
  })
})

describe("foundWords", () => {
  test("found nowhere names every place", () => {
    expect(foundWords({ files: [] }, PLACES)).toBe(
      "found nowhere in Docker's root (/var/lib/docker), the containerd's data (/var/lib/containerd) and the check's runner folder (/tmp/zekno-check-x)"
    )
    expect(
      foundWords({ files: [], note: "grep could not read some files" }, PLACES)
    ).toEndWith(" (grep could not read some files)")
  })

  test("found files by place, at most four shown, and any elsewhere", () => {
    const files = [
      "/var/lib/docker/1",
      "/var/lib/docker/2",
      "/var/lib/docker/3",
      "/var/lib/docker/4",
      "/var/lib/docker/5",
      "/var/lib/dockerish/6",
    ]
    expect(foundWords({ files }, PLACES)).toBe(
      "found in Docker's root: 5 (/var/lib/docker/1, /var/lib/docker/2, /var/lib/docker/3, /var/lib/docker/4 and 1 more), the containerd's data: none, the check's runner folder: none, elsewhere: 1"
    )
    expect(
      foundWords({ files: ["/tmp/zekno-check-x/home/a"], note: "n" }, PLACES)
    ).toBe(
      "found in Docker's root: none, the containerd's data: none, the check's runner folder: 1 (/tmp/zekno-check-x/home/a) (n)"
    )
  })

  test("isUnder and listWords", () => {
    expect(isUnder("/a/b", "/a")).toBe(true)
    expect(isUnder("/a", "/a")).toBe(true)
    expect(isUnder("/ab", "/a")).toBe(false)
    expect(isUnder("/a/b", "/a/")).toBe(true)
    expect(listWords([])).toBe("")
    expect(listWords(["a"])).toBe("a")
    expect(listWords(["a", "b"])).toBe("a and b")
    expect(listWords(["a", "b", "c"])).toBe("a, b and c")
  })
})

describe("in the stand-in", () => {
  test("Docker's root comes from docker info, and the places follow it", async () => {
    const { run, calls } = fakeRun(() => ({ stdout: "/srv/docker\n" }))
    expect(await dockerRoot(run)).toBe("/srv/docker")
    expect(calls[0]!.args).toEqual([
      "docker",
      "info",
      "--format",
      "{{.DockerRootDir}}",
    ])
    expect(await searchPlaces(run, "/tmp/zekno-check-x")).toEqual([
      { path: "/srv/docker", name: "Docker's root" },
      { path: "/var/lib/containerd", name: "the containerd's data" },
      { path: "/tmp/zekno-check-x", name: "the check's runner folder" },
    ])
  })

  test("a root docker info does not give is the check's own fault", async () => {
    for (const reply of [
      { code: 1, stderr: "Cannot connect to the Docker daemon" },
      { stdout: "\n" },
      { stdout: "/\n" },
      { stdout: "relative\n" },
    ]) {
      const { run } = fakeRun(() => reply)
      await expect(dockerRoot(run)).rejects.toThrow(
        "docker info gave no root folder"
      )
    }
  })

  test("the search runs grep in the stand-in with a time limit beyond its own, the value on standard input only", async () => {
    const { run, calls } = fakeRun(() => ({ code: 1 }))
    expect(await searchStandIn(run, MARKER, PLACES, 60)).toEqual({ files: [] })
    expect(calls[0]!.args).toEqual(
      searchArgs(
        PLACES.map((place) => place.path),
        60
      )
    )
    expect(calls[0]!.args.join(" ")).not.toContain(MARKER)
    expect(calls[0]!.options).toEqual({
      stdin: { text: MARKER },
      timeoutMs: 120_000,
    })
  })

  test("a short or broken value is refused before any call, and never named", async () => {
    const { run, calls } = fakeRun(() => ({}))
    await expect(searchStandIn(run, "short", PLACES)).rejects.toThrow(
      "at least 16"
    )
    for (const value of [`${MARKER}\nx`, `${MARKER}\r`, `${MARKER}\0`]) {
      const error = await searchStandIn(run, value, PLACES).catch(
        (e: Error) => e
      )
      expect((error as Error).message).toBe(
        "a marker is one line of at least 16 characters"
      )
    }
    expect(calls).toEqual([])
  })
})
