/**
 * The stand-in's answers to `docker run` and `docker exec` (specs/015-
 * domains-https, contracts/runner.md, "Tests"): the proxy's container and
 * what Caddy does with its file, a health check's curl, Caddy's validate in
 * a short-lived container before the proxy starts, and the short-lived
 * container that deletes a released domain's certificate while the proxy
 * does not run. Used by `stand-in.ts`; answers from the model (`model.ts`).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  caddyLine,
  findContainer,
  newId,
  type FakeContainer,
  type Model,
} from "./model"

export type Answer = { code?: number; stdout?: string; stderr?: string }
export const out = (stdout: string): Answer => ({ stdout })
export const fail = (stderr: string, code = 1): Answer => ({ code, stderr })

/** The options of `docker run` that take a value; every other option is a flag. */
const WITH_VALUE = new Set([
  "--name",
  "--label",
  "--restart",
  "--log-driver",
  "--log-opt",
  "--network",
  "--dns-search",
  "-p",
  "-v",
  "--mount",
  "--cap-drop",
  "--cap-add",
  "--security-opt",
  "--user",
  "--memory",
  "--pids-limit",
])

/** Splits `docker run`'s arguments into its options, the image and the command. */
function readRun(words: string[]) {
  const options: [string, string][] = []
  let at = 0
  while (at < words.length && words[at]!.startsWith("-")) {
    const word = words[at]!
    if (WITH_VALUE.has(word)) {
      options.push([word, words[at + 1]!])
      at += 2
    } else {
      options.push([word, ""])
      at += 1
    }
  }
  const all = (name: string) =>
    options.filter(([key]) => key === name).map(([, value]) => value)
  return { all, image: words[at]!, command: words.slice(at + 1) }
}

/** The bind mounts of `--mount type=bind,source=…,target=…`. */
const bindMounts = (specs: string[]) =>
  specs.map((spec) => {
    const parts = Object.fromEntries(
      spec.split(",").map((part) => part.split("=") as [string, string])
    )
    return { source: parts.source ?? "", target: parts.target ?? "" }
  })

/** The text of a file inside a container, read through the bind mount it is under. */
function fileIn(
  mounts: FakeContainer["mounts"],
  path: string
): string | undefined {
  const mount = mounts.find((m) => path.startsWith(`${m.target}/`))
  if (!mount) return undefined
  try {
    return readFileSync(
      join(mount.source, path.slice(mount.target.length + 1)),
      "utf8"
    )
  } catch {
    return undefined
  }
}

/** The text of the proxy's configuration, read through its folder mount. */
const proxyConfig = (proxy: FakeContainer) =>
  fileIn(proxy.mounts, "/etc/zekno-proxy/caddy.json")

const parses = (text: string | undefined) => {
  if (text === undefined || text.trim() === "") return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** Caddy's validate of the file named after `--config`, as it would read it through `mounts`. */
function validate(
  model: Model,
  mounts: FakeContainer["mounts"],
  command: string[]
): Answer {
  if (model.script.validateMs) Bun.sleepSync(model.script.validateMs)
  if ((model.script.validateFails ?? 0) > 0) {
    model.script.validateFails! -= 1
    return fail(`${caddyLine("validate failed")}\n`)
  }
  const file = command[command.indexOf("--config") + 1] ?? ""
  return parses(fileIn(mounts, file))
    ? out("Valid configuration\n")
    : fail("{}\n")
}

/** A proxy starting on its file: Caddy saves and serves it, or exits. */
export function startProxy(model: Model, proxy: FakeContainer) {
  const text = proxyConfig(proxy)
  const log = (model.logs[proxy.name] ??= [])
  if (!parses(text)) {
    log.push(caddyLine("exiting; byeee!!"))
    proxy.running = false
    return
  }
  model.autosave = text!
  if (!model.script.startSilent)
    log.push(caddyLine("serving initial configuration"))
}

/** A health check's curl in a container on a route network: what the test said for the service it reaches. */
function curl(model: Model, network: string, url: string): Answer {
  if (model.script.checkMs) Bun.sleepSync(model.script.checkMs)
  const target = /^http:\/\/([^:/]+):(\d+)(\/.*)$/.exec(url)
  const reached = target
    ? model.containers.find((c) =>
        c.networks[network]?.aliases.includes(target[1]!)
      )
    : undefined
  if (!reached) return { code: 6, stdout: "000|6" }
  const service = reached.labels["com.docker.compose.service"] ?? ""
  const said = model.script.curl?.[service] ?? "200|0"
  return { code: Number(said.split("|")[1]), stdout: said }
}

/** `docker run`: a short-lived container (a check, a validate, a deletion), or one that stays, such as the proxy. */
export function run(model: Model, words: string[]): Answer {
  const { all, image, command } = readRun(words)
  // Docker makes a named volume the first time a container mounts it.
  for (const spec of all("-v")) {
    const name = spec.slice(0, spec.indexOf(":"))
    if (!name.startsWith("/") && !model.volumes.includes(name))
      model.volumes.push(name)
  }
  if (all("--rm").length > 0) {
    if (command[0] === "curl")
      return curl(model, all("--network")[0] ?? "", command.at(-1) ?? "")
    if (command[0] === "caddy" && command[1] === "validate")
      return validate(model, bindMounts(all("--mount")), command)
    // The deletion of a released domain's certificate: nothing the model keeps.
    if (command[0] === "sh") return {}
  }
  const failing = model.script.runFails
  delete model.script.runFails
  const labels = Object.fromEntries(
    all("--label").map((pair) => [
      pair.slice(0, pair.indexOf("=")),
      pair.slice(pair.indexOf("=") + 1),
    ])
  )
  const network = all("--network")[0] ?? "bridge"
  const container: FakeContainer = {
    id: newId(),
    name: all("--name")[0] ?? `c${Date.now()}`,
    image,
    labels,
    networkMode: network,
    running: !failing,
    restartCount: 0,
    networks: { [network]: { aliases: [] } },
    mounts: bindMounts(all("--mount")),
  }
  if (failing) {
    if (failing.leave) model.containers.push(container)
    return {
      code: failing.code,
      stdout: `${container.id}\n`,
      stderr: failing.stderr,
    }
  }
  model.containers.push(container)
  if (command[0] === "caddy") startProxy(model, container)
  return out(`${container.id}\n`)
}

/** Lines of request errors of about `bytes` in all, as Caddy logs a request it could not pass on. */
function requestErrors(bytes: number): string[] {
  const line = JSON.stringify({
    level: "error",
    ts: Date.now() / 1000,
    logger: "http.log.error",
    msg: "dial tcp: lookup zdead on 127.0.0.11:53: no such host",
    request: { remote_ip: "203.0.113.9", method: "GET", uri: "/" },
    status: 502,
  })
  return Array<string>(Math.ceil(bytes / (line.length + 1))).fill(line)
}

/** `docker exec <container> …`: Caddy's validate, the signal, the nonce, and the certificates' removal. */
export function exec(model: Model, ref: string, command: string[]): Answer {
  const c = findContainer(model, ref)
  if (!c) return fail(`Error response from daemon: No such container: ${ref}\n`)
  if (!c.running)
    return fail(
      `Error response from daemon: container ${c.id} is not running\n`
    )
  const log = (model.logs[c.name] ??= [])
  if (command[0] === "caddy" && command[1] === "validate")
    return validate(model, c.mounts, command)
  if (command.join(" ") === "kill -USR1 1") {
    if (model.script.flood) log.push(...requestErrors(model.script.flood))
    delete model.script.flood
    const reload = model.script.reloads?.shift() ?? "ok"
    const fields = { signal: "SIGUSR1", file: "/etc/zekno-proxy/caddy.json" }
    log.push(caddyLine("reloading config from last-known source", fields))
    const text = proxyConfig(c)
    if (reload === "failed" || (reload === "ok" && !parses(text)))
      log.push(
        caddyLine("failed to reload config from file", {
          ...fields,
          error: "refused",
        })
      )
    else if (reload !== "silent") {
      if (reload === "ok") model.autosave = text!
      log.push(caddyLine("successfully reloaded config from file", fields))
    }
    return {}
  }
  if (command[0] === "grep")
    return model.autosave.includes(command.at(-2)!) ? {} : { code: 1 }
  return {}
}
