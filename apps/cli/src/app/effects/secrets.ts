/**
 * Secrets from the app: a value typed in the hidden prompt is stored, and a
 * secret is removed once its question was answered. Each takes effect on the
 * next deploy.
 */
import { prepareSecretSet, removeSecret, setSecret } from "../../ops/secret"
import { locateServer } from "../../ops/status"
import type { Effect } from "../state/events"
import { reasonOf, type Context } from "./context"

/**
 * Stores a value typed in the hidden prompt, then says so with
 * `secret-saved`, or why not with `secret-refused`. The value goes to the
 * secret operation and nowhere else: not into an event, a line or the state.
 */
export async function saveSecret(
  context: Context,
  where: { server: string; app: string; name: string },
  value: string
): Promise<void> {
  const { dispatch, fail, ops, refresh } = context
  try {
    const planned = await prepareSecretSet(ops, where.name, {
      app: where.app,
      server: where.server,
    })
    const set = await setSecret(planned, value)
    dispatch({
      type: "secret-saved",
      notice: {
        tone: "success",
        text: `Set ${set.name}, version ${set.version}, for ${set.app} on ${set.server}. It takes effect on the next deploy.`,
      },
    })
    refresh(planned.team, planned.server, planned.app)
  } catch (error) {
    // The operation's sentences never quote the value.
    const reason = reasonOf(error)
    if (reason === undefined) return fail(error)
    dispatch({
      type: "secret-refused",
      notice: { tone: "error", text: reason },
    })
  }
}

/** Removes the secret `x` chose on the app screen, once its question was answered yes. */
export async function removeChosenSecret(
  context: Context,
  effect: Extract<Effect, { kind: "remove-secret" }>
): Promise<void> {
  const { ops, notice, refresh } = context
  const removed = await removeSecret(ops, effect.name, {
    app: effect.app,
    server: effect.server,
  })
  notice(
    "success",
    `Removed ${removed.name} from ${removed.app} on ${removed.server}. It takes effect on the next deploy.`
  )
  const { team, server } = await locateServer(ops, effect.server)
  refresh(team, server, effect.app)
}
