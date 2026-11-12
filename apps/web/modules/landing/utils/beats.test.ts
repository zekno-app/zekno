import { describe, expect, test } from "bun:test"

import { beatAt, indexOfBeat, nextIndex, type Sequence, totalMs } from "./beats"

const sequence: Sequence<"a" | "b" | "c"> = [
  { id: "a", ms: 100 },
  { id: "b", ms: 200 },
  { id: "c", ms: 300 },
]

describe("totalMs", () => {
  test("sums the beat durations", () => {
    expect(totalMs(sequence)).toBe(600)
  })

  test("is zero for an empty sequence", () => {
    expect(totalMs([])).toBe(0)
  })
})

describe("nextIndex", () => {
  test("advances by one", () => {
    expect(nextIndex(0, 3, true)).toBe(1)
    expect(nextIndex(1, 3, false)).toBe(2)
  })

  test("wraps to the first beat when looping", () => {
    expect(nextIndex(2, 3, true)).toBe(0)
  })

  test("stays on the last beat when not looping", () => {
    expect(nextIndex(2, 3, false)).toBe(2)
  })

  test("returns 0 for an empty sequence", () => {
    expect(nextIndex(0, 0, true)).toBe(0)
  })
})

describe("beatAt", () => {
  test("starts on the first beat", () => {
    expect(beatAt(sequence, 0, true)).toBe(0)
    expect(beatAt(sequence, -50, true)).toBe(0)
  })

  test("changes exactly at beat boundaries", () => {
    expect(beatAt(sequence, 99, true)).toBe(0)
    expect(beatAt(sequence, 100, true)).toBe(1)
    expect(beatAt(sequence, 299, true)).toBe(1)
    expect(beatAt(sequence, 300, true)).toBe(2)
    expect(beatAt(sequence, 599, true)).toBe(2)
  })

  test("wraps around when looping", () => {
    expect(beatAt(sequence, 600, true)).toBe(0)
    expect(beatAt(sequence, 750, true)).toBe(1)
  })

  test("clamps to the last beat when not looping", () => {
    expect(beatAt(sequence, 600, false)).toBe(2)
    expect(beatAt(sequence, 10_000, false)).toBe(2)
  })

  test("returns 0 for an empty sequence", () => {
    expect(beatAt([], 500, true)).toBe(0)
  })
})

describe("indexOfBeat", () => {
  test("finds a beat by id", () => {
    expect(indexOfBeat(sequence, "c")).toBe(2)
  })
})
