/**
 * The wait for a deploy's health check (specs/015-domains-https, contracts/
 * runner.md, RN11; research R13). For each service of the signed `health`,
 * in order, the event `health` says the wait for it has begun; then one round
 * every 2 seconds looks at every container of the service, until all are
 * healthy or `timeout` seconds have passed since `docker compose up`
 * returned. Not in time: the outcome is `unhealthy`, with the service and
 * whether its check had a path. Nothing is stopped, rolled back or released:
 * going back is a signed rollback (deploy-v2.md part 4.3).
 */
import type { Health } from "@workspace/core"

import type { Named } from "../routes/network"
import { answersHealthy, seen } from "./check"

/** How often a round starts. */
const ROUND_MS = 2000
/** How long a container with no health check of its own must stay running with the same restart count. */
const STEADY_MS = 10_000

export type Waited =
  { ok: true } | { ok: false; service: string; http: boolean }

/**
 * Whether a container with no path to ask is healthy now: Docker's `healthy`
 * when it has a health check, or else running with the same restart count as
 * when it was first seen running at least 10 seconds ago. A container in a
 * restart loop can be running at any one moment, so one look is not enough.
 */
async function steady(
  dir: string,
  container: string,
  first: Map<string, { at: number; restarts: number }>
): Promise<boolean> {
  const now = Date.now()
  const state = await seen(dir, container)
  if (!state?.running) {
    first.delete(container)
    return false
  }
  if (state.health !== undefined) return state.health === "healthy"
  const before = first.get(container)
  if (!before || before.restarts !== state.restarts) {
    first.set(container, { at: now, restarts: state.restarts })
    return false
  }
  return now - before.at >= STEADY_MS
}

/**
 * Waits for each service of `health`, in order, until `deadline` (the time
 * `up` returned plus the signed `timeout`). `names` holds each checked
 * service's containers and their names on the route network (RN5).
 */
export async function waitHealthy(input: {
  dir: string
  app: string
  health: Health
  names: Readonly<Record<string, readonly Named[]>>
  deadline: number
  onHealth: (service: string) => void
}): Promise<Waited> {
  const { dir, app, deadline } = input
  for (const { service, http } of input.health.services) {
    input.onHealth(service)
    const containers = input.names[service] ?? []
    const first = new Map<string, { at: number; restarts: number }>()
    for (;;) {
      const round = Date.now()
      let healthy = containers.length > 0
      // Every container is looked at in each round, so each one's steady time starts at once.
      for (const { container, name } of containers) {
        const ok = http
          ? await answersHealthy(dir, app, name, http)
          : await steady(dir, container, first)
        if (!ok) healthy = false
      }
      if (healthy) break
      const now = Date.now()
      if (now >= deadline) return { ok: false, service, http: http !== null }
      await Bun.sleep(Math.max(0, Math.min(round + ROUND_MS, deadline) - now))
    }
  }
  return { ok: true }
}
