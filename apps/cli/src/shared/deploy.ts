/**
 * The deploy view of the single commands `zekno deploy` and `zekno rollback`
 * (board "zekno deploy: success and failure", contracts/commands.md): what
 * it is told as a deploy happens, the words it says, and how plain output
 * shows it. The terminal draws it in ink.tsx with deploy-view.tsx. Nothing
 * here loads Ink, so plain output never does.
 */
import type { DeployInfo, DeployStage } from "../ops/deploy"
import type { Ui } from "../ui/types"
import type { Notice } from "./notice"

/** What a deploy view is told before anything is sent. */
export type DeployStart = {
  app: string
  server: string
  /**
   * The Compose file, as the person knows it (`compose.yaml`), said when the
   * app did not start. Undefined for a rollback, which deploys an earlier
   * deploy's definition.
   */
  file?: string
  /**
   * The `--app` and `--server` flags the person typed, as they would type
   * them again, such as ` --app demo --server prod`; empty when both came
   * from zekno.json. The commands a result suggests carry them, so they act
   * on the same app and server.
   */
  flags: string
}

/** How a deploy ended. `error`: refused, or failed before the runner answered; the error itself is said by whoever catches it. */
export type DeployEnding =
  | { outcome: "started" | "start_failed"; sequence: number; app: string; server: string; secrets: number; ms: number }
  | { outcome: "error" }

/** A deploy as it happens, shown by a `Ui`. */
export type DeployView = {
  /** A stage was reached. From `checked` on, the number and the count of secrets are known. */
  stage(stage: DeployStage, deploy: DeployInfo): void
  /** One of Docker's lines, already cleaned. Never waited for: the deploy is not held back by how it is shown. */
  progress(line: string): void
  /** The deploy ended. Resolves once the view has said so. Called once. */
  end(ending: DeployEnding): Promise<void>
}

/**
 * A deploy as it is drawn: by the app, which keeps the one it started until
 * it closes (app/state/), and by `zekno deploy` and `zekno rollback` at a
 * terminal (ui/ink/deploy-view.tsx), with the same panel and stage row
 * (ui/parts/deploy-summary.tsx).
 */
export type DeployProgress = {
  server: string
  app: string
  /** Known from the "checked" stage on. */
  sequence?: number
  secrets?: number
  stage?: DeployStage
  /** Docker's output, cleaned, the last `DEPLOY_LINES` in the app (app/state/types.ts). */
  lines: string[]
  running: boolean
  /** How it ended. `error` is a refusal or a failure before the runner answered. */
  outcome?: "started" | "start_failed" | "error"
  /** When it began, in milliseconds, for the time shown beside it. */
  since: number
  /** When it ended, in milliseconds. */
  endedAt?: number
  /** Where the service definition comes from: a file, or an earlier deploy. */
  from?: string
  /** The deploy it takes over from, when there was one. */
  replaces?: number
  /** The names of the secrets it carries. */
  secretNames?: string[]
  /** The line that says how it ended. */
  result?: Notice
}

/** The most of Docker's lines kept during a deploy (research R5): the last ones, where it says what went wrong. */
export const HELD_LINES = 500

/** How long, once a deploy has its answer, Docker's lines may take to be written after a failed start. */
export const LAST_LINES_MS = 1000

/** The last `limit` lines handed over, and how many came before them. Nothing else is held. */
export function keptLines(limit = HELD_LINES) {
  const lines: string[] = []
  let dropped = 0
  return {
    push(line: string): void {
      if (lines.length >= limit) {
        lines.shift()
        dropped++
      }
      lines.push(line)
    },
    get lines(): readonly string[] {
      return lines
    },
    /** How many lines came before the ones kept. */
    get dropped(): number {
      return dropped
    },
  }
}

/** Runs `work`, and lets a line that could not be written be lost: the command goes on. */
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
 * dropped and counted. A terminal or pipe slower than the lines must not fill
 * memory instead. `dropped` hears how many were left out before the next line
 * is drawn.
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

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`

/** Said when Docker's lines could not all be written in time. */
export const leftOut = (count: number) =>
  `Left out ${plural(count, "line")} of Docker's output that came faster than they could be shown.`

/** Said when Docker wrote more lines than are kept: the first ones are not shown. */
export const earlierLeftOut = (count: number) => `Left out Docker's first ${plural(count, "line")}. The last ${HELD_LINES} are kept.`

/** How many secrets a deploy carries, as every sentence about it says it (contracts/commands.md): `2 secrets`, `1 secret`, `no secrets`. */
export const secretsWords = (count: number): string => (count === 0 ? "no secrets" : plural(count, "secret"))

/** The plain line of a deploy that started. Stable: scripts read it (contracts/commands.md). */
export const startedSentence = (ending: { sequence: number; app: string; server: string; secrets: number }): string =>
  `Deploy ${ending.sequence} of ${ending.app} is running on ${ending.server} with ${secretsWords(ending.secrets)}.`

/** The plain line of a deploy the runner accepted but whose app did not start. */
export const failedSentence = (ending: { sequence: number; app: string; server: string }): string =>
  `Deploy ${ending.sequence} of ${ending.app} was accepted by ${ending.server}, but the app did not start. Check Docker on the server.`

/** What to run after a deploy that started, under the result line (board "zekno deploy: success and failure"). */
export const startedNext = (flags: string): string => `zekno logs${flags} to watch it, zekno rollback${flags} to undo`

/**
 * What to do after a deploy whose app did not start. A rollback deployed an
 * earlier definition, so there is no file of the person's to fix.
 */
export const failedNext = (start: Pick<DeployStart, "file" | "flags">): string =>
  start.file === undefined
    ? `Deploy a fixed Compose file with zekno deploy${start.flags}, or go back further with zekno rollback${start.flags} --to <number>.`
    : `Fix ${start.file} and run zekno deploy again, or go back with zekno rollback${start.flags}.`

/**
 * The deploy view of plain output: nothing while the deploy runs. Docker's
 * lines are kept, the last `HELD_LINES`, and written only when the app did
 * not start: on standard error, marked as the server's (`Ui.remote`), after
 * the failure sentence. With `say` false the result is not said at all, for
 * `--json`, where the command prints the one JSON object itself.
 */
export function plainDeployView(ui: Pick<Ui, "success" | "error" | "warn" | "remote">, say: boolean): DeployView {
  const kept = keptLines()
  let ended = false
  return {
    stage: () => {},
    progress: (line) => kept.push(line),
    async end(ending) {
      if (ended) return
      ended = true
      if (ending.outcome === "started") {
        if (say) ui.success(startedSentence(ending))
        return
      }
      if (ending.outcome !== "start_failed") return
      if (say) ui.error(failedSentence(ending))
      if (kept.dropped > 0) ui.warn(earlierLeftOut(kept.dropped))
      // Written as fast as standard error takes them, and for a second at most: a reader that stopped does not hold the command.
      const lines = heldLines(
        (line) => ui.remote(line),
        (count) => ui.warn(leftOut(count))
      )
      for (const line of kept.lines) lines.push(line)
      await lines.finish(LAST_LINES_MS)
    },
  }
}
