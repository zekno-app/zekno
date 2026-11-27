/**
 * The Linux stand-in's script, the same on GitHub and on the Mac
 * (specs/016-build-from-source, T008; quickstart.md, "The Linux stand-in,
 * on the Mac"; research/map-checks.md part 6; LC8):
 *
 *   bun --no-env-file apps/runner/test/support/linux-server/server.ts up --engine floor --store containerd [--memory 1g]
 *   bun --no-env-file apps/runner/test/support/linux-server/server.ts engine --id <id> --engine newest
 *   bun --no-env-file apps/runner/test/support/linux-server/server.ts down --id <id>
 *   bun --no-env-file apps/runner/test/support/linux-server/server.ts list
 *
 * `up` (`up.ts`) makes a stand-in and prints `ZEKNO_LINUX_SERVER=...` and
 * the sshd port; `down` (`down.ts`) removes what a run made and compares
 * the host with the lists taken before `up`; `engine` swaps the engine of a
 * running stand-in; `list` shows what is named zekno-check-* here. Every
 * host Docker call goes through `host-docker.ts`, on the engine `up` read
 * once from the host's context (a socket of this machine) and kept in the
 * run's `run.json`; nothing on the host builds, prunes or logs in. Ids,
 * names and options are checked before any call; a wrong one ends with
 * status 2.
 *
 * The folder: this script, `run-checks.ts`, `digests.ts`, `gate.ts` and the
 * pins at its top; `host/` holds the calls to the machine's Docker,
 * `stand-in/` the making and removing of a stand-in, `jobs/` the jobs, the
 * checks' places and their record lines, `build-runs/` what runs a build in
 * the stand-in and reads what it left, `checks/` each check's own parts.
 */
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { down } from "./stand-in/down"
import { hostDocker, resolveEndpoint } from "./host/host-docker"
import {
  containersLabelled,
  leftovers,
  namesIn,
  runIdOf,
} from "./host/host-lists"
import { ENGINE_NAMES, loadPins, type EngineName } from "./pins"
import { engineSwap, namesOf, newId, readOptions } from "./stand-in/plan"
import { readState, runFolder, runIds, writeState } from "./stand-in/run-folder"
import { choosePort } from "./stand-in/sshd"
import {
  checkEngine,
  Failed,
  lastLine,
  MINUTE,
  must,
  seconds,
  up,
  type Deps,
  type Local,
} from "./stand-in/up"

export { down } from "./stand-in/down"
export { PLACE_RUNNER, up, type Deps, type Local } from "./stand-in/up"

const USAGE =
  "Use: server.ts up --engine <name> --store <store> [--memory 1g] | down --id <id> | engine --id <id> --engine <name> | list"

/** Swaps the engine of a running stand-in (map-checks T5) and checks the version it then runs. */
export async function engine(
  id: string,
  name: EngineName,
  deps: Deps
): Promise<number> {
  const names = namesOf(id)
  const state = readState(deps.root, id)
  if ("reason" in state) {
    deps.say(
      `The run.json of ${id} ${state.reason}, so the engine ${names.server} is on is not known; make one with server.ts up.`
    )
    return 1
  }
  const docker = deps.docker(state.endpoint, id)
  const started = deps.now()
  if (!(await containersLabelled(docker, id)).includes(names.server)) {
    deps.say(
      `${names.server} is not on this machine; make one with server.ts up.`
    )
    return 1
  }
  try {
    must(
      await docker.run(engineSwap(deps.pins, names, name), {
        timeoutMs: 20 * MINUTE,
      })
    )
    const version = await checkEngine(docker, names.server, deps.pins, name)
    writeState(runFolder(deps.root, id), { ...state, engine: name })
    deps.say(
      `${names.server} runs ${name} now: Engine ${version}, in ${seconds(deps.now() - started)} s.`
    )
    return 0
  } catch (error) {
    deps.say(
      error instanceof Failed
        ? `The swap failed (exit ${error.answer.code}): ${lastLine(error.answer)}`
        : `The swap failed: ${(error as Error).message}`
    )
    return 1
  }
}

/** What is named zekno-check-* on this machine, by run id, with each run's folder. */
export async function list(deps: Deps): Promise<number> {
  let endpoint: string
  try {
    endpoint = await deps.endpoint()
  } catch (error) {
    deps.say((error as Error).message)
    return 1
  }
  const left = await leftovers(deps.docker(endpoint))
  const byId = new Map<string, string[]>()
  const others: string[] = []
  for (const name of namesIn(left)) {
    const id = runIdOf(name)
    if (id === undefined) others.push(name)
    else byId.set(id, [...(byId.get(id) ?? []), name])
  }
  const folders = runIds(deps.root)
  const ids = [...new Set([...byId.keys(), ...folders])].sort()
  if (ids.length === 0 && others.length === 0) {
    deps.say("Nothing named zekno-check-* is on this machine.")
    return 0
  }
  for (const id of ids) {
    const parts = [(byId.get(id) ?? []).join(", ")]
    if (folders.includes(id))
      parts.push(`its folder ${runFolder(deps.root, id)}`)
    deps.say(`${id}: ${parts.filter((part) => part !== "").join("; ")}`)
  }
  if (others.length > 0) deps.say(`Of no run: ${others.join(", ")}`)
  return 0
}

/** `--key value` pairs, each of `keys` exactly once and nothing else, or a throw of `usage`. */
function pairs(
  args: readonly string[],
  keys: readonly string[],
  usage: string
): Map<string, string> {
  const found = new Map<string, string>()
  if (args.length !== keys.length * 2) throw new Error(usage)
  for (let at = 0; at < args.length; at += 2) {
    const key = args[at]!
    if (!keys.includes(key) || found.has(key)) throw new Error(usage)
    found.set(key, args[at + 1]!)
  }
  return found
}

function engineName(value: string): EngineName {
  if (!(ENGINE_NAMES as readonly string[]).includes(value))
    throw new Error(
      `--engine takes ${ENGINE_NAMES.slice(0, -1).join(", ")} or ${ENGINE_NAMES.at(-1)}, not ${JSON.stringify(value)}`
    )
  return value as EngineName
}

/** Runs on this machine with `Bun.spawn`; Docker is refused here, it goes through host-docker.ts. */
export const spawnLocal: Local = async (args, options) => {
  if (args[0] === undefined || basename(args[0]) === "docker")
    throw new Error("Docker is called through host-docker.ts only")
  const child = Bun.spawn([...args], {
    cwd: options.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: options.timeoutMs,
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code: child.signalCode === null ? code : -1, stdout, stderr }
}

/** True when nothing listens on `port` of 127.0.0.1. */
export function portFree(port: number): boolean {
  try {
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: { data() {} },
    })
    listener.stop(true)
    return true
  } catch {
    return false
  }
}

/** The real machine: Docker through host-docker.ts, run folders in the system's temporary folder. */
export function hostDeps(): Deps {
  return {
    docker: (endpoint, id) => hostDocker({ id, endpoint }),
    endpoint: () => resolveEndpoint(),
    local: spawnLocal,
    portFree,
    root: tmpdir(),
    runnerDir: join(import.meta.dir, "..", "..", ".."),
    say: (line) => console.log(line),
    pins: loadPins(),
    newId: () => newId(),
    choosePort: () => choosePort(),
    now: () => performance.now(),
  }
}

export async function main(
  argv: readonly string[],
  deps: Deps = hostDeps()
): Promise<number> {
  const [command, ...rest] = argv
  let run: () => Promise<number>
  try {
    if (command === "up") {
      const options = readOptions(rest)
      run = () => up(options, deps)
    } else if (command === "down") {
      const id = pairs(rest, ["--id"], "down takes --id <id>").get("--id")!
      namesOf(id)
      run = () => down(id, deps)
    } else if (command === "engine") {
      const given = pairs(
        rest,
        ["--id", "--engine"],
        "engine takes --id <id> --engine <name>"
      )
      const id = given.get("--id")!
      namesOf(id)
      const name = engineName(given.get("--engine")!)
      run = () => engine(id, name, deps)
    } else if (command === "list") {
      if (rest.length > 0) throw new Error("list takes nothing")
      run = () => list(deps)
    } else {
      deps.say(USAGE)
      return 2
    }
  } catch (error) {
    deps.say((error as Error).message)
    return 2
  }
  try {
    return await run()
  } catch (error) {
    deps.say(`server.ts stopped: ${(error as Error).message}`)
    return 1
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
