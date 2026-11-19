/**
 * The version-2 payload's own fields and the order of its reading
 * (contracts/message.md, F4 to F19 and F7). The later fields' rules are in
 * later-fields.test.ts.
 */
import { describe, expect, test } from "bun:test"

import { readDeployV2Payload } from "../../src/deploy/message"
import { LIMITS } from "../../src/protocol/limits"
import {
  build,
  hex,
  KiB,
  listed,
  partThreeTwo,
  payload,
} from "../support/payload-v2"

const code = (json: unknown) => {
  const read = readDeployV2Payload(json)
  return read.ok ? "read" : read.error.code
}

/** A copy that went through JSON, as a payload does. */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe("a good payload", () => {
  test("with every later field empty, reads as itself", () => {
    const good = payload()
    const read = readDeployV2Payload(wire(good))
    expect(read).toEqual({ ok: true, value: good as never })
  })

  test("what it gives is frozen, all the way down", () => {
    const read = readDeployV2Payload(
      wire(
        payload({ secrets: listed(1), removed: [{ name: "OLD", version: 2 }] })
      )
    )
    if (!read.ok) throw new Error(read.error.code)
    expect(Object.isFrozen(read.value)).toBe(true)
    expect(Object.isFrozen(read.value.secrets)).toBe(true)
    expect(Object.isFrozen(read.value.secrets[0])).toBe(true)
    expect(Object.isFrozen(read.value.removed[0])).toBe(true)
  })
})

describe("F4: JSON that is an object", () => {
  // Each row in a list of its own: a row that is a list is spread into arguments.
  test.each([[undefined], [null], [42], ["text"], [true], [[]], [[payload()]]])(
    "%p is malformed",
    (json) => expect(code(json)).toBe("malformed")
  )
})

describe("F5: the strict schema", () => {
  test("every field is required", () => {
    for (const field of Object.keys(payload())) {
      const missing = payload()
      delete missing[field]
      expect([field, code(missing)]).toEqual([field, "malformed"])
    }
  })

  test("an unknown field is malformed, at the top and inside a list", () => {
    expect(code(payload({ note: "hello" }))).toBe("malformed")
    expect(code(payload({ secrets: [{ ...listed(1)[0], extra: true }] }))).toBe(
      "malformed"
    )
    expect(
      code(payload({ removed: [{ name: "OLD", version: 1, hash: null }] }))
    ).toBe("malformed")
    // A field named __proto__, as JSON.parse makes it: an own field like any other.
    const good = JSON.stringify(payload({ secrets: listed(1) }))
    expect(
      code(JSON.parse(good.replace('{"v":2', '{"__proto__":{"v":2},"v":2')))
    ).toBe("malformed")
    expect(
      code(
        JSON.parse(good.replace('"version":1}', '"version":1,"__proto__":{}}'))
      )
    ).toBe("malformed")
  })

  test("a field of the wrong type is malformed, never read as a default", () => {
    for (const [field, value] of [
      ["teamId", null],
      ["teamHash", 1],
      ["serverId", []],
      ["app", {}],
      ["previous", "41"],
      ["sequence", null],
      ["createdAt", 0],
      ["expiresAt", 0],
      ["expiresAt", false],
      ["compose", null],
      ["secrets", {}],
      ["removed", null],
      ["builds", null],
      ["predeploy", []],
      ["health", []],
      ["routes", null],
    ] as const)
      expect([field, code(payload({ [field]: value }))]).toEqual([
        field,
        "malformed",
      ])
  })
})

describe("F8 to F12: the fields version 1 has too", () => {
  test.each([1, 3, "2", null, 2.5, 0])("v %p is malformed", (v) =>
    expect(code(payload({ v }))).toBe("malformed")
  )

  test("teamId, teamHash, serverId and app keep their patterns", () => {
    for (const change of [
      { teamId: "team_short" },
      { teamId: `TEAM_${"A".repeat(22)}` },
      { teamHash: hex(0xabc).toUpperCase() },
      { teamHash: hex(1).slice(1) },
      { serverId: `srv_${"0".repeat(31)}` },
      { serverId: `srv_${"A".repeat(32)}` },
      { app: "Web" },
      { app: "-web" },
      { app: "a".repeat(64) },
      { app: "web/api" },
    ])
      expect([change, code(payload(change))]).toEqual([change, "malformed"])
    expect(code(payload({ app: "a".repeat(63) }))).toBe("read")
  })
})

describe("F13, F14 and F6: previous and sequence", () => {
  test("the first deploy of an app is made against 0", () => {
    expect(code(payload({ previous: 0, sequence: 1 }))).toBe("read")
  })

  test("previous is a whole number from 0 to 2^53 - 2", () => {
    const top = Number.MAX_SAFE_INTEGER
    expect(code(payload({ previous: top - 1, sequence: top }))).toBe("read")
    expect(code(payload({ previous: top, sequence: top + 1 }))).toBe(
      "malformed"
    )
    expect(code(payload({ previous: -1, sequence: 0 }))).toBe("malformed")
    expect(code(payload({ previous: 1.5, sequence: 2.5 }))).toBe("malformed")
  })

  test("sequence is exactly previous + 1", () => {
    for (const sequence of [41, 43, 0, 1])
      expect(code(payload({ previous: 41, sequence }))).toBe("malformed")
  })
})

describe("F15 and F16: the times", () => {
  test("createdAt is a time as version 1 reads it", () => {
    expect(code(payload({ createdAt: "2026-11-20T10:00:00Z" }))).toBe("read")
    for (const createdAt of ["yesterday", "2026-11-20T10:00:00", ""])
      expect(code(payload({ createdAt }))).toBe("malformed")
  })

  test("expiresAt is null, or a time written exactly as toISOString writes it", () => {
    expect(code(payload({ expiresAt: null }))).toBe("read")
    expect(code(payload({ expiresAt: "2026-11-20T10:00:00.000Z" }))).toBe(
      "read"
    )
    for (const expiresAt of [
      "2026-11-20T10:00:00Z",
      "2026-11-20T10:00:00.5Z",
      "2026-02-30T00:00:00.000Z",
      "2026-11-20T10:00:00.000+00:00",
      "2026-11-20",
      "",
    ])
      expect([expiresAt, code(payload({ expiresAt }))]).toEqual([
        expiresAt,
        "malformed",
      ])
  })
})

describe("F17: the Compose text", () => {
  test("is at most 256 KiB as UTF-8, counted in bytes, not characters", () => {
    const limit = LIMITS.composeBytes
    expect(limit).toBe(256 * KiB)
    // A three-byte character that ends exactly at the limit, then one that crosses it.
    expect(code(payload({ compose: `${"a".repeat(limit - 3)}€` }))).toBe("read")
    expect(code(payload({ compose: `${"a".repeat(limit - 2)}€` }))).toBe(
      "malformed"
    )
    expect(code(payload({ compose: "a".repeat(limit) }))).toBe("read")
    expect(code(payload({ compose: "a".repeat(limit + 1) }))).toBe("malformed")
  })
})

describe("F18, F19 and F6: secrets and removals", () => {
  test("at most 256 of each", () => {
    const removals = (count: number) =>
      Array.from({ length: count }, (_, n) => ({
        name: `R${String(n).padStart(3, "0")}`,
        version: 2,
      }))
    expect(
      code(payload({ secrets: listed(256), removed: removals(256) }))
    ).toBe("read")
    expect(code(payload({ secrets: listed(257) }))).toBe("malformed")
    expect(code(payload({ removed: removals(257) }))).toBe("malformed")
  })

  test("each entry keeps version 1's rules", () => {
    const [good] = listed(1)
    for (const entry of [
      { ...good, name: "1ABC" },
      { ...good, name: "A-B" },
      { ...good, name: "A".repeat(129) },
      { ...good, hash: hex(0xabc).toUpperCase() },
      { ...good, version: 0 },
      { ...good, version: 1.5 },
      { name: good!.name, version: 1 },
    ])
      expect(code(payload({ secrets: [entry] }))).toBe("malformed")
    expect(
      code(payload({ secrets: [{ ...good, name: "A".repeat(128) }] }))
    ).toBe("read")
    expect(code(payload({ removed: [{ name: "OLD", version: 0 }] }))).toBe(
      "malformed"
    )
  })

  test("each list is sorted by name, each name once, and no name in both", () => {
    const [a, b] = listed(2)
    expect(code(payload({ secrets: [b, a] }))).toBe("malformed")
    expect(code(payload({ secrets: [a, a] }))).toBe("malformed")
    expect(
      code(
        payload({
          removed: [
            { name: "B", version: 1 },
            { name: "A", version: 1 },
          ],
        })
      )
    ).toBe("malformed")
    expect(
      code(
        payload({
          removed: [
            { name: "A", version: 1 },
            { name: "A", version: 2 },
          ],
        })
      )
    ).toBe("malformed")
    expect(
      code(payload({ secrets: [a], removed: [{ name: a!.name, version: 2 }] }))
    ).toBe("malformed")
  })
})

describe("F7: what this step does not carry out", () => {
  const secrets = listed(1)
  const later = {
    builds: [build({}, secrets)],
    predeploy: {
      service: "web",
      command: ["bun", "run", "migrate"],
      timeout: 600,
    },
  }
  // Carried out since feature 015 (specs/015-domains-https, contracts/core.md, "Carried out").
  const carried = {
    health: { timeout: 120, services: [{ service: "web", http: null }] },
    routes: [{ domain: "demo.example.com", service: "web", port: 3000 }],
  }
  const broken = {
    builds: [build({ key: hex(5) }, secrets)],
    predeploy: { service: "web", command: [], timeout: 600 },
    health: { timeout: 0, services: [{ service: "web", http: null }] },
    routes: [{ domain: "demo.invalid", service: "web", port: 3000 }],
  }

  for (const field of Object.keys(later) as (keyof typeof later)[]) {
    test(`${field} alone and valid is unsupported_version`, () => {
      expect(code(payload({ secrets, [field]: later[field] }))).toBe(
        "unsupported_version"
      )
    })
  }

  for (const field of Object.keys(carried) as (keyof typeof carried)[]) {
    test(`${field} alone and valid reads`, () => {
      expect(code(payload({ secrets, [field]: carried[field] }))).toBe("read")
    })
  }

  for (const field of Object.keys(broken) as (keyof typeof broken)[]) {
    test(`${field} breaking its own rule is malformed first`, () => {
      expect(code(payload({ secrets, [field]: broken[field] }))).toBe(
        "malformed"
      )
    })
  }

  test("routes and a health check together read; with a later field they are unsupported_version", () => {
    expect(code(payload({ secrets, ...carried }))).toBe("read")
    expect(
      code(payload({ secrets, ...carried, predeploy: later.predeploy }))
    ).toBe("unsupported_version")
  })

  test("a later field is malformed first even when the deploy's own fields are fine and another later field is not empty", () => {
    expect(
      code(
        payload({ secrets, predeploy: later.predeploy, health: broken.health })
      )
    ).toBe("malformed")
  })

  test("a fault in the deploy's own fields is malformed before a later field is judged", () => {
    expect(
      code(payload({ secrets, predeploy: later.predeploy, sequence: 50 }))
    ).toBe("malformed")
  })

  test("the design's part 3.2 example reads to unsupported_version", () => {
    expect(code(wire(partThreeTwo()))).toBe("unsupported_version")
  })
})
