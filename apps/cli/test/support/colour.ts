/**
 * Looks at a terminal, for tests that check what is bold, dim or in a colour
 * (specs/010-app-settings): a component drawn as a terminal that shows every
 * colour receives it, and each line read back as runs of characters in one
 * look. How much colour Ink writes is fixed when it is loaded, so the
 * component is drawn in a process of its own, as test/app/app-operate.test.tsx
 * draws the app.
 */

/** A run of characters in one look: bold, dim, and a colour (a name such as `yellow`, or `#rrggbb`). */
export type Run = { text: string; bold: boolean; dim: boolean; color?: string }

/**
 * The text a terminal that shows every colour receives for
 * `<name {...props} />` of the module at `file`, drawn `columns` wide.
 * `props` must survive JSON.
 */
export function drawnInColour(
  file: string,
  name: string,
  props: unknown,
  columns = 100
): string {
  const script = [
    'import { createElement } from "react"',
    'import { renderToString } from "ink"',
    `import { ${name} as Drawn } from ${JSON.stringify(file)}`,
    "const props = JSON.parse(process.argv.at(-1))",
    `process.stdout.write(renderToString(createElement(Drawn, props), { columns: ${columns} }))`,
  ].join("\n")
  const run = Bun.spawnSync(
    [process.execPath, "-e", script, JSON.stringify(props)],
    { env: { ...process.env, FORCE_COLOR: "3" } }
  )
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  return run.stdout.toString()
}

const NAMES = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
]

/** One line's characters as runs in one look, the escape sequences read and left out. */
export function runsOf(line: string): Run[] {
  const runs: Run[] = []
  let look: Omit<Run, "text"> = { bold: false, dim: false }
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const codes = /^\x1b\[([0-9;]*)m$/.exec(part)?.[1]
    if (codes === undefined) {
      if (part === "") continue
      const last = runs.at(-1)
      if (
        last &&
        last.bold === look.bold &&
        last.dim === look.dim &&
        last.color === look.color
      )
        last.text += part
      else runs.push({ text: part, ...look })
      continue
    }
    const list = codes === "" ? [0] : codes.split(";").map(Number)
    for (let at = 0; at < list.length; at++) {
      const code = list[at]!
      if (code === 0) look = { bold: false, dim: false }
      else if (code === 1) look = { ...look, bold: true }
      else if (code === 2) look = { ...look, dim: true }
      else if (code === 22) look = { ...look, bold: false, dim: false }
      else if (code >= 30 && code <= 37)
        look = { ...look, color: NAMES[code - 30] }
      else if (code >= 90 && code <= 97)
        look = { ...look, color: `bright ${NAMES[code - 90]}` }
      else if (code === 39) look = { bold: look.bold, dim: look.dim }
      else if (code === 38 && list[at + 1] === 2) {
        const hex = list
          .slice(at + 2, at + 5)
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("")
        look = { ...look, color: `#${hex}` }
        at += 4
      }
    }
  }
  return runs
}

/** The runs of `line` that hold words, each trimmed of the spaces around it; runs of spaces alone are left out. */
export const wordRuns = (line: string): Run[] =>
  runsOf(line)
    .filter((run) => run.text.trim() !== "")
    .map((run) => ({ ...run, text: run.text.trim() }))

/** The text of a coloured line, its escape sequences left out. */
export const plainOf = (text: string): string =>
  text.replace(/\x1b\[[0-9;]*m/g, "")
