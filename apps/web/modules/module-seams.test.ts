/**
 * Keeps the app's layering honest:
 *
 *   app  ->  modules  ->  shared (components, config, hooks, lib, providers, types)
 *
 * A module is used through its index only.
 * Inside a module, files reach each other with relative imports. Shared code
 * never depends on a module.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const root = join(import.meta.dir, "..")
const shared = ["components", "config", "hooks", "lib", "providers", "types"]
const scanned = ["app", "modules", ...shared]

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

type Import = { file: string; spec: string }

const imports: Import[] = scanned
  .flatMap((dir) => sourceFiles(join(root, dir)))
  .flatMap((path) => {
    const source = readFileSync(path, "utf8")
    const specs = [...source.matchAll(/(?:from|import)\s+"([^"]+)"/g)]
    return specs.map((match) => ({ file: relative(root, path), spec: match[1]! }))
  })

/** The module a file belongs to, if it is inside one. */
function moduleOf(file: string) {
  return /^modules\/([^/]+)\//.exec(file)?.[1]
}

/** What an `@/modules/...` specifier points at: the module and the path inside it. */
function target(spec: string) {
  const match = /^@\/modules\/([^/]+)(\/.*)?$/.exec(spec)
  return match ? { name: match[1]!, inside: match[2] } : undefined
}

describe("module seams", () => {
  test("shared code does not depend on a module", () => {
    const offenders = imports.filter(
      ({ file, spec }) =>
        shared.some((dir) => file.startsWith(`${dir}/`)) && target(spec)
    )
    expect(offenders).toEqual([])
  })

  test("a module is used through its index", () => {
    const offenders = imports.filter(({ file, spec }) => {
      const to = target(spec)
      if (!to || moduleOf(file) === to.name) return false
      return to.inside !== undefined
    })
    expect(offenders).toEqual([])
  })

  test("files inside a module reach each other with relative imports", () => {
    const offenders = imports.filter(
      ({ file, spec }) =>
        moduleOf(file) !== undefined && target(spec)?.name === moduleOf(file)
    )
    expect(offenders).toEqual([])
  })

  test("relative imports do not leave their module", () => {
    const offenders = imports.filter(({ file, spec }) => {
      const name = moduleOf(file)
      if (!name || !spec.startsWith(".")) return false
      const reached = relative(root, resolve(root, dirname(file), spec))
      return !reached.startsWith(`modules/${name}/`) && reached !== `modules/${name}`
    })
    expect(offenders).toEqual([])
  })
})
