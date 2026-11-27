/**
 * What a build's steps printed, read from buildx's `--progress=rawjson`
 * (specs/016-build-from-source, T015 to T018): each line buildx writes on
 * standard error is one JSON status, and its `logs` carry the steps' output
 * in base64. Pure. `builder-output.ts` reads the same lines for the first
 * error; this file reads what the steps themselves printed, which a check
 * looks into and never prints.
 */

/** The steps' output, decoded and joined in the order buildx printed it. */
export function stepOutput(stderr: string): string {
  let text = ""
  for (const line of stderr.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("{")) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const logs = (parsed as { logs?: unknown } | null)?.logs
    if (!Array.isArray(logs)) continue
    for (const log of logs as { data?: unknown }[])
      if (typeof log?.data === "string")
        text += Buffer.from(log.data, "base64").toString("utf8")
  }
  return text
}

/**
 * The lines printed between a line `begin` and a line `end` (or the end of
 * the output); undefined when no line is `begin`.
 */
export function linesBetween(
  output: string,
  begin: string,
  end: string
): string[] | undefined {
  const lines = output.split("\n").map((line) => line.replace(/\r$/, ""))
  const from = lines.indexOf(begin)
  if (from === -1) return undefined
  const rest = lines.slice(from + 1)
  const to = rest.indexOf(end)
  return (to === -1 ? rest : rest.slice(0, to)).filter((line) => line !== "")
}

/** The word a record says in place of a value it must not show. */
export const HIDDEN = "<hidden>"

/**
 * `text` with each of `values` replaced by `<hidden>`, so that nothing a
 * check prints or throws holds a secret or a marker it looks for.
 */
export function hide(text: string, values: readonly string[]): string {
  let shown = text
  for (const value of [...values].sort((a, b) => b.length - a.length))
    if (value !== "") shown = shown.replaceAll(value, HIDDEN)
  return shown
}
