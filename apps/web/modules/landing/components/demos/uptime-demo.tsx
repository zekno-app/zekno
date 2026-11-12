"use client"

// Client boundary: Zekno goes offline and comes back on a timer (motion M6c).
import { cn } from "@workspace/ui/lib/utils"
import { CloudOff, Laptop, Server } from "lucide-react"
import { motion } from "motion/react"
import { useRef } from "react"

import { demos, features } from "../../content"
import { useBeatClock, useStagePlayback } from "../../hooks/use-beat-clock"
import { type Sequence } from "../../utils/beats"
import { DemoFrame } from "./demo-frame"

const copy = demos.uptime

type Beat = "online" | "offline" | "direct"

const SEQUENCE: Sequence<Beat> = [
  { id: "online", ms: 2400 },
  { id: "offline", ms: 2200 },
  { id: "direct", ms: 3200 },
]

const wipe = { duration: 0.6, ease: [0.77, 0, 0.175, 1] } as const

export function UptimeDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const { playing, reducedMotion } = useStagePlayback(ref)
  const clock = useBeatClock(SEQUENCE, { enabled: playing, loop: true })

  // Reduced motion: show the state that makes the point, with nothing moving.
  const beat: Beat = reducedMotion ? "direct" : clock.id
  const offline = beat !== "online"
  const direct = beat === "direct"

  const label = `${features[2]?.heading ?? ""}. ${copy.zekno}: ${copy.offline}. ${copy.server}: ${copy.running}. ${copy.direct}.`

  return (
    <DemoFrame ref={ref} label={label} className="justify-between">
      {/* Zekno, above the direct path */}
      <div className="flex justify-center">
        <div
          className={cn(
            "relative flex w-40 flex-col items-center gap-1 rounded-xl border border-dashed bg-surface px-3 py-3 text-center"
          )}
        >
          <CloudOff
            className={cn(
              "absolute top-2 right-2 size-3.5 text-muted-foreground transition-opacity duration-300",
              offline ? "opacity-100" : "opacity-0"
            )}
          />
          <span className="text-sm font-medium">{copy.zekno}</span>
          <span className="grid text-xs">
            <span
              className={cn(
                "col-start-1 row-start-1 text-signal transition-opacity duration-300",
                offline ? "opacity-0" : "opacity-100"
              )}
            >
              {copy.online}
            </span>
            <span
              className={cn(
                "col-start-1 row-start-1 text-muted-foreground transition-opacity duration-300",
                offline ? "opacity-100" : "opacity-0"
              )}
            >
              {copy.offline}
            </span>
          </span>
        </div>
      </div>

      {/* The path a deploy takes */}
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
        <div className="flex w-24 flex-col items-center gap-1.5 rounded-xl border bg-surface px-2 py-3 text-center sm:w-28">
          <Laptop className="size-5" />
          <span className="text-xs font-medium">{copy.machine}</span>
        </div>

        <div className="relative h-10">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
          <motion.div
            initial={false}
            animate={{ clipPath: direct ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)" }}
            transition={wipe}
            className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-signal"
          />
          <p className="absolute inset-x-0 -top-3 grid text-center text-[0.6875rem] font-medium">
            <span
              className={cn(
                "col-start-1 row-start-1 text-muted-foreground transition-opacity duration-300",
                offline ? "opacity-0" : "opacity-100"
              )}
            >
              {copy.viaZekno}
            </span>
            <span
              className={cn(
                "col-start-1 row-start-1 text-signal transition-opacity duration-300",
                direct ? "opacity-100" : "opacity-0"
              )}
            >
              {copy.direct}
            </span>
          </p>
        </div>

        <div className="flex w-24 flex-col items-center gap-1.5 rounded-xl border bg-surface px-2 py-3 text-center sm:w-28">
          <Server className="size-5" />
          <span className="text-xs font-medium">{copy.server}</span>
        </div>
      </div>

      {/* Containers never stop */}
      <div className="flex items-center justify-end gap-2 text-xs">
        <span className="flex items-center gap-1.5">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              style={{ animationDelay: `${index * 300}ms` }}
              className={cn(
                "size-2 rounded-full bg-signal",
                playing && "animate-[landing-pulse_1.8s_ease-in-out_infinite]"
              )}
            />
          ))}
        </span>
        <span className="font-medium text-signal">{copy.running}</span>
      </div>
    </DemoFrame>
  )
}
