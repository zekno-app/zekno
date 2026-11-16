/**
 * SSH's questions inside the full-screen app (research R10). SSH asks for a
 * password, a passphrase or whether to trust a host key on the terminal
 * itself. An app that reads every key at the same time would swallow the
 * answer, and its frames would draw over the question.
 *
 * So the app connects in SSH's batch mode first, which never asks anything.
 * Only when that fails where SSH would have had to ask does the app hand the
 * terminal over (Ink's `suspendTerminal`), connect again so SSH can ask, and
 * take the terminal back as soon as the runner's first line arrives, or the
 * connection ends. With a key that needs nothing typed, the terminal is never
 * handed over.
 *
 * Nothing is sent twice that could matter: a second attempt is made only when
 * the first ended before the server answered a single byte, with SSH's own
 * status, and the last thing on standard error was SSH's own closing line
 * for a login or host key it could not get past (server/batch.ts
 * `wouldHaveAsked`). SSH writes
 * that line and stops before the remote command starts. A remote command
 * that ran and failed with "Permission denied" somewhere in what it wrote
 * does not end that way, so its request is not sent again.
 *
 * A server that lies can still print SSH's line itself and force one
 * hand-over, where SSH then asks nothing. It gains nothing a lying server
 * does not already have: the request it gets twice is one it could have
 * kept.
 */
import type { Deps } from "../cli/context"
import { recording, wouldHaveAsked } from "../server/batch"
import { sanitize } from "../server/sanitize"
import type { RunnerProcess, Transport } from "../server/transport"

/** How long to wait, once SSH has exited, for the last of what it wrote on standard error. */
const ERRORS_GRACE_MS = 1000

/**
 * Whether a connection made in SSH's batch mode failed only because SSH
 * would have had to ask something: it ended with SSH's own status, 255,
 * before any answer, and SSH said why.
 */
export function needsAnswers(attempt: {
  exitCode: number
  answered: boolean
  lines: readonly string[]
}): boolean {
  return (
    !attempt.answered &&
    attempt.exitCode === 255 &&
    wouldHaveAsked(attempt.lines)
  )
}

/** What SSH's question is about, shown on the normal screen before SSH asks. */
export const handOverNote = (destination: string): string =>
  `SSH needs an answer to reach ${sanitize(destination)}. zekno carries on once it is connected.`

/** The terminal as the app gives it away and takes it back. */
export type Terminal = {
  /** Hands the terminal over and shows `note` there; resolves with the way to take it back. */
  suspend(note: string): Promise<() => Promise<void>>
}

/** One hand-over at a time: two connections cannot both ask on one terminal. */
export function oneAtATime(terminal: Terminal): Terminal {
  let queue: Promise<void> = Promise.resolve()
  return {
    suspend(note) {
      let release = () => {}
      const turn = queue.then(() => terminal.suspend(note))
      queue = turn.then(
        () => new Promise<void>((resolve) => (release = resolve)),
        () => undefined
      )
      return turn.then(
        (takeBack) => async () => {
          try {
            await takeBack()
          } finally {
            release()
          }
        },
        (error: unknown) => {
          release()
          throw error
        }
      )
    },
  }
}

/**
 * A runner process that is first started in batch mode and, when SSH would
 * have asked, once more with the terminal handed over. What was written to
 * it before the first answer is written again to the second attempt.
 */
function askingProcess(
  start: (batch: boolean, lines: string[]) => RunnerProcess,
  terminal: Terminal,
  note: string
): RunnerProcess {
  const lines: string[] = []
  let child = start(true, lines)
  let reader = child.output.getReader()
  let second = false
  let answered = false
  let ended = false
  let stopped = false
  const written: string[] = []
  let takeBack: (() => Promise<void>) | undefined
  let settle: (code: number) => void = () => {}
  const exited = new Promise<number>((resolve) => (settle = resolve))
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    void child.exited.then(settle)
  }
  const giveBack = async () => {
    const back = takeBack
    takeBack = undefined
    await back?.()
  }

  /** After the batch attempt ended without a word: the second attempt, when SSH would have asked. */
  async function retry(): Promise<boolean> {
    if (second || answered || stopped) return false
    const exitCode = await child.exited
    // What SSH said comes on standard error, which may still be on its way when it has exited.
    await Promise.race([child.errorsRead, Bun.sleep(ERRORS_GRACE_MS)])
    if (stopped || !needsAnswers({ exitCode, answered, lines })) return false
    second = true
    takeBack = await terminal.suspend(note)
    if (stopped) {
      await giveBack()
      return false
    }
    child = start(false, [])
    reader = child.output.getReader()
    for (const text of written) child.write(text)
    if (ended) child.end()
    return true
  }

  const output = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        let chunk: Awaited<ReturnType<typeof reader.read>>
        try {
          chunk = await reader.read()
        } catch {
          chunk = { done: true, value: undefined }
        }
        if (!chunk.done) {
          // The runner's first line: the connection is up, and the terminal is the app's again.
          if (!answered) {
            answered = true
            await giveBack()
          }
          controller.enqueue(chunk.value)
          return
        }
        if (await retry()) continue
        await giveBack()
        finish()
        controller.close()
        return
      }
    },
    async cancel() {
      stopped = true
      await giveBack()
      void reader.cancel().catch(() => {})
      finish()
    },
  })

  return {
    output,
    write(text) {
      if (!answered) written.push(text)
      child.write(text)
    },
    send: (bytes) => child.send(bytes),
    end() {
      ended = true
      child.end()
    },
    get errorsRead() {
      return child.errorsRead
    },
    kill() {
      stopped = true
      child.kill()
      void giveBack()
      finish()
    },
    exited,
  }
}

/**
 * The app's way of connecting: over SSH, batch mode first, and the terminal
 * handed over only when SSH has to ask. A runner on this machine is reached
 * as before. SSH's option for batch mode is a fixed string placed before
 * `--` (transport.ts).
 */
export function askingConnect(
  connect: Deps["connect"],
  terminal: Terminal
): Deps["connect"] {
  return (target, localRunner, options = {}) => {
    if (target.kind !== "ssh") return connect(target, localRunner, options)
    const attempt = (batch: boolean, lines: string[]): Transport =>
      connect(target, localRunner, {
        ...options,
        batch,
        errorLines: recording(lines, options.errorLines),
      })
    // Made now so that a stored destination or path that is not valid fails here, as it would without the app.
    const first = attempt(true, [])
    const note = handOverNote(target.destination)
    return {
      firstAnswerMs: first.firstAnswerMs,
      // So that SSH's own failure, where it was not answered, is still told from the runner's (session.ts `SshUnreachable`).
      destination: first.destination,
      async run(command, input) {
        const lines: string[] = []
        const answer = await attempt(true, lines).run(command, input)
        if (
          !needsAnswers({
            exitCode: answer.exitCode,
            answered: answer.stdout !== "",
            lines,
          })
        )
          return answer
        const takeBack = await terminal.suspend(note)
        try {
          return await attempt(false, []).run(command, input)
        } finally {
          await takeBack()
        }
      },
      open: () =>
        askingProcess(
          (batch, lines) => attempt(batch, lines).open(),
          terminal,
          note
        ),
      script: (words) =>
        askingProcess(
          (batch, lines) => {
            const reached = attempt(batch, lines)
            if (!reached.script)
              throw new Error("A connection over SSH can start the installer.")
            return reached.script(words)
          },
          terminal,
          note
        ),
    }
  }
}
