/** The app screen (board "One app: deploys and secrets"): its deploys and its secrets, and what each key does there. */
import { applySelectKey, clampIndex } from "../../ui/parts/select"
import type { AppKey } from "../keys"
import type { Step } from "./events"
import { listKey } from "./input"
import { openLogs } from "./logs"
import { setSecretScreen } from "./set-secret"
import { go, push, replaceTop, stay } from "./steps"
import type { Screen, State } from "./types"

type AppScreen = Extract<Screen, { name: "app" }>

/** The app screen's data, when it has been read for that app. */
export function appViewOf(state: State, screen: AppScreen) {
  const view = state.appView
  return view?.server === screen.server && view.app === screen.app ? view : undefined
}

export const openApp = (state: State, server: string, app: string): Step =>
  push(state, { name: "app", server, app, pane: "deploys", deploy: 0, secret: 0 }, { kind: "open-app", server, app })

export function onApp(state: State, screen: AppScreen, key: AppKey): Step | undefined {
  const view = appViewOf(state, screen)
  const deploys = view?.deploys ?? []
  const secrets = view?.secrets ?? []

  if (key.kind === "left") return stay(replaceTop(state, { ...screen, pane: "deploys" }))
  if (key.kind === "right") return stay(replaceTop(state, { ...screen, pane: "secrets" }))
  if (key.kind === "tab") return stay(replaceTop(state, { ...screen, pane: screen.pane === "deploys" ? "secrets" : "deploys" }))

  if (key.kind === "up" || key.kind === "down" || key.kind === "enter") {
    if (screen.pane === "deploys") {
      const moved = applySelectKey(screen.deploy, deploys.length, listKey(key))
      return moved.kind === "moved" ? stay(replaceTop(state, { ...screen, deploy: moved.index })) : stay(state)
    }
    // The last row is "+ set a secret".
    const moved = applySelectKey(screen.secret, secrets.length + 1, listKey(key))
    if (moved.kind === "moved") return stay(replaceTop(state, { ...screen, secret: moved.index }))
    if (moved.kind === "chosen") {
      const secret = secrets[moved.index]
      // A value is never shown, only set again: Enter on a secret asks for its new value.
      const asking = setSecretScreen(screen.server, screen.app)
      return push(state, secret ? { ...asking, secretName: secret.name, question: "value" } : asking)
    }
    return stay(state)
  }

  if (key.kind !== "text") return undefined
  switch (key.text) {
    case "d":
      return state.deploy?.running ? stay(state) : go(state, { kind: "deploy", server: screen.server, app: screen.app })
    case "r": {
      const selected = deploys[clampIndex(screen.deploy, deploys.length)]
      if (!selected || state.deploy?.running) return stay(state)
      return go(state, { kind: "rollback", server: screen.server, app: screen.app, to: selected.sequence })
    }
    case "l":
      return openLogs(state, screen.server, screen.app)
    case "s":
      return push(state, setSecretScreen(screen.server, screen.app))
    case "x": {
      const secret = screen.pane === "secrets" ? secrets[screen.secret] : undefined
      if (!secret || secret.removed) return stay(state)
      return stay({ ...state, question: { kind: "remove-secret", server: screen.server, app: screen.app, name: secret.name } })
    }
  }
  return undefined
}
