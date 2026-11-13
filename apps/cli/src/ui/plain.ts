import { CliError } from "../errors"
import { REMOTE_MARK, type Ui } from "./types"

/**
 * Writes to this process's standard error. When it is backed up, such as a
 * pipe nobody reads, the returned promise settles only once it takes more,
 * or can take nothing any more. Whoever waits for it holds back instead of
 * piling text up in memory: Bun keeps every write it cannot pass on yet, with
 * no limit, and `writableLength` does not show it.
 */
export function writeStandardError(text: string): Promise<void> | undefined {
  const stream = process.stderr
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
 * on must be able to wait.
 */
export function plainUi(
  out: (line: string) => void,
  err: (line: string) => void,
  remote: (text: string) => void | Promise<void> = writeStandardError
): Ui {
  return {
    info: out,
    success: out,
    warn: err,
    error: err,
    field: (label, value) => out(`${label}: ${value}`),
    table: (rows) => rows.forEach((row) => out(row.join("\t"))),
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
