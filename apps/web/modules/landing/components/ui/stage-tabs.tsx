"use client"

// Client boundary: tab selection and the auto-advance progress line are browser state.
import { TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"
import { motion } from "motion/react"

/**
 * The tab row shared by the stepper and the team composition (motion M4):
 * a pill that slides to the active tab and a line that fills while the stage
 * is advancing on its own.
 */
export function StageTabsList({
  items,
  activeId,
  layoutId,
  durationMs,
  auto,
  label,
  numbered = false,
  className,
}: {
  items: readonly { id: string; label: string }[]
  activeId: string
  /** Unique per tab row, so pills in different rows never animate into each other. */
  layoutId: string
  durationMs: number
  /** True while the stage is advancing on a timer. */
  auto: boolean
  label: string
  numbered?: boolean
  className?: string
}) {
  return (
    <TabsList
      aria-label={label}
      className={cn(
        "h-auto w-full max-w-full justify-start gap-1 overflow-x-auto rounded-full bg-muted/70 p-1 group-data-horizontal/tabs:h-auto sm:w-fit",
        className
      )}
    >
      {items.map((item, index) => {
        const active = item.id === activeId
        return (
          <TabsTrigger
            key={item.id}
            value={item.id}
            className="relative h-10 flex-none rounded-full border-transparent px-4 text-sm data-active:bg-transparent data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-transparent"
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                aria-hidden="true"
                transition={{ type: "spring", bounce: 0, duration: 0.4 }}
                className="absolute inset-0 overflow-hidden rounded-full bg-background shadow-sm dark:bg-input/60"
              >
                {auto ? (
                  <span
                    key={item.id}
                    style={{ animationDuration: `${durationMs}ms` }}
                    className="absolute inset-x-0 bottom-0 h-0.5 origin-left animate-[landing-progress_linear_both] bg-signal motion-reduce:hidden"
                  />
                ) : null}
              </motion.span>
            ) : null}
            <span className="relative flex items-center gap-2">
              {numbered ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {index + 1}
                </span>
              ) : null}
              {item.label}
            </span>
          </TabsTrigger>
        )
      })}
    </TabsList>
  )
}
