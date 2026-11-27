/**
 * The secret-looking list (specs/016-build-from-source, contracts/cli.md
 * CL2, "The secret-looking list" and "Entries"; FR-015; tasks T114). Every
 * fixture is written at run time in a temporary folder: the repository's
 * `.gitignore` ignores `.env*` and `*.pem`, so a committed one would not be
 * the same on every machine. No sentence is checked: a match is checked by
 * its kind, which B7, B8, B26 and C19 choose their forms by.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  CONTENT_BYTES,
  looksLikePrivateKey,
  namedIn,
  secretLookingByName,
  secretLookingFile,
} from "../../src/pack/secret-looking"
import { seenOf } from "../../src/pack/spool"

let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "zekno-secret-")))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Writes a file in the temporary folder, its folders made first. */
function write(path: string, content: string | Uint8Array = "x"): string {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
  return full
}

/** The kind of a file written in the temporary folder, by its name and, within the bound, its content. */
function kindOf(path: string, content: string | Uint8Array = "x") {
  const full = write(path, content)
  return secretLookingFile(
    full,
    path,
    seenOf(lstatSync(full, { bigint: true }))
  )
}

describe("by name (CL2)", () => {
  test.each([
    ".env",
    ".env.local",
    ".env.production",
    "apps/web/.env",
    "apps/web/.env.development.local",
    ".npmrc",
    "packages/a/.npmrc",
    ".netrc",
    ".git-credentials",
    ".envrc",
    ".pypirc",
    ".dockercfg",
    ".docker/config.json",
    "home/.docker/config.json",
    ".aws/credentials",
    ".kube/config",
    ".ssh/known_hosts",
    ".ssh/config",
    "deploy/.ssh/authorized_keys",
  ])("%s holds secrets", (path) => {
    expect(secretLookingByName(path)).toBe("secrets")
    expect(kindOf(path)).toBe("secrets")
  })

  test.each([
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "keys/id_ed25519",
    ".ssh/id_rsa",
    "certs/client.p12",
    "certs/client.pfx",
  ])("%s is a private key", (path) => {
    expect(secretLookingByName(path)).toBe("private_key")
    expect(kindOf(path)).toBe("private_key")
  })

  test.each([
    "env",
    ".environment",
    "src/.env-example",
    "config.json",
    "docker/config.json",
    ".aws/config",
    "aws/credentials",
    "kube/config",
    "id_rsa.pub",
    "ssh/known_hosts",
    "src/p12",
    "README.md",
  ])("%s is not on the list", (path) => {
    expect(secretLookingByName(path)).toBeUndefined()
    expect(kindOf(path)).toBeUndefined()
  })

  test(".git and every path under it is the repository", () => {
    expect(secretLookingByName(".git")).toBe("git")
    expect(secretLookingByName(".git/config")).toBe("git")
    expect(secretLookingByName("vendor/lib/.git")).toBe("git")
    expect(secretLookingByName("vendor/lib/.git/HEAD")).toBe("git")
    expect(secretLookingByName(".github/workflows/ci.yml")).toBeUndefined()
  })

  test("the folders above the folder sent count: a root that is .aws, .docker, .kube, .ssh, or inside .git", () => {
    expect(secretLookingByName("credentials", "/home/ada/.aws")).toBe("secrets")
    expect(secretLookingByName("config.json", "/home/ada/.docker")).toBe(
      "secrets"
    )
    expect(secretLookingByName("config", "/home/ada/.kube")).toBe("secrets")
    expect(secretLookingByName("known_hosts", "/home/ada/.ssh")).toBe("secrets")
    expect(secretLookingByName("HEAD", "/home/ada/shop/.git")).toBe("git")
    // Only the folder a file is directly in counts for the three folder rules, as inside the folder sent.
    expect(
      secretLookingByName("credentials", "/home/ada/.aws/backup")
    ).toBeUndefined()
    expect(secretLookingByName("credentials", "/home/ada/shop")).toBeUndefined()
  })
})

describe("by content, in a file of at most 64 KiB (CL2)", () => {
  test.each([
    "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n",
    "-----BEGIN EC PRIVATE KEY-----\n",
    "-----BEGIN OPENSSH PRIVATE KEY-----\n",
    "-----BEGIN ENCRYPTED PRIVATE KEY-----\n",
    "some text first\n-----BEGIN DSA PRIVATE KEY-----\n",
    "-----BEGIN PGP PRIVATE KEY BLOCK-----\n\nlQOYBF\n",
    "PuTTY-User-Key-File-2: ssh-rsa\nEncryption: none\n",
    "PuTTY-User-Key-File-3: ssh-ed25519\n",
  ])("a private key: %p", (content) => {
    expect(looksLikePrivateKey(new TextEncoder().encode(content))).toBe(true)
    expect(kindOf("certs/server.key", content)).toBe("private_key")
  })

  test.each([
    "-----BEGIN CERTIFICATE-----\nMIIE\n",
    "-----BEGIN PUBLIC KEY-----\n",
    "-----BEGIN PGP PUBLIC KEY BLOCK-----\n",
    "-----BEGIN PRIVATE\nKEY-----\n",
    "a note that says PuTTY-User-Key-File- in the middle\n",
    "-----begin private key-----\n",
  ])("not a private key: %p", (content) => {
    expect(looksLikePrivateKey(new TextEncoder().encode(content))).toBe(false)
    expect(kindOf("notes/key.txt", content)).toBeUndefined()
  })

  test("a file named as one that holds secrets, whose content is a private key, is a private key", () => {
    expect(kindOf(".ssh/deploy", "-----BEGIN OPENSSH PRIVATE KEY-----\n")).toBe(
      "private_key"
    )
  })

  test("a file of exactly 64 KiB is read for content", () => {
    const content = new Uint8Array(CONTENT_BYTES).fill(0x20)
    content.set(new TextEncoder().encode("-----BEGIN PRIVATE KEY-----"), 100)
    expect(kindOf("big.key", content)).toBe("private_key")
  })

  test("a file of 65 KiB is not read for content", () => {
    const content = new Uint8Array(65 * 1024).fill(0x20)
    content.set(new TextEncoder().encode("-----BEGIN PRIVATE KEY-----"), 0)
    expect(kindOf("big.key", content)).toBeUndefined()
    // By name it still counts.
    expect(kindOf("id_rsa", content)).toBe("private_key")
  })

  test("an empty file is not read", () => {
    expect(kindOf("empty.key", "")).toBeUndefined()
  })
})

describe("named in source.include (CL2, CL5)", () => {
  test("a path is named by an entry that is the path or a folder above it", () => {
    expect(namedIn(".git/config", [".git/config"])).toBe(".git/config")
    expect(namedIn(".git/config", [".git"])).toBe(".git")
    expect(namedIn("certs/server.key", ["certs"])).toBe("certs")
    expect(namedIn("certs/server.key", ["cert"])).toBeUndefined()
    expect(namedIn(".gitignore", [".git"])).toBeUndefined()
    expect(namedIn("certs", ["certs/server.key"])).toBeUndefined()
  })

  test(".git/config named in include is secret-looking, as the repository", () => {
    expect(secretLookingByName(".git/config")).toBe("git")
    expect(namedIn(".git/config", [".git/config"])).toBe(".git/config")
  })
})
