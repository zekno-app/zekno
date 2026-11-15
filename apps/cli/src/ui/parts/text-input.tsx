import { Text } from "ink"

import { useTheme } from "../terminal/theme"

/** What one key press or paste does to a visible answer being typed. */
export type TextInput = { kind: "typing"; value: string } | { kind: "done"; value: string } | { kind: "cancelled" }

type Key = { return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; meta?: boolean }

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/

/** Longer than any name, destination or filter the app asks for. */
export const TEXT_LIMIT = 256

/**
 * Applies input to a one-line answer: a name, an SSH destination, a filter.
 * Control keys and control characters never become part of it. A paste that
 * ends with one line break is a paste followed by Enter; a paste of several
 * lines is not an answer to a one-line question and changes nothing. Ctrl-C
 * is not handled here: it quits the app before it reaches a question.
 */
export function applyTextInput(value: string, input: string, key: Key, limit = TEXT_LIMIT): TextInput {
  if (key.escape) return { kind: "cancelled" }
  if (key.backspace || key.delete) return { kind: "typing", value: [...value].slice(0, -1).join("") }
  if (key.return && input.length <= 1) return { kind: "done", value }
  if (key.ctrl || key.meta) return { kind: "typing", value }

  let text = input.replace(/\r\n?/g, "\n")
  let done = false
  if (text.endsWith("\n")) {
    text = text.slice(0, -1)
    done = true
  }
  if (text.includes("\n") || CONTROL.test(text)) return { kind: "typing", value }
  const next = [...value, ...text]
  // Past the limit nothing more is taken, rather than cutting a paste somewhere in its middle.
  const kept = next.length > limit ? value : next.join("")
  return done ? { kind: "done", value: kept } : { kind: "typing", value: kept }
}

/**
 * A question and its answer so far: `? Your name › ada█`. A hidden answer is
 * never passed in, so it cannot be drawn; only the cursor and `note` show.
 */
export function TextQuestion({ label, value, hidden, note }: { label: string; value?: string; hidden?: boolean; note?: string }) {
  const theme = useTheme()
  return (
    <Text>
      <Text color={theme.brand}>?</Text> {label} <Text dimColor>›</Text> {hidden ? "" : (value ?? "")}
      <Text inverse> </Text>
      {note ? <Text dimColor> {note}</Text> : null}
    </Text>
  )
}
