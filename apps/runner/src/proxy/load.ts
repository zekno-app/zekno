/**
 * Loading a configuration into the running proxy (specs/015-domains-https,
 * contracts/runner.md, RN8; research R4, R8). With Caddy's admin interface
 * off, a signal makes it read its file again, and the answer is in its log;
 * a file it cannot load leaves the earlier one serving. Two traps, both seen:
 * `docker kill -s USR1` switches the proxy's restart policy off, so the
 * signal is sent with `docker exec … kill`; and an empty file "reloads
 * successfully" with every site down, so a load counts only once the file's
 * nonce is in what Caddy saved, which it writes only after a load that
 * worked.
 */
import { inspectContainer } from "../docker/objects"
import { runDocker } from "../docker/run"
import { writeProxyConfig } from "../home/home"
import { countLines, noteTime, PROXY, reloaded, waitForLine } from "./log"

/** Where the proxy reads its file: the runner's folder `proxy/etc`, mounted read-only. */
const CONFIG = "/etc/zekno-proxy/caddy.json"
/** Where Caddy saves what it loaded, written only after a load that worked. */
const AUTOSAVE = "/config/caddy/autosave.json"
/** How long the proxy has to say whether it loaded the file (RN8, step 5). */
const RELOAD_MS = 15_000

/**
 * Connects the proxy to each route network it needs and is not on (RN8,
 * step 1). Joining comes before loading: a route through a network the proxy
 * is not on yet would fail.
 */
export async function joinNetworks(
  dir: string,
  networks: readonly string[]
): Promise<boolean> {
  const proxy = await inspectContainer(dir, PROXY)
  if (typeof proxy !== "object") return false
  for (const network of networks) {
    if (network in proxy.networks) continue
    const joined = await runDocker(dir, ["network", "connect", network, PROXY])
    if (joined.code !== 0) return false
  }
  return true
}

/**
 * Loads `config` into the running proxy by RN8, step by step; any step that
 * fails is "not loaded". A proxy that was just started on this file (RN6,
 * `started`) is not written to or signalled: Caddy read the file as it
 * started, so it is joined to its networks, the file validated and the nonce
 * confirmed.
 */
export async function loadConfig(
  dir: string,
  config: { text: string; nonce: string },
  networks: readonly string[],
  options: { started?: boolean } = {}
): Promise<boolean> {
  // 1. Joining before loading.
  if (!(await joinNetworks(dir, networks))) return false
  if (!options.started) {
    // 2. The file, with the runner's atomic write.
    try {
      writeProxyConfig(dir, config.text)
    } catch {
      return false
    }
  }
  // 3. Caddy's own check of the file: it catches a file the runner wrote wrongly, never a value (research R3).
  const valid = await runDocker(dir, [
    "exec",
    PROXY,
    "caddy",
    "validate",
    "--config",
    CONFIG,
  ])
  if (valid.code !== 0) return false
  if (!options.started) {
    // 4. The time, then the signal, by `exec`: never `docker kill`.
    const since = noteTime()
    const before = await countLines(dir, since, reloaded)
    if (before === undefined) return false
    const signal = await runDocker(dir, ["exec", PROXY, "kill", "-USR1", "1"])
    if (signal.code !== 0) return false
    // 5. Caddy's answer in its log.
    if ((await waitForLine(dir, since, reloaded, before, RELOAD_MS)) !== "ok")
      return false
  }
  // 6. The nonce in what Caddy saved.
  const saved = await runDocker(dir, [
    "exec",
    PROXY,
    "grep",
    "-q",
    "-F",
    "--",
    config.nonce,
    AUTOSAVE,
  ])
  return saved.code === 0
}
