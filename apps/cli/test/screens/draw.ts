/**
 * Draws one screen in a process of its own: `bun test/screens/draw.ts <name>
 * <file>` runs the recipe `recipes/<name>.ts` and writes the screen, as
 * JSON, to `<file>`. capture.ts starts it with FORCE_COLOR=3, because how
 * much colour Ink writes is fixed when it is loaded (test/support/colour.ts),
 * and with TZ=UTC and a temporary folder of its own.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { checkScreen, type Screen } from "./format"
import type { Recipe } from "./recipe"

const [name, file] = process.argv.slice(2)
if (!name || !file) {
  console.error("Usage: bun test/screens/draw.ts <name> <file>")
  process.exit(2)
}

const recipe = (
  (await import(join(import.meta.dir, "recipes", `${name}.ts`))) as {
    default: Recipe
  }
).default
const drawn = await recipe.draw()
const screen: Screen = {
  name,
  title: recipe.title,
  command: recipe.command,
  columns: recipe.columns,
  rows: recipe.rows,
  alt: recipe.alt,
  fixed: drawn.fixed,
  lines: drawn.lines,
}
checkScreen(screen)
writeFileSync(file, JSON.stringify(screen))
// The stand-in runners' sessions and timers are not waited for: the screen is drawn.
process.exit(0)
