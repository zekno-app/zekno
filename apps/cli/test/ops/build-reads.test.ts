/**
 * What each build reads (specs/016-build-from-source, contracts/cli.md CL3,
 * "The build's plain variables"; data-model.md, "Build variables"; FR-036a
 * to FR-036e, FR-072, FR-072b; quickstart.md US11; tasks T121), with
 * design/lines.md's example values: the service's plain variables whose
 * names any `ARG` declares, `PORT` set by zekno among them, minus the names a
 * build is never given (B16, B17) and the app's secrets (B18), the deploy
 * going on; the facts B10 and B20; and the limits C14, C15 and C16, each a
 * stop before signing. Only ids are checked, never words.
 */
import { describe, expect, test } from "bun:test"
import { LIMITS } from "@workspace/core"

import { readDockerfile } from "../../src/dockerfile/instructions"
import {
  buildReads,
  checkDeployArgs,
  readsFact,
  type BuildReadsInput,
} from "../../src/ops/build-reads"
import type { ServiceSettings } from "../../src/settings/types"
import { BuildStop, exitStatusOf } from "../../src/shared/build-lines"

/** The service of lines.md's examples: `web` of `shop`, port 3000, two plain variables and two secrets. */
const WEB: ServiceSettings = {
  build: { builder: "dockerfile" },
  port: 3000,
  plain: [
    ["API_URL", "https://api.example.com"],
    ["NODE_ENV", "production"],
  ],
  secrets: ["DATABASE_URL", "SESSION_KEY"],
}

const reads = (
  dockerfile: string,
  settings: ServiceSettings = WEB,
  appSecrets: readonly string[] = ["DATABASE_URL", "SESSION_KEY"]
) =>
  buildReads({
    app: "shop",
    service: "web",
    settings,
    reading: readDockerfile(new TextEncoder().encode(dockerfile), "Dockerfile"),
    appSecrets,
  } satisfies BuildReadsInput)

/** The line a stop holds; fails when nothing stops. */
function stopOf(run: () => unknown) {
  try {
    run()
  } catch (error) {
    if (error instanceof BuildStop) return error.line
    throw error
  }
  throw new Error("Nothing stopped.")
}

describe("the plain variables given (FR-036a)", () => {
  test("API_URL given; NODE_ENV and PORT not, and only the running app sees them", () => {
    const read = reads("FROM node:22\nARG API_URL\nRUN echo $API_URL\n")
    expect(read.args).toEqual([
      { name: "API_URL", value: "https://api.example.com" },
    ])
    expect([...read.given]).toEqual([["API_URL", "https://api.example.com"]])
    expect(read.notGiven).toEqual([])
    expect(read.onlyApp).toEqual({
      id: "B20",
      service: "web",
      names: ["NODE_ENV", "PORT", "DATABASE_URL", "SESSION_KEY"],
    })
    expect(readsFact([read])).toEqual({
      id: "B10",
      reads: [{ service: "web", names: ["API_URL"] }],
    })
  })

  test("PORT set by zekno is a plain variable like any other", () => {
    expect(reads("FROM node:22\nARG PORT\nARG API_URL\n").args).toEqual([
      { name: "API_URL", value: "https://api.example.com" },
      { name: "PORT", value: "3000" },
    ])
    const own = reads("FROM node:22\nARG PORT\n", {
      ...WEB,
      plain: [["PORT", "8080"]],
    })
    expect(own.args).toEqual([{ name: "PORT", value: "8080" }])
  })

  test("sorted by name and each once, as the build entry holds them, whatever the order of the file", () => {
    const read = reads(
      "FROM node:22\nARG NODE_ENV\nARG API_URL\nARG NODE_ENV\n"
    )
    expect(read.args.map(({ name }) => name)).toEqual(["API_URL", "NODE_ENV"])
    expect(read.onlyApp?.names).toEqual(["PORT", "DATABASE_URL", "SESSION_KEY"])
  })

  test("a name declared with no plain variable of it gives nothing; every variable read, no note", () => {
    const read = reads(
      "FROM node:22\nARG VERSION\nARG API_URL NODE_ENV PORT\n",
      {
        ...WEB,
        secrets: [],
      }
    )
    expect(read.args.map(({ name }) => name)).toEqual([
      "API_URL",
      "NODE_ENV",
      "PORT",
    ])
    expect(read.onlyApp).toBeNull()
  })

  test("no build reads anything: no B10", () => {
    expect(readsFact([reads("FROM node:22\n")])).toBeNull()
  })

  test("B10 names each build's reads, a row each", () => {
    const api = reads("FROM node:22\nARG API_URL\n")
    const worker = buildReads({
      app: "shop",
      service: "worker",
      settings: {
        build: { builder: "dockerfile" },
        plain: [["QUEUE", "jobs"]],
      },
      reading: readDockerfile(
        new TextEncoder().encode("FROM node:22\nARG QUEUE\n"),
        "Dockerfile"
      ),
      appSecrets: [],
    })
    expect(readsFact([api, worker])).toEqual({
      id: "B10",
      reads: [
        { service: "web", names: ["API_URL"] },
        { service: "worker", names: ["QUEUE"] },
      ],
    })
  })
})

describe("names never given: said, and the deploy goes on (FR-036b, FR-036e)", () => {
  test("ARG HTTP_PROXY with a plain variable of that name is B16", () => {
    const read = reads("FROM node:22\nARG HTTP_PROXY\nARG API_URL\n", {
      ...WEB,
      plain: [...WEB.plain!, ["HTTP_PROXY", "http://proxy:3128"]],
    })
    expect(read.notGiven).toEqual([
      { id: "B16", service: "web", name: "HTTP_PROXY" },
    ])
    expect(read.args.map(({ name }) => name)).toEqual(["API_URL"])
    expect(read.onlyApp?.names).toContain("HTTP_PROXY")
    expect(exitStatusOf("B16")).toBeUndefined()
  })

  test("DOCKER_HOST is B17", () => {
    const read = reads("FROM node:22\nARG DOCKER_HOST\n", {
      ...WEB,
      plain: [["DOCKER_HOST", "tcp://1.2.3.4:2375"]],
    })
    expect(read.notGiven).toEqual([
      { id: "B17", service: "web", name: "DOCKER_HOST" },
    ])
    expect(read.args).toEqual([])
    expect(exitStatusOf("B17")).toBeUndefined()
  })

  test("ARG SESSION_KEY where it is a secret is B18, whether this service reads it or not", () => {
    expect(reads("FROM node:22\nARG SESSION_KEY\n").notGiven).toEqual([
      { id: "B18", service: "web", name: "SESSION_KEY", app: "shop" },
    ])
    expect(
      reads(
        "FROM node:22\nARG STRIPE_KEY\n",
        { ...WEB, plain: [["STRIPE_KEY", "pk_live"]] },
        ["DATABASE_URL", "SESSION_KEY", "STRIPE_KEY"]
      )
    ).toMatchObject({
      args: [],
      notGiven: [{ id: "B18", name: "STRIPE_KEY", app: "shop" }],
    })
    expect(exitStatusOf("B18")).toBeUndefined()
  })

  test("a never-given name the service has no plain variable of says nothing", () => {
    expect(
      reads("FROM node:22\nARG HTTP_PROXY\nARG TARGETARCH\n").notGiven
    ).toEqual([])
  })

  test("in the order the file declares them", () => {
    const read = reads(
      "FROM node:22\nARG DOCKER_HOST SESSION_KEY HTTP_PROXY\n",
      {
        ...WEB,
        plain: [
          ["HTTP_PROXY", "x"],
          ["DOCKER_HOST", "y"],
        ],
      }
    )
    expect(read.notGiven.map(({ id }) => id)).toEqual(["B17", "B18", "B16"])
  })
})

describe("the limits, each a stop before signing (FR-036c)", () => {
  const many = (count: number): ServiceSettings => ({
    build: { builder: "dockerfile" },
    plain: Array.from({ length: count }, (_, at) => [`V${at}`, "x"] as const),
  })
  const declaring = (count: number) =>
    `FROM node:22\n${Array.from({ length: count }, (_, at) => `ARG V${at}\n`).join("")}`

  test("33 names: C14", () => {
    expect(reads(declaring(32), many(32)).args).toHaveLength(
      LIMITS.argsPerBuild
    )
    expect(stopOf(() => reads(declaring(33), many(33)))).toEqual({
      id: "C14",
      service: "web",
      count: 33,
    })
    expect(exitStatusOf("C14")).toBe(1)
  })

  test("a value of 5,120 bytes: C15, counted in bytes", () => {
    const value = (text: string): ServiceSettings => ({
      ...WEB,
      plain: [["API_URL", text]],
    })
    expect(
      reads("FROM node:22\nARG API_URL\n", value("a".repeat(4096))).args
    ).toHaveLength(1)
    expect(
      stopOf(() =>
        reads("FROM node:22\nARG API_URL\n", value("a".repeat(5120)))
      )
    ).toEqual({ id: "C15", service: "web", name: "API_URL", bytes: 5120 })
    // 2,560 characters of two bytes each.
    expect(
      stopOf(() =>
        reads("FROM node:22\nARG API_URL\n", value("é".repeat(2560)))
      )
    ).toMatchObject({ id: "C15", bytes: 5120 })
    expect(exitStatusOf("C15")).toBe(1)
  })

  test("71,680 bytes across builds: C16", () => {
    const values = (count: number, last: number) =>
      Array.from({ length: count }, (_, at) => ({
        name: `V${at}`,
        value: "x".repeat(at === count - 1 ? last : 4096),
      }))
    // 9 values of 4,096 bytes, then 8 of 4,096 and one of 2,048: 71,680 in all.
    const builds = [values(9, 4096), values(9, 2048)]
    expect(stopOf(() => checkDeployArgs("shop", builds))).toEqual({
      id: "C16",
      app: "shop",
      bytes: 71_680,
    })
    expect(() => checkDeployArgs("shop", [values(16, 4096)])).not.toThrow()
    expect(exitStatusOf("C16")).toBe(1)
  })
})
