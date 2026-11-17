import { CliError } from "../../cli/errors"
import { AD23 } from "../../templates/add-words"
import { plainDeployView } from "../../shared/deploy"
import { standardOutput, writeStandardError } from "../../shared/streams"
import {
  cellText,
  doctorCounts,
  REMOTE_MARK,
  SERVERS_SKIPPED,
  type Ui,
} from "../types"

/**
 * Whether a command prints plain lines rather than the interface a terminal
 * gets: with `--json`, with `TERM=dumb`, and whenever standard output or
 * standard input is not a terminal (piped, in a script, `< /dev/null`), so
 * output stays stable for whatever reads it, and nothing waits on a person.
 */
export function wantsPlain(
  argv: readonly string[],
  stdout: { isTTY?: boolean },
  stdin: { isTTY?: boolean },
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    argv.includes("--json") ||
    !stdout.isTTY ||
    !stdin.isTTY ||
    env.TERM === "dumb"
  )
}

/** Said where a hidden value would be asked for and there is no terminal to ask on. */
export const NO_TERMINAL_FOR_VALUE =
  "There is no terminal to ask on. Pipe the value in and add `--stdin`."

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
  const ui: Ui = {
    info: out,
    success: (text, detail) =>
      out(detail === undefined ? text : `${text}  ${detail}`),
    warn: err,
    error: err,
    note: out,
    field: (label, value) => out(`${label}: ${value}`),
    table: (rows) => rows.forEach((row) => out(row.map(cellText).join("\t"))),
    line: (plain) => {
      if (plain !== undefined) out(plain)
    },
    // Only the result line, and Docker's lines when the app did not start (contracts/commands.md).
    deploy: () => plainDeployView(ui, true),
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
        throw new CliError(NO_TERMINAL_FOR_VALUE)
      }
      return readStdin()
    },
    async confirm(_question, refusal) {
      throw new CliError(refusal)
    },
    // Nobody can answer here, so nothing is ever asked. No command reaches these with `asks` false; one
    // that did would stop with the sentence it has for the missing detail, never wait (research R1).
    asks: false,
    async choose(question) {
      throw question.missing
    },
    async chooseSeveral(question) {
      throw question.missing
    },
    async ask(question) {
      throw question.missing
    },
    async askValue() {
      throw new CliError(NO_TERMINAL_FOR_VALUE)
    },
    code(label, value, about) {
      out(`${label}: ${value}`)
      out(about)
    },
    groups: (rows) => rows.forEach(([label, text]) => out(`${label}\t${text}`)),
    gap: () => {},
    // contracts/doctor.md, "Plain output": where, the check, the result word, then the detail and the next step when there are any.
    doctorReport(report) {
      const row = (where: string, check: (typeof report.machine)[number]) =>
        [
          where,
          check.check,
          check.result,
          ...(check.result === "not checked" ? [] : [check.detail]),
          ...(check.next === undefined ? [] : [check.next]),
        ].join("\t")
      for (const check of report.machine) out(row("this machine", check))
      if (report.serversSkipped) out(SERVERS_SKIPPED)
      else
        for (const server of report.servers)
          for (const check of server.checks) out(row(server.name, check))
      out(doctorCounts(report.problems, report.warnings))
    },
    // contracts/commands.md of specs/010-app-settings, "Piped": the service, the setting's place, its value; SH3 on standard error.
    settingsReport(report) {
      for (const line of report.piped ?? []) out(line.join("\t"))
      if (report.note !== undefined) err(report.note)
    },
    settingChange: (change) =>
      out(
        `${change.service} · ${change.label}  ${change.now} → ${change.next}`
      ),
    // specs/012-templates, contracts/commands.md, "With no terminal": nothing before, AD23's lines once done.
    addition: () => {},
    added(done) {
      if (done.file !== undefined) out(AD23.added(done.service, done.file))
      for (const secret of done.stored)
        out(AD23.stored(secret.name, secret.version))
    },
    // "A hand-written Compose file", with no terminal: the lines as they would be typed into the file, no box, no words around them.
    handLines(lines) {
      for (const line of [...lines.service, ...lines.offers]) out(line)
    },
    // contracts/commands.md, "`zekno add --list`", piped: the name, the title, the version and the author, with tabs.
    templateList: (rows) =>
      rows.forEach((row) =>
        out([row.name, row.title, row.software, row.author].join("\t"))
      ),
    // "`zekno add <template> --show`", piped: the services as `zekno settings` prints them, then made and built.
    templateView: (view) => view.piped.forEach((line) => out(line.join("\t"))),
    close: async () => {},
  }
  return ui
}

/**
 * The plain interface as `zekno` runs it when output is piped: this process's
 * own standard output and error. Warnings and failures are written to
 * standard error as they are: `console.error` colours them where standard
 * error is a terminal. Such a write can still be waiting when the command
 * ends, so `close` waits until standard error has taken them all, for
 * `CLOSE_WAIT_MS` at most: none is lost when the process exits, and a reader
 * that stopped reading does not hold the command (security review, C7).
 */
export const CLOSE_WAIT_MS = 1000

export function processPlainUi(): Ui {
  let taken: Promise<unknown> = Promise.resolve()
  const ui = plainUi(
    (line) => console.log(line),
    (line) => {
      const waiting = writeStandardError(`${line}\n`)
      if (waiting) taken = Promise.all([taken, waiting])
    },
    writeStandardError,
    standardOutput()
  )
  return {
    ...ui,
    close: async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        taken,
        new Promise((resolve) => (timer = setTimeout(resolve, CLOSE_WAIT_MS))),
      ])
      clearTimeout(timer)
    },
  }
}
