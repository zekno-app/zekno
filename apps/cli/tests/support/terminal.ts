/**
 * A program in a real pseudo-terminal, through Bun's own `Bun.spawn({
 * terminal })`: the program sees a TTY of a fixed size. What it writes is
 * read the whole time, from the moment it starts until it exits, so it never
 * waits on a full terminal, and is fed to a screen model (screen-model.ts).
 *
 * It answers the terminal questions the app asks before its first frame
 * (OSC 11, the background colour, then DA1) as a dark terminal does.
 */
import { createScreen, type ScreenModel } from "./screen-model"

export type Launch = {
  argv: string[]
  /** The whole environment of the program: nothing is taken from this process's. */
  env: Record<string, string>
  cwd: string
  cols: number
  rows: number
}

/** The background question and DA1, as the app writes them (src/ui/terminal/background.ts). */
const QUESTIONS = /\x1b\]11;\?(?:\x07|\x1b\\)|\x1b\[0?c/g
/** A dark terminal's answers: a black background, then "a VT220 with colour". */
const DARK_BACKGROUND = "\x1b]11;rgb:0000/0000/0000\x1b\\"
const DA1 = "\x1b[?62;22c"
/** All a test keeps of what the program wrote. */
const RAW_LIMIT = 8 * 1024 * 1024

/**
 * The answers a dark terminal gives to the questions in `text`, each once,
 * even when a question is cut between two reads: `carry` is the end of what
 * was read before, and the result's `carry` is the end of this read.
 */
export function terminalAnswers(carry: string, text: string): { replies: string[]; carry: string } {
  const scanned = carry + text
  const replies: string[] = []
  for (const match of scanned.matchAll(QUESTIONS)) {
    // Wholly inside what was read before: answered then.
    if (match.index + match[0].length <= carry.length) continue
    replies.push(match[0].startsWith("\x1b]") ? DARK_BACKGROUND : DA1)
  }
  return { replies, carry: scanned.slice(-16) }
}

export type TerminalProcess = ReturnType<typeof startTerminal>

/** Starts `launch.argv` in a new pseudo-terminal. */
export function startTerminal(launch: Launch) {
  const screen: ScreenModel = createScreen(launch.cols, launch.rows)
  const decoder = new TextDecoder("utf-8")
  let raw = ""
  let carry = ""
  let lastOutput = performance.now()
  let ended = false
  const waiters = new Set<() => void>()
  const wake = () => {
    for (const waiter of waiters) waiter()
    waiters.clear()
  }

  function answer(terminal: Bun.Terminal, text: string) {
    const answered = terminalAnswers(carry, text)
    carry = answered.carry
    for (const reply of answered.replies) terminal.write(reply)
  }

  const child = Bun.spawn(launch.argv, {
    cwd: launch.cwd,
    env: launch.env,
    terminal: {
      cols: launch.cols,
      rows: launch.rows,
      name: "xterm-256color",
      data(terminal, bytes) {
        const text = decoder.decode(bytes, { stream: true })
        answer(terminal, text)
        screen.feed(text)
        if (raw.length < RAW_LIMIT) raw += text
        lastOutput = performance.now()
        wake()
      },
    },
  })
  const terminal = child.terminal!
  const exited = child.exited.then((code) => {
    ended = true
    wake()
    return code
  })

  /** Resolves on the next output or exit, or after `ms`. */
  const nextChange = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(done)
        resolve()
      }, ms)
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      waiters.add(done)
    })

  return {
    screen,
    pid: child.pid,
    exited,
    /** True until the program has exited. */
    running: () => !ended,
    /** Everything the program wrote so far, escape sequences included. */
    raw: () => raw,
    /** Sends bytes as typed at the keyboard. */
    write(text: string) {
      if (!ended && !terminal.closed) terminal.write(text)
    },
    /**
     * Waits until the screen holds still: no half-drawn frame, and nothing
     * written for `quietMs`. A screen that never holds still (a spinner) is
     * taken as it is after `maxMs`, between two frames.
     */
    async settle({ quietMs = 60, maxMs = 1500, minMs = 0 }: { quietMs?: number; maxMs?: number; minMs?: number } = {}) {
      const start = performance.now()
      for (;;) {
        const now = performance.now()
        const quiet = now - lastOutput >= quietMs && now - start >= minMs
        if ((quiet && !screen.synchronizing) || ended) return
        if (now - start >= maxMs && !screen.synchronizing) return
        // A frame that never ends is not waited on forever either.
        if (now - start >= maxMs + 1000) return
        await nextChange(Math.max(5, quietMs - (now - lastOutput)))
      }
    },
    /** Waits until `ready()` is true, reading the screen after each change, or throws after `timeoutMs`. */
    async until(ready: () => boolean, what: string, timeoutMs = 10_000) {
      const start = performance.now()
      while (!ready()) {
        if (performance.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`)
        if (ended && !ready()) throw new Error(`the program exited before ${what}`)
        await nextChange(100)
      }
    },
    /** A new window size, as when a person resizes the terminal. */
    resize(cols: number, rows: number) {
      screen.resize(cols, rows)
      if (!terminal.closed) terminal.resize(cols, rows)
    },
    /**
     * Ends the program: SIGTERM, then SIGKILL if it is still there after
     * `graceMs`, and closes the terminal. Waits for the exit, checking again
     * for a while, since one look can be early.
     */
    async stop(graceMs = 3000): Promise<void> {
      if (!ended) {
        child.kill("SIGTERM")
        await Promise.race([exited, Bun.sleep(graceMs)])
        if (!ended) {
          child.kill("SIGKILL")
          await Promise.race([exited, Bun.sleep(2000)])
        }
      }
      if (!terminal.closed) terminal.close()
    },
  }
}
