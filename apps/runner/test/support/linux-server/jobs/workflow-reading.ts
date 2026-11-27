/**
 * Reads .github/workflows/linux-checks.yml for workflow.test.ts
 * (specs/016-build-from-source, T010): the shape `Bun.YAML.parse` gives, the
 * words a step's script passes to server.ts or run-checks.ts, and the legs a
 * job runs its checks on, followed through its steps: `up` starts a leg,
 * `engine` swaps its engine, each `run-checks.ts` runs the checks of the
 * leg it names, which must be the one the stand-in has then.
 */
import type { Leg } from "./jobs"
import type { EngineName } from "../pins"
import type { Store } from "../stand-in/plan"

export type Step = {
  name?: string
  id?: string
  uses?: string
  run?: string
  if?: string
  with?: Record<string, unknown>
  env?: Record<string, string>
}

export type Job = {
  needs?: string | string[]
  if?: string
  "runs-on"?: string
  "timeout-minutes"?: number
  permissions?: unknown
  environment?: unknown
  outputs?: Record<string, string>
  strategy?: {
    "fail-fast"?: boolean
    matrix?: Record<string, readonly string[]>
  }
  steps: Step[]
}

export type Workflow = {
  name?: string
  on: Record<string, unknown>
  permissions: unknown
  concurrency?: unknown
  jobs: Record<string, Job>
}

/**
 * The words after `script` on the line of `run` that calls it, unquoted, up
 * to a pipe or a redirection; undefined when no line calls it.
 */
export function scriptArgs(run: string, script: string): string[] | undefined {
  const line = run.split("\n").find((item) => item.includes(` ${script} `))
  if (line === undefined) return undefined
  const words = line
    .slice(line.indexOf(script) + script.length)
    .trim()
    .split(/\s+/)
  const end = words.findIndex((word) => /^(?:\||[0-9]?>|>>|&&|;)/.test(word))
  return (end < 0 ? words : words.slice(0, end)).map((word) =>
    word.replace(/^"(.*)"$/, "$1")
  )
}

/** `--key value` pairs after the first `skip` words. */
function pairs(words: readonly string[], skip: number): Map<string, string> {
  const found = new Map<string, string>()
  for (let at = skip; at < words.length; at += 2) {
    if (!words[at]!.startsWith("--") || words[at + 1] === undefined)
      throw new Error(`${words.join(" ")} is not --key value pairs`)
    found.set(words[at]!, words[at + 1]!)
  }
  return found
}

/** A word's values: itself, or for `$NAME` the matrix list the step's env names. */
function values(
  word: string | undefined,
  step: Step,
  job: Job
): readonly string[] {
  if (word === undefined) throw new Error(`a step names no value: ${step.run}`)
  const name = /^\$([A-Z_]+)$/.exec(word)?.[1]
  if (name === undefined) return [word]
  const from = /^\$\{\{ matrix\.([a-z]+) \}\}$/.exec(step.env?.[name] ?? "")
  const list = from ? job.strategy?.matrix?.[from[1]!] : undefined
  if (list === undefined)
    throw new Error(`$${name} is not a matrix value in the step ${step.name}`)
  return list
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.join() === b.join()

/** The legs `name`'s steps run its checks on, in order. */
export function legsOf(
  job: Job,
  server: string,
  runChecks: string,
  name: string
): Leg[] {
  const legs: Leg[] = []
  let current:
    | { engines: readonly string[]; stores: readonly string[]; memory: boolean }
    | undefined
  for (const step of job.steps) {
    const up = scriptArgs(step.run ?? "", server)
    const checks = scriptArgs(step.run ?? "", runChecks)
    if (up?.[0] === "up") {
      const given = pairs(up, 1)
      if (given.has("--memory") && given.get("--memory") !== "1g")
        throw new Error(`up takes --memory 1g only: ${up.join(" ")}`)
      current = {
        engines: values(given.get("--engine"), step, job),
        stores: values(given.get("--store"), step, job),
        memory: given.has("--memory"),
      }
    } else if (up?.[0] === "engine") {
      if (current === undefined) throw new Error("an engine swap before up")
      current = { ...current, engines: [pairs(up, 1).get("--engine")!] }
    } else if (checks !== undefined) {
      const given = pairs(checks, 0)
      if (given.get("--job") !== name)
        throw new Error(`${name} runs the checks of ${given.get("--job")}`)
      const engines = values(given.get("--engine"), step, job)
      const stores = values(given.get("--store"), step, job)
      if (
        current === undefined ||
        !same(engines, current.engines) ||
        !same(stores, current.stores)
      )
        throw new Error(
          `${name} runs the checks of ${engines.join(", ")} on ${stores.join(", ")}, which its stand-in does not run then`
        )
      for (const engine of engines)
        for (const store of stores)
          legs.push({
            engine: engine as EngineName,
            store: store as Store,
            memory: current.memory,
          })
    }
  }
  return legs
}
