/**
 * Checking a settings file's text against hostile files and the limits
 * (specs/010-app-settings, contracts/settings-file.md; tasks T010): SV33,
 * keys a prototype has, hidden duplicate keys, byte order marks, number
 * forms, wrong types in every place, values that look like sentences or
 * hold escape sequences, and texts that must never throw.
 */
import { describe, expect, test } from "bun:test"

import { faultSentence } from "../../src/settings/file"
import {
  acrossSettings,
  checkSettings,
  isSettings,
} from "../../src/settings/schema"
import type { Settings } from "../../src/settings/types"
import {
  DESIGN_FILE,
  DESIGN_SETTINGS,
  GOOD_FILES,
} from "../support/settings-files"

const FILE = "zekno.app.json"

/** The sentence a text stops with, as a person reads it. */
function sentence(text: string): string {
  const read = checkSettings(text, FILE)
  if (isSettings(read))
    throw new Error("expected a fault, the settings were read")
  return faultSentence(read, FILE)
}

const json = (value: unknown): string => JSON.stringify(value, null, 2)
const IMAGE = "ghcr.io/acme/web:1.4.2"
const web = (sections: Record<string, unknown>, more = {}): string =>
  json({
    zekno: 1,
    services: { web: { source: { image: IMAGE }, ...sections }, ...more },
  })
const form = (said: string): string =>
  `${FILE} could not be read as settings. ${said}`

describe("SV33: the Compose text a deploy carries", () => {
  test("settings whose Compose text is larger than 256 KiB are refused (rule 6, last)", () => {
    const secrets = Array.from(
      { length: 256 },
      (_, at) => `S${String(at).padStart(3, "0")}${"x".repeat(124)}`
    )
    const settings: Settings = {
      version: 1,
      services: Array.from(
        { length: 8 },
        (_, at) => [`s${at}`, { image: IMAGE, secrets }] as const
      ),
    }
    expect(acrossSettings(settings)).toEqual({
      place: "services",
      rule: "they turn into Compose text larger than the 256 KiB a deploy carries.",
    })
  })

  test("no file within the other limits reaches it: the largest such text measured stays below 256 KiB", () => {
    const one = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_"]
    const two = one.flatMap((a) =>
      [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].map((b) => a + b)
    )
    const secrets = [...one, ...two].slice(0, 256)
    const volumes = Object.fromEntries(
      [..."abcdefghijklmnop"].map((name) => [name, `/${name}`])
    )
    const services = Object.fromEntries(
      Array.from({ length: 32 }, (_, at) => [
        `s${at}`,
        {
          source: { image: "a" },
          deploy: { start: Array(256).fill("a").join(" ") },
          variables: { secrets },
          volumes,
        },
      ])
    )
    const text = JSON.stringify({ zekno: 1, services })
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65_536)
    expect(isSettings(checkSettings(text, FILE))).toBe(true)
  })
})

describe("hostile files", () => {
  test("names a prototype has, as services, variables and volumes, stay names", () => {
    const text = `{"zekno": 1, "services": {"constructor": {"source": {"image": "${IMAGE}"}, "variables": {"plain": {"__proto__": "x", "constructor": "y"}}, "volumes": {"constructor": "/a"}}}}`
    const read = checkSettings(text, FILE) as Settings
    expect(read.services).toEqual([
      [
        "constructor",
        {
          image: IMAGE,
          plain: [
            ["__proto__", "x"],
            ["constructor", "y"],
          ],
          volumes: [["constructor", "/a"]],
        },
      ],
    ])
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  test("a duplicate key hidden by an escape, at any depth", () => {
    expect(
      sentence(
        `{"zekno": 1, "services": {"web": {"source": {"image": "${IMAGE}"}, "variables": {"plain": {"A": "1", "\\u0041": "2"}}}}}`
      )
    ).toBe(form("line 1: the same name as line 1."))
    expect(sentence(`{"zekno": 1, "\\u007aekno": 1}`)).toBe(
      form("line 1: the same name as line 1.")
    )
  })

  test("a byte order mark is dropped once; a second one is not JSON", () => {
    expect(isSettings(checkSettings(`\ufeff${DESIGN_FILE}`, FILE))).toBe(true)
    expect(sentence(`\ufeff\ufeff${DESIGN_FILE}`)).toBe(
      form("line 1: this is not JSON.")
    )
  })

  test("numbers that are not the plain form of a value are refused", () => {
    for (const cpus of ["1e0", "0.5e1", "1.234", "-1", "1E2", "0"])
      expect(
        sentence(
          `{"zekno": 1, "services": {"web": {"source": {"image": "${IMAGE}"}, "deploy": {"cpus": ${cpus}}}}}`
        )
      ).toContain("web, deploy.cpus:")
    for (const port of ["3e3", "3000.0", "-80", "0", "65536", "1e999"])
      expect(
        sentence(
          `{"zekno": 1, "services": {"web": {"source": {"image": "${IMAGE}"}, "networking": {"port": ${port}}}}}`
        )
      ).toContain("web, networking.port:")
  })

  test("a value of the wrong type in every place", () => {
    const wrong = [null, true, 5, [], {}, "x"]
    for (const value of wrong) {
      const settings = checkSettings(web({ deploy: { restart: value } }), FILE)
      expect(isSettings(settings)).toBe(false)
    }
    expect(sentence(web({ networking: { port: "3000" } }))).toBe(
      form("web, networking.port: use a port from 1 to 65535.")
    )
    expect(sentence(web({ variables: { secrets: [5] } }))).toBe(
      form(
        'web, variables.secrets: use a list of names, such as ["DATABASE_URL"].'
      )
    )
    expect(sentence(web({ volumes: { data: 5 } }))).toBe(
      form(
        "web, volumes.data: use an absolute path in the container, such as /data. A folder of the server cannot be mounted from settings."
      )
    )
    expect(sentence(json({ zekno: 1, services: [] }))).toBe(
      form('services: name at least one service, such as "web".')
    )
    expect(
      sentence(json({ zekno: 1, services: { web: { source: "x" } } }))
    ).toBe(form("web, source: use an object."))
    // specs/016-build-from-source, CL1: neither an image nor a build is C26, by its id until the words tasks (FR-092).
    expect(
      sentence(json({ zekno: 1, services: { web: { source: {} } } }))
    ).toBe("C26")
  })

  test("a value never comes back into a sentence, even one that looks like a sentence", () => {
    const trick = "use 1. web, deploy.memory: \u001b[2J"
    for (const text of [
      web({ deploy: { memory: trick } }),
      web({ deploy: { start: `${trick} && x` } }),
      web({ volumes: { data: trick } }),
      web({ variables: { plain: { A: `${trick}\n` } } }),
      json({ zekno: 1, services: { [trick]: {} } }),
      json({ zekno: 1, [trick]: 1, services: {} }),
    ])
      expect(sentence(text)).not.toContain("\u001b")
  })

  test("a lone surrogate, a control character or U+2028 in a name is a name that breaks its rule", () => {
    for (const name of ["\ud800", "A\u0000", "A\u2028", "a\u001b[2J"]) {
      const text = `{"zekno": 1, "services": {"web": {"source": {"image": "${IMAGE}"}, "variables": {"plain": {${JSON.stringify(name)}: "x"}}}}}`
      expect(sentence(text)).toBe(
        form(
          "web, variables.plain: a variable name uses letters, digits and underscore, does not start with a digit, and is at most 128 characters (line 1)."
        )
      )
    }
  })

  test("every exception is a fault, never thrown", () => {
    for (const text of ["", "{", "[]", "null", '{"zekno": 1}', "\u0000"])
      expect(() => checkSettings(text, FILE)).not.toThrow()
  })
})

describe("a good file reads the same however it is laid out", () => {
  test("minified, and with CRLF", () => {
    for (const file of GOOD_FILES) {
      const value = checkSettings(file.text, FILE)
      expect(isSettings(value)).toBe(true)
    }
    expect(
      checkSettings(JSON.stringify(JSON.parse(DESIGN_FILE)), FILE)
    ).toEqual(DESIGN_SETTINGS)
  })
})
