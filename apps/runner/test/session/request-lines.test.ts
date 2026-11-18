/**
 * How a session reads its input: one request per line, a line over the limit
 * let go of as it arrives (`requestLines`, src/session/session.ts).
 */
import { describe, expect, test } from "bun:test"

import { requestLines } from "../../src/session/session"

/** Splits `chunks` into lines the way a session reads its input, with a limit of 8 bytes. */
async function split(chunks: string[]): Promise<(string | null)[]> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })
  const lines: (string | null)[] = []
  for await (const line of requestLines(stream, 8))
    lines.push(line === null ? null : new TextDecoder().decode(line))
  return lines
}

describe("reading request lines", () => {
  test("a line may arrive in pieces, and the last one needs no line feed", async () => {
    expect(await split(['{"a"', ':1}\n{"b":2', "}\n", "\n", "last"])).toEqual([
      '{"a":1}',
      '{"b":2}',
      "",
      "last",
    ])
    expect(await split(["one\n"])).toEqual(["one"])
    expect(await split([])).toEqual([])
  })

  test("a line over the limit is given as null, however it arrives, and the next line is read as usual", async () => {
    expect(await split(["12345678\n123456789\nok\n"])).toEqual([
      "12345678",
      null,
      "ok",
    ])
    expect(await split(["1234", "5678", "9", "0\nok"])).toEqual([null, "ok"])
    expect(await split(["123456789"])).toEqual([null])
  })
})
