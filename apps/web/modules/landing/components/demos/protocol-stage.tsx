"use client"

// Client boundary: the stage is timed and interactive ("Breach Zekno").
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  ArrowDown,
  ArrowRight,
  KeyRound,
  Lock,
  LockOpen,
  RotateCcw,
  ShieldCheck,
  ShieldX,
} from "lucide-react"
import { LayoutGroup, motion } from "motion/react"
import { useCallback, useRef, useState } from "react"

import {
  a11y,
  breach,
  howItWorks,
  parties,
  sampleSecrets,
  stage,
} from "../../content"
import { useBeatClock, useStagePlayback } from "../../hooks/use-beat-clock"
import { type PartyId } from "../../types"
import { indexOfBeat, type Sequence } from "../../utils/beats"
import { PartyIcon } from "../ui/party-icon"
import { ScrambleText } from "../ui/scramble-text"

/* Timings: specs/001-landing-page/contracts/motion.md (M2, M2b). */

type DeployBeat =
  | "idle"
  | "encrypt"
  | "sign"
  | "relay-zekno"
  | "relay-server"
  | "verify"
  | "run"
  | "hold"

type BreachBeat = "open" | "forged" | "refused" | "breach-hold"

type StageBeat = DeployBeat | BreachBeat

const DEPLOY: Sequence<StageBeat> = [
  { id: "idle", ms: 900 },
  { id: "encrypt", ms: 1500 },
  { id: "sign", ms: 1000 },
  { id: "relay-zekno", ms: 1300 },
  { id: "relay-server", ms: 1300 },
  { id: "verify", ms: 1000 },
  { id: "run", ms: 1200 },
  { id: "hold", ms: 1800 },
]

const BREACH: Sequence<StageBeat> = [
  { id: "open", ms: 2200 },
  { id: "forged", ms: 1800 },
  { id: "refused", ms: 2400 },
  { id: "breach-hold", ms: 5600 },
]

const DEPLOY_ORDER = DEPLOY.map((beat) => beat.id)
const RUN_INDEX = indexOfBeat(DEPLOY, "run")

const move = { type: "spring", bounce: 0, duration: 0.7 } as const
const enter = { duration: 0.35, ease: [0.23, 1, 0.32, 1] } as const

function partyLabel(id: PartyId) {
  return parties.find((party) => party.id === id)?.label ?? id
}

/* ------------------------------------------------------------------ */

function Panel({
  party,
  dashed,
  alert,
  badge,
  children,
}: {
  party: PartyId
  dashed?: boolean
  alert?: boolean
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col gap-3 rounded-xl border bg-surface p-3 sm:p-4",
        dashed && "border-dashed"
      )}
    >
      {/* Breach outline, cross-faded so nothing but opacity animates. */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -inset-px rounded-xl border border-destructive opacity-0 transition-opacity duration-300",
          alert && "opacity-100"
        )}
      />
      <div className="relative flex h-5 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[0.6875rem] tracking-widest text-muted-foreground uppercase">
          <PartyIcon party={party} className="size-3.5 shrink-0" />
          <span className="truncate">{partyLabel(party)}</span>
        </span>
        {badge}
      </div>
      {children}
    </div>
  )
}

function Slot({ children }: { children?: React.ReactNode }) {
  return <div className="relative h-[5.75rem]">{children}</div>
}

function Connector({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center justify-center gap-2 text-muted-foreground lg:w-24 lg:flex-col">
      <ArrowDown
        className={cn(
          "size-4 shrink-0 text-foreground transition-opacity duration-300 lg:hidden",
          active ? "opacity-100" : "opacity-40"
        )}
      />
      <span className="text-[0.6875rem] leading-4 text-balance lg:text-center">
        {label}
      </span>
      <ArrowRight
        className={cn(
          "hidden size-4 shrink-0 text-foreground transition-opacity duration-300 lg:block",
          active ? "opacity-100" : "opacity-40"
        )}
      />
    </div>
  )
}

function Packet({ beat }: { beat: StageBeat }) {
  const order = DEPLOY_ORDER.indexOf(beat)
  const signed = order >= DEPLOY_ORDER.indexOf("sign")
  const consumed = beat === "run"

  return (
    <motion.div
      layoutId="hero-packet"
      transition={move}
      initial={beat === "encrypt" ? { opacity: 0, transform: "scale(0.96)" } : false}
      animate={{ opacity: consumed ? 0 : 1, transform: "scale(1)" }}
      className="absolute inset-0 flex flex-col gap-1 rounded-lg border bg-surface-raised p-2 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <Lock className="size-3.5 shrink-0" />
          <span className="truncate">{stage.packet.title}</span>
        </span>
        {signed ? (
          <motion.span
            initial={beat === "sign" ? { clipPath: "inset(0 100% 0 0)" } : false}
            animate={{ clipPath: "inset(0 0% 0 0)" }}
            transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
            className="flex shrink-0 items-center gap-1 rounded-full bg-signal/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-signal"
          >
            <ShieldCheck className="size-3" />
            {stage.packet.signed}
          </motion.span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col font-mono text-[0.625rem] leading-4 text-muted-foreground">
        {sampleSecrets.map((secret, index) => (
          <ScrambleText
            key={secret.name}
            from={secret.value}
            to={secret.cipher}
            on
            animate={beat === "encrypt"}
            delayMs={index * 90}
            className="truncate"
          />
        ))}
      </div>
    </motion.div>
  )
}

function ForgedPacket({ refused }: { refused: boolean }) {
  return (
    <motion.div
      layoutId="hero-forged"
      transition={move}
      initial={refused ? false : { opacity: 0, transform: "scale(0.96)" }}
      animate={{ opacity: 1, transform: "scale(1)" }}
      className="absolute inset-0 flex flex-col justify-between rounded-lg border border-dashed border-destructive/70 bg-surface-raised p-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <LockOpen className="size-3.5 shrink-0 text-destructive" />
          <span className="truncate">{stage.packet.forgedTitle}</span>
        </span>
        <span className="shrink-0 rounded-full bg-destructive px-1.5 py-0.5 text-[0.625rem] font-medium text-background">
          {stage.packet.unsigned}
        </span>
      </div>
      <div aria-hidden="true" className="flex flex-col gap-1.5">
        <span className="h-1.5 w-4/5 rounded-full bg-destructive/25" />
        <span className="h-1.5 w-3/5 rounded-full bg-destructive/25" />
      </div>
    </motion.div>
  )
}

function ContainerTile({ on, index }: { on: boolean; index: number }) {
  return (
    <div className="relative flex h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-md border text-[0.625rem] leading-none">
      <div
        aria-hidden="true"
        style={{ transitionDelay: on ? `${index * 90}ms` : "0ms" }}
        className={cn(
          "absolute -inset-px rounded-md border border-signal/70 bg-signal/10 opacity-0 transition-opacity duration-300",
          on && "opacity-100"
        )}
      />
      <span className="relative font-mono">
        {stage.server.container}
      </span>
      <span className="relative grid">
        <span
          className={cn(
            "col-start-1 row-start-1 text-center text-muted-foreground transition-opacity duration-300",
            on ? "opacity-0" : "opacity-100"
          )}
        >
          {stage.server.stopped}
        </span>
        <span
          style={{ transitionDelay: on ? `${index * 90}ms` : "0ms" }}
          className={cn(
            "col-start-1 row-start-1 text-center font-medium text-signal transition-opacity duration-300",
            on ? "opacity-100" : "opacity-0"
          )}
        >
          {stage.server.running}
        </span>
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */

export function ProtocolStage() {
  const ref = useRef<HTMLDivElement>(null)
  const { playing, reducedMotion } = useStagePlayback(ref)
  const [mode, setMode] = useState<"deploy" | "breach">("deploy")

  const backToDeploy = useCallback(() => setMode("deploy"), [])

  const clock = useBeatClock(mode === "deploy" ? DEPLOY : BREACH, {
    enabled: playing,
    loop: mode === "deploy",
    initialIndex: RUN_INDEX,
    onComplete: backToDeploy,
  })

  // With reduced motion nothing plays: show the completed state of each mode.
  const beat: StageBeat = reducedMotion
    ? mode === "breach"
      ? "refused"
      : "run"
    : clock.id

  const breached = mode === "breach"
  const order = DEPLOY_ORDER.indexOf(beat)
  const reached = (id: DeployBeat) => !breached && order >= DEPLOY_ORDER.indexOf(id)

  const packetAt: PartyId | null = breached
    ? null
    : beat === "encrypt" || beat === "sign"
      ? "machine"
      : beat === "relay-zekno"
        ? "zekno"
        : beat === "relay-server" || beat === "verify" || beat === "run"
          ? "server"
          : null

  const forgedAt: PartyId | null =
    beat === "forged"
      ? "zekno"
      : beat === "refused" || beat === "breach-hold"
        ? "server"
        : null

  const stored = breached || reached("relay-zekno")
  const verified = reached("verify")
  const running = breached || reached("run")
  const refused = beat === "refused" || beat === "breach-hold"

  const railIndex = breached
    ? -1
    : beat === "encrypt"
      ? 0
      : beat === "sign"
        ? 1
        : beat === "relay-zekno" || beat === "relay-server"
          ? 2
          : beat === "verify"
            ? 3
            : beat === "run" || beat === "hold"
              ? 4
              : -1

  const caption = breached
    ? beat === "open"
      ? breach.captions.open
      : beat === "forged"
        ? breach.captions.forged
        : breach.captions.refused
    : beat === "idle"
      ? stage.captions.idle
      : beat === "encrypt"
        ? stage.captions.encrypt
        : beat === "sign"
          ? stage.captions.sign
          : beat === "relay-zekno"
            ? stage.captions.relayZekno
            : beat === "relay-server"
              ? stage.captions.relayServer
              : beat === "verify"
                ? stage.captions.verify
                : stage.captions.run

  return (
    <div
      ref={ref}
      className="rounded-2xl border bg-card p-3 text-left shadow-sm sm:p-5"
    >
      <div role="img" aria-label={stage.description}>
        <LayoutGroup id="hero-stage">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0">
            {/* Your machine */}
            <div className="min-w-0 lg:flex-1">
              <Panel party="machine">
                <div className="flex h-[4.5rem] flex-col justify-between">
                  {sampleSecrets.map((secret) => (
                    <div
                      key={secret.name}
                      className="flex items-center justify-between gap-3 font-mono text-[0.6875rem] leading-5"
                    >
                      <span className="shrink-0 text-muted-foreground">{secret.name}</span>
                      <span className="truncate">{secret.value}</span>
                    </div>
                  ))}
                </div>
                <Slot>{packetAt === "machine" ? <Packet beat={beat} /> : null}</Slot>
                <div className="flex h-7 items-center gap-2 text-xs">
                  <span className="flex items-center gap-1.5 rounded-full bg-foreground px-2.5 py-1 font-medium text-background">
                    <KeyRound className="size-3.5" />
                    {stage.machine.keyLabel}
                  </span>
                  <span className="text-muted-foreground">{stage.machine.keyNote}</span>
                </div>
              </Panel>
            </div>

            <Connector
              label={howItWorks.connectors[0]}
              active={beat === "relay-zekno"}
            />

            {/* Zekno */}
            <div className="min-w-0 lg:flex-1">
              <Panel
                party="zekno"
                dashed
                alert={breached}
                badge={
                  <span
                    className={cn(
                      "rounded-full bg-destructive px-2 py-0.5 text-[0.625rem] font-medium text-background opacity-0 transition-opacity duration-300",
                      breached && "opacity-100"
                    )}
                  >
                    {stage.zekno.breached}
                  </span>
                }
              >
                <div className="relative h-[4.5rem]">
                  <div
                    className={cn(
                      "absolute inset-0 flex items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground transition-opacity duration-300",
                      stored ? "opacity-0" : "opacity-100"
                    )}
                  >
                    {stage.zekno.empty}
                  </div>
                  <div
                    className={cn(
                      "absolute inset-0 flex flex-col justify-center gap-0.5 overflow-hidden rounded-md border bg-surface-raised px-2 font-mono text-[0.625rem] leading-4 text-muted-foreground transition-opacity duration-300",
                      stored ? "opacity-100" : "opacity-0"
                    )}
                  >
                    {sampleSecrets.map((secret) => (
                      <span key={secret.name} className="truncate">
                        {secret.cipher}
                        {secret.cipher.slice(0, 8)}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="relative flex h-7 items-center text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "absolute transition-opacity duration-300",
                      stored && !breached ? "opacity-100" : "opacity-0"
                    )}
                  >
                    {stage.zekno.stored}
                  </span>
                  <span
                    className={cn(
                      "absolute font-medium text-destructive transition-opacity duration-300",
                      breached ? "opacity-100" : "opacity-0"
                    )}
                  >
                    {stage.zekno.loot}
                  </span>
                </p>
                <Slot>
                  {packetAt === "zekno" ? <Packet beat={beat} /> : null}
                  {forgedAt === "zekno" ? <ForgedPacket refused={false} /> : null}
                </Slot>
              </Panel>
            </div>

            <Connector
              label={howItWorks.connectors[1]}
              active={beat === "relay-server" || beat === "forged"}
            />

            {/* Your server */}
            <div className="min-w-0 lg:flex-1">
              <Panel party="server">
                <div className="flex h-[4.5rem] items-center gap-2">
                  {[0, 1, 2].map((index) => (
                    <ContainerTile key={index} index={index} on={running} />
                  ))}
                </div>
                <Slot>
                  {packetAt === "server" ? <Packet beat={beat} /> : null}
                  {forgedAt === "server" ? <ForgedPacket refused /> : null}
                </Slot>
                <p className="relative flex h-7 items-center text-xs">
                  <span
                    className={cn(
                      "absolute text-muted-foreground transition-opacity duration-300",
                      verified || refused ? "opacity-0" : "opacity-100"
                    )}
                  >
                    {stage.server.waiting}
                  </span>
                  <span
                    className={cn(
                      "absolute flex items-center gap-1.5 font-medium text-signal transition-opacity duration-300",
                      verified ? "opacity-100" : "opacity-0"
                    )}
                  >
                    <ShieldCheck className="size-4" />
                    {stage.server.verified}
                  </span>
                  <span
                    className={cn(
                      "absolute flex items-center gap-1.5 font-medium text-destructive transition-opacity duration-300",
                      refused ? "opacity-100" : "opacity-0"
                    )}
                  >
                    <ShieldX className="size-4" />
                    {stage.server.refused}
                  </span>
                </p>
              </Panel>
            </div>
          </div>
        </LayoutGroup>
      </div>

      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <ol
            aria-label={a11y.stageProgress}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium"
          >
            {stage.rail.map((label, index) => (
              <li
                key={label}
                aria-current={index === railIndex ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5",
                  // Reached steps read as foreground; the rest stay at a readable muted contrast.
                  index <= railIndex ? "text-foreground" : "text-muted-foreground"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full transition-opacity duration-300",
                    index <= railIndex ? "bg-signal" : "bg-muted-foreground opacity-50"
                  )}
                />
                {label}
              </li>
            ))}
          </ol>
          <p
            aria-live={breached ? "polite" : "off"}
            className={cn(
              "mt-2 min-h-10 text-sm text-pretty sm:min-h-5",
              breached ? "text-foreground" : "text-muted-foreground"
            )}
          >
            <motion.span
              key={caption}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={enter}
            >
              {caption}
            </motion.span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {breach.hint}
          </span>
          {breached ? (
            <Button
              variant="outline"
              className="h-11 px-4 text-sm"
              onClick={() => setMode("deploy")}
            >
              <RotateCcw data-icon="inline-start" />
              {breach.reset}
            </Button>
          ) : (
            <Button
              variant="outline"
              className="h-11 border-destructive/60 px-4 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive dark:border-destructive/60"
              onClick={() => setMode("breach")}
            >
              <ShieldX data-icon="inline-start" />
              {breach.action}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
