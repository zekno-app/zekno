/**
 * The template tests of every file of apps/cli/src/templates/files
 * (specs/012-templates, contracts/contributing.md, "The template tests";
 * tasks T009), read from the disk as a contributor's file is: TT1 and TT2
 * per file, named as the board `TemplateFile` names its lines, TC1 and TC2
 * across the folder, and the first set byte for byte as the contract writes
 * it. TT3, with Docker, is test/templates/docker.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { composeText } from "../../src/settings/compose"
import { checkVolumeName } from "../../src/settings/values"
import { planAddition } from "../../src/templates/addition"
import {
  acrossTemplates,
  faultSentence,
  isTemplate,
  readTemplate,
} from "../../src/templates/read"
import type { Addition, Template } from "../../src/templates/types"
import { FIRST_SET } from "../support/template-files"

const FOLDER = join(import.meta.dir, "../../src/templates/files")

/** Every template file of the folder, as its bytes on the disk, in the order of the names. */
const FILES = readdirSync(FOLDER)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((file) => ({
    file,
    name: file.slice(0, -".json".length),
    bytes: readFileSync(join(FOLDER, file)),
  }))

/** A file read; a fault fails the test with the reader's sentence, `<name> <place>: <rule>`. */
function read(file: string, bytes: Uint8Array): Template {
  const got = readTemplate(file, bytes)
  if (!isTemplate(got)) throw new Error(faultSentence(file, got))
  return got
}

/**
 * The template's services as `planAddition` adds them to an app of one
 * service of its own (plan.md, D1): each volume named `<service>-<volume>`.
 */
function asAdded(template: Template): Addition["services"] {
  const taken = template.services.map(([name]) => name)
  const own = ["app", "app-1", "app-2"].find((name) => !taken.includes(name))!
  const plan = planAddition({
    template,
    settings: { version: 1, services: [[own, { image: "nginx:1.27" }]] },
    file: "zekno.app.json",
    readers: [own],
  })
  if (!("services" in plan))
    throw new Error(`not added: ${JSON.stringify(plan)}`)
  return plan.services
}

test("the folder holds the four templates of the first set, at least", () => {
  expect(FILES.map(({ name }) => name)).toEqual(
    expect.arrayContaining(["mongodb", "mysql", "postgres", "redis"])
  )
})

for (const { file, name, bytes } of FILES) {
  describe(name, () => {
    test(`${name} form, settings rules, image pinned, publisher allowed`, () => {
      expect(read(file, bytes).name).toBe(name)
    })

    test(`${name} no published port, data in a volume`, () => {
      const template = read(file, bytes)
      for (const [, service] of template.services)
        expect(service.publish).toBeUndefined()
      const services = asAdded(template)
      const text = composeText({ version: 1, services })
      expect(text).not.toContain("ports:")
      const mounts = services.flatMap(([, service]) => service.volumes ?? [])
      const types = text.split("\n").filter((line) => /- type:/.test(line))
      expect(types).toEqual(mounts.map(() => '      - type: "volume"'))
      for (const [volume] of mounts)
        expect([volume, checkVolumeName(volume)]).toEqual([volume, undefined])
    })
  })
}

test("TC1 and TC2 across the folder: no name or other name is another's", () => {
  const found = acrossTemplates(
    FILES.map(({ file, bytes }) => read(file, bytes))
  )
  if (found !== undefined)
    throw new Error(faultSentence(`${found.name}.json`, found.fault))
})

test("the four of the first set are byte for byte the texts of contracts/template-file.md", () => {
  for (const [name, text] of Object.entries(FIRST_SET)) {
    const onDisk = FILES.find((each) => each.name === name)
    expect([name, onDisk?.bytes.equals(Buffer.from(text))]).toEqual([
      name,
      true,
    ])
  }
})
