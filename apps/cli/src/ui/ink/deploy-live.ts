/**
 * A deploy at a terminal while it runs (`Ui.deploy`): nothing is drawn until
 * the runner has answered; then the block of deploy-view.tsx is drawn below
 * the lines and redrawn as it goes, its live line a few times a second at
 * most; once the deploy ends, its last frame becomes a line of its own.
 */
import type { Instance } from "ink"

import {
  keptLines,
  type DeployProgress,
  type DeployStart,
  type DeployView,
} from "../../shared/deploy"
import type { DeployShown } from "./deploy-view"
import type { Store } from "./store"

/** How often, at most, the live line under a running deploy is redrawn. */
const LIVE_LINE_MS = 100

/** The summary's `from` row of a deploy from a settings file (DP3); nothing for any other deploy, whose summary is as before. */
const fromOf = (
  start: DeployStart
): Pick<DeployProgress, "from" | "fromDetail"> =>
  start.from === undefined
    ? {}
    : { from: start.from.file, fromDetail: start.from.detail }

/**
 * The deploy `start` names, drawn on `store` as it runs. `add` writes its
 * last frame as a line; `app` is the Ink instance that line is waited on.
 */
export function liveDeploy(
  start: DeployStart,
  store: Store,
  add: (item: Record<string, unknown>) => void,
  app: Pick<Instance, "waitUntilRenderFlush">
): DeployView {
  const kept = keptLines()
  // Nothing is drawn until the runner has answered: until then SSH may be asking for a password on this terminal.
  let shown: DeployShown | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let ended = false
  const latest = (): string[] =>
    kept.lines.length > 0 ? [kept.lines.at(-1)!] : []
  const show = (deploy: DeployProgress) => {
    shown = { start, deploy, dropped: 0 }
    store.set({ deploy: shown })
  }
  return {
    stage(stage, info) {
      if (ended) return
      const deploy = shown?.deploy ?? {
        server: start.server,
        app: start.app,
        lines: [],
        running: true,
        since: Date.now(),
        ...fromOf(start),
      }
      show({
        ...deploy,
        stage,
        sequence: info.sequence,
        secrets: info.secrets,
        lines: latest(),
      })
    },
    progress(line) {
      kept.push(line)
      // The live line is redrawn a few times a second at most, however fast Docker writes.
      if (shown && !ended && timer === undefined) {
        timer = setTimeout(() => {
          timer = undefined
          if (shown && !ended) show({ ...shown.deploy, lines: latest() })
        }, LIVE_LINE_MS)
      }
    },
    async end(ending) {
      if (ended) return
      ended = true
      clearTimeout(timer)
      const was = shown?.deploy
      store.set({ deploy: undefined })
      // A deploy that ended before the runner answered was never drawn: the error says it all.
      if (!was && ending.outcome === "error") return
      const sequence =
        ending.outcome === "error" ? was?.sequence : ending.sequence
      const secrets = ending.outcome === "error" ? was?.secrets : ending.secrets
      const stage =
        ending.outcome === "started"
          ? "started"
          : ending.outcome === "start_failed"
            ? "failed"
            : was?.stage
      const deploy: DeployProgress = {
        ...(was ?? {
          server: start.server,
          app: start.app,
          since: Date.now(),
          ...fromOf(start),
        }),
        sequence,
        secrets,
        stage,
        running: false,
        outcome: ending.outcome,
        lines: [...kept.lines],
      }
      // The last frame becomes a line of its own, so whatever comes next is said below it.
      add({
        kind: "deploy",
        shown: {
          start,
          deploy,
          dropped: kept.dropped,
          ms: ending.outcome === "error" ? undefined : ending.ms,
        },
      })
      await app.waitUntilRenderFlush()
    },
  }
}
