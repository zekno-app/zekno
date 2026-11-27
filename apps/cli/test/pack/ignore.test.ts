/**
 * The ignore file, chosen and read as Docker chooses and reads it
 * (specs/016-build-from-source, contracts/cli.md CL2, "The ignore file",
 * "Reading it", "Matching"; FR-013; tasks T108). The cases are written from
 * the documented grammar and the tables of Docker's `ignorefile` and
 * `patternmatcher` tests; the walk at the end is held against what real
 * BuildKit copied for check L17's four fixtures (results/phase-0-mac.md).
 * No sentence is checked: a stop is checked by its id.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { CliError } from "../../src/cli/errors"
import {
  compilePatterns,
  entersExcluded,
  IGNORE_FILE_BYTES,
  IGNORE_LINE_BYTES,
  ignoreFileNames,
  IgnoreStop,
  matchPath,
  type IgnoreRules,
  type MatchInfo,
  type OwnIgnoreLine,
  readAll,
  readIgnoreFile,
} from "../../src/pack/ignore"

const bytes = (text: string) => new TextEncoder().encode(text)

/** The patterns of an ignore file's text, as `ignorefile.ReadAll` gives them. */
const patternsOf = (text: string) =>
  readAll(bytes(text), ".dockerignore").map((line) => line.text)

/** The rules of an ignore file's text. */
const rulesOf = (text: string) =>
  compilePatterns(readAll(bytes(text), ".dockerignore"), ".dockerignore")

/** The stop a call throws, by its line; fails when it throws something else or nothing. */
function stopOf(work: () => unknown): OwnIgnoreLine {
  try {
    work()
  } catch (error) {
    expect(error).toBeInstanceOf(IgnoreStop)
    expect(error).toBeInstanceOf(CliError)
    const line = (error as IgnoreStop).line
    // Until its row is written (T156), the text said is the id.
    expect((error as IgnoreStop).message).toBe(line.id)
    return line
  }
  throw new Error("no stop was thrown")
}

describe("which ignore file BuildKit uses", () => {
  test("for a Dockerfile build, <dockerfile>.dockerignore beside it, else .dockerignore at the root; for Railpack only the root's", () => {
    expect(
      ignoreFileNames({ builder: "dockerfile", dockerfile: "Dockerfile" })
    ).toEqual(["Dockerfile.dockerignore", ".dockerignore"])
    expect(
      ignoreFileNames({
        builder: "dockerfile",
        dockerfile: "docker/web.Dockerfile",
      })
    ).toEqual(["docker/web.Dockerfile.dockerignore", ".dockerignore"])
    expect(ignoreFileNames({ builder: "railpack" })).toEqual([".dockerignore"])
  })
})

describe("reading it, as ignorefile.ReadAll", () => {
  test("Docker's own case: leading slashes dropped, empty lines and comments skipped, `!` kept whole", () => {
    const text =
      "test1\n/test2\n/a/file/here\n\nlastfile\n# this is a comment\n! /inverted/abs/path\n!\n! "
    expect(patternsOf(text)).toEqual([
      "test1",
      "test2",
      "a/file/here",
      "lastfile",
      "!inverted/abs/path",
      "!",
      "!",
    ])
  })

  test("a byte order mark at the start is dropped; a line starting # is a comment before trimming; a # after a space is a name", () => {
    expect(patternsOf("\ufeff# comment\n\ufefftwo")).toEqual(["\ufefftwo"])
    expect(patternsOf("\ufefffirst")).toEqual(["first"])
    expect(patternsOf("#hash.txt\n #spaced.txt\n\\#escaped.txt")).toEqual([
      "#spaced.txt",
      "\\#escaped.txt",
    ])
  })

  test("trimmed as Go's TrimSpace trims, line ends of either kind, and cleaned as filepath.Clean", () => {
    expect(
      patternsOf("  notes.txt \t\r\nnext\u0085\nthe\u00a0end\u3000")
    ).toEqual(["notes.txt", "next", "the\u00a0end"])
    expect(
      patternsOf("a//b/\n./c\nd/../e\n../f\n/../g\n//h\n/\n.\nlogs/\n")
    ).toEqual(["a/b", "c", "e", "../f", "g", "h", "/", ".", "logs"])
    // Cleaning can leave a space at the end, which the matcher trims again.
    expect(rulesOf("foo /").patterns.map((pattern) => pattern.cleaned)).toEqual(
      ["foo"]
    )
  })

  test("each line keeps its number in the file", () => {
    expect(readAll(bytes("# c\n\none\r\n  two"), ".dockerignore")).toEqual([
      { text: "one", line: 3 },
      { text: "two", line: 4 },
    ])
  })

  test(`a line with its end must fit in ${IGNORE_LINE_BYTES} bytes, as Go's line scanner reads it; else a stop of its own`, () => {
    const longest = "a".repeat(IGNORE_LINE_BYTES - 1)
    expect(readAll(bytes(`${longest}\nb`), ".dockerignore")).toHaveLength(2)
    expect(readAll(bytes(longest), ".dockerignore")).toHaveLength(1)
    for (const text of [
      `${longest}a\nb`,
      `${longest}a`,
      `# ${longest}`,
      `x\n${longest}\r\n`,
    ])
      expect(stopOf(() => readAll(bytes(text), ".dockerignore"))).toMatchObject(
        {
          id: "ignore_file",
          why: "line",
          file: ".dockerignore",
        }
      )
  })

  test("a pattern that is not UTF-8 is one zekno cannot reproduce; a comment may hold any bytes", () => {
    expect(
      readAll(new Uint8Array([0x23, 0xff, 0x0a, 0x61]), ".dockerignore")
    ).toEqual([{ text: "a", line: 2 }])
    expect(
      stopOf(() =>
        readAll(new Uint8Array([0x61, 0x0a, 0x62, 0xff]), "x.dockerignore")
      )
    ).toEqual({
      id: "ignore_pattern",
      why: "text",
      file: "x.dockerignore",
      at: 2,
    })
  })
})

describe("what zekno refuses to guess (CL2): a stop of its own", () => {
  test("a POSIX class, or a class Go's regexp reads otherwise than its pattern says", () => {
    for (const pattern of [
      "[[:digit:]]*.txt",
      "[*]",
      "[?]",
      "[\\d]",
      "[\\]]",
      "[a[]",
      "[z-a]",
    ])
      expect(stopOf(() => rulesOf(`ok\n${pattern}`))).toEqual({
        id: "ignore_pattern",
        why: "class",
        file: ".dockerignore",
        at: 2,
      })
  })

  test("a pattern Docker refuses: an open or empty class, a range open at an end, a backslash at the end, a lone !", () => {
    for (const pattern of [
      "[",
      "[ab",
      "a[]",
      "[]a]",
      "[^]a]",
      "[-a]",
      "[a-]",
      "foo\\",
      "!",
      "!/",
      "! ",
    ])
      expect(stopOf(() => rulesOf(pattern))).toMatchObject({
        id: "ignore_pattern",
        at: 1,
      })
  })

  test("an escape Go's regexp reads as a class or refuses: a letter, a digit, a character past ASCII", () => {
    for (const pattern of ["\\d", "a\\w", "\\1", "\\é"])
      expect(stopOf(() => rulesOf(pattern))).toMatchObject({
        id: "ignore_pattern",
        why: "escape",
        at: 1,
      })
  })

  test("a byte order mark inside a pattern, which Go's scanner reads otherwise than its comparison", () => {
    expect(stopOf(() => rulesOf("a\n\ufeffb"))).toMatchObject({
      id: "ignore_pattern",
      why: "text",
      at: 2,
    })
  })
})

/** check L17's fixtures, beside the Linux stand-in, and what the test writes in them at run time there (file-choice.ts, `RUN_TIME`). */
const FIXTURES = resolve(
  import.meta.dir,
  "../../../runner/test/support/linux-server/fixtures"
)
const RUN_TIME_FILES = [
  ".env",
  ".env.local",
  "build/out.txt",
  "build/keep.txt",
  "dist/app.js",
  "node_modules/pkg/index.js",
  "lib/node_modules/inner/index.js",
]

/**
 * What real BuildKit copied for each fixture on both engines and stores
 * (results/phase-0-mac.md, check L17), a folder ending `/`. The link
 * `dockerfile-link -> Dockerfile` is in each list: zekno never sends a link,
 * but the walk here is BuildKit's, links counted as files.
 */
const COPIED: Record<string, string[]> = {
  "ignore-basics": [
    "#kept.txt",
    ".dockerignore",
    "Dockerfile",
    "README.txt",
    "app.txt",
    "build/",
    "build/keep.txt",
    "cache/",
    "dockerfile-link",
    "empty/",
    "lib/",
    "lib/deep/",
    "lib/notes.txt",
    "lib/top-only.txt",
    "lib/util.txt",
    "logs/",
    "logs/keep.log",
  ],
  "ignore-depth": [
    "#notes.md",
    "Dockerfile",
    "docs/",
    "docs/guide/",
    "docs/guide/public-intro.md",
    "docs/public-top.md",
    "node_modules/",
    "node_modules/pkg/",
    "node_modules/pkg/index.js",
    "readme.md",
    "src/",
    "src/a.txt",
    "src/deep/",
    "src/gen/",
    "src/keep/",
    "src/keep/c.snap",
    "src/keep/deep/",
    "src/keep/deep/d.snap",
    "top.txt",
  ],
  "ignore-escape": [
    "#tag2",
    ".dockerignore",
    "Dockerfile",
    "a.txt",
    "b-keep.log",
    "b.txt",
    "build/",
    "build/keep.txt",
    "build/out.txt",
    "c.log",
    "dockerfile-link",
    "empty/",
    "file10.txt",
    "lib/",
    "sub/",
    "sub/root-only.md",
    "tmp2/",
  ],
}

/**
 * fsutil's walk over a folder, with the rules: entries in name order, each
 * matched with its parent's results; an excluded folder entered only when
 * `entersExcluded` says so, and sent only when something under it is.
 */
function walk(root: string, rules: IgnoreRules): string[] {
  const sent = new Set<string>()
  // An entry sent brings every folder above it, as fsutil sends a skipped folder once something under it is sent.
  const send = (path: string, folder: boolean) => {
    const parts = path.split("/")
    for (let at = 1; at < parts.length; at++)
      sent.add(`${parts.slice(0, at).join("/")}/`)
    sent.add(folder ? `${path}/` : path)
  }
  const visit = (relative: string, parent: MatchInfo | undefined) => {
    for (const name of readdirSync(join(root, relative)).sort()) {
      const path = relative === "" ? name : `${relative}/${name}`
      const { excluded, info } = matchPath(rules, path, parent)
      if (lstatSync(join(root, path)).isDirectory()) {
        if (excluded && !entersExcluded(rules, path)) continue
        if (!excluded) send(path, true)
        visit(path, info)
      } else if (!excluded) send(path, false)
    }
  }
  visit("", undefined)
  return [...sent].sort()
}

describe("check L17's fixtures, against what real BuildKit copied", () => {
  let root: string
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "zekno-ignore-")))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** A fixture's copy with the run-time entries, as the stand-in builds it. */
  function copyOf(name: string): string {
    const folder = join(root, name)
    const copy = (from: string, to: string) => {
      mkdirSync(to, { recursive: true })
      for (const entry of readdirSync(from)) {
        if (lstatSync(join(from, entry)).isDirectory())
          copy(join(from, entry), join(to, entry))
        else writeFileSync(join(to, entry), readFileSync(join(from, entry)))
      }
    }
    copy(join(FIXTURES, name), folder)
    for (const path of RUN_TIME_FILES) {
      mkdirSync(join(folder, path, ".."), { recursive: true })
      writeFileSync(join(folder, path), `run time: ${path}\n`)
    }
    symlinkSync("Dockerfile", join(folder, "dockerfile-link"))
    mkdirSync(join(folder, "empty"))
    return folder
  }

  for (const [name, copied] of Object.entries(COPIED))
    test(`${name}: the walk sends what BuildKit copied`, () => {
      const folder = copyOf(name)
      const rules = readIgnoreFile(folder, {
        builder: "dockerfile",
        dockerfile: "Dockerfile",
      })
      expect(rules.file).toBe(".dockerignore")
      expect(walk(folder, rules)).toEqual(copied.sort())
    })

  test("ignore-class: its POSIX class is refused, never guessed", () => {
    const folder = copyOf("ignore-class")
    expect(
      stopOf(() =>
        readIgnoreFile(folder, {
          builder: "dockerfile",
          dockerfile: "Dockerfile",
        })
      )
    ).toEqual({
      id: "ignore_pattern",
      why: "class",
      file: ".dockerignore",
      at: 3,
    })
  })
})

describe("readIgnoreFile: one open file inside the root, within its bounds", () => {
  let root: string
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "zekno-ignore-file-")))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })
  const dockerfile = {
    builder: "dockerfile",
    dockerfile: "docker/web.Dockerfile",
  } as const

  test("the Dockerfile's own ignore file wins over the root's; with neither there are no rules", () => {
    mkdirSync(join(root, "docker"))
    expect(readIgnoreFile(root, dockerfile)).toMatchObject({
      file: null,
      patterns: [],
    })
    writeFileSync(join(root, ".dockerignore"), "a\n")
    expect(readIgnoreFile(root, dockerfile).file).toBe(".dockerignore")
    writeFileSync(join(root, "docker/web.Dockerfile.dockerignore"), "b\n")
    const rules = readIgnoreFile(root, dockerfile)
    expect(rules.file).toBe("docker/web.Dockerfile.dockerignore")
    expect(rules.patterns.map((pattern) => pattern.cleaned)).toEqual(["b"])
    expect(readIgnoreFile(root, { builder: "railpack" }).file).toBe(
      ".dockerignore"
    )
  })

  test(`a file of ${IGNORE_FILE_BYTES} bytes is read; one byte more is a stop of its own`, () => {
    const line = `${"a".repeat(1023)}\n`
    writeFileSync(
      join(root, ".dockerignore"),
      line.repeat(IGNORE_FILE_BYTES / line.length)
    )
    expect(readIgnoreFile(root, { builder: "railpack" }).patterns).toHaveLength(
      1024
    )
    writeFileSync(
      join(root, ".dockerignore"),
      `${line.repeat(IGNORE_FILE_BYTES / line.length)}b`
    )
    expect(stopOf(() => readIgnoreFile(root, { builder: "railpack" }))).toEqual(
      {
        id: "ignore_file",
        why: "size",
        file: ".dockerignore",
        at: null,
      }
    )
  })

  test("an ignore file that is a link, a pipe or a folder, or that sits under a linked folder, is never followed or read: a stop of its own", () => {
    const outside = join(root, "outside")
    mkdirSync(outside)
    writeFileSync(join(outside, "rules"), "secret\n")
    const tree = join(root, "tree")
    mkdirSync(tree)
    symlinkSync(join(outside, "rules"), join(tree, ".dockerignore"))
    expect(
      stopOf(() => readIgnoreFile(tree, { builder: "railpack" }))
    ).toMatchObject({ id: "ignore_file", why: "not_a_file" })
    rmSync(join(tree, ".dockerignore"))
    expect(
      Bun.spawnSync(["mkfifo", join(tree, ".dockerignore")]).exitCode
    ).toBe(0)
    expect(
      stopOf(() => readIgnoreFile(tree, { builder: "railpack" }))
    ).toMatchObject({ id: "ignore_file", why: "not_a_file" })
    rmSync(join(tree, ".dockerignore"))
    mkdirSync(join(tree, ".dockerignore"))
    expect(
      stopOf(() => readIgnoreFile(tree, { builder: "railpack" }))
    ).toMatchObject({ id: "ignore_file", why: "not_a_file" })
    rmSync(join(tree, ".dockerignore"), { recursive: true })
    symlinkSync(outside, join(tree, "docker"))
    writeFileSync(join(outside, "web.Dockerfile.dockerignore"), "x\n")
    expect(stopOf(() => readIgnoreFile(tree, dockerfile))).toMatchObject({
      id: "ignore_file",
      why: "not_a_file",
      file: "docker/web.Dockerfile.dockerignore",
    })
  })

  test("a name that differs only in case is not the ignore file, as on the server's file system", () => {
    writeFileSync(join(root, ".DockerIgnore"), "a\n")
    const found = readIgnoreFile(root, { builder: "railpack" })
    // On a file system that ignores case the file is there under another name; on one that does not, it is simply not there.
    expect(found.file).toBeNull()
  })
})
