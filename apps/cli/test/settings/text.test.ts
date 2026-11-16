/**
 * The form zekno writes a settings file in (specs/010-app-settings,
 * contracts/settings-file.md, "How zekno writes it"; research R5; tasks
 * T014): design.md's example byte for byte, one change one line, and every
 * good file read back the same.
 */
import { describe, expect, test } from "bun:test"

import { checkSettings } from "../../src/settings/schema"
import { settingsText } from "../../src/settings/text"
import type { ServiceSettings, Settings } from "../../src/settings/types"
import {
  DESIGN_FILE,
  DESIGN_SETTINGS,
  GOOD_FILES,
} from "../support/settings-files"

const one = (service: ServiceSettings): Settings => ({
  version: 1,
  services: [["web", service]],
})

/** The settings of design.md's file with `web` changed by `change`. */
const designWith = (change: Partial<ServiceSettings>): Settings => ({
  version: 1,
  services: DESIGN_SETTINGS.services.map(([name, service]) =>
    name === "web"
      ? ([name, { ...service, ...change }] as const)
      : [name, service]
  ),
})

/** The lines of two texts that differ, by number. */
function differing(a: string, b: string): number[] {
  const left = a.split("\n")
  const right = b.split("\n")
  expect(left.length).toBe(right.length)
  return left.flatMap((line, at) => (line === right[at] ? [] : [at + 1]))
}

describe("settingsText", () => {
  test("design.md's settings are design.md's text, byte for byte", () => {
    expect(settingsText(DESIGN_SETTINGS)).toBe(DESIGN_FILE)
  })

  test("the smallest file: the file, services and each service always open on their own line", () => {
    expect(settingsText(one({ image: "nginx:1.27" }))).toBe(
      '{\n  "zekno": 1,\n  "services": {\n    "web": {\n      "source": { "image": "nginx:1.27" }\n    }\n  }\n}\n'
    )
  })

  test("changing the memory of design.md's file changes exactly one line", () => {
    const changed = settingsText(designWith({ memory: "512m" }))
    expect(differing(DESIGN_FILE, changed)).toEqual([9])
    expect(changed.split("\n")[8]).toBe('        "memory": "512m",')
  })

  test("each one change of design.md's file changes one line", () => {
    for (const change of [
      { image: "ghcr.io/acme/demo-web:1.5.0" },
      { start: "bun run serve" },
      { restart: "always" as const },
      { cpus: "2" },
      { port: 8080 },
      { plain: [["NODE_ENV", "staging"]] as const },
      { volumes: [["uploads", "/srv/uploads"]] as const },
    ])
      expect(
        differing(DESIGN_FILE, settingsText(designWith(change)))
      ).toHaveLength(1)
  })

  test("a start command of 60 characters makes deploy open on its own lines", () => {
    const start = "a".repeat(60)
    expect(settingsText(one({ image: "nginx:1.27", start }))).toBe(
      `{\n  "zekno": 1,\n  "services": {\n    "web": {\n      "source": { "image": "nginx:1.27" },\n      "deploy": {\n        "start": "${start}"\n      }\n    }\n  }\n}\n`
    )
  })

  test("a line of 80 characters with its comma stays on one line; one of 81 does not", () => {
    // `      "source": { "image": "<image>" },` is 32 characters with an image of nothing.
    const fits = settingsText(one({ image: "a".repeat(48), start: "x" }))
    expect(fits).toContain(
      `      "source": { "image": "${"a".repeat(48)}" },\n`
    )
    const over = settingsText(one({ image: "a".repeat(49), start: "x" }))
    expect(over).toContain(
      `      "source": {\n        "image": "${"a".repeat(49)}"\n      },\n`
    )
    // The comma is counted for the last member too, as the contract writes it.
    const last = settingsText(one({ image: "a".repeat(49) }))
    expect(last).toContain(
      `      "source": {\n        "image": "${"a".repeat(49)}"\n      }\n`
    )
  })

  test("a list too long for one line has one item a line", () => {
    const secrets = Array.from({ length: 12 }, (_, at) => `SECRET_${at}`)
    const text = settingsText(one({ image: "nginx:1.27", secrets }))
    expect(text).toContain(
      `        "secrets": [\n${secrets.map((name) => `          "${name}"`).join(",\n")}\n        ]\n`
    )
  })

  test("width is counted in characters, not bytes or UTF-16 units", () => {
    const value = "🚀".repeat(30)
    const text = settingsText(
      one({ image: "nginx:1.27", plain: [["A", value]] })
    )
    expect(text).toContain(
      `      "variables": { "plain": { "A": "${value}" } }\n`
    )
  })

  test("keys given in another order come out in zekno's", () => {
    const service = {
      volumes: [["data", "/data"]],
      secrets: ["A"],
      publish: 80,
      port: 3000,
      cpus: "1",
      memory: "1g",
      restart: "always",
      start: "x",
      image: "nginx:1.27",
    } as ServiceSettings
    expect(settingsText(one(service))).toBe(
      settingsText(
        one({
          image: "nginx:1.27",
          start: "x",
          restart: "always",
          memory: "1g",
          cpus: "1",
          port: 3000,
          publish: 80,
          secrets: ["A"],
          volumes: [["data", "/data"]],
        })
      )
    )
  })

  test("empty sections, lists and objects are left out", () => {
    expect(
      settingsText(
        one({ image: "nginx:1.27", secrets: [], plain: [], volumes: [] })
      )
    ).toBe(settingsText(one({ image: "nginx:1.27" })))
  })

  test("a plain value with quotes, backslashes, dollars and other scripts is written as JSON.stringify writes it", () => {
    const value = 'say "hi" \\ $HOME ${X} café 東京 🚀'
    const text = settingsText(
      one({ image: "nginx:1.27", plain: [["A", value]] })
    )
    expect(text).toContain(`"A": ${JSON.stringify(value)}`)
  })

  test("a processor limit is written as the file had it", () => {
    expect(settingsText(one({ image: "nginx:1.27", cpus: "1.50" }))).toContain(
      '"deploy": { "cpus": 1.50 }'
    )
  })

  test("every good file of the test set is read back the same", () => {
    for (const file of GOOD_FILES) {
      const settings = file.expect.settings
      expect([
        file.name,
        checkSettings(settingsText(settings), "zekno.app.json"),
      ]).toEqual([file.name, settings])
    }
  })

  test("the same settings give the same text twice", () => {
    for (const file of GOOD_FILES)
      expect(settingsText(file.expect.settings)).toBe(
        settingsText(file.expect.settings)
      )
  })
})
