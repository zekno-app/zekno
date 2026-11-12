/**
 * Pure timing maths for the animated stages. A stage is a list of beats; the
 * client hook in `use-beat-clock.ts` moves through them on a timer.
 */
export type Beat<Id extends string = string> = {
  readonly id: Id
  readonly ms: number
}

export type Sequence<Id extends string = string> = readonly Beat<Id>[]

export function totalMs(sequence: Sequence): number {
  return sequence.reduce((sum, beat) => sum + beat.ms, 0)
}

/** The beat after `index`. Wraps to 0 when looping, otherwise stays on the last beat. */
export function nextIndex(index: number, length: number, loop: boolean): number {
  if (length <= 0) return 0
  const next = index + 1
  if (next < length) return next
  return loop ? 0 : length - 1
}

/** The index of the beat that is playing `elapsedMs` after the sequence started. */
export function beatAt(
  sequence: Sequence,
  elapsedMs: number,
  loop: boolean
): number {
  const total = totalMs(sequence)
  if (sequence.length === 0 || total <= 0) return 0
  if (elapsedMs <= 0) return 0
  if (!loop && elapsedMs >= total) return sequence.length - 1

  let remaining = loop ? elapsedMs % total : elapsedMs
  for (let index = 0; index < sequence.length; index++) {
    const beat = sequence[index]
    if (beat === undefined) break
    if (remaining < beat.ms) return index
    remaining -= beat.ms
  }
  return sequence.length - 1
}

export function indexOfBeat<Id extends string>(
  sequence: Sequence<Id>,
  id: Id
): number {
  const index = sequence.findIndex((beat) => beat.id === id)
  return index === -1 ? 0 : index
}
