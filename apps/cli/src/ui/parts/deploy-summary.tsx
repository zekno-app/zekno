/**
 * A deploy as both the app's deploy screen (app/screens/deploy.tsx) and
 * `zekno deploy` at a terminal (ui/ink/deploy-view.tsx) draw it: the summary
 * panel, the stages of the stage row, and whether its number is used, so the
 * single command and the app look the same.
 */
import { Box, Text } from "ink"
import type { ReactNode } from "react"

import { B2_LABEL, B3, C1_STAGE, PANEL_DOMAINS } from "../../domains/words"
import type { DeployProgress, DeployStage } from "../../shared/deploy"
import { Fields } from "./fields"
import { Panel, type PanelTone } from "./panel"
import type { Stage, StageState } from "./stages"

const LABELS = ["Checked", "Signed", "Sent", "Starting"] as const
/**
 * How many stages are done once each stage has been reached. The build
 * stage's states (specs/016-build-from-source, D1, D7) count as `sent` until
 * the stage row draws a stage for them, with its label (tasks T144).
 */
const DONE: Record<DeployStage, number> = {
  checked: 1,
  signed: 2,
  sent: 3,
  building: 3,
  built: 3,
  reused: 3,
  build_failed: 3,
  starting: 3,
  started: 4,
  failed: 3,
}

/**
 * Whether the app of a deploy that ended started: `started`, and protocol
 * 4's `routes_failed` and `unhealthy`, whose app started all the same
 * (specs/015-domains-https, contracts/cli.md, CL3: their stage row ends
 * `✔ Started`).
 */
const appStarted = (deploy: DeployProgress): boolean =>
  deploy.outcome === "started" ||
  deploy.outcome === "routes_failed" ||
  deploy.outcome === "unhealthy"

/**
 * The stage row: done, the one in progress, and those not reached yet. A
 * deploy that started ends with ✔ Started; one that did not start, or was
 * refused, marks the stage it stopped at with ✖ (data-model.md, "Stages of
 * a deploy"). A deploy with a health check has a fifth stage
 * (`healthStagesOf`); one without draws the four stages it always drew.
 */
export function stagesOf(deploy: DeployProgress): Stage[] {
  if (deploy.health !== undefined) return healthStagesOf(deploy)
  const done = deploy.stage === undefined ? 0 : DONE[deploy.stage]
  return LABELS.map((label, index): Stage => {
    let state: StageState = "pending"
    if (index < done) state = "done"
    else if (index === done)
      state = deploy.running ? "active" : appStarted(deploy) ? "done" : "failed"
    return {
      // Started once the runner said so, also while the new domains are waited for (board `DomainsDeploy`).
      label:
        index === 3 && (appStarted(deploy) || deploy.stage === "started")
          ? "Started"
          : label,
      state,
    }
  })
}

/**
 * The stage row of a deploy with a health check (specs/015-domains-https,
 * C1; contracts/cli.md, CL3; board `DomainsHealth`): `Healthy` after
 * `Started`. The runner's first `health` event means the app started, so
 * from it on `✔ Started` and `Healthy` is in progress, with C2 under it.
 * `Healthy` is done once the deploy started (or, still running, once the
 * wait for HTTPS began, which only a deploy that started has); `✖ Healthy`
 * when it was not healthy in time, or broke off while it was waited for;
 * not reached (`○`) after `routes_failed`, which says nothing of health, and
 * after a start that failed or a deploy that stopped before.
 */
function healthStagesOf(deploy: DeployProgress): Stage[] {
  let done = deploy.stage === undefined ? 0 : DONE[deploy.stage]
  if (deploy.stage === "starting" && deploy.waitingFor !== undefined) done = 4
  if (deploy.stage === "started") {
    const healthy = deploy.running
      ? deploy.https !== undefined
      : deploy.outcome === "started"
    done = healthy ? 5 : 4
  }
  return [...LABELS, C1_STAGE].map((label, index): Stage => {
    let state: StageState = "pending"
    if (index < done) state = "done"
    else if (index === done)
      state = deploy.running
        ? "active"
        : deploy.outcome === "routes_failed"
          ? "pending"
          : "failed"
    return { label: index === 3 && done >= 4 ? "Started" : label, state }
  })
}

/**
 * The number is used once the deploy was signed, whatever happened after;
 * but a version-2 deploy that ended in error, refused or without an answer,
 * used none: the next number is the runner's, so it cannot be said
 * (specs/014-deploy-v2, research R19, C8). Kept when the app did not start,
 * and for version 1.
 */
export function numberUsed(deploy: DeployProgress): boolean {
  return (
    !deploy.running &&
    !appStarted(deploy) &&
    !(deploy.format === 2 && deploy.outcome === "error") &&
    deploy.sequence !== undefined &&
    deploy.stage !== undefined &&
    deploy.stage !== "checked"
  )
}

/**
 * The summary panel: the number, app, server, where the definition comes
 * from, the secrets, the domains and what it replaces. The single commands
 * draw it too (ui/ink/deploy-view.tsx), with a faint border, as on the board
 * "zekno deploy: success and failure".
 */
export function Summary({
  deploy,
  width,
  tone = "focus",
  domainsRoom = PANEL_DOMAINS + 1,
}: {
  deploy: DeployProgress
  width: number
  tone?: PanelTone
  /** The most rows the `domains` rows may take: the app's deploy screen gives fewer in a short window. */
  domainsRoom?: number
}) {
  const names = deploy.secretNames ?? []
  const count = deploy.secrets ?? names.length
  const secrets = (
    <Text>
      {count === 0 ? "none" : count}
      {count > 0 && names.length > 0 ? (
        <Text dimColor> ({names.join(", ")})</Text>
      ) : null}
    </Text>
  )
  const rows: [string, ReactNode][] = [
    ["app", deploy.app],
    ["server", deploy.server],
  ]
  // A settings file's services follow its name, dim and two spaces after it (specs/010-app-settings, board `SettingsDeploy`).
  if (deploy.from)
    rows.push([
      "from",
      deploy.fromDetail === undefined ? (
        deploy.from
      ) : (
        <Text>
          {deploy.from}
          <Text dimColor>
            {"  "}
            {deploy.fromDetail}
          </Text>
        </Text>
      ),
    ])
  rows.push(["secrets", secrets])
  rows.push(...domainRows(deploy.domains ?? [], domainsRoom))
  if (deploy.replaces !== undefined)
    rows.push(["replaces", `deploy ${deploy.replaces}`])
  // Never pressed shorter than its rows: a short window cuts what comes after it instead.
  return (
    <Box width={width} flexShrink={0}>
      <Panel
        title={
          deploy.sequence === undefined ? "Deploy" : `Deploy ${deploy.sequence}`
        }
        tone={tone}
        flexGrow={1}
      >
        <Fields rows={rows} labelWidth={10} />
      </Panel>
    </Box>
  )
}

/**
 * The panel's `domains` rows (specs/015-domains-https, B2, B3; boards
 * `DomainsDeploy`, `DomainsApp`): one domain a row, labelled on the first
 * only; past three, the first three and `and 5 more`, dim, on a row of its
 * own. In `room` rows when there are fewer than that takes: fewer domains
 * before `and N more`, which is then labelled when it stands alone; none
 * with no room. None for a deploy without a domain, whose panel is as before.
 */
function domainRows(
  domains: readonly string[],
  room: number
): [string, ReactNode][] {
  const shown = domainsShownIn(domains.length, room)
  const rows: [string, ReactNode][] = domains
    .slice(0, shown)
    .map((domain, at) => [at === 0 ? B2_LABEL : "", domain])
  if (domains.length > shown && room > 0)
    rows.push([
      shown === 0 ? B2_LABEL : "",
      <Text dimColor>{B3(domains.length - shown)}</Text>,
    ])
  return rows
}

/** How many of `count` domains the panel names in `room` rows, the row of `and N more` counted. */
const domainsShownIn = (count: number, room: number): number =>
  count <= Math.min(PANEL_DOMAINS, room)
    ? count
    : Math.max(0, Math.min(PANEL_DOMAINS, room - 1))

/** The rows the panel's `domains` rows take in `room` rows (`domainRows`). */
export function domainRowsIn(count: number, room: number): number {
  const shown = domainsShownIn(count, room)
  return shown + (count > shown && room > 0 ? 1 : 0)
}
