/**
 * The rules every sentence of specs/014-deploy-v2/design/lines.md keeps, for
 * the tests of the words themselves: a refusal's first sentence is drawn bold
 * and fits one line of 100 columns beside its mark (at most 98 characters);
 * no em dash; the runner is never called an agent.
 */
import { expect } from "bun:test"

/** A text's first sentence: up to the first full stop followed by a space or the end. */
export const firstSentence = (text: string): string =>
  /^[\s\S]*?\.(?= |$)/.exec(text)?.[0] ?? text

/** Fails unless the first sentence of `refusal` is at most 98 characters. */
export function fitsOneLine(refusal: string): void {
  const first = firstSentence(refusal)
  expect({ first, fits: first.length <= 98 }).toEqual({ first, fits: true })
}

/** Fails on an em dash, or on "agent" anywhere in `text`. */
export function keepsTheHabits(text: string): void {
  expect(text).not.toContain("—")
  expect(text.toLowerCase()).not.toContain("agent")
}
