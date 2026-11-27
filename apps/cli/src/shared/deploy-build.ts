/**
 * What a deploy that builds is, as it happens (specs/016-build-from-source,
 * contracts/cli.md CL7 steps 12 and 13, "The answer"; tasks T132): the build
 * stage's states, the builds it signed, and what the stage row, the live line
 * and a failed build's panel are drawn from. Split from shared/deploy.ts,
 * which takes these into `DeployStage`, `DeployOutcome`, `DeployInfo` and
 * `DeployProgress`. No sentence is here: a line is said by its row of
 * design/lines.md (shared/build-lines.ts; FR-092), and the screens draw them
 * (tasks T144). Nothing here loads Ink or the profile.
 */
import type { BuildReason } from "@workspace/core"

import type { BuildLine, LineOf } from "./build-lines"

/**
 * The states of the build stage, between `sent` and `starting` (D1, D7):
 * a build runs; every build is done and one at least was built; every build
 * was reused; a build failed.
 */
export type BuildStage = "building" | "built" | "reused" | "build_failed"

/** The stages that are the build stage's, in the order a deploy reaches them. */
export const BUILD_STAGES: readonly BuildStage[] = [
  "building",
  "built",
  "reused",
  "build_failed",
]

/** One build a deploy signed: its key, and the services it serves in the settings' order, the first naming it in a line. */
export type ShownBuild = { key: string; services: string[] }

/** How many of the builder's last lines a failed build shows (E3, E4; FR-071). */
export const FAILED_LINES = 40

/** The reasons a deploy's answer gives a failed build (core.md CO10): never `runner_restarted`, which only `builds` reports. */
export type FailedReason = Exclude<BuildReason, "runner_restarted">

/** The leads of a failed build, one for each reason (E1, E2, E7 to E13; E20 waits for check L9, T139). */
export type FailedLead = LineOf<
  "E1" | "E2" | "E7" | "E8" | "E9" | "E10" | "E11" | "E12" | "E13"
>

/**
 * A build that failed (CL7, "The answer"): its key and reason as the report
 * carries them, the lead said for them, the step and its error from
 * `build_error` (null when none came, which only a `step_failed` sends), the
 * builder's last `FAILED_LINES` lines of that build and how many it wrote.
 * Every text is the server's, already cleaned (CL14).
 */
export type BuildFailure = {
  key: string
  reason: FailedReason
  lead: FailedLead
  step: string | null
  error: string | null
  lines: string[]
  total: number
}

/**
 * The builds of a deploy, from the `checked` stage on, in `DeployInfo`:
 * those it signed, and, on the result of a build that failed, the failure.
 */
export type DeployBuildInfo = {
  builds: ShownBuild[]
  failure?: BuildFailure
}

/**
 * What a deploy that builds adds to `DeployProgress`, for the stage row and
 * the live line (D1 to D7, D19) and the failed build's panel (E1 to E13):
 * the bytes sent of the total, and whether it is a later round (D2, D3); the
 * service whose build runs and the builder's latest line (D4, D5); each
 * build reused and the deploy whose build it is, null when this machine
 * cannot tell (D6); the wait for another app's build (D19), since when; and
 * the failure. Left out of a deploy that does not build.
 */
export type DeployBuildProgress = {
  sent?: { bytes: number; total: number; again: boolean }
  building?: { service: string; line?: string }
  reused: { service: string; deploy: number | null }[]
  waiting?: { app: string; seconds: number; limit: number; since: number }
  failure?: BuildFailure
}

/**
 * A deploy's build progress with one line said while it runs taken in, as
 * the app's screen and the single command keep it: D4 and D5 are the live
 * line, with the service building (the first of `services` for D4, the one
 * build of the deploy); D6 a build reused; any other line leaves it as it
 * was. `services`: the services of the deploy's first build.
 */
export function withBuildLine(
  progress: DeployBuildProgress | undefined,
  line: BuildLine,
  services: readonly string[] = []
): DeployBuildProgress {
  const now = progress ?? { reused: [] }
  switch (line.id) {
    case "D4":
      return {
        ...now,
        building: { service: services[0] ?? "", line: line.line },
      }
    case "D5":
      return { ...now, building: { service: line.service, line: line.line } }
    case "D6":
      return {
        ...now,
        reused: [...now.reused, { service: line.service, deploy: line.deploy }],
      }
    default:
      return now
  }
}

/**
 * The lines a failed build ends with, in the order part E draws them: its
 * lead, the panel's step, error and last lines (E3), the count when the
 * builder wrote more (E4), and, after E1 or E2, where the whole output is
 * (E6): the leads E7 to E13 carry their own line of what to do. E5, the
 * number used, is today's line, said by the screens as today.
 */
export function failureLines(failure: BuildFailure): BuildLine[] {
  const lines: BuildLine[] = [
    failure.lead,
    {
      id: "E3",
      step: failure.step ?? "",
      error: failure.error ?? "",
      lines: failure.lines,
    },
  ]
  if (failure.total > failure.lines.length)
    lines.push({ id: "E4", shown: failure.lines.length, total: failure.total })
  if (failure.lead.id === "E1" || failure.lead.id === "E2")
    lines.push({ id: "E6" })
  return lines
}
