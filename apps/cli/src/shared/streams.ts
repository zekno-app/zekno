/**
 * This process's standard output and error, written so that a reader slower
 * than the writer holds the writer back instead of filling memory. The plain
 * interface writes through these (ui/plain/plain.ts), and so does what a
 * runner or SSH write on standard error (server/transport.ts).
 */

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
