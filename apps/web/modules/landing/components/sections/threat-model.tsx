"use client"

// Client boundary: the selected scenario is browser state.
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"
import { Activity, ShieldCheck, ShieldX } from "lucide-react"
import { useState } from "react"

import { a11y, parties, stage, threats } from "../../content"
import { type ThreatOutcome, type ThreatScenario } from "../../types"
import { Section, SectionHeading } from "../ui/section"

/* Outcomes differ by icon, wording and fill, never by colour alone (FR-017). */
function OutcomeBadge({
  outcome,
  label,
}: {
  outcome: ThreatOutcome
  label: string
}) {
  if (outcome === "unprotected") {
    return (
      <Badge variant="outline" className="h-6 border-foreground/50 px-2.5">
        <ShieldX aria-hidden="true" />
        {label}
      </Badge>
    )
  }
  return (
    <Badge className="h-6 px-2.5">
      {outcome === "running" ? (
        <Activity aria-hidden="true" />
      ) : (
        <ShieldCheck aria-hidden="true" />
      )}
      {label}
    </Badge>
  )
}

function Result({ scenario }: { scenario: ThreatScenario }) {
  return (
    <div
      key={scenario.id}
      className="flex animate-[landing-fade_200ms_ease-out_both] flex-col gap-5"
    >
      <div>
        <p className="font-mono text-[0.6875rem] tracking-widest text-muted-foreground uppercase">
          {threats.attackerHolds}
        </p>
        <div
          aria-hidden="true"
          className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"
        >
          {parties.map((party) => {
            const hit =
              scenario.compromised === party.id ||
              (scenario.compromised === "release" && party.id !== "zekno")
            return (
              <div
                key={party.id}
                className={cn(
                  "flex min-h-14 items-center justify-center rounded-lg border px-2 py-2 font-medium",
                  party.id === "zekno" && "border-dashed",
                  hit
                    ? "border-foreground bg-foreground text-background"
                    : "text-muted-foreground"
                )}
              >
                {party.id === "zekno" ? stage.zekno.short : party.label}
              </div>
            )
          })}
        </div>
        {scenario.compromised === "release" ? (
          <p className="mt-2 text-xs text-muted-foreground">{threats.releaseNote}</p>
        ) : null}
      </div>
      <div>
        <p className="font-mono text-[0.6875rem] tracking-widest text-muted-foreground uppercase">
          {threats.resultLabel}
        </p>
        <p className="mt-2 text-lg font-semibold text-balance">{scenario.result}</p>
        <p className="mt-1 text-base text-pretty text-muted-foreground">
          {scenario.reason}
        </p>
      </div>
    </div>
  )
}

export function ThreatModel() {
  const [selectedId, setSelectedId] = useState(threats.scenarios[0]?.id)
  const selected =
    threats.scenarios.find((scenario) => scenario.id === selectedId) ??
    threats.scenarios[0]

  if (selected === undefined) return null

  return (
    <Section id="security" className="border-y bg-muted/30">
      <SectionHeading title={threats.heading} intro={threats.intro} />

      <div className="reveal mt-10 grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
        <ul aria-label={a11y.scenariosLabel} className="flex flex-col gap-2">
          {threats.scenarios.map((scenario) => {
            const active = scenario.id === selected.id
            return (
              <li key={scenario.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedId(scenario.id)}
                  className={cn(
                    "flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border bg-surface px-4 py-3 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-base",
                    active
                      ? "border-foreground/70"
                      : "hover:border-foreground/30 pointer-coarse:hover:border-border"
                  )}
                >
                  <span className="text-pretty">{scenario.title}</span>
                  <OutcomeBadge
                    outcome={scenario.outcome}
                    label={scenario.outcomeLabel}
                  />
                </button>
                {/* On narrow screens the result opens under the chosen scenario. */}
                {active ? (
                  <div
                    aria-live="polite"
                    className="mt-2 rounded-xl border bg-surface p-4 lg:hidden"
                  >
                    <Result scenario={selected} />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>

        <div
          aria-live="polite"
          className="hidden h-fit rounded-xl border bg-surface p-6 lg:sticky lg:top-24 lg:block"
        >
          <Result scenario={selected} />
        </div>
      </div>

      <p className="mt-6 max-w-3xl text-sm text-pretty text-muted-foreground">
        {threats.metadataNote}
      </p>
    </Section>
  )
}
