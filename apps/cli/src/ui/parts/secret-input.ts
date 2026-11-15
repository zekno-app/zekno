/** What one key press or paste does to a hidden value being typed. */
export type SecretInput =
  | { kind: "typing"; value: string }
  | { kind: "done"; value: string }
  | { kind: "cancelled" }
  | { kind: "rejected"; reason: string }

type Key = { return?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; meta?: boolean; escape?: boolean }

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

/**
 * Applies input to the value so far. A pasted value with a line break in it
 * is refused, not cut at the first line: a half-stored key is worse than a
 * clear instruction. Control keys never become part of the value.
 */
export function applySecretInput(value: string, input: string, key: Key): SecretInput {
  if (key.ctrl && input === "c") return { kind: "cancelled" }
  if (key.escape) return { kind: "cancelled" }
  if (key.backspace || key.delete) return { kind: "typing", value: [...value].slice(0, -1).join("") }
  if (key.return && input.length <= 1) return { kind: "done", value }
  if (key.ctrl || key.meta) return { kind: "typing", value }

  const text = input.replace(/\r\n?/g, "\n")
  const firstBreak = text.indexOf("\n")
  if (firstBreak !== -1) {
    // A paste that ends with one line break is a paste followed by Enter.
    if (firstBreak === text.length - 1 && !CONTROL.test(text.slice(0, -1))) {
      return { kind: "done", value: value + text.slice(0, -1) }
    }
    return { kind: "rejected", reason: "That value has more than one line. Pipe it in and add `--stdin`." }
  }
  if (CONTROL.test(text)) return { kind: "typing", value }
  return { kind: "typing", value: value + text }
}
