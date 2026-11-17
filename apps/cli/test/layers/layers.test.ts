/**
 * Where code lives, and which way its imports point (specs/007-code-in-folders):
 * each package's `src` holds its entry point and folders only (spec FR-001),
 * and the folders of apps/cli/src import each other only in the directions of
 * plan.md, "Which way imports point", rules 1 to 4 and 6 (FR-007), with the
 * folder settings/ placed among them by specs/010-app-settings/plan.md,
 * "Which way imports point", and the folder templates/ by
 * specs/012-templates/plan.md, "Which way imports point". Rule 5,
 * nothing cli/cli.ts imports statically loads Ink or React, is the walk of
 * main.ts's static imports in test/asking/asking.test.ts.
 *
 * Imports are read with Bun's own parser (`Bun.Transpiler`, `scanImports`)
 * from every .ts and .tsx file of apps/cli/src. Nothing is run or imported.
 * What would let a breach pass unseen is refused too (review R1): a file of
 * src the parser does not read (a .js file could import anything), an
 * `import(…)` or `require(…)` of a path that is not written out, and an
 * import that is neither relative nor a built-in or a package the CLI names.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, relative, resolve, sep } from "node:path"

const ROOT = resolve(import.meta.dir, "../../../..")
const SRC = join(ROOT, "apps/cli/src")

/** The packages src may import, by name: those apps/cli/package.json names in `dependencies`. */
const DEPENDENCIES = Object.keys(
  (
    JSON.parse(readFileSync(join(ROOT, "apps/cli/package.json"), "utf8")) as {
      dependencies?: Record<string, string>
    }
  ).dependencies ?? {}
)

/**
 * Files of data, not code, that src holds or imports, relative to src, each
 * with what imports it. Any other must be .ts or .tsx. Beside the list, one
 * rule (`TEMPLATE_FILE`): every `templates/files/<name>.json` whose `<name>`
 * is a template's name, imported as text by templates/files/index.ts
 * (specs/012-templates, research R1), so a new template needs no line here.
 */
const DATA_FILES = [
  // The runner release this zekno carries, imported by version/runner-release.ts.
  "version/runner-release.json",
  // apps/cli/package.json, whose version version/version.ts builds into zekno.
  "../package.json",
]

/** A template file: `templates/files/<name>.json`, `<name>` held to a template's name rule. */
const TEMPLATE_FILE = /^templates\/files\/[a-z][a-z0-9-]{0,31}\.json$/

/** Whether a path, relative to src, is a data file: one `DATA_FILES` names, or a template file. */
const isDataFile = (path: string): boolean =>
  DATA_FILES.includes(path) || TEMPLATE_FILE.test(path)

/** The folders of apps/cli/src, as plan.md lays them out. A folder added or renamed is a change to the plan and its rules. */
const LAYOUT = [
  "app",
  "asking",
  "cli",
  "commands",
  "ops",
  "profile",
  "project",
  "secrets",
  "server",
  "settings",
  "shared",
  "templates",
  "ui",
  "version",
]

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
  const types = parser
    .scanImports(withTypesAsValues(code))
    .filter((found) => !loads.has(found.path))
  return [
    ...values.map((found): Import => ({
      spec: found.path,
      kind: "value",
      dynamic: found.kind === "dynamic-import",
    })),
    ...types.map((found): Import => ({
      spec: found.path,
      kind: "type",
      dynamic: found.kind === "dynamic-import",
    })),
  ]
}

/** An import between two files of src: paths relative to src, `/` between folders. */
type Edge = { from: string; to: string; kind: "value" | "type" }

/** A file's path relative to src, `/` between folders, or `../…` outside it. */
const underSrc = (path: string): string =>
  relative(SRC, path).split(sep).join("/")

/** The folder of src a file is in: its first folder, or the file's own name at the root (`main.ts`). */
const folderOf = (path: string): string => path.split("/")[0]!

/** The file a relative import lands on, as Bun resolves it here (the path as written, or with `.ts`, `.tsx` or `.json`), or none. */
function landsOn(from: string, spec: string): string | undefined {
  const base = resolve(dirname(from), spec)
  return ["", ".ts", ".tsx", ".json"]
    .map((ending) => base + ending)
    .find((path) => existsSync(path) && statSync(path).isFile())
}

/** Every file of apps/cli/src, relative to src. Finder's own file, which git ignores, is not code. */
const FILES = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter(
    (path) =>
      statSync(join(SRC, path)).isFile() && basename(path) !== ".DS_Store"
  )
  .map((path) => path.split(sep).join("/"))
  .sort()

/** Every .ts and .tsx file of apps/cli/src. */
const SOURCES = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((path) => /\.tsx?$/.test(path))
  .map((path) => join(SRC, path))
  .sort()

/** Of `paths` (relative to src), those the parser does not read: neither .ts nor .tsx, nor a data file (`isDataFile`). */
const notSource = (paths: readonly string[]): string[] =>
  paths.filter((path) => !/\.tsx?$/.test(path) && !isDataFile(path))

/**
 * The `import(…)` and `require(…)` of a source text whose argument is not a
 * plain string: where they lead cannot be read, so no rule could check it.
 * They are looked for in the text Bun's transpiler gives back, without
 * comments and types, so a word in a comment is not one; one in a string
 * would be, and fails the test rather than passing unseen.
 */
function hiddenLoadsOf(code: string, loader: "ts" | "tsx"): string[] {
  const text = new Bun.Transpiler({ loader }).transformSync(code)
  return [...text.matchAll(/\b(?:import|require)\s*\(/g)]
    .filter(
      (found) =>
        !/^\s*(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')\s*[,)]/.test(
          text.slice(found.index + found[0].length)
        )
    )
    .map((found) => text.slice(found.index).split("\n")[0]!.slice(0, 80))
}

/**
 * Other ways to load code that no rule could follow (review R6): `require`
 * used as a value (`const r = require`), `createRequire`,
 * `import.meta.require`, a `Worker`, `eval` and `new Function`. None is used
 * in src, and none is allowed: each is looked for in the transpiled text, as
 * `hiddenLoadsOf` does.
 */
const OTHER_LOADERS: readonly RegExp[] = [
  /\brequire\b(?!\s*\()/g,
  /\bcreateRequire\b/g,
  /\bimport\.meta\.require\b/g,
  /\bnew\s+Worker\b/g,
  /\beval\s*\(/g,
  /\bnew\s+Function\b/g,
]
function otherLoadersOf(code: string, loader: "ts" | "tsx"): string[] {
  const text = new Bun.Transpiler({ loader }).transformSync(code)
  return OTHER_LOADERS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((found) =>
      text.slice(found.index).split("\n")[0]!.slice(0, 80)
    )
  )
}

/** The package a specifier names, without a subpath: `react/jsx-runtime` is `react`, `@workspace/core/x` is `@workspace/core`. */
const packageOf = (spec: string): string =>
  spec
    .split("/")
    .slice(0, spec.startsWith("@") ? 2 : 1)
    .join("/")

/** Of a file's imports, those that are neither relative, nor a `node:` or `bun` built-in, nor a package of `dependencies`, as `file: spec`. */
const foreignOf = (
  file: string,
  imports: readonly Import[],
  dependencies: readonly string[]
): string[] =>
  imports
    .filter(
      ({ spec }) =>
        !spec.startsWith(".") &&
        !spec.startsWith("node:") &&
        spec !== "bun" &&
        !spec.startsWith("bun:") &&
        !dependencies.includes(packageOf(spec))
    )
    .map(({ spec }) => `${file}: ${spec}`)

/**
 * What a source text passes on from other modules, by specifier: each
 * `export … from "…"` (a list, `*` or `* as name`, `type` or not), and each
 * name of an `export { … }` without `from` that one of its imports brought in.
 */
function reExportsOf(code: string): string[] {
  const passed = [
    ...code.matchAll(
      /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/g
    ),
  ].map((found) => found[1]!)
  // The names each import brings in, as this file calls them.
  const brought = new Map<string, string>()
  for (const [, clause, spec] of code.matchAll(
    /\bimport\s+([^"';]*?)\s*from\s*["']([^"']+)["']/g
  )) {
    for (const part of clause!.replace(/^type\s+/, "").split(/[{},]/)) {
      const name = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop()!
      if (name !== "" && name !== "*") brought.set(name, spec!)
    }
  }
  for (const [, list] of code.matchAll(
    /\bexport\s+(?:type\s+)?\{([^}]*)\}(?!\s*from)/g
  )) {
    for (const part of list!.split(",")) {
      const spec = brought.get(
        part
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0]!
      )
      if (spec !== undefined) passed.push(spec)
    }
  }
  return passed
}

/** Each file's text and its imports, read once. A `#!` line is not TypeScript, and is left out. */
const READ = SOURCES.map((file) => {
  const code = readFileSync(file, "utf8").replace(/^#!.*\n/, "")
  return {
    file: underSrc(file),
    code,
    imports: importsOf(code, file.endsWith(".tsx") ? "tsx" : "ts"),
  }
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
const BASE = [
  "shared",
  "server",
  "project",
  "profile",
  "secrets",
  "settings",
  "templates",
  "version",
]

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

/**
 * The files of cli/ (plan.md, rule 6): cli.ts, arguments and dispatch, which
 * reaches every command; and context.ts and errors.ts, which every folder may
 * import. A file added to cli/ is held to the rule of the second kind, and
 * changes this list.
 */
const CLI_FILES = ["cli/cli.ts", "cli/context.ts", "cli/errors.ts"]

/** A file of cli/ that every folder may import: any but cli/cli.ts. */
const isSharedCli = (file: string): boolean =>
  folderOf(file) === "cli" && file !== "cli/cli.ts"

/** plan.md's rules 1 to 4 and 6, as written there. Rules 1 to 3 and 6 count every import; rule 4 lets types through. */
const RULES: { rule: string; breaks(edge: Edge): boolean }[] = [
  {
    rule: "1. Nothing outside app/ imports from app/.",
    breaks: (edge) =>
      folderOf(edge.from) !== "app" && folderOf(edge.to) === "app",
  },
  {
    rule: "2. ops/ imports nothing from ui/, app/, asking/ or commands/.",
    breaks: (edge) =>
      folderOf(edge.from) === "ops" &&
      ["ui", "app", "asking", "commands"].includes(folderOf(edge.to)),
  },
  {
    rule: "3. shared/, server/, project/, profile/, secrets/, settings/, templates/ and version/ import nothing from app/, commands/, asking/ or ops/, and from ui/ only ui/types.ts.",
    breaks: (edge) =>
      BASE.includes(folderOf(edge.from)) &&
      (["app", "commands", "asking", "ops"].includes(folderOf(edge.to)) ||
        (folderOf(edge.to) === "ui" && edge.to !== "ui/types.ts")),
  },
  {
    rule: "4. ui/ imports from ops/ only types, and nothing from app/, commands/ or asking/.",
    breaks: (edge) =>
      folderOf(edge.from) === "ui" &&
      ((folderOf(edge.to) === "ops" && edge.kind === "value") ||
        ["app", "commands", "asking"].includes(folderOf(edge.to))),
  },
  {
    rule: "6. cli/cli.ts is imported by main.ts only.",
    breaks: (edge) => edge.to === "cli/cli.ts",
  },
  {
    rule: "6. cli/context.ts and cli/errors.ts import nothing from ops/, commands/, asking/ or app/, and from ui/ only ui/types.ts.",
    breaks: (edge) =>
      isSharedCli(edge.from) &&
      (["ops", "commands", "asking", "app"].includes(folderOf(edge.to)) ||
        (folderOf(edge.to) === "ui" && edge.to !== "ui/types.ts")),
  },
]

/** What a file of cli/ other than cli/cli.ts re-exports from another folder of src (rule 6), as `file: spec`. */
const passesOn = (file: string, code: string): string[] =>
  isSharedCli(file)
    ? reExportsOf(code)
        .filter(
          (spec) =>
            spec.startsWith(".") &&
            folderOf(underSrc(resolve(dirname(join(SRC, file)), spec))) !==
              "cli"
        )
        .map((spec) => `${file}: ${spec}`)
    : []

/**
 * Imports that land where no rule follows them, as `from -> to`: on a file
 * that is not .ts or .tsx (a .js file beside the code would carry its imports
 * past every rule), or on a file outside src, whose imports are not read; a
 * data file (`isDataFile`) excepted.
 */
const strayTargets = (edges: readonly Edge[]): string[] =>
  edges
    .filter(
      (edge) =>
        !isDataFile(edge.to) &&
        (edge.to.startsWith("../") || !/\.tsx?$/.test(edge.to))
    )
    .map((edge) => `${edge.from} -> ${edge.to}`)

/**
 * Imports that break a rule today, each named with why it is left as it is.
 * None: a breach found later is listed here with its reason, never let
 * through by loosening a rule.
 */
const EXCEPTIONS: readonly { from: string; to: string; why: string }[] = []

const excepted = (edge: Edge): boolean =>
  EXCEPTIONS.some(
    (exception) => exception.from === edge.from && exception.to === edge.to
  )

/** The imports of `edges` that break `rule`, as `from -> to (kind)`. */
const breachesOf = (
  rule: (typeof RULES)[number],
  edges: readonly Edge[]
): string[] =>
  edges
    .filter((edge) => !allowed(edge) && rule.breaks(edge))
    .map((edge) => `${edge.from} -> ${edge.to} (${edge.kind})`)

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
      const found = new Bun.Transpiler({ loader })
        .scanImports(MADE_UP)
        .map((each) => each.path)
      expect(found.sort()).toEqual(
        [
          "./a-type-and-a-value",
          "./a-value-never-used",
          "./default",
          "./dynamic",
          "./export-everything",
          "./export-value",
          "./for-its-effect",
          "./namespace",
        ].sort()
      )
    }
  })

  test("importsOf tells an import that names only types from one that loads code", () => {
    for (const loader of ["ts", "tsx"] as const) {
      const kinds = Object.fromEntries(
        importsOf(MADE_UP, loader).map((each) => [each.spec, each.kind])
      )
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
    const broken = (
      from: string,
      to: string,
      kind: "value" | "type" = "value"
    ) =>
      RULES.filter(
        (rule) => breachesOf(rule, [{ from, to, kind }]).length > 0
      ).map((rule) => rule.rule.slice(0, 2))
    expect(broken("ui/ink/ink.tsx", "app/app.tsx", "type")).toEqual([
      "1.",
      "4.",
    ])
    expect(broken("ops/deploy.ts", "ui/types.ts", "type")).toEqual(["2."])
    expect(broken("ops/deploy.ts", "commands/deploy.ts")).toEqual(["2."])
    expect(broken("server/session.ts", "ops/deploy.ts", "type")).toEqual(["3."])
    expect(broken("version/version.ts", "ui/plain/plain.ts")).toEqual(["3."])
    expect(broken("shared/deploy.ts", "asking/asking.ts")).toEqual(["3."])
    expect(broken("settings/compose.ts", "ops/settings.ts")).toEqual(["3."])
    expect(broken("settings/source.ts", "project/compose-read.ts")).toEqual([])
    expect(broken("templates/addition.ts", "ops/add.ts")).toEqual(["3."])
    expect(broken("templates/read.ts", "settings/schema.ts")).toEqual([])
    expect(broken("ui/ink/doctor-report.tsx", "ops/doctor.ts")).toEqual(["4."])
    expect(
      broken("ui/ink/doctor-report.tsx", "asking/asking.ts", "type")
    ).toEqual(["4."])
    expect(broken("ui/ink/doctor-report.tsx", "ops/doctor.ts", "type")).toEqual(
      []
    )
    expect(broken("version/version.ts", "ui/types.ts")).toEqual([])
    expect(broken("shared/deploy.ts", "ui/types.ts", "type")).toEqual([])
    expect(broken("main.ts", "app/app.tsx")).toEqual([])
    expect(broken("app/app.tsx", "ops/deploy.ts")).toEqual([])
    expect(broken("commands/deploy.ts", "asking/asking.ts")).toEqual([])
    expect(broken("cli/errors.ts", "ui/plain/plain.ts", "type")).toEqual(["6."])
    expect(broken("cli/context.ts", "app/app.tsx", "type")).toEqual([
      "1.",
      "6.",
    ])
    expect(broken("cli/context.ts", "ui/types.ts", "type")).toEqual([])
    expect(broken("cli/context.ts", "profile/profile.ts")).toEqual([])
    expect(broken("cli/cli.ts", "commands/deploy.ts")).toEqual([])
    expect(broken("main.ts", "cli/cli.ts")).toEqual([])
  })

  test("the five breaches review R1 found the test let through are each caught", () => {
    const broken = (from: string, to: string) =>
      RULES.filter(
        (rule) => breachesOf(rule, [{ from, to, kind: "value" }]).length > 0
      ).map((rule) => rule.rule)
    // 1. server/batch.ts imports `run` from ../cli/cli, which reaches commands/, asking/ and ops/.
    expect(broken("server/batch.ts", "cli/cli.ts")).toEqual([
      "6. cli/cli.ts is imported by main.ts only.",
    ])
    expect(broken("cli/context.ts", "cli/cli.ts")).toEqual([
      "6. cli/cli.ts is imported by main.ts only.",
    ])
    // 2. cli/context.ts re-exports `prepareDeploy` from ../ops/deploy, for ui/parts/panel.tsx to import from ../../cli/context.
    expect(broken("cli/context.ts", "ops/deploy.ts")).toEqual([
      "6. cli/context.ts and cli/errors.ts import nothing from ops/, commands/, asking/ or app/, and from ui/ only ui/types.ts.",
    ])
    expect(
      passesOn(
        "cli/context.ts",
        'export { prepareDeploy } from "../ops/deploy"'
      )
    ).toEqual(["cli/context.ts: ../ops/deploy"])
    expect(
      passesOn(
        "cli/errors.ts",
        'export type * from "../ui/types"\nexport * as ops from "../ops/deploy"'
      )
    ).toEqual(["cli/errors.ts: ../ui/types", "cli/errors.ts: ../ops/deploy"])
    expect(
      passesOn(
        "cli/context.ts",
        'import { profileStore, type Profile as P } from "../profile/profile"\nexport { profileStore, type P }'
      )
    ).toEqual([
      "cli/context.ts: ../profile/profile",
      "cli/context.ts: ../profile/profile",
    ])
    expect(
      passesOn(
        "cli/context.ts",
        'export { CliError } from "./errors"\nexport { z } from "zod"\nexport const a = 1\nexport { a as b }'
      )
    ).toEqual([])
    expect(
      passesOn("cli/cli.ts", 'export { prepareDeploy } from "../ops/deploy"')
    ).toEqual([])
    expect(broken("ui/parts/panel.tsx", "cli/context.ts")).toEqual([])
    // 3 and 4. ui/parts/panel.tsx loads app/ with `import(where)` and `require(there)`, a variable each.
    const loads =
      'const where = "../../app/state/state"\nexport const a = async () => import(where)\nexport const b = () => require(there)'
    expect(hiddenLoadsOf(loads, "tsx")).toEqual([
      "import(where);",
      "require(there);",
    ])
    expect(
      hiddenLoadsOf(
        "export const c = () => import(`../../app/state/${name}`)",
        "ts"
      )
    ).toHaveLength(1)
    expect(
      hiddenLoadsOf(
        "// import(where)\n/* require(there) */\nexport const d = async () => [await import(\"../../app/state/state\"), require('./x')]",
        "ts"
      )
    ).toEqual([])
    // 5. ui/parts/panel.tsx imports ./bridge.js, a .js file that re-exports from app/.
    expect(
      notSource([
        "ui/parts/panel.tsx",
        "ui/parts/bridge.js",
        "ui/a.jsx",
        "ui/b.mjs",
        "ui/c.cjs",
        "ui/d.json",
        "version/runner-release.json",
        "shared/e.d.ts",
      ])
    ).toEqual([
      "ui/parts/bridge.js",
      "ui/a.jsx",
      "ui/b.mjs",
      "ui/c.cjs",
      "ui/d.json",
    ])
    // A template file is data; a file of another name in that folder is not, and the index is code like any .ts file.
    expect(
      notSource([
        "templates/files/postgres.json",
        "templates/files/Bad Name.json",
        "templates/notes.md",
        "templates/files/index.ts",
      ])
    ).toEqual(["templates/files/Bad Name.json", "templates/notes.md"])
    expect(
      strayTargets([
        { from: "ui/parts/panel.tsx", to: "ui/parts/bridge.js", kind: "value" },
      ])
    ).toEqual(["ui/parts/panel.tsx -> ui/parts/bridge.js"])
    expect(
      strayTargets([
        {
          from: "ui/parts/panel.tsx",
          to: "../test/support/bridge.ts",
          kind: "value",
        },
      ])
    ).toEqual(["ui/parts/panel.tsx -> ../test/support/bridge.ts"])
    expect(
      strayTargets([
        {
          from: "version/runner-release.ts",
          to: "version/runner-release.json",
          kind: "value",
        },
      ])
    ).toEqual([])
    expect(
      strayTargets([
        { from: "version/version.ts", to: "../package.json", kind: "value" },
      ])
    ).toEqual([])
  })

  test("the ways review R6 found to load code unseen are each caught, and a plain import or require is not", () => {
    const caught = (code: string) => otherLoadersOf(code, "ts").length > 0
    expect(
      caught('const r = require\nexport const x = r("../app/state/steps")')
    ).toBe(true)
    expect(
      caught(
        'import { createRequire } from "node:module"\nexport const x = createRequire(import.meta.url)("../app/state/steps")'
      )
    ).toBe(true)
    expect(
      caught('export const x = import.meta.require("../app/state/steps")')
    ).toBe(true)
    expect(caught('export const w = new Worker("../app/state/steps.ts")')).toBe(
      true
    )
    expect(caught('export const x = eval("1")')).toBe(true)
    expect(caught('export const f = new Function("return 1")')).toBe(true)
    expect(
      caught(
        'import { a } from "./a"\nexport const x = [a, require("./b"), await import("./c")]'
      )
    ).toBe(false)
    // A word in a comment or a type is not a use.
    expect(
      caught(
        "// require is not used here\nexport type Worker = { eval: string }\nexport const x = 1"
      )
    ).toBe(false)
  })

  test("an import that is neither relative, a built-in nor a package of package.json is caught", () => {
    const found = (spec: string): Import => ({
      spec,
      kind: "value",
      dynamic: false,
    })
    const specs = [
      "./x",
      "../y",
      "node:fs",
      "bun",
      "bun:test",
      "ink",
      "react",
      "react/jsx-dev-runtime",
      "zod",
      "@workspace/core",
      "#app/state",
      "src/app/state/state",
      "fs",
      "ai",
      "@workspace/coreish",
      "@workspace",
    ]
    expect(
      foreignOf("ui/parts/panel.tsx", specs.map(found), [
        "@workspace/core",
        "ink",
        "react",
        "zod",
      ])
    ).toEqual(
      [
        "#app/state",
        "src/app/state/state",
        "fs",
        "ai",
        "@workspace/coreish",
        "@workspace",
      ].map((spec) => `ui/parts/panel.tsx: ${spec}`)
    )
  })
})

describe("which way imports point in apps/cli/src (plan.md, rules 1 to 4 and 6)", () => {
  test("every file was read, in the folders of plan.md, and every relative import lands on a file", () => {
    expect(READ.length).toBeGreaterThan(100)
    expect(EDGES.length).toBeGreaterThan(300)
    const folders = [...new Set(READ.map(({ file }) => folderOf(file)))]
      .filter((folder) => folder !== "main.ts")
      .sort()
    expect(folders).toEqual(LAYOUT)
    expect(UNRESOLVED).toEqual([])
  })

  test("every import is relative or names a package: none reaches a file by a path of its own", () => {
    const elsewhere = READ.flatMap(({ file, imports }) =>
      imports
        .filter(
          (found) => found.spec.startsWith("/") || found.spec.startsWith("src/")
        )
        .map((found) => `${file}: ${found.spec}`)
    )
    expect(elsewhere).toEqual([])
  })

  test('no import hides in a type: each `import("…")` in a file is one the parser reads as a dynamic import', () => {
    // `typeof import("../app/…")` names a folder without an import the parser keeps; none is allowed, so none escapes the rules.
    const hidden = READ.filter(
      ({ code, imports }) =>
        (code.match(/\bimport\(\s*["'`]/g) ?? []).length !==
        imports.filter((found) => found.dynamic).length
    ).map(({ file }) => file)
    expect(hidden).toEqual([])
  })

  test("every file of src is .ts or .tsx, or a data file named here, and every import lands on a .ts or .tsx file of src or on a data file named here", () => {
    expect(FILES.filter((path) => /\.tsx?$/.test(path))).toEqual(
      READ.map(({ file }) => file)
    )
    expect(notSource(FILES)).toEqual([])
    expect(DATA_FILES.filter((path) => !existsSync(join(SRC, path)))).toEqual(
      []
    )
    expect(strayTargets(EDGES)).toEqual([])
  })

  test("every `import(…)` and `require(…)` names its file as a plain string, so the parser reads where it leads", () => {
    expect(
      READ.flatMap(({ file, code }) =>
        hiddenLoadsOf(code, file.endsWith(".tsx") ? "tsx" : "ts").map(
          (found) => `${file}: ${found}`
        )
      )
    ).toEqual([])
  })

  test("no file loads code another way: require as a value, createRequire, import.meta.require, a Worker, eval or new Function (review R6)", () => {
    expect(
      READ.flatMap(({ file, code }) =>
        otherLoadersOf(code, file.endsWith(".tsx") ? "tsx" : "ts").map(
          (found) => `${file}: ${found}`
        )
      )
    ).toEqual([])
  })

  test("every import that is not relative is a node: or bun built-in, or a package apps/cli/package.json names in dependencies", () => {
    expect(DEPENDENCIES.length).toBeGreaterThan(0)
    expect(
      READ.flatMap(({ file, imports }) =>
        foreignOf(file, imports, DEPENDENCIES)
      )
    ).toEqual([])
  })

  for (const rule of RULES) {
    test(rule.rule, () => {
      expect(
        breachesOf(
          rule,
          EDGES.filter((edge) => !excepted(edge))
        )
      ).toEqual([])
    })
  }

  test("6. cli/ holds cli.ts, context.ts and errors.ts, and none but cli/cli.ts re-exports from another folder.", () => {
    expect(
      READ.map(({ file }) => file).filter((file) => folderOf(file) === "cli")
    ).toEqual(CLI_FILES)
    expect(READ.flatMap(({ file, code }) => passesOn(file, code))).toEqual([])
  })

  test("each exception is still a breach of a rule, so none outlives the reason it was named for", () => {
    const stale = EXCEPTIONS.filter(
      (exception) =>
        !EDGES.some(
          (edge) =>
            edge.from === exception.from &&
            edge.to === exception.to &&
            RULES.some((rule) => breachesOf(rule, [edge]).length > 0)
        )
    )
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
      const files = names.filter(
        (name) => !statSync(join(root, name)).isDirectory()
      )
      expect(files).toEqual([entry])
      expect(names.length).toBeGreaterThan(1)
    })
  }
})
