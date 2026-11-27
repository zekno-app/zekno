/**
 * An image reference as Docker reads one (specs/016-build-from-source,
 * contracts/cli.md CL3; FR-042; tasks T120): distribution/reference's
 * grammar with Docker's normalizing, references without a digest included,
 * so zekno knows the registry every image place names. Cases written from
 * the grammar and the reference's own documented examples.
 */
import { describe, expect, test } from "bun:test"

import { parseReference } from "../../src/dockerfile/reference"

const HEX = "a".repeat(64)

describe("names Docker normalizes", () => {
  test("a name alone is an official image of Docker Hub", () => {
    expect(parseReference("node")).toEqual({
      domain: "docker.io",
      path: "library/node",
      tag: null,
      digest: null,
    })
    expect(parseReference("node:22-slim")).toMatchObject({
      domain: "docker.io",
      path: "library/node",
      tag: "22-slim",
    })
  })

  test("a first part with no dot, no colon, not localhost and in lowercase is a path of Docker Hub", () => {
    expect(parseReference("bitnami/redis:7")).toMatchObject({
      domain: "docker.io",
      path: "bitnami/redis",
      tag: "7",
    })
  })

  test("a first part with a dot, a port, localhost or a capital is a registry", () => {
    expect(parseReference("ghcr.io/org/app:1.0")).toMatchObject({
      domain: "ghcr.io",
      path: "org/app",
      tag: "1.0",
    })
    expect(parseReference("localhost:5000/app")).toMatchObject({
      domain: "localhost:5000",
      path: "app",
    })
    expect(parseReference("localhost/app")).toMatchObject({
      domain: "localhost",
      path: "app",
    })
    expect(parseReference("Registry/app")).toMatchObject({
      domain: "Registry",
      path: "app",
    })
    expect(parseReference("[::1]:5000/app")).toMatchObject({
      domain: "[::1]:5000",
      path: "app",
    })
    expect(parseReference("ZEKNO.INVALID:5000/blog")).toMatchObject({
      domain: "ZEKNO.INVALID:5000",
      path: "blog",
    })
  })

  test("the old name of Docker Hub's index is Docker Hub", () => {
    expect(parseReference("index.docker.io/node")).toMatchObject({
      domain: "docker.io",
      path: "library/node",
    })
  })

  test("a digest, with or without a tag", () => {
    expect(parseReference(`node@sha256:${HEX}`)).toMatchObject({
      tag: null,
      digest: `sha256:${HEX}`,
    })
    expect(parseReference(`ghcr.io/a/b:1@sha256:${HEX}`)).toMatchObject({
      domain: "ghcr.io",
      path: "a/b",
      tag: "1",
      digest: `sha256:${HEX}`,
    })
    expect(
      parseReference(`node@sha512:${"b".repeat(128)}`)?.digest
    ).toStartWith("sha512:")
  })

  test("separators of a path: one dot, one or two underscores, any dashes", () => {
    for (const name of ["a.b", "a_b", "a__b", "a-b", "a---b", "a/b.c/d"])
      expect(parseReference(name)).toBeDefined()
  })
})

describe("what Docker refuses", () => {
  test.each([
    ["empty", ""],
    ["a capital in the path", "Node"],
    ["a capital in a path after a registry", "ghcr.io/Org/app"],
    ["a capital in a Hub path", "library/Node"],
    ["64 hex digits alone", HEX],
    ["an empty tag", "node:"],
    ["two tags", "node:a:b"],
    ["a space", "no de"],
    ["a separator at the start", "-node"],
    ["a separator at the end", "node-"],
    ["three underscores", "a___b"],
    ["two dots", "a..b"],
    ["a trailing dot in the registry", "zekno.invalid./blog"],
    ["a scheme", "docker-image://node"],
    ["a short digest", "node@sha256:abc"],
    ["a digest in capitals", `node@sha256:${"A".repeat(64)}`],
    ["a digest of the wrong length", `node@sha256:${"a".repeat(63)}`],
    ["an algorithm Docker does not know", `node@md5:${"a".repeat(32)}`],
    ["a tag of 129 characters", `node:${"t".repeat(129)}`],
    ["a name past 255 characters", `ghcr.io/${"a".repeat(250)}`],
  ])("%s", (_, text) => {
    expect(parseReference(text)).toBeUndefined()
  })

  test("a text too long to be a reference is refused at once, never matched", () => {
    const started = performance.now()
    expect(parseReference(`${"a".repeat(1_000_000)}!`)).toBeUndefined()
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
