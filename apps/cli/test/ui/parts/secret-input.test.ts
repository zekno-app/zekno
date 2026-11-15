import { describe, expect, test } from "bun:test"

import { applySecretInput } from "../src/ui/secret-input"
import { plainUi } from "../src/ui/plain"

describe("typing a hidden value", () => {
  test("characters are added and Enter finishes", () => {
    expect(applySecretInput("ab", "c", {})).toEqual({ kind: "typing", value: "abc" })
    expect(applySecretInput("abc", "\r", { return: true })).toEqual({ kind: "done", value: "abc" })
    expect(applySecretInput("abc", "", { return: true })).toEqual({ kind: "done", value: "abc" })
    expect(applySecretInput("", "", { return: true })).toEqual({ kind: "done", value: "" })
  })

  test("backspace removes one whole character, also one made of two code units", () => {
    expect(applySecretInput("abc", "", { backspace: true })).toEqual({ kind: "typing", value: "ab" })
    expect(applySecretInput("a🔑", "", { delete: true })).toEqual({ kind: "typing", value: "a" })
    expect(applySecretInput("", "", { backspace: true })).toEqual({ kind: "typing", value: "" })
  })

  test("a pasted value is taken whole; one trailing line break counts as Enter", () => {
    expect(applySecretInput("", "sk_live_abc123", {})).toEqual({ kind: "typing", value: "sk_live_abc123" })
    expect(applySecretInput("", "sk_live_abc123\n", {})).toEqual({ kind: "done", value: "sk_live_abc123" })
    expect(applySecretInput("x", "yz\r\n", {})).toEqual({ kind: "done", value: "xyz" })
  })

  test("a value of several lines is refused, never cut at the first line", () => {
    const pasted = applySecretInput("", "-----BEGIN KEY-----\nabc\n-----END KEY-----\n", {})
    expect(pasted.kind).toBe("rejected")
    expect(pasted.kind === "rejected" && pasted.reason).toContain("--stdin")
  })

  test("Ctrl-C and Escape cancel; other control keys change nothing", () => {
    expect(applySecretInput("abc", "c", { ctrl: true })).toEqual({ kind: "cancelled" })
    expect(applySecretInput("abc", "", { escape: true })).toEqual({ kind: "cancelled" })
    expect(applySecretInput("abc", "a", { ctrl: true })).toEqual({ kind: "typing", value: "abc" })
    expect(applySecretInput("abc", "\u0007", {})).toEqual({ kind: "typing", value: "abc" })
    expect(applySecretInput("abc", "f", { meta: true })).toEqual({ kind: "typing", value: "abc" })
  })

  test("tabs and spaces are part of a value", () => {
    expect(applySecretInput("a", " b\tc", {})).toEqual({ kind: "typing", value: "a b\tc" })
  })
})

describe("the plain interface", () => {
  test("results go to standard output, warnings and errors to standard error", async () => {
    const out: string[] = []
    const err: string[] = []
    const ui = plainUi((line) => out.push(line), (line) => err.push(line))
    ui.info("a")
    ui.success("b")
    ui.field("Team code", "ABCD")
    ui.table([["x", "1"], ["y", "2"]])
    ui.json({ ok: true })
    ui.warn("careful")
    ui.error("no")
    expect(await ui.step("Working", async () => 42)).toBe(42)
    expect(out).toEqual(["a", "b", "Team code: ABCD", "x\t1", "y\t2", '{"ok":true}'])
    expect(err).toEqual(["careful", "no"])
  })

  test("without a terminal a value is never asked for, only read from a pipe", () => {
    const ui = plainUi(() => {}, () => {})
    expect(() => ui.askSecret("Value: ", false)).toThrow("--stdin")
  })
})
