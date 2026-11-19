/**
 * The stand-in for the Docker calls of routes, the proxy and the health
 * check (specs/015-domains-https, contracts/runner.md, "Tests"). The
 * stand-in's shell script (`fake.ts`) records each call, then runs this with
 * its folder and Docker's arguments for `network`, `run`, `exec`, `logs`,
 * `inspect`, `rm`, `start`, `volume`, `image`, `pull` and `compose … ps -q`.
 * It answers from the model (`model.ts`) the way Docker 29 does, as far as
 * the runner reads it, and writes each call's argument list to `argv.jsonl`
 * so a test sees every argument exactly as it was passed. `run` and `exec`,
 * the proxy's and the health check's calls, are answered in
 * `stand-in-proxy.ts`.
 */
import { appendFileSync } from "node:fs"
import { join } from "node:path"

import { changeModel, findContainer, newId, type Model } from "./model"
import { exec, fail, out, run, startProxy, type Answer } from "./stand-in-proxy"

const [dir, ...args] = process.argv.slice(2) as [string, ...string[]]
appendFileSync(join(dir, "argv.jsonl"), `${JSON.stringify(args)}\n`)

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

/** `docker volume inspect <name>`: whether Docker has that named volume. */
function volume(model: Model, words: string[]): Answer {
  const name = words.at(-1)!
  if (words[0] !== "inspect")
    return fail(`unknown volume command ${words[0]}\n`)
  return model.volumes.includes(name)
    ? out(`${JSON.stringify([{ Name: name, Driver: "local" }])}\n`)
    : fail(`Error response from daemon: get ${name}: no such volume\n`)
}

/** `docker image inspect <image>` and `docker pull <image>`: the pinned image is here unless the test said otherwise. */
function image(model: Model, verb: string, ref: string): Answer {
  if (verb === "pull") {
    if (model.script.pullFails)
      return fail(`Error response from daemon: pull access denied for ${ref}\n`)
    delete model.script.imageMissing
    return out(`Status: Downloaded newer image for ${ref}\n`)
  }
  return model.script.imageMissing
    ? fail(`Error response from daemon: No such image: ${ref}\n`)
    : out(
        `${JSON.stringify([{ Id: `sha256:${newId()}`, RepoDigests: [ref] }])}\n`
      )
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
  if (verb === "volume") return volume(model, rest)
  if (verb === "image" && rest[0] === "inspect")
    return image(model, "inspect", rest.at(-1)!)
  if (verb === "pull") return image(model, "pull", rest.at(-1)!)
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
