/**
 * The names a build is never given, and the `# syntax=` line
 * (specs/016-build-from-source, contracts/core.md CO6; FR-025, FR-036,
 * FR-036b, FR-037b). zekno's summary and reader and the runner use these same
 * functions, so zekno never signs a name or a line the runner refuses.
 */
import { describe, expect, test } from "bun:test"

import {
  isCredentialName,
  isNeverGivenArg,
  isSyntaxLine,
  SYNTAX_LINE,
} from "../../src/deploy/build-names"

const BUILDERS = ["dockerfile", "railpack"] as const

/** Today's reserved names: one of each exact name, prefix and suffix. */
const RESERVED = [
  "PATH",
  "HOME",
  "TMPDIR",
  "XDG_RUNTIME_DIR",
  "GODEBUG",
  "DOCKER_HOST",
  "COMPOSE_PROJECT_NAME",
  "BUILDKIT_SYNTAX",
  "BUILDX_BUILDER",
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
  "SSL_CERT_FILE",
  "HTTP_PROXY",
  "NO_PROXY",
]

/** The names the builder reads as its own. */
const BUILDER_OWN = [
  "SOURCE_DATE_EPOCH",
  "TARGETPLATFORM",
  "TARGETOS",
  "TARGETARCH",
  "TARGETVARIANT",
  "BUILDPLATFORM",
  "BUILDOS",
  "BUILDARCH",
  "BUILDVARIANT",
]

/** The credential names: never a build secret, never a Railpack build's argument. */
const CREDENTIALS = [
  "GIT_AUTH_TOKEN",
  "GIT_AUTH_HEADER",
  "HTTP_AUTH_TOKEN_github.com",
  "HTTP_AUTH_TOKEN_GITHUB_COM",
  "HTTP_AUTH_HEADER_GITHUB_COM",
  "HTTP_AUTH_TOKEN_",
]

/** Names close to the ones above that stay allowed. */
const NEAR = [
  "TARGETARCHS",
  "HTTP_AUTH_TOKEN",
  "HTTP_AUTH_HEADER",
  "MY_PATH",
  "PATHS",
  "MY_TARGETOS",
  "SOURCE_DATE",
  "GIT_AUTH_TOKENS",
  "MY_GIT_AUTH_TOKEN",
  "PROXY",
  "NODE_ENV",
  "API_URL",
]

/** Every letter's case flipped in turn, starting with upper. */
const mixed = (name: string) =>
  [...name]
    .map((letter, index) =>
      index % 2 === 0 ? letter.toUpperCase() : letter.toLowerCase()
    )
    .join("")

const cases = (name: string) => [
  name.toUpperCase(),
  name.toLowerCase(),
  mixed(name),
  mixed(name.toLowerCase()).replace(/^./, (first) => first.toLowerCase()),
]

describe("the names a build is never given (CO6)", () => {
  test("today's reserved names, in any case, for both builders", () => {
    const wrong: string[] = []
    for (const name of RESERVED)
      for (const spelled of cases(name))
        for (const builder of BUILDERS)
          if (!isNeverGivenArg(spelled, builder))
            wrong.push(`${builder} ${spelled}`)
    expect(wrong).toEqual([])
  })

  test("the names the builder reads as its own, in any case, for both builders", () => {
    const wrong: string[] = []
    for (const name of BUILDER_OWN)
      for (const spelled of cases(name))
        for (const builder of BUILDERS)
          if (!isNeverGivenArg(spelled, builder))
            wrong.push(`${builder} ${spelled}`)
    expect(wrong).toEqual([])
  })

  test("credential names, in any case: never a Railpack build's argument, allowed as a Dockerfile build's", () => {
    const wrong: string[] = []
    for (const name of CREDENTIALS)
      for (const spelled of cases(name)) {
        if (!isCredentialName(spelled)) wrong.push(`credential ${spelled}`)
        if (!isNeverGivenArg(spelled, "railpack"))
          wrong.push(`railpack ${spelled}`)
        if (isNeverGivenArg(spelled, "dockerfile"))
          wrong.push(`dockerfile ${spelled}`)
      }
    expect(wrong).toEqual([])
    expect(isNeverGivenArg("GIT_AUTH_TOKEN", "dockerfile")).toBe(false)
    expect(isNeverGivenArg("GIT_AUTH_TOKEN", "railpack")).toBe(true)
  })

  test("only the credential names are credential names", () => {
    for (const name of [...RESERVED, ...BUILDER_OWN, ...NEAR])
      for (const spelled of cases(name))
        expect([spelled, isCredentialName(spelled)]).toEqual([spelled, false])
  })

  test("near names stay allowed, in any case, for both builders", () => {
    const wrong: string[] = []
    for (const name of NEAR)
      for (const spelled of cases(name))
        for (const builder of BUILDERS)
          if (isNeverGivenArg(spelled, builder))
            wrong.push(`${builder} ${spelled}`)
    expect(wrong).toEqual([])
  })

  test("Railpack's own arguments hold a hyphen, which no variable name can", () => {
    for (const name of ["cache-key", "secrets-hash"])
      expect(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)).toBe(false)
  })
})

describe("the # syntax= line (CO6, FR-025)", () => {
  test("the pattern is the contract's, with no global flag to carry a position", () => {
    expect(SYNTAX_LINE.source).toBe("^\\s*#\\s*syntax\\s*=")
    expect(SYNTAX_LINE.flags).toBe("i")
  })

  test("a syntax line, however it is spaced or spelled", () => {
    for (const line of [
      "# syntax=docker/dockerfile:1",
      "#syntax=x",
      "  #  SYNTAX = x",
      "\t# syntax=x",
      "#\tsyntax\t=x",
      "﻿# syntax=docker/dockerfile:1",
      "﻿#syntax=x",
      "# Syntax=x\r",
    ])
      expect([line, isSyntaxLine(line)]).toEqual([line, true])
  })

  test("lines that are not one", () => {
    for (const line of [
      "# syntaxes=x",
      "# check=x",
      "## syntax=x",
      "RUN echo # syntax=x",
      "# escape=`",
      "# syntax",
      "# the syntax=x",
      "FROM node:22",
      "",
    ])
      expect([line, isSyntaxLine(line)]).toEqual([line, false])
  })

  test("found in a Dockerfile split on \\n, with \\n or \\r\\n line ends, before and after its first instruction", () => {
    const before = [
      "# syntax=docker/dockerfile:1",
      "FROM node:22",
      "RUN npm ci",
    ]
    const after = [
      "# a comment",
      "FROM node:22",
      "  # SYNTAX = docker/dockerfile:1.7",
      "RUN npm ci",
    ]
    const none = ["# check=skip=all", "FROM node:22", "RUN echo # syntax=x"]
    for (const end of ["\n", "\r\n"]) {
      const lines = (text: string[]) => text.join(end).split("\n")
      expect(lines(before).some(isSyntaxLine)).toBe(true)
      expect(lines(after).some(isSyntaxLine)).toBe(true)
      expect(lines(none).some(isSyntaxLine)).toBe(false)
      expect(lines(after).findIndex(isSyntaxLine)).toBe(2)
    }
  })
})
