import { CliError } from "../errors"
import { cellText, REMOTE_MARK, type Ui } from "./types"

/**
 * Writes to a stream of this process. When it is backed up, such as a pipe
 * nobody reads, the returned promise settles only once it takes more, or can
 * take nothing any more. Whoever waits for it holds back instead of piling
 * text up in memory: Bun keeps every write it cannot pass on yet, with no
 * limit, and `writableLength` does not show it.
 */
function writeWaiting(stream: NodeJS.WriteStream, text: string): Promise<void> | undefined {
  if (stream.write(text)) return undefined
  return new Promise((resolve) => {
    const done = () => {
      stream.off("drain", done)
      stream.off("error", done)
      stream.off("close", done)
      resolve()
    }
    stream.once("drain", done)
    stream.once("error", done)
    stream.once("close", done)
  })
}

/** Writes to this process's standard error, as `writeWaiting` does. */
export const writeStandardError = (text: string): Promise<void> | undefined => writeWaiting(process.stderr, text)

/**
 * This process's standard output, for lines that come without end, such as
 * `zekno logs`. A write waits while the output is backed up. Once nobody
 * reads it any more (the end of a pipe was closed, as `| head -1` does)
 * `closed` is signalled and nothing more is written: `console.log` would go
 * on writing into the closed pipe for as long as lines came.
 */
export function standardOutput(stream: NodeJS.WriteStream = process.stdout): { write(text: string): Promise<void> | undefined; closed: AbortSignal } {
  const closed = new AbortController()
  const gone = () => closed.abort()
  // Kept for the life of the process: a write that fails later must not end it with an error.
  stream.on("error", gone)
  stream.once("close", gone)
  return {
    write: (text) => (closed.signal.aborted ? undefined : writeWaiting(stream, text)),
    closed: closed.signal,
  }
}

/** Reads everything on standard input, without one trailing line break. */
export async function readStdin(): Promise<string> {
  const text = await new Response(Bun.stdin.stream()).text()
  return text.replace(/\r?\n$/, "")
}

/**
 * Plain lines: results on standard output, warnings and errors on standard
 * error. A line from a server goes to standard error as well, after the mark,
 * through `remote`. That is not `err`, which cannot say when standard error
 * is backed up: a server can send lines without end, and whoever passes them
 * on must be able to wait. For the same reason an app's logs go through
 * `logs`, when given, rather than `out`.
 */
export function plainUi(
  out: (line: string) => void,
  err: (line: string) => void,
  remote: (text: string) => void | Promise<void> = writeStandardError,
  logs?: ReturnType<typeof standardOutput>
): Ui {
  return {
    info: out,
    success: out,
    warn: err,
    error: err,
    field: (label, value) => out(`${label}: ${value}`),
    table: (rows) => rows.forEach((row) => out(row.map(cellText).join("\t"))),
    // A reader slower than the logs slows the reading down instead of filling memory.
    logLine: (line) => {
      const text = `${line.time}\t${line.service}\t${line.text}`
      return logs ? logs.write(`${text}\n`) : out(text)
    },
    outputClosed: logs?.closed,
    json: (value) => out(JSON.stringify(value)),
    remote: (line) => remote(`${REMOTE_MARK} ${line}\n`),
    step: (_label, work) => work(),
    askSecret(_question, fromStdin) {
      if (!fromStdin) {
        throw new CliError("There is no terminal to ask on. Pipe the value in and add `--stdin`.")
      }
      return readStdin()
    },
    async confirm(_question, refusal) {
      throw new CliError(refusal)
    },
    close: async () => {},
  }
}

/** The plain interface as `zekno` runs it when output is piped: this process's own standard output and error. */
export const processPlainUi = (): Ui =>
  plainUi(
    (line) => console.log(line),
    (line) => console.error(line),
    writeStandardError,
    standardOutput()
  )
