/**
 * `zekno logs --build [--app <app>] [--server <name>]`
 * (specs/016-build-from-source, contracts/cli.md CL9; FR-071a): the saved
 * output of an app's last build from this machine (profile/build-output.ts),
 * printed as plain lines (E16), each cleaned as it is printed, since the
 * file keeps the builder's raw text. Nothing saved: E17, exit status 1.
 *
 * It needs no keychain and no server: only the profile's list of servers,
 * for their ids. The app is `--app`, or the one a zekno.json here names when
 * this machine accepted that file byte for byte (`links.json`), so a file
 * nobody here used never chooses it. The output is saved per server:
 * `--server` chooses among the servers that hold one for that app, and
 * without it the app's latest build from this machine is printed.
 */
import type { OpDeps } from "../cli/context"
import { findServer, profileStore, type Server } from "../profile/profile"
import { readBuildOutput, type SavedBuildOutput } from "../profile/build-output"
import { isAccepted } from "../project/accepted"
import { findProject } from "../project/file"
import { sanitize } from "../server/sanitize"
import { BuildStop } from "../shared/build-lines"
import { checkApp } from "./deploy"

/** The saved output found, and where it was saved. */
export type FoundBuildOutput = {
  app: string
  server: Server
  saved: SavedBuildOutput
}

/** The app named by the zekno.json that applies here, when this machine accepted it as it is; else undefined. */
function acceptedProjectApp(home: string, cwd: string): string | undefined {
  try {
    const link = findProject(cwd)
    return link !== undefined && isAccepted(home, link) ? link.app : undefined
  } catch {
    // A file that cannot be read names no app here; `--app` still does.
    return undefined
  }
}

/**
 * The saved output `zekno logs --build` prints (CL9). The app is checked
 * with today's sentences (`checkApp`), a server `--server` names that the
 * profile does not hold with today's (`findServer`). With no saved output:
 * E17, a `BuildStop`.
 */
export function lastBuildOutput(
  deps: Pick<OpDeps, "home" | "cwd">,
  input: { app?: string; server?: string }
): FoundBuildOutput {
  const app = checkApp(input.app ?? acceptedProjectApp(deps.home, deps.cwd))
  const profile = profileStore(deps.home).load()
  const servers =
    input.server === undefined
      ? profile.servers
      : [findServer(profile, input.server)]
  let found: FoundBuildOutput | undefined
  for (const server of servers) {
    const saved = readBuildOutput(deps.home, server.serverId, app)
    // The latest build from this machine, by the time its deploy was signed; the first server listed on a tie.
    if (
      saved !== undefined &&
      (found === undefined || saved.head.at > found.saved.head.at)
    )
      found = { app, server, saved }
  }
  if (found === undefined) throw new BuildStop({ id: "E17", app })
  return found
}

/**
 * Prints the saved output of the app's last build (E16): each of the
 * builder's lines through `sanitize` as it is printed, so an escape
 * sequence in the file (OSC 52, OSC 8, cursor moves) is never acted on
 * (CL14). A promise `print` returns is waited for before the next line.
 */
export async function printBuildOutput(
  deps: Pick<OpDeps, "home" | "cwd">,
  input: { app?: string; server?: string },
  print: (line: string) => void | Promise<void>
): Promise<void> {
  const { saved } = lastBuildOutput(deps, input)
  for (const line of saved.lines) await print(sanitize(line))
}
