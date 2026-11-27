/**
 * What this core carries out (specs/016-build-from-source, contracts/core.md
 * CO7 and CO8; FR-037h, FR-082, FR-083): the table at step 1's column, the
 * rows a deploy asks for, and the order of the readers: a deploy that breaks
 * a rule is `malformed` first, and only a well-formed one that asks for a
 * refused row is `unsupported_version`.
 */
import { describe, expect, test } from "bun:test"

import { utf8 } from "../../src/crypto/encoding"
import {
  CARRIED_OUT,
  carriedOut,
  rowsAskedFor,
  type CarriedOutRow,
  type CarriedOutTable,
} from "../../src/deploy/carried-out"
import {
  readDeployV2Bytes,
  readDeployV2Format,
  readDeployV2Payload,
  readDeployV2PayloadBytes,
} from "../../src/deploy/message"
import { build, hex, payload, railpackBuild } from "../support/payload-v2"

const ROWS: readonly CarriedOutRow[] = [
  "railpack",
  "build_secrets",
  "railpack_secrets",
  "railpack_fresh",
  "railpack_no_network",
  "predeploy",
]

const code = (json: unknown) => {
  const read = readDeployV2Payload(json)
  return read.ok ? "read" : read.error.code
}

/** The payload read by F4 to F6 only, as a deploy that keeps every rule. */
const formatOf = (json: unknown) => {
  const read = readDeployV2Format(json)
  if (!read.ok) throw new Error(`a fixture did not read: ${read.error.code}`)
  return read
}

/** A table with only these rows refused. */
const refusing = (...rows: CarriedOutRow[]): CarriedOutTable =>
  Object.fromEntries(
    ROWS.map((row) => [row, { refused: rows.includes(row) }])
  ) as unknown as CarriedOutTable

const NPM_TOKEN = { name: "NPM_TOKEN", hash: hex(4), version: 1 }
const PREDEPLOY = { service: "web", command: ["bun", "migrate"], timeout: 60 }
/** The payload's own number: `fresh` may be at most this (CO2). */
const SEQUENCE = 42

/** Each row of CO7, a deploy that asks for it, and every row that deploy asks for. */
const CASES: [CarriedOutRow, Record<string, unknown>, CarriedOutRow[]][] = [
  ["railpack", payload({ builds: [railpackBuild()] }), ["railpack"]],
  [
    "build_secrets",
    payload({
      secrets: [NPM_TOKEN],
      builds: [build({ secrets: ["NPM_TOKEN"] }, [NPM_TOKEN])],
    }),
    ["build_secrets"],
  ],
  [
    "railpack_secrets",
    payload({
      secrets: [NPM_TOKEN],
      builds: [railpackBuild({ secrets: ["NPM_TOKEN"] }, [NPM_TOKEN])],
    }),
    ["railpack", "build_secrets", "railpack_secrets"],
  ],
  [
    "railpack_fresh",
    payload({ builds: [railpackBuild({ fresh: SEQUENCE })] }),
    ["railpack", "railpack_fresh"],
  ],
  [
    "railpack_no_network",
    payload({ builds: [railpackBuild({ network: "none" })] }),
    ["railpack", "railpack_no_network"],
  ],
  ["predeploy", payload({ predeploy: PREDEPLOY }), ["predeploy"]],
]

describe("CO7: the table at step 1", () => {
  test("one entry per row of CO7, in its order, every one refused", () => {
    expect(Object.keys(CARRIED_OUT)).toEqual([...ROWS])
    for (const row of ROWS)
      expect([row, CARRIED_OUT[row].refused]).toEqual([row, true])
  })

  test("is frozen, all the way down", () => {
    expect(Object.isFrozen(CARRIED_OUT)).toBe(true)
    for (const row of ROWS) expect(Object.isFrozen(CARRIED_OUT[row])).toBe(true)
  })
})

describe("CO7: each row alone", () => {
  test.each(CASES)("%s", (row, json, asked) => {
    const read = formatOf(json)
    expect(rowsAskedFor(read.value)).toEqual(asked)
    // Refused at step 1.
    expect(code(json)).toBe("unsupported_version")
    // Refused by a table that refuses only this row; carried out once every row is lifted.
    expect(carriedOut(read, refusing(row))).toEqual({
      ok: false,
      error: { code: "unsupported_version", message: expect.any(String) },
    })
    expect(carriedOut(read, refusing())).toBe(read)
    // Lifting this row alone carries it out only when the deploy asks for no other.
    const others = ROWS.filter((one) => one !== row)
    expect(carriedOut(read, refusing(...others)).ok).toBe(asked.length === 1)
  })

  test("a Railpack build's fresh below the deploy's number asks for no fresh row", () => {
    const read = formatOf(
      payload({ builds: [railpackBuild({ fresh: SEQUENCE - 1 })] })
    )
    expect(rowsAskedFor(read.value)).toEqual(["railpack"])
  })
})

describe("CO7: a deploy that hits two rows", () => {
  test("is still one refusal", () => {
    const json = payload({
      secrets: [NPM_TOKEN],
      builds: [
        railpackBuild({ secrets: ["NPM_TOKEN"], network: "none" }, [NPM_TOKEN]),
      ],
      predeploy: PREDEPLOY,
    })
    expect(rowsAskedFor(formatOf(json).value).length).toBeGreaterThan(2)
    expect(readDeployV2Payload(json)).toEqual({
      ok: false,
      error: { code: "unsupported_version", message: expect.any(String) },
    })
  })
})

describe("CO7: malformed before unsupported_version", () => {
  test("a Railpack build that breaks a rule is malformed", () => {
    const good = railpackBuild()
    for (const broken of [
      { ...good, key: hex(0) },
      { ...good, timeout: 0 },
      railpackBuild({
        builder: { ...good.builder, version: "1" } as typeof good.builder,
      }),
      railpackBuild({ fresh: SEQUENCE + 1 }),
    ])
      expect(code(payload({ builds: [broken] }))).toBe("malformed")
    const asking = railpackBuild({ secrets: ["NPM_TOKEN"] }, [NPM_TOKEN])
    // Its build secret not listed, with a pre-deploy command beside it.
    expect(code(payload({ builds: [asking], predeploy: PREDEPLOY }))).toBe(
      "malformed"
    )
  })
})

describe("CO7: Dockerfile builds with no secret are carried out", () => {
  const variants = [] as ReturnType<typeof build>[]
  for (const network of ["default", "none"] as const)
    for (const fresh of [null, 1, SEQUENCE])
      for (const target of [null, "prod"])
        for (const args of [[], [{ name: "NODE_ENV", value: "production" }]])
          variants.push(
            build({
              builder: { name: "dockerfile", dockerfile: "Dockerfile", target },
              network,
              fresh,
              args,
            })
          )

  test("in every allowed combination, alone", () => {
    for (const made of variants) {
      const json = payload({ builds: [made] })
      expect(rowsAskedFor(formatOf(json).value)).toEqual([])
      expect([made, code(json)]).toEqual([made, "read"])
    }
  })

  test("several together, beside routes and a health check", () => {
    const builds = variants
      .filter((_, n) => n % 3 === 0)
      .map((made, n) =>
        build({
          ...made,
          key: undefined,
          pack: { ...made.pack, hash: hex(600 + n) },
        })
      )
      .sort((a, b) => (a.key < b.key ? -1 : 1))
    expect(builds.length).toBeGreaterThan(1)
    expect(
      code(
        payload({
          builds,
          health: { timeout: 60, services: [{ service: "web", http: null }] },
          routes: [{ domain: "demo.example.com", service: "web", port: 3000 }],
        })
      )
    ).toBe("read")
  })
})

describe("CO8: the readers that do not judge what a runner carries out", () => {
  test.each(CASES)(
    "readDeployV2Format and readDeployV2Bytes read %s; the payload readers refuse it",
    (_, json) => {
      const read = formatOf(json)
      const bytes = utf8(JSON.stringify(read.value))
      expect(readDeployV2Bytes(bytes).ok).toBe(true)
      expect(readDeployV2PayloadBytes(bytes)).toEqual({
        ok: false,
        error: { code: "unsupported_version", message: expect.any(String) },
      })
    }
  )
})
