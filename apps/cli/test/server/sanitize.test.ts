import { describe, expect, test } from "bun:test"

import { sanitize } from "../../src/server/sanitize"

const ESC = "\x1b"

/** True when nothing a terminal acts on is left: no control character and no invisible formatting. */
const isSafe = (text: string) =>
  !/[\x00-\x1f\x7f-\x9f\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(text)

describe("text from a server is drawn as text, never acted on", () => {
  test("colour and style codes are removed", () => {
    expect(
      sanitize(`${ESC}[31mred${ESC}[0m and ${ESC}[1;38;2;255;0;0mbold${ESC}[m`)
    ).toBe("red and bold")
    expect(sanitize(`${ESC}[38;5;196mx${ESC}[39;49m`)).toBe("x")
  })

  test("cursor movement, clearing and scrolling are removed", () => {
    for (const sequence of [
      "[2J",
      "[H",
      "[10A",
      "[3;7H",
      "[K",
      "[?25l",
      "[?1049h",
      "[>c",
      "[6n",
      "7",
      "8",
      "M",
      "c",
      "#8",
      "(0",
      "=",
      ">",
    ]) {
      expect(sanitize(`before${ESC}${sequence}after`)).toBe("beforeafter")
    }
  })

  test("an OSC 52 clipboard write is removed, with either terminator", () => {
    expect(sanitize(`ok${ESC}]52;c;ZXZpbCBjb21tYW5k\x07done`)).toBe("okdone")
    expect(sanitize(`ok${ESC}]52;c;ZXZpbCBjb21tYW5k${ESC}\\done`)).toBe(
      "okdone"
    )
  })

  test("a hyperlink keeps its visible text and loses where it points", () => {
    expect(
      sanitize(
        `see ${ESC}]8;;https://evil.example/${ESC}\\the docs${ESC}]8;;${ESC}\\ now`
      )
    ).toBe("see the docs now")
    expect(
      sanitize(`${ESC}]8;;https://evil.example/\x07click${ESC}]8;;\x07`)
    ).toBe("click")
  })

  test("a window title change and device control strings are removed", () => {
    expect(sanitize(`${ESC}]0;pwned\x07text`)).toBe("text")
    expect(sanitize(`${ESC}P1$r0m${ESC}\\text`)).toBe("text")
    expect(
      sanitize(`${ESC}_app${ESC}\\${ESC}^pm${ESC}\\${ESC}Xsos${ESC}\\text`)
    ).toBe("text")
  })

  test("a lone escape byte is removed", () => {
    expect(sanitize(ESC)).toBe("")
    expect(sanitize(`text${ESC}`)).toBe("text")
    expect(sanitize(`a${ESC}\nb`)).toBe("ab")
    expect(sanitize(`a${ESC}${ESC}`)).toBe("a")
    expect(sanitize(`a${ESC}é`)).toBe("aé")
  })

  test("half a sequence at the end of the text is removed, and nothing after it is invented", () => {
    for (const cut of [
      "[",
      "[31",
      "[1;",
      "[?25",
      "]",
      "]8;;https://evil",
      "]52;c;Zm9v",
      "P",
      "P1$r",
      "(",
      "#",
      " ",
    ]) {
      expect(sanitize(`kept${ESC}${cut}`)).toBe("kept")
    }
    expect(sanitize("kept\x9b")).toBe("kept")
    expect(sanitize("kept\x9b31")).toBe("kept")
    expect(sanitize("kept\x9d0;title")).toBe("kept")
  })

  test("the one-character forms of CSI, OSC and the string introducers are removed with what they carry", () => {
    expect(sanitize("\x9b31mred\x9b0m")).toBe("red")
    expect(sanitize("\x9d52;c;Zm9v\x07ok")).toBe("ok")
    expect(sanitize("\x9d8;;https://evil\x9clink\x9d8;;\x9c")).toBe("link")
    expect(sanitize("\x90dcs\x9cok")).toBe("ok")
  })

  test("a control sequence cut short by other text keeps that text", () => {
    expect(sanitize(`${ESC}[12ék`)).toBe("ék")
    // A space is an intermediate and "o" a final character, so this whole sequence is one.
    expect(sanitize(`${ESC}[12 ok`)).toBe("k")
    expect(sanitize(`${ESC}[31\x07red`)).toBe("red")
    // A string interrupted by another escape: the new one is read as a sequence of its own.
    expect(sanitize(`${ESC}]0;title${ESC}[31mred`)).toBe("red")
  })

  test("other control characters are removed: carriage return, backspace, bell, delete and the C1 range", () => {
    expect(sanitize("safe\rEVIL")).toBe("safeEVIL")
    expect(sanitize("abc\b\b\bxyz")).toBe("abcxyz")
    expect(sanitize("ding\x07\x00\x7f\x85\x8d\x9c")).toBe("ding")
    expect(sanitize("one\ntwo")).toBe("onetwo")
  })

  test("bidirectional overrides and zero-width characters that could disguise text are removed", () => {
    expect(sanitize("access‮⁦level⁩‬")).toBe("accesslevel")
    for (const hidden of [
      "‪",
      "‫",
      "‬",
      "‭",
      "‮",
      "⁦",
      "⁧",
      "⁨",
      "⁩",
      "‎",
      "‏",
      "؜",
    ]) {
      expect(sanitize(`a${hidden}b`)).toBe("ab")
    }
    for (const hidden of [
      "​",
      "‌",
      "‍",
      "⁠",
      "﻿",
      "­",
      " ",
      " ",
      "\u{e0041}",
      "\ud800",
    ]) {
      expect(sanitize(`a${hidden}b`)).toBe("ab")
    }
  })

  test("ordinary text in any script, and emoji, are kept as they are", () => {
    for (const text of [
      "Container zekno-demo-web-1  Started",
      "héllo wörld, ça va?",
      "日本語のログ行",
      "Привет, мир",
      "مرحبا بالعالم",
      "שלום עולם",
      "नमस्ते दुनिया",
      "🚀 deployed ✅ 👍🏽 🇳🇱 ❤️",
      `{"level":"info","msg":"ready","port":8080}`,
      "",
    ]) {
      expect(sanitize(text)).toBe(text)
    }
  })

  test("a tab becomes spaces up to the next tab stop", () => {
    expect(sanitize("a\tb")).toBe(`a${" ".repeat(7)}b`)
    expect(sanitize("\tat main.go:12")).toBe(`${" ".repeat(8)}at main.go:12`)
    expect(sanitize("12345678\tx")).toBe(`12345678${" ".repeat(8)}x`)
    expect(sanitize(`${ESC}[1mab${ESC}[0m\tc`)).toBe(`ab${" ".repeat(6)}c`)
  })

  test("any input gives safe text, and cleaning clean text changes nothing", () => {
    // A fixed seed, so a failure can be repeated.
    let seed = 20261114
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    const pieces = [
      ESC,
      "[",
      "]",
      "\\",
      "\x07",
      "\x9b",
      "\x9c",
      "\x9d",
      "\x90",
      "P",
      "8",
      ";",
      "m",
      "0",
      "\t",
      "\r",
      "\n",
      "‮",
      "‍",
      "a",
      "é",
      "日",
      "🚀",
      "\ud800",
      " ",
    ]
    for (let round = 0; round < 2000; round++) {
      let text = ""
      const length = Math.floor(random() * 40)
      for (let index = 0; index < length; index++)
        text += pieces[Math.floor(random() * pieces.length)]
      const cleaned = sanitize(text)
      expect(isSafe(cleaned)).toBe(true)
      expect(sanitize(cleaned)).toBe(cleaned)
    }
  })

  test("a long line is handled in one pass", () => {
    const line = `${`${ESC}[32m${"x".repeat(100)}${ESC}[0m`.repeat(160)}`
    expect(sanitize(line)).toBe("x".repeat(16000))
  })
})
