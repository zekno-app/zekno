/**
 * Files a check writes and reads in the Linux stand-in
 * (specs/016-build-from-source, T015 and T016): the client's
 * `config.json`, a policy file outside the pack. The text travels on
 * standard input or output, never in an argument, and an error names the
 * file, never its text. Every command runs in the stand-in, through
 * `gate.ts`.
 */
import { firstLine } from "../host/host-lists"
import type { InStandIn } from "./rb7"

const PATH = /^\/[A-Za-z0-9._/-]+$/

function checkedPath(path: string): string {
  if (!PATH.test(path) || path.split("/").includes(".."))
    throw new Error(`${JSON.stringify(path)} is not a plain absolute path`)
  return path
}

/** Writes `text` whole: its folder made, the file replaced in one move, mode 0600. */
export const WRITE_SCRIPT = [
  "set -eu",
  "umask 077",
  'mkdir -p "$(dirname "$1")"',
  'cat > "$1.zekno-part"',
  'mv -f "$1.zekno-part" "$1"',
].join("\n")

/** Prints the file, or ends with status 3 when there is none. */
export const READ_SCRIPT = 'if [ -e "$1" ]; then exec cat "$1"; else exit 3; fi'

/** Writes `text` to `path` in the stand-in. */
export async function writeInStandIn(
  run: InStandIn,
  path: string,
  text: string
): Promise<void> {
  const answer = await run(
    ["sh", "-c", WRITE_SCRIPT, "sh", checkedPath(path)],
    {
      stdin: { text },
    }
  )
  if (answer.code !== 0)
    throw new Error(
      `writing ${path} in the stand-in failed (exit ${answer.code}): ${firstLine(answer)}`
    )
}

/** The text of `path` in the stand-in, or undefined when there is no such file. */
export async function readInStandIn(
  run: InStandIn,
  path: string
): Promise<string | undefined> {
  const answer = await run(["sh", "-c", READ_SCRIPT, "sh", checkedPath(path)])
  if (answer.code === 3) return undefined
  if (answer.code !== 0)
    throw new Error(
      `reading ${path} in the stand-in failed (exit ${answer.code}): ${answer.stderr.trim().split("\n")[0] ?? ""}`
    )
  return answer.stdout
}

/** Removes `path` in the stand-in; one that is not there is no fault. */
export async function removeInStandIn(
  run: InStandIn,
  path: string
): Promise<void> {
  const answer = await run(["rm", "-f", "--", checkedPath(path)])
  if (answer.code !== 0)
    throw new Error(
      `removing ${path} in the stand-in failed (exit ${answer.code}): ${firstLine(answer)}`
    )
}
