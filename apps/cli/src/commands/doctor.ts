import type { Deps } from "../cli/context"
import { runDoctor, type CheckLine, type DoctorReport } from "../ops/doctor"
import { profileStore } from "../profile/profile"

/**
 * The report as `zekno doctor --json` prints it (contracts/doctor.md,
 * "--json"), its fields in the contract's order: `result` is `not_checked`
 * for a check not checked, which has no `detail`; `next` is there exactly
 * for a warning and a problem; the Profile line's `reason` when there is one.
 */
export function doctorJson(report: DoctorReport) {
  const check = (line: CheckLine) => ({
    check: line.check,
    result: line.result === "not checked" ? "not_checked" : line.result,
    ...(line.result === "not checked" ? {} : { detail: line.detail }),
    ...(line.next === undefined ? {} : { next: line.next }),
    ...(line.reason === undefined ? {} : { reason: line.reason }),
  })
  return {
    zekno: report.zekno,
    runner: report.runner,
    machine: report.machine.map(check),
    servers: report.servers.map((server) => ({
      name: server.name,
      where: server.where,
      checks: server.checks.map(check),
    })),
    serversSkipped: report.serversSkipped,
    latest: report.latest,
    problems: report.problems,
    warnings: report.warnings,
  }
}

/**
 * What the spinner says while the checks run: the one server, or how many.
 * The profile is only read for its list of servers; one that cannot be read
 * is the Profile line's business, not this.
 */
function stepLabel(home: string, server: string | undefined): string {
  if (server !== undefined) return `Checking ${server}`
  let servers: string[]
  try {
    servers = profileStore(home)
      .load()
      .servers.map((entry) => entry.name)
  } catch {
    servers = []
  }
  if (servers.length === 1) return `Checking ${servers[0]}`
  return servers.length > 1
    ? `Checking ${servers.length} servers`
    : "Checking this machine"
}

/**
 * `zekno doctor` (mock-up 5): every check of this machine and of each server,
 * or of `--server` only, then the report, or one JSON object with `--json`.
 * It never asks anything and changes nothing. Exit status 0 when no check is
 * a problem, 1 otherwise: a warning does not fail it.
 */
export async function doctor(
  deps: Deps,
  options: { server?: string; json?: boolean }
): Promise<number> {
  const report = await deps.ui.step(stepLabel(deps.home, options.server), () =>
    runDoctor(deps, { server: options.server })
  )
  if (options.json) deps.ui.json(doctorJson(report))
  else deps.ui.doctorReport(report)
  return report.problems === 0 ? 0 : 1
}
