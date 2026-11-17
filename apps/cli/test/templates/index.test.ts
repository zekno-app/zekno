/**
 * The index of the template files (specs/012-templates,
 * contracts/template-file.md, "The index"; research R1; tasks T010):
 * apps/cli/src/templates/files/index.ts names every template file of its
 * folder on one line, in the order of the names, and nothing else. Read from
 * the disk, and the index both as a module and as text, a difference fails
 * with the first of TI1 to TI5 that applies, naming the file; TI1 prints the
 * line to add. Each sentence is shown on a temporary folder and index built
 * to break it.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { TEMPLATE_TEXTS } from "../../src/templates/catalogue"
import { TEMPLATE_FILES } from "../../src/templates/files/index"

const FOLDER = join(import.meta.dir, "../../src/templates/files")
const WHERE = "apps/cli/src/templates/files"

/** A template file's name: `<name>.json`, `<name>` held to a template's name rule. */
const TEMPLATE_FILE = /^[a-z][a-z0-9-]{0,31}\.json$/

/** The line of the index for the template `name`, as the contract writes it. */
const lineFor = (name: string): string =>
  `  ["${name}", await import("./${name}.json", { with: { type: "text" } })],`

/** The lines of an index text, each name and the path it imports, whatever spaces and line breaks Prettier puts in. */
function linesOf(text: string): { name: string; path: string }[] {
  const line =
    /\[\s*"([^"]*)"\s*,\s*await\s+import\(\s*"\.\/([^"]*)"\s*,\s*\{\s*with:\s*\{\s*type:\s*"text"\s*\}\s*,?\s*\}\s*,?\s*\)\s*,?\s*\]/g
  return [...text.matchAll(line)].map((found) => ({
    name: found[1]!,
    path: found[2]!,
  }))
}

/** The first of TI1 to TI5 that applies to a folder and its index's text, or undefined. */
function indexProblem(folder: string, text: string): string | undefined {
  const files = readdirSync(folder).sort()
  const lines = linesOf(text)
  const named = new Set(lines.map(({ name }) => name))
  for (const file of files.filter((each) => TEMPLATE_FILE.test(each))) {
    const name = file.slice(0, -".json".length)
    if (!named.has(name))
      return `${file} is not in the index. Add this line to ${WHERE}/index.ts, in its place by name:\n${lineFor(name)}`
  }
  for (const { name } of lines)
    if (!files.includes(`${name}.json`))
      return `The index names ${name}.json, which is not in ${WHERE}. Remove its line, or add the file.`
  for (const { name, path } of lines)
    if (path !== `${name}.json`)
      return `The index's line for ${name} takes another file. Write ./${name}.json in it.`
  for (const [at, { name }] of lines.entries()) {
    const before = lines[at - 1]?.name
    if (before !== undefined && before > name)
      return `The index lists its lines in the order of the names: ${name} goes before ${before}.`
  }
  for (const file of files)
    if (file !== "index.ts" && !TEMPLATE_FILE.test(file))
      return `${WHERE} holds ${file}, which is not a template file. A template file is named <name>.json.`
  return undefined
}

/** A temporary folder holding `files` (a template's text does not matter here), and the index text `names` would give. */
function folder(files: string[]): string {
  const made = tempDir("template-index")
  for (const file of files) writeFileSync(join(made, file), "{}\n")
  return made
}
const indexOf = (lines: string[]): string =>
  `export const TEMPLATE_FILES = [\n${lines.join("\n")}\n] as const\n`

describe("the real folder and index", () => {
  const text = readFileSync(join(FOLDER, "index.ts"), "utf8")

  test("pass: every template file has its line, in the order of the names, and nothing else is in the folder", () => {
    const problem = indexProblem(FOLDER, text)
    if (problem !== undefined) throw new Error(problem)
  })

  test("the index as a module names the same files as its text, in the same order, and gives each file's text", () => {
    const names: string[] = TEMPLATE_FILES.map(([name]) => name)
    expect(names).toEqual(linesOf(text).map(({ name }) => name))
    for (const [name, module] of TEMPLATE_FILES) {
      const given: unknown = (module as { default?: unknown }).default
      expect([name, typeof given]).toEqual([name, "string"])
      expect(given).toBe(readFileSync(join(FOLDER, `${name}.json`), "utf8"))
    }
  })

  test("each line is written as the contract writes it", () => {
    for (const { name } of linesOf(text))
      expect(text).toContain(`${lineFor(name)}\n`)
  })

  test("TEMPLATE_TEXTS: each file's bytes as read from the disk, in the order of the names", () => {
    const onDisk = readdirSync(FOLDER)
      .filter((file) => TEMPLATE_FILE.test(file))
      .sort()
      .map((file): readonly [string, string] => [
        file,
        readFileSync(join(FOLDER, file), "utf8"),
      ])
    expect(TEMPLATE_TEXTS).toEqual(onDisk)
  })
})

describe("each sentence, on a folder and an index built to break it", () => {
  test("TI1: a file not in the index, with the line to add", () => {
    expect(
      indexProblem(
        folder(["mysql.json", "postgres.json", "index.ts"]),
        indexOf([lineFor("postgres")])
      )
    ).toBe(
      `mysql.json is not in the index. Add this line to apps/cli/src/templates/files/index.ts, in its place by name:\n  ["mysql", await import("./mysql.json", { with: { type: "text" } })],`
    )
  })

  test("TI2: a line with no file", () => {
    expect(
      indexProblem(
        folder(["postgres.json", "index.ts"]),
        indexOf([lineFor("postgres"), lineFor("redis")])
      )
    ).toBe(
      "The index names redis.json, which is not in apps/cli/src/templates/files. Remove its line, or add the file."
    )
  })

  test("TI3: a line whose name and path differ", () => {
    expect(
      indexProblem(
        folder(["mysql.json", "postgres.json", "index.ts"]),
        indexOf([
          lineFor("mysql"),
          lineFor("postgres").replace("./postgres.json", "./mysql.json"),
        ])
      )
    ).toBe(
      "The index's line for postgres takes another file. Write ./postgres.json in it."
    )
  })

  test("TI4: two lines out of order", () => {
    expect(
      indexProblem(
        folder(["mysql.json", "postgres.json", "index.ts"]),
        indexOf([lineFor("postgres"), lineFor("mysql")])
      )
    ).toBe(
      "The index lists its lines in the order of the names: mysql goes before postgres."
    )
  })

  test("TI5: a notes.txt in the folder, and a file whose name is not a template's", () => {
    expect(
      indexProblem(
        folder(["notes.txt", "postgres.json", "index.ts"]),
        indexOf([lineFor("postgres")])
      )
    ).toBe(
      "apps/cli/src/templates/files holds notes.txt, which is not a template file. A template file is named <name>.json."
    )
    expect(
      indexProblem(
        folder(["Post Gres.json", "postgres.json", "index.ts"]),
        indexOf([lineFor("postgres")])
      )
    ).toBe(
      "apps/cli/src/templates/files holds Post Gres.json, which is not a template file. A template file is named <name>.json."
    )
  })

  test("a line Prettier wrapped is read as one line", () => {
    const wrapped = `  [\n    "a-template-of-a-long-name",\n    await import("./a-template-of-a-long-name.json", {\n      with: { type: "text" },\n    }),\n  ],`
    expect(linesOf(indexOf([wrapped]))).toEqual([
      {
        name: "a-template-of-a-long-name",
        path: "a-template-of-a-long-name.json",
      },
    ])
  })
})
