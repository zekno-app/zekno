/**
 * Where code lives, and which way its imports point (specs/007-code-in-folders):
 * each package's `src` holds its entry point and folders only (spec FR-001),
 * and the folders of apps/cli/src import each other only in the directions of
 * plan.md, "Which way imports point", rules 1 to 4 (FR-007). Rule 5, nothing
 * cli/cli.ts imports statically loads Ink or React, is the walk of main.ts's
 * static imports in test/asking/asking.test.ts.
 *
 * Imports are read with Bun's own parser (`Bun.Transpiler`, `scanImports`)
 * from every .ts and .tsx file of apps/cli/src. Nothing is run or imported.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"

const ROOT = resolve(import.meta.dir, "../../../..")
const SRC = join(ROOT, "apps/cli/src")

/** The folders of apps/cli/src, as plan.md lays them out. A folder added or renamed is a change to the plan and its rules. */
const LAYOUT = ["app", "asking", "cli", "commands", "ops", "profile", "project", "secrets", "server", "shared", "ui", "version"]

/** One import of a source file, as written. `value`: it loads code. `type`: it names types only, and TypeScript erases it. */
type Import = { spec: string; kind: "value" | "type"; dynamic: boolean }

/** The same text with the `type` of each import and export taken off, so that the parser keeps the imports that name only types. */
const withTypesAsValues = (code: string): string =>
  code
    .replace(/\bimport\s+type\s+/g, "import ")
    .replace(/\bexport\s+type\s+(?=[{*])/g, "export ")
    .replace(/([{,]\s*)type\s+(?=[A-Za-z_$])/g, "$1")

/**
 * The imports of a source text. `scanImports` leaves out what TypeScript
 * erases: `import type`, `export type … from`, and an import whose every name
 * is marked `type`; an import with one value in it stays (the checker's own
 * test below shows it). So what it reports loads code, and what it reports
 * only once the `type` of each import is taken off names types only.
 */
function importsOf(code: string, loader: "ts" | "tsx"): Import[] {
  const parser = new Bun.Transpiler({ loader })
  const values = parser.scanImports(code)
  const loads = new Set(values.map((found) => found.path))
  const types = parser.scanImports(withTypesAsValues(code)).filter((found) => !loads.has(found.path))
  return [
    ...values.map((found): Import => ({ spec: found.path, kind: "value", dynamic: found.kind === "dynamic-import" })),
    ...types.map((found): Import => ({ spec: found.path, kind: "type", dynamic: found.kind === "dynamic-import" })),
  ]
}

/** An import between two files of src: paths relative to src, `/` between folders. */
type Edge = { from: string; to: string; kind: "value" | "type" }

/** A file's path relative to src, `/` between folders, or `../…` outside it. */
const underSrc = (path: string): string => relative(SRC, path).split(sep).join("/")

/** The folder of src a file is in: its first folder, or the file's own name at the root (`main.ts`). */
const folderOf = (path: string): string => path.split("/")[0]!

/** The file a relative import lands on, as Bun resolves it here (the path as written, or with `.ts`, `.tsx` or `.json`), or none. */
function landsOn(from: string, spec: string): string | undefined {
  const base = resolve(dirname(from), spec)
  return ["", ".ts", ".tsx", ".json"].map((ending) => base + ending).find((path) => existsSync(path) && statSync(path).isFile())
}

/** Every .ts and .tsx file of apps/cli/src. */
const SOURCES = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((path) => /\.tsx?$/.test(path))
  .map((path) => join(SRC, path))
  .sort()

/** Each file's text and its imports, read once. A `#!` line is not TypeScript, and is left out. */
const READ = SOURCES.map((file) => {
  const code = readFileSync(file, "utf8").replace(/^#!.*\n/, "")
  return { file: underSrc(file), code, imports: importsOf(code, file.endsWith(".tsx") ? "tsx" : "ts") }
})

/** Every relative import of src, with the file it lands on; and those that land on nothing, which would escape the rules. */
const EDGES: Edge[] = []
const UNRESOLVED: string[] = []
for (const { file, imports } of READ) {
  for (const found of imports) {
    if (!found.spec.startsWith(".")) continue
    const target = landsOn(join(SRC, file), found.spec)
    if (target === undefined) UNRESOLVED.push(`${file}: ${found.spec}`)
    else EDGES.push({ from: file, to: underSrc(target), kind: found.kind })
  }
}

/** The folders of rule 3: what the rest is built on. */
const BASE = ["shared", "server", "project", "profile", "secrets", "version"]

/**
 * Known and allowed, each with its reason:
 *
 * - `main.ts`, the entry point, may import anything: it puts the program
 *   together, and loads the full-screen app (`./app/…`) and the terminal
 *   interface (`./ui/ink/ink`) with `import()`, only once DEV is out of the
 *   environment (rule 5).
 * - `ui/types.ts`, the shapes a Ui draws, may be imported by the folders of
 *   rule 3, as rule 3 itself says: `shared/deploy.ts` names the `Ui` a deploy
 *   is said through, and `version/version.ts` builds the cells of `zekno
 *   version` with `plainCell` and `quiet`.
 */
const allowed = (edge: Edge): boolean => edge.from === "main.ts"

/** plan.md's rules 1 to 4, as written there. Rules 1 to 3 count every import; rule 4 lets types through. */
const RULES: { rule: string; breaks(edge: Edge): boolean }[] = [
  {
    rule: "1. Nothing outside app/ imports from app/.",
    breaks: (edge) => folderOf(edge.from) !== "app" && folderOf(edge.to) === "app",
  },
  {
    rule: "2. ops/ imports nothing from ui/, app/, asking/ or commands/.",
    breaks: (edge) => folderOf(edge.from) === "ops" && ["ui", "app", "asking", "commands"].includes(folderOf(edge.to)),
  },
  {
    rule: "3. shared/, server/, project/, profile/, secrets/ and version/ import nothing from app/, commands/, asking/ or ops/, and from ui/ only ui/types.ts.",
    breaks: (edge) =>
      BASE.includes(folderOf(edge.from)) && (["app", "commands", "asking", "ops"].includes(folderOf(edge.to)) || (folderOf(edge.to) === "ui" && edge.to !== "ui/types.ts")),
  },
  {
    rule: "4. ui/ imports from ops/ only types, and nothing from app/, commands/ or asking/.",
    breaks: (edge) => folderOf(edge.from) === "ui" && ((folderOf(edge.to) === "ops" && edge.kind === "value") || ["app", "commands", "asking"].includes(folderOf(edge.to))),
  },
]

/**
 * Imports that break a rule today, each named with why it is left as it is.
 * None: a breach found later is listed here with its reason, never let
 * through by loosening a rule.
 */
const EXCEPTIONS: readonly { from: string; to: string; why: string }[] = []

const excepted = (edge: Edge): boolean => EXCEPTIONS.some((exception) => exception.from === edge.from && exception.to === edge.to)

/** The imports of `edges` that break `rule`, as `from -> to (kind)`. */
const breachesOf = (rule: (typeof RULES)[number], edges: readonly Edge[]): string[] =>
  edges.filter((edge) => !allowed(edge) && rule.breaks(edge)).map((edge) => `${edge.from} -> ${edge.to} (${edge.kind})`)

describe("the checker itself", () => {
  const MADE_UP = [
    'import type { A } from "./type-only"',
    'import { type B, type C as D } from "./every-name-a-type"',
    'import { type E, f } from "./a-type-and-a-value"',
    'import g from "./default"',
    'import * as h from "./namespace"',
    'import "./for-its-effect"',
    'import { unused } from "./a-value-never-used"',
    'export type { I } from "./export-type"',
    'export { j } from "./export-value"',
    'export * from "./export-everything"',
    "type Local = { type: string }",
    "export type { Local }",
    'const shape = { type: "kept" }',
    'export const k = async () => [f, g, h, shape, await import("./dynamic")]',
  ].join("\n")

  test("scanImports leaves out every import that names only types, and keeps one with a value in it, used or not", () => {
    for (const loader of ["ts", "tsx"] as const) {
      const found = new Bun.Transpiler({ loader }).scanImports(MADE_UP).map((each) => each.path)
      expect(found.sort()).toEqual(
        ["./a-type-and-a-value", "./a-value-never-used", "./default", "./dynamic", "./export-everything", "./export-value", "./for-its-effect", "./namespace"].sort()
      )
    }
  })

  test("importsOf tells an import that names only types from one that loads code", () => {
    for (const loader of ["ts", "tsx"] as const) {
      const kinds = Object.fromEntries(importsOf(MADE_UP, loader).map((each) => [each.spec, each.kind]))
      expect(kinds).toEqual({
        "./type-only": "type",
        "./every-name-a-type": "type",
        "./export-type": "type",
        "./a-type-and-a-value": "value",
        "./default": "value",
        "./namespace": "value",
        "./for-its-effect": "value",
        "./a-value-never-used": "value",
        "./export-value": "value",
        "./export-everything": "value",
        "./dynamic": "value",
      })
    }
  })

  test("each rule catches what it forbids, and lets through what it allows", () => {
    const broken = (from: string, to: string, kind: "value" | "type" = "value") =>
      RULES.filter((rule) => breachesOf(rule, [{ from, to, kind }]).length > 0).map((rule) => rule.rule.slice(0, 2))
    expect(broken("ui/ink/ink.tsx", "app/app.tsx", "type")).toEqual(["1.", "4."])
    expect(broken("ops/deploy.ts", "ui/types.ts", "type")).toEqual(["2."])
    expect(broken("ops/deploy.ts", "commands/deploy.ts")).toEqual(["2."])
    expect(broken("server/session.ts", "ops/deploy.ts", "type")).toEqual(["3."])
    expect(broken("version/version.ts", "ui/plain/plain.ts")).toEqual(["3."])
    expect(broken("shared/deploy.ts", "asking/asking.ts")).toEqual(["3."])
    expect(broken("ui/ink/doctor-report.tsx", "ops/doctor.ts")).toEqual(["4."])
    expect(broken("ui/ink/doctor-report.tsx", "asking/asking.ts", "type")).toEqual(["4."])
    expect(broken("ui/ink/doctor-report.tsx", "ops/doctor.ts", "type")).toEqual([])
    expect(broken("version/version.ts", "ui/types.ts")).toEqual([])
    expect(broken("shared/deploy.ts", "ui/types.ts", "type")).toEqual([])
    expect(broken("main.ts", "app/app.tsx")).toEqual([])
    expect(broken("app/app.tsx", "ops/deploy.ts")).toEqual([])
    expect(broken("commands/deploy.ts", "asking/asking.ts")).toEqual([])
  })
})

describe("which way imports point in apps/cli/src (plan.md, rules 1 to 4)", () => {
  test("every file was read, in the folders of plan.md, and every relative import lands on a file", () => {
    expect(READ.length).toBeGreaterThan(100)
    expect(EDGES.length).toBeGreaterThan(300)
    const folders = [...new Set(READ.map(({ file }) => folderOf(file)))].filter((folder) => folder !== "main.ts").sort()
    expect(folders).toEqual(LAYOUT)
    expect(UNRESOLVED).toEqual([])
  })

  test("every import is relative or names a package: none reaches a file by a path of its own", () => {
    const elsewhere = READ.flatMap(({ file, imports }) => imports.filter((found) => found.spec.startsWith("/") || found.spec.startsWith("src/")).map((found) => `${file}: ${found.spec}`))
    expect(elsewhere).toEqual([])
  })

  test("no import hides in a type: each `import(\"…\")` in a file is one the parser reads as a dynamic import", () => {
    // `typeof import("../app/…")` names a folder without an import the parser keeps; none is allowed, so none escapes the rules.
    const hidden = READ.filter(({ code, imports }) => (code.match(/\bimport\(\s*["'`]/g) ?? []).length !== imports.filter((found) => found.dynamic).length).map(({ file }) => file)
    expect(hidden).toEqual([])
  })

  for (const rule of RULES) {
    test(rule.rule, () => {
      expect(breachesOf(rule, EDGES.filter((edge) => !excepted(edge)))).toEqual([])
    })
  }

  test("each exception is still a breach of a rule, so none outlives the reason it was named for", () => {
    const stale = EXCEPTIONS.filter((exception) => !EDGES.some((edge) => edge.from === exception.from && edge.to === exception.to && RULES.some((rule) => breachesOf(rule, [edge]).length > 0)))
    expect(stale).toEqual([])
  })
})

describe("each package's src holds its entry point and folders only (FR-001)", () => {
  const PACKAGES = [
    ["apps/cli", "main.ts"],
    ["apps/runner", "main.ts"],
    ["packages/core", "index.ts"],
  ] as const

  for (const [where, entry] of PACKAGES) {
    test(`${where}/src: ${entry}, and folders`, () => {
      const root = join(ROOT, where, "src")
      // Finder's own file, which git ignores, is not code.
      const names = readdirSync(root).filter((name) => name !== ".DS_Store")
      const files = names.filter((name) => !statSync(join(root, name)).isDirectory())
      expect(files).toEqual([entry])
      expect(names.length).toBeGreaterThan(1)
    })
  }
})
