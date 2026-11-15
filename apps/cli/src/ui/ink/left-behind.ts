/**
 * What a question of single commands leaves on the screen at a terminal, as
 * the lines `Line` draws (lines.tsx).
 */
import type { Item } from "./lines"

/**
 * What each question leaves on the screen once it is answered, above
 * whatever comes next. A list collapses to `✔ Server  prod` (mock-ups 1 and
 * 2), except for a row that asks a question of its own (`+ a new app`). A
 * question left with Esc or Ctrl-C keeps its line as it was drawn, above
 * `✖ Nothing was done.` (board "Questions in single commands"): a typed
 * answer with what was typed and no cursor, the hidden prompt with nothing of
 * the value. The rest is research Q1, built as
 * recommended and not yet approved by the maintainer: a typed answer stays as
 * `? Your name › ada`; a yes-or-no question as `? <question> (y/N) yes`, the
 * questions that existed before included; the skippable hidden prompt as its
 * line ending `(hidden)` or `skipped`. The hidden prompt of `zekno secret set`
 * leaves nothing, as before.
 */
export const LEFT_BEHIND = {
  choose: (collapsed: string, label: string) => ({ kind: "chosen", collapsed, label }),
  left: (question: string, form: "list" | "typed" | "yes-or-no" | "hidden", answer?: string) => ({
    kind: "left",
    question,
    form,
    ...(answer === undefined ? {} : { answer }),
  }),
  ask: (question: string, answer: string) => ({ kind: "asked", question, answer }),
  confirm: (question: string, yes: boolean) => ({ kind: "answered", question, yes }),
  askValue: (question: string, skipped: boolean) => ({ kind: "hidden", question, skipped }),
} satisfies Record<string, (...args: never[]) => Omit<Item, "id">>
