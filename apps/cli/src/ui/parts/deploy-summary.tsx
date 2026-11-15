/**
 * A deploy as both the app's deploy screen (app/screens/deploy.tsx) and
 * `zekno deploy` at a terminal (ui/ink/deploy-view.tsx) draw it: the summary
 * panel, the stages of the stage row, and whether its number is used, so the
 * single command and the app look the same.
 */
import { Box, Text } from "ink"
import type { ReactNode } from "react"

import type { DeployProgress, DeployStage } from "../../shared/deploy"
import { Fields } from "./fields"
import { Panel, type PanelTone } from "./panel"
import type { Stage, StageState } from "./stages"

const LABELS = ["Checked", "Signed", "Sent", "Starting"] as const
/** How many stages are done once each stage has been reached. */
const DONE: Record<DeployStage, number> = { checked: 1, signed: 2, sent: 3, starting: 3, started: 4, failed: 3 }

/**
 * The stage row: done, the one in progress, and those not reached yet. A
 * deploy that started ends with ✔ Started; one that did not start, or was
 * refused, marks the stage it stopped at with ✖ (data-model.md, "Stages of
 * a deploy").
 */
export function stagesOf(deploy: DeployProgress): Stage[] {
  const done = deploy.stage === undefined ? 0 : DONE[deploy.stage]
  return LABELS.map((label, index): Stage => {
    let state: StageState = "pending"
    if (index < done) state = "done"
    else if (index === done) state = deploy.running ? "active" : deploy.outcome === "started" ? "done" : "failed"
    return { label: index === 3 && deploy.outcome === "started" ? "Started" : label, state }
  })
}

/** The number is used once the deploy was signed, whatever happened after. */
export function numberUsed(deploy: DeployProgress): boolean {
  return !deploy.running && deploy.outcome !== "started" && deploy.sequence !== undefined && deploy.stage !== undefined && deploy.stage !== "checked"
}

/**
 * The summary panel: the number, app, server, where the definition comes
 * from, the secrets and what it replaces. The single commands draw it too
 * (ui/ink/deploy-view.tsx), with a faint border, as on the board "zekno deploy:
 * success and failure".
 */
export function Summary({ deploy, width, tone = "focus" }: { deploy: DeployProgress; width: number; tone?: PanelTone }) {
  const names = deploy.secretNames ?? []
  const count = deploy.secrets ?? names.length
  const secrets = (
    <Text>
      {count === 0 ? "none" : count}
      {count > 0 && names.length > 0 ? <Text dimColor> ({names.join(", ")})</Text> : null}
    </Text>
  )
  const rows: [string, ReactNode][] = [
    ["app", deploy.app],
    ["server", deploy.server],
  ]
  if (deploy.from) rows.push(["from", deploy.from])
  rows.push(["secrets", secrets])
  if (deploy.replaces !== undefined) rows.push(["replaces", `deploy ${deploy.replaces}`])
  return (
    <Box width={width}>
      <Panel title={deploy.sequence === undefined ? "Deploy" : `Deploy ${deploy.sequence}`} tone={tone} flexGrow={1}>
        <Fields rows={rows} labelWidth={10} />
      </Panel>
    </Box>
  )
}
