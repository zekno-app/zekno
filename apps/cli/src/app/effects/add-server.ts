/**
 * Adding a server from the app, each step as an event, and the session it
 * was added over kept for the reads that follow.
 */
import { openTeam, type Team } from "../../cli/context"
import { addServer, foundDetail, prepareServerAdd } from "../../ops/server"
import type { InstallEvent } from "../../server/install/lines"
import { megabytes } from "../../shared/sizes"
import { seconds } from "../../shared/time"
import type { Effect } from "../state/events"
import type { AddStepName } from "../state/types"
import { routeErrorLines, type Context } from "./context"
import { teamView } from "./profile"
import { relationOf, runnerRow, type Servers } from "./servers"

/**
 * Typed as the SSH destination in "add a server", it adds the runner on this
 * machine instead, for trying zekno out. It is how Home names such a server,
 * and it can never be an SSH destination (it has a space).
 */
export const THIS_MACHINE = "this machine"

/** Adding servers, one at a time. */
export function createAdding(context: Context, servers: Servers) {
  const { deps, dispatch, fail, purposeful, ops, remember, carried, notice } =
    context

  /** One server added at a time, so two never take the same name or race on the team list. */
  let adding = false

  /**
   * Adds a server from the app, each step as an event: over SSH the
   * installer checks Docker and finds or installs the runner, then the
   * runner is set up and the server added to the signed team list. What the
   * server prints on standard error while it is added is kept for `o`.
   *
   * The session it was added over is then kept as the server's session for
   * the reads that follow (`adopt`), as the one opened when the app starts:
   * where SSH asked for a password to add it, it does not ask again, and a
   * read in the background, which never asks, finds the session open.
   */
  async function add(
    effect: Extract<Effect, { kind: "add-server" }>
  ): Promise<void> {
    // The reducer reopens a running one rather than starting another; this holds even if it did not.
    if (adding)
      return notice(
        "info",
        "A server is already being added. Wait for it to finish."
      )
    adding = true
    try {
      const local = effect.destination === THIS_MACHINE
      // Once the server is added, what its kept session's runner writes is shown as any other runner's.
      let added = false
      const lines = routeErrorLines(purposeful, (line) =>
        dispatch(
          added ? { type: "runner-line", line } : { type: "add-line", line }
        )
      )
      const plan = await prepareServerAdd(
        lines,
        effect.name,
        local ? { local: true } : { ssh: effect.destination }
      )
      const started = Date.now()
      dispatch({
        type: "add-started",
        destination: local ? THIS_MACHINE : effect.destination,
        name: plan.name,
        local,
      })
      const step = (name: AddStepName, detail?: string, found?: boolean) =>
        dispatch({ type: "add-step", step: name, detail, found })
      let bytes: number | undefined
      let resumed = false
      const installed = (event: InstallEvent) => {
        if (event.kind === "docker")
          step("docker", event.version ? `v${event.version}` : undefined)
        else if (event.kind === "runner")
          step("runner", foundDetail(event.version, carried), true)
        else if (event.kind === "download") bytes = event.bytes
        else if (event.kind === "install")
          step(
            "runner",
            `${bytes === undefined ? "" : `${megabytes(bytes)}, `}checksum verified`
          )
      }
      // Stops the session at once when the app closes on a signal, also once it is kept.
      const stop = new AbortController()
      const result = await addServer(
        lines,
        plan,
        {
          stage(stage) {
            if (stage === "connected")
              step("connect", local ? undefined : seconds(Date.now() - started))
            else if (stage === "set_up")
              step(
                "set_up",
                resumed ? "carried on from an earlier attempt" : undefined
              )
            else step("added")
          },
          install: installed,
          detail: (line) => dispatch({ type: "add-line", line }),
          resumed: () => (resumed = true),
          code: (code) => dispatch({ type: "add-code", code }),
        },
        { keep: true, signal: stop.signal }
      )
      added = true
      let team: Team
      try {
        team = await openTeam(ops)
      } catch (error) {
        void result.session?.close()
        throw error
      }
      remember(team)
      const relation = relationOf(
        result.target,
        result.mode,
        result.runner,
        carried
      )
      const runner = runnerRow(result.runner, relation)
      // This line says a newer runner, so its first read does not say it again.
      if (relation?.relation === "newer") servers.toldNewer.add(result.name)
      // The code is in the screen's panel; the reducer adds it to this line only when that screen was left before it was done.
      const text =
        relation?.relation === "older"
          ? `Connected ${result.name}. Its runner is older than this zekno: deploys work, and u updates it.`
          : relation?.relation === "newer"
            ? `Connected ${result.name}. Its runner is newer than this zekno: update zekno to match it.`
            : `Connected ${result.name} and added it to the signed team list.`
      dispatch({
        type: "server-added",
        team: teamView(team, deps.home),
        notice: {
          tone:
            relation === undefined || relation.relation === "same"
              ? "success"
              : "warning",
          text,
        },
        code: result.code,
      })
      dispatch({
        type: "server-reached",
        server: result.name,
        reachable: true,
        runner,
      })
      // Read over in the background: another server can be added meanwhile.
      const server = team.profile.servers.find(
        (entry) => entry.name === result.name
      )
      if (result.session && server)
        void servers.adopt(team, server, result.session, stop).catch(fail)
      else void result.session?.close()
    } finally {
      adding = false
    }
  }

  return { add }
}
