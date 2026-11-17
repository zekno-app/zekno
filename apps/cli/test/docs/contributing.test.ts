/**
 * The contributor's guide says what in a template runs, and where a
 * reviewer runs a pull request's code (specs/012-templates, security review
 * T7; contracts/contributing.md, CG1, CG4, CG6, CG9). A template's start
 * command and plain values configure and start software on the user's
 * server, so the guide never calls a template "no code" or "never code"; the
 * template tests and a client check run the pull request's code, so a
 * reviewer reads every changed line first and runs them only on a machine
 * that holds no Zekno key and no `.env.local`. Nothing here starts a process.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "../../../..")
const GUIDE = readFileSync(join(ROOT, "CONTRIBUTING.md"), "utf8")

/** The text of the guide's part `heading`, up to the next `## `, its lines joined by spaces. */
function part(heading: string): string {
  const start = GUIDE.indexOf(`\n## ${heading}\n`)
  if (start === -1) throw new Error(`CONTRIBUTING.md has no part ${heading}`)
  const end = GUIDE.indexOf("\n## ", start + 1)
  return GUIDE.slice(start, end === -1 ? undefined : end).replace(/\s+/g, " ")
}

describe("CONTRIBUTING.md (security review T7)", () => {
  test("it never calls a template code-free: not `never code`, not `no code`, in the guide or the pages that point at it", () => {
    for (const path of [
      "CONTRIBUTING.md",
      "apps/cli/README.md",
      "apps/web/content/docs/cli.mdx",
      "apps/web/content/docs/templates.mdx",
    ]) {
      const text = readFileSync(join(ROOT, path), "utf8").replace(/\s+/g, " ")
      expect([path, /\b(?:never|no) code\b/i.test(text)]).toEqual([path, false])
    }
  })

  test("what a template is: it configures and starts software on the user's server, and its start command and plain values are read as code", () => {
    const what = part("What a template is")
    expect(what).toContain(
      "It configures and starts software on the user's server."
    )
    expect(what).toContain(
      "Its start command and its plain values are what runs there, so a reviewer reads them as code."
    )
    expect(part("What a file cannot do")).toContain(
      "Its image, its start command and its plain values decide what runs there"
    )
  })

  test("where a pull request's tests run: after reading every changed line, on a machine with no Zekno key and no .env.local, installed with --ignore-scripts", () => {
    const running = part("Running the tests")
    expect(running).toContain("only after reading every line it changes")
    expect(running).toContain(
      "only on a machine that holds no Zekno key and no `apps/cli/.env.local`"
    )
    expect(running).toContain("`bun install --ignore-scripts`")
    expect(running).toContain(
      "The reviewer connects by hand on that machine too."
    )
  })

  test("the reviewer's list: every changed line read first, the connection secret's host, and the names in also", () => {
    const review = part("What the reviewer checks by hand")
    expect(review).toContain(
      "The reviewer reads every line the pull request changes before running anything of it."
    )
    expect(review).toContain(
      "- the connection secret points at `{service}` and nowhere else;"
    )
    expect(review).toContain(
      "- each name in `also` is a name people use for this software, never another software's name;"
    )
  })
})
