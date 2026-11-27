/**
 * `secret-checks.ts` (specs/016-build-from-source, T018), branch by
 * branch: each Dockerfile of L12, L13, L14 and L16 holds a hash and never a
 * value; each step's shell line is run here by `sh` against a temporary
 * folder, and prints the word the check reads. Nothing here runs Docker.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { newMarker, sha256Hex } from "../build-runs/marker-search"
import {
  CACHE_FILE,
  CACHE_ID,
  CACHE_TARGET,
  cacheReadDockerfile,
  cacheReadWords,
  cacheWriteDockerfile,
  DIFFERED,
  EARLIER,
  EMPTY,
  gitAddDockerfile,
  MATCHED,
  OTHER,
  readingDockerfile,
  readWords,
  syntaxDockerfile,
} from "./secret-checks"

const BASE = `busybox@sha256:${"ab".repeat(32)}`
const TOKEN = "0123456789abcdef0123456789abcdef"
const VALUE = newMarker("zekno-l12")
const SHA = sha256Hex(VALUE)
const FRONTEND = "127.0.0.1:5000/check/secret-frontend:1"

/** Runs a step's shell line here, its /run/secrets and cache folder moved into `folder`. */
function runStep(line: string, folder: string): string {
  const local = line
    .replace(/^RUN (?:--mount=\S+ )+/, "")
    .replaceAll("/run/secrets/", `${folder}/secrets/`)
    .replaceAll(CACHE_TARGET, `${folder}/cache`)
  const done = Bun.spawnSync(["sh", "-c", local])
  return done.stdout.toString()
}

function withFolder(body: (folder: string) => void) {
  const folder = mkdtempSync(join(tmpdir(), "zekno-secret-checks-"))
  try {
    mkdirSync(join(folder, "secrets"))
    mkdirSync(join(folder, "cache"))
    body(folder)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

describe("L12 and L14: the reading step", () => {
  test("holds the hash, never the value, and prints only whether it matched", () => {
    const text = readingDockerfile(BASE, "NPM_TOKEN", SHA, TOKEN)
    expect(text).not.toContain(VALUE)
    expect(text).toContain(SHA)
    const line = text.split("\n")[1]!
    expect(line).toStartWith(
      `RUN --mount=type=secret,id=NPM_TOKEN : ${TOKEN} && `
    )
    withFolder((folder) => {
      expect(runStep(line, folder)).toBe(`${DIFFERED}\n`)
      writeFileSync(join(folder, "secrets", "NPM_TOKEN"), VALUE)
      const printed = runStep(line, folder)
      expect(printed).toBe(`${MATCHED}\n`)
      expect(printed).not.toContain(VALUE)
      writeFileSync(join(folder, "secrets", "NPM_TOKEN"), "another")
      expect(runStep(line, folder)).toBe(`${DIFFERED}\n`)
    })
  })

  test("its words", () => {
    expect(readWords(`x\n${MATCHED}\n`)).toBe(
      "a step read the secret, its value as given"
    )
    expect(readWords(`${DIFFERED}\n`)).toBe(
      "a step ran and did not read the value given"
    )
    expect(readWords("")).toBe("the step's output was not seen")
  })

  test("refuses what does not fit: a base not by digest, a name, a hash, a token", () => {
    expect(() => readingDockerfile("busybox", "NPM_TOKEN", SHA, TOKEN)).toThrow(
      "the base"
    )
    expect(() => readingDockerfile(BASE, "NPM-TOKEN", SHA, TOKEN)).toThrow(
      "the secret"
    )
    expect(() => readingDockerfile(BASE, "NPM_TOKEN", VALUE, TOKEN)).toThrow(
      "the hash"
    )
    expect(() => readingDockerfile(BASE, "NPM_TOKEN", SHA, "x")).toThrow(
      "the run's token"
    )
  })
})

describe("L13: the # syntax= line in a build with a secret", () => {
  test("names the check registry's frontend first, and the step mounts the secret", () => {
    expect(syntaxDockerfile(FRONTEND, BASE, "NPM_TOKEN", TOKEN)).toBe(
      `# syntax=${FRONTEND}\nFROM ${BASE}\nRUN --mount=type=secret,id=NPM_TOKEN : ${TOKEN}\n`
    )
  })

  test("refuses a frontend outside the check's registry", () => {
    for (const frontend of [
      "docker/dockerfile:1",
      "127.0.0.1:5001/x:1",
      `${FRONTEND}\nRUN x`,
    ])
      expect(() =>
        syntaxDockerfile(frontend, BASE, "NPM_TOKEN", TOKEN)
      ).toThrow("the frontend")
  })
})

describe("L14: the ADD of a git address", () => {
  test("on the stand-in's listener only", () => {
    expect(
      gitAddDockerfile(BASE, "http://127.0.0.1:9480/zekno-check-0123.git")
    ).toBe(
      `FROM ${BASE}\nADD http://127.0.0.1:9480/zekno-check-0123.git /zekno-check-git\n`
    )
    for (const url of [
      "https://127.0.0.1:9480/x.git",
      "http://example.com/x.git",
      "http://127.0.0.1:9480/x",
      "http://127.0.0.1:9480/x.git /etc",
    ])
      expect(() => gitAddDockerfile(BASE, url)).toThrow("the git address")
  })
})

describe("L16: a cache folder written with the secret, read with none", () => {
  test("the first step copies the secret into the app's cache folder; the second reads it back by its hash", () => {
    const write = cacheWriteDockerfile(BASE, "NPM_TOKEN", TOKEN)
    const read = cacheReadDockerfile(BASE, SHA, TOKEN)
    expect(write).not.toContain(VALUE)
    expect(read).not.toContain(VALUE)
    expect(write).toContain(
      `--mount=type=cache,target=${CACHE_TARGET},id=${CACHE_ID}`
    )
    expect(read).toContain(
      `RUN --mount=type=cache,target=${CACHE_TARGET},id=${CACHE_ID} : ${TOKEN}`
    )
    expect(read).not.toContain("type=secret")
    expect(CACHE_FILE).toBe(`${CACHE_TARGET}/earlier`)
    withFolder((folder) => {
      const readLine = read.split("\n")[1]!
      expect(runStep(readLine, folder)).toBe(`${EMPTY}\n`)
      writeFileSync(join(folder, "secrets", "NPM_TOKEN"), VALUE)
      runStep(write.split("\n")[1]!, folder)
      expect(runStep(readLine, folder)).toBe(`${EARLIER}\n`)
      writeFileSync(join(folder, "cache", "earlier"), "something else")
      expect(runStep(readLine, folder)).toBe(`${OTHER}\n`)
    })
  })

  test("its words", () => {
    expect(cacheReadWords(`${EARLIER}\n`)).toBe("it read the earlier contents")
    expect(cacheReadWords(`${OTHER}\n`)).toBe(
      "the cache folder held other contents"
    )
    expect(cacheReadWords(`${EMPTY}\n`)).toBe("the cache folder was empty")
    expect(cacheReadWords("")).toBe("the step's output was not seen")
  })

  test("refuses a name, a hash or a token that does not fit", () => {
    expect(() => cacheWriteDockerfile(BASE, "a b", TOKEN)).toThrow("the secret")
    expect(() => cacheWriteDockerfile(BASE, "NPM_TOKEN", "x")).toThrow(
      "the run's token"
    )
    expect(() => cacheReadDockerfile(BASE, "x", TOKEN)).toThrow("the hash")
    expect(() => cacheReadDockerfile(BASE, SHA, "x")).toThrow("the run's token")
  })
})
