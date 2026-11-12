"use client"

// Client boundary: rows re-scramble on a timer while the demo is on screen (motion M6a).
import { Lock } from "lucide-react"
import { useRef } from "react"

import { demos, features } from "../../content"
import { useBeatClock, useStagePlayback } from "../../hooks/use-beat-clock"
import { type Sequence } from "../../utils/beats"
import { ScrambleText } from "../ui/scramble-text"
import { DemoFrame } from "./demo-frame"

const { rows, title, footer } = demos.leak

// Two passes over the rows: the first scrambles each to its `b` text, the second back to `a`.
const SEQUENCE: Sequence = [...rows, ...rows].map((row, index) => ({
  id: `${row.key}-${index}`,
  ms: 800,
}))

export function LeakDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const { playing } = useStagePlayback(ref)
  const clock = useBeatClock(SEQUENCE, { enabled: playing, loop: true })

  const pass = clock.index < rows.length ? 0 : 1
  const cursor = clock.index % rows.length
  const label = `${features[0]?.heading ?? title}. ${title}: ${footer}.`

  return (
    <DemoFrame ref={ref} label={label}>
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <Lock className="size-3.5" />
        {title}
      </div>

      <div className="relative mt-4 flex-1 overflow-hidden rounded-lg border bg-surface">
        {playing ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-full animate-[landing-scan_3.2s_linear_infinite] bg-linear-to-b from-transparent via-signal/10 to-transparent"
          />
        ) : null}
        <ul className="relative flex h-full flex-col justify-around px-3 py-2 font-mono text-[0.6875rem] sm:text-xs">
          {rows.map((row, index) => {
            // Rows before the cursor have already flipped in this pass.
            const flipped = pass === 0 ? index <= cursor : index > cursor
            const from = flipped ? row.a : row.b
            const to = flipped ? row.b : row.a
            return (
              <li key={row.key} className="flex items-center justify-between gap-4">
                <span className="shrink-0 text-muted-foreground">{row.key}</span>
                <ScrambleText
                  from={from}
                  to={to}
                  on
                  animate={playing && index === cursor}
                  durationMs={600}
                  className="truncate"
                />
              </li>
            )
          })}
        </ul>
      </div>

      <p className="mt-4 text-sm font-medium">{footer}</p>
    </DemoFrame>
  )
}
