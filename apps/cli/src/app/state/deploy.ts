/**
 * A deploy started from the app (board "A deploy in progress"): its screen,
 * its stages, Docker's lines and how it ended. A `q` pressed while it ran
 * closes the app once it ends.
 */
import type { AppKey } from "../keys"
import type { EventOf, Step } from "./events"
import { isText } from "./input"
import { go, keep, push, replaceTop, stay } from "./steps"
import { withAppRows } from "./team"
import type { DeployProgress } from "../../shared/deploy"
import { DEPLOY_LINES, type Screen, type State } from "./types"

/** The deploy screen's one key of its own: `o` shows or hides Docker's output. */
export const onDeploy = (
  state: State,
  screen: Extract<Screen, { name: "deploy" }>,
  key: AppKey
): Step | undefined =>
  isText(key, "o")
    ? stay(replaceTop(state, { ...screen, output: !screen.output }))
    : undefined

export function deployStarted(
  state: State,
  event: EventOf<"deploy-started">
): Step {
  const deploy: DeployProgress = {
    server: event.server,
    app: event.app,
    lines: [],
    running: true,
    since: event.at,
    from: event.from,
    replaces: event.replaces,
    secretNames: event.secretNames,
  }
  return push({ ...state, deploy }, { name: "deploy", output: false })
}

export function deployStage(
  state: State,
  event: EventOf<"deploy-stage">
): Step {
  if (!state.deploy) return stay(state)
  // From Checked on, the panel names what the deploy lists, not what this machine holds (research R20).
  return stay({
    ...state,
    deploy: {
      ...state.deploy,
      stage: event.stage,
      sequence: event.sequence,
      secrets: event.secrets,
      format: event.format ?? state.deploy.format,
      secretNames: event.secretNames ?? state.deploy.secretNames,
      ...(event.domains === undefined ? {} : { domains: event.domains }),
      ...(event.health === undefined ? {} : { health: event.health }),
    },
  })
}

/** The runner waits for a service's health (specs/015-domains-https, C2): which, its path when it has one, since when. */
export function deployHealth(
  state: State,
  event: EventOf<"deploy-health">
): Step {
  if (!state.deploy) return stay(state)
  const path = state.deploy.health?.services.find(
    (entry) => entry.service === event.service
  )?.path
  return stay({
    ...state,
    deploy: {
      ...state.deploy,
      waitingFor: {
        service: event.service,
        ...(path === undefined ? {} : { path }),
        since: event.at,
      },
    },
  })
}

/** A new domain during the wait for HTTPS (B4 to B6): its entry replaced, or added in the order they come. */
export function deployHttps(
  state: State,
  event: EventOf<"deploy-https">
): Step {
  if (!state.deploy) return stay(state)
  const was = state.deploy.https ?? []
  const { shown } = event
  const https = was.some((each) => each.domain === shown.domain)
    ? was.map((each) => (each.domain === shown.domain ? shown : each))
    : [...was, shown]
  return stay({ ...state, deploy: { ...state.deploy, https } })
}

export function deployProgress(
  state: State,
  event: EventOf<"deploy-progress">
): Step {
  if (!state.deploy) return stay(state)
  return stay({
    ...state,
    deploy: {
      ...state.deploy,
      lines: keep(state.deploy.lines, event.lines, DEPLOY_LINES),
    },
  })
}

export function deployEnded(
  state: State,
  event: EventOf<"deploy-ended">
): Step {
  if (!state.deploy) return stay(state)
  const { server, app, sequence } = state.deploy
  const deploy = {
    ...state.deploy,
    running: false,
    outcome: event.outcome,
    endedAt: event.at,
    result: event.notice,
  }
  // The runner just said it accepted this deploy, whether or not the app started, its routes are in force or it was healthy.
  const accepted =
    sequence !== undefined && event.outcome !== "error"
      ? withAppRows(state, server, (row) =>
          row.name === app ? { ...row, accepted: sequence } : row
        )
      : state
  const ended = { ...accepted, deploy, notice: event.notice }
  return ended.quitting
    ? go({ ...ended, exiting: true }, { kind: "exit" })
    : stay(ended)
}
