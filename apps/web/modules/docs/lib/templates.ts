import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

/**
 * The templates the docs page lists (specs/012-templates,
 * contracts/contributing.md, TD3; research R14): read from the CLI's own
 * template files, `apps/cli/src/templates/files/*.json`, beside this app in
 * the repository. Only the fields the page shows are read, each held to the
 * rule the CLI's strict reader holds it to (contracts/template-file.md, "The
 * format"); every other field is left alone. The CLI's tests check each file
 * whole; this reader only lists them.
 */

/** One row of the page's table: what the list in `zekno add --list` shows, and the author. */
export type TemplateRow = {
  name: string
  title: string
  about: string
  software: string
  author: string
}

/** The fields the page shows, as the CLI's reader allows them; other fields are dropped, not read. */
const ROW = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  title: z.string().regex(/^[A-Za-z0-9 .+-]{1,40}$/),
  about: z.string().regex(/^[\x20-\x7e]{0,79}\.$/),
  software: z.string().regex(/^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/),
  author: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
})

/** The first set, in the CLI's order; every other template after them, by name (plan.md, D8). */
const FIRST = ["postgres", "mysql", "mongodb", "redis"]

/** The place of a template in the catalogue's order. */
function byOrder(a: TemplateRow, b: TemplateRow): number {
  const first = (name: string) => {
    const at = FIRST.indexOf(name)
    return at === -1 ? FIRST.length : at
  }
  return (
    first(a.name) - first(b.name) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  )
}

/** One template file's row; a file that cannot be listed is named, and nothing of its text is said. */
function rowOf(folder: string, file: string): TemplateRow {
  let fields: unknown
  try {
    fields = JSON.parse(readFileSync(join(folder, file), "utf8"))
  } catch {
    throw new Error(`${file} is not a template file the docs can read.`)
  }
  const read = ROW.safeParse(fields)
  if (!read.success)
    throw new Error(`${file} does not have the fields the docs show.`)
  const { name, title, about, software, author } = read.data
  return { name, title, about, software, author }
}

/**
 * Every template file of `folder`, as rows of the page's table, in the
 * catalogue's order. The folder is the CLI's by default: the docs are built
 * from a checkout of the whole repository.
 */
export function readTemplateRows(
  folder = join(process.cwd(), "../cli/src/templates/files")
): TemplateRow[] {
  return readdirSync(folder)
    .filter((file) => file.endsWith(".json"))
    .map((file) => rowOf(folder, file))
    .sort(byOrder)
}
