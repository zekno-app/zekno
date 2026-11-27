/**
 * A stand-in server for a deploy that builds (specs/016-build-from-source,
 * tasks T126 to T129): this repository's runner, with the stand-in Docker of
 * the runner's tests, answers every request but those a test scripts, which
 * are answered here as contracts/core.md CO12 gives them (`builder`,
 * `builds`, and `deploy` up to its signature). A test may also change the
 * runner's answer to a request it passes on, such as the number `status`
 * reports for an app. Every request of every session is recorded, so a test
 * sees what was asked, and a stop before the session sees no connection.
 */
import type {
  AppBuildsAnswer,
  Build,
  Envelope,
  RunnerBuilder,
} from "@workspace/core"

import type { Deps } from "../../src/cli/context"
import type { RunnerProcess } from "../../src/server/transport"

/** A request a session carried: its command and its input. */
export type Asked = { command: string; input: unknown }

/** What the stand-in answers in place of the runner, by command; `rewrite` changes the runner's own answer to a command it passes on. */
export type Script = {
  answer?: Partial<Record<string, (input: unknown) => unknown>>
  rewrite?: Partial<Record<string, (result: unknown) => unknown>>
}

/** The command a request line names, and its input. */
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
export function standInSessions(deps: Pick<Deps, "connect">, script: Script) {
  const original = deps.connect
  const asked: Asked[] = []
  let connections = 0

  function watch(child: RunnerProcess): RunnerProcess {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()
    /** The commands passed on to the runner and not answered yet, oldest first. */
    const waiting: string[] = []
    const give = (line: string) =>
      writer.write(encoder.encode(`${line}\n`)).catch(() => {})

    void (async () => {
      const reader = child.output.getReader()
      const decoder = new TextDecoder()
      let rest = ""
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          rest += decoder.decode(chunk.value, { stream: true })
          for (
            let end = rest.indexOf("\n");
            end !== -1;
            end = rest.indexOf("\n")
          ) {
            const line = rest.slice(0, end)
            rest = rest.slice(end + 1)
            let frame: Record<string, unknown> | undefined
            try {
              frame = JSON.parse(line) as Record<string, unknown>
            } catch {
              frame = undefined
            }
            const command =
              frame !== undefined && "result" in frame
                ? waiting.shift()
                : undefined
            const change =
              command === undefined ? undefined : script.rewrite?.[command]
            await give(
              change === undefined
                ? line
                : JSON.stringify({ result: change(frame!.result) })
            )
          }
        }
      } catch {
        // The runner went away: its output ends here.
      }
      if (rest !== "") await give(rest)
      await writer.close().catch(() => {})
    })()

    return {
      ...child,
      output: readable,
      write(text) {
        for (const line of text.split("\n").filter(Boolean)) {
          const request = requestOf(line)
          if (request !== undefined) asked.push(request)
          const answer =
            request === undefined ? undefined : script.answer?.[request.command]
          if (answer !== undefined) {
            void give(JSON.stringify({ result: answer(request!.input) }))
            continue
          }
          if (request !== undefined) waiting.push(request.command)
          child.write(`${line}\n`)
        }
      },
    }
  }

  deps.connect = (target, localRunner, options) => {
    connections++
    const transport = original(target, localRunner, options)
    return { ...transport, open: () => watch(transport.open()) }
  }

  return {
    /** Every request, in order, of every session. */
    asked,
    /** The commands asked, in order. */
    commands: () => asked.map((request) => request.command),
    /** The inputs of every request of `command`, in order. */
    inputs: (command: string) =>
      asked
        .filter((each) => each.command === command)
        .map((each) => each.input),
    /** The connections opened. */
    connections: () => connections,
    restore: () => void (deps.connect = original),
  }
}

/** `builder`'s answer (CO12) of a server that can build, with `change` made to it. */
export function builderAnswer(
  change: Partial<RunnerBuilder> = {}
): RunnerBuilder {
  return {
    docker: {
      engine: "29.5.0",
      buildx: "0.29.1",
      buildkit: "0.25.1",
      driver: "docker",
    },
    arch: "arm64",
    memory: 8_000_000_000,
    disk: { free: 50_000_000_000, floor: 2_000_000_000 },
    can: "yes",
    stale: 0,
    ...change,
  }
}

/** `builds`'s answer (CO12) for `app` that keeps nothing but the fresh generations `fresh`, by base key. */
export function buildsAnswer(
  app: string,
  fresh: AppBuildsAnswer["fresh"] = []
): { apps: Record<string, AppBuildsAnswer> } {
  return {
    apps: {
      [app]: {
        running: null,
        deploys: [],
        fresh,
        records: [],
        last: null,
        building: null,
      },
    },
  }
}

/** The payload of a signed deploy as JSON, read without checking its signature: the test reads what was signed. */
export function payloadOf(envelope: Envelope): {
  app: string
  previous: number
  compose: string
  builds: Build[]
} {
  return JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8"))
}

/** A `deploy` answered `started` for the app and number it was signed for, as a runner that built would answer it. */
export function started(input: unknown): unknown {
  const { envelope } = input as { envelope: Envelope }
  const payload = payloadOf(envelope)
  return {
    outcome: "started",
    app: payload.app,
    sequence: payload.previous + 1,
  }
}
