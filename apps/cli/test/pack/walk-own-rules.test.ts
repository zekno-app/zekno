/**
 * Pass 1: zekno's own rules (specs/016-build-from-source, contracts/cli.md
 * CL2, "The root" and "Entries"; FR-015; tasks T116): zekno's own folder is
 * never sent, `.git` and secret-looking files are left out unless
 * `source.include` names them and the person agreed on this machine. Split
 * from walk.test.ts by subject. Every fixture is written at run time: the
 * repository's `.gitignore` ignores `.env*`, and it cannot hold a nested
 * `.git`. No sentence is checked.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { readIgnoreFile } from "../../src/pack/ignore"
import { walkFolder, type Walk, type WalkOptions } from "../../src/pack/walk"

let root: string
let elsewhere: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "zekno-walk-")))
  elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "zekno-walk-out-")))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(elsewhere, { recursive: true, force: true })
})

/** Writes a file under the root, its folders made first. */
function write(path: string, content: string | Uint8Array = "x"): string {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
  return full
}

/** The walk of the root with its ignore file read as a deploy reads it. */
function walk(options: Partial<WalkOptions> = {}): Walk {
  const dockerfile =
    options.dockerfile === undefined ? "Dockerfile" : options.dockerfile
  return walkFolder(root, {
    dockerfile,
    ignore:
      options.ignore ??
      readIgnoreFile(
        root,
        dockerfile === null
          ? { builder: "railpack" }
          : { builder: "dockerfile", dockerfile }
      ),
    include: options.include ?? [],
    agreed: options.agreed ?? (() => false),
    zeknoHome: options.zeknoHome ?? join(elsewhere, "zekno-home"),
  })
}

const names = (found: Walk) => found.entries.map((entry) => entry.name)

describe("zekno's own rules (CL2, FR-015)", () => {
  test("zekno's own folder inside the root is never sent, whatever the rules say", () => {
    write("Dockerfile")
    write(".dockerignore", "*\n!Dockerfile\n!.zekno\n!.zekno/**\n")
    write(".zekno/keys.json", "{}")
    write(".zekno/tmp/x/piece", "sealed")
    const found = walk({ zeknoHome: join(root, ".zekno") })
    // `*` lists the ignore file too, which is sent all the same.
    expect(names(found)).toEqual([".dockerignore", "Dockerfile"])
    expect(found.leftOut).toContainEqual({
      rule: "zekno",
      path: ".zekno",
      why: "zekno_home",
    })
    expect(found.entries.some((entry) => entry.name.startsWith(".zekno"))).toBe(
      false
    )
  })

  test("zekno's own folder is found through the link ZEKNO_HOME may be", () => {
    write("Dockerfile")
    write("state/keys.json", "{}")
    symlinkSync(join(root, "state"), join(elsewhere, "home-link"))
    const found = walk({ zeknoHome: join(elsewhere, "home-link") })
    expect(names(found)).toEqual(["Dockerfile"])
    expect(found.leftOut).toEqual([
      { rule: "zekno", path: "state", why: "zekno_home" },
    ])
  })

  test(".git at any depth is left out unless source.include names it", () => {
    write("Dockerfile")
    write(".git/config", "[core]\n")
    write(".git/HEAD", "ref: refs/heads/main\n")
    write("vendor/lib/.git", "gitdir: ../../.git/modules/lib\n")
    write("vendor/lib/a.ts")
    const found = walk()
    expect(names(found)).toEqual([
      "Dockerfile",
      "vendor/",
      "vendor/lib/",
      "vendor/lib/a.ts",
    ])
    expect(found.leftOut).toEqual([
      { rule: "zekno", path: ".git", why: "git" },
      { rule: "zekno", path: "vendor/lib/.git", why: "git" },
    ])
  })

  test(".git named in include is secret-looking: left out until agreed, then sent whole", () => {
    write("Dockerfile")
    write(".git/config", "[core]\n")
    write(".git/refs/heads/main", "0000\n")
    const unagreed = walk({ include: [".git"] })
    expect(names(unagreed)).toEqual(["Dockerfile"])
    expect(unagreed.leftOut).toEqual([
      { rule: "secret_looking", path: ".git", kind: "git", named: ".git" },
    ])
    expect(unagreed.unagreed).toEqual([
      { path: ".git", kind: "git", named: ".git" },
    ])

    const agreed = walk({
      include: [".git"],
      agreed: (path) => path === ".git",
    })
    expect(names(agreed)).toEqual([
      ".git/",
      ".git/config",
      ".git/refs/",
      ".git/refs/heads/",
      ".git/refs/heads/main",
      "Dockerfile",
    ])
    expect(agreed.secretsSent).toEqual([
      { path: ".git", kind: "git", named: ".git" },
    ])
    expect(agreed.unagreed).toEqual([])
  })

  test(".git/config named in include: only it is sent once agreed, by its own entry", () => {
    write("Dockerfile")
    write(".git/config", "[core]\n")
    write(".git/HEAD", "ref: refs/heads/main\n")
    const unagreed = walk({ include: [".git/config"] })
    expect(names(unagreed)).toEqual(["Dockerfile"])
    expect(unagreed.unagreed).toEqual([
      { path: ".git/config", kind: "git", named: ".git/config" },
    ])
    const agreed = walk({
      include: [".git/config"],
      agreed: (path) => path === ".git/config",
    })
    expect(names(agreed)).toEqual([".git/", ".git/config", "Dockerfile"])
    expect(agreed.leftOut).toEqual([
      { rule: "zekno", path: ".git/HEAD", why: "git" },
    ])
  })

  test("a secret-looking file is left out, unless named and agreed to by its own path", () => {
    write("Dockerfile")
    write(".env", "TOKEN=1\n")
    write(".env.local", "TOKEN=2\n")
    write("certs/server.key", "-----BEGIN PRIVATE KEY-----\n")
    write("certs/readme.txt", "certificates\n")
    const found = walk({ include: ["certs"] })
    expect(names(found)).toEqual(["Dockerfile", "certs/", "certs/readme.txt"])
    expect(found.leftOut).toEqual([
      { rule: "secret_looking", path: ".env", kind: "secrets", named: null },
      {
        rule: "secret_looking",
        path: ".env.local",
        kind: "secrets",
        named: null,
      },
      {
        rule: "secret_looking",
        path: "certs/server.key",
        kind: "private_key",
        named: "certs",
      },
    ])
    expect(found.unagreed).toEqual([
      { path: "certs/server.key", kind: "private_key", named: "certs" },
    ])

    const agreed = walk({
      include: ["certs"],
      agreed: (path) => path === "certs/server.key",
    })
    expect(names(agreed)).toContain("certs/server.key")
    expect(agreed.secretsSent).toEqual([
      { path: "certs/server.key", kind: "private_key", named: "certs" },
    ])
  })

  test("the folders of the list count above the folder sent: a root that is .aws, .docker, .kube, .ssh or in .git sends none of their files", () => {
    // A settings file of someone else's can make the folder sent one of these, inside a home kept in git (CL2).
    const cases: [string, string][] = [
      [".aws", "credentials"],
      [".docker", "config.json"],
      [".kube", "config"],
      [".ssh", "known_hosts"],
      [".git", "config"],
    ]
    for (const [folder, file] of cases) {
      const sent = join(root, "home", folder)
      write(`home/${folder}/Dockerfile`)
      write(`home/${folder}/${file}`, "token = 1\n")
      const found = walkFolder(sent, {
        dockerfile: "Dockerfile",
        ignore: readIgnoreFile(sent, {
          builder: "dockerfile",
          dockerfile: "Dockerfile",
        }),
        include: [],
        agreed: () => false,
        zeknoHome: join(elsewhere, "zekno-home"),
      })
      expect({ folder, names: names(found) }).toEqual({
        folder,
        names: ["Dockerfile"],
      })
      expect(found.leftOut).toEqual([
        {
          rule: "secret_looking",
          path: file,
          kind: folder === ".git" ? "git" : "secrets",
          named: null,
        },
      ])
    }
  })

  test("a secret-looking name that can never be sent is not asked about: it stays left out, cleaned", () => {
    write("Dockerfile")
    // OSC 52 and a clear screen in the name: agreeing to it would only stop the deploy with C7 (CL2, "Names").
    const hostile = ".env.\u001b]52;c;aGVsbG8=\u0007\u001b[2J"
    write(`config/${hostile}`, "TOKEN=1\n")
    write("config/app.json", "{}")
    const found = walk({ include: ["config"] })
    expect(found.unagreed).toEqual([])
    expect(found.leftOut).toEqual([
      {
        rule: "secret_looking",
        path: "config/.env.?]52;c;aGVsbG8=??[2J",
        kind: "secrets",
        named: "config",
      },
    ])
    expect(names(found)).toEqual(["Dockerfile", "config/", "config/app.json"])
  })

  test("a secret-looking file the ignore file lists is left out by the ignore file", () => {
    write("Dockerfile")
    write(".dockerignore", ".env\n")
    write(".env", "TOKEN=1\n")
    expect(walk().leftOut).toEqual([
      { rule: "ignore_file", path: ".env", folder: false },
    ])
  })
})
