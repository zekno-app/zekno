/**
 * `disk-use.ts` (specs/016-build-from-source, T014): L7's context and its
 * script's arguments exactly, the reading of the samples into each place's
 * peak against the floor, and the script itself run with `/bin/sh` on this
 * machine's temporary folder, with stand-ins for `df` and `date` (GNU's
 * `--output` and `%N`, which the stand-in has) and a shell for the client.
 * Nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  bytesWords,
  CONTEXT_FILES,
  contextArgs,
  DISK_DOCKERFILE,
  DISK_FLOOR_BYTES,
  DISK_SCRIPT,
  diskArgs,
  endOf,
  FILE_BYTES,
  peaksOf,
  peakWords,
  type Place,
} from "./disk-use"

const GIB = 1024 ** 3
const ROOT = "/tmp/zekno-check-disk"
const PLACES: Place[] = [
  { label: "Docker's root", path: "/var/lib/docker" },
  { label: "containerd's root", path: "/var/lib/containerd" },
  { label: "the work folder's parent", path: ROOT },
]

describe("L7's context and script", () => {
  test("the context: eight files of 64 MiB from /dev/urandom, and FROM scratch, COPY . /data", () => {
    expect(CONTEXT_FILES * FILE_BYTES).toBe(512 * 1024 ** 2)
    expect(DISK_DOCKERFILE).toBe("FROM scratch\nCOPY . /data\n")
    expect(contextArgs(`${ROOT}/context`)).toEqual([
      "sh",
      "-c",
      [
        "set -eu",
        'mkdir -p "$1"',
        "printf 'FROM scratch\\nCOPY . /data\\n' > \"$1/Dockerfile\"",
        "i=1",
        `while [ "$i" -le 8 ]; do head -c 67108864 /dev/urandom > "$1/blob-$i"; i=$((i + 1)); done`,
      ].join("\n"),
      "sh",
      `${ROOT}/context`,
    ])
    expect(() => contextArgs("/var/tmp")).toThrow(
      "is not a folder under /tmp/zekno-check-*"
    )
  })

  test("the script's arguments: its entry, its files, the places, then -- and the client", () => {
    const entry = "ZEKNO_CHECK_DISK=0a1b2c3d4e5f"
    expect(
      diskArgs({
        entry,
        samples: `${ROOT}/samples`,
        out: `${ROOT}/out`,
        context: `${ROOT}/context`,
        places: PLACES,
        client: ["timeout", "-k", "5", "900", "env", "-i", "docker"],
      })
    ).toEqual([
      ...["env", entry, "sh", "-c", DISK_SCRIPT, "sh"],
      ...[`${ROOT}/samples`, `${ROOT}/out`, `${ROOT}/context`],
      ...["/var/lib/docker", "/var/lib/containerd", ROOT, "--"],
      ...["timeout", "-k", "5", "900", "env", "-i", "docker"],
    ])
    const base = {
      entry,
      samples: `${ROOT}/samples`,
      out: `${ROOT}/out`,
      context: `${ROOT}/context`,
      places: PLACES,
      client: ["docker"],
    }
    expect(() => diskArgs({ ...base, entry: "PATH=/x" })).toThrow(
      "is not the check's entry"
    )
    expect(() =>
      diskArgs({ ...base, places: [{ label: "x", path: "relative" }] })
    ).toThrow("is not a place to sample")
    expect(() =>
      diskArgs({ ...base, places: [{ label: "x", path: "/a b" }] })
    ).toThrow("is not a place to sample")
    expect(() => diskArgs({ ...base, client: [] })).toThrow(
      "builds with a client"
    )
    expect(() => diskArgs({ ...base, out: "/etc/out" })).toThrow("the output")
  })

  test("the script's last line: the client's status and how long it ran", () => {
    expect(
      endOf("noise\n0 1764237600.250000000 1764237642.900000000\n")
    ).toEqual({
      code: 0,
      seconds: 42.7,
    })
    expect(endOf("124 10 20")).toEqual({ code: 124, seconds: 10 })
    expect(endOf("")).toBeUndefined()
    expect(endOf("built")).toBeUndefined()
  })
})

describe("the samples, read", () => {
  const SAMPLES = [
    `1.0 /var/lib/docker /dev/root ${10 * GIB} ${20 * GIB}`,
    "1.0 /var/lib/containerd absent",
    `1.0 ${ROOT} overlay ${5 * GIB} ${30 * GIB}`,
    `2.0 /var/lib/docker /dev/root ${11.5 * GIB} ${18.5 * GIB}`,
    `2.0 ${ROOT} overlay ${5 * GIB} ${30 * GIB}`,
    `3.0 /var/lib/docker /dev/root ${10.25 * GIB} ${19.75 * GIB}`,
    "3.0 /var/lib/docker df: cannot read x",
    "garbage",
  ].join("\n")

  test("each place's filesystem, start, most used and least free", () => {
    const [docker, containerd, work] = peaksOf(SAMPLES, PLACES)
    expect(docker).toEqual({
      place: PLACES[0]!,
      samples: 3,
      source: "/dev/root",
      start: 10 * GIB,
      most: 11.5 * GIB,
      leastFree: 18.5 * GIB,
    })
    expect(containerd).toEqual({ place: PLACES[1]!, samples: 0 })
    expect(work!.most! - work!.start!).toBe(0)
  })

  test("the words: the growth over the start against the floor, the least free, or absent", () => {
    const [docker, containerd, work] = peaksOf(SAMPLES, PLACES)
    expect(peakWords(docker!, 2 * GIB)).toBe(
      "Docker's root /var/lib/docker (on /dev/root): at most +1.50 GiB over its start, 75% of the 2.00 GiB floor; least free 18.50 GiB"
    )
    expect(peakWords(containerd!, 2 * GIB)).toBe(
      "containerd's root /var/lib/containerd: absent"
    )
    expect(peakWords(work!, 2 * GIB)).toBe(
      `the work folder's parent ${ROOT} (on overlay): at most +0 B over its start, 0% of the 2.00 GiB floor; least free 30.00 GiB`
    )
  })

  test("sizes in words, and the floor CO16 gives (2 GiB) until core's LIMITS holds its own", () => {
    expect(bytesWords(1.5 * GIB)).toBe("1.50 GiB")
    expect(bytesWords(512 * 1024 ** 2)).toBe("512 MiB")
    expect(bytesWords(40 * 1024)).toBe("40 KiB")
    expect(bytesWords(12)).toBe("12 B")
    expect(bytesWords(-3 * 1024 ** 2)).toBe("-3 MiB")
    expect(DISK_FLOOR_BYTES).toBe(2 * GIB)
  })
})

describe("the script, run with /bin/sh", () => {
  test("samples before and after, pipes the context's files as a tar to the client, and ends with its status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zekno-check-disk-"))
    try {
      const shims = join(dir, "shims")
      mkdirSync(shims)
      const shim = (name: string, body: string) => {
        writeFileSync(join(shims, name), `#!/bin/sh\n${body}\n`)
        chmodSync(join(shims, name), 0o755)
      }
      shim("df", 'echo "Filesystem Used Avail"; echo "/dev/shim 1000 5000"')
      shim("date", "echo 1764237600.500000000")
      const context = join(dir, "context")
      mkdirSync(context)
      writeFileSync(join(context, "Dockerfile"), DISK_DOCKERFILE)
      writeFileSync(join(context, "blob-1"), "random\n")
      const samples = join(dir, "samples")
      const out = join(dir, "out")
      const child = Bun.spawn(
        [
          ...["sh", "-c", DISK_SCRIPT, "sh", samples, out, context],
          ...[dir, join(dir, "absent"), "--"],
          ...["sh", "-c", "tar -tf - | sort; exit 3"],
        ],
        {
          env: { PATH: `${shims}:/usr/bin:/bin` },
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          timeout: 20_000,
        }
      )
      const stdout = await new Response(child.stdout).text()
      expect(await child.exited).toBe(0)
      expect(endOf(stdout)).toEqual({ code: 3, seconds: 0 })
      expect(readFileSync(out, "utf8")).toBe("Dockerfile\nblob-1\n")
      const lines = readFileSync(samples, "utf8").trim().split("\n")
      expect(lines.slice(0, 2)).toEqual([
        `1764237600.500000000 ${dir} /dev/shim 1000 5000`,
        `1764237600.500000000 ${join(dir, "absent")} absent`,
      ])
      expect(lines.length % 2).toBe(0)
      expect(lines.length).toBeGreaterThanOrEqual(4)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
