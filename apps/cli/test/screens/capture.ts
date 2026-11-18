/**
 * `bun run screens` (specs/013-docs-refresh, contracts/screens.md, "The
 * command"): draws every screen of the docs from the real program with the
 * stand-ins, and writes `apps/web/content/screens/<name>.json` and the
 * README's picture of Home.
 *
 *   bun run screens            draws every screen, writes the files and the SVG
 *   bun run screens --check    writes nothing, names each screen that differs, exits 1 if any does
 *   bun run screens home       one screen (or several, by name)
 *
 * Each recipe runs in a process of its own (draw.ts) with FORCE_COLOR=3,
 * TZ=UTC and a temporary folder that is removed after it. It prints one
 * line per screen.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { readScreen, storedText, textOf, type Screen } from "./format"
import { svgOf } from "./svg"

/** Where the recipes are, and where the screens and the README's picture are written. */
export const PLACES = {
  recipes: join(import.meta.dir, "recipes"),
  screens: join(import.meta.dir, "../../../web/content/screens"),
  svg: join(import.meta.dir, "../../../../.github/assets/screen-home.svg"),
}

/** The screen the README's picture is made from. */
const PICTURED = "home"

/** How many recipes draw at once. */
const AT_ONCE = 3

/** The name of every recipe, in order. */
export const recipeNames = (): string[] =>
  readdirSync(PLACES.recipes)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => file.slice(0, -3))
    .sort()

/** Draws the screen `name` in a process of its own and returns it. */
export async function drawScreen(name: string): Promise<Screen> {
  const folder = mkdtempSync(join(tmpdir(), "zekno-screen-"))
  try {
    const out = join(folder, "screen.json")
    const env: Record<string, string | undefined> = {
      ...process.env,
      FORCE_COLOR: "3",
      TZ: "UTC",
      TMPDIR: folder,
    }
    delete env.NO_COLOR
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "draw.ts"), name, out],
      { env, stdout: "pipe", stderr: "pipe" }
    )
    const timer = setTimeout(() => child.kill(), 180_000)
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    clearTimeout(timer)
    if (code !== 0 || !existsSync(out))
      throw new Error(
        `The recipe ${name} failed (status ${code}):\n${stderr}${stdout}`
      )
    return JSON.parse(readFileSync(out, "utf8")) as Screen
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

/** Where `stored` and `drawn` first differ, in words: a field, or a row with both texts. */
export function firstDifference(stored: Screen, drawn: Screen): string {
  for (const field of [
    "title",
    "command",
    "columns",
    "rows",
    "alt",
    "fixed",
  ] as const)
    if (JSON.stringify(stored[field]) !== JSON.stringify(drawn[field]))
      return `its ${field}`
  const rows = Math.max(stored.lines.length, drawn.lines.length)
  for (let row = 0; row < rows; row++) {
    const was = stored.lines[row]
    const now = drawn.lines[row]
    if (JSON.stringify(was) !== JSON.stringify(now)) {
      const text = (line: Screen["lines"][number] | undefined) =>
        line === undefined ? "(no row)" : JSON.stringify(textOf(line))
      const same = was && now && textOf(was) === textOf(now)
      return `row ${row + 1}${same ? " (its looks)" : ""}\n    stored: ${text(was)}\n    drawn:  ${text(now)}`
    }
  }
  return "its bytes"
}

/** Runs `work` on each item, `AT_ONCE` at a time, and keeps the results in order. */
async function inTurn<T, R>(
  items: T[],
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const at = next++
      results[at] = await work(items[at]!)
    }
  }
  await Promise.all(Array.from({ length: AT_ONCE }, worker))
  return results
}

/** The command. Returns the exit status. */
export async function capture(args: string[]): Promise<number> {
  const check = args.includes("--check")
  const asked = args.filter((arg) => !arg.startsWith("--"))
  const known = recipeNames()
  const unknown = asked.filter((name) => !known.includes(name))
  if (unknown.length > 0) {
    console.error(`No recipe for: ${unknown.join(", ")}`)
    return 2
  }
  const names = asked.length > 0 ? asked : known
  let differs = false
  const lines = await inTurn(names, async (name) => {
    const path = join(PLACES.screens, `${name}.json`)
    let screen: Screen
    try {
      screen = await drawScreen(name)
    } catch (error) {
      differs = true
      return `${name}  could not be drawn: ${(error as Error).message}`
    }
    const text = storedText(screen)
    const before = existsSync(path) ? readFileSync(path, "utf8") : undefined
    if (before === text) return `${name}  in step`
    if (check) {
      differs = true
      return before === undefined
        ? `${name}  differs: there is no stored file`
        : `${name}  differs at ${firstDifference(readScreen(before), screen)}`
    }
    mkdirSync(PLACES.screens, { recursive: true })
    writeFileSync(path, text)
    return `${name}  ${before === undefined ? "written" : "rewritten"}`
  })
  for (const line of lines) console.log(line)

  if (asked.length === 0) {
    const stray = existsSync(PLACES.screens)
      ? readdirSync(PLACES.screens)
          .filter((file) => file.endsWith(".json"))
          .map((file) => file.slice(0, -5))
          .filter((name) => !known.includes(name))
      : []
    for (const name of stray) {
      differs = true
      console.log(`${name}  is stored but has no recipe`)
    }
  }

  const pictured = join(PLACES.screens, `${PICTURED}.json`)
  if (existsSync(pictured)) {
    const svg = svgOf(readScreen(readFileSync(pictured, "utf8")))
    const before = existsSync(PLACES.svg)
      ? readFileSync(PLACES.svg, "utf8")
      : undefined
    if (before === svg) console.log("screen-home.svg  in step")
    else if (check) {
      differs = true
      console.log(`screen-home.svg  differs from what ${PICTURED}.json gives`)
    } else {
      mkdirSync(dirname(PLACES.svg), { recursive: true })
      writeFileSync(PLACES.svg, svg)
      console.log(
        `screen-home.svg  ${before === undefined ? "written" : "rewritten"}`
      )
    }
  }
  return differs ? 1 : 0
}

if (import.meta.main) process.exit(await capture(process.argv.slice(2)))
