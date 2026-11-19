/**
 * A deploy at a terminal while it runs (`Ui.deploy`): nothing is drawn until
 * the runner has answered; then the block of deploy-view.tsx is drawn below
 * the lines and redrawn as it goes, its live line a few times a second at
 * most; once the deploy ends, its last frame becomes a line of its own.
 *
 * With a domain or a health check (specs/015-domains-https, contracts/cli.md,
 * CL3): B1 is a line of its own before the block, as nothing is drawn yet;
 * the domains and the health check it signs, the service the runner waits
 * for and each new domain's wait for HTTPS are kept in the block's deploy,
 * for the block to draw (deploy-view.tsx).
 */
import type { Instance } from "ink"

import { B1 } from "../../domains/words"
import {
  keptLines,
  type DeployProgress,
  type DeployStart,
  type DeployView,
  type HttpsShown,
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
    // How long it took is known once the wait for HTTPS began, and kept while the block is redrawn.
    shown = {
      start,
      deploy,
      dropped: 0,
      ...(shown?.ms === undefined ? {} : { ms: shown.ms }),
    }
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
      // The format is kept for how the deploy ended (research R19); the names are not drawn here (R20).
      show({
        ...deploy,
        stage,
        sequence: info.sequence,
        secrets: info.secrets,
        format: info.format,
        ...(info.domains === undefined ? {} : { domains: info.domains }),
        ...(info.health === undefined ? {} : { health: info.health }),
        lines: latest(),
      })
    },
    // B1, before anything is signed, and so before the block is drawn: a line of its own above it.
    pointed(domain, address) {
      const said = B1(domain, start.server, address)
      add({ kind: "success", text: said.text, detail: said.detail })
    },
    health(service) {
      if (!shown || ended) return
      const path = shown.deploy.health?.services.find(
        (entry) => entry.service === service
      )?.path
      show({
        ...shown.deploy,
        waitingFor: {
          service,
          ...(path === undefined ? {} : { path }),
          since: Date.now(),
        },
      })
    },
    // The block stays live while the new domains are waited for; it is drawn as started from the first.
    https(state) {
      if (!shown || ended) return
      const was = shown.deploy.https ?? []
      const https: HttpsShown[] = was.some(
        (each) => each.domain === state.domain
      )
        ? was.map((each) => (each.domain === state.domain ? state : each))
        : [...was, state]
      shown = {
        ...shown,
        deploy: { ...shown.deploy, https },
        ms: shown.ms ?? Date.now() - shown.deploy.since,
      }
      store.set({ deploy: shown })
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
        ending.outcome === "error"
          ? was?.stage
          : ending.outcome === "start_failed"
            ? "failed"
            : "started"
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
        ...(ending.outcome !== "error" && ending.https !== undefined
          ? { https: ending.https }
          : {}),
      }
      // The last frame becomes a line of its own, so whatever comes next is said below it.
      add({
        kind: "deploy",
        shown: {
          start,
          deploy,
          dropped: kept.dropped,
          ms: ending.outcome === "error" ? undefined : ending.ms,
          ...(ending.outcome !== "error" && ending.problem !== undefined
            ? { problem: ending.problem }
            : {}),
        },
      })
      await app.waitUntilRenderFlush()
    },
  }
}
