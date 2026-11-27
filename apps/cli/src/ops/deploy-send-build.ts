/**
 * The events, outcomes and refusals of a deploy that builds
 * (specs/016-build-from-source, contracts/cli.md CL7 step 13 and "The
 * answer"; CL14, "Every text from the server"; tasks T132). `deliver`
 * (deploy-send.ts) hands each event of the `deploy` request here, and the
 * answer once it came. A deploy that does not build never reaches this file,
 * and says exactly today's lines.
 *
 * - `build` moves the build stage (D1, D7): `building` once a build runs,
 *   then `built` once every build ended and one was built, or `reused` when
 *   each was reused, with D6 for each build reused.
 * - `build_line`: at a terminal and in the app, appended to the saved output
 *   (profile/build-output.ts) and said as the live line (D4, or D5 with the
 *   service when the deploy has several builds); with no terminal, said as
 *   D17 as it comes, and nothing is saved. Its text is the server's, cleaned
 *   by `clean()` before it gets here (server/session-events.ts), so what is
 *   saved and said holds no sequence a terminal acts on.
 * - `build_error`: the step and its error, kept for the failed build's panel.
 * - `build_failed`: its lead by reason (E1 to E13), with which deploy the app
 *   still runs, asked of the runner on the same session; E7 in place of E1
 *   when the step is a `COPY` or `ADD` of a file zekno's own secret-looking
 *   rule left out. E20 waits for check L9 (tasks T139).
 *
 * Every text is said by its row of design/lines.md, never in words (FR-092).
 */
import {
  type Build,
  RunnerBuildsSchema,
  type RunnerReport,
  type SessionEvent,
} from "@workspace/core"

import { RunnerRefused } from "../cli/errors"
import { type BuildOutput, startBuildOutput } from "../profile/build-output"
import type { Session } from "../server/session"
import {
  BuildStop,
  type BuildLine,
  type SecretKind,
} from "../shared/build-lines"
import type { DeployInfo } from "../shared/deploy"
import {
  type BuildFailure,
  FAILED_LINES,
  type FailedLead,
  type FailedReason,
  type ShownBuild,
} from "../shared/deploy-build"
import { verifiedDeploys } from "../shared/views"
import type { DeployCallbacks, DeployPlan } from "./deploy"
import type { BuildPlan, PreparedBuild } from "./deploy-build"
import { BUILD_PROTOCOL } from "./deploy-format"

/**
 * What a deploy that builds is told beyond `DeployCallbacks` (ops/deploy.ts).
 * `savedOutput`: at a terminal and in the app, the profile folder whose saved
 * output the builder's lines are appended to; left out with no terminal,
 * where each line is said as D17 and nothing is saved.
 */
export type BuildCallbacks = {
  savedOutput?: { home: string }
}

/** The builds of a signed deploy as the session shows them: each signed build, in the plan's order, with its services. */
export function shownBuilds(
  plan: Pick<BuildPlan, "builds">,
  signed: readonly Build[]
): ShownBuild[] {
  return signed.map((build, at) => ({
    key: build.key,
    services: [...(plan.builds[at]?.services ?? [])],
  }))
}

/** One build as the events left it. */
type Seen = {
  state?: "building" | "built" | "reused" | "failed"
  /** The last `FAILED_LINES` of its lines, and how many came. */
  lines: string[]
  total: number
  step: string | null
  error: string | null
}

/** What watches a deploy's build events. */
export type BuildWatch = {
  /** Takes an event of `deploy`: true when it was a build event, which nothing else then reads. */
  event(event: SessionEvent): boolean
  /** Whether `key` is one this deploy signed. */
  signs(key: string): boolean
  /** The deploy was answered: the saved output, if any, becomes the saved one. */
  answered(): void
  /** The deploy ended with no answer: nothing of its output is kept. */
  discard(): void
  /** The failure of a `build_failed` answer, its lead with which deploy runs, asked on the session. */
  failure(
    report: RunnerReport,
    session: Pick<Session, "request">
  ): Promise<BuildFailure>
}

type Watching = {
  plan: DeployPlan
  info: DeployInfo
  /** The builds signed, in the plan's order. */
  signed: readonly Build[]
  /** When the deploy was signed, as the history records it, for the saved output's head. */
  at: string
  callbacks: DeployCallbacks & BuildCallbacks
}

/**
 * The deploy whose build a reused image is, from this machine's history: the
 * oldest deploy before this one that signed `key` and whose build did not
 * fail. Null when this machine cannot tell (D6).
 */
function builtBy(watching: Watching, key: string): number | null {
  const { team, server, app } = watching.plan
  const found = verifiedDeploys(team, server, app).find(
    (entry) =>
      entry.deploy.sequence < watching.info.sequence &&
      entry.outcome !== "build_failed" &&
      (entry.deploy.builds ?? []).some(({ build }) => build.key === key)
  )
  return found?.deploy.sequence ?? null
}

/** Starts watching the build events of a deploy signed with `signed`. */
export function watchBuilds(watching: Watching): BuildWatch {
  const { plan, info, signed, callbacks } = watching
  const shown = shownBuilds(plan.build!, signed)
  const seen = new Map<string, Seen>(
    shown.map(({ key }) => [
      key,
      { lines: [], total: 0, step: null, error: null },
    ])
  )
  const serviceOf = (key: string) =>
    shown.find((build) => build.key === key)?.services[0] ?? ""
  const say = (line: BuildLine) => callbacks.line?.(line)
  const home = callbacks.savedOutput?.home
  let output: BuildOutput | undefined
  let saving = home !== undefined

  /** Appends a line to the saved output, started at the first line, so a deploy that built nothing leaves the saved one as it was. A file that cannot be written stops the saving, never the deploy. */
  const save = (line: string) => {
    if (!saving || home === undefined) return
    try {
      output ??= startBuildOutput(home, plan.server.serverId, plan.app, {
        deploy: info.sequence,
        server: plan.server.name,
        at: watching.at,
      })
      output.line(line)
    } catch {
      saving = false
      output?.discard()
      output = undefined
    }
  }

  /** The stage once every build ended: built when one was built, reused when each was. */
  const settled = () => {
    const states = [...seen.values()].map((each) => each.state)
    if (states.some((state) => state === "failed")) return
    if (!states.every((state) => state === "built" || state === "reused"))
      return
    callbacks.stage?.(states.includes("built") ? "built" : "reused", info)
  }

  return {
    event(event) {
      if (
        event.event !== "build" &&
        event.event !== "build_line" &&
        event.event !== "build_error"
      )
        return false
      const build = seen.get(event.key)
      // A key this deploy did not sign is not this deploy's: it is not shown, and the answer is checked on its own.
      if (build === undefined) return true
      if (event.event === "build") {
        build.state = event.state
        if (event.state === "building") callbacks.stage?.("building", info)
        // D6 names the deploy whose build it is; said when this machine's history can tell, the stage says the rest.
        const by =
          event.state === "reused" ? builtBy(watching, event.key) : null
        if (by !== null)
          say({ id: "D6", service: serviceOf(event.key), deploy: by })
        settled()
        return true
      }
      if (event.event === "build_error") {
        build.step = event.step
        build.error = event.error
        return true
      }
      build.total++
      build.lines.push(event.line)
      if (build.lines.length > FAILED_LINES) build.lines.shift()
      if (home === undefined) {
        say({ id: "D17", line: event.line })
        return true
      }
      save(event.line)
      say(
        shown.length > 1
          ? { id: "D5", service: serviceOf(event.key), line: event.line }
          : { id: "D4", line: event.line }
      )
      return true
    },
    signs: (key) => seen.has(key),
    answered() {
      try {
        output?.end()
      } catch {
        // The saved output before it stays: the deploy's answer is what counts.
      }
    },
    discard() {
      output?.discard()
    },
    async failure(report, session) {
      const failed = report.build!
      const build = seen.get(failed.key)!
      const running = await runningOf(session, plan)
      return {
        key: failed.key,
        reason: failed.reason as FailedReason,
        lead: leadOf(watching, report, build, running),
        step: build.step,
        error: build.error,
        lines: [...build.lines],
        total: build.total,
      }
    },
  }
}

/**
 * Which deploy the app runs once its build failed, as the runner says it on
 * the same session (`builds`' `running`; core.md CO12): nothing of the app
 * changed. When that answer cannot be had, the latest deploy of the app this
 * machine's history shows answered and started, or null.
 */
async function runningOf(
  session: Pick<Session, "request">,
  plan: DeployPlan
): Promise<number | null> {
  try {
    const answer = await session.request("builds", RunnerBuildsSchema, {
      input: { apps: [plan.app] },
    })
    if ("apps" in answer && Object.hasOwn(answer.apps, plan.app))
      return answer.apps[plan.app]!.running
  } catch {
    // Read from the history below.
  }
  const { team, server, app } = plan
  const started = verifiedDeploys(team, server, app).filter(
    (entry) =>
      entry.outcome === "started" ||
      entry.outcome === "routes_failed" ||
      entry.outcome === "unhealthy"
  )
  return started.at(-1)?.deploy.sequence ?? null
}

/** The lead of a failed build, by its reason (CL7, "The answer"; lines.md part E). */
function leadOf(
  watching: Watching,
  report: RunnerReport,
  build: Seen,
  running: number | null
): FailedLead {
  const { plan, info, signed } = watching
  const failed = report.build!
  const service =
    shownBuilds(plan.build!, signed).find((each) => each.key === failed.key)
      ?.services[0] ?? ""
  const lead = { service, server: plan.server.name, app: plan.app, running }
  switch (failed.reason) {
    case "out_of_memory":
      return { id: "E8", ...lead }
    case "out_of_disk":
      return { id: "E10", ...lead }
    case "time_limit": {
      const limit = signed.find((each) => each.key === failed.key)!.timeout
      return { id: "E9", ...lead, limit }
    }
    case "wrong_processor":
      return {
        id: "E11",
        ...lead,
        image: failed.arch!.image,
        host: failed.arch!.server,
      }
    case "cache_used":
      return { id: "E12", ...lead }
    case "team_changed":
      return {
        id: "E13",
        ...lead,
        team: failed.team!.version,
        signer: plan.team.profile.memberName,
        deploy: info.sequence,
      }
    // `step_failed`, and any reason a later runner adds: E7 when its step copies a file zekno left out of that build's own
    // folder sent, else E1 or E2.
    default: {
      const at = signed.findIndex((each) => each.key === failed.key)
      const prepared = plan.build!.builds[at]
      const copied =
        prepared === undefined ? undefined : leftOutCopied(prepared, build.step)
      if (copied !== undefined) return { id: "E7", ...lead, ...copied }
      return running === null
        ? { id: "E2", service, server: lead.server, app: lead.app }
        : { id: "E1", ...lead, running }
    }
  }
}

/**
 * The sources a `COPY` or `ADD` step names, as BuildKit names a failed step:
 * an optional `[stage n/m]` before the instruction, its flags, its sources,
 * then its destination; in shell form or JSON form. None for any other step,
 * for `--from`, which copies from a stage or an image and not from the folder
 * sent, and for a heredoc.
 */
export function copiedSources(step: string): string[] {
  const text = step.replace(/^\s*\[[^\]]*\]\s*/, "").trim()
  const found = /^(?:COPY|ADD)\s+([\s\S]*)$/i.exec(text)
  if (found === null) return []
  const words: string[] = []
  let rest = found[1]!.trim()
  for (;;) {
    const flag = /^--(\S+)\s*/.exec(rest)
    if (flag === null) break
    if (/^from=/i.test(flag[1]!)) return []
    rest = rest.slice(flag[0].length)
  }
  if (rest.includes("<<")) return []
  if (rest.startsWith("[")) {
    try {
      const list: unknown = JSON.parse(rest)
      if (Array.isArray(list) && list.every((each) => typeof each === "string"))
        words.push(...(list as string[]))
    } catch {
      return []
    }
  } else words.push(...rest.split(/\s+/).filter(Boolean))
  return words.slice(0, -1)
}

/** A source as a path of the folder sent: `./` and `/` at its start dropped, `.` parts dropped. */
const asSentPath = (source: string): string =>
  source
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/")

/**
 * The file a failed `COPY` or `ADD` step names that zekno's secret-looking
 * rule left out of that build's own folder sent, with its kind as the walk
 * found it (E7), or undefined; never a line of `.dockerignore`.
 */
export function leftOutCopied(
  build: Pick<PreparedBuild, "leftOutSecrets">,
  step: string | null
): { path: string; kind: SecretKind } | undefined {
  if (step === null) return undefined
  for (const source of copiedSources(step)) {
    const path = asSentPath(source)
    const left = build.leftOutSecrets.find((each) => each.path === path)
    if (left !== undefined) return { path, kind: left.kind }
  }
  return undefined
}

/**
 * A refusal of a deploy that builds, as it is said (CL7, "The answer"): F11
 * for `malformed` from a runner below protocol 6, which cannot read a deploy
 * with builds; R14 with the free disk and the floor the runner reported for
 * `low_disk` (`server`, the server's name); every other refusal as
 * `deployAnswer` made it, R11 to R13 among them (cli/errors.ts). R12a, for
 * the build plugin, follows check L2 (tasks T139).
 */
export function buildRefusal(
  error: unknown,
  runner: { protocol: number } | undefined,
  server = ""
): unknown {
  if (!(error instanceof RunnerRefused)) return error
  if (
    error.reason === "malformed" &&
    (runner === undefined || runner.protocol < BUILD_PROTOCOL)
  )
    return new BuildStop({ id: "F11" })
  if (error.reason === "low_disk" && error.disk !== undefined)
    return new BuildStop({ id: "R14", server, ...error.disk })
  return error
}
