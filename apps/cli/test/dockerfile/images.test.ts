/**
 * Images and stages of a Dockerfile (specs/016-build-from-source,
 * contracts/cli.md CL3, "Refused before signing", "Warned in the summary",
 * "The port"; FR-042, FR-042a; quickstart.md US4 and US11; tasks T120): every
 * image place read as Docker reads it, each stop before signing by its line's
 * id (C10, C11, C18, and the own id of a name that is neither a stage nor a
 * reference), B14 for each base image built from without a digest, and the
 * port of the chosen stage's chain. Only ids are checked, never words.
 */
import { describe, expect, test } from "bun:test"

import { CliError } from "../../src/cli/errors"
import {
  checkImages,
  dockerfilePort,
  ImageNameStop,
  targetStage,
} from "../../src/dockerfile/images"
import { readDockerfile } from "../../src/dockerfile/instructions"
import { BuildStop, exitStatusOf } from "../../src/shared/build-lines"

const HEX = "c".repeat(64)

const read = (text: string) =>
  readDockerfile(new TextEncoder().encode(text), "Dockerfile")

type Options = { stage?: string; given?: Record<string, string> }

const check = (text: string, options: Options = {}) =>
  checkImages({
    service: "web",
    reading: read(text),
    given: new Map(Object.entries(options.given ?? {})),
    stage: options.stage ?? null,
  })

/** The line a stop holds; fails when nothing stops. */
function stopOf(run: () => unknown) {
  try {
    run()
  } catch (error) {
    if (error instanceof BuildStop || error instanceof ImageNameStop) {
      expect(error).toBeInstanceOf(CliError)
      return error.line
    }
    throw error
  }
  throw new Error("Nothing stopped.")
}

describe("C18: the stage to build", () => {
  const STAGES =
    "FROM node:22 AS deps\nFROM deps AS build\nFROM build AS runner\n"

  test("a stage the file does not name stops, with the stages it does name", () => {
    expect(stopOf(() => check(STAGES, { stage: "release" }))).toEqual({
      id: "C18",
      service: "web",
      stage: "release",
      stages: ["deps", "build", "runner"],
    })
    expect(exitStatusOf("C18")).toBe(1)
  })

  test("a stage named in any case is found; none named is the last", () => {
    expect(targetStage(read(STAGES), "web", "BUILD")).toBe(1)
    expect(targetStage(read(STAGES), "web", null)).toBe(2)
    expect(check(STAGES, { stage: "Deps" }).target).toBe(0)
  })

  test("a file with no stage at all stops with its own id", () => {
    expect(stopOf(() => check("ARG A=1\n"))).toEqual({
      id: "dockerfile_no_stage",
      service: "web",
    })
  })
})

describe("C10: an image under zekno.invalid, any case, any port", () => {
  const c10 = (text: string, options?: Options) =>
    expect(stopOf(() => check(text, options))).toMatchObject({
      id: "C10",
      service: "web",
    })

  test("in FROM, written out", () => {
    expect(stopOf(() => check("FROM zekno.invalid/blog:1\n"))).toEqual({
      id: "C10",
      service: "web",
      image: "zekno.invalid/blog:1",
    })
    c10(`FROM ZEKNO.Invalid:5000/blog@sha256:${HEX}\n`)
    c10("FROM zekno.invalid:1/blog\n")
  })

  test("after a RUN in the JSON form with text after it: no heredoc is read there, as BuildKit reads none", () => {
    // BuildKit's parser reads `RUN ["true"] <<#x` as the JSON form (its first JSON value), and the JSON form holds no heredoc.
    c10(
      `FROM node:22\nRUN ["true"] <<#x\nFROM zekno.invalid/other:${HEX}\n#x\n`
    )
  })

  test("through an ARG default, and through a plain variable given to the build", () => {
    c10("ARG BASE=zekno.invalid/blog\nFROM ${BASE}\n")
    expect(
      stopOf(() =>
        check("ARG BASE=node:22\nFROM ${BASE}\n", {
          given: { BASE: "zekno.invalid/blog:abc" },
        })
      )
    ).toEqual({ id: "C10", service: "web", image: "zekno.invalid/blog:abc" })
  })

  test("in COPY --from and in a mount's from", () => {
    c10("FROM node:22\nCOPY --from=zekno.invalid/blog /app /app\n")
    c10(
      "FROM node:22\nRUN --mount=type=bind,from=Zekno.Invalid/blog,target=/x true\n"
    )
    c10(
      "FROM scratch\nARG FROM_IMAGE=zekno.invalid/blog\nCOPY --from=${FROM_IMAGE} /a /b\n"
    )
  })

  test("in a stage the chosen stage does not use", () => {
    c10("FROM zekno.invalid/blog AS old\nFROM node:22 AS app\n", {
      stage: "app",
    })
  })

  test("a path of Docker Hub that holds the name is not that registry", () => {
    expect(
      check(`FROM docker.io/zekno.invalid/blog@sha256:${HEX}\n`).unpinned
    ).toEqual([])
  })
})

describe("C11: a name that cannot be resolved fully", () => {
  test("a variable with no value, named for its default", () => {
    expect(stopOf(() => check("FROM ${BASE}\n"))).toEqual({
      id: "C11",
      service: "web",
      instruction: "FROM ${BASE}",
      line: 1,
      variable: "BASE",
    })
    expect(stopOf(() => check("ARG BASE\nFROM $BASE\n"))).toMatchObject({
      id: "C11",
      line: 2,
      variable: "BASE",
    })
  })

  test("a variable the server's side may give, and a form CL3 does not list", () => {
    expect(
      stopOf(() => check("ARG HTTP_PROXY=x\nFROM ${HTTP_PROXY}\n"))
    ).toMatchObject({ id: "C11", variable: "HTTP_PROXY" })
    expect(
      stopOf(() => check("ARG BASE=node\nFROM ${BASE%%:*}\n"))
    ).toMatchObject({ id: "C11", instruction: "FROM ${BASE%%:*}" })
  })

  test("a COPY --from built from a variable a base image might define", () => {
    expect(
      stopOf(() =>
        check("FROM node:22\nARG SOURCE=builder\nCOPY --from=${SOURCE} /a /b\n")
      )
    ).toMatchObject({
      id: "C11",
      instruction: "COPY --from=${SOURCE}",
      line: 3,
      variable: "SOURCE",
    })
  })

  test("a mount's from, likewise", () => {
    expect(
      stopOf(() =>
        check("FROM node:22\nRUN --mount=from=$IMAGE,target=/x true\n")
      )
    ).toMatchObject({ id: "C11", line: 2, variable: "IMAGE" })
  })
})

describe("a name that is neither a stage nor a reference", () => {
  test.each([
    ["a capital", "FROM Node:22\n", "Node:22"],
    ["an empty tag", "FROM node:\n", "node:"],
    ["a scheme", "FROM docker-image://node\n", "docker-image://node"],
  ])("%s stops with its own id", (_, text, name) => {
    expect(stopOf(() => check(text))).toEqual({
      id: "dockerfile_reference",
      service: "web",
      name,
      line: 1,
    })
  })

  test("in COPY --from too", () => {
    expect(
      stopOf(() => check("FROM node:22\nCOPY --from=Bad:Name /a /b\n"))
    ).toMatchObject({ id: "dockerfile_reference", name: "Bad:Name", line: 2 })
  })
})

describe("stages, scratch and images", () => {
  test("an earlier stage in any case, scratch, a stage by number in COPY: no image, no warning", () => {
    expect(
      check(
        `FROM node:22@sha256:${HEX} AS base\nFROM BASE\nCOPY --from=0 /a /b\nCOPY --from=Base /a /b\nFROM scratch\nCOPY --from=scratch /a /b\n`
      ).unpinned
    ).toEqual([])
  })

  test("a later stage's name in FROM is an image, as BuildKit reads it", () => {
    expect(
      check(`FROM later\nFROM node@sha256:${HEX} AS later\n`).unpinned
    ).toEqual([])
    expect(
      check(`FROM later AS first\nFROM node@sha256:${HEX} AS later\n`, {
        stage: "first",
      }).unpinned
    ).toEqual([{ id: "B14", service: "web", image: "later" }])
  })
})

describe("B14: a base image without a digest", () => {
  test("each base image of the stages built, once, as written", () => {
    expect(
      check(
        "FROM node:22-slim AS deps\nFROM node:22-slim AS build\nCOPY --from=deps /a /b\nFROM nginx:1 AS runner\nCOPY --from=build /a /b\n"
      ).unpinned
    ).toEqual([
      { id: "B14", service: "web", image: "node:22-slim" },
      { id: "B14", service: "web", image: "nginx:1" },
    ])
  })

  test("by digest: no warning; a stage not built: no warning", () => {
    expect(check(`FROM node:22@sha256:${HEX}\n`).unpinned).toEqual([])
    expect(
      check(`FROM node:22 AS dev\nFROM node@sha256:${HEX} AS prod\n`).unpinned
    ).toEqual([])
  })

  test("a stage reached through a mount's from is built", () => {
    expect(
      check(
        `FROM alpine:3 AS tools\nFROM node@sha256:${HEX}\nRUN --mount=from=tools,target=/t true\n`
      ).unpinned
    ).toEqual([{ id: "B14", service: "web", image: "alpine:3" }])
  })

  test("a name resolved per platform: one line for each", () => {
    expect(check("FROM node:22-${TARGETARCH}\n").unpinned).toEqual([
      { id: "B14", service: "web", image: "node:22-amd64" },
      { id: "B14", service: "web", image: "node:22-arm64" },
    ])
  })

  test("a plain variable given to the build names the image", () => {
    expect(
      check("ARG BASE=node:20\nFROM $BASE\n", { given: { BASE: "node:22" } })
        .unpinned
    ).toEqual([{ id: "B14", service: "web", image: "node:22" }])
  })

  test("an ONBUILD line is not run here", () => {
    expect(
      check(
        `FROM node@sha256:${HEX}\nONBUILD COPY --from=zekno.invalid/blog /a /b\n`
      ).unpinned
    ).toEqual([])
  })
})

describe("the port", () => {
  const port = (text: string, stage: string | null = null) => {
    const reading = read(text)
    return dockerfilePort(reading, targetStage(reading, "web", stage))
  }

  test("the first EXPOSE of the chosen stage's chain", () => {
    expect(port("FROM node:22\nEXPOSE 3000\nEXPOSE 4000\n")).toBe(3000)
    expect(
      port("FROM node:22 AS base\nEXPOSE 8080\nFROM base\nEXPOSE 9000\n")
    ).toBe(8080)
    expect(port("FROM node:22\nEXPOSE 3000/tcp 4000\n")).toBe(3000)
  })

  test("an EXPOSE outside the chain, or in ONBUILD, is not the port", () => {
    expect(
      port("FROM node:22 AS other\nEXPOSE 8080\nFROM node:22\n")
    ).toBeNull()
    expect(port("FROM node:22\nONBUILD EXPOSE 8080\n")).toBeNull()
  })

  test("with ARG defaults where they are known", () => {
    expect(port("FROM scratch\nARG PORT=4000\nEXPOSE $PORT\n")).toBe(4000)
    expect(
      port("ARG PORT=4000\nFROM scratch\nARG PORT\nEXPOSE ${PORT}\n")
    ).toBe(4000)
  })

  test("none when there is none, or it cannot be resolved or is not one TCP port", () => {
    expect(port("FROM node:22\n")).toBeNull()
    expect(port("FROM node:22\nARG PORT=4000\nEXPOSE $PORT\n")).toBeNull()
    expect(port("FROM node:22\nEXPOSE 53/udp\n")).toBeNull()
    expect(port("FROM node:22\nEXPOSE 3000-3005\n")).toBeNull()
    expect(port("FROM node:22\nEXPOSE 70000\n")).toBeNull()
    expect(port("FROM node:22\nEXPOSE 0\n")).toBeNull()
  })
})
