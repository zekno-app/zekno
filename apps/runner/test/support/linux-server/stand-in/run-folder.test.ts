/**
 * The run's folder (`run-folder.ts`; specs/016-build-from-source, T008): in
 * the system's temporary folder, named for the run, readable by its owner
 * only; it keeps the client's key, known_hosts and run.json, the record
 * `down` needs of what was there before `up`. Read strictly.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  makeRunFolder,
  readState,
  removeRunFolder,
  runFolder,
  runIds,
  writeState,
  type RunState,
} from "./run-folder"

const ID = "a1b2c3d4"
const STATE: RunState = {
  id: ID,
  endpoint: "unix:///var/run/docker.sock",
  engine: "older",
  store: "overlay2",
  memory: true,
  port: 24680,
  before: {
    containers: [],
    volumes: [],
    networks: [],
    images: ["sha256:00 busybox:<none>@sha256:73"],
    buildRecords: null,
  },
  images: [
    {
      image:
        "ubuntu@sha256:562111b88caa79c71391c0c4d3c2114a7d5c35915c20561fd893cb1e07929e6b",
      present: false,
    },
  ],
}

const roots: string[] = []
const newRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "zekno-run-folder-"))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe("the run's folder", () => {
  test("is zekno-check-<id> in the root, mode 0700, made once", () => {
    const root = newRoot()
    expect(runFolder(root, ID)).toBe(join(root, `zekno-check-${ID}`))
    const folder = makeRunFolder(root, ID)
    expect(statSync(folder).mode & 0o777).toBe(0o700)
    expect(() => makeRunFolder(root, ID)).toThrow()
    expect(() => runFolder(root, "../../etc")).toThrow(
      "8 lowercase letters and digits"
    )
  })

  test("run.json is written with mode 0600 and read back as it was", () => {
    const root = newRoot()
    const folder = makeRunFolder(root, ID)
    writeState(folder, STATE)
    expect(statSync(join(folder, "run.json")).mode & 0o777).toBe(0o600)
    expect(readState(root, ID)).toEqual(STATE)
    writeState(folder, { ...STATE, engine: "newest" })
    expect(readState(root, ID)).toEqual({ ...STATE, engine: "newest" })
    expect(existsSync(join(folder, "run.json.part"))).toBe(false)
  })

  test("a run.json that is missing, not JSON, of another run or of another shape gives why", () => {
    const root = newRoot()
    expect(readState(root, ID)).toEqual({ reason: "is not there" })
    const folder = makeRunFolder(root, ID)
    const file = join(folder, "run.json")
    const cases: [string, string][] = [
      ["{", "is not JSON"],
      [JSON.stringify({ ...STATE, id: "zzzzzzzz" }), "is of another run"],
      [JSON.stringify({ ...STATE, port: "24680" }), "has port wrong"],
      [
        JSON.stringify({ ...STATE, endpoint: "ssh://maintainer@server" }),
        "has endpoint wrong",
      ],
      [
        JSON.stringify({ ...STATE, endpoint: "tcp://127.0.0.1:2375" }),
        "has endpoint wrong",
      ],
      [JSON.stringify({ ...STATE, endpoint: undefined }), "has endpoint wrong"],
      [JSON.stringify({ ...STATE, engine: "nightly" }), "has engine wrong"],
      [
        JSON.stringify({ ...STATE, before: { ...STATE.before, images: [1] } }),
        "has before.images wrong",
      ],
      [
        JSON.stringify({
          ...STATE,
          before: { ...STATE.before, buildRecords: -1 },
        }),
        "has before.buildRecords wrong",
      ],
      [
        JSON.stringify({
          ...STATE,
          images: [{ image: "ubuntu:24.04", present: false }],
        }),
        "has images wrong",
      ],
      [
        JSON.stringify({ ...STATE, extra: 1 }),
        "has extra, which it does not know",
      ],
    ]
    for (const [text, reason] of cases) {
      writeFileSync(file, text)
      expect(readState(root, ID)).toEqual({ reason })
    }
  })

  test("the ids of the run folders, and removing one removes only it", () => {
    const root = newRoot()
    makeRunFolder(root, ID)
    makeRunFolder(root, "zzzzzzzz")
    mkdirSync(join(root, "zekno-check-odd"))
    mkdirSync(join(root, "zekno-buildx-123"))
    writeFileSync(join(root, "zekno-check-b2c3d4e5"), "a file, not a folder")
    expect(runIds(root)).toEqual([ID, "zzzzzzzz"])
    removeRunFolder(root, ID)
    expect(runIds(root)).toEqual(["zzzzzzzz"])
    removeRunFolder(root, ID)
    expect(existsSync(join(root, "zekno-check-odd"))).toBe(true)
  })
})
