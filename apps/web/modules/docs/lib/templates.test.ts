/**
 * The docs page's list of templates (specs/012-templates,
 * contracts/contributing.md, TD3 and TD6; research R14): read with the page's
 * own function from the CLI's template files, every file listed with its
 * author, in the catalogue's order (D8), and a file more listed too.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readTemplateRows } from "./templates"

const FILES = join(import.meta.dir, "../../../../cli/src/templates/files")

const FIRST_SET = [
  {
    name: "postgres",
    title: "PostgreSQL",
    about: "A relational database.",
    software: "18.7",
    author: "zekno",
  },
  {
    name: "mysql",
    title: "MySQL",
    about: "A relational database.",
    software: "9.7",
    author: "zekno",
  },
  {
    name: "mongodb",
    title: "MongoDB",
    about: "A document database.",
    software: "9.0",
    author: "zekno",
  },
  {
    name: "redis",
    title: "Redis",
    about: "A cache and key-value store.",
    software: "8.10",
    author: "zekno",
  },
]

/** A folder holding the first set, and the index beside it as the CLI's folder has it. */
function copyOfFiles(): string {
  const folder = mkdtempSync(join(tmpdir(), "zekno-web-templates-"))
  for (const name of ["postgres", "mysql", "mongodb", "redis"])
    writeFileSync(
      join(folder, `${name}.json`),
      readFileSync(join(FILES, `${name}.json`))
    )
  writeFileSync(join(folder, "index.ts"), readFileSync(join(FILES, "index.ts")))
  return folder
}

describe("the templates the docs page lists (TD3, TD6)", () => {
  test("from apps/cli: every template file, each with its author; the first set first, in the catalogue's order", () => {
    const rows = readTemplateRows(FILES)
    const files = readdirSync(FILES)
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -".json".length))
    expect(rows.map((row) => row.name).sort()).toEqual(files.sort())
    expect(rows.slice(0, 4)).toEqual(FIRST_SET)
    for (const row of rows) expect(row.author).toMatch(/^[A-Za-z0-9-]+$/)
  })

  test("by default, from the CLI's folder beside apps/web", () => {
    expect(readTemplateRows()).toEqual(readTemplateRows(FILES))
  })

  test("one more good file is listed too, after the first set, by name; the index and anything not .json are not read", () => {
    const folder = copyOfFiles()
    const extra = JSON.parse(readFileSync(join(FILES, "postgres.json"), "utf8"))
    writeFileSync(
      join(folder, "example-db.json"),
      JSON.stringify({
        ...extra,
        name: "example-db",
        title: "Example DB",
        about: "A database for an example.",
        author: "someone-else",
      })
    )
    writeFileSync(
      join(folder, "a-db.json"),
      JSON.stringify({ ...extra, name: "a-db", author: "ada" })
    )
    writeFileSync(join(folder, "notes.txt"), "not a template")
    expect(readTemplateRows(folder)).toEqual([
      ...FIRST_SET,
      {
        name: "a-db",
        title: "PostgreSQL",
        about: "A relational database.",
        software: "18.7",
        author: "ada",
      },
      {
        name: "example-db",
        title: "Example DB",
        about: "A database for an example.",
        software: "18.7",
        author: "someone-else",
      },
    ])
  })

  test("only the shown fields are kept; a file without one of them, or with one of another form, is refused", () => {
    const folder = copyOfFiles()
    const rows = readTemplateRows(folder)
    expect(Object.keys(rows[0]!)).toEqual([
      "name",
      "title",
      "about",
      "software",
      "author",
    ])
    writeFileSync(
      join(folder, "broken.json"),
      JSON.stringify({ name: "broken", title: "Broken" })
    )
    expect(() => readTemplateRows(folder)).toThrow("broken.json")
    const other = copyOfFiles()
    writeFileSync(
      join(other, "markup.json"),
      JSON.stringify({
        name: "markup",
        title: "<script>",
        about: "A test.",
        software: "1",
        author: "x",
      })
    )
    expect(() => readTemplateRows(other)).toThrow("markup.json")
  })
})
