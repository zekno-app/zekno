/**
 * Which message format a deploy is signed in (specs/014-deploy-v2,
 * contracts/cli.md, "The format"; research R4, R18; tasks T028): chosen from
 * the answer to the session's first request, before anything is read or
 * signed. A runner that speaks a newer protocol stops the deploy with C7.
 */
import { describe, expect, test } from "bun:test"
import { RUNNER_PROTOCOL } from "@workspace/core"

import { CliError } from "../../src/cli/errors"
import { chooseFormat } from "../../src/ops/deploy-format"
import { C7 } from "../../src/shared/deploy-words"

const at = (version: string, protocol: number) => ({
  server: "prod-1",
  mode: "session" as const,
  runner: { version, protocol },
  carried: "0.1.1",
})

describe("chooseFormat (contracts/cli.md, the format)", () => {
  test("a runner that does not speak sessions: version 1, nothing said (it reports no version)", () => {
    expect(
      chooseFormat({
        server: "prod-1",
        mode: "one-shot",
        runner: undefined,
        carried: "0.1.1",
      })
    ).toEqual({ format: 1 })
  })

  test("protocol below 3, a version older than the one this zekno carries: version 1, and C6's version", () => {
    expect(chooseFormat(at("0.1.0", 2))).toEqual({
      format: 1,
      older: { version: "0.1.0" },
    })
    expect(chooseFormat(at("0.0.9", 1))).toEqual({
      format: 1,
      older: { version: "0.0.9" },
    })
    // A development release of the same numbers is older than the release.
    expect(chooseFormat(at("0.1.1-dev.3", 2))).toEqual({
      format: 1,
      older: { version: "0.1.1-dev.3" },
    })
  })

  test("protocol below 3, a version not older than the one this zekno carries: version 1, nothing said (research R18)", () => {
    expect(chooseFormat(at("0.1.1", 2))).toEqual({ format: 1 })
    expect(chooseFormat(at("0.1.2", 2))).toEqual({ format: 1 })
    expect(chooseFormat({ ...at("0.1.0", 2), carried: "0.1.0" })).toEqual({
      format: 1,
    })
  })

  // Until T025 sets RUNNER_PROTOCOL to 3, a runner of protocol 3 speaks a newer protocol than this zekno: the case below.
  test.skipIf(RUNNER_PROTOCOL < 3)(
    "protocol 3 (RUNNER_PROTOCOL): version 2, nothing said",
    () => {
      expect(chooseFormat(at("0.1.0", 3))).toEqual({ format: 2 })
      expect(chooseFormat(at("0.1.1", 3))).toEqual({ format: 2 })
    }
  )

  test("a protocol above this zekno's (RUNNER_PROTOCOL + 1): C7, thrown as a CliError", () => {
    const newer = () => chooseFormat(at("0.1.2", RUNNER_PROTOCOL + 1))
    expect(newer).toThrow(CliError)
    expect(newer).toThrow(C7("prod-1", "0.1.2", "0.1.1"))
    let said: unknown
    try {
      newer()
    } catch (error) {
      said = (error as Error).message
    }
    expect(said).toBe(
      "The runner on prod-1 is version 0.1.2, newer than this zekno's 0.1.1, and speaks a newer protocol. Update zekno to deploy to prod-1. Nothing was signed."
    )
  })
})
