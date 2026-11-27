/**
 * Which message format a deploy is signed in (specs/014-deploy-v2,
 * contracts/cli.md, "The format"; research R4, R18; tasks T028): chosen from
 * the answer to the session's first request, before anything is read or
 * signed. A runner that speaks a newer protocol stops the deploy with C7.
 * A deploy that builds, to a runner below protocol 6, stops with F1
 * (specs/016-build-from-source, contracts/cli.md CL7 step 6; tasks T104).
 */
import { describe, expect, test } from "bun:test"
import {
  CARRIED_OUT,
  CARRIED_OUT_ROWS,
  readDeployV2Payload,
  rowsAskedFor,
  RUNNER_PROTOCOL,
  type CarriedOutRow,
} from "@workspace/core"

import {
  build,
  payload,
  railpackBuild,
} from "../../../../packages/core/test/support/payload-v2"
import { CliError } from "../../src/cli/errors"
import * as format from "../../src/ops/deploy-format"
import {
  BUILD_PROTOCOL,
  chooseFormat,
  ROUTES_PROTOCOL,
} from "../../src/ops/deploy-format"
import { BuildStop, exitStatusOf } from "../../src/shared/build-lines"
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

  test("protocol 3 to 6 (RUNNER_PROTOCOL): version 2, nothing said", () => {
    expect(RUNNER_PROTOCOL).toBe(6)
    expect(chooseFormat(at("0.1.0", 3))).toEqual({ format: 2 })
    expect(chooseFormat(at("0.1.1", 3))).toEqual({ format: 2 })
    expect(chooseFormat(at("0.1.1", 4))).toEqual({ format: 2 })
    expect(chooseFormat(at("0.1.1", 5))).toEqual({ format: 2 })
    expect(chooseFormat(at("0.1.2", RUNNER_PROTOCOL))).toEqual({ format: 2 })
  })

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

describe("B10: a deploy with a route or a health check (specs/015-domains-https, contracts/cli.md, CL3 step 1)", () => {
  const routed = (version: string, protocol: number) => ({
    ...at(version, protocol),
    routed: true,
  })
  const thrown = (run: () => unknown): unknown => {
    try {
      run()
    } catch (error) {
      return error
    }
    return undefined
  }

  test("protocol 3, with a route or a health check: B10, thrown as a CliError, nothing signed", () => {
    const error = thrown(() => chooseFormat(routed("0.1.0", 3)))
    expect(error).toBeInstanceOf(CliError)
    expect((error as Error).message).toBe(
      "The runner on prod-1 is version 0.1.0, too old for domains and health checks. Run `zekno server update prod-1`, then run `zekno deploy` again. Nothing was signed."
    )
  })

  test("protocol 3, with neither: version 2, as before", () => {
    expect(chooseFormat({ ...at("0.1.0", 3), routed: false })).toEqual({
      format: 2,
    })
    expect(chooseFormat(at("0.1.0", 3))).toEqual({ format: 2 })
  })

  test("below protocol 3, with a route: B10 in place of version 1", () => {
    expect(
      (thrown(() => chooseFormat(routed("0.0.9", 2))) as Error).message
    ).toBe(
      "The runner on prod-1 is version 0.0.9, too old for domains and health checks. Run `zekno server update prod-1`, then run `zekno deploy` again. Nothing was signed."
    )
  })

  test("a runner run one request at a time: B10 without a version, with a route; version 1 without", () => {
    const oneShot = {
      server: "prod-1",
      mode: "one-shot" as const,
      runner: undefined,
      carried: "0.1.1",
    }
    const error = thrown(() => chooseFormat({ ...oneShot, routed: true }))
    expect(error).toBeInstanceOf(CliError)
    expect((error as Error).message).toBe(
      "The runner on prod-1 is too old for domains and health checks. Run `zekno server update prod-1`, then run `zekno deploy` again. Nothing was signed."
    )
    expect(chooseFormat({ ...oneShot, routed: false })).toEqual({ format: 1 })
  })

  test("protocol 4 (a runner older than the start limit) and this zekno's, with a route: version 2", () => {
    expect(chooseFormat(routed("0.1.1", 4))).toEqual({ format: 2 })
    expect(chooseFormat(routed("0.1.1", RUNNER_PROTOCOL))).toEqual({
      format: 2,
    })
  })

  test("a newer protocol says C7 first, route or not", () => {
    expect(
      (
        thrown(() =>
          chooseFormat(routed("0.1.2", RUNNER_PROTOCOL + 1))
        ) as Error
      ).message
    ).toBe(C7("prod-1", "0.1.2", "0.1.1"))
  })
})

describe("F1: a deploy that builds, to a runner below protocol 6 (specs/016-build-from-source, contracts/cli.md CL7 step 6)", () => {
  const building = (version: string, protocol: number) => ({
    ...at(version, protocol),
    builds: true,
  })
  const thrown = (run: () => unknown): unknown => {
    try {
      run()
    } catch (error) {
      return error
    }
    return undefined
  }

  test("runner 0.1.1, protocol 5: F1 with its version, a stop of exit status 1, nothing signed", () => {
    const error = thrown(() => chooseFormat(building("0.1.1", 5)))
    expect(error).toBeInstanceOf(BuildStop)
    expect(error).toBeInstanceOf(CliError)
    expect((error as BuildStop).line).toEqual({
      id: "F1",
      server: "prod-1",
      version: "0.1.1",
    })
    expect(exitStatusOf("F1")).toBe(1)
  })

  test("every protocol below 6, runner 0.1.0 among them: F1 with the runner's version", () => {
    for (const [version, protocol] of [
      ["0.0.9", 1],
      ["0.1.0", 2],
      ["0.1.0", 3],
      ["0.1.1", 4],
      ["0.1.1", 5],
    ] as const)
      expect(
        (thrown(() => chooseFormat(building(version, protocol))) as BuildStop)
          .line
      ).toEqual({ id: "F1", server: "prod-1", version })
  })

  test("a runner run one request at a time: F1 without a version", () => {
    const error = thrown(() =>
      chooseFormat({
        server: "prod-1",
        mode: "one-shot",
        runner: undefined,
        carried: "0.1.1",
        builds: true,
      })
    )
    expect(error).toBeInstanceOf(BuildStop)
    expect((error as BuildStop).line).toEqual({
      id: "F1",
      server: "prod-1",
      version: undefined,
    })
  })

  test("F1 comes before B10: a deploy that builds and has a route, to protocol 3", () => {
    const error = thrown(() =>
      chooseFormat({ ...building("0.1.0", 3), routed: true })
    )
    expect((error as BuildStop).line.id).toBe("F1")
  })

  test("protocol 6 and above this zekno's: version 2, with a route too", () => {
    expect(chooseFormat(building("0.1.2", 6))).toEqual({ format: 2 })
    expect(
      chooseFormat({ ...building("0.1.2", RUNNER_PROTOCOL), routed: true })
    ).toEqual({ format: 2 })
  })

  test("an image deploy to runner 0.1.1 (protocol 5): version 2, as in 015, with a route or not", () => {
    expect(chooseFormat(at("0.1.1", 5))).toEqual({ format: 2 })
    expect(chooseFormat({ ...at("0.1.1", 5), builds: false })).toEqual({
      format: 2,
    })
    expect(
      chooseFormat({ ...at("0.1.1", 5), builds: false, routed: true })
    ).toEqual({ format: 2 })
  })

  test("a runner above this zekno's protocol: C7, even for images (CL13), and before F1", () => {
    for (const builds of [false, true]) {
      const error = thrown(() =>
        chooseFormat({ ...at("0.1.3", RUNNER_PROTOCOL + 1), builds })
      )
      expect(error).toBeInstanceOf(CliError)
      expect(error).not.toBeInstanceOf(BuildStop)
      expect((error as Error).message).toBe(C7("prod-1", "0.1.3", "0.1.1"))
    }
  })
})

/**
 * Each protocol threshold of this zekno and the row of core's carried-out
 * table it stands for (core.md CO7 and CO8): zekno never signs what the
 * runner it sends to does not carry out, because each threshold stops such
 * a deploy before signing. `null`: a Dockerfile build with no secret, which
 * asks for no row of the table and which a runner carries out from
 * BUILD_PROTOCOL on. Step 2's RAILPACK_PROTOCOL (`railpack`, F2) and step
 * 1b's BUILD_SECRETS_PROTOCOL (`build_secrets`, F3) join this table with
 * their steps. ROUTES_PROTOCOL is feature 015's, for routes and health,
 * which the table does not hold.
 */
const STANDS_FOR: Record<string, CarriedOutRow | null> = {
  BUILD_PROTOCOL: null,
}

describe("each threshold and the row of CO7 it stands for (core.md CO8)", () => {
  test("the thresholds of ops/deploy-format.ts are BUILD_PROTOCOL and 015's ROUTES_PROTOCOL, each paired here", () => {
    const thresholds = Object.keys(format).filter((name) =>
      name.endsWith("_PROTOCOL")
    )
    expect(thresholds.sort()).toEqual(["BUILD_PROTOCOL", "ROUTES_PROTOCOL"])
    expect(Object.keys(STANDS_FOR)).toEqual(
      thresholds.filter((name) => name !== "ROUTES_PROTOCOL")
    )
    expect(ROUTES_PROTOCOL).toBe(4)
  })

  test("BUILD_PROTOCOL (6): a Dockerfile build with no secret asks for no row, and is signed for a runner of 6", () => {
    expect(BUILD_PROTOCOL).toBe(6)
    // Step 1: the core of this zekno is the first that builds.
    expect(RUNNER_PROTOCOL).toBe(BUILD_PROTOCOL)
    const read = readDeployV2Payload(payload({ builds: [build()] }))
    if (!read.ok) throw new Error(read.error.code)
    expect(rowsAskedFor(read.value)).toEqual([])
    expect(
      chooseFormat({ ...at("0.1.2", BUILD_PROTOCOL), builds: true })
    ).toEqual({ format: 2 })
    expect(() =>
      chooseFormat({ ...at("0.1.1", BUILD_PROTOCOL - 1), builds: true })
    ).toThrow(BuildStop)
  })

  test("every row step 1's table refuses has no threshold yet, and a build that asks for one is refused by this core", () => {
    for (const row of CARRIED_OUT_ROWS)
      expect([row, CARRIED_OUT[row].refused]).toEqual([row, true])
    expect(Object.values(STANDS_FOR).filter((row) => row !== null)).toEqual([])
    expect(
      readDeployV2Payload(payload({ builds: [railpackBuild()] }))
    ).toMatchObject({ ok: false, error: { code: "unsupported_version" } })
  })
})
