/**
 * The gate of the Linux checks (specs/016-build-from-source, T008;
 * research/map-checks.md part 6, step 5; LC8). A check runs only in the
 * stand-in that `server.ts up` made and named in `ZEKNO_LINUX_SERVER`;
 * without the switch it prints the one line `skipLine` gives and skips. The
 * switch takes only `zekno-check-<8 lowercase letters and digits>-server`:
 * any other value is refused, never skipped, so no check runs Docker in
 * another container or on the machine's own engine.
 *
 * A command in the stand-in, `inStandIn(args)`, is `docker exec -i
 * <stand-in> ...`, run through `host-docker.ts` as every host Docker call is,
 * on the engine the run's `run.json` names (`up` read it once from the
 * host's context): a stand-in with no readable `run.json` here is refused,
 * so no check follows the shell's DOCKER_HOST or a context chosen since.
 */
import { tmpdir } from "node:os"

import {
  hostDocker,
  type Answer,
  type HostDocker,
  type RunOptions,
} from "./host/host-docker"
import { readState, runFolder } from "./stand-in/run-folder"

export const SWITCH = "ZEKNO_LINUX_SERVER"
export const STAND_IN = /^zekno-check-([a-z0-9]{8})-server$/

/** The one line a gated test prints when it skips. */
export function skipLine(what: string): string {
  if (what === "" || /[\r\n]/.test(what))
    throw new Error("a skip line names its check in one line")
  return `${what} skipped: no Linux stand-in (${SWITCH} is not set)`
}

/** The stand-in the switch names, or undefined without it; another name throws. */
export function standInOf(
  env: Readonly<Record<string, string | undefined>>
): string | undefined {
  const value = env[SWITCH]
  if (value === undefined || value === "") return undefined
  if (!STAND_IN.test(value))
    throw new Error(
      `${SWITCH} is ${JSON.stringify(value)}, not a stand-in of server.ts up (zekno-check-<8 lowercase letters and digits>-server); no check runs in another container`
    )
  return value
}

/** `docker exec -i <stand-in> <args...>`. */
export function inStandInArgs(
  standIn: string,
  args: readonly string[]
): string[] {
  if (!STAND_IN.test(standIn))
    throw new Error(
      `${JSON.stringify(standIn)} is not a stand-in of server.ts up`
    )
  if (args.length === 0) throw new Error("inStandIn needs a command")
  return ["docker", "exec", "-i", standIn, ...args]
}

export type Gate =
  | { readonly ready: false; readonly skip: string }
  | {
      readonly ready: true
      readonly standIn: string
      /** The run's id, the 8 letters and digits of its name. */
      readonly id: string
      /** Runs `args` in the stand-in through `host-docker.ts`. */
      inStandIn(args: readonly string[], options?: RunOptions): Promise<Answer>
      /** Docker's `OOMKilled` of the stand-in, read on the host (check L6): `true` or `false`. */
      oomKilled(): Promise<Answer>
    }

/** The host helper for the run `id`, on the engine its run.json in `root` names; none there throws. */
export function standInDocker(
  root: string = tmpdir()
): (id: string) => HostDocker {
  return (id) => {
    const state = readState(root, id)
    if ("reason" in state)
      throw new Error(
        `${SWITCH} names zekno-check-${id}-server, but its run.json in ${runFolder(root, id)} ${state.reason}, so the engine it runs on is not known; make the stand-in with server.ts up on this machine`
      )
    return hostDocker({ id, endpoint: state.endpoint })
  }
}

/**
 * The gate of the check `what` (an id such as `L4`): closed with its skip
 * line without the switch, open in the stand-in it names.
 */
export function gate(
  what: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  docker: (id: string) => HostDocker = standInDocker()
): Gate {
  const skip = skipLine(what)
  const standIn = standInOf(env)
  if (standIn === undefined) return { ready: false, skip }
  const id = STAND_IN.exec(standIn)![1]!
  const host = docker(id)
  return {
    ready: true,
    standIn,
    id,
    inStandIn: (args, options) =>
      host.run(inStandInArgs(standIn, args), options),
    oomKilled: () =>
      host.run([
        "docker",
        "container",
        "inspect",
        "--format",
        "{{.State.OOMKilled}}",
        standIn,
      ]),
  }
}
