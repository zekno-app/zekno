"use client"

// Client boundary: a timed, selectable four-stage composition (motion M6d).
import { Tabs, TabsContent } from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"
import { Check, FileText, KeyRound, Server } from "lucide-react"
import { LayoutGroup, motion } from "motion/react"
import { useRef, useState } from "react"

import { a11y, features, team, teamStages } from "../../content"
import { useBeatClock, useStagePlayback } from "../../hooks/use-beat-clock"
import { type Sequence } from "../../utils/beats"
import { StageTabsList } from "../ui/stage-tabs"

const STAGE_MS = 3600

const SEQUENCE: Sequence = teamStages.map((stage) => ({
  id: stage.id,
  ms: STAGE_MS,
}))

const LAST_STAGE = teamStages.length - 1

/* The same elements persist across stages and travel with shared-element
   transitions: no bounce, about 700ms. */
const move = { type: "spring", bounce: 0, duration: 0.7 } as const
const ease = [0.23, 1, 0.32, 1] as const

type Member = (typeof team.members)[number]

function memberById(id: string): Member | undefined {
  return team.members.find((member) => member.id === id)
}

function fadeUp(delay = 0) {
  return {
    initial: { opacity: 0, transform: "translateY(10px)" },
    animate: { opacity: 1, transform: "translateY(0px)" },
    transition: { duration: 0.45, ease, delay },
  }
}

function fadeIn(delay = 0) {
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.35, ease, delay },
  }
}

const tokenSize = {
  lg: "size-14 text-base",
  md: "size-8 text-[0.6875rem]",
  sm: "size-6 text-[0.5625rem]",
} as const

function Token({
  member,
  size,
  className,
}: {
  member: Member
  size: keyof typeof tokenSize
  className?: string
}) {
  return (
    <motion.span
      layoutId={`team-token-${member.id}`}
      transition={move}
      style={{ borderRadius: 9999 }}
      className={cn(
        "flex shrink-0 items-center justify-center bg-foreground font-semibold text-background",
        tokenSize[size],
        className
      )}
    >
      {member.initials}
    </motion.span>
  )
}

/* ------------------------------ Stages ------------------------------ */

function TeamStage() {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-6 sm:gap-10">
      {team.members.map((member, index) => (
        <div key={member.id} className="flex flex-col items-center gap-3">
          <Token member={member} size="lg" />
          <motion.span
            {...fadeUp(0.15 + index * 0.08)}
            className="flex items-center gap-1 rounded-full border bg-surface px-2 py-0.5 text-[0.6875rem] text-muted-foreground"
          >
            <KeyRound className="size-3" />
            {team.keyNote}
          </motion.span>
        </div>
      ))}
    </div>
  )
}

function SignStage() {
  const [signer, ...others] = team.members
  if (signer === undefined) return null

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="absolute top-4 right-4 flex gap-2">
        {others.map((member) => (
          <Token key={member.id} member={member} size="md" />
        ))}
      </div>

      <motion.div
        layoutId="team-manifest"
        transition={move}
        style={{ borderRadius: 14 }}
        initial={{ opacity: 0, transform: "translateY(16px)" }}
        animate={{ opacity: 1, transform: "translateY(0px)" }}
        className="w-64 border bg-surface p-4 shadow-sm"
      >
        <motion.div {...fadeIn(0.15)}>
          <p className="flex items-center gap-2 text-sm font-medium">
            <FileText className="size-4" />
            {team.manifest.title}
          </p>
          <dl className="mt-3 flex flex-col gap-1 font-mono text-xs">
            {team.manifest.rows.map((row) => (
              <div key={row.label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </motion.div>
        <div className="mt-4 flex items-center gap-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">
            {team.manifest.signedBy}
          </span>
          <Token member={signer} size="md" />
          {/* The signature is revealed with a clip-path wipe, left to right. */}
          <motion.svg
            viewBox="0 0 96 24"
            aria-hidden="true"
            initial={{ clipPath: "inset(0 100% 0 0)" }}
            animate={{ clipPath: "inset(0 0% 0 0)" }}
            transition={{ duration: 0.7, ease: [0.77, 0, 0.175, 1], delay: 0.55 }}
            className="h-6 w-24 text-signal"
          >
            <path
              d="M3 17c6-13 10-13 11-3s5 8 9-2 7-9 8 1 5 8 9 0 8-6 10 2 7 5 12-3 9-4 12 1 9 4 19-2"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.svg>
        </div>
      </motion.div>
    </div>
  )
}

function HistoryRow({
  layoutId,
  entry,
  index,
}: {
  layoutId: string
  entry: (typeof team.history)[number]
  index: number
}) {
  const member = memberById(entry.member)
  if (member === undefined) return null
  const first = index === 0

  return (
    <motion.li
      layoutId={layoutId}
      transition={move}
      style={{ borderRadius: 12 }}
      className={cn(
        "relative flex items-center gap-3 px-3 py-2.5",
        // The first row is the manifest card itself, so it keeps its surface while it morphs.
        first && "border bg-surface shadow-sm"
      )}
    >
      {first ? null : (
        // Later rows fade their surface in, so the teammate token is seen travelling into place.
        <motion.span
          aria-hidden="true"
          {...fadeIn(0.2 + index * 0.1)}
          className="absolute inset-0 rounded-xl border bg-surface"
        />
      )}
      <Token member={member} size="md" className="relative" />
      <motion.span
        {...fadeIn(first ? 0.2 : 0.3 + index * 0.1)}
        className="relative flex min-w-0 flex-1 items-center justify-between gap-3"
      >
        <span className="min-w-0">
          <span className="block truncate font-mono text-xs">{entry.what}</span>
          <span className="block text-[0.6875rem] text-muted-foreground">
            {entry.when}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[0.6875rem] font-medium text-signal">
          <Check className="size-3.5" />
          {team.signed}
        </span>
      </motion.span>
    </motion.li>
  )
}

function rowLayoutId(index: number, memberId: string) {
  return index === 0 ? "team-manifest" : `team-row-${memberId}`
}

function HistoryStage() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
      <ul className="flex w-full max-w-sm flex-col gap-2">
        {team.history.map((entry, index) => (
          <HistoryRow
            key={entry.member}
            layoutId={rowLayoutId(index, entry.member)}
            entry={entry}
            index={index}
          />
        ))}
      </ul>
    </div>
  )
}

function ServersStage() {
  return (
    <div className="absolute inset-0 grid grid-cols-3 gap-2 p-4 sm:gap-4 sm:p-6">
      {team.history.map((entry, index) => {
        const member = memberById(entry.member)
        if (member === undefined) return null
        return (
          <div key={entry.member} className="flex min-w-0 flex-col items-center">
            {/* The history row, compressed into a chip. */}
            <motion.div
              layoutId={rowLayoutId(index, entry.member)}
              transition={move}
              style={{ borderRadius: 9999 }}
              className="flex items-center gap-1.5 border bg-surface px-2 py-1"
            >
              <Token member={member} size="sm" />
              <Check className="size-3.5 text-signal" />
            </motion.div>

            <motion.div
              aria-hidden="true"
              initial={{ transform: "scaleY(0)" }}
              animate={{ transform: "scaleY(1)" }}
              transition={{ duration: 0.4, ease, delay: 0.35 + index * 0.1 }}
              className="w-px flex-1 origin-top bg-border"
            />

            <motion.div
              {...fadeUp(0.25 + index * 0.1)}
              className="flex w-full flex-col items-center gap-2 rounded-xl border bg-surface px-2 py-4"
            >
              <Server className="size-5" />
              <span className="text-center text-[0.6875rem] font-medium">
                {team.serverLabel}
              </span>
              <span className="flex gap-1.5">
                {[0, 1, 2].map((dot) => (
                  <motion.span
                    key={dot}
                    initial={{ opacity: 0.2 }}
                    animate={{ opacity: 1 }}
                    transition={{
                      duration: 0.3,
                      delay: 0.7 + index * 0.12 + dot * 0.09,
                    }}
                    className="size-1.5 rounded-full bg-signal"
                  />
                ))}
              </span>
            </motion.div>
          </div>
        )
      })}
    </div>
  )
}

/* ---------------------------- Composition ---------------------------- */

export function TeamComposition() {
  const ref = useRef<HTMLDivElement>(null)
  const { playing } = useStagePlayback(ref)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const auto = playing && !hovered && !focused

  // Rendered on the server at its last stage, the one that says the most as a still.
  const clock = useBeatClock(SEQUENCE, {
    enabled: auto,
    loop: true,
    initialIndex: LAST_STAGE,
  })
  const stage = teamStages[clock.index] ?? teamStages[LAST_STAGE]

  if (stage === undefined) return null

  const heading = features.find((feature) => feature.id === "team")?.heading ?? ""

  return (
    <div ref={ref} className="w-full">
      <Tabs
        value={stage.id}
        onValueChange={(value) => {
          const index = teamStages.findIndex((item) => item.id === value)
          if (index !== -1) clock.setIndex(index)
        }}
        className="gap-4"
      >
        <div
          role="img"
          aria-label={`${heading}. ${stage.caption}`}
          className="relative h-80 w-full overflow-hidden rounded-2xl border bg-card"
        >
          <LayoutGroup id="team-composition">
            {stage.id === "team" ? <TeamStage /> : null}
            {stage.id === "sign" ? <SignStage /> : null}
            {stage.id === "history" ? <HistoryStage /> : null}
            {stage.id === "servers" ? <ServersStage /> : null}
          </LayoutGroup>
        </div>

        <div
          className="flex flex-col gap-3"
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          <StageTabsList
            items={teamStages}
            activeId={stage.id}
            layoutId="team-pill"
            durationMs={STAGE_MS}
            auto={auto}
            label={a11y.teamStagesLabel}
          />
          <div className="min-h-10 sm:min-h-5">
            {teamStages.map((item) => (
              <TabsContent
                key={item.id}
                value={item.id}
                className="animate-[landing-fade_200ms_ease-out_both] rounded-md text-sm text-pretty text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {item.caption}
              </TabsContent>
            ))}
          </div>
        </div>
      </Tabs>
    </div>
  )
}
