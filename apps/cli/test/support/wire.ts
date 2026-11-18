/**
 * What passes between this machine and a runner's session, for the tests of
 * deploy version 2 (specs/014-deploy-v2): a wrapper of `deps.connect` whose
 * sessions note every line the CLI writes, and can hold the next request of
 * a command until the test lets it go, cut off the next answer to a command
 * after the runner gave it (the runner still did what it was asked), or
 * change every answer to a command before the CLI reads it. One-shot
 * commands, and everything the runner does, are left as they are.
 */
import type { Deps } from "../../src/cli/context"
import type { RunnerProcess } from "../../src/server/transport"

/** A request held back: `reached` once the CLI wrote it, `release` hands it to the runner. */
export type Held = { reached: Promise<void>; release(): void }

type Rewrite = (result: Record<string, unknown>) => unknown

/** The command a request line names, or undefined for a line that is not one. */
function commandOf(line: string): string | undefined {
  try {
    const request = JSON.parse(line) as { command?: unknown }
    return typeof request.command === "string" ? request.command : undefined
  } catch {
    return undefined
  }
}

/** Wraps `deps.connect` in place. Every session opened through it from now on is watched. */
export function wire(deps: Pick<Deps, "connect">) {
  const original = deps.connect
  /** Every line the CLI wrote to a session, in order, without its line feed. */
  const lines: string[] = []
  /** The commands whose next request is to be held, each with what to call once it is. */
  const holds = new Map<string, () => void>()
  /** The release of each request being held, by command. */
  const held = new Map<string, () => void>()
  const cuts = new Set<string>()
  const rewrites = new Map<string, Rewrite>()

  function watch(child: RunnerProcess): RunnerProcess {
    /** The commands sent and not answered yet, oldest first. */
    const asked: string[] = []
    const send = (text: string, command: string | undefined) => {
      if (command !== undefined) asked.push(command)
      child.write(text)
    }
    const reader = child.output.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let rest = ""
    let cut = false
    const drain = () =>
      void (async () => {
        try {
          for (;;) if ((await reader.read()).done) return
        } catch {
          // The runner went away.
        }
      })()

    const output = new ReadableStream<Uint8Array>({
      async pull(controller) {
        for (;;) {
          const end = rest.indexOf("\n")
          if (end !== -1) {
            const line = rest.slice(0, end)
            rest = rest.slice(end + 1)
            let frame: Record<string, unknown> | undefined
            try {
              frame = JSON.parse(line) as Record<string, unknown>
            } catch {
              frame = undefined
            }
            if (frame !== undefined && "result" in frame) {
              const command = asked.shift()
              if (command !== undefined && cuts.has(command)) {
                cuts.delete(command)
                cut = true
                controller.close()
                drain()
                return
              }
              const change =
                command === undefined ? undefined : rewrites.get(command)
              if (change !== undefined) {
                controller.enqueue(
                  encoder.encode(
                    `${JSON.stringify({ result: change(frame.result as Record<string, unknown>) })}\n`
                  )
                )
                return
              }
            }
            controller.enqueue(encoder.encode(`${line}\n`))
            return
          }
          const chunk = await reader.read().catch(() => ({
            done: true as const,
            value: undefined,
          }))
          if (chunk.done) {
            if (rest !== "") controller.enqueue(encoder.encode(rest))
            rest = ""
            controller.close()
            return
          }
          rest += decoder.decode(chunk.value, { stream: true })
        }
      },
      cancel() {
        if (!cut) void reader.cancel().catch(() => {})
      },
    })

    return {
      ...child,
      output,
      write(text) {
        for (const line of text.split("\n").filter(Boolean)) {
          lines.push(line)
          const command = commandOf(line)
          const arrived = command === undefined ? undefined : holds.get(command)
          if (command !== undefined && arrived !== undefined) {
            holds.delete(command)
            arrived()
            let released = false
            const release = () => {
              if (released) return
              released = true
              send(`${line}\n`, command)
            }
            held.set(command, release)
            continue
          }
          send(`${line}\n`, command)
        }
      },
    }
  }

  deps.connect = (target, localRunner, options) => {
    const transport = original(target, localRunner, options)
    return { ...transport, open: () => watch(transport.open()) }
  }

  return {
    lines,
    /** The requests written for `command`, parsed, in order. */
    requests(command: string): Record<string, unknown>[] {
      return lines
        .filter((line) => commandOf(line) === command)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    },
    /** Holds the next request for `command` until `release`. */
    hold(command: string): Held {
      let arrive = () => {}
      const arrived = new Promise<void>((resolve) => (arrive = resolve))
      holds.set(command, arrive)
      return {
        reached: arrived,
        release: () => held.get(command)?.(),
      }
    },
    /** The runner's next answer to `command` never reaches the CLI: its output ends there instead. */
    cutAnswer(command: string): void {
      cuts.add(command)
    },
    /** Every answer to `command` is changed by `change` before the CLI reads it; undefined stops it. */
    rewrite(command: string, change: Rewrite | undefined): void {
      if (change === undefined) rewrites.delete(command)
      else rewrites.set(command, change)
    },
    /** Puts `deps.connect` back as it was. */
    restore(): void {
      deps.connect = original
    },
  }
}
