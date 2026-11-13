/**
 * The full-screen app: `zekno` with no arguments at a terminal. It draws in
 * the terminal's alternate screen, so the person's terminal is as they left
 * it when the app closes, and restores the terminal on every way out: `q`,
 * Ctrl-C, an error inside the app, and a signal.
 */
import { Box, render, Text, useInput, useWindowSize, type Instance } from "ink"
import { constants } from "node:os"
import { useEffect, useSyncExternalStore } from "react"

import { Spinner } from "../ui/stages"
import { ThemeProvider, themeFor, type Background } from "../ui/theme"
import { createEffects, type AppDeps } from "./effects"
import { NoticeLine } from "./frame"
import { toAppKey } from "./keys"
import { HelpScreen } from "./screens/help"
import { Placeholder } from "./screens/placeholder"
import { ProfileErrorScreen } from "./screens/profile-error"
import { TooSmall } from "./screens/too-small"
import { initialState, MIN_COLUMNS, MIN_ROWS, top, update, type AppEvent, type Effect, type State } from "./state"

/** Holds the state, runs the reducer for each event and hands its effects on. */
export function createStore(initial: State, run: (effect: Effect) => void) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    dispatch(event: AppEvent) {
      const step = update(state, event)
      state = step.state
      listeners.forEach((listener) => listener())
      step.effects.forEach(run)
    },
  }
}
export type Store = ReturnType<typeof createStore>

/** The line above the key hints: waiting for a deploy before closing, or a line about something done elsewhere. */
function Status({ state }: { state: State }) {
  if (state.quitting) {
    const which = state.deploy?.sequence === undefined ? "the deploy" : `deploy ${state.deploy.sequence}`
    return (
      <Text>
        <Spinner /> waiting for {which} to finish
      </Text>
    )
  }
  return state.notice ? <NoticeLine notice={state.notice} /> : null
}

/** The screen on top of the stack, or the "too small" message in its place. */
export function Screen({ state, columns, rows }: { state: State; columns: number; rows: number }) {
  if (columns < MIN_COLUMNS || rows < MIN_ROWS) return <TooSmall columns={columns} rows={rows} />
  const screen = top(state)
  const status = <Status state={state} />
  switch (screen.name) {
    case "help":
      return <HelpScreen columns={columns} status={status} />
    case "profile-error":
      return <ProfileErrorScreen reason={screen.reason} folder={screen.folder} />
    default:
      return <Placeholder state={state} screen={screen} status={status} />
  }
}

/** The whole window: one column of margin each side, and the screen. */
export function AppView({ state, columns, rows }: { state: State; columns: number; rows: number }) {
  return (
    <Box flexDirection="column" width={columns} height={rows} paddingX={1}>
      <Screen state={state} columns={columns} rows={rows} />
    </Box>
  )
}

function App({ store }: { store: Store }) {
  const state = useSyncExternalStore(store.subscribe, store.get)
  const { columns, rows } = useWindowSize()
  useEffect(() => store.dispatch({ type: "resize", columns, rows }), [store, columns, rows])
  useInput((input, key) => {
    const appKey = toAppKey(input, key)
    if (appKey) store.dispatch({ type: "key", key: appKey })
  })
  return <AppView state={state} columns={columns} rows={rows} />
}

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const

/** Raw mode off, whatever state Ink was left in. Ink does this too; this is for the ways out Ink does not see. */
function restoreInput(stdin: NodeJS.ReadStream): void {
  try {
    if (stdin.isTTY) stdin.setRawMode(false)
  } catch {
    // The terminal has gone. There is nothing to restore.
  }
}

export type AppOptions = {
  /** What the app starts on: effects.ts `loadStart`. */
  start: Parameters<typeof initialState>[0]
  background: Background
  stdin?: NodeJS.ReadStream
  stdout?: NodeJS.WriteStream
}

/**
 * Opens the app and resolves with the exit status once it has closed and the
 * terminal is restored. Rejects with the error when the app failed; the
 * terminal is restored first in that case too.
 */
export function openApp(deps: AppDeps, options: AppOptions): Promise<number> {
  const stdin = options.stdin ?? process.stdin
  const stdout = options.stdout ?? process.stdout
  let instance: Instance | undefined
  let failure: { error: unknown } | undefined

  const close = () => instance?.unmount()
  const fail = (error: unknown) => {
    failure ??= { error }
    close()
    restoreInput(stdin)
  }
  // A signal ends the app at once. The terminal is restored first.
  const onSignal = (signal: (typeof SIGNALS)[number]) => {
    close()
    restoreInput(stdin)
    process.exit(128 + constants.signals[signal])
  }
  const onCrash = (error: unknown) => fail(error)

  const effects = createEffects(deps, (event) => store.dispatch(event), fail)
  const size = { columns: stdout.columns || MIN_COLUMNS, rows: stdout.rows || MIN_ROWS }
  const store = createStore(initialState(options.start, size), (effect) => (effect.kind === "exit" ? close() : effects.run(effect)))

  for (const signal of SIGNALS) process.on(signal, onSignal)
  process.on("uncaughtException", onCrash)
  process.on("unhandledRejection", onCrash)
  const cleanUp = () => {
    for (const signal of SIGNALS) process.off(signal, onSignal)
    process.off("uncaughtException", onCrash)
    process.off("unhandledRejection", onCrash)
    restoreInput(stdin)
  }

  try {
    instance = render(
      <ThemeProvider value={themeFor(options.background)}>
        <App store={store} />
      </ThemeProvider>,
      // Ctrl-C is a key like any other here: it quits, but waits for a deploy in progress.
      { stdin, stdout, alternateScreen: true, exitOnCtrlC: false }
    )
  } catch (error) {
    cleanUp()
    return Promise.reject(error)
  }

  return instance.waitUntilExit().then(
    () => {
      cleanUp()
      if (failure) throw failure.error
      return 0
    },
    (error: unknown) => {
      cleanUp()
      throw failure ? failure.error : error
    }
  )
}
