/**
 * A stand-in terminal for single commands at a terminal (specs/006-cli-small-features):
 * the interface a person's terminal gets (`inkUi`), drawing into a stream the
 * test reads back, and taking keys the test types. Nothing here reaches a
 * real terminal.
 */
import { PassThrough, Writable } from "node:stream"

import { inkUi } from "../../src/ui/ink/ink"
import { screenOf } from "./helpers"

/** Keys as a terminal hands them over. */
export const KEYS = {
  up: "\x1b[A",
  down: "\x1b[B",
  enter: "\r",
  esc: "\x1b",
  ctrlC: "\x03",
  backspace: "\x7f",
} as const

/**
 * An input that says it is a terminal, records each change of raw mode and
 * takes keys from the test, and an output that keeps what Ink writes. Ink
 * draws into it as into a person's terminal.
 */
export function terminal(columns = 100, rows = 30) {
  const modes: boolean[] = []
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(mode: boolean) {
      modes.push(mode)
      input.isRaw = mode
      return input
    },
    ref: () => input,
    unref: () => input,
  })
  let raw = ""
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        raw += String(chunk)
        done()
      },
    }),
    { columns, rows, isTTY: true }
  )
  const ui = inkUi({
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
    interactive: true,
  })
  return {
    ui,
    input,
    modes,
    /** Keys typed, as a terminal hands them over. */
    keys: (text: string) => void input.write(text),
    /** The lines on the screen now, empty ones left out. */
    lines: () => screenOf(raw).filter(Boolean),
    /** The lines on the screen now, empty ones kept. */
    screen: () => screenOf(raw),
    raw: () => raw,
  }
}

export type Terminal = ReturnType<typeof terminal>

/** Waits until `ready` holds, `ms` at most. */
export async function until(
  ready: () => boolean,
  what: string,
  ms = 3000
): Promise<void> {
  const started = Date.now()
  while (!ready()) {
    if (Date.now() - started > ms) throw new Error(`never happened: ${what}`)
    await Bun.sleep(5)
  }
}

/** Waits until a line on the screen is exactly `line`. */
export const shows = (t: Terminal, line: string, ms?: number) =>
  until(() => t.lines().includes(line), `the line ${JSON.stringify(line)}`, ms)

/** Waits until a line on the screen starts with `start`. */
export const showsStart = (t: Terminal, start: string, ms?: number) =>
  until(
    () => t.lines().some((line) => line.startsWith(start)),
    `a line starting ${JSON.stringify(start)}`,
    ms
  )
