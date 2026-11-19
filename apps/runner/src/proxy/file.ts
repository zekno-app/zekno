/**
 * The proxy's configuration file put in place (specs/015-domains-https,
 * contracts/runner.md, RN6 to RN8; security review S7). The text is written
 * first to a second file beside the one in place, `caddy.next.json`, with the
 * runner's atomic write and the same mode; Caddy validates that file; and
 * only when it says the file is valid is it renamed over `caddy.json`. A
 * file Caddy refuses is removed and the file in place is never touched, so
 * the proxy keeps what it serves, and no proxy is started on a file that was
 * not validated.
 *
 * In a running proxy, Caddy validates in it (`docker exec`). Before a start
 * there is no proxy to run it in, so it runs in a short-lived container of
 * the pinned image with no network and no capability, which mounts the
 * folder read-only: research Q2 ran validate in such a container with the
 * same results as in the proxy.
 */
import { runDocker } from "../docker/run"
import {
  dropProxyNext,
  placeProxyNext,
  proxyFolder,
  writeProxyNext,
} from "../home/home"
import { PROXY_IMAGE } from "./image"
import { PROXY } from "./log"

/** The next file, as the proxy's container and the validate's see it. */
const NEXT = "/etc/zekno-proxy/caddy.next.json"
/**
 * How long the validate before a start may take. Before the first start it
 * is the first container of the pinned image on the server, so it pulls it,
 * as the proxy's own `docker run` did before.
 */
const ALONE_MS = 10 * 60_000

/**
 * The `--mount` value that puts the runner's folder `proxy/etc` read-only at
 * `/etc/zekno-proxy`, or undefined when its path cannot be put in one:
 * `--mount` reads its value as CSV, so a comma, a quote or a line break
 * would change its meaning.
 */
export function etcMount(dir: string): string | undefined {
  const folder = proxyFolder(dir)
  if (/[,"\n]/.test(folder)) return undefined
  return `type=bind,source=${folder},target=/etc/zekno-proxy,readonly`
}

/** Caddy's validate of the next file: in the running proxy, or alone before a start. */
async function validated(dir: string, where: "proxy" | "alone") {
  if (where === "proxy") {
    const valid = await runDocker(dir, [
      "exec",
      PROXY,
      "caddy",
      "validate",
      "--config",
      NEXT,
    ])
    return valid.code === 0
  }
  const mount = etcMount(dir)
  if (mount === undefined) return false
  const valid = await runDocker(
    dir,
    [
      "run",
      "--rm",
      "--network",
      "none",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--mount",
      mount,
      PROXY_IMAGE,
      "caddy",
      "validate",
      "--config",
      NEXT,
    ],
    { timeoutMs: ALONE_MS }
  )
  return valid.code === 0
}

/**
 * Puts `text` in place as the proxy's file once Caddy has validated it,
 * `where` the proxy runs (`proxy`) or before it starts (`alone`). False when
 * it was not put in place; the file in place is then as it was.
 */
export async function placeConfig(
  dir: string,
  text: string,
  where: "proxy" | "alone"
): Promise<boolean> {
  try {
    writeProxyNext(dir, text)
  } catch {
    dropProxyNext(dir)
    return false
  }
  if (!(await validated(dir, where))) {
    dropProxyNext(dir)
    return false
  }
  try {
    placeProxyNext(dir)
    return true
  } catch {
    dropProxyNext(dir)
    return false
  }
}
