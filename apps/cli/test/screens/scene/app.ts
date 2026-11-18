/**
 * The full-screen app in the example world: the reducer, the effects against
 * the stand-in server, and the window drawn as a terminal that shows every
 * colour receives it, as test/app/app-operate.test.tsx opens it. The
 * recipe's process was started with FORCE_COLOR=3, so Ink writes the
 * colours.
 */
import { renderToString } from "ink"
import { createElement } from "react"

import { waitFor } from "../../../../runner/test/support/helpers"
import { AppView, createStore } from "../../../src/app/app"
import { createEffects, type Effects } from "../../../src/app/effects/effects"
import { loadStart } from "../../../src/app/effects/profile"
import type { AppKey } from "../../../src/app/keys"
import { initialState } from "../../../src/app/state/state"
import type { State } from "../../../src/app/state/types"
import { rowsOf, type Row } from "../format"
import type { World } from "./server"

/** The window as the app draws `state`, `columns` by `rows`, every row kept, empty ones included. */
export function window(state: State, columns: number, rows: number): Row[] {
  const text = renderToString(
    createElement(AppView, { state, columns, rows }),
    {
      columns,
    }
  )
  const lines = rowsOf(text)
  if (lines.length > rows)
    throw new Error(`The app drew ${lines.length} rows in a window of ${rows}`)
  while (lines.length < rows) lines.push([])
  return lines
}

/**
 * Opens the app on `world`'s machine at `columns` by `rows`, with `ssh`
 * meaning the stand-in for as long as `work` runs, and closes it after.
 * Whatever the effects report as a failure is thrown.
 */
export async function inApp<T>(
  world: World,
  size: { columns: number; rows: number },
  work: (app: OpenApp) => Promise<T>
): Promise<T> {
  return world.inSsh(async () => {
    const failures: unknown[] = []
    let effects: Effects | undefined
    const store = createStore(
      initialState(await loadStart(world.m.deps), size),
      (effect) => {
        if (effect.kind !== "exit") effects!.run(effect)
      }
    )
    effects = createEffects(world.m.deps, store.dispatch, (error) =>
      failures.push(error)
    )
    const app = {
      store,
      effects,
      get state() {
        return store.get()
      },
      press: (...keys: AppKey[]) =>
        keys.forEach((key) => store.dispatch({ type: "key", key })),
      type: (text: string) =>
        [...text].forEach((char) =>
          store.dispatch({ type: "key", key: { kind: "text", text: char } })
        ),
      until: (ready: () => boolean, what: string) =>
        waitFor(ready, what, 20_000),
    }
    try {
      const result = await work(app)
      if (failures.length > 0) throw failures[0]
      return result
    } finally {
      await effects.close()
    }
  })
}

export type OpenApp = {
  store: ReturnType<typeof createStore>
  effects: Effects
  readonly state: State
  press: (...keys: AppKey[]) => void
  type: (text: string) => void
  until: (ready: () => boolean, what: string) => Promise<void>
}

/** Waits until every server on Home has answered and `app` on `server` shows as running. */
export async function homeRead(app: OpenApp, server: string, name: string) {
  await app.effects.checkServers()
  app.store.dispatch({ type: "tick" })
  await app.until(() => {
    const row = app.state.team?.servers.find((entry) => entry.name === server)
    return (
      row?.reachable === true &&
      row.apps.find((entry) => entry.name === name)?.state === "running"
    )
  }, `${name} on ${server} to show as running`)
}
