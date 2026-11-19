/**
 * The stand-in for the Docker calls of routes, the proxy and the health
 * check (specs/015-domains-https, contracts/runner.md, "Tests"). The
 * stand-in's shell script (`fake.ts`) records each call, then runs this with
 * its folder and Docker's arguments for `network`, `run`, `exec`, `logs`,
 * `inspect`, `rm`, `start` and `compose … ps -q`. It answers from the model
 * (`model.ts`) the way Docker 29 does, as far as the runner reads it, and
 * writes each call's argument list to `argv.jsonl` so a test sees every
 * argument exactly as it was passed.
 */
import { appendFileSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  caddyLine,
  changeModel,
  findContainer,
  newId,
  type FakeContainer,
  type Model,
} from "./model"

const [dir, ...args] = process.argv.slice(2) as [string, ...string[]]
appendFileSync(join(dir, "argv.jsonl"), `${JSON.stringify(args)}\n`)

type Answer = { code?: number; stdout?: string; stderr?: string }
const out = (stdout: string): Answer => ({ stdout })
const fail = (stderr: string, code = 1): Answer => ({ code, stderr })

/** The options of `docker run` that take a value; every other option is a flag. */
const WITH_VALUE = new Set([
  "--name",
  "--label",
  "--restart",
  "--network",
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

/** The text of the proxy's configuration, read through its folder mount. */
function proxyConfig(proxy: FakeContainer): string | undefined {
  const mount = proxy.mounts.find((m) => m.target === "/etc/zekno-proxy")
  if (!mount) return undefined
  try {
    return readFileSync(join(mount.source, "caddy.json"), "utf8")
  } catch {
    return undefined
  }
}

const parses = (text: string | undefined) => {
  if (text === undefined || text.trim() === "") return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** A proxy starting on its file: Caddy saves and serves it, or exits. */
function startProxy(model: Model, proxy: FakeContainer) {
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

function run(model: Model, words: string[]): Answer {
  const { all, image, command } = readRun(words)
  if (all("--rm").length > 0 && command[0] === "curl")
    return curl(model, all("--network")[0] ?? "", command.at(-1) ?? "")
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
    mounts: all("--mount").map((spec) => {
      const parts = Object.fromEntries(
        spec.split(",").map((part) => part.split("=") as [string, string])
      )
      return { source: parts.source ?? "", target: parts.target ?? "" }
    }),
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

function inspect(model: Model, refs: string[]): Answer {
  const found: unknown[] = []
  let missing = ""
  for (const ref of refs) {
    const c = findContainer(model, ref)
    if (!c) {
      missing += `Error: No such container: ${ref}\n`
      continue
    }
    if (model.script.restarting?.includes(c.id)) c.restartCount += 1
    found.push({
      Id: c.id,
      Name: `/${c.name}`,
      RestartCount: c.restartCount,
      State: {
        Status: c.running ? "running" : "exited",
        Running: c.running,
        ...(c.health ? { Health: { Status: c.health } } : {}),
      },
      Config: { Image: c.image, Labels: c.labels, Env: ["SECRET=hidden"] },
      HostConfig: { NetworkMode: c.networkMode },
      NetworkSettings: {
        Networks: Object.fromEntries(
          Object.entries(c.networks).map(([name, { aliases }]) => [
            name,
            {
              Aliases: aliases,
              DNSNames: [c.name, ...aliases, c.id.slice(0, 12)],
            },
          ])
        ),
      },
    })
  }
  return {
    code: missing ? 1 : 0,
    stdout: `${JSON.stringify(found)}\n`,
    stderr: missing,
  }
}

function network(model: Model, words: string[]): Answer {
  const [verb, ...rest] = words
  const named = (name: string) => model.networks.find((n) => n.name === name)
  if (verb === "inspect") {
    const n = named(rest.at(-1)!)
    if (!n)
      return fail(
        `Error response from daemon: network ${rest.at(-1)} not found\n`
      )
    const containers = Object.fromEntries(
      model.containers
        .filter((c) => n.name in c.networks)
        .map((c) => [c.id, { Name: c.name }])
    )
    return out(
      `${JSON.stringify([{ Name: n.name, Labels: n.labels, Containers: containers }])}\n`
    )
  }
  if (verb === "create") {
    const name = rest.at(-1)!
    if (named(name))
      return fail(
        `Error response from daemon: network with name ${name} already exists\n`
      )
    const labels: Record<string, string> = {}
    for (let i = 0; i < rest.length - 1; i++)
      if (rest[i] === "--label") {
        const pair = rest[++i]!
        labels[pair.slice(0, pair.indexOf("="))] = pair.slice(
          pair.indexOf("=") + 1
        )
      }
    model.networks.push({ name, labels })
    return out(`${newId()}\n`)
  }
  if (verb === "connect") {
    const alias = rest[0] === "--alias" ? rest[1]! : undefined
    const [net, ref] = alias ? rest.slice(2) : rest
    const c = findContainer(model, ref!)
    if (!named(net!) || !c)
      return fail(`Error response from daemon: not found\n`)
    if (net! in c.networks)
      return fail(
        `Error response from daemon: endpoint with name ${c.name} already exists in network ${net}\n`
      )
    const without = (model.script.connectWithoutAlias ?? 0) > 0
    if (without) model.script.connectWithoutAlias! -= 1
    c.networks[net!] = { aliases: alias && !without ? [alias] : [] }
    return {}
  }
  if (verb === "disconnect") {
    const c = findContainer(model, rest.at(-1)!)
    const net = rest.at(-2)!
    if (!c || !(net in c.networks))
      return fail(
        `Error response from daemon: container is not connected to network ${net}\n`
      )
    delete c.networks[net]
    return {}
  }
  if (verb === "rm") {
    const name = rest.at(-1)!
    if (!named(name))
      return fail(`Error response from daemon: network ${name} not found\n`)
    if (model.containers.some((c) => name in c.networks))
      return fail(
        `Error response from daemon: error while removing network: network ${name} has active endpoints\n`
      )
    model.networks = model.networks.filter((n) => n.name !== name)
    return {}
  }
  return fail(`unknown network command ${verb}\n`)
}

/** `docker exec <container> …`: Caddy's validate, the signal, the nonce, and the certificates' removal. */
function exec(model: Model, ref: string, command: string[]): Answer {
  const c = findContainer(model, ref)
  if (!c) return fail(`Error response from daemon: No such container: ${ref}\n`)
  if (!c.running)
    return fail(
      `Error response from daemon: container ${c.id} is not running\n`
    )
  const log = (model.logs[c.name] ??= [])
  if (command[0] === "caddy" && command[1] === "validate") {
    if ((model.script.validateFails ?? 0) > 0) {
      model.script.validateFails! -= 1
      return fail(`${caddyLine("validate failed")}\n`)
    }
    return parses(proxyConfig(c)) ? out("Valid configuration\n") : fail("{}\n")
  }
  if (command.join(" ") === "kill -USR1 1") {
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

function answer(model: Model): Answer {
  const failing = model.script.failing?.find((words) =>
    args.join(" ").startsWith(words)
  )
  if (failing) return fail(`Error response from daemon: ${failing} failed\n`)
  const [verb, ...rest] = args
  if (verb === "compose") {
    // compose -p <project> ps -q <service>: the running containers of that service.
    const [, project, , , service] = rest
    const ids = model.containers
      .filter(
        (c) =>
          c.running &&
          c.labels["com.docker.compose.project"] === project &&
          c.labels["com.docker.compose.service"] === service
      )
      .map((c) => `${c.id}\n`)
    return out(ids.join(""))
  }
  if (verb === "network") return network(model, rest)
  if (verb === "run") return run(model, rest)
  if (verb === "inspect")
    return inspect(model, rest[0] === "--type" ? rest.slice(2) : rest)
  if (verb === "exec") return exec(model, rest[0]!, rest.slice(1))
  if (verb === "logs") {
    const c = findContainer(model, rest.at(-1)!)
    if (!c)
      return fail(
        `Error response from daemon: No such container: ${rest.at(-1)}\n`
      )
    // Caddy writes its log on standard error, and `docker logs` keeps the stream.
    return { stderr: (model.logs[c.name] ?? []).map((l) => `${l}\n`).join("") }
  }
  if (verb === "start") {
    const c = findContainer(model, rest.at(-1)!)
    if (!c)
      return fail(
        `Error response from daemon: No such container: ${rest.at(-1)}\n`
      )
    c.running = true
    if (c.image.startsWith("caddy")) startProxy(model, c)
    return out(`${rest.at(-1)}\n`)
  }
  if (verb === "rm") {
    const c = findContainer(model, rest.at(-1)!)
    if (!c)
      return fail(
        `Error response from daemon: No such container: ${rest.at(-1)}\n`
      )
    model.containers = model.containers.filter((each) => each !== c)
    return out(`${rest.at(-1)}\n`)
  }
  return fail(`the stand-in does not know docker ${args.join(" ")}\n`)
}

const result = changeModel(dir, answer)
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
process.exit(result.code ?? 0)
