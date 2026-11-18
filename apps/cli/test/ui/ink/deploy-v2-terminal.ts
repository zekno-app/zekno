/**
 * What the tests of deploy version 2's lines at a terminal share
 * (deploy-v2-lines.test.tsx, deploy-v2-secrets.test.tsx): a command run with
 * the interface a terminal gets (Ink) or the plain one, the lines it drew,
 * the zekno release it carries, and how a terminal splits an error into its
 * bold first sentence and the rest, and draws them.
 */
import { join } from "node:path"
import { PassThrough, Writable } from "node:stream"

import type { Deps } from "../../../src/cli/context"
import { withoutBackticks } from "../../../src/ui/ink/marks"
import { inkUi } from "../../../src/ui/ink/ink"
import { plainUi } from "../../../src/ui/plain/plain"
import { drawnInColour, plainOf, runsOf } from "../../support/colour"
import { screenOf, type machine } from "../../support/helpers"

export type Machine = ReturnType<typeof machine>

/** Something that runs `zekno` with its own needs: a machine, a second terminal or a twin. */
type Runs = { deps: Deps; zekno: (...args: string[]) => Promise<number> }

/** Escape sequences, as Ink writes them for colour and for redrawing. */
const strip = (text: string) =>
  text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "")

/**
 * Runs `zekno <args>` with the interface a terminal gets (Ink), drawing into
 * a stream `columns` wide, and gives back the exit status and every line
 * drawn, in the order written, the space at its end taken off. Standard
 * input is not a terminal, so nothing is asked.
 */
export async function atTerminal(
  m: Runs,
  columns: number,
  ...args: string[]
): Promise<{ code: number; lines: string[] }> {
  return drawing(m, columns, false, args)
}

/** The same, on a terminal Ink redraws in place: the lines left on its screen once the command ended. */
export async function onScreen(
  m: Runs,
  columns: number,
  ...args: string[]
): Promise<{ code: number; lines: string[] }> {
  return drawing(m, columns, true, args)
}

/** Both: `redrawn`, the stream is a terminal Ink redraws in place, and the lines are those left on its screen. No line may pass `columns`. */
async function drawing(
  m: Runs,
  columns: number,
  redrawn: boolean,
  args: string[]
): Promise<{ code: number; lines: string[] }> {
  let text = ""
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        text += String(chunk)
        done()
      },
    }),
    { columns, rows: 40, ...(redrawn ? { isTTY: true } : {}) }
  )
  const ui = inkUi({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: new PassThrough() as unknown as NodeJS.ReadStream,
    ...(redrawn ? { interactive: true } : {}),
  })
  const before = m.deps.ui
  m.deps.ui = { ...ui, askSecret: before.askSecret }
  try {
    const code = await m.zekno(...args)
    await ui.close()
    const lines = redrawn
      ? screenOf(text)
      : strip(text)
          .split("\n")
          .map((line) => line.trimEnd())
    for (const line of lines)
      if ([...line].length > columns)
        throw new Error(`drawn past ${columns} columns: ${line}`)
    return { code, lines }
  } finally {
    m.deps.ui = before
  }
}

/** Plain output, as when piped: every line written, and where, in the order written. */
export function piped(m: Runs) {
  const written: { to: "out" | "err" | "remote"; line: string }[] = []
  m.deps.ui = {
    ...plainUi(
      (line) => void written.push({ to: "out", line }),
      (line) => void written.push({ to: "err", line }),
      (text) =>
        void written.push({ to: "remote", line: text.replace(/\n$/, "") })
    ),
    askSecret: m.deps.ui.askSecret,
  }
  return {
    written,
    err: () =>
      written.filter((entry) => entry.to !== "out").map((entry) => entry.line),
    clear: () => void written.splice(0),
  }
}

/** This zekno, as one built to carry runner `version`. */
export const carrying = (m: Machine, version: string) =>
  (m.deps.release = {
    version,
    files: { "linux-x64": { sha256: null }, "linux-arm64": { sha256: null } },
  })

/**
 * An error's text as a terminal splits it (`ErrorLine`, ui/ink/lines.tsx):
 * its first sentence, drawn bold after ✖, and the rest, drawn dim under it,
 * each with the backticks of plain output dropped.
 */
export function firstAndRest(text: string): { first: string; rest: string } {
  const shown = withoutBackticks(text)
  const end = shown.search(/\.(?=\s)/)
  return end === -1
    ? { first: shown, rest: "" }
    : {
        first: shown.slice(0, end + 1),
        rest: shown
          .slice(end + 1)
          .trim()
          .replace(/\s+/g, " "),
      }
}

/**
 * Each line `ErrorLine` (ui/ink/lines.tsx) draws for `text` at 100 columns,
 * on a terminal that shows every colour, as runs in one look, the spaces
 * between words left out.
 */
export function drawnError(text: string) {
  const file = join(import.meta.dir, "../../../src/ui/ink/lines.tsx")
  return drawnInColour(file, "ErrorLine", { text, columns: 100 })
    .split("\n")
    .filter((line) => plainOf(line).trim() !== "")
    .map((line) =>
      runsOf(line)
        .filter((run) => run.text.trim() !== "")
        .map((run) => ({ ...run, text: run.text.trim() }))
    )
}

/** The lines drawn after the last that is `line`, up to the next empty one: what is said under a stage row. */
export function shownAfter(lines: readonly string[], line: string): string[] {
  const at = lines.lastIndexOf(line)
  if (at === -1) throw new Error(`no line ${JSON.stringify(line)}`)
  const after = lines.slice(at + 1)
  const start = after.findIndex((entry) => entry !== "")
  if (start === -1) return []
  const end = after.indexOf("", start)
  return after.slice(start, end === -1 ? undefined : end)
}
