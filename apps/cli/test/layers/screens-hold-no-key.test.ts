/**
 * The code that draws holds no key (the README's design rule 1): no file of
 * `apps/cli/src/ui/` or of `apps/cli/src/app/screens/` loads the keychain
 * code (`src/profile/`) or the core library (`@workspace/core`), which are
 * the only two places that hold or use a private key. An import that names
 * only types loads nothing and is allowed.
 *
 * Imports are read with Bun's own parser, which leaves out those that name
 * only types. Nothing is run or imported. It reads direct imports: what a
 * screen is handed at run time is the business of the rules in
 * layers.test.ts.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const SRC = resolve(import.meta.dir, "../../src")

/** The folders whose files draw what a person sees. */
const DRAWING = ["ui", "app/screens"]

/** Every .ts and .tsx file under a folder of src, as paths from src. */
function filesUnder(folder: string): string[] {
  return readdirSync(join(SRC, folder), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => relative(SRC, join(entry.parentPath, entry.name)))
    .sort()
}

/** The imports of a file that load code, as the parser reads them. */
function loadsOf(path: string): string[] {
  const loader = path.endsWith(".tsx") ? "tsx" : "ts"
  return new Bun.Transpiler({ loader })
    .scanImports(readFileSync(join(SRC, path), "utf8"))
    .map((found) => found.path)
}

/** Whether an import of a file reaches the keychain code or the core library. */
function reachesAKey(from: string, spec: string): boolean {
  if (spec === "@workspace/core" || spec.startsWith("@workspace/core/")) {
    return true
  }
  if (!spec.startsWith(".")) return false
  const target = relative(SRC, resolve(SRC, dirname(from), spec))
  return target === "profile" || target.startsWith("profile/")
}

describe("the code that draws holds no key", () => {
  const files = DRAWING.flatMap(filesUnder)

  test("there are files to read in each folder that draws", () => {
    for (const folder of DRAWING) {
      expect(filesUnder(folder).length).toBeGreaterThan(0)
    }
  })

  test("no file of src/ui or src/app/screens loads src/profile or @workspace/core", () => {
    const breaches = files.flatMap((path) =>
      loadsOf(path)
        .filter((spec) => reachesAKey(path, spec))
        .map((spec) => `${path} loads ${spec}`)
    )
    expect(breaches).toEqual([])
  })

  test("the check catches a load of either, and lets a type through", () => {
    const scan = (code: string) =>
      new Bun.Transpiler({ loader: "ts" })
        .scanImports(code)
        .map((found) => found.path)
    expect(
      scan('import { sign } from "@workspace/core"\nsign()').some((spec) =>
        reachesAKey("ui/ink/x.ts", spec)
      )
    ).toBe(true)
    expect(
      scan('import { key } from "../../profile/keychain"\nkey()').some((spec) =>
        reachesAKey("app/screens/x.ts", spec)
      )
    ).toBe(true)
    expect(
      scan('import type { Member } from "@workspace/core"').some((spec) =>
        reachesAKey("ui/ink/x.ts", spec)
      )
    ).toBe(false)
    expect(reachesAKey("ui/ink/x.ts", "../parts/box")).toBe(false)
  })
})
