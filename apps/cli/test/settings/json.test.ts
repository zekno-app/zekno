/**
 * The settings file's JSON reader (specs/010-app-settings,
 * contracts/settings-file.md, "The JSON it must be"; tasks T005): the line
 * of every key, the text of every number, and each fault with its line,
 * never a piece of the text. Hostile texts of every kind the brief names.
 */
import { describe, expect, test } from "bun:test"

import {
  MAX_DEPTH,
  MAX_STRING,
  pathKey,
  readJson,
  type JsonFault,
  type JsonRead,
} from "../../src/settings/json"
import { DESIGN_FILE, SENTINEL } from "../support/settings-files"

/** The text read, or the test fails with the fault. */
function read(text: string): JsonRead {
  const got = readJson(text)
  if (!("value" in got))
    throw new Error(`expected JSON, got ${JSON.stringify(got)}`)
  return got
}

/** The fault of a text, which holds nothing of the text. */
function fault(text: string): JsonFault {
  const got = readJson(text)
  if ("value" in got) throw new Error("expected a fault, the text was read")
  expect(JSON.stringify(got)).not.toContain(SENTINEL)
  expect(Object.keys(got).sort()).toEqual(
    got.first === undefined ? ["kind", "line"] : ["first", "kind", "line"]
  )
  return got
}

describe("what it reads", () => {
  test("design.md's file: each key's line, keys joined with a dot", () => {
    const { lines } = read(DESIGN_FILE)
    expect(lines.get("services.web.deploy.memory")).toBe(9)
    expect(lines.get("zekno")).toBe(2)
    expect(lines.get("services.worker")).toBe(19)
    expect(lines.get("services.web.variables.secrets.1")).toBe(14)
    expect(lines.get("services.worker.variables.secrets.0")).toBe(22)
  })

  test("objects are Maps in the order written, lists are lists", () => {
    const { value } = read('{"b": 1, "a": [true, false, null], "1": {}}')
    expect(value).toBeInstanceOf(Map)
    const map = value as ReadonlyMap<string, unknown>
    expect([...map.keys()]).toEqual(["b", "a", "1"])
    expect(map.get("a")).toEqual([true, false, null])
    expect(map.get("1")).toEqual(new Map())
  })

  test("a number keeps its text, and its value", () => {
    const { value, numbers } = read(
      '{"cpus": 1.50, "n": -0, "e": 1e2, "big": 12345678901234567890}'
    )
    expect(numbers.get("cpus")).toBe("1.50")
    expect(numbers.get("e")).toBe("1e2")
    expect(numbers.get("n")).toBe("-0")
    expect((value as ReadonlyMap<string, unknown>).get("cpus")).toBe(1.5)
    expect(numbers.get("big")).toBe("12345678901234567890")
  })

  test("escapes are read; a surrogate pair is one character", () => {
    const { value } = read(
      '{"s": "\\"\\\\\\/\\b\\f\\n\\r\\t\\u0041\\ud83d\\ude80"}'
    )
    expect((value as ReadonlyMap<string, unknown>).get("s")).toBe(
      '"\\/\b\f\n\r\tA🚀'
    )
  })

  test("a lone surrogate is read as JSON allows it; the rules of a value refuse it later", () => {
    const { value } = read('{"s": "\\ud800"}')
    expect((value as ReadonlyMap<string, unknown>).get("s")).toBe("\ud800")
  })

  test("keys a prototype has stay keys of the Map, and reach no prototype", () => {
    const { value } = read('{"__proto__": {"polluted": 1}, "constructor": 2}')
    const map = value as ReadonlyMap<string, unknown>
    expect([...map.keys()]).toEqual(["__proto__", "constructor"])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  test("CRLF ends one line; a lone CR ends one too", () => {
    const { lines } = read('{\r\n"a": 1,\r\n"b": 2,\r"c": 3}')
    expect(lines.get("a")).toBe(2)
    expect(lines.get("b")).toBe(3)
    expect(lines.get("c")).toBe(4)
  })

  test("pathKey keeps two places apart even when a key holds a dot or a backslash", () => {
    expect(pathKey(["services", "web", "deploy", "memory"])).toBe(
      "services.web.deploy.memory"
    )
    expect(pathKey(["a.b"])).not.toBe(pathKey(["a", "b"]))
    expect(pathKey(["a\\", "b"])).not.toBe(pathKey(["a\\.b"]))
    const { lines } = read('{"a.b": 1,\n"a": {"b": 2}}')
    expect(lines.get(pathKey(["a.b"]))).toBe(1)
    expect(lines.get(pathKey(["a", "b"]))).toBe(2)
  })

  test("depth 6 and strings of 4096 characters are read", () => {
    expect(MAX_DEPTH).toBe(6)
    expect(MAX_STRING).toBe(4096)
    read('{"a":{"b":{"c":{"d":{"e":[1]}}}}}')
    read(`{"a": "${"x".repeat(4096)}"}`)
    read(`{"a": "${"🚀".repeat(4096)}"}`)
    read(`{"a": "${"\\u0041".repeat(4096)}"}`)
  })

  test("65,536 bytes of whitespace and one object read within 100 ms", () => {
    const text = `${" \t\r\n".repeat(16_382)}{"a": 1}`
    expect(Buffer.byteLength(text)).toBe(65_536)
    const started = performance.now()
    read(text)
    expect(performance.now() - started).toBeLessThan(100)
  })

  test("a file of 64 KiB of keys, of list items, or of long strings reads quickly", () => {
    const keys = `{${Array.from({ length: 6000 }, (_, at) => `"k${at}":0`).join(",")}}`
    const items = `{"a":[${Array.from({ length: 30_000 }, () => "0").join(",")}]}`
    const strings = `{${Array.from({ length: 15 }, (_, at) => `"s${at}":"${"x".repeat(4096)}"`).join(",")}}`
    for (const text of [keys, items, strings]) {
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65_536)
      const started = performance.now()
      read(text)
      expect(performance.now() - started).toBeLessThan(200)
    }
  })
})

describe("SJ1: not JSON, with the line", () => {
  const cases: [string, string, number][] = [
    ["a // comment", `{\n  // ${SENTINEL}\n  "a": 1\n}`, 2],
    ["a /* */ comment", `{\n  "a": 1 /* ${SENTINEL} */\n}`, 2],
    ["a trailing comma in an object", `{\n  "a": "${SENTINEL}",\n}`, 3],
    ["a trailing comma in a list", `{"a": ["${SENTINEL}",]}`, 1],
    ["a single-quoted string", `{\n  'a': '${SENTINEL}'\n}`, 2],
    ["NaN", `{\n\n  "a": NaN}`, 3],
    ["Infinity", `{"a": Infinity}`, 1],
    ["-Infinity", `{"a": -Infinity}`, 1],
    ["an unclosed string", `{\n  "a": "${SENTINEL}`, 2],
    ["a raw line break in a string", `{"a": "${SENTINEL}\nb"}`, 1],
    ["a tab inside a string", `{"a": "${SENTINEL}\tb"}`, 1],
    ["a control character inside a string", `{"a": "${SENTINEL}\u0001"}`, 1],
    ["text after the object", `{"a": 1}\n${SENTINEL}`, 2],
    ["a second object", `{"a": 1} {"b": 2}`, 1],
    ["an empty text", "", 1],
    ["only whitespace", " \n\n ", 3],
    ["a number with a leading zero", `{"a": 01}`, 1],
    ["a number with a plus", `{"a": +1}`, 1],
    ["a number with a point and nothing after", `{"a": 1.}`, 1],
    ["a number with a point and nothing before", `{"a": .5}`, 1],
    ["a hex number", `{"a": 0x1F}`, 1],
    ["an escape JSON does not have", `{"a": "\\x41${SENTINEL}"}`, 1],
    ["a \\u escape cut short", `{"a": "\\u12"}`, 1],
    ["a byte order mark (the reader does not drop it)", '\ufeff{"a": 1}', 1],
    ["a key that is not a string", `{a: "${SENTINEL}"}`, 1],
    ["a missing colon", `{"a" "${SENTINEL}"}`, 1],
    ["a missing comma", `{"a": 1 "b": 2}`, 1],
    ["true written in capitals", `{"a": True}`, 1],
    ["undefined", `{"a": undefined}`, 1],
    ["a form feed as whitespace", '{"a":\f1}', 1],
    ["a no-break space as whitespace", '{"a":\u00a01}', 1],
    ["an unclosed object", `{"a": {"b": 1}`, 1],
    ["an unclosed list", `{"a": [1, 2`, 1],
  ]
  for (const [name, text, line] of cases)
    test(name, () => {
      expect(fault(text)).toEqual({ line, kind: "syntax" })
    })
})

describe("SJ2: the same name twice in one object, compared after escapes", () => {
  test("names both lines", () => {
    expect(fault('{\n  "a": 1,\n  "b": 2,\n  "a": 3\n}')).toEqual({
      line: 4,
      kind: "twice",
      first: 2,
    })
  })

  test("a key hidden by an escape is the same key", () => {
    expect(fault('{"a": 1,\n"\\u0061": 2}')).toEqual({
      line: 2,
      kind: "twice",
      first: 1,
    })
  })

  test("in a nested object too", () => {
    expect(fault(`{"x": {\n"${SENTINEL}": 1,\n"${SENTINEL}": 2}}`)).toEqual({
      line: 3,
      kind: "twice",
      first: 2,
    })
  })

  test("the same key in two different objects is no fault", () => {
    read('{"a": {"k": 1}, "b": {"k": 2}, "c": [{"k": 3}, {"k": 4}]}')
  })

  test("__proto__ twice is caught", () => {
    expect(fault('{"__proto__": 1, "__proto__": 2}').kind).toBe("twice")
  })
})

describe("SJ3, SJ4, SJ5", () => {
  test("SJ3: 7 levels of nesting, at the line where the seventh opens", () => {
    expect(fault('{"a":{"b":{"c":{"d":{"e":{\n"f":{}}}}}}}')).toEqual({
      line: 2,
      kind: "deep",
    })
    expect(fault('{"a":[[[[[[1]]]]]]}')).toEqual({ line: 1, kind: "deep" })
  })

  test("SJ3: very deep nesting stops at once, with no stack overflow", () => {
    const deep = `{"a":${"[".repeat(30_000)}${"]".repeat(30_000)}}`
    expect(fault(deep)).toEqual({ line: 1, kind: "deep" })
  })

  test("SJ4: a key or a string of 4097 characters", () => {
    expect(fault(`{\n"a": "${SENTINEL}${"x".repeat(4097)}"}`)).toEqual({
      line: 2,
      kind: "long",
    })
    expect(fault(`{"${SENTINEL}${"k".repeat(4097)}": 1}`)).toEqual({
      line: 1,
      kind: "long",
    })
    expect(fault(`{"a": "${"\\u0041".repeat(4097)}"}`).kind).toBe("long")
    expect(fault(`{"a": "${"🚀".repeat(4097)}"}`).kind).toBe("long")
  })

  test("SJ4 comes in the order of the text: a long string before a later control character", () => {
    expect(fault(`{"a": "${"x".repeat(5000)}\u0001"}`).kind).toBe("long")
  })

  test("SJ5: a top that is a list, a string, a number, true or null", () => {
    for (const text of [
      `["${SENTINEL}"]`,
      `"${SENTINEL}"`,
      "12",
      "true",
      "null",
    ])
      expect(fault(text)).toEqual({ line: 1, kind: "top" })
  })

  test("SJ1 comes before SJ5: a list at the top with a fault inside", () => {
    expect(fault("[1,]").kind).toBe("syntax")
  })
})

describe("hostile text, read within bounds", () => {
  test("a huge list, many keys and long strings stay within a 64 KiB text", () => {
    const list = `{"a":[${"1,".repeat(32_000)}1]}`
    expect(read(list).numbers.size).toBe(32_001)
  })

  test("a number of 60,000 digits is read and kept as text", () => {
    const digits = "9".repeat(60_000)
    expect(read(`{"a": ${digits}}`).numbers.get("a")).toBe(digits)
  })

  test("invalid input of every kind gives a fault, never an exception", () => {
    const samples = [
      "\u0000",
      "{",
      "}",
      "{{",
      '{"a"',
      '{"a":',
      '{"a":1,',
      "[",
      '"',
      "\\",
      "\ud800",
      '{"\ud800": 1}',
      String.fromCharCode(...Array.from({ length: 200 }, (_, at) => at)),
    ]
    for (const text of samples) expect(() => readJson(text)).not.toThrow()
  })
})
