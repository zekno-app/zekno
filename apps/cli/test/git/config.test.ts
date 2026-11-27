/**
 * The repository's `config`, read as plain lines (specs/016-build-from-source,
 * contracts/cli.md CL4 step 2; tasks T106): the reader gives up when it sets
 * `extensions.objectFormat`, `extensions.refStorage` or `core.bare = true`,
 * in any of the forms git reads them, and when the file is past its bound.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CONFIG_BYTES, configFrom, readConfig } from "../../src/git/config"

describe("configFrom", () => {
  test("gives up on each setting CL4 names, in each form git reads it", () => {
    for (const text of [
      "[core]\n\tbare = true\n",
      "[core]\nbare\n",
      "[CORE]\n\tBare = Yes\n",
      "[core] bare = on\n",
      "[core]\n\tbare = 1\n",
      '[core]\n\tbare = "true"\n',
      "[core]\n\tbare=true ; a comment\n",
      "[core]\n\tbare = maybe\n",
      "[extensions]\n\tobjectformat = sha256\n",
      "[Extensions]\n\tObjectFormat=sha1\n",
      "[extensions] objectFormat = sha256\n",
      "[extensions]\n\trefstorage = reftable\n",
      "[extensions]\n\trefStorage\n",
      "[core]\n\trepositoryformatversion = 2\n",
    ])
      expect(configFrom(text)).toBeUndefined()
  })

  test("reads what does not set them: false values, other sections, comments, subsections", () => {
    for (const text of [
      "",
      "[core]\n\tbare = false\n",
      "[core]\n\tbare = no\n\tbare = off\n\tbare = 0\n",
      "# [core] bare = true\n; [extensions] objectformat = sha256\n",
      '[core "sub"]\n\tbare = true\n',
      "[core.sub]\n\tbare = true\n",
      '[extensions "x"]\n\tobjectformat = sha256\n',
      '[remote "origin"]\n\turl = https://example.com/a.git\n',
      "[core]\n\tbareish = true\n\tworktreeconfig = true\n",
      "[core]\n\trepositoryformatversion = 1\n",
    ])
      expect(configFrom(text)).toEqual({ fileMode: true })
  })

  test("a text git calls a bad config gives up: an open header, an open quote, an unknown escape, a key before any section", () => {
    for (const text of [
      "[core\n",
      "[]\n",
      '[core "sub\n',
      '[core]\n\tname = "open\n',
      "[core]\n\tname = a\\qb\n",
      "bare = false\n",
      "[core]\n\t1bare = false\n",
      "[core]\n\tbare false\n",
    ])
      expect(configFrom(text)).toBeUndefined()
    // A value joined over two lines by `\` is one value, and a byte order mark at the start is skipped.
    expect(configFrom("[core]\n\tname = a\\\n b\n\tbare = false\n")).toEqual({
      fileMode: true,
    })
    expect(configFrom("\xef\xbb\xbf[core]\n\tbare = true\n")).toBeUndefined()
  })

  test("a later false does not undo an earlier true: any true gives up", () => {
    expect(
      configFrom("[core]\n\tbare = true\n\tbare = false\n")
    ).toBeUndefined()
  })

  test("core.fileMode is read, true unless set false", () => {
    expect(configFrom("[core]\n\tfilemode = false\n")).toEqual({
      fileMode: false,
    })
    expect(configFrom("[core]\n\tfileMode = true\n")).toEqual({
      fileMode: true,
    })
    expect(configFrom("[core]\n\tfilemode = off\n\tfilemode = yes\n")).toEqual({
      fileMode: true,
    })
  })
})

describe("readConfig", () => {
  let root: string
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "zekno-git-config-")))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test(`reads a config of at most ${CONFIG_BYTES} bytes, gives up past it, and reads a missing config as git's defaults`, () => {
    expect(readConfig(root)).toEqual({ fileMode: true })
    const line = "[core]\n\tbare = false\n"
    writeFileSync(
      join(root, "config"),
      line + "#".repeat(CONFIG_BYTES - line.length)
    )
    expect(readConfig(root)).toEqual({ fileMode: true })
    writeFileSync(
      join(root, "config"),
      line + "#".repeat(CONFIG_BYTES - line.length + 1)
    )
    expect(readConfig(root)).toBeUndefined()
  })

  test("a config git would call bad, or one that is not a file, gives up", () => {
    writeFileSync(join(root, "config"), Buffer.from([0x5b, 0xff, 0x5d]))
    expect(readConfig(root)).toBeUndefined()
    rmSync(join(root, "config"))
    expect(Bun.spawnSync(["mkfifo", join(root, "config")]).exitCode).toBe(0)
    expect(readConfig(root)).toBeUndefined()
  })
})
