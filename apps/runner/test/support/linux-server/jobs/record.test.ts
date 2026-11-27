/**
 * `record.ts` (specs/016-build-from-source, T009), branch by branch: one
 * line whatever was seen, the engine and the store from run-checks.ts's
 * variables or the stand-in's run.json, and the step's summary on GitHub.
 * Nothing here runs Docker.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  appendToSummary,
  legOf,
  oneLine,
  record,
  recordLine,
  UNKNOWN,
} from "./record"
import { makeRunFolder, writeState } from "../stand-in/run-folder"

const FLOOR = { ZEKNO_CHECK_ENGINE: "floor", ZEKNO_CHECK_STORE: "containerd" }
const temps: string[] = []
const temp = (label: string) => {
  const folder = mkdtempSync(join(tmpdir(), `zekno-record-${label}-`))
  temps.push(folder)
  return folder
}

afterEach(() => {
  for (const folder of temps.splice(0))
    rmSync(folder, { recursive: true, force: true })
})

describe("what was seen", () => {
  test("is one line whatever it held: breaks become ` / `, tabs spaces, control characters `?`", () => {
    expect(oneLine("built\nno request\r\nfor it\rat all")).toBe(
      "built / no request / for it / at all"
    )
    expect(
      oneLine(`a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x85)}c`)
    ).toBe("a / b / c")
    expect(oneLine("  \tstep\tran  ")).toBe("step ran")
    expect(
      oneLine(
        `bell${String.fromCharCode(7)} and escape${String.fromCharCode(27)}[0m`
      )
    ).toBe("bell? and escape?[0m")
  })

  test("nothing seen is the check's own fault", () => {
    expect(() => oneLine("")).toThrow("a record says what was seen")
    expect(() => oneLine(" \n\t ")).toThrow("a record says what was seen")
  })
})

describe("the engine and the store", () => {
  test("from ZEKNO_CHECK_ENGINE and ZEKNO_CHECK_STORE, both an engine and a store, or both none", () => {
    expect(legOf(FLOOR)).toEqual({ engine: "floor", store: "containerd" })
    expect(
      legOf({ ZEKNO_CHECK_ENGINE: "none", ZEKNO_CHECK_STORE: "none" })
    ).toEqual({
      engine: "none",
      store: "none",
    })
    for (const env of [
      { ZEKNO_CHECK_ENGINE: "floor" },
      { ZEKNO_CHECK_STORE: "overlay2" },
      { ZEKNO_CHECK_ENGINE: "latest", ZEKNO_CHECK_STORE: "overlay2" },
      { ZEKNO_CHECK_ENGINE: "floor", ZEKNO_CHECK_STORE: "zfs" },
      { ZEKNO_CHECK_ENGINE: "none", ZEKNO_CHECK_STORE: "containerd" },
    ])
      expect(() => legOf(env)).toThrow(
        "are not an engine and a store of the stand-in"
      )
  })

  test("run by hand without them: the stand-in's run.json, else unknown", () => {
    const root = temp("state")
    writeState(makeRunFolder(root, "a1b2c3d4"), {
      id: "a1b2c3d4",
      endpoint: "unix:///var/run/docker.sock",
      engine: "newest",
      store: "overlay2",
      memory: false,
      port: 22022,
      before: {
        containers: [],
        volumes: [],
        networks: [],
        images: [],
        buildRecords: 3,
      },
      images: [],
    })
    expect(
      legOf({ ZEKNO_LINUX_SERVER: "zekno-check-a1b2c3d4-server" }, root)
    ).toEqual({
      engine: "newest",
      store: "overlay2",
    })
    expect(
      legOf({ ZEKNO_LINUX_SERVER: "zekno-check-zzzzzzzz-server" }, root)
    ).toEqual({
      engine: UNKNOWN,
      store: UNKNOWN,
    })
    expect(legOf({}, root)).toEqual({ engine: UNKNOWN, store: UNKNOWN })
    expect(() => legOf({ ZEKNO_LINUX_SERVER: "sessora-db" }, root)).toThrow(
      "no check runs in another container"
    )
  })
})

describe("the record line", () => {
  test("names a check or a part of modes.ts, never anything else", () => {
    expect(recordLine("L4b", "cached", FLOOR)).toBe(
      "L4b floor containerd: cached"
    )
    expect(recordLine("B4 (ARM64 part)", "arm64", FLOOR)).toBe(
      "B4 (ARM64 part) floor containerd: arm64"
    )
    expect(recordLine("B1", "both parts", FLOOR)).toBe(
      "B1 floor containerd: both parts"
    )
    for (const id of ["L19", "R13", "B1 (Dockerfile)", "B2 (proof part)", ""])
      expect(() => recordLine(id, "x", FLOOR)).toThrow(
        "is no check or part of modes.ts"
      )
  })

  test("is printed, and appended to the step's summary only on GitHub", () => {
    const printed: string[] = []
    expect(
      record("L5", "Running\nthen Completed", FLOOR, (line) =>
        printed.push(line)
      )
    ).toBe("L5 floor containerd: Running / then Completed")
    expect(printed).toEqual(["L5 floor containerd: Running / then Completed"])
    const summary = join(temp("summary"), "summary.md")
    const env = { ...FLOOR, GITHUB_STEP_SUMMARY: summary }
    record("L2", "built", env, () => {})
    record("L3", "<none> *seen*", env, () => {})
    expect(readFileSync(summary, "utf8")).toBe(
      "    L2 floor containerd: built\n    L3 floor containerd: <none> *seen*\n"
    )
  })

  test("in the summary, a line of an indented code block, after a blank line when other text came before", () => {
    const summary = join(temp("summary"), "summary.md")
    writeFileSync(summary, "### checks\n")
    appendToSummary(summary, "L2 floor containerd: built")
    appendToSummary(summary, "L3 floor containerd: seen")
    expect(readFileSync(summary, "utf8")).toBe(
      "### checks\n\n    L2 floor containerd: built\n    L3 floor containerd: seen\n"
    )
  })
})
