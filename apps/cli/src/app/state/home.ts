/** Home (board "Home"): the servers and their apps, and what each key does there. */
import { applySelectKey } from "../../ui/parts/select"
import type { AppKey } from "../keys"
import { openAddServer } from "./add-server"
import { openApp } from "./app"
import type { Step } from "./events"
import { listKey } from "./input"
import { openLogs } from "./logs"
import { setSecretScreen } from "./set-secret"
import { go, push, replaceTop, stay } from "./steps"
import type { AppRow, Screen, ServerRow, State } from "./types"

type HomeScreen = Extract<Screen, { name: "home" }>

/** The selected server on Home, if there is one. */
export function selectedServer(state: State, screen: HomeScreen): ServerRow | undefined {
  return state.team?.servers[screen.server]
}

/** The selected app on Home, if there is one. */
export function selectedApp(state: State, screen: HomeScreen): AppRow | undefined {
  return selectedServer(state, screen)?.apps[screen.app]
}

export function onHome(state: State, screen: HomeScreen, key: AppKey): Step | undefined {
  const servers = state.team?.servers ?? []
  const server = selectedServer(state, screen)
  const app = selectedApp(state, screen)

  if (key.kind === "left") return stay(replaceTop(state, { ...screen, pane: "servers" }))
  if (key.kind === "right") return stay(replaceTop(state, { ...screen, pane: "apps" }))
  if (key.kind === "tab") return stay(replaceTop(state, { ...screen, pane: screen.pane === "servers" ? "apps" : "servers" }))

  if (key.kind === "up" || key.kind === "down" || key.kind === "enter") {
    if (screen.pane === "servers") {
      // The last row is "+ add a server".
      const moved = applySelectKey(screen.server, servers.length + 1, listKey(key))
      if (moved.kind === "moved") return stay(replaceTop(state, { ...screen, server: moved.index, app: 0 }))
      if (moved.kind === "chosen") {
        if (moved.index === servers.length) return openAddServer(state)
        // Where SSH needs an answer, enter connects on purpose: the only way SSH may ask while the app is open.
        const chosen = servers[moved.index]
        if (chosen?.asks) return go(state, { kind: "connect", server: chosen.name })
        return stay(replaceTop(state, { ...screen, pane: "apps" }))
      }
      return stay(state)
    }
    const moved = applySelectKey(screen.app, server?.apps.length ?? 0, listKey(key))
    if (moved.kind === "moved") return stay(replaceTop(state, { ...screen, app: moved.index }))
    if (moved.kind === "chosen" && server && app) return openApp(state, server.name, app.name)
    return stay(state)
  }

  if (key.kind !== "text") return undefined
  switch (key.text) {
    case "a":
      return openAddServer(state)
    case "d":
      return server && !state.deploy?.running ? go(state, { kind: "deploy", server: server.name, app: app?.name }) : stay(state)
    case "r":
      return server && app && !state.deploy?.running ? go(state, { kind: "rollback", server: server.name, app: app.name }) : stay(state)
    case "l":
      return server && app ? openLogs(state, server.name, app.name) : stay(state)
    case "s":
      return server && app ? push(state, setSecretScreen(server.name, app.name)) : stay(state)
    case "u":
      // Only an older runner is updated: a newer one is never replaced, and one of this version needs nothing.
      return server?.runner?.relation === "older" ? stay({ ...state, question: { kind: "update-runner", server: server.name } }) : stay(state)
  }
  return undefined
}
