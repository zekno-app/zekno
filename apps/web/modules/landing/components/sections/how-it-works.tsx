"use client"

// Client boundary: the stepper advances on a timer and responds to selection.
import { Tabs, TabsContent } from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"
import { ArrowDown, ArrowRight, Lock } from "lucide-react"
import { LayoutGroup, motion } from "motion/react"
import { useRef, useState } from "react"

import { a11y, howItWorks, parties, steps } from "../../content"
import { useBeatClock, useStagePlayback } from "../../hooks/use-beat-clock"
import { type Sequence } from "../../utils/beats"
import { PartyIcon } from "../ui/party-icon"
import { Section, SectionHeading } from "../ui/section"
import { StageTabsList } from "../ui/stage-tabs"

const STEP_MS = 5000

const SEQUENCE: Sequence = steps.map((step) => ({ id: step.id, ms: STEP_MS }))

export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null)
  const { playing } = useStagePlayback(ref)
  // Held while the pointer or keyboard focus is on the step controls.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const auto = playing && !hovered && !focused

  const clock = useBeatClock(SEQUENCE, { enabled: auto, loop: true })
  const step = steps[clock.index] ?? steps[0]

  if (step === undefined) return null

  return (
    <Section id="how">
      <SectionHeading
        eyebrow={howItWorks.eyebrow}
        title={howItWorks.heading}
        intro={howItWorks.intro}
      />

      <div ref={ref} className="reveal mt-10">
        <Tabs
          value={step.id}
          onValueChange={(value) => {
            const index = steps.findIndex((item) => item.id === value)
            if (index !== -1) clock.setIndex(index)
          }}
          className="gap-6"
        >
          <div
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          >
            <StageTabsList
              items={steps}
              activeId={step.id}
              layoutId="how-pill"
              durationMs={STEP_MS}
              auto={auto}
              label={a11y.stepsLabel}
              numbered
            />
          </div>

          <div className="rounded-2xl border bg-card p-4 sm:p-6">
            <LayoutGroup id="how-diagram">
              <div
                aria-hidden="true"
                className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0"
              >
                {parties.map((party, index) => {
                  const active = party.id === step.party
                  const connector = howItWorks.connectors[index]
                  return (
                    <div key={party.id} className="contents">
                      <div
                        className={cn(
                          "relative min-w-0 rounded-xl border bg-surface p-4 lg:flex-1",
                          party.id === "zekno" && "border-dashed"
                        )}
                      >
                        {active ? (
                          <motion.div
                            layoutId="how-active"
                            transition={{ type: "spring", bounce: 0, duration: 0.6 }}
                            className="pointer-events-none absolute -inset-px rounded-xl border-2 border-foreground/70 bg-foreground/[0.03]"
                          />
                        ) : null}
                        <span className="flex items-center gap-1.5 font-mono text-[0.6875rem] tracking-widest text-muted-foreground uppercase">
                          <PartyIcon party={party.id} className="size-3.5 shrink-0" />
                          {party.label}
                        </span>
                        <p className="mt-3 text-base font-semibold">{party.title}</p>
                        <ul className="mt-2 flex min-h-[4.75rem] flex-col gap-1 text-sm text-muted-foreground">
                          {party.holds.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                        {/* Where the packet is during this step. */}
                        <span className="relative mt-3 block h-6 w-32">
                          {active ? (
                            <motion.span
                              layoutId="how-packet"
                              transition={{ type: "spring", bounce: 0, duration: 0.7 }}
                              className="absolute inset-0 flex items-center justify-center gap-1 rounded-full bg-signal/15 text-[0.6875rem] font-medium text-signal"
                            >
                              <Lock className="size-3" />
                              {howItWorks.packetLabel}
                            </motion.span>
                          ) : null}
                        </span>
                      </div>
                      {connector !== undefined && index < parties.length - 1 ? (
                        <div className="flex items-center justify-center gap-2 py-1 text-muted-foreground lg:w-28 lg:flex-col lg:px-2 lg:py-0">
                          <ArrowDown className="size-4 shrink-0 lg:hidden" />
                          <span className="text-xs text-balance lg:text-center">
                            {connector}
                          </span>
                          <ArrowRight className="hidden size-4 shrink-0 lg:block" />
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </LayoutGroup>

            <div className="mt-5 min-h-24 border-t pt-5 sm:min-h-16">
              {steps.map((item, index) => (
                <TabsContent
                  key={item.id}
                  value={item.id}
                  className="flex animate-[landing-fade_200ms_ease-out_both] flex-col gap-2 rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:items-baseline sm:gap-6"
                >
                  <span className="shrink-0 font-mono text-xs tracking-widest text-muted-foreground uppercase">
                    Step {index + 1} of {steps.length}
                  </span>
                  <p className="text-base text-pretty sm:text-lg">{item.description}</p>
                </TabsContent>
              ))}
            </div>
          </div>
        </Tabs>
      </div>
    </Section>
  )
}
