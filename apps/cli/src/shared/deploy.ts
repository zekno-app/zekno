/**
 * The deploy view of the single commands `zekno deploy` and `zekno rollback`
 * (board "zekno deploy: success and failure", contracts/commands.md): what
 * it is told as a deploy happens, the words it says, and how plain output
 * shows it. The terminal draws it in ink.tsx with deploy-view.tsx. Nothing
 * here loads Ink, so plain output never does.
 *
 * The stages of a deploy and what it is once its number is known are here
 * too: ops/deploy.ts reports them, and both this view and the app's deploy
 * screen show them (`DeployProgress`).
 */
import { dnsPlain, httpsLivePlain, httpsWaitingPlain } from "../domains/words"
import type { Ui } from "../ui/types"
import type { Notice } from "./notice"

/** data-model.md, "Stages of a deploy". A refusal ends a deploy at whatever stage it had reached. */
export type DeployStage =
  "checked" | "signed" | "sent" | "starting" | "started" | "failed"

/**
 * How a deploy the runner answered ended. `routes_failed` and `unhealthy`
 * (specs/015-domains-https, contracts/cli.md, CL3): it was accepted, its app
 * started and it is the app's current one, but its routes are not in force,
 * or it was not healthy in time.
 */
export type DeployOutcome =
  "started" | "start_failed" | "routes_failed" | "unhealthy"

/**
 * The health check a deploy signed, as it is shown (specs/015-domains-https,
 * C1, C2): the limit, and each service it waits for, with its path when it
 * has one.
 */
export type DeployHealth = {
  timeout: number
  services: { service: string; path?: string }[]
}

/**
 * A new domain during the wait for HTTPS after a start (CL3; B4 to B6):
 * waited for since a time, live with its certificate's last day, or not
 * ready when the wait was over.
 */
export type HttpsShown =
  | { domain: string; state: "waiting"; since: number }
  | { domain: string; state: "live"; until: Date }
  | { domain: string; state: "not_ready" }

/** What a deploy is, from the moment its number is known. */
export type DeployInfo = {
  app: string
  server: string
  sequence: number
  /** How many secrets the deploy lists, a secret only the server holds included. */
  secrets: number
  /** The names of the secrets it lists, in the order listed (specs/014-deploy-v2, research R20). */
  secretNames: string[]
  /** The message format it is signed in: 2 for a runner that carries out version 2, 1 for an older one (contracts/cli.md, "The format"). */
  format: 1 | 2
  /**
   * The domains it signs, in domain order, for the panel's `domains` row
   * (specs/015-domains-https, B2, B3): a rollback's are the server's (R29).
   * Left out for a deploy with none.
   */
  domains?: string[]
  /** The health check it signs, for the fifth stage (C1, C2). Left out for a deploy with none. */
  health?: DeployHealth
}

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
  /**
   * A deploy from a settings file (specs/010-app-settings, contracts/deploy.md,
   * DP3): the summary's `from` row, the file as the deploy names it and its
   * services, `2 services: web, worker`, drawn dim. Undefined for a Compose
   * file and a rollback, whose summary has no `from` row.
   */
  from?: { file: string; detail: string }
}

/**
 * How a deploy ended. `error`: refused, or failed before the runner
 * answered; the error itself is said by whoever catches it. `problem`: for
 * `routes_failed` and `unhealthy`, its sentence (B16 to B19, C3, C4;
 * domains/outcome.ts). `https`: after a start with domains new to the app,
 * each one's end of the wait (B5, B6), in domain order; left out when there
 * was no wait.
 */
export type DeployEnding =
  | {
      outcome: DeployOutcome
      sequence: number
      app: string
      server: string
      secrets: number
      ms: number
      problem?: string
      https?: HttpsShown[]
    }
  | { outcome: "error" }

/**
 * A deploy as it happens, shown by a `Ui`. The three optional methods are
 * feature 015's (specs/015-domains-https, contracts/cli.md, CL3), and are
 * never called for a deploy without a domain or a health check (CL7), so a
 * view without them is the view of every deploy before it.
 */
export type DeployView = {
  /** A stage was reached. From `checked` on, the number and the count of secrets are known. */
  stage(stage: DeployStage, deploy: DeployInfo): void
  /** One of Docker's lines, already cleaned. Never waited for: the deploy is not held back by how it is shown. */
  progress(line: string): void
  /** The deploy ended. Resolves once the view has said so. Called once. */
  end(ending: DeployEnding): Promise<void>
  /** B1, before anything is signed: a new domain points to the server, at `address`. */
  pointed?(domain: string, address: string): void
  /** The runner began to wait for `service` to be healthy (C2). */
  health?(service: string): void
  /** The wait for HTTPS after the start: a domain is waited for (B4), or its wait is over (B5, B6). */
  https?(shown: HttpsShown): void
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
  /** The message format, known from the "checked" stage on. On version 2 a deploy that ended in error used no number (research R19). */
  format?: 1 | 2
  stage?: DeployStage
  /** Docker's output, cleaned, the last `DEPLOY_LINES` in the app (app/state/types.ts). */
  lines: string[]
  running: boolean
  /** How it ended. `error` is a refusal or a failure before the runner answered. */
  outcome?: DeployOutcome | "error"
  /** The domains it signs, from the "checked" stage on (B2, B3). Left out for a deploy with none. */
  domains?: readonly string[]
  /** The health check it signs, from the "checked" stage on (C1). Left out for a deploy with none. */
  health?: DeployHealth
  /** The service the runner waits for, its path when it has one, and since when (C2): from each `health` event. */
  waitingFor?: { service: string; path?: string; since: number }
  /** The wait for HTTPS after the start, each new domain as far as it got (B4 to B6). Left out when there is none. */
  https?: HttpsShown[]
  /** B1 in the app: each domain new to the app that points to the server, and the address, before anything was signed. */
  pointed?: { domain: string; address: string }[]
  /** When it began, in milliseconds, for the time shown beside it. */
  since: number
  /** When it ended, in milliseconds. */
  endedAt?: number
  /** Where the service definition comes from: a file, or an earlier deploy. */
  from?: string
  /** Drawn dim after `from`, two spaces apart: a settings file's services (DP3). The app leaves it out. */
  fromDetail?: string
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
export function heldLines(
  draw: (line: string) => unknown,
  dropped: (count: number) => unknown,
  limit = HELD_LINES
) {
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
        await Promise.race([
          pumping,
          new Promise((resolve) => (timer = setTimeout(resolve, ms))),
        ])
        clearTimeout(timer)
      }
      lost += held.length
      held.length = 0
      await report()
    },
  }
}

const plural = (count: number, one: string) =>
  `${count} ${one}${count === 1 ? "" : "s"}`

/** Said when Docker's lines could not all be written in time. */
export const leftOut = (count: number) =>
  `Left out ${plural(count, "line")} of Docker's output that came faster than they could be shown.`

/** Said when Docker wrote more lines than are kept: the first ones are not shown. */
export const earlierLeftOut = (count: number) =>
  `Left out Docker's first ${plural(count, "line")}. The last ${HELD_LINES} are kept.`

/** How many secrets a deploy carries, as every sentence about it says it (contracts/commands.md): `2 secrets`, `1 secret`, `no secrets`. */
export const secretsWords = (count: number): string =>
  count === 0 ? "no secrets" : plural(count, "secret")

/** The plain line of a deploy that started. Stable: scripts read it (contracts/commands.md). */
export const startedSentence = (ending: {
  sequence: number
  app: string
  server: string
  secrets: number
}): string =>
  `Deploy ${ending.sequence} of ${ending.app} is running on ${ending.server} with ${secretsWords(ending.secrets)}.`

/** The plain line of a deploy the runner accepted but whose app did not start. */
export const failedSentence = (ending: {
  sequence: number
  app: string
  server: string
}): string =>
  `Deploy ${ending.sequence} of ${ending.app} was accepted by ${ending.server}, but the app did not start. Check Docker on the server.`

/** What to run after a deploy that started, under the result line (board "zekno deploy: success and failure"). */
export const startedNext = (flags: string): string =>
  `zekno logs${flags} to watch it, zekno rollback${flags} to undo`

/**
 * What to do after a deploy whose app did not start. A rollback deployed an
 * earlier definition, so there is no file of the person's to fix.
 */
export const failedNext = (
  start: Pick<DeployStart, "file" | "flags">
): string =>
  start.file === undefined
    ? `Deploy a fixed Compose file with zekno deploy${start.flags}, or go back further with zekno rollback${start.flags} --to <number>.`
    : `Fix ${start.file} and run zekno deploy again, or go back with zekno rollback${start.flags}.`

/**
 * The deploy view of plain output: nothing while the deploy runs. Docker's
 * lines are kept, the last `HELD_LINES`, and written only when the app did
 * not start: on standard error, marked as the server's (`Ui.remote`), after
 * the failure sentence. With `say` false the result is not said at all, for
 * `--json`, where the command prints the one JSON object itself.
 *
 * A deploy with a domain or a health check (specs/015-domains-https,
 * contracts/cli.md, CL3, "With no terminal"): B1 on standard output as
 * `dns<TAB>shop.example.com<TAB>203.0.113.7`, before anything is signed;
 * after the result line, B5 as `https<TAB>…<TAB>live<TAB>2027-02-17` and B6
 * as `https<TAB>…<TAB>waiting`; `routes_failed` and `unhealthy` say their
 * sentence on standard error, in place of the result line.
 */
export function plainDeployView(
  ui: Pick<Ui, "success" | "error" | "warn" | "remote" | "info">,
  say: boolean
): DeployView {
  const kept = keptLines()
  let ended = false
  return {
    stage: () => {},
    progress: (line) => kept.push(line),
    pointed: (domain, address) => {
      if (say) ui.info(dnsPlain(domain, address))
    },
    async end(ending) {
      if (ended) return
      ended = true
      if (ending.outcome === "started") {
        if (!say) return
        ui.success(startedSentence(ending))
        for (const shown of ending.https ?? [])
          if (shown.state === "live")
            ui.info(httpsLivePlain(shown.domain, shown.until))
          else if (shown.state === "not_ready")
            ui.info(httpsWaitingPlain(shown.domain))
        return
      }
      if (
        ending.outcome === "routes_failed" ||
        ending.outcome === "unhealthy"
      ) {
        if (say && ending.problem !== undefined) ui.error(ending.problem)
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
