"use client"

import { useInView, usePageInView, useReducedMotion } from "motion/react"
import { type RefObject, useEffect, useState } from "react"

import { nextIndex, type Sequence } from "../utils/beats"

/**
 * Whether an animated stage may play: it is on screen, the tab is in the
 * foreground, and the visitor has not asked for reduced motion.
 */
export function useStagePlayback(ref: RefObject<Element | null>) {
  const inView = useInView(ref, { amount: 0.35 })
  const pageVisible = usePageInView()
  const reducedMotion = useReducedMotion() ?? false

  return {
    reducedMotion,
    playing: inView && pageVisible && !reducedMotion,
  }
}

type ClockOptions = {
  /** Advance only while true. */
  enabled: boolean
  /** Wrap to the first beat after the last one. */
  loop: boolean
  /** Beat to show before the clock first runs (also the server-rendered beat). */
  initialIndex?: number
  /** Called when a non-looping sequence finishes its last beat. */
  onComplete?: () => void
}

/**
 * Steps through a sequence of beats on a timer. Every visual is a function of
 * the current beat, so interrupting it (setIndex, a new sequence) retargets
 * instead of restarting.
 */
export function useBeatClock<Id extends string>(
  sequence: Sequence<Id>,
  { enabled, loop, initialIndex = 0, onComplete }: ClockOptions
) {
  const [state, setState] = useState({ sequence, index: initialIndex })

  // A different sequence starts from its first beat.
  if (state.sequence !== sequence) {
    setState({ sequence, index: 0 })
  }

  const index = state.sequence === sequence ? state.index : 0
  const beat = sequence[index] ?? sequence[0]

  useEffect(() => {
    if (!enabled || beat === undefined) return

    const timer = window.setTimeout(() => {
      const isLast = index === sequence.length - 1
      if (isLast && !loop) {
        onComplete?.()
        return
      }
      setState({ sequence, index: nextIndex(index, sequence.length, loop) })
    }, beat.ms)

    return () => window.clearTimeout(timer)
  }, [enabled, loop, index, beat, sequence, onComplete])

  const setIndex = (next: number) => setState({ sequence, index: next })

  return { index, id: beat?.id as Id, setIndex }
}
