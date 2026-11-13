/**
 * The keys the app acts on, read from what Ink reports. Anything else is
 * dropped here, so the reducer only ever sees keys it knows.
 */
import type { Key } from "ink"

import { isLateAnswer } from "../ui/background"

/** One key press, or a paste, as the reducer sees it. */
export type AppKey =
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "left" }
  | { kind: "right" }
  | { kind: "tab" }
  | { kind: "enter" }
  | { kind: "escape" }
  | { kind: "backspace" }
  | { kind: "ctrl-c" }
  /** Printable text: one key, or a paste. A command key is text of one character. */
  | { kind: "text"; text: string }

/**
 * Turns what Ink reports into a key the app knows, or undefined to ignore
 * it. Other control keys and Alt combinations are ignored, and so is a piece
 * of the terminal's answer to the background question that came too late to
 * be read before the app started: it is the terminal talking, not a person.
 */
export function toAppKey(input: string, key: Partial<Key>): AppKey | undefined {
  if (key.ctrl && input === "c") return { kind: "ctrl-c" }
  if (key.upArrow) return { kind: "up" }
  if (key.downArrow) return { kind: "down" }
  if (key.leftArrow) return { kind: "left" }
  if (key.rightArrow) return { kind: "right" }
  if (key.tab) return { kind: "tab" }
  if (key.return) return { kind: "enter" }
  if (key.escape) return { kind: "escape" }
  if (key.backspace || key.delete) return { kind: "backspace" }
  if (key.ctrl || key.meta || input === "" || isLateAnswer(input)) return undefined
  return { kind: "text", text: input }
}
