/**
 * How a setting's value reads (specs/010-app-settings, contracts/commands.md
 * and contracts/app-screen.md, "Words"; tasks T018): set values and the
 * words of a setting left out, the labels and values of a change, and a
 * value cleaned before it is shown. Split from change.test.ts, by subject.
 */
import { describe, expect, test } from "bun:test"

import {
  applyChange,
  parseSettingPath,
  shownValue,
} from "../../src/settings/change"
import type { Change, SettingPath, Settings } from "../../src/settings/types"
import { DESIGN_SETTINGS } from "../support/settings-files"

/** The change, or the test fails with the refusal. */
function change(
  settings: Settings,
  path: string,
  value: string | undefined
): Change {
  const parsed = parseSettingPath(path)
  if (!("service" in parsed)) throw new Error(`no setting ${path}`)
  const got = applyChange(settings, parsed, value)
  if ("refused" in got) throw new Error(`refused: ${got.refused}`)
  return got
}

/** The refusal, or the test fails. */
function refusal(settings: Settings, path: string, value: string | undefined) {
  const parsed = parseSettingPath(path)
  if (!("service" in parsed)) throw new Error(`no setting ${path}`)
  const got = applyChange(settings, parsed, value)
  if (!("refused" in got)) throw new Error("expected a refusal")
  return got
}

describe("how a value reads (contracts/commands.md and contracts/app-screen.md, Words)", () => {
  test("set values, and the words of a setting left out", () => {
    const read = (path: SettingPath) => shownValue(path, DESIGN_SETTINGS)
    expect(read({ service: "web", key: "memory" })).toBe("1g")
    expect(read({ service: "web", key: "restart" })).toBe("on failure")
    expect(read({ service: "worker", key: "restart" })).toBe("always")
    expect(read({ service: "worker", key: "memory" })).toBe("no limit")
    expect(read({ service: "worker", key: "cpus" })).toBe("no limit")
    expect(read({ service: "worker", key: "port" })).toBe("none")
    expect(read({ service: "web", key: "publish" })).toBe("not published")
    expect(read({ service: "web", key: "secrets" })).toBe(
      "DATABASE_URL, SESSION_KEY"
    )
    expect(read({ service: "web", key: "plain", name: "NODE_ENV" })).toBe(
      "production"
    )
    expect(read({ service: "web", key: "plain", name: "NOPE" })).toBe("none")
    expect(read({ service: "web", key: "volume", name: "uploads" })).toBe(
      "/data/uploads"
    )
    expect(read({ service: "web", key: "volume", name: "nope" })).toBe("none")
    expect(read({ service: "nope", key: "start" })).toBe("the image's own")
  })

  test("the labels and values of a change: 512m to 1g, 1g to no limit, on-failure reads on failure", () => {
    const at512 = change(DESIGN_SETTINGS, "web.memory", "512m")
    const to1g = change(at512.settings, "web.memory", "1g")
    expect([to1g.label, to1g.now, to1g.next]).toEqual([
      "memory limit",
      "512m",
      "1g",
    ])
    const unset = change(DESIGN_SETTINGS, "web.memory", undefined)
    expect([unset.label, unset.now, unset.next]).toEqual([
      "memory limit",
      "1g",
      "no limit",
    ])
    const restart = change(DESIGN_SETTINGS, "worker.restart", "on-failure")
    expect([restart.label, restart.now, restart.next]).toEqual([
      "restart rule",
      "always",
      "on failure",
    ])
    expect(change(DESIGN_SETTINGS, "web.plain.NODE_ENV", "").next).toBe('""')
    expect(change(DESIGN_SETTINGS, "web.volumes.uploads", "/x").label).toBe(
      "volume uploads"
    )
    expect(change(DESIGN_SETTINGS, "web.plain.NODE_ENV", "x").label).toBe(
      "NODE_ENV"
    )
  })

  test("a value is cleaned before it is shown", () => {
    // No file or change can hold U+202E any more (security review S2); settings made in memory still never draw it.
    const settings: Settings = {
      version: 1,
      services: [["web", { image: "nginx:1.27", plain: [["X", "a\u202eb"]] }]],
    }
    expect(
      shownValue({ service: "web", key: "plain", name: "X" }, settings)
    ).toBe("ab")
    expect(refusal(DESIGN_SETTINGS, "web.plain.X", "a\u202eb")).toEqual({
      refused:
        "That is not a value zekno can write. Use no invisible character, such as a zero-width space or a right-to-left mark.",
      status: 2,
    })
  })
})
