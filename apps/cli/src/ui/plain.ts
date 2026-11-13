import { CliError } from "../errors"
import type { Ui } from "./types"

/** Reads everything on standard input, without one trailing line break. */
export async function readStdin(): Promise<string> {
  const text = await new Response(Bun.stdin.stream()).text()
  return text.replace(/\r?\n$/, "")
}

/** Plain lines: results on standard output, warnings and errors on standard error. */
export function plainUi(out: (line: string) => void, err: (line: string) => void): Ui {
  return {
    info: out,
    success: out,
    warn: err,
    error: err,
    field: (label, value) => out(`${label}: ${value}`),
    table: (rows) => rows.forEach((row) => out(row.join("\t"))),
    json: (value) => out(JSON.stringify(value)),
    step: (_label, work) => work(),
    askSecret(_question, fromStdin) {
      if (!fromStdin) {
        throw new CliError("There is no terminal to ask on. Pipe the value in and add `--stdin`.")
      }
      return readStdin()
    },
    close: async () => {},
  }
}
