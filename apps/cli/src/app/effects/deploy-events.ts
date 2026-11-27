/**
 * A deploy or a rollback from the app once it is planned: signed and sent,
 * `sendDeploy`'s callbacks turned into events (its stages, Docker's lines in
 * batches, the health check it waits for, a domain that points elsewhere),
 * HTTPS waited for, and its result as a line wherever the person is. Split
 * from deploys.ts, which plans it and asks the questions before it
 * (specs/016-build-from-source, contracts/cli.md CL14).
 */
import { sendDeploy, type DeployPlan } from "../../ops/deploy"
import { httpsAfter } from "../../ops/deploy-https"
import { lineText, type BuildLine } from "../../shared/build-lines"
import { stoppedWaiting } from "../../shared/start-limit"
import { seconds } from "../../shared/time"
import { latestAccepted, secretNamesOf } from "../../shared/views"
import { DEPLOY_LINES } from "../state/types"
import { batcher } from "./batcher"
import { reasonOf, type Context } from "./context"
import { appBuildCallbacks, builderText, failedBuild } from "./deploy-build"

/** Signs and sends a planned deploy or rollback, with its stages and Docker's lines as events, and its result as a line wherever the person is. */
export async function sendAsEvents(
  context: Context,
  planned: DeployPlan & { from: string }
): Promise<void> {
  const { dispatch, fail, ops, notice, refresh } = context
  const { team, server, app } = planned
  const started = Date.now()
  dispatch({
    type: "deploy-started",
    server: server.name,
    app,
    at: started,
    from: planned.from,
    replaces: latestAccepted(team, server, app),
    secretNames: secretNamesOf(team, server, app),
  })
  // Docker's lines are drawn in batches, and past `DEPLOY_LINES` waiting the runner is read no further until they are.
  const lines = batcher<string>(DEPLOY_LINES, (taken) =>
    dispatch({ type: "deploy-progress", lines: taken })
  )
  // specs/016-build-from-source (J2, J3, J5): the lines of a deploy that builds, in batches as Docker's are, with the
  // services of its first build, which D4 is said for. Each of the builder's lines also goes to the saved output.
  let services: readonly string[] = []
  const built = batcher<BuildLine>(DEPLOY_LINES, (taken) =>
    dispatch({ type: "deploy-build", lines: taken, services })
  )
  const flush = () => {
    lines.flush()
    built.flush()
  }
  let result
  try {
    result = await sendDeploy(ops, planned, {
      ...(planned.build === undefined
        ? {}
        : appBuildCallbacks(ops.home, {
            // The builder's text goes with Docker's lines, so `o` shows both in the order printed (J5).
            running: (line) => {
              const text = builderText(line)
              if (text !== undefined) lines.add(text)
              built.add(line)
            },
            other: (line) => notice("warning", lineText(line)),
          })),
      stage: (stage, info) => {
        services = info.build?.builds[0]?.services ?? services
        dispatch({
          type: "deploy-stage",
          stage,
          sequence: info.sequence,
          secrets: info.secrets,
          format: info.format,
          secretNames: info.secretNames,
          ...(info.domains === undefined ? {} : { domains: info.domains }),
          ...(info.health === undefined ? {} : { health: info.health }),
        })
      },
      progress: (line) => lines.add(line),
      warning: (text) => notice("warning", text),
      // C2: only a deploy with a health check is told (specs/015-domains-https, CL7).
      health: (service) =>
        dispatch({ type: "deploy-health", service, at: Date.now() }),
      // B1: only a deploy with a domain new to the app is told.
      pointed: (domain, address) =>
        dispatch({ type: "deploy-pointed", domain, address }),
    })
  } catch (error) {
    flush()
    const reason = reasonOf(error)
    if (reason === undefined) return fail(error)
    dispatch({
      type: "deploy-ended",
      outcome: "error",
      notice: { tone: "error", text: reason },
      at: Date.now(),
    })
    return refresh(team, server, app)
  }
  flush()
  const ended = Date.now()
  // A start with domains new to the app waits for HTTPS first, each domain's state an event (specs/015-domains-https,
  // CL3; B4 to B6). `routes_failed` and `unhealthy` end with their sentence (B16 to B19, C3, C4).
  await httpsAfter(ops, result, (shown) =>
    dispatch({ type: "deploy-https", shown })
  )
  const { outcome } = result
  const { startLimit } = result.report
  // A build that failed (J6, J7): its lead in the error colour, and the failure for its panel.
  const failed = failedBuild(result)
  const text =
    failed?.text ??
    result.problem ??
    (outcome === "start_failed"
      ? startLimit === undefined
        ? `${server.name} accepted deploy ${result.sequence}, but the app did not start.`
        : // B20: the runner stopped waiting for the start at its limit (protocol 5).
          stoppedWaiting(server.name, result.sequence, app, startLimit)
      : `${app} is live on ${server.name} in ${seconds(ended - started)}`)
  dispatch({
    type: "deploy-ended",
    outcome,
    notice: {
      tone: outcome === "started" ? "success" : "error",
      text,
    },
    at: ended,
    ...(failed === undefined ? {} : { failure: failed.failure }),
  })
  dispatch({ type: "server-reached", server: server.name, reachable: true })
  refresh(team, server, app)
  context.readDomains?.(team, server, app)
}
