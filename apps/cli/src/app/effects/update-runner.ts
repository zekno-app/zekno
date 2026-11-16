/** Replacing a server's runner from the app (`u`), after its question was answered, then reading the server again. */
import { prepareServerUpdate, updateRunner } from "../../ops/server"
import { locateServer } from "../../ops/status"
import type { Effect } from "../state/events"
import type { Context } from "./context"
import type { Servers } from "./servers"

/** Runner updates, one per server at a time. */
export function createRunnerUpdates(context: Context, servers: Servers) {
  const { dispatch, ops, remember, notice } = context

  /** The servers whose runner is being replaced, so one is never replaced twice at once. */
  const updating = new Set<string>()

  /** Replaces a server's runner, after the question was answered, then asks the server again. */
  async function update(
    effect: Extract<Effect, { kind: "update-runner" }>
  ): Promise<void> {
    if (updating.has(effect.server))
      return notice(
        "info",
        `The runner on ${effect.server} is already being updated.`
      )
    updating.add(effect.server)
    try {
      await replace(effect)
    } finally {
      updating.delete(effect.server)
    }
  }

  async function replace(
    effect: Extract<Effect, { kind: "update-runner" }>
  ): Promise<void> {
    const plan = await prepareServerUpdate(ops, effect.server)
    notice(
      "info",
      `Updating the runner on ${plan.server.name}. The server downloads it and checks it before it replaces the old one.`
    )
    const result = await updateRunner(ops, plan, {
      detail: (line) => dispatch({ type: "runner-line", line }),
    })
    notice(
      "success",
      result.updated
        ? `Updated the runner on ${result.server} to ${result.version}. It matched the checksum this zekno holds.`
        : `The runner on ${result.server} already has version ${result.version}.`
    )
    const { team, server } = await locateServer(ops, effect.server)
    remember(team)
    // The kept session still runs the old runner: a new one is opened, on purpose, and kept instead.
    servers.oneShot.delete(server.name)
    await servers.connect(team, server, true)
  }

  return { update }
}
