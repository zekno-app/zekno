/**
 * The full-screen app: `zekno` with no arguments at a terminal. It draws in
 * the terminal's alternate screen, so the person's terminal is as they left
 * it when the app closes, and restores the terminal on every way out: `q`,
 * Ctrl-C, an error inside the app, and a signal.
 */
import { Box, render, Text, useApp, useInput, useWindowSize, type Instance } from "ink"
import { constants } from "node:os"
import { useEffect, useRef, useSyncExternalStore } from "react"

import { Spinner } from "../ui/stages"
import { ThemeProvider, themeFor, type Background } from "../ui/theme"
import { createEffects, type AppDeps, type Effects } from "./effects"
import { NoticeLine } from "./frame"
import type { Terminal } from "./hand-over"
import { emptyHiddenValue, hiddenPromptKey } from "./hidden-prompt"
import { toAppKey } from "./keys"
import { AddServerScreen } from "./screens/add-server"
import { AppScreen } from "./screens/app"
import { DeployScreen } from "./screens/deploy"
import { HelpScreen } from "./screens/help"
import { HomeScreen } from "./screens/home"
import { LogsScreen } from "./screens/logs"
import { Placeholder } from "./screens/placeholder"
import { ProfileErrorScreen } from "./screens/profile-error"
import { SetSecretScreen } from "./screens/set-secret"
import { TooSmall } from "./screens/too-small"
import { WelcomeScreen } from "./screens/welcome"
import {
  hiddenPromptOpen,
  initialState,
  MIN_COLUMNS,
  MIN_ROWS,
  REFRESH_MS,
  tooSmall,
  top,
  update,
  type AppEvent,
  type Effect,
  type State,
} from "./state"

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
    case "home":
      return <HomeScreen state={state} screen={screen} columns={columns} status={status} />
    case "app":
      return <AppScreen state={state} screen={screen} columns={columns} status={status} />
    case "deploy":
      return <DeployScreen state={state} screen={screen} columns={columns} rows={rows} status={status} />
    case "set-secret":
      return <SetSecretScreen state={state} screen={screen} columns={columns} status={status} />
    case "welcome":
      return <WelcomeScreen screen={screen} columns={columns} rows={rows} status={status} />
    case "add-server":
      return <AddServerScreen state={state} screen={screen} columns={columns} rows={rows} status={status} />
    case "logs":
      return <LogsScreen state={state} screen={screen} columns={columns} rows={rows} status={status} />
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

type Suspend = ReturnType<typeof useApp>["suspendTerminal"]

/** Said on the normal screen when a line typed for SSH reached zekno instead. */
export const RETYPE = "That line reached zekno instead of SSH, and zekno threw it away. Type it again."

/**
 * The terminal as the effects hand it to SSH (hand-over.ts): Ink's own
 * suspension, once the app has drawn, with a line on the normal screen that
 * says what SSH is about to ask.
 *
 * SSH reads its answer from the same terminal as this process. Ink stops
 * listening while suspended, but a read this process had already started can
 * still take the line typed for SSH: the pseudo-terminal checks saw it in a
 * few of every hundred hand-overs. Such a line is never used: the person is
 * told at once to type it again, and it is thrown away before Ink listens
 * again, so it can never act as key presses in the app.
 */
function inkTerminal(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream) {
  let give: (suspend: Suspend) => void = () => {}
  const ready = new Promise<Suspend>((resolve) => (give = resolve))
  const terminal: Terminal = {
    async suspend(note) {
      const suspension = await (await ready)()
      stdin.pause()
      stdout.write(`\n${note}\n`)
      let told = false
      const watch = setInterval(() => {
        if (told || stdin.readableLength === 0) return
        told = true
        stdout.write(`\n${RETYPE}\n`)
      }, 100)
      return async () => {
        clearInterval(watch)
        discardInput(stdin)
        await suspension.resume()
      }
    },
  }
  return { terminal, register: (suspend: Suspend) => give(suspend) }
}

/** Throws away what this process read from the keyboard and has not used: it was typed for SSH. */
function discardInput(stdin: NodeJS.ReadStream): void {
  try {
    while (stdin.readableLength > 0 && stdin.read() !== null) {
      // Dropped, never looked at.
    }
  } catch {
    // The terminal went away. There is nothing left to throw away.
  }
}

function App({ store, effects, register }: { store: Store; effects: Effects; register: (suspend: Suspend) => void }) {
  const state = useSyncExternalStore(store.subscribe, store.get)
  const { suspendTerminal } = useApp()
  useEffect(() => register(suspendTerminal), [register, suspendTerminal])
  const { columns, rows } = useWindowSize()
  useEffect(() => store.dispatch({ type: "resize", columns, rows }), [store, columns, rows])
  // The value being typed at the hidden prompt: in this ref only, never in the state (hidden-prompt.ts).
  const hidden = useRef(emptyHiddenValue())
  const prompting = hiddenPromptOpen(state)
  useEffect(() => {
    if (!prompting) hidden.current.value = ""
  }, [prompting])
  useInput((input, key) => {
    const current = store.get()
    // The app is in raw mode the whole time it is on screen, so echo is already
    // off when the prompt is drawn. Below 80 by 24 the prompt cannot be seen and
    // takes nothing; only quitting works then.
    if (hiddenPromptOpen(current) && !tooSmall(current)) {
      hiddenPromptKey(hidden.current, input, key, current, store.dispatch, effects.saveSecret)
      return
    }
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
  /** How often what is running is read again while Home or the app screen shows. `REFRESH_MS` unless a check needs it sooner. */
  refreshMs?: number
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

  const close = () => {
    // Nothing more is read in the background, and the logs being followed are let go.
    effects.close()
    instance?.unmount()
  }
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

  // Connections over SSH are made in batch mode first; the terminal goes to SSH only when it has to ask.
  const handOver = inkTerminal(stdin, stdout)
  const effects = createEffects(deps, (event) => store.dispatch(event), fail, handOver.terminal)
  const size = { columns: stdout.columns || MIN_COLUMNS, rows: stdout.rows || MIN_ROWS }
  const store = createStore(initialState(options.start, size), (effect) => (effect.kind === "exit" ? close() : effects.run(effect)))
  // Every few seconds the reducer decides whether what is running is read again: only on Home or the app screen, with no question open.
  const refresher = setInterval(() => store.dispatch({ type: "tick" }), options.refreshMs ?? REFRESH_MS)

  for (const signal of SIGNALS) process.on(signal, onSignal)
  process.on("uncaughtException", onCrash)
  process.on("unhandledRejection", onCrash)
  const cleanUp = () => {
    clearInterval(refresher)
    effects.close()
    for (const signal of SIGNALS) process.off(signal, onSignal)
    process.off("uncaughtException", onCrash)
    process.off("unhandledRejection", onCrash)
    restoreInput(stdin)
  }

  try {
    instance = render(
      <ThemeProvider value={themeFor(options.background)}>
        <App store={store} effects={effects} register={handOver.register} />
      </ThemeProvider>,
      // Ctrl-C is a key like any other here: it quits, but waits for a deploy in progress.
      { stdin, stdout, alternateScreen: true, exitOnCtrlC: false }
    )
  } catch (error) {
    cleanUp()
    return Promise.reject(error)
  }
  // Home is drawn first; whether each server answers is filled in as it arrives (T021).
  if (options.start.kind === "team") void effects.checkServers()

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
