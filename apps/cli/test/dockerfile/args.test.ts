/**
 * The names a Dockerfile declares with `ARG` (specs/016-build-from-source,
 * contracts/cli.md CL3, "The build's plain variables"; data-model.md, "Build
 * variables"; FR-036a, FR-036b; tasks T121): before the first `FROM` and in
 * every stage, stages the chosen one does not use among them, read as
 * BuildKit reads them; and which of core's never-given names the builder
 * reads as its own (B16) or zekno reserves (B17).
 */
import { describe, expect, test } from "bun:test"

import { declaredArgs, neverGiven } from "../../src/dockerfile/args"
import { readDockerfile } from "../../src/dockerfile/instructions"

const declared = (text: string) =>
  declaredArgs(readDockerfile(new TextEncoder().encode(text), "Dockerfile"))

describe("the names ARG declares", () => {
  test("before the first FROM and in each stage, in the order of the file, each once", () => {
    expect(
      declared(
        "ARG NODE_VERSION=22\nFROM node:${NODE_VERSION} AS deps\nARG API_URL\nFROM deps AS dev\nARG DEBUG=1 API_URL\nFROM node:22 AS prod\nARG SENTRY_DSN\n"
      )
    ).toEqual(["NODE_VERSION", "API_URL", "DEBUG", "SENTRY_DSN"])
  })

  test("in a stage the chosen stage does not use, too", () => {
    expect(declared("FROM node AS unused\nARG ONLY_HERE\nFROM node\n")).toEqual(
      ["ONLY_HERE"]
    )
  })

  test("an ONBUILD line is not run here: it declares nothing", () => {
    expect(declared("FROM node\nONBUILD ARG LATER\n")).toEqual([])
  })

  test("a name in quotes or with an escape is read as BuildKit reads it", () => {
    expect(declared('FROM node\nARG "API_URL"=x A\\B\n')).toEqual([
      "API_URL",
      "AB",
    ])
  })

  test("a name made from a variable cannot be read: nothing is given for it", () => {
    expect(declared("ARG P=API\nFROM node\nARG ${P}_URL\n")).toEqual(["P"])
  })

  test("heredocs and comments declare nothing", () => {
    expect(
      declared("FROM node\n# ARG COMMENTED\nRUN <<EOF\nARG IN_HEREDOC\nEOF\n")
    ).toEqual([])
  })
})

describe("names a build is never given (core's CO6)", () => {
  test("B16: a name the builder reads as its own", () => {
    for (const name of [
      "HTTP_PROXY",
      "https_proxy",
      "NO_PROXY",
      "all_proxy",
      "FTP_PROXY",
      "SOURCE_DATE_EPOCH",
      "TARGETARCH",
      "BUILDPLATFORM",
      "BUILDKIT_INLINE_CACHE",
    ])
      expect([name, neverGiven(name)]).toEqual([name, "B16"])
  })

  test("B17: a name zekno reserves for itself", () => {
    for (const name of [
      "DOCKER_HOST",
      "COMPOSE_FILE",
      "BUILDX_BUILDER",
      "PATH",
      "HOME",
      "LD_PRELOAD",
      "SSL_CERT_FILE",
      "CORP_PROXY",
    ])
      expect([name, neverGiven(name)]).toEqual([name, "B17"])
  })

  test("any other name may be given", () => {
    for (const name of ["API_URL", "NODE_ENV", "PORT", "PROXY_URL"])
      expect([name, neverGiven(name)]).toEqual([name, undefined])
  })
})
