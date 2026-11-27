/**
 * How the stand-in's plan writes `sh` (specs/016-build-from-source,
 * research/map-checks.md part 6): one argument quoted so `sh` reads it
 * back unchanged, and a script run in a container as one exact argument
 * list, with no file copied in.
 */

/** `text` in single quotes, as `sh` reads it back. */
export const q = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`

/** `docker exec <container> sh -c <script>`, the script stopping at its first failure. */
export function inContainer(
  container: string,
  lines: readonly string[]
): string[] {
  return [
    "docker",
    "exec",
    container,
    "sh",
    "-c",
    ["set -eu", ...lines].join("\n"),
  ]
}
