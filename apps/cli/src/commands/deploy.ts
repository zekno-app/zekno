import { remoteThroughUi, type Deps } from "../context"
import { prepareDeploy, prepareRollback, sendDeploy, type DeployCallbacks, type DeployPlan, type Where } from "../ops/deploy"
import type { Ui } from "../ui/types"

type Options = Where & { json?: boolean }

/** The most lines of Docker's output held while an earlier one is still being drawn (research R5). */
export const HELD_LINES = 500

/** How long, once a deploy has its answer, Docker's last lines may take to be drawn. */
const LAST_LINES_MS = 1000

/** Runs `work`, and lets a line that could not be drawn be lost: the deploy goes on. */
async function quietly(work: () => unknown): Promise<void> {
  try {
    await work()
  } catch {
    // Lost, like a line nobody reads.
  }
}

/**
 * Draws lines one at a time, in order. While `draw` is still busy with one,
 * at most `limit` newer lines are held; past that the oldest held line is
 * dropped and counted. The runner never waits for a progress line, so a
 * terminal or pipe slower than Docker's output must not fill memory instead.
 * `dropped` hears how many were left out before the next line is drawn.
 */
export function heldLines(draw: (line: string) => unknown, dropped: (count: number) => unknown, limit = HELD_LINES) {
  const held: string[] = []
  let lost = 0
  let pumping: Promise<void> | undefined

  const report = async () => {
    if (lost === 0) return
    const count = lost
    lost = 0
    await quietly(() => dropped(count))
  }

  async function pump(): Promise<void> {
    for (let line = held.shift(); line !== undefined; line = held.shift()) {
      // Whatever was dropped came before this line.
      await report()
      const next = line
      await quietly(() => draw(next))
    }
    pumping = undefined
  }

  return {
    push(line: string): void {
      if (held.length >= limit) {
        held.shift()
        lost++
      }
      held.push(line)
      pumping ??= pump()
    },
    /** Waits until every held line is drawn, for `ms` at most. Lines still held then are left out and counted. */
    async finish(ms: number): Promise<void> {
      if (pumping) {
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([pumping, new Promise((resolve) => (timer = setTimeout(resolve, ms)))])
        clearTimeout(timer)
      }
      lost += held.length
      held.length = 0
      await report()
    },
  }
}

export const leftOut = (count: number) =>
  `Left out ${count} line${count === 1 ? "" : "s"} of Docker's output that came faster than they could be shown.`

/** Docker's own lines during a deploy, already cleaned, drawn as the server's: they came from it. */
export const dockerLines = (ui: Ui) =>
  heldLines(
    (line) => ui.remote(line),
    (count) => ui.warn(leftOut(count))
  )

async function send(deps: Deps, plan: DeployPlan, options: Options): Promise<number> {
  const lines = dockerLines(deps.ui)
  const callbacks: DeployCallbacks = { warning: (text) => deps.ui.warn(text), progress: (line) => lines.push(line) }
  let result
  try {
    result = await deps.ui.step(`Deploying ${plan.app} to ${plan.server.name}`, () => sendDeploy(remoteThroughUi(deps), plan, callbacks), {
      quiet: plan.server.target.kind === "ssh",
    })
  } finally {
    // Docker's last lines come before the outcome, unless they cannot be drawn in time.
    await lines.finish(LAST_LINES_MS)
  }
  if (options.json) deps.ui.json({ ...result.report, server: result.server })
  if (result.outcome === "start_failed") {
    if (!options.json) {
      deps.ui.error(
        `Deploy ${result.sequence} of ${result.app} was accepted by ${result.server}, but the app did not start. Check Docker on the server.`
      )
    }
    return 1
  }
  if (!options.json) {
    deps.ui.success(`Deploy ${result.sequence} of ${result.app} is running on ${result.server} with ${result.secrets} secret(s).`)
  }
  return 0
}

export async function deploy(deps: Deps, options: Options & { file?: string }): Promise<number> {
  return send(deps, await prepareDeploy(deps, options), options)
}

/** Deploys an earlier service definition again, under the next number, with the current secrets. */
export async function rollback(deps: Deps, options: Options & { to?: string }): Promise<number> {
  const plan = await prepareRollback(deps, options, { warning: (text) => deps.ui.warn(text) })
  if (!options.json) deps.ui.info(`Rolling back ${plan.app} to what deploy ${plan.from} ran.`)
  return send(deps, plan, options)
}
