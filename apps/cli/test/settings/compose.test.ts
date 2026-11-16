/**
 * The Compose text the settings turn into (specs/010-app-settings,
 * contracts/compose-text.md, "Tests"; research R2; tasks T016): the worked
 * example byte for byte, each setting's lines, escaping case by case, and
 * reading a text back (`deployedSettings`). The seeded set and `docker
 * compose config` are in compose-random.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"

import { expectedValues } from "../../src/project/compose-file"
import {
  composeText,
  deployedSettings,
  quote,
} from "../../src/settings/compose"
import type { ServiceSettings, Settings } from "../../src/settings/types"
import { joinStart, splitStart } from "../../src/settings/values"
import {
  DESIGN_COMPOSE,
  DESIGN_COMPOSE_SHA256,
  DESIGN_SETTINGS,
  GOOD_FILES,
} from "../support/settings-files"
import {
  composeReads,
  expectedYaml,
  IMAGE,
  linesOf,
  one,
  type Parsed,
} from "../support/settings-random"

describe("the worked example (contracts/compose-text.md)", () => {
  test("design.md's file turns into the 594 bytes, and their SHA-256", () => {
    const text = composeText(DESIGN_SETTINGS)
    expect(text).toBe(DESIGN_COMPOSE)
    expect(Buffer.byteLength(text)).toBe(594)
    expect(createHash("sha256").update(text).digest("hex")).toBe(
      DESIGN_COMPOSE_SHA256
    )
  })

  test("expectedValues finds the two secrets and nothing else", () => {
    expect(expectedValues(DESIGN_COMPOSE)).toEqual([
      "DATABASE_URL",
      "SESSION_KEY",
    ])
  })

  test("the rules: two spaces, a line feed after every line, no empty line, no tab, no trailing space, no name", () => {
    const text = composeText(DESIGN_SETTINGS)
    expect(text.startsWith("services:\n")).toBe(true)
    expect(text.endsWith("\n")).toBe(true)
    for (const line of text.slice(0, -1).split("\n")) {
      expect(line).not.toBe("")
      expect(line).not.toMatch(/\t| $/)
      expect((/^ */.exec(line)?.[0].length ?? 0) % 2).toBe(0)
    }
    expect(text).not.toMatch(/^name:/m)
  })
})

describe("each setting alone (contracts/compose-text.md, Each setting)", () => {
  test("a service and its image", () => {
    expect(composeText(one({}))).toBe(
      `services:\n  "web":\n    image: "${IMAGE}"\n`
    )
  })
  test("deploy.start", () => {
    expect(linesOf({ start: "bun run start" })).toEqual([
      '    command: ["bun", "run", "start"]',
    ])
  })
  test("deploy.restart", () => {
    expect(linesOf({ restart: "on-failure" })).toEqual([
      '    restart: "on-failure"',
    ])
  })
  test("deploy.memory", () => {
    expect(linesOf({ memory: "512m" })).toEqual(['    mem_limit: "512m"'])
  })
  test("deploy.cpus: the number, never an exponent", () => {
    for (const [cpus, written] of [
      ["1", "1"],
      ["0.5", "0.5"],
      ["2.25", "2.25"],
      ["0.01", "0.01"],
      ["1024", "1024"],
      ["1.50", "1.5"],
      ["1024.00", "1024"],
    ])
      expect(linesOf({ cpus })).toEqual([`    cpus: ${written}`])
  })
  test("networking.port with no publish", () => {
    expect(linesOf({ port: 3000 })).toEqual(['    expose: ["3000"]'])
  })
  test("networking.port and publish", () => {
    expect(linesOf({ port: 3000, publish: 8080 })).toEqual([
      '    ports: ["8080:3000"]',
    ])
  })
  test("variables: secrets, then plain values", () => {
    expect(linesOf({ secrets: ["A", "B"], plain: [["C", "c"]] })).toEqual([
      "    environment:",
      '      "A": "${A}"',
      '      "B": "${B}"',
      '      "C": "c"',
    ])
  })
  test("volumes, and the top-level list once each, in the order first met", () => {
    const settings: Settings = {
      version: 1,
      services: [
        [
          "web",
          {
            image: IMAGE,
            volumes: [
              ["b", "/b"],
              ["a", "/a"],
            ],
          },
        ],
        [
          "worker",
          {
            image: IMAGE,
            volumes: [
              ["a", "/x"],
              ["c", "/c"],
            ],
          },
        ],
      ],
    }
    expect(composeText(settings).split("\n").slice(-5)).toEqual([
      "volumes:",
      '  "b": {}',
      '  "a": {}',
      '  "c": {}',
      "",
    ])
    expect(linesOf({ volumes: [["data", "/data"]] })).toEqual([
      "    volumes:",
      '      - type: "volume"',
      '        source: "data"',
      '        target: "/data"',
      "volumes:",
      '  "data": {}',
    ])
  })
  test("a volume is always a named volume, never a bind mount", () => {
    for (const file of GOOD_FILES) {
      const text = composeText(file.expect.settings)
      expect(text).not.toContain("bind")
      for (const line of text
        .split("\n")
        .filter((line) => line.includes("type:")))
        expect(line).toBe('      - type: "volume"')
    }
  })
})

describe("escaping, case by case (contracts/compose-text.md)", () => {
  const cases: [string, Partial<ServiceSettings>, string, unknown][] = [
    [
      'plain GREETING: say "hi"',
      { plain: [["GREETING", 'say "hi"']] },
      '      "GREETING": "say \\"hi\\""',
      { GREETING: 'say "hi"' },
    ],
    [
      "plain WIN: C:\\temp",
      { plain: [["WIN", "C:\\temp"]] },
      '      "WIN": "C:\\\\temp"',
      { WIN: "C:\\temp" },
    ],
    [
      "plain LITERAL: $HOME and ${X}",
      { plain: [["LITERAL", "$HOME and ${X}"]] },
      '      "LITERAL": "$$HOME and $${X}"',
      { LITERAL: "$HOME and ${X}" },
    ],
    [
      "plain MONEY: $$",
      { plain: [["MONEY", "$$"]] },
      '      "MONEY": "$$$$"',
      { MONEY: "$$" },
    ],
    [
      "plain YAMLISH",
      { plain: [["YAMLISH", "a: b # c [d] {e} &f *g !h"]] },
      '      "YAMLISH": "a: b # c [d] {e} &f *g !h"',
      { YAMLISH: "a: b # c [d] {e} &f *g !h" },
    ],
    [
      "plain ANSWER: no",
      { plain: [["ANSWER", "no"]] },
      '      "ANSWER": "no"',
      { ANSWER: "no" },
    ],
    [
      "plain EMPTY",
      { plain: [["EMPTY", ""]] },
      '      "EMPTY": ""',
      { EMPTY: "" },
    ],
    [
      "secret DATABASE_URL",
      { secrets: ["DATABASE_URL"] },
      '      "DATABASE_URL": "${DATABASE_URL}"',
      { DATABASE_URL: "${DATABASE_URL}" },
    ],
  ]
  for (const [name, service, line, reads] of cases)
    test(name, () => {
      const text = composeText(one(service))
      expect(text.split("\n")).toContain(line)
      const parsed = Bun.YAML.parse(text) as Parsed
      const environment = parsed.services.web!.environment as Record<
        string,
        string
      >
      expect(
        Object.fromEntries(
          Object.entries(environment).map(([key, value]) => [
            key,
            composeReads(value),
          ])
        )
      ).toEqual(reads as Record<string, string>)
    })

  test("start sh -c 'echo $PORT'", () => {
    const text = composeText(one({ start: "sh -c 'echo $PORT'" }))
    expect(text.split("\n")).toContain(
      '    command: ["sh", "-c", "echo $$PORT"]'
    )
    const parsed = Bun.YAML.parse(text) as Parsed
    expect(
      (parsed.services.web!.command as string[]).map(composeReads)
    ).toEqual(["sh", "-c", "echo $PORT"])
  })

  test("a service named true", () => {
    const text = composeText(one({}, "true"))
    expect(text.split("\n")).toContain('  "true":')
    expect(Object.keys((Bun.YAML.parse(text) as Parsed).services)).toEqual([
      "true",
    ])
  })

  test('quote: \\ then " then $, nothing else', () => {
    expect(quote('a\\"$b')).toBe('"a\\\\\\"$$b"')
    expect(quote("")).toBe('""')
    expect(quote("café 東京 🚀 # : - & * ! | > % @ ~")).toBe(
      '"café 東京 🚀 # : - & * ! | > % @ ~"'
    )
  })

  test("each string a setting may hold stays in its place: every awkward value, in every free-form place", () => {
    const awkward = [
      '"',
      "\\",
      "$",
      "${X}",
      "$$",
      "#",
      ":",
      ": ",
      "- ",
      "-",
      "&",
      "*",
      "!",
      "|",
      ">",
      "%",
      "@",
      "'",
      "{",
      "}",
      "[",
      "]",
      ",",
      "?",
      "`",
      " leading",
      "trailing ",
      " ",
      "yes",
      "no",
      "true",
      "null",
      "~",
      "Null",
      "2026-11-16",
      "1e3",
      "0x1F",
      "1_000",
      "0o17",
      ".inf",
      "-.inf",
      ".nan",
      "<<",
      "=",
      "café",
      "東京",
      "🚀",
      "\\n",
      "\\u0000",
      '\\"',
      "a: b # c",
      "*alias",
      "&anchor x",
      "!!python/object",
      "%TAG",
      "---",
      "...",
    ]
    for (const value of awkward) {
      const settings = one({
        start: joinStart([value, `x${value}x`]),
        plain: [
          ["V", value],
          ["W", `${value}${value}`],
        ],
      })
      const text = composeText(settings)
      expect(Bun.YAML.parse(text)).toEqual(expectedYaml(settings))
      expect(expectedValues(text)).toEqual([])
    }
  })
})

describe("deployedSettings (contracts/compose-text.md, Reading it back)", () => {
  test("design.md's text gives design.md's settings", () => {
    expect(deployedSettings(DESIGN_COMPOSE)).toEqual(DESIGN_SETTINGS)
  })

  test("every good file of the test set comes back as its Compose text says", () => {
    for (const file of GOOD_FILES) {
      const text = composeText(file.expect.settings)
      const back = deployedSettings(text)
      expect(back).toBeDefined()
      expect(composeText(back!)).toBe(text)
    }
  })

  test("text zekno did not make from settings gives nothing", () => {
    const cases = [
      "services:\n  web:\n    image: example/web:1\n    environment:\n      - GREETING\n",
      DESIGN_COMPOSE.replace('    restart: "always"', '    restart:  "always"'),
      DESIGN_COMPOSE.replace('    restart: "always"\n', "").replace(
        '    command: ["bun", "run", "worker"]\n',
        '    restart: "always"\n    command: ["bun", "run", "worker"]\n'
      ),
      `name: x\n${DESIGN_COMPOSE}`,
      DESIGN_COMPOSE.replace("cpus: 1", "cpus: 1.0"),
      DESIGN_COMPOSE.replace(
        '"NODE_ENV": "production"',
        '"NODE_ENV": "$production"'
      ),
      DESIGN_COMPOSE.replace('type: "volume"', 'type: "bind"'),
      `${DESIGN_COMPOSE}x-extra: 1\n`,
      "",
      "services: []\n",
      "not: [valid",
      "services:\n  web: 5\n",
    ]
    for (const text of cases) expect(deployedSettings(text)).toBeUndefined()
  })

  test("a text of 262,145 bytes, or with 201 aliases, is not parsed", () => {
    const large =
      DESIGN_COMPOSE + "#".repeat(262_145 - Buffer.byteLength(DESIGN_COMPOSE))
    expect(Buffer.byteLength(large)).toBe(262_145)
    expect(deployedSettings(large)).toBeUndefined()
    const aliases = `x: &a "v"\nservices:\n${Array.from({ length: 201 }, (_, at) => `  s${at}: *a`).join("\n")}\n`
    expect(deployedSettings(aliases)).toBeUndefined()
  })

  test("a start command comes back as its words, joined so they split the same", () => {
    const settings = one({ start: '  node   \'a b\'  "c\\"d"  ' })
    const back = deployedSettings(composeText(settings))!
    expect(back.services[0]![1].start).toBe('node "a b" "c\\"d"')
    expect(splitStart(back.services[0]![1].start!)).toEqual(
      splitStart(settings.services[0]![1].start!)
    )
  })
})
