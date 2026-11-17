import defaultMdxComponents from "fumadocs-ui/mdx"

import { readTemplateRows, type TemplateRow } from "../lib/templates"

/**
 * The templates, read once when this module loads (specs/012-templates,
 * research R14). A synchronous read at module scope is a predictable value,
 * so the page is prerendered with the table in it
 * (node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md,
 * "Predictable values"). A read that fails is thrown where the table is
 * drawn: it stops the build of the page that shows it, and of no other
 * route that imports the docs, such as the search.
 */
const READ: { rows: TemplateRow[] } | { error: unknown } = (() => {
  try {
    return { rows: readTemplateRows() }
  } catch (error) {
    return { error }
  }
})()

/**
 * The table of templates (contracts/contributing.md, TD3): one row per
 * template, in the order `zekno add --list` shows them, with its name as
 * typed, what it is, the software's version and its author. Every value is
 * React text, never markup.
 */
export function TemplateList() {
  if ("error" in READ) throw READ.error
  const Table = defaultMdxComponents.table
  return (
    <Table>
      <thead>
        <tr>
          <th>Name</th>
          <th>What it is</th>
          <th>Version</th>
          <th>Author</th>
        </tr>
      </thead>
      <tbody>
        {READ.rows.map((row) => (
          <tr key={row.name}>
            <td>
              <code>{row.name}</code>
            </td>
            <td>
              {row.title}: {row.about}
            </td>
            <td>{row.software}</td>
            <td>by {row.author}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
