"use client"

// Client boundary: runs a timer to scramble text in the browser.
import { useReducedMotion } from "motion/react"
import { useEffect, useState } from "react"

const GLYPHS = "0123456789abcdef"
const FRAME_MS = 40

function scrambled(from: string, to: string, progress: number, frame: number) {
  const length = Math.max(from.length, to.length)
  let out = ""
  for (let index = 0; index < length; index++) {
    const start = (index / length) * 0.6
    const end = start + 0.4
    if (progress >= end) {
      out += to[index] ?? ""
    } else if (progress > start) {
      out += GLYPHS[(index * 7 + frame * 3) % GLYPHS.length] ?? ""
    } else {
      out += from[index] ?? ""
    }
  }
  return out
}

function Scrambling({
  from,
  to,
  durationMs,
  delayMs,
  className,
}: {
  from: string
  to: string
  durationMs: number
  delayMs: number
  className?: string
}) {
  const [frame, setFrame] = useState(0)
  const delayFrames = Math.round(delayMs / FRAME_MS)
  const frames = Math.max(1, Math.round(durationMs / FRAME_MS))
  const done = frame >= delayFrames + frames

  useEffect(() => {
    if (done) return
    const timer = window.setInterval(() => setFrame((value) => value + 1), FRAME_MS)
    return () => window.clearInterval(timer)
  }, [done])

  const progress = Math.min(1, Math.max(0, (frame - delayFrames) / frames))

  return <span className={className}>{scrambled(from, to, progress, frame)}</span>
}

/**
 * Shows `from`, or `to` once `on` is true. With `animate`, the change plays as
 * a left-to-right scramble. `from` and `to` should be the same length and set
 * in a monospace font, so the text never changes width.
 */
export function ScrambleText({
  from,
  to,
  on,
  animate = true,
  durationMs = 700,
  delayMs = 0,
  className,
}: {
  from: string
  to: string
  on: boolean
  animate?: boolean
  durationMs?: number
  delayMs?: number
  className?: string
}) {
  const reducedMotion = useReducedMotion()

  if (!on) return <span className={className}>{from}</span>
  if (!animate || reducedMotion) return <span className={className}>{to}</span>

  return (
    <Scrambling
      key={`${from}:${to}`}
      from={from}
      to={to}
      durationMs={durationMs}
      delayMs={delayMs}
      className={className}
    />
  )
}
