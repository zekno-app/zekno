import type { DeployStart, DeployView } from "./deploy"

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
export type MarkedCell = { text: string; mark: string; tone: "success" | "danger" | "warning" | "quiet" }
/**
 * A cell with a look of its own at a terminal: `strong` bold, `plain` the
 * text colour, `quiet` faint. Plain output prints `text`. A terminal draws
 * `terminal` instead when it is given, for words only a person reading
 * needs, such as "version 1, not deployed yet" where plain output keeps
 * "version 1".
 */
export type StyledCell = { text: string; style: "strong" | "plain" | "quiet"; terminal?: string }
export type Cell = string | MarkedCell | StyledCell

/** The words of a cell, as plain output prints them. */
export const cellText = (cell: Cell): string => (typeof cell === "string" ? cell : cell.text)

/** A bold cell at a terminal. */
export const strong = (text: string): StyledCell => ({ text, style: "strong" })
/** A faint cell at a terminal. */
export const quiet = (text: string, terminal?: string): StyledCell => (terminal === undefined ? { text, style: "quiet" } : { text, style: "quiet", terminal })
/** A cell in the terminal's text colour, where a table would make it faint. */
export const plainCell = (text: string): StyledCell => ({ text, style: "plain" })

/** One line of an app's logs, as `zekno logs` prints it. Each part is already cleaned or held to a pattern. */
export type LogOutput = { time: string; service: string; text: string }

/**
 * How commands talk to the person. Commands say what happened; a Ui decides
 * how it looks. At a terminal that is Ink; when output is piped, in scripts
 * and in tests it is plain lines.
 */
export interface Ui {
  info(text: string): void
  success(text: string): void
  /** Something the person should notice. Goes to standard error in plain output. */
  warn(text: string): void
  /** Why a command failed. Goes to standard error in plain output. */
  error(text: string): void
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
  step<T>(label: string, work: () => Promise<T>, options?: { quiet?: boolean }): Promise<T>
  /** Reads a secret value: hidden at a terminal, or everything on standard input. */
  askSecret(question: string, fromStdin: boolean): Promise<string>
  /**
   * Asks a yes-or-no question at a terminal and resolves with the answer; no
   * is the default. Without a terminal it throws `refusal`: a command never
   * asks where nobody can answer, and never takes yes for granted.
   */
  confirm(question: string, refusal: string): Promise<boolean>
  /** Finishes drawing. Call once, before the process exits. */
  close(): Promise<void>
}
