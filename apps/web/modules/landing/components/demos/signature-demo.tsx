"use client"

// Client boundary: deploys arrive and are judged on a timer (motion M6b).
import { cn } from "@workspace/ui/lib/utils"
import { ArrowRight, FileText, ShieldCheck, ShieldX } from "lucide-react"
import { LayoutGroup, motion } from "motion/react"
import { useRef } from "react"

import { demos, features } from "../../content"
import { useBeatClock, useStagePlayback } from "../../hooks/use-beat-clock"
import { type Sequence } from "../../utils/beats"
import { DemoFrame } from "./demo-frame"

const copy = demos.signature

type Beat = "unsigned-arrives" | "refused" | "signed-arrives" | "accepted"

const SEQUENCE: Sequence<Beat> = [
  { id: "unsigned-arrives", ms: 1400 },
  { id: "refused", ms: 1800 },
  { id: "signed-arrives", ms: 1400 },
  { id: "accepted", ms: 2000 },
]

function Manifest({ signed, judged }: { signed: boolean; judged: boolean }) {
  const kind = signed ? copy.signed : copy.unsigned
  return (
    <motion.div
      layoutId={signed ? "manifest-signed" : "manifest-unsigned"}
      transition={{ type: "spring", bounce: 0, duration: 0.7 }}
      initial={judged ? false : { opacity: 0, transform: "scale(0.96)" }}
      animate={{ opacity: 1, transform: "scale(1)" }}
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg border bg-surface-raised p-3",
        !signed && "border-dashed"
      )}
    >
      <span className="flex items-start gap-2 text-xs font-medium text-balance sm:text-sm">
        <FileText className="mt-0.5 size-4 shrink-0" />
        {kind.title}
      </span>
      <span
        className={cn(
          "w-fit rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
          signed ? "bg-signal/15 text-signal" : "bg-background/50 text-foreground"
        )}
      >
        {kind.mark}
      </span>
    </motion.div>
  )
}

function Verdict({ signed }: { signed: boolean }) {
  return (
    <motion.p
      initial={{ opacity: 0, transform: "translateY(4px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      className={cn(
        "flex items-center gap-1.5 text-sm font-semibold",
        signed ? "text-signal" : "text-destructive"
      )}
    >
      {signed ? <ShieldCheck className="size-4" /> : <ShieldX className="size-4" />}
      {signed ? copy.signed.result : copy.unsigned.result}
    </motion.p>
  )
}

export function SignatureDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const { playing, reducedMotion } = useStagePlayback(ref)
  const clock = useBeatClock(SEQUENCE, { enabled: playing, loop: true })
  const beat = clock.id

  const label = `${features[1]?.heading ?? ""}. ${copy.unsigned.title}: ${copy.unsigned.result}. ${copy.signed.title}: ${copy.signed.result}.`

  // Reduced motion: both outcomes side by side, nothing travels.
  if (reducedMotion) {
    return (
      <DemoFrame ref={ref} label={label} className="justify-center gap-4">
        {[false, true].map((signed) => (
          <div key={String(signed)} className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <Manifest signed={signed} judged />
            </div>
            <div className="w-28 shrink-0">
              <Verdict signed={signed} />
            </div>
          </div>
        ))}
      </DemoFrame>
    )
  }

  const signed = beat === "signed-arrives" || beat === "accepted"
  const judged = beat === "refused" || beat === "accepted"

  return (
    <DemoFrame ref={ref} label={label}>
      <LayoutGroup id="signature-demo">
        <div className="grid flex-1 grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex h-full min-w-0 flex-col gap-3">
            <span className="font-mono text-[0.6875rem] tracking-widest text-muted-foreground uppercase">
              {copy.incoming}
            </span>
            <div className="flex flex-1 items-center">
              {judged ? null : <Manifest key={String(signed)} signed={signed} judged={false} />}
            </div>
          </div>

          <ArrowRight className="size-4 text-muted-foreground" />

          <div className="flex h-full min-w-0 flex-col gap-3 rounded-xl border bg-surface p-3">
            <span className="font-mono text-[0.6875rem] tracking-widest text-muted-foreground uppercase">
              {copy.agent}
            </span>
            <div className="flex flex-1 flex-col justify-center gap-3">
              {judged ? (
                <>
                  <Manifest key={String(signed)} signed={signed} judged />
                  <Verdict key={`verdict-${String(signed)}`} signed={signed} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{copy.waiting}</p>
              )}
            </div>
          </div>
        </div>
      </LayoutGroup>
    </DemoFrame>
  )
}
