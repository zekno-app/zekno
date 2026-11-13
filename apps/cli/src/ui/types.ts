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
  table(rows: string[][]): void
  /** Machine-readable output, exactly one JSON object. */
  json(value: unknown): void
  /**
   * Runs work while showing that it is in progress. Pass `quiet` when the
   * work may write to the terminal itself, such as SSH asking for a
   * password: the label is then printed once and nothing is animated over it.
   */
  step<T>(label: string, work: () => Promise<T>, options?: { quiet?: boolean }): Promise<T>
  /** Reads a secret value: hidden at a terminal, or everything on standard input. */
  askSecret(question: string, fromStdin: boolean): Promise<string>
  /** Finishes drawing. Call once, before the process exits. */
  close(): Promise<void>
}
