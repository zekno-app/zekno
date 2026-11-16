/**
 * The start command (specs/010-app-settings, contracts/settings-file.md,
 * "The start command"; contracts/compose-text.md, "Reading it back"; tasks
 * T007): the words it splits into, what it refuses and why, and joining
 * words back into a command that splits the same.
 */
import { describe, expect, test } from "bun:test"

import { checkStart, joinStart, splitStart } from "../../src/settings/values"

describe("the start command (contracts/settings-file.md, The start command)", () => {
  test("every row of the table", () => {
    expect(splitStart("bun run start")).toEqual({
      words: ["bun", "run", "start"],
    })
    expect(splitStart("  node   server.js  ")).toEqual({
      words: ["node", "server.js"],
    })
    expect(splitStart("sh -c 'echo $PORT && exit 0'")).toEqual({
      words: ["sh", "-c", "echo $PORT && exit 0"],
    })
    expect(splitStart('node -e "console.log(\\"hi\\")"')).toEqual({
      words: ["node", "-e", 'console.log("hi")'],
    })
    expect(splitStart("echo it's")).toEqual({ problem: "quote" })
    expect(splitStart("npm run a && npm run b")).toEqual({ problem: "shell" })
    expect(splitStart("echo $HOME")).toEqual({ problem: "shell" })
    expect(splitStart("")).toEqual({ problem: "empty" })
    expect(splitStart("   ")).toEqual({ problem: "empty" })
  })

  test("quotes join with what is next to them; a word of only quotes is one empty word", () => {
    expect(splitStart("a'b c'd")).toEqual({ words: ["ab cd"] })
    expect(splitStart(`"a"'b'c`)).toEqual({ words: ["abc"] })
    expect(splitStart("x '' y")).toEqual({ words: ["x", "", "y"] })
    expect(splitStart('""')).toEqual({ words: [""] })
    expect(splitStart(`"it's" 'say "hi"'`)).toEqual({
      words: ["it's", 'say "hi"'],
    })
    expect(splitStart(`"a\\\\b"`)).toEqual({ words: ["a\\b"] })
    expect(splitStart("é 東京 🚀")).toEqual({ words: ["é", "東京", "🚀"] })
  })

  test("each shell character outside quotes is refused, and taken inside them", () => {
    for (const char of [";", "&", "|", "<", ">", "(", ")", "$", "`"]) {
      expect(splitStart(`a ${char} b`)).toEqual({ problem: "shell" })
      expect(splitStart(`a '${char}' "${char}"`)).toEqual({
        words: ["a", char, char],
      })
    }
  })

  test("a backslash outside quotes, or in double quotes before anything but a quote or a backslash, is refused", () => {
    expect(splitStart("a\\ b")).toEqual({ problem: "shell" })
    expect(splitStart('"C:\\temp"')).toEqual({ problem: "shell" })
    expect(splitStart("'C:\\temp'")).toEqual({ words: ["C:\\temp"] })
    expect(splitStart('"abc\\')).toEqual({ problem: "quote" })
    expect(splitStart('"abc')).toEqual({ problem: "quote" })
  })

  test("4096 characters and 256 words, and no control character", () => {
    expect(splitStart("a".repeat(4096))).toEqual({ words: ["a".repeat(4096)] })
    expect(splitStart("a".repeat(4097))).toEqual({ problem: "long" })
    expect(splitStart("🚀".repeat(4096))).toEqual({
      words: ["🚀".repeat(4096)],
    })
    expect("words" in splitStart(Array(256).fill("w").join(" "))).toBe(true)
    expect(splitStart(Array(257).fill("w").join(" "))).toEqual({
      problem: "long",
    })
    for (const text of [
      "a\tb",
      "a\nb",
      "a\rb",
      "a\u0000b",
      "a\u2028b",
      "a\u001b[2Jb",
    ])
      expect(splitStart(text)).toEqual({ problem: "control" })
  })

  test("checkStart says the reason as a sentence", () => {
    expect(checkStart("bun run start")).toBeUndefined()
    expect(checkStart(" ")).toBe(
      "Use a command, or leave start out to run the image's own."
    )
    expect(checkStart("echo it's")).toBe("A quote does not close.")
    expect(checkStart("a && b")).toBe(
      "It runs without a shell, so put ; & | < > ( ) $ and backquotes in quotes. To use a shell, start it with sh -c."
    )
    expect(checkStart("a".repeat(4097))).toBe(
      "Use at most 4096 characters and 256 words."
    )
    expect(checkStart("a\tb")).toBe("Use one line with no control character.")
  })

  test("joinStart gives back the same words (contracts/compose-text.md, Reading it back)", () => {
    const cases: string[][] = [
      ["bun", "run", "start"],
      ["node", "server.js"],
      ["sh", "-c", "echo $PORT && exit 0"],
      ["node", "-e", 'console.log("hi")'],
      ["a", "", "b"],
      [""],
      [
        'say "hi"',
        "back\\slash",
        "$HOME",
        "${X}",
        "a;b",
        "a b",
        "it's",
        "`id`",
        "|",
        "<>",
        "()",
        "&",
      ],
      ["é", "東京", "🚀", "tab-free"],
    ]
    for (const words of cases) {
      const joined = joinStart(words)
      expect([words, splitStart(joined)]).toEqual([words, { words }])
    }
    expect(joinStart(["bun", "run", "start"])).toBe("bun run start")
    expect(joinStart(["sh", "-c", "echo $PORT"])).toBe('sh -c "echo $PORT"')
    expect(joinStart(['a"b\\c'])).toBe('"a\\"b\\\\c"')
  })
})
