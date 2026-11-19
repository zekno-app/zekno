/**
 * The wait for a deploy's health check (specs/015-domains-https, contracts/
 * runner.md, RN11; research R13). For each service of the signed `health`,
 * in order, the event `health` says the wait for it has begun; then one round
 * every 2 seconds looks at every container of the service, until all are
 * healthy or `timeout` seconds have passed since `docker compose up`
 * returned. Not in time: the outcome is `unhealthy`, with the service and
 * whether its check had a path. Nothing is stopped, rolled back or released:
 * going back is a signed rollback (deploy-v2.md part 4.3).
 *
 * The limit is looked at before each container, and each check is given only
 * the time left, so the wait ends within one check of its limit however many
 * containers a service has (security review S3). The image a check with a
 * path runs is made sure of once, before the first event, and the time that
 * takes is not counted against the limit.
 */
import type { Health } from "@workspace/core"

import type { Named } from "../routes/network"
import { answersHealthy, seen } from "./check"
import { pinnedImageHere } from "./image"

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
  const { dir, app } = input
  let deadline = input.deadline
  // The image, once, for the checks with a path: on a time of its own.
  let imageHere = true
  if (input.health.services.some(({ http }) => http !== null)) {
    const started = Date.now()
    imageHere = await pinnedImageHere(dir)
    deadline += Date.now() - started
  }
  for (const { service, http } of input.health.services) {
    input.onHealth(service)
    const unhealthy: Waited = { ok: false, service, http: http !== null }
    // A check that cannot run, as its image is not here, is not waited for.
    if (http && !imageHere) return unhealthy
    const containers = input.names[service] ?? []
    const first = new Map<string, { at: number; restarts: number }>()
    for (;;) {
      const round = Date.now()
      let healthy = containers.length > 0
      // Every container is looked at in each round, so each one's steady time starts at once.
      for (const { container, name } of containers) {
        const left = deadline - Date.now()
        if (left <= 0) return unhealthy
        const ok = http
          ? await answersHealthy(dir, app, name, http, left)
          : await steady(dir, container, first)
        if (!ok) healthy = false
      }
      if (healthy) break
      const now = Date.now()
      if (now >= deadline) return unhealthy
      await Bun.sleep(Math.max(0, Math.min(round + ROUND_MS, deadline) - now))
    }
  }
  return { ok: true }
}
