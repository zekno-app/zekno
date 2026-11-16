/**
 * Raw mode for the questions single commands ask at a terminal
 * (contracts/questions.md, "Keys typed before a question";
 * specs/006-cli-small-features/security-review.md, parts 3, 5 and 6). Every
 * question opens through `asking`: raw mode goes on first, then what was
 * typed before is thrown away, then the question is drawn, and raw mode goes
 * off once it settles. After a hidden value, raw mode is kept on instead
 * (`keepAfter`, `HeldInput`) until the next question opens in its place,
 * anything else is drawn, a step or a deploy starts, the interface closes,
 * or HOLD_MS pass, so the terminal never echoes what is typed between two
 * hidden values.
 */
import { useInput } from "ink"

import { discardTypedAhead } from "../terminal/type-ahead"
import { isCtrlC } from "./questions"
import type { State, Store } from "./store"

/**
 * How long raw mode is kept on after a hidden value when nothing else comes:
 * far longer than storing the value and preparing the next one take.
 */
const HOLD_MS = 2000

/**
 * The input between two hidden values of one flow (the first deploy's step
 * 7): raw mode stays on, so what is typed or pasted before the next prompt
 * is on the screen is never echoed by the terminal; it is thrown away, as the
 * next prompt throws away what was typed before it. Ctrl-C still interrupts,
 * as the terminal itself would make it do with raw mode off.
 */
export function HeldInput({ interrupt }: { interrupt(): void }) {
  useInput((input, key) => {
    if (isCtrlC(input, key)) interrupt()
  })
  return null
}

/**
 * Raw mode on `input`, the input Ink reads keys from, for the questions of
 * one interface: `asking` opens each question; `showQuestion` draws it in
 * place of anything held; `keepAfter` holds raw mode on after a hidden value,
 * and `release` lets go of it; `interrupt` is Ctrl-C while it is held.
 */
export function rawMode(input: NodeJS.ReadStream, store: Store) {
  // Raw mode kept on after a hidden value (`HeldInput`): until the next question, anything else, or HOLD_MS.
  let holding: ReturnType<typeof setTimeout> | undefined
  /** Lets go of raw mode kept on after a hidden value; Ink turns it off once nothing reads keys. */
  const release = () => {
    if (holding === undefined) return
    clearTimeout(holding)
    holding = undefined
    store.set({ hold: false })
  }
  /** Keeps raw mode on after a hidden value, in the same update that takes the prompt away, so it never goes off between them. */
  const keepAfter = (next: Partial<State>) => {
    clearTimeout(holding)
    holding = setTimeout(release, HOLD_MS)
    store.set({ ...next, hold: true })
  }
  /** Opens a question in place of anything held, in one update, so raw mode stays on from one to the next. */
  const showQuestion = (next: Partial<State>) => {
    clearTimeout(holding)
    holding = undefined
    store.set({ ...next, hold: false })
  }
  /** Ctrl-C while raw mode is held: raw mode off, then the interrupt the terminal would have sent. */
  function interrupt() {
    release()
    try {
      input.setRawMode(false)
    } catch {
      // The terminal went away. There is nothing left to put back.
    }
    process.kill(process.pid, "SIGINT")
  }

  /**
   * Opens one question at a terminal (contracts/questions.md, "Keys typed
   * before a question"): raw mode goes on first, so nothing typed from now on
   * is echoed or held back by the terminal; what was typed before is thrown
   * away; then the question is drawn by `open`, which settles once.
   */
  async function asking<T>(
    open: (resolve: (value: T) => void, reject: (error: Error) => void) => void
  ): Promise<T> {
    input.setRawMode(true)
    try {
      // What was typed before the question is drawn is not its answer, such as a `y` typed while the keychain asked.
      await discardTypedAhead(input)
      return await new Promise<T>((resolve, reject) => {
        let settled = false
        open(
          (value) => {
            if (settled) return
            settled = true
            resolve(value)
          },
          (error) => {
            if (settled) return
            settled = true
            reject(error)
          }
        )
      })
    } finally {
      // Kept on when a hidden value asked to hold it (`keepAfter`); Ink turns it off with the next question gone.
      if (store.get().hold !== true) input.setRawMode(false)
    }
  }

  return { asking, showQuestion, keepAfter, release, interrupt }
}
