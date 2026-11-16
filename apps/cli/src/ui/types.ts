import type { DoctorReport } from "../ops/doctor"
import type { SettingsReport } from "../settings/types"
import type { DeployStart, DeployView } from "../shared/deploy"

/**
 * What every line from a server starts with, as git marks what the other
 * side said. The server cannot leave it out, and none of zekno's own messages
 * on standard error start with it, so a line that does not start with it is
 * zekno's. It stays the same for scripts that read standard error.
 */
export const REMOTE_MARK = "remote:"

/**
 * A table cell that names a state, such as whether an app is running. Plain
 * output prints its word only. At a terminal its symbol and colour go with
 * the word, so the state is never shown by colour alone (FR-008).
 */
export type MarkedCell = {
  text: string
  mark: string
  tone: "success" | "danger" | "warning" | "quiet"
}
/**
 * A cell with a look of its own at a terminal: `strong` bold, `plain` the
 * text colour, `quiet` faint. Plain output prints `text`. A terminal draws
 * `terminal` instead when it is given, for words only a person reading
 * needs, such as "version 1, not deployed yet" where plain output keeps
 * "version 1".
 */
export type StyledCell = {
  text: string
  style: "strong" | "plain" | "quiet"
  terminal?: string
  /**
   * In a line (`Ui.line`), drawn right after the cell before it, with no
   * space between, such as the dim `, the runner release ...` after the
   * runner's version (board "The version, and a newer release").
   */
  tight?: boolean
}
export type Cell = string | MarkedCell | StyledCell

/** The words of a cell, as plain output prints them. */
export const cellText = (cell: Cell): string =>
  typeof cell === "string" ? cell : cell.text

/** A bold cell at a terminal. */
export const strong = (text: string): StyledCell => ({ text, style: "strong" })
/** A faint cell at a terminal. */
export const quiet = (text: string, terminal?: string): StyledCell =>
  terminal === undefined
    ? { text, style: "quiet" }
    : { text, style: "quiet", terminal }
/** A cell in the terminal's text colour, where a table would make it faint. */
export const plainCell = (text: string): StyledCell => ({
  text,
  style: "plain",
})

/**
 * One row of a list a person picks from (specs/006-cli-small-features,
 * contracts/questions.md). `label` and `detail` are drawn as they are given:
 * whoever builds a row cleans anything that came from a file or a server.
 * `asksNext`: choosing it asks a question of its own, such as `+ a new app`,
 * so at a terminal it leaves no line behind and that question is drawn in
 * the list's place (mock-up 2).
 */
export type ListRow<T> = {
  value: T
  label: string
  detail?: string
  asksNext?: boolean
}

/**
 * A list to pick one row from. `rows` is never empty: a caller with nothing
 * to offer says so instead of asking. `collapsed` is the word of the line
 * left behind once a row is chosen (`✔ Server  prod`). `missing` is what the
 * plain interface throws: the sentence the command has for that detail.
 */
export type ListQuestion<T> = {
  question: string
  rows: readonly ListRow<T>[]
  collapsed: string
  missing: Error
}

/**
 * A one-line answer to type. `fill` is the answer so far when the question
 * opens. `check` gives the reason an answer is wrong, or undefined for a good
 * one; it is the same rule the matching flag is held to. `missing` is what
 * the plain interface throws.
 */
export type TypedQuestion = {
  question: string
  fill?: string
  check(answer: string): string | undefined
  missing: Error
}

/**
 * D30, the last line of `zekno doctor` (specs/006-cli-small-features,
 * contracts/doctor.md): each count written `no` when it is 0, the first
 * letter in capitals. `1 problem, 1 warning.` is the mock-up's.
 */
export function doctorCounts(problems: number, warnings: number): string {
  const count = (n: number, word: string) =>
    n === 0 ? `no ${word}s` : `${n} ${word}${n === 1 ? "" : "s"}`
  const text = `${count(problems, "problem")}, ${count(warnings, "warning")}.`
  return text[0]!.toUpperCase() + text.slice(1)
}

/** D31: in place of the servers, when the profile did not verify and no server was contacted. Needs approval (research Q4). */
export const SERVERS_SKIPPED =
  "No server was checked, because the profile could not be verified."

/** One line of an app's logs, as `zekno logs` prints it. Each part is already cleaned or held to a pattern. */
export type LogOutput = { time: string; service: string; text: string }

/**
 * How commands talk to the person. Commands say what happened; a Ui decides
 * how it looks. At a terminal that is Ink; when output is piped, in scripts
 * and in tests it is plain lines.
 */
export interface Ui {
  info(text: string): void
  /**
   * Something the person should notice. Goes to standard error in plain
   * output. At a terminal, with `firstBold`, its first sentence is bold and
   * the rest in the text colour, as the board "The version, and a newer
   * release" draws `zekno version`'s newer release; every other warning is
   * drawn in the text colour whole. Plain output is the same either way.
   */
  warn(text: string, options?: { firstBold?: boolean }): void
  /**
   * A result: `✔` and its words at a terminal. `detail`, when given, is drawn
   * dim after two spaces, as the board "zekno deploy from nothing" draws
   * `✔ Runner installed  52 MB, checksum verified`; plain output prints the
   * same words, two spaces apart. With `firstBold`, the first sentence is bold
   * at a terminal and the rest in the text colour, as the board "zekno secret
   * import" draws `✔ Stored 4 values for demo on prod. They take effect on
   * the next deploy.`; plain output is the same either way.
   */
  success(
    text: string,
    detail?: string,
    options?: { firstBold?: boolean }
  ): void
  /** Why a command failed. Goes to standard error in plain output. */
  error(text: string): void
  /**
   * One quiet line: something the person may like to know, that is neither a
   * result nor a warning, such as `Using prod, your only server.` At a
   * terminal it is dim and set in by two columns; plain output prints it on
   * standard output.
   */
  note(text: string): void
  /** A labelled value worth reading carefully, such as a confirmation code. */
  field(label: string, value: string): void
  /** Rows of cells. Plain output joins cells with tabs. */
  table(rows: Cell[][]): void
  /**
   * One line that reads differently at a terminal, such as the first line of
   * `zekno status` (board "Status, lists, errors and piped output"). Plain
   * output prints `plain` on standard output; a terminal draws `cells`, a
   * space apart, in their looks. Either may be left out, for a line that only
   * one of them has.
   */
  line(plain: string | undefined, cells?: readonly Cell[]): void
  /**
   * Shows a deploy as it happens: `zekno deploy` and `zekno rollback`. At a
   * terminal the summary panel, the stage row and the result line of the
   * board "zekno deploy: success and failure"; in plain output the result
   * line only, and Docker's lines on standard error when the app did not
   * start (contracts/commands.md). Nothing is drawn until it is told a stage.
   */
  deploy(start: DeployStart): DeployView
  /**
   * One line of an app's logs. Plain output prints `<time>\t<service>\t<text>`
   * on standard output; the time is RFC 3339 as Docker wrote it, the service
   * a name held to a pattern, and the text cleaned, so it has no tab and no
   * line break that could make a field or a line of its own. A promise it
   * returns settles once the interface can take another line.
   */
  logLine(line: LogOutput): void | Promise<void>
  /**
   * Signalled once nothing reads what `logLine` writes any more, such as the
   * end of a pipe that was closed (`zekno logs | head -1`). Plain output only.
   */
  outputClosed?: AbortSignal
  /** Machine-readable output, exactly one JSON object. */
  json(value: unknown): void
  /**
   * One line that came from a server: what a runner, Docker or SSH wrote on
   * standard error, or Docker's output during a deploy. Already cleaned. It
   * is drawn after `REMOTE_MARK`, which none of zekno's own lines start with,
   * so a server cannot pass its text off as zekno's. A promise it returns
   * settles once the interface can take another line; until then the caller
   * holds back.
   */
  remote(line: string): void | Promise<void>
  /**
   * Runs work while showing that it is in progress. Pass `quiet` when the
   * work may write to the terminal itself, such as SSH asking for a
   * password: the label is then drawn once and nothing is animated over it.
   * Either way it is gone once the work ends.
   */
  step<T>(
    label: string,
    work: () => Promise<T>,
    options?: { quiet?: boolean }
  ): Promise<T>
  /** Reads a secret value: hidden at a terminal, or everything on standard input. */
  askSecret(question: string, fromStdin: boolean): Promise<string>
  /**
   * Asks a yes-or-no question at a terminal and resolves with the answer; no
   * is the default. Without a terminal it throws `refusal`: a command never
   * asks where nobody can answer, and never takes yes for granted. Esc and
   * Ctrl-C answer no, unless `leave` is given: then they throw `Left`.
   */
  confirm(
    question: string,
    refusal: string,
    options?: { leave?: boolean }
  ): Promise<boolean>
  /**
   * Whether this interface can ask a person anything: true only at a
   * terminal (`wantsPlain` false and the input a terminal). Every question
   * below is reached only from code that checked this first; when it is
   * false a command takes exactly the path it took before questions existed.
   */
  readonly asks: boolean
  /**
   * Asks the person to pick one row of a list, and resolves with that row's
   * value. Esc and Ctrl-C throw `Left`. The plain interface throws
   * `question.missing`.
   */
  choose<T>(question: ListQuestion<T>): Promise<T>
  /**
   * Asks for a one-line answer, checked with `question.check` where it is
   * typed: a wrong one is asked again with its reason. Esc and Ctrl-C throw
   * `Left`. The plain interface throws `question.missing`.
   */
  ask(question: TypedQuestion): Promise<string>
  /**
   * A hidden value that may be skipped (the first deploy's values): nothing
   * of it is drawn. Resolves with the value, or undefined when Esc skips it.
   * An empty value or one of several lines is refused and asked again. Ctrl-C
   * throws `Left`. `name` is the secret's name, for the sentence that says how
   * to set a value of several lines. The plain interface throws, as
   * `askSecret` does without `--stdin`.
   */
  askValue(question: string, name: string): Promise<string | undefined>
  /**
   * A code and what it is for, such as the team code a first deploy shows:
   * the code in bold, after its label, and the text under it.
   */
  code(label: string, value: string, about: string): void
  /** Labelled lines, the text of each in a column of its own, such as the groups of an import. */
  groups(rows: readonly (readonly [label: string, text: string])[]): void
  /** One empty line between blocks at a terminal. Nothing in plain output. */
  gap(): void
  /**
   * `zekno doctor`'s report, once every check is done (contracts/doctor.md):
   * at a terminal the sections, marks and next steps of mock-up 5; in plain
   * output one line per check, its cells separated by tabs, then the last line.
   */
  doctorReport(report: DoctorReport): void
  /**
   * `zekno settings`' report (specs/010-app-settings, contracts/commands.md):
   * at a terminal the first line, each service and its rows in sections, the
   * marks of what changed since this machine's last deploy, as the board
   * `CmdSettings` draws them, and the note (SH3) as a warning after them; in
   * plain output one line per setting that is set (`report.piped`), its
   * cells separated by tabs, and the note on standard error.
   */
  settingsReport(report: SettingsReport): void
  /** Finishes drawing. Call once, before the process exits. */
  close(): Promise<void>
}
