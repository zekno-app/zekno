/**
 * Patterns compiled and matched as Docker's `patternmatcher`, and the folders
 * fsutil's walk enters (specs/016-build-from-source, contracts/cli.md CL2,
 * "Matching"; FR-013; tasks T108). The cases are written from the documented
 * grammar and the tables of Docker's `patternmatcher` and Go's `filepath`
 * tests.
 */
import { describe, expect, test } from "bun:test"

import {
  cleanPath,
  compilePatterns,
  entersExcluded,
  matchPath,
  readAll,
} from "../../src/pack/ignore"

const bytes = (text: string) => new TextEncoder().encode(text)

/** The rules of an ignore file's text. */
const rulesOf = (text: string) =>
  compilePatterns(readAll(bytes(text), ".dockerignore"), ".dockerignore")

/** Whether `path` is left out by the patterns, with no parent results, as `MatchesOrParentMatches` decides. */
const leftOut = (patterns: string[], path: string) =>
  matchPath(rulesOf(patterns.join("\n")), path).excluded

describe("cleanPath, as Go's filepath.Clean", () => {
  test("each rule of Clean", () => {
    const cases: [string, string][] = [
      ["", "."],
      ["abc", "abc"],
      ["abc/def", "abc/def"],
      ["a/b/c", "a/b/c"],
      [".", "."],
      ["..", ".."],
      ["../..", "../.."],
      ["../../abc", "../../abc"],
      ["/abc", "/abc"],
      ["/", "/"],
      ["abc/", "abc"],
      ["abc/def/", "abc/def"],
      ["//abc", "/abc"],
      ["///abc", "/abc"],
      ["abc//def//ghi", "abc/def/ghi"],
      ["abc/./def", "abc/def"],
      ["/./abc/def", "/abc/def"],
      ["abc/.", "abc"],
      ["abc/def/ghi/../jkl", "abc/def/jkl"],
      ["abc/def/../ghi/../jkl", "abc/jkl"],
      ["abc/def/..", "abc"],
      ["abc/def/../..", "."],
      ["/abc/def/../..", "/"],
      ["abc/def/../../..", ".."],
      ["/abc/def/../../..", "/"],
      ["abc/def/../../../ghi/jkl/../../../mno", "../../mno"],
      ["/../abc", "/abc"],
      ["abc/./../def", "def"],
      ["abc//./../def", "def"],
      ["abc/../../././../def", "../../def"],
    ]
    for (const [path, clean] of cases) expect(cleanPath(path)).toBe(clean)
  })
})

describe("matching, as patternmatcher", () => {
  test("Docker's table of one pattern against one path", () => {
    const cases: [string, string, boolean][] = [
      ["**", "file", true],
      ["**", "file/", true],
      ["**/", "file", true],
      ["**/", "file/", true],
      ["**", "/", true],
      ["**/", "/", true],
      ["**", "dir/file", true],
      ["**/", "dir/file", true],
      ["**", "dir/file/", true],
      ["**/", "dir/file/", true],
      ["**/**", "dir/file", true],
      ["**/**", "dir/file/", true],
      ["dir/**", "dir/file", true],
      ["dir/**", "dir/file/", true],
      ["dir/**", "dir/dir2/file", true],
      ["dir/**", "dir/dir2/file/", true],
      ["**/dir", "dir", true],
      ["**/dir", "dir/file", true],
      ["**/dir2/*", "dir/dir2/file", true],
      ["**/dir2/*", "dir/dir2/file/", true],
      ["**/dir2/**", "dir/dir2/dir3/file", true],
      ["**/dir2/**", "dir/dir2/dir3/file/", true],
      ["**file", "file", true],
      ["**file", "dir/file", true],
      ["**/file", "dir/file", true],
      ["**file", "dir/dir/file", true],
      ["**/file", "dir/dir/file", true],
      ["**/file*", "dir/dir/file", true],
      ["**/file*", "dir/dir/file.txt", true],
      ["**/file*txt", "dir/dir/file.txt", true],
      ["**/file*.txt", "dir/dir/file.txt", true],
      ["**/file*.txt*", "dir/dir/file.txt", true],
      ["**/**/*.txt", "dir/dir/file.txt", true],
      ["**/**/*.txt2", "dir/dir/file.txt", false],
      ["**/*.txt", "file.txt", true],
      ["**/**/*.txt", "file.txt", true],
      ["a**/*.txt", "a/file.txt", true],
      ["a**/*.txt", "a/dir/file.txt", true],
      ["a**/*.txt", "a/dir/dir/file.txt", true],
      ["a/*.txt", "a/dir/file.txt", false],
      ["a/*.txt", "a/file.txt", true],
      ["a/*.txt**", "a/file.txt", true],
      ["a[b-d]e", "ae", false],
      ["a[b-d]e", "ace", true],
      ["a[b-d]e", "aae", false],
      ["a[^b-d]e", "aze", true],
      [".*", ".foo", true],
      [".*", "foo", false],
      ["abc.def", "abcdef", false],
      ["abc.def", "abc.def", true],
      ["abc.def", "abcZdef", false],
      ["abc?def", "abcZdef", true],
      ["abc?def", "abcdef", false],
      ["a\\\\", "a\\", true],
      ["**/foo/bar", "foo/bar", true],
      ["**/foo/bar", "dir/foo/bar", true],
      ["**/foo/bar", "dir/dir2/foo/bar", true],
      ["abc/**", "abc", false],
      ["abc/**", "abc/def", true],
      ["abc/**", "abc/def/ghi", true],
      ["**/.foo", ".foo", true],
      ["**/.foo", "bar.foo", false],
      ["a(b)c/def", "a(b)c/def", true],
      ["a(b)c/def", "a(b)c/xyz", false],
      ["a.|)$(}+{bc", "a.|)$(}+{bc", true],
      [
        "dist/proxy.py-2.4.0rc3.dev36+g08acad9-py3-none-any.whl",
        "dist/proxy.py-2.4.0rc3.dev36+g08acad9-py3-none-any.whl",
        true,
      ],
      [
        "dist/*.whl",
        "dist/proxy.py-2.4.0rc3.dev36+g08acad9-py3-none-any.whl",
        true,
      ],
    ]
    for (const [pattern, path, matched] of cases) {
      const found = matchPath(
        compilePatterns([{ text: pattern, line: 1 }], ".dockerignore"),
        path
      ).excluded
      if (found !== matched)
        throw new Error(`${pattern} against ${path}: ${found}, not ${matched}`)
    }
  })

  test("Docker's table of several patterns: the last that matches a path or one of its parents wins", () => {
    expect(leftOut(["**", "!util/docker/web"], "util/docker/web/foo")).toBe(
      false
    )
    expect(
      leftOut(
        ["**", "!util/docker/web", "util/docker/web/foo"],
        "util/docker/web/foo"
      )
    ).toBe(true)
    expect(
      leftOut(
        ["**", "!dist/proxy.py-2.4.0rc3.dev36+g08acad9-py3-none-any.whl"],
        "dist/proxy.py-2.4.0rc3.dev36+g08acad9-py3-none-any.whl"
      )
    ).toBe(false)
    expect(
      leftOut(
        ["**", "!dist/*.whl"],
        "dist/proxy.py-2.4.0rc3.dev36+g08acad9-py3-none-any.whl"
      )
    ).toBe(false)
    expect(leftOut(["logs", "!logs/keep.log"], "logs/a.log")).toBe(true)
    expect(leftOut(["logs", "!logs/keep.log"], "logs/keep.log")).toBe(false)
  })

  test("a pattern names a path from the root: a leading slash changes nothing, a plain name matches only at the top, and * stops at a slash", () => {
    expect(leftOut(["/top-only.txt"], "top-only.txt")).toBe(true)
    expect(leftOut(["/top-only.txt"], "lib/top-only.txt")).toBe(false)
    expect(leftOut([".env"], "app/.env")).toBe(false)
    expect(leftOut(["**/.env"], "app/.env")).toBe(true)
    expect(leftOut(["*/x"], "a/b/x")).toBe(false)
    expect(leftOut(["cache/*"], "cache")).toBe(false)
    expect(leftOut(["cache/*"], "cache/inner/d.txt")).toBe(true)
  })

  test("escapes: a backslash makes the next character itself", () => {
    expect(leftOut(["\\#hash.txt"], "#hash.txt")).toBe(true)
    expect(leftOut(["\\*"], "*")).toBe(true)
    expect(leftOut(["\\*"], "a")).toBe(false)
    expect(leftOut(["a\\?b"], "a?b")).toBe(true)
    expect(leftOut(["a\\?b"], "axb")).toBe(false)
    expect(leftOut(["\\[x]"], "[x]")).toBe(true)
  })

  test("classes zekno reads as Go does: ranges, negation, single characters, a literal ] outside a class", () => {
    expect(leftOut(["[ab]*.log"], "a.log")).toBe(true)
    expect(leftOut(["[ab]*.log"], "c.log")).toBe(false)
    expect(leftOut(["file[0-9].txt"], "file7.txt")).toBe(true)
    expect(leftOut(["file[!0-9].txt"], "file!.txt")).toBe(true)
    expect(leftOut(["file[!0-9].txt"], "filex.txt")).toBe(false)
    expect(leftOut(["x[é-ü]"], "xö")).toBe(true)
    expect(leftOut(["a]b"], "a]b")).toBe(true)
    expect(leftOut(["a]b*"], "a]bc")).toBe(true)
  })

  test("a path with a line separator inside is matched by ** as Go's regexp matches it", () => {
    expect(leftOut(["**/*.js"], "a\u2028b/c.js")).toBe(true)
    expect(leftOut(["a**/*.js"], "a\rb/c.js")).toBe(true)
  })

  test("the result of the parent is passed down as fsutil passes it: a pattern skipped at the parent is not looked for in the parent again", () => {
    const rules = rulesOf("a/b\n!a")
    // With no parent results, `!a` matches the parent of a/b, and a/b is sent.
    expect(matchPath(rules, "a/b").excluded).toBe(false)
    // As BuildKit walks: `!a` was skipped at `a`, so a/b, matched by `a/b`, stays out.
    const parent = matchPath(rules, "a")
    expect(parent.excluded).toBe(false)
    expect(matchPath(rules, "a/b", parent.info).excluded).toBe(true)
  })
})

describe("which excluded folders the walk enters, as fsutil decides", () => {
  test("with every exception a plain path, only a folder an exception starts with", () => {
    const rules = rulesOf(
      "logs\n!logs/keep.log\nbuild\n!build/keep.txt\n**/node_modules"
    )
    expect(rules.onlyPrefixExceptions).toBe(true)
    expect(entersExcluded(rules, "logs")).toBe(true)
    expect(entersExcluded(rules, "logs/deep")).toBe(false)
    expect(entersExcluded(rules, "node_modules")).toBe(false)
    expect(entersExcluded(rules, "log")).toBe(false)
  })

  test("a trailing /* or /** of an exception keeps it plain; any other wildcard in an exception enters every excluded folder", () => {
    expect(rulesOf("x\n!src/*").onlyPrefixExceptions).toBe(true)
    expect(rulesOf("x\n!src/**").onlyPrefixExceptions).toBe(true)
    const wild = rulesOf("**\n!docs/**/public-*.md")
    expect(wild.onlyPrefixExceptions).toBe(false)
    expect(entersExcluded(wild, "docs/guide")).toBe(true)
    expect(entersExcluded(wild, "other")).toBe(true)
  })

  test("with no exception, no excluded folder is entered", () => {
    const rules = rulesOf("tmp")
    expect(entersExcluded(rules, "tmp")).toBe(false)
  })
})
