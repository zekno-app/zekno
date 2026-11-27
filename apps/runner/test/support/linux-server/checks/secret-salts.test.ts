/**
 * `secret-salts.ts` (specs/016-build-from-source, T017; plan item 12),
 * branch by branch: the five builds, the Dockerfile and what its step
 * writes, which build's step each image holds, and the record's words,
 * with the end item 12 asks for when two salts share a step. Pure; the
 * step's shell line is run here by `sh` against a temporary folder.
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  GOES_BACK,
  RAN_FILE,
  ranWordOf,
  SALT_BUILDS,
  saltDockerfile,
  saltsShared,
  type SaltSeen,
  saltWords,
  SECRET_NAME,
  stepOrigins,
} from "./secret-salts"

const BASE = `busybox@sha256:${"ab".repeat(32)}`
const TOKEN = "0123456789abcdef0123456789abcdef"
const uuid = (n: number) => `0000000${n}-0000-4000-8000-000000000000`
const ran = (n: number, secret = true): SaltSeen => ({
  built: true,
  word: { id: uuid(n), secret },
})

describe("the builds", () => {
  test("are the task's five, in its order", () => {
    expect(
      SALT_BUILDS.map((build) => [
        build.app,
        build.value ?? "-",
        build.salt ?? "-",
      ])
    ).toEqual([
      ["a", 1, "A"],
      ["a", 2, "B"],
      ["a", "-", "-"],
      ["b", 1, "C"],
      ["a", 1, "A"],
    ])
    expect(SECRET_NAME).toBe("NPM_TOKEN")
  })
})

describe("the Dockerfile", () => {
  test("mounts NPM_TOKEN and writes a new word, with or without the secret", () => {
    const text = saltDockerfile(BASE, TOKEN)
    const lines = text.split("\n")
    expect(lines[0]).toBe(`FROM ${BASE}`)
    expect(lines[1]).toStartWith(
      `RUN --mount=type=secret,id=NPM_TOKEN : ${TOKEN} && `
    )
    expect(lines[1]).toEndWith(`> ${RAN_FILE}`)
    expect(text).toEndWith("\n")
  })

  test("its step's shell line writes a word ranWordOf reads, new each run", () => {
    const folder = mkdtempSync(join(tmpdir(), "zekno-salts-"))
    try {
      const line = saltDockerfile(BASE, TOKEN)
        .split("\n")[1]!
        .replace(/^RUN --mount=\S+ /, "")
        .replaceAll("/run/secrets/", `${folder}/`)
        .replace(RAN_FILE, join(folder, "ran"))
      // This machine may have no /proc: a UUID made here stands in for the kernel's.
      const runIt = () => {
        const local = line.replace(
          "$(cat /proc/sys/kernel/random/uuid)",
          crypto.randomUUID()
        )
        expect(Bun.spawnSync(["sh", "-c", local]).exitCode).toBe(0)
        return ranWordOf(readFileSync(join(folder, "ran"), "utf8"))
      }
      const without = runIt()
      expect(without?.secret).toBe(false)
      Bun.spawnSync(["sh", "-c", `printf marker > ${folder}/${SECRET_NAME}`])
      const withSecret = runIt()
      expect(withSecret?.secret).toBe(true)
      expect(withSecret?.id).not.toBe(without?.id)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  test("refuses a base not by digest, and a token not the run's", () => {
    expect(() => saltDockerfile("busybox:1.36.1", TOKEN)).toThrow(
      "not an image by digest"
    )
    expect(() => saltDockerfile(BASE, "x")).toThrow("32 hex")
  })
})

describe("reading the word", () => {
  test("a UUID and with or without", () => {
    expect(ranWordOf(`${uuid(1)} with\n`)).toEqual({
      id: uuid(1),
      secret: true,
    })
    expect(ranWordOf(`${uuid(2)} without`)).toEqual({
      id: uuid(2),
      secret: false,
    })
    for (const text of [
      "",
      "x with",
      `${uuid(1)}`,
      `${uuid(1)} maybe`,
      `${uuid(1)} with extra`,
    ])
      expect(ranWordOf(text)).toBeUndefined()
  })
})

describe("which step each build used", () => {
  test("its own when it ran, an earlier one when cached, none without a word", () => {
    expect(
      stepOrigins([
        ran(1),
        ran(1),
        { built: false, why: "x" },
        { built: true, why: "unread" },
        ran(5),
      ])
    ).toEqual([0, 0, undefined, undefined, 4])
  })

  test("two salts share the step when a build reuses one of another salt, or of none", () => {
    expect(
      saltsShared(SALT_BUILDS, [ran(1), ran(2), ran(3), ran(4), ran(1)])
    ).toBe(false)
    expect(
      saltsShared(SALT_BUILDS, [ran(1), ran(1), ran(3), ran(4), ran(1)])
    ).toBe(true)
    expect(
      saltsShared(SALT_BUILDS, [ran(1), ran(2), ran(2, true), ran(4), ran(5)])
    ).toBe(true)
    expect(
      saltsShared(SALT_BUILDS, [ran(1), ran(2), ran(3), ran(1), ran(1)])
    ).toBe(true)
    expect(
      saltsShared(SALT_BUILDS, [ran(1), ran(2), ran(3), ran(4), ran(2)])
    ).toBe(true)
  })
})

describe("the record's words", () => {
  test("each build ran, and the last reused the first: no end", () => {
    const words = saltWords(SALT_BUILDS, [
      ran(1),
      ran(2),
      ran(3, false),
      ran(4),
      ran(1),
    ])
    expect(words).toBe(
      [
        "1. app a, value 1, salt A: ran (the secret mounted)",
        "2. app a, value 2, salt B: ran (the secret mounted)",
        "3. app a, no secret, no salt: ran (no secret mounted)",
        "4. app b, the same secret name, salt C: ran (the secret mounted)",
        "5. app a, value 1, salt A again: cached, the step of build 1 (the secret mounted)",
      ].join("; ")
    )
    expect(words).not.toContain(GOES_BACK)
  })

  test("a step shared by two salts ends the line with item 12", () => {
    const words = saltWords(SALT_BUILDS, [
      ran(1),
      ran(1),
      ran(1),
      ran(1),
      ran(1),
    ])
    expect(words).toContain(
      "2. app a, value 2, salt B: cached, the step of build 1"
    )
    expect(words).toEndWith(`; ${GOES_BACK}`)
  })

  test("a build that failed, or whose word was not read, says so", () => {
    const words = saltWords(SALT_BUILDS, [
      { built: false, why: "the step failed" },
      { built: true, why: "docker run failed" },
      { built: true },
      ran(4),
      ran(5),
    ])
    expect(words).toContain(
      "1. app a, value 1, salt A: not built: the step failed"
    )
    expect(words).toContain(
      "2. app a, value 2, salt B: built, its word not read: docker run failed"
    )
    expect(words).toContain(
      "3. app a, no secret, no salt: built, its word not read: no word"
    )
  })

  test("a result is given for each build", () => {
    expect(() => saltWords(SALT_BUILDS, [ran(1)])).toThrow("for each build")
  })
})
