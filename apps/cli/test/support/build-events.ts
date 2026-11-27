/**
 * A scripted stand-in runner for the events of a deploy that builds
 * (specs/016-build-from-source, contracts/core.md CO11; contracts/cli.md
 * CL7 step 13; tasks T132 and T137). The upload and the build are later
 * tasks' (T130), so this stand-in answers `builder`, `builds` and `deploy`
 * itself, each with the frames a test scripts: events, then the result, one
 * line each, as a runner of protocol 6 writes them. Every other request goes
 * to this repository's runner with the stand-in Docker of the runner's
 * tests. Every request is recorded.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import type { AppBuildsAnswer, Envelope } from "@workspace/core"

import { type Deps, openTeam } from "../../src/cli/context"
import { prepareDeploy, sendDeploy } from "../../src/ops/deploy"
import type { BuildCallbacks } from "../../src/ops/deploy-send-build"
import type { RunnerProcess } from "../../src/server/transport"
import type { BuildLine } from "../../src/shared/build-lines"
import type { DeployStage } from "../../src/shared/deploy"
import { builderAnswer, payloadOf, standInSessions } from "./build-session"
import { ready } from "./helpers"

/** A request a session carried: its command and its input. */
export type Asked = { command: string; input: unknown }

/** The frames the stand-in writes for one request: events, then `{ result }`. */
export type Frames = readonly Record<string, unknown>[]

/** What the stand-in answers in place of the runner, by command: the frames for the request's input and its count of that command, from 0. */
export type FrameScript = Partial<
  Record<string, (input: unknown, count: number) => Frames>
>

/** The request a line carries, or undefined. */
function requestOf(line: string): Asked | undefined {
  try {
    const request = JSON.parse(line) as { command?: unknown; input?: unknown }
    return typeof request.command === "string"
      ? { command: request.command, input: request.input }
      : undefined
  } catch {
    return undefined
  }
}

/** Wraps `deps.connect` in place: every session opened from now on goes through the stand-in. */
export function scriptedRunner(
  deps: Pick<Deps, "connect">,
  script: FrameScript
) {
  const original = deps.connect
  const asked: Asked[] = []
  const counts = new Map<string, number>()

  function watch(child: RunnerProcess): RunnerProcess {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()
    // One writer for both sources, in order: the runner's lines and the scripted frames.
    let queue = Promise.resolve()
    const give = (bytes: Uint8Array) => {
      queue = queue.then(() => writer.write(bytes).catch(() => {}))
      return queue
    }

    void (async () => {
      const reader = child.output.getReader()
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          await give(chunk.value)
        }
      } catch {
        // The runner went away: its output ends here.
      }
      await queue
      await writer.close().catch(() => {})
    })()

    return {
      ...child,
      output: readable,
      write(text) {
        for (const line of text.split("\n").filter(Boolean)) {
          const request = requestOf(line)
          if (request !== undefined) asked.push(request)
          const frames =
            request === undefined ? undefined : script[request.command]
          if (frames !== undefined) {
            const count = counts.get(request!.command) ?? 0
            counts.set(request!.command, count + 1)
            for (const frame of frames(request!.input, count))
              void give(encoder.encode(`${JSON.stringify(frame)}\n`))
            continue
          }
          child.write(`${line}\n`)
        }
      },
    }
  }

  deps.connect = (target, localRunner, options) => {
    const transport = original(target, localRunner, options)
    return { ...transport, open: () => watch(transport.open()) }
  }

  return {
    asked,
    commands: () => asked.map((request) => request.command),
    inputs: (command: string) =>
      asked
        .filter((each) => each.command === command)
        .map((each) => each.input),
    restore: () => void (deps.connect = original),
  }
}

/** The keys a `deploy` request signed, in the payload's order, its number, and the key of each service's image. */
export function signedOf(input: unknown): {
  keys: string[]
  app: string
  sequence: number
  keyOf: (service: string) => string | undefined
} {
  const { envelope } = input as { envelope: Envelope }
  const payload = payloadOf(envelope)
  return {
    keys: payload.builds.map((build) => build.key),
    app: payload.app,
    sequence: payload.previous + 1,
    // The Compose text zekno writes: `"<service>":` then its image line.
    keyOf: (service) =>
      new RegExp(
        `"${service}":\\n {4}image: "zekno\\.invalid/[^:]+:([0-9a-f]+)"`
      ).exec(payload.compose)?.[1],
  }
}

// The deploys of tasks T132 and T137: a folder with a built service, and the stand-in that answers its deploy.

export type Machine = Awaited<ReturnType<typeof ready>>

export const WHERE = ["--app", "shop", "--server", "dev"]
export const DOCKERFILE = "FROM alpine:3.20\nCOPY . /app\n"
export const ESC = "\x1b"
/** OSC 52: writes "hello" to the clipboard of the terminal that draws it. */
export const CLIPBOARD = `${ESC}]52;c;aGVsbG8=\x07`

function write(folder: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, name)), { recursive: true })
    writeFileSync(join(folder, name), text)
  }
}

/** A ready machine whose folder holds `files` and a settings file of `services`, with no compose.yaml. */
export async function folderWith(
  services: Record<string, unknown>,
  files: Record<string, string> = { Dockerfile: DOCKERFILE }
): Promise<Machine> {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  write(m.project, {
    ...files,
    "zekno.app.json": `${JSON.stringify({ zekno: 1, services }, null, 2)}\n`,
  })
  return m
}

export const built = (build: Record<string, unknown> = {}) => ({
  build: { builder: "dockerfile", ...build },
})

/** `builds`'s answer (CO12) for shop: nothing kept, the app running `running`. */
export const keeps = (
  running: number | null
): { apps: Record<string, AppBuildsAnswer> } => ({
  apps: {
    shop: {
      running,
      deploys: [],
      fresh: [],
      records: [],
      last: null,
      building: null,
    },
  },
})

/**
 * The stand-in: `builder` can build; `builds` answers that the app runs
 * `running` (asked at step 9, and again after a failed build); `deploy`
 * answers with `frames` for the deploy signed. `status` reports `number()`
 * for shop, so each deploy here takes the next number.
 */
export function server(
  m: Machine,
  frames: (signed: ReturnType<typeof signedOf>, count: number) => Frames,
  options: { running?: number | null; number?: () => number } = {}
) {
  const numbers = standInSessions(m.deps, {
    rewrite:
      options.number === undefined
        ? {}
        : {
            status: (result) => {
              const status = result as { lastSequence: Record<string, number> }
              return {
                ...status,
                lastSequence: {
                  ...status.lastSequence,
                  shop: options.number!(),
                },
              }
            },
          },
  })
  const script: FrameScript = {
    builder: () => [{ result: builderAnswer() }],
    builds: () => [{ result: keeps(options.running ?? null) }],
    deploy: (input, count) => frames(signedOf(input), count),
  }
  const stand = scriptedRunner(m.deps, script)
  return {
    ...stand,
    restore: () => {
      stand.restore()
      numbers.restore()
    },
  }
}

/** Events, then the answer `outcome` for the deploy signed. */
export const answer = (
  signed: ReturnType<typeof signedOf>,
  outcome: Record<string, unknown>
) => ({ result: { app: signed.app, sequence: signed.sequence, ...outcome } })

/** A build that runs, writes `lines` and ends `state`. */
export const building = (key: string, lines: string[], state = "built") => [
  { event: "build", key, state: "building" },
  ...lines.map((line) => ({ event: "build_line", key, line })),
  { event: "build", key, state },
]

/** One deploy through the operations, with the stages and the lines said. */
export async function deployOnce(m: Machine, extra: BuildCallbacks = {}) {
  const lines: BuildLine[] = []
  const stages: DeployStage[] = []
  const plan = await prepareDeploy(m.deps, { app: "shop", server: "dev" })
  const callbacks = {
    line: (line: BuildLine) => lines.push(line),
    stage: (stage: DeployStage) => stages.push(stage),
    ...extra,
  }
  const result = await sendDeploy(m.deps, plan, callbacks).catch(
    (error: unknown) => error
  )
  return { plan, result, lines, stages }
}

/** This machine's history of shop on dev. */
export async function historyOf(m: Machine) {
  const team = await openTeam(m.deps)
  const server = team.profile.servers[0]!
  return {
    entries: team.store.history(server.serverId, "shop"),
    serverId: server.serverId,
  }
}
