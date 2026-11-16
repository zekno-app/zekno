/**
 * The Compose text of many settings (specs/010-app-settings,
 * contracts/compose-text.md, "Tests"; tasks T016): a seeded set of a
 * thousand settings within the rules whose every value is read back in its
 * place, and, where Docker Compose is installed, `docker compose config`
 * reading the text of every good file. That command reads a file and
 * contacts nothing.
 */
import { describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { expectedValues } from "../../src/project/compose-file"
import {
  composeText,
  deployedSettings,
  quote,
} from "../../src/settings/compose"
import { checkSettings } from "../../src/settings/schema"
import { settingsText } from "../../src/settings/text"
import { splitStart } from "../../src/settings/values"
import { GOOD_FILES } from "../support/settings-files"
import {
  doubled,
  expectedYaml,
  generator,
  randomSettings,
} from "../support/settings-random"

describe("a thousand seeded settings within the rules", () => {
  const random = generator(20_261_116)
  const all = Array.from({ length: 1000 }, () => randomSettings(random))

  test("each is within the rules: the reader reads its file back the same", () => {
    for (const settings of all)
      expect(checkSettings(settingsText(settings), "zekno.app.json")).toEqual(
        settings
      )
  })

  test("the same settings give the same text twice", () => {
    for (const settings of all)
      expect(composeText(settings)).toBe(composeText(settings))
  })

  test("YAML gives every name and value back in its place, and Compose expects the secrets only", () => {
    for (const settings of all) {
      const text = composeText(settings)
      expect(Bun.YAML.parse(text)).toEqual(expectedYaml(settings))
      const secrets = [
        ...new Set(settings.services.flatMap(([, s]) => s.secrets ?? [])),
      ]
      expect(expectedValues(text).sort()).toEqual(secrets.sort())
    }
  })

  test("every string of the settings is in the text inside double quotes, and only there", () => {
    for (const settings of all) {
      const text = composeText(settings)
      for (const [name, s] of settings.services) {
        expect(text).toContain(`  ${quote(name)}:\n`)
        expect(text).toContain(`image: ${quote(s.image)}\n`)
        for (const [variable, value] of s.plain ?? [])
          expect(text).toContain(`      ${quote(variable)}: ${quote(value)}\n`)
      }
      // Outside double quotes a line holds only the keys Compose defines, numbers, and YAML's own marks.
      for (const line of text.split("\n")) {
        const outside = line.replace(/"(?:[^"\\]|\\.)*"/g, "")
        expect(outside).toMatch(
          /^ *(?:- )?(?:[a-z_]*:)? *(?:\[(?:, )*\]|\{\}|[0-9.]+)?$/
        )
      }
    }
  })

  test("deployedSettings reads each back to the same settings", () => {
    for (const settings of all)
      expect(deployedSettings(composeText(settings))).toEqual(settings)
  })
})

/** Whether `docker compose version` works here, as test/scenarios/real-docker.test.ts gates its own runs. */
const compose = (() => {
  try {
    return (
      Bun.spawnSync(["docker", "compose", "version"], {
        stdout: "ignore",
        stderr: "ignore",
      }).exitCode === 0
    )
  } catch {
    return false
  }
})()
if (!compose)
  console.log(
    "Skipping docker compose config: Docker Compose is not installed here."
  )

test.skipIf(!compose)(
  "docker compose config reads the Compose text of every good file, values in their places (it contacts nothing)",
  () => {
    const folder = tempDir("settings-compose")
    const random = generator(7)
    const samples = [
      ...GOOD_FILES.map((file) => file.expect.settings),
      ...Array.from({ length: 10 }, () => randomSettings(random)),
    ]
    for (const [at, settings] of samples.entries()) {
      const path = join(folder, `compose-${at}.yaml`)
      writeFileSync(path, composeText(settings))
      const run = Bun.spawnSync(
        [
          "docker",
          "compose",
          "-p",
          "zekno-test",
          "-f",
          path,
          "config",
          "--format",
          "json",
        ],
        { stdout: "pipe", stderr: "pipe" }
      )
      expect([at, run.exitCode]).toEqual([at, 0])
      const read = JSON.parse(run.stdout.toString()) as {
        services: Record<
          string,
          {
            image: string
            command?: string[]
            environment?: Record<string, string>
            volumes?: { type: string; source: string; target: string }[]
          }
        >
      }
      expect(Object.keys(read.services).sort()).toEqual(
        settings.services.map(([name]) => name).sort()
      )
      for (const [name, s] of settings.services) {
        const service = read.services[name]!
        expect(service.image).toBe(s.image)
        if (s.start !== undefined) {
          const split = splitStart(s.start)
          // Compose prints a literal `$` as its own escape, `$$`.
          expect(service.command).toEqual(
            "words" in split ? split.words.map(doubled) : []
          )
        }
        for (const [variable, value] of s.plain ?? [])
          expect(service.environment?.[variable]).toBe(doubled(value))
        for (const secret of s.secrets ?? [])
          expect(Object.keys(service.environment ?? {})).toContain(secret)
        expect(service.volumes ?? []).toEqual(
          (s.volumes ?? []).map(([source, target]) => ({
            type: "volume",
            source,
            target,
          }))
        )
      }
    }
  },
  60_000
)
