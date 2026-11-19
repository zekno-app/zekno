/**
 * One look at one container for a deploy's health check (specs/015-domains-
 * https, contracts/runner.md, RN11; research R12, R13).
 *
 * With a path, the request is made by curl in a short-lived container of the
 * pinned image on the app's route network, to the name the runner gave the
 * container: never an address, never a name a deploy chose. It follows no
 * redirect, reads at most 1 KiB, gives up after 5 seconds, speaks plain HTTP
 * only, and runs read-only, as a user without rights, with no capability and
 * 32 MB. Healthy means curl's exit is 0 or 63 (it stopped at 1 KiB once the
 * headers were complete) and the status is 200 to 399: a status line followed
 * by silence gives 200 with exit 28, which is not healthy.
 *
 * Without a path, Docker's own word: running, and `healthy` when the
 * container has a health check of its own.
 */
import { isHealthPath } from "@workspace/core"

import { inspectContainer } from "../docker/objects"
import { runDocker } from "../docker/run"
import { PROXY_IMAGE } from "../proxy/image"
import { routeNetwork } from "../routes/network"

/** A container's name on a route network, as the runner makes them. */
const NAME = /^z[0-9a-f]{32}$/
/** How long one check's container may take: the first one pulls the pinned image when the proxy has not. */
const CHECK_MS = 10 * 60_000

/** Whether `path` on `port` of the container named `name` answers as healthy. */
export async function answersHealthy(
  dir: string,
  app: string,
  name: string,
  http: { port: number; path: string }
): Promise<boolean> {
  const { port, path } = http
  if (
    !NAME.test(name) ||
    !isHealthPath(path) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    return false
  const result = await runDocker(
    dir,
    [
      "run",
      "--rm",
      "--network",
      routeNetwork(app),
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--user",
      "65534:65534",
      "--memory",
      "32m",
      "--pids-limit",
      "16",
      PROXY_IMAGE,
      "curl",
      "-sS",
      "-o",
      "/dev/null",
      "--max-time",
      "5",
      "--max-filesize",
      "1024",
      "--proto",
      "=http",
      "-w",
      "%{http_code}|%{exitcode}",
      // One argument: the path has matched the path rule.
      `http://${name}:${port}${path}`,
    ],
    { timeoutMs: CHECK_MS }
  )
  const said = /^(\d{3})\|(\d{1,3})$/.exec(result.stdout.trim())
  if (!said) return false
  const status = Number(said[1])
  const exit = Number(said[2])
  return (exit === 0 || exit === 63) && status >= 200 && status <= 399
}

/** What Docker says of a container: running, its own health check's status if it has one, its restarts. */
export type Seen = {
  running: boolean
  health: string | undefined
  restarts: number
}

/** One container as Docker sees it now, or undefined when Docker did not answer. */
export async function seen(dir: string, id: string): Promise<Seen | undefined> {
  const found = await inspectContainer(dir, id)
  if (typeof found !== "object") return undefined
  return {
    running: found.running,
    health: found.health,
    restarts: found.restarts,
  }
}
