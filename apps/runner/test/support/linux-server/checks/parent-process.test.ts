/**
 * `parent-process.ts` (specs/016-build-from-source, T013): L5's step, the
 * parent's script and how it is started, the kill, the search for the
 * marker, the pack written into the stand-in, and the words of the record
 * line. The parent's script is also run here with `/bin/sh` and a client
 * that is a shell, on this machine's own temporary folder: it reads all the
 * client prints, and leaves both process ids. Nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { RunOptions } from "../host/host-docker"
import {
  killNowArgs,
  LAUNCH,
  launchArgs,
  markerArgs,
  momentWords,
  PARENT_FILES,
  parentScript,
  pidIn,
  putFile,
  scenarioWords,
  stoppingDockerfile,
  type Scenario,
} from "./parent-process"

const BASE =
  "busybox@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662"
const MARKER = "zekno-check-stopping-0a1b2c3d4e5f-parent"
const DIR = "/tmp/zekno-check-stopping/parent"

describe("L5's step and its parent", () => {
  test("the step sleeps 90 seconds, prints nothing, then writes the marker into its cache mount", () => {
    expect(stoppingDockerfile(BASE, MARKER)).toBe(
      `FROM ${BASE}\nRUN --mount=type=cache,target=/cache sleep 90 && echo ${MARKER} > /cache/${MARKER}\n`
    )
    expect(() => stoppingDockerfile(BASE, "x; rm -rf /")).toThrow(
      "is not a marker of L5"
    )
    expect(() => stoppingDockerfile("busybox\nRUN x", MARKER)).toThrow(
      "is not an image"
    )
  })

  test("the parent starts the client on the pack, its output into a FIFO only it reads", () => {
    expect(
      parentScript(["env", "-i", "A=it's", "docker", "buildx", "build", "-"])
    ).toBe(
      [
        "dir=$1",
        'echo "$$" > "$dir/parent.pid"',
        'mkfifo "$dir/out"',
        `'env' '-i' 'A=it'\\''s' 'docker' 'buildx' 'build' '-' < "$dir/pack.tar" > "$dir/out" 2>&1 &`,
        'echo "$!" > "$dir/client.pid"',
        'exec 3< "$dir/out"',
        `while IFS= read -r line <&3; do printf '%s\\n' "$line" >> "$dir/seen"; done`,
      ].join("\n")
    )
    expect(() => parentScript([])).toThrow("the parent starts a client")
  })

  test("it is started detached, with its own entry, in a folder of the check", () => {
    expect(LAUNCH).toBe(
      'ZEKNO_CHECK_PARENT="$1" setsid sh -c "$2" sh "$3" > /dev/null 2>&1 < /dev/null &'
    )
    expect(launchArgs(MARKER, DIR, ["true"])).toEqual([
      "sh",
      "-c",
      LAUNCH,
      "sh",
      MARKER,
      parentScript(["true"]),
      DIR,
    ])
    expect(() => launchArgs("zekno-check-other", DIR, ["true"])).toThrow(
      "is not a marker of L5"
    )
    expect(() => launchArgs(MARKER, "/root", ["true"])).toThrow(
      "is not a folder under /tmp/zekno-check-*"
    )
  })

  test("the kill gives the stand-in's time; the marker is searched in Docker's and containerd's roots", () => {
    expect(killNowArgs(4242)).toEqual([
      "sh",
      "-c",
      'kill -9 "$1" && date -u +%Y-%m-%dT%H:%M:%S.%NZ',
      "sh",
      "4242",
    ])
    for (const pid of [1, 0, -1, 2.5]) expect(() => killNowArgs(pid)).toThrow()
    expect(markerArgs(MARKER)).toEqual([
      "sh",
      "-c",
      'find /var/lib/docker /var/lib/containerd -name "$1" -print -quit 2> /dev/null || :',
      "sh",
      MARKER,
    ])
    expect(() => markerArgs("*")).toThrow("is not a marker of L5")
  })

  test("a pid file's id, or none", () => {
    expect(pidIn("4242\n")).toBe(4242)
    for (const bad of ["", "0", "-1", "12a", "99999999999999999999"])
      expect(pidIn(bad)).toBeUndefined()
  })
})

describe("the parent's script, run with /bin/sh", () => {
  test("reads every line the client prints, and leaves both process ids", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zekno-check-parent-"))
    try {
      writeFileSync(join(dir, PARENT_FILES.pack), "the pack\n")
      const client = ["sh", "-c", 'cat; echo "second line" >&2']
      const child = Bun.spawn(["sh", "-c", parentScript(client), "sh", dir], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        timeout: 10_000,
      })
      expect(await child.exited).toBe(0)
      expect(readFileSync(join(dir, PARENT_FILES.seen), "utf8")).toBe(
        "the pack\nsecond line\n"
      )
      expect(pidIn(readFileSync(join(dir, PARENT_FILES.parent), "utf8"))).toBe(
        child.pid
      )
      expect(
        pidIn(readFileSync(join(dir, PARENT_FILES.client), "utf8"))
      ).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("the pack, written into the stand-in", () => {
  test("from a temporary file on this machine, handed on standard input, removed after", async () => {
    let seen:
      | { args: string[]; file: string; bytes: string; there: boolean }
      | undefined
    const run = async (args: readonly string[], options?: RunOptions) => {
      const file =
        options?.stdin && "file" in options.stdin ? options.stdin.file : ""
      seen = {
        args: [...args],
        file,
        bytes: readFileSync(file, "utf8"),
        there: existsSync(file),
      }
      return { code: 0, stdout: "", stderr: "" }
    }
    await putFile(run, `${DIR}/pack.tar`, new TextEncoder().encode("tar bytes"))
    expect(seen?.args).toEqual([
      "sh",
      "-c",
      'cat > "$1"',
      "sh",
      `${DIR}/pack.tar`,
    ])
    expect(seen?.bytes).toBe("tar bytes")
    expect(seen?.there).toBe(true)
    expect(existsSync(seen!.file)).toBe(false)
    const failing = async () => ({
      code: 1,
      stdout: "",
      stderr: "sh: read-only\n",
    })
    await expect(
      putFile(failing, `${DIR}/x`, new Uint8Array())
    ).rejects.toThrow(`writing ${DIR}/x failed: sh: read-only`)
  })
})

describe("L5's words", () => {
  const docker = { pid: 10, comm: "docker", state: "S" }
  const plugin = { pid: 11, comm: "docker-buildx", state: "S" }

  test("a moment: the client, what holds the run's token, the record", () => {
    expect(
      momentWords({
        after: 5,
        client: docker,
        carrying: [docker, plugin, { pid: 12, comm: "x", state: "Z" }],
        record: { status: "Running" },
      })
    ).toBe(
      "after 5 s the client alive (docker, S), the run's token held by docker, docker-buildx, the record Running"
    )
    expect(
      momentWords({
        after: 60,
        client: undefined,
        carrying: [],
        record: undefined,
      })
    ).toBe(
      "after 60 s the client gone, no process holds the run's token, the record not listed"
    )
  })

  test("a kill: its moments, how the record ended and when, the marker, the client at the end", () => {
    const scenario: Scenario = {
      killed: "the reader",
      linesRead: 12,
      moments: [
        {
          after: 5,
          client: docker,
          carrying: [docker],
          record: { status: "Running" },
        },
      ],
      ended: { status: "Completed", seconds: 80.2 },
      marker: true,
      last: undefined,
      metadata: "no metadata file",
      inspect: "Duration: 1m 31s",
    }
    expect(scenarioWords(scenario)).toBe(
      "the reader killed 10 s after the silent step started, 12 lines read; after 5 s the client alive (docker, S), the run's token held by docker, the record Running; the record Completed 80.2 s after the kill; the marker written; at the end the client gone; no metadata file; history inspect: Duration: 1m 31s"
    )
    expect(
      scenarioWords({ ...scenario, ended: { status: "Error" }, marker: false })
    ).toContain("the record Error (no completion time); the marker not written")
    expect(
      scenarioWords({ ...scenario, ended: undefined, runningAfter: 150 })
    ).toContain("the record still Running 150 s after the kill")
    expect(scenarioWords({ ...scenario, ended: undefined })).toContain(
      "still Running ? s after the kill"
    )
    expect(scenarioWords({ ...scenario, linesRead: 1 })).toContain(
      "started, 1 line read;"
    )
  })
})
