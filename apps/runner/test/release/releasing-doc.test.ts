/**
 * The release procedure page, apps/runner/RELEASING.md (specs/005-runner-release,
 * task T031). A maintainer follows it with no other help, so what it names
 * must exist: the scripts and their commands, release tags in their one
 * form, the file it has them write, and its parts in order. A step that
 * changes something on GitHub is marked as the maintainer's own.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { parseTag, runnerReleaseJson } from "../../scripts/release-lib"
import { tempDir } from "../support/helpers"

const RUNNER = join(import.meta.dir, "../..")
const page = readFileSync(join(RUNNER, "RELEASING.md"), "utf8")
const lines = page.split("\n")

/** The parts tasks.md (T030) lists, in its order. */
const PARTS = [
  "1. Once, before the first release",
  "2. Which commits",
  "3. The version",
  "4. Preparing a prod release",
  "5. Starting a release",
  "6. Watching the run, and approving a prod release",
  "7. The second build",
  "8. The release notes",
  "9. Withdrawing a release",
  "10. After a prod release",
]

/** The lines outside the ```text blocks, which show what a script prints rather than what to run. */
const runnable = (() => {
  let inText = false
  return lines.map((line, at) => {
    if (/^\s*```text\s*$/.test(line)) inText = true
    else if (inText && /^\s*```\s*$/.test(line)) inText = false
    return { line, at, inText }
  })
})().filter((entry) => !entry.inText)

describe("apps/runner/RELEASING.md", () => {
  test("every script it runs exists, and release.ts only with one of its three commands", () => {
    const commands = [
      ...page.matchAll(
        /bun apps\/runner\/scripts\/([A-Za-z0-9_-]+)\.ts(?: ([a-z-]+))?/g
      ),
    ]
    expect(new Set(commands.map(([, name]) => name))).toEqual(
      new Set(["release", "second-build"])
    )
    for (const [command, name, sub] of commands) {
      expect({
        command,
        exists: existsSync(join(RUNNER, "scripts", `${name}.ts`)),
      }).toEqual({ command, exists: true })
      if (name === "release")
        expect({
          command,
          known: ["check", "files", "check-main"].includes(sub ?? ""),
        }).toEqual({ command, known: true })
    }
  })

  test("every release tag it shows is one the workflow takes; anything else is one of the forms it names", () => {
    const FORMS = [
      "runner-v*",
      "runner-v<version>",
      "runner-v<x.y.z>",
      "runner-v<x.y.z>-dev.<n>",
      "runner-v${VERSION:?}",
    ]
    const tags = [...page.matchAll(/runner-v[^\s`'"|),]*/g)].map(([tag]) =>
      tag.replace(/\.$/, "")
    )
    for (const tag of tags) {
      if (/^runner-v[0-9]/.test(tag))
        expect({ tag, parsed: parseTag(tag) !== undefined }).toEqual({
          tag,
          parsed: true,
        })
      else
        expect({ tag, form: FORMS.includes(tag) }).toEqual({ tag, form: true })
    }
    // The first releases, by name.
    expect(tags).toContain("runner-v0.1.0-dev.1")
    expect(tags).toContain("runner-v0.1.0")
    expect(parseTag("runner-v0.1.0-dev.1")).toEqual({
      version: "0.1.0-dev.1",
      environment: "dev",
    })
  })

  test("no version is written into a command: a placeholder that fails until it is replaced, and nothing that deletes without asking (security review RV10)", () => {
    const text = runnable.map((entry) => entry.line)
    // Each place that sets the two variables clears them first, then needs <version> replaced.
    const sets = text.flatMap((line, at) =>
      /^\s*(VERSION|TAG)=/.test(line) ? [at] : []
    )
    expect(sets.length).toBeGreaterThanOrEqual(6)
    for (const at of sets) {
      const line = text[at]!.trim()
      if (line.startsWith("VERSION=")) {
        expect(line).toBe("VERSION=<version>")
        expect(text[at - 1]!.trim()).toBe("unset VERSION TAG")
        expect(text[at + 1]!.trim()).toBe('TAG="runner-v${VERSION:?}"')
      } else expect(line).toBe('TAG="runner-v${VERSION:?}"')
    }
    // Every use stops when its variable is not set, rather than act on an empty or older one.
    for (const line of text)
      expect({
        line,
        bare: /\$(VERSION|TAG)\b|\$\{(VERSION|TAG)\}/.test(line),
      }).toEqual({ line, bare: false })
    expect(page).not.toContain("--yes")
    // As written, the placeholder is not a command any shell runs, and the guard stops: checked in each shell there is.
    for (const shell of [
      "/bin/sh",
      "/bin/bash",
      "/bin/dash",
      "/bin/zsh",
    ].filter((path) => existsSync(path))) {
      const assign = Bun.spawnSync([shell, "-c", "VERSION=<version>"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      expect({ shell, code: assign.exitCode === 0 }).toEqual({
        shell,
        code: false,
      })
      const guard = Bun.spawnSync(
        [
          shell,
          "-c",
          'unset VERSION TAG\nTAG="runner-v${VERSION:?}"\nprintf %s "$TAG"',
        ],
        { stdout: "pipe", stderr: "pipe" }
      )
      expect({
        shell,
        code: guard.exitCode === 0,
        out: guard.stdout.toString(),
      }).toEqual({ shell, code: false, out: "" })
    }
  })

  test("its gh api commands only read, and only this repository", () => {
    const calls = [...page.matchAll(/gh api [^`\n]+/g)].map(([call]) => call)
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const call of calls) {
      expect({
        call,
        reads: !/\s(-X|--method|-f|-F|--field|--raw-field|--input)\b/.test(
          call
        ),
      }).toEqual({ call, reads: true })
      expect(call.startsWith("gh api repos/zekno-app/zekno/")).toBe(true)
    }
  })

  test("its ten parts, in order, as headings", () => {
    const numbered = [...page.matchAll(/^## (.+)$/gm)]
      .map(([, heading]) => heading!)
      .filter((heading) => /^\d+\. /.test(heading))
    expect(numbered).toEqual(PARTS)
  })

  test("the file it has a maintainer write, to prepare or withdraw a release, is the one the second build writes, with no checksums", () => {
    const blocks: string[] = []
    for (let at = 0; at < lines.length; at++) {
      // The here-document is read before the file is opened, so a VERSION not set leaves the file as it was.
      const start =
        /^(\s*)cat <<EOF > apps\/cli\/src\/version\/runner-release\.json$/.exec(
          lines[at]!
        )
      if (!start) continue
      const indent = start[1]!.length
      const body: string[] = []
      for (at++; at < lines.length && lines[at]!.trim() !== "EOF"; at++)
        body.push(lines[at]!.slice(indent))
      blocks.push(`${body.join("\n")}\n`)
    }
    expect(blocks).toHaveLength(2)
    for (const block of blocks)
      expect(block.replaceAll("${VERSION:?}", "0.1.0")).toBe(
        runnerReleaseJson("0.1.0", null, null)
      )
    // Run as the page has it, with VERSION not set, in each shell there is: the file is not touched.
    const command = `cat <<EOF > apps/cli/src/version/runner-release.json\n${blocks[0]}EOF\n`
    for (const shell of [
      "/bin/sh",
      "/bin/bash",
      "/bin/dash",
      "/bin/zsh",
    ].filter((path) => existsSync(path))) {
      const dir = tempDir("releasing")
      mkdirSync(join(dir, "apps/cli/src/version"), { recursive: true })
      writeFileSync(
        join(dir, "apps/cli/src/version/runner-release.json"),
        "as it was\n"
      )
      const run = Bun.spawnSync([shell, "-c", `unset VERSION\n${command}`], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      })
      expect({
        shell,
        code: run.exitCode === 0,
        file: readFileSync(
          join(dir, "apps/cli/src/version/runner-release.json"),
          "utf8"
        ),
      }).toEqual({ shell, code: false, file: "as it was\n" })
    }
  })

  test("every step that pushes, or changes a release or a run on GitHub, is marked as the maintainer's own, and never sits in a block to paste", () => {
    const OUTWARD =
      /`(git push origin|gh release (?:create|edit|delete)|gh run (?:rerun|delete))[^`\n]*`/
    let marked = 0
    for (const [index, { line }] of runnable.entries()) {
      if (!OUTWARD.test(line)) continue
      const before =
        runnable
          .slice(0, index)
          .reverse()
          .find((entry) => entry.line.trim() !== "")?.line ?? ""
      expect({
        line,
        marked:
          line.includes("**[outward]**") || before.includes("**[outward]**"),
      }).toEqual({ line, marked: true })
      marked++
    }
    expect(marked).toBeGreaterThanOrEqual(10)
    // The ```sh blocks hold only what reads, or changes this machine.
    const shell = page.match(/```sh\n[\s\S]*?```/g) ?? []
    expect(shell.length).toBeGreaterThan(0)
    for (const block of shell)
      expect({
        block,
        outward:
          /git push|gh release (create|edit|delete)|gh run (rerun|delete)/.test(
            block
          ),
      }).toEqual({ block, outward: false })
    // Every gh command names the repository, so it never acts on another one by chance.
    for (const [command] of page.matchAll(/gh (?:release|run) [a-z]+ [^`\n]+/g))
      expect(command).toContain("--repo zekno-app/zekno")
  })

  test("each open question it follows is listed at the top and marked where it is used; once answered, both go", () => {
    const marks = (text: string) =>
      new Set(
        [...text.matchAll(/\*\*\[(Q[0-9]+)\]\*\*/g)].map(([, mark]) => mark)
      )
    const top = page.indexOf("## Waiting for the maintainer's answer")
    const first = page.indexOf("## 1. ")
    const listed =
      top === -1
        ? new Set<string>()
        : marks(page.slice(top, page.indexOf("\n## ", top + 1)))
    expect(marks(page.slice(first))).toEqual(listed)
    if (top !== -1) expect(top).toBeLessThan(first)
    // The maintainer answered every one on 2026-11-14 (research.md): the page reads as decided.
    expect(top).toBe(-1)
    expect(marks(page)).toEqual(new Set())
  })

  test("apps/runner/README.md links to it", () => {
    expect(readFileSync(join(RUNNER, "README.md"), "utf8")).toContain(
      "(./RELEASING.md)"
    )
  })
})
