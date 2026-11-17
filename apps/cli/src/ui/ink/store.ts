/**
 * What single commands have on the terminal (`inkUi`, ink.tsx): the lines
 * written once, let go of once enough of them pile up, and what is live
 * below them: a running deploy, an open question, work in progress, or raw
 * mode kept on between two hidden values.
 */
import type { ListRow } from "../types"
import type { DeployShown } from "./deploy-view"
import type { Prompt, ValueOpen } from "./hidden-prompts"
import type { Item } from "./lines"
import type { Settled } from "./questions"
import type { Question } from "./yes-or-no"

/** A list open on the screen. `id` makes each question a new one on the screen, never the one before it reused. */
export type ListOpen = {
  id: number
  question: string
  rows: readonly ListRow<unknown>[]
  settle(result: Settled<number>): void
}
/** A list to pick several rows from, open on the screen (several.tsx). */
export type SeveralOpen = {
  id: number
  question: string
  labels: readonly string[]
  atLeastOne: string
  settle(result: Settled<number[]>): void
}
/** A one-line answer being typed. */
export type TypedOpen = {
  id: number
  question: string
  fill?: string
  check(answer: string): string | undefined
  settle(result: Settled<string>): void
}
/**
 * `generation` changes when lines already drawn are let go; Static then
 * starts afresh with what is left. `deploy` is a deploy still running, drawn
 * below the lines and redrawn as it goes; once it ends it becomes a line.
 * `step` is work in progress, with a spinner, or `still` without one.
 * `hold`: raw mode is kept on after a hidden value, until the next question
 * or anything else (`HeldInput`).
 */
export type State = {
  items: Item[]
  generation: number
  step?: { label: string; still: boolean }
  prompt?: Prompt
  question?: Question
  list?: ListOpen
  several?: SeveralOpen
  typed?: TypedOpen
  value?: ValueOpen
  deploy?: DeployShown
  hold?: boolean
}

/**
 * How many drawn lines may pile up before they are let go. Static writes a
 * line once and never again, so keeping it only costs memory, and a server
 * can send lines without end.
 */
const DRAWN_KEPT = 200

export function createStore() {
  let state: State = { items: [], generation: 0 }
  /** How many items of this generation are already on the terminal. */
  let drawn = 0
  let nextId = 0
  const listeners = new Set<() => void>()
  const set = (next: Partial<State>) => {
    state = { ...state, ...next }
    listeners.forEach((listener) => listener())
  }
  return {
    get: () => state,
    set,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    add(item: Record<string, unknown>) {
      const added = { ...item, id: nextId++ } as Item
      if (drawn < DRAWN_KEPT) return set({ items: [...state.items, added] })
      // Only lines not yet drawn go on to the next Static, so none is lost and none drawn twice.
      set({
        items: [...state.items.slice(drawn), added],
        generation: state.generation + 1,
      })
      drawn = 0
    },
    /** Called once a commit has written the first `count` items of `generation` to the terminal. */
    drawn(generation: number, count: number) {
      if (generation === state.generation) drawn = count
    },
  }
}

/** The store of one interface. */
export type Store = ReturnType<typeof createStore>
