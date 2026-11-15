import { describe, expect, test } from "bun:test"

import { applyConfirmKey, keyName, type Choice } from "../src/ui/confirm"
import { applySelectKey, clampIndex } from "../src/ui/select"
import { applyTextInput, TEXT_LIMIT } from "../src/ui/text-input"

describe("a list", () => {
  test("↑ and ↓ move one row and stop at the first and last rows", () => {
    expect(applySelectKey(0, 3, { downArrow: true })).toEqual({ kind: "moved", index: 1 })
    expect(applySelectKey(2, 3, { upArrow: true })).toEqual({ kind: "moved", index: 1 })
    expect(applySelectKey(2, 3, { downArrow: true })).toEqual({ kind: "ignored" })
    expect(applySelectKey(0, 3, { upArrow: true })).toEqual({ kind: "ignored" })
  })

  test("enter chooses the selected row; esc cancels; other keys are ignored", () => {
    expect(applySelectKey(1, 3, { return: true })).toEqual({ kind: "chosen", index: 1 })
    expect(applySelectKey(1, 3, { escape: true })).toEqual({ kind: "cancelled" })
    expect(applySelectKey(1, 3, {})).toEqual({ kind: "ignored" })
  })

  test("an empty list chooses nothing; a selection past the end is brought back inside", () => {
    expect(applySelectKey(0, 0, { return: true })).toEqual({ kind: "ignored" })
    expect(applySelectKey(0, 0, { downArrow: true })).toEqual({ kind: "ignored" })
    expect(applySelectKey(0, 0, { escape: true })).toEqual({ kind: "cancelled" })
    expect(applySelectKey(7, 3, { return: true })).toEqual({ kind: "chosen", index: 2 })
    expect(applySelectKey(7, 3, { upArrow: true })).toEqual({ kind: "moved", index: 1 })
    expect(clampIndex(-1, 3)).toBe(0)
    expect(clampIndex(5, 3)).toBe(2)
    expect(clampIndex(5, 0)).toBe(0)
  })
})

describe("a one-line answer", () => {
  test("characters are added, backspace removes one whole character, enter finishes", () => {
    expect(applyTextInput("ad", "a", {})).toEqual({ kind: "typing", value: "ada" })
    expect(applyTextInput("ada", "", { backspace: true })).toEqual({ kind: "typing", value: "ad" })
    expect(applyTextInput("a🔑", "", { delete: true })).toEqual({ kind: "typing", value: "a" })
    expect(applyTextInput("", "", { backspace: true })).toEqual({ kind: "typing", value: "" })
    expect(applyTextInput("ada", "\r", { return: true })).toEqual({ kind: "done", value: "ada" })
  })

  test("esc cancels", () => {
    expect(applyTextInput("ada", "", { escape: true })).toEqual({ kind: "cancelled" })
  })

  test("a paste is taken whole; one trailing line break counts as enter", () => {
    expect(applyTextInput("", "deploy@203.0.113.7", {})).toEqual({ kind: "typing", value: "deploy@203.0.113.7" })
    expect(applyTextInput("", "deploy@203.0.113.7\n", {})).toEqual({ kind: "done", value: "deploy@203.0.113.7" })
    expect(applyTextInput("a", "da\r\n", {})).toEqual({ kind: "done", value: "ada" })
  })

  test("a paste of several lines is not an answer to a one-line question and changes nothing", () => {
    expect(applyTextInput("x", "one\ntwo", {})).toEqual({ kind: "typing", value: "x" })
    expect(applyTextInput("x", "one\ntwo\n", {})).toEqual({ kind: "typing", value: "x" })
  })

  test("control keys and control characters never become part of the answer", () => {
    expect(applyTextInput("ada", "a", { ctrl: true })).toEqual({ kind: "typing", value: "ada" })
    expect(applyTextInput("ada", "b", { meta: true })).toEqual({ kind: "typing", value: "ada" })
    expect(applyTextInput("ada", "\x1b[31m", {})).toEqual({ kind: "typing", value: "ada" })
    expect(applyTextInput("ada", "\x07", {})).toEqual({ kind: "typing", value: "ada" })
    expect(applyTextInput("ada", "\u009b", {})).toEqual({ kind: "typing", value: "ada" })
  })

  test("past the limit nothing more is taken", () => {
    const full = "a".repeat(TEXT_LIMIT)
    expect(applyTextInput(full, "b", {})).toEqual({ kind: "typing", value: full })
    expect(applyTextInput("ab", "cd", {}, 3)).toEqual({ kind: "typing", value: "ab" })
    expect(applyTextInput("ab", "c", {}, 3)).toEqual({ kind: "typing", value: "abc" })
  })
})

describe("a question with fixed answers", () => {
  const choices: Choice<"write" | "skip" | "cancel">[] = [
    { key: "enter", answer: "write", does: "write it and deploy" },
    { key: "n", answer: "skip", does: "deploy without it" },
    { key: "esc", answer: "cancel", does: "cancel" },
  ]

  test("each answer's key gives it", () => {
    expect(applyConfirmKey(choices, "\r", { return: true })).toBe("write")
    expect(applyConfirmKey(choices, "n", {})).toBe("skip")
    expect(applyConfirmKey(choices, "", { escape: true })).toBe("cancel")
  })

  test("any other key gives nothing, including q, a capital N and Ctrl-N", () => {
    expect(applyConfirmKey(choices, "q", {})).toBeUndefined()
    expect(applyConfirmKey(choices, "N", {})).toBeUndefined()
    expect(applyConfirmKey(choices, "n", { ctrl: true })).toBeUndefined()
    expect(applyConfirmKey(choices, "nn", {})).toBeUndefined()
  })

  test("keys are named as the boards name them", () => {
    expect(keyName("\r", { return: true })).toBe("enter")
    expect(keyName("", { escape: true })).toBe("esc")
    expect(keyName("u", {})).toBe("u")
    expect(keyName("u", { meta: true })).toBeUndefined()
  })
})
