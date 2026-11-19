/**
 * Loading a configuration into the running proxy (specs/015-domains-https,
 * contracts/runner.md, RN8; research R4, R8). With Caddy's admin interface
 * off, a signal makes it read its file again; a file it cannot load leaves
 * the earlier one serving. Two traps, both seen: `docker kill -s USR1`
 * switches the proxy's restart policy off, so the signal is sent with
 * `docker exec … kill`; and an empty file "reloads successfully" with every
 * site down.
 *
 * What decides is the file's nonce in what Caddy saved, which it writes only
 * after a load that worked, before it logs that it did, and never after one
 * that failed (research Q3, and run again on 2026-11-19 for a failed and an
 * empty file). The log is read only to stop waiting early when it says the
 * load failed: visitors can fill it, so a line that says the load worked may
 * be past what the runner reads (security review S1).
 */
import { inspectContainer } from "../docker/objects"
import { runDocker } from "../docker/run"
import { placeConfig } from "./file"
import { countLines, noteTime, POLL_MS, PROXY, reloadFailed } from "./log"

/** Where Caddy saves what it loaded, written only after a load that worked. */
const AUTOSAVE = "/config/caddy/autosave.json"
/** How long the proxy has to save the file's nonce once it was signalled (RN8, step 5). */
const RELOAD_MS = 15_000

/**
 * What a load came to: `loaded`; `kept`, not loaded with the file in place
 * as it was and nothing signalled, so the proxy serves what it served; or
 * `replaced`, not loaded once the file in place was replaced, so the proxy
 * may not serve what the state says (RN9).
 */
export type Loaded = "loaded" | "kept" | "replaced"

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

/** Whether what Caddy saved holds `nonce`: it loaded the file that has it. */
async function nonceSaved(dir: string, nonce: string): Promise<boolean> {
  const saved = await runDocker(dir, [
    "exec",
    PROXY,
    "grep",
    "-q",
    "-F",
    "--",
    nonce,
    AUTOSAVE,
  ])
  return saved.code === 0
}

/**
 * Waits for the nonce in what Caddy saved, for at most 15 seconds, looking
 * again every 200 milliseconds; stops early when the log has a line past the
 * `before` it had that says the load failed. With no count of the log to go
 * by, only the nonce is looked for.
 */
async function confirmed(
  dir: string,
  nonce: string,
  since: number,
  before: number | undefined
): Promise<boolean> {
  const until = Date.now() + RELOAD_MS
  for (;;) {
    if (await nonceSaved(dir, nonce)) return true
    if (before !== undefined) {
      const failed = await countLines(dir, since, reloadFailed)
      if (failed !== undefined && failed > before) return false
    }
    if (Date.now() >= until) return false
    await Bun.sleep(POLL_MS)
  }
}

/**
 * Loads `config` into the running proxy by RN8, step by step; any step that
 * fails is "not loaded". A proxy that was just started on this file (RN6,
 * `started`) was given it validated, and Caddy read it as it started: it is
 * joined to its networks and the nonce confirmed.
 */
export async function loadConfig(
  dir: string,
  config: { text: string; nonce: string },
  networks: readonly string[],
  options: { started?: boolean } = {}
): Promise<Loaded> {
  // 1. Joining before loading.
  if (!(await joinNetworks(dir, networks)))
    return options.started ? "replaced" : "kept"
  if (options.started)
    return (await nonceSaved(dir, config.nonce)) ? "loaded" : "replaced"
  // 2 and 3. The file, written beside the one in place and put in its place
  // only once Caddy's own check passed: it catches a file the runner wrote
  // wrongly, never a value (research R3).
  if (!(await placeConfig(dir, config.text, "proxy"))) return "kept"
  // 4. The time and the failures the log has already, then the signal, by `exec`: never `docker kill`.
  const since = noteTime()
  const before = await countLines(dir, since, reloadFailed)
  const signal = await runDocker(dir, ["exec", PROXY, "kill", "-USR1", "1"])
  if (signal.code !== 0) return "replaced"
  // 5 and 6. The nonce in what Caddy saved.
  return (await confirmed(dir, config.nonce, since, before))
    ? "loaded"
    : "replaced"
}
