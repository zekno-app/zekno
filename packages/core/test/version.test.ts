import { describe, expect, test } from "bun:test"

import {
  compareRunnerVersions,
  isDevVersion,
  parseMessage,
  parseRunnerVersion,
  RUNNER_VERSION_PATTERN,
  RunnerVersionSchema,
} from "../src/index"
import { ORDERED_VERSIONS as ORDERED, REFUSED_VERSIONS as REFUSED } from "./fixtures/versions"

const ACCEPTED = ["0.0.0", "0.1.0", "1.2.3", "10.20.30", "999999999.0.0", "0.1.0-dev.1", "0.1.0-dev.12", "1.0.0-dev.999999999"]

describe("a runner version", () => {
  test("is three numbers, or three numbers and -dev.<n>, and nothing else", () => {
    for (const version of ACCEPTED) {
      expect({ version, matches: RUNNER_VERSION_PATTERN.test(version) }).toEqual({ version, matches: true })
      expect(parseRunnerVersion(version)).toBeDefined()
    }
    for (const version of [...REFUSED, ...ORDERED.map((v) => `${v}\n`), " 0.1.0", "0.1.0-dev.1\u0000", "１.0.0"]) {
      expect({ version, matches: RUNNER_VERSION_PATTERN.test(version) }).toEqual({ version, matches: false })
      expect({ version, parsed: parseRunnerVersion(version) }).toEqual({ version, parsed: undefined })
    }
    for (const value of [undefined, null, 1, {}, ["0.1.0"]]) expect(parseRunnerVersion(value as never)).toBeUndefined()
  })

  test("parses into its numbers", () => {
    expect(parseRunnerVersion("0.1.0-dev.3")).toEqual({ major: 0, minor: 1, patch: 0, dev: 3 })
    const plain = parseRunnerVersion("1.2.3")
    expect(plain).toEqual({ major: 1, minor: 2, patch: 3, dev: undefined })
    expect(plain!.dev).toBeUndefined()
    expect(parseRunnerVersion("999999999.999999999.999999999-dev.999999999")).toEqual({
      major: 999_999_999,
      minor: 999_999_999,
      patch: 999_999_999,
      dev: 999_999_999,
    })
  })

  test("orders by the three numbers, a dev version before the plain one, two dev versions by their count", () => {
    for (const [i, a] of ORDERED.entries()) {
      expect(compareRunnerVersions(a, a)).toBe(0)
      for (const [j, b] of ORDERED.entries()) {
        const sign = Math.sign(compareRunnerVersions(a, b))
        expect({ a, b, sign }).toEqual({ a, b, sign: Math.sign(i - j) })
      }
    }
  })

  test("is never compared when it is not one", () => {
    for (const bad of REFUSED) {
      expect(() => compareRunnerVersions(bad, "0.1.0")).toThrow()
      expect(() => compareRunnerVersions("0.1.0", bad)).toThrow()
    }
  })

  test("is a dev version only when it is a valid one with -dev.<n>", () => {
    expect(ORDERED.filter(isDevVersion)).toEqual(["0.1.0-dev.1", "0.1.0-dev.2", "0.1.0-dev.10", "0.1.1-dev.1", "1.0.0-dev.1"])
    for (const bad of REFUSED) expect(isDevVersion(bad)).toBe(false)
  })

  test("is what a runner may report in the session protocol", () => {
    expect(parseMessage(RunnerVersionSchema, { version: "0.1.0-dev.1", protocol: 2 }).ok).toBe(true)
    expect(parseMessage(RunnerVersionSchema, { version: "0.1.0", protocol: 2 }).ok).toBe(true)
    for (const version of ["0.1.0-dev", "0.1.0-rc.1", "01.0.0"]) {
      expect(parseMessage(RunnerVersionSchema, { version, protocol: 2 }).ok).toBe(false)
    }
  })
})
