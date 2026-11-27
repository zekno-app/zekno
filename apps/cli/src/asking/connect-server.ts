/**
 * The server of `zekno deploy` at a terminal (specs/006-cli-small-features,
 * contracts/first-deploy.md, mock-up 3): the words of the server questions
 * and of the server code, and the step that adds the server as `zekno
 * server add --ssh` does. Split from first-deploy.ts, which asks the
 * questions and re-exports the words (specs/016-build-from-source,
 * contracts/cli.md CL14).
 */
import { remoteThroughUi, type Deps } from "../cli/context"
import { SSH_IDENTITY } from "../commands/server"
import {
  addServer,
  foundDetail,
  prepareServerAdd,
  runnerWarning,
} from "../ops/server"
import { profileStore } from "../profile/profile"
import type { InstallEvent } from "../server/install/lines"
import { megabytes } from "../shared/sizes"
import { RUNNER_RELEASE } from "../version/runner-release"

/** F3: what the server code is for (mock-up 3, the app's words). */
export const SERVER_CODE_ABOUT =
  "Identifies this server's key. Teammates compare it before they trust the server."

/** A7: why an SSH destination is refused, as `prepareServerAdd` says it. */
export const DESTINATION_RULE =
  "That SSH destination is not valid. Use the form user@host."

/** A8: why a server's name is refused, as `prepareServerAdd` says it. */
export const SERVER_NAME_RULE =
  "Give the server a name of lowercase letters, digits and hyphens."
export const serverTaken = (name: string): string =>
  `A server named "${name}" is already connected.`

/** Whether the profile now names a server `name`: an `addServer` that failed after it wrote the profile has made it. */
function inProfile(home: string, name: string): boolean {
  try {
    return profileStore(home)
      .load()
      .servers.some((server) => server.name === name)
  } catch {
    return false
  }
}

/**
 * Adds the server as `zekno server add --ssh` does (FR-012): the same plan,
 * the same installer and checks, inside a quiet step so SSH can ask for a
 * password or a host key on the terminal. The installer's steps are drawn as
 * they arrive, then the server code, where the server's identity rests, and a
 * runner of another version, as `server add` says them. `madeIt` is called
 * once the profile names the server, also when what follows then fails.
 */
export async function connectServer(
  deps: Deps,
  name: string,
  destination: string,
  madeIt: () => void
): Promise<void> {
  const { ui } = deps
  const plan = await prepareServerAdd(deps, name, { ssh: destination })
  const carried = (deps.release ?? RUNNER_RELEASE).version
  let bytes: number | undefined
  const installed = (event: InstallEvent) => {
    if (event.kind === "connected") ui.success("Connected over SSH")
    else if (event.kind === "docker") ui.success("Docker with Compose found")
    else if (event.kind === "runner")
      ui.success("Runner found", foundDetail(event.version, carried))
    else if (event.kind === "download") bytes = event.bytes
    else if (event.kind === "install")
      ui.success(
        "Runner installed",
        `${bytes === undefined ? "" : `${megabytes(bytes)}, `}checksum verified`
      )
  }
  let result
  try {
    result = await ui.step(
      `Connecting ${plan.name}`,
      () =>
        addServer(remoteThroughUi(deps), plan, {
          install: installed,
          stage: (stage) => {
            if (stage === "added")
              ui.success(`Added ${plan.name} to the signed team list`)
          },
          resumed: () =>
            ui.info(
              "The runner was already set up for your team by an earlier attempt. Carrying on from there."
            ),
          detail: (line) => ui.remote(line),
        }),
      { quiet: true }
    )
  } catch (error) {
    // Setup done and the team list written, then the runner did not take it (`sync`): the server is in the profile, as `server add` leaves it.
    if (inProfile(deps.home, plan.name)) madeIt()
    throw error
  }
  madeIt()
  ui.code("Server code", result.code, SERVER_CODE_ABOUT)
  ui.note(SSH_IDENTITY)
  // A runner of another version than this zekno's is said once, as `server add` says it.
  const warning =
    result.relation &&
    runnerWarning(result.name, result.runner?.version, result.relation, carried)
  if (warning) ui.warn(warning)
}
