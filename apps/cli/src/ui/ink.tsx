import { Box, render, Static, Text, useInput, type RenderOptions } from "ink"
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"

import { CliError } from "../errors"
import { readStdin } from "./plain"
import { applySecretInput } from "./secret-input"
import { REMOTE_MARK, type Ui } from "./types"

type Item =
  | { id: number; kind: "info" | "success" | "warn" | "error" | "remote"; text: string }
  | { id: number; kind: "field"; label: string; value: string }
  | { id: number; kind: "table"; rows: string[][] }

type Prompt = { question: string; settle(result: { value: string } | { error: Error }): void }
/** `generation` changes when lines already drawn are let go; Static then starts afresh with what is left. */
type State = { items: Item[]; generation: number; step?: string; prompt?: Prompt }

/**
 * How many drawn lines may pile up before they are let go. Static writes a
 * line once and never again, so keeping it only costs memory, and a server
 * can send lines without end.
 */
const DRAWN_KEPT = 200

function createStore() {
  let state: State = { items: [], generation: 0 }
  /** How many items of this generation are already on the terminal. */
  let drawn = 0
  let nextId = 0
  const listeners = new Set<() => void>()
  const set = (next: Partial<State>) => {
    state = { ...state, ...next }
    listeners.forEach((listener) => listener())
  }
  return {
    get: () => state,
    set,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    add(item: Record<string, unknown>) {
      const added = { ...item, id: nextId++ } as Item
      if (drawn < DRAWN_KEPT) return set({ items: [...state.items, added] })
      // Only lines not yet drawn go on to the next Static, so none is lost and none drawn twice.
      set({ items: [...state.items.slice(drawn), added], generation: state.generation + 1 })
      drawn = 0
    },
    /** Called once a commit has written the first `count` items of `generation` to the terminal. */
    drawn(generation: number, count: number) {
      if (generation === state.generation) drawn = count
    },
  }
}

const MARK = { success: "✔", warn: "!", error: "✖" } as const
const COLOR = { success: "green", warn: "yellow", error: "red" } as const

function Line({ item }: { item: Item }) {
  if (item.kind === "field") {
    return (
      <Text>
        {"  "}
        <Text dimColor>{item.label}</Text> <Text bold>{item.value}</Text>
      </Text>
    )
  }
  if (item.kind === "table") {
    const widths = item.rows[0]?.map((_, column) => Math.max(...item.rows.map((row) => (row[column] ?? "").length))) ?? []
    return (
      <Box flexDirection="column" marginLeft={2}>
        {item.rows.map((row, index) => (
          <Text key={index}>
            {row.map((cell, column) => (
              <Text key={column} dimColor={column > 0}>
                {cell.padEnd((widths[column] ?? 0) + 2)}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
    )
  }
  if (item.kind === "info") {
    // Indented as a block, so text of several lines stays aligned with the marked lines.
    return (
      <Box marginLeft={2}>
        <Text>{item.text}</Text>
      </Box>
    )
  }
  if (item.kind === "remote") return <RemoteLine text={item.text} />
  return (
    <Box>
      <Box flexShrink={0} marginRight={1}>
        <Text color={COLOR[item.kind]}>{MARK[item.kind]}</Text>
      </Box>
      <Text>{item.text}</Text>
    </Box>
  )
}

/**
 * A line from a server: dim, after the mark. A line wider than the terminal
 * goes on under its own text, never at the left edge where zekno's marked
 * lines start, so the part after the wrap cannot pass for one of them.
 */
export function RemoteLine({ text }: { text: string }) {
  return (
    <Box>
      <Box flexShrink={0} marginRight={1}>
        <Text dimColor>{REMOTE_MARK}</Text>
      </Box>
      <Text dimColor>{text}</Text>
    </Box>
  )
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function Spinner({ label }: { label: string }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setFrame((current) => (current + 1) % FRAMES.length), 80)
    return () => clearInterval(timer)
  }, [])
  return (
    <Text>
      <Text color="cyan">{FRAMES[frame]}</Text> {label}…
    </Text>
  )
}

/** Asks for a value and shows nothing of it, not even its length. */
function SecretPrompt({ prompt }: { prompt: Prompt }) {
  // Kept out of React state: nothing is drawn from it, so nothing redraws as it grows.
  const value = useRef("")
  useInput((input, key) => {
    const next = applySecretInput(value.current, input, key)
    if (next.kind === "typing") value.current = next.value
    else if (next.kind === "done") prompt.settle({ value: next.value })
    else if (next.kind === "cancelled") prompt.settle({ error: new CliError("Cancelled.") })
    else prompt.settle({ error: new CliError(next.reason) })
  })
  return (
    <Text>
      <Text color="cyan">?</Text> {prompt.question}
      <Text dimColor>(hidden)</Text>
    </Text>
  )
}

function App({ store }: { store: ReturnType<typeof createStore> }) {
  const state = useSyncExternalStore(store.subscribe, store.get)
  // Ink writes Static's new items to the terminal as the commit ends, before this runs.
  useLayoutEffect(() => store.drawn(state.generation, state.items.length))
  return (
    <>
      <Static key={state.generation} items={state.items}>
        {(item) => <Line key={item.id} item={item} />}
      </Static>
      {state.prompt ? <SecretPrompt prompt={state.prompt} /> : state.step ? <Spinner label={state.step} /> : null}
    </>
  )
}

/**
 * The interface at a terminal: progress, a hidden prompt, aligned tables and
 * colour. Tests pass their own streams.
 */
export function inkUi(streams: Pick<RenderOptions, "stdout" | "stdin" | "stderr"> = {}): Ui {
  const store = createStore()
  // Ink is not left to act on Ctrl-C: it would close the interface and leave the
  // command waiting for an answer that never comes. While the prompt is open
  // the prompt cancels the command; the rest of the time the terminal turns
  // Ctrl-C into the usual interrupt.
  const app = render(<App store={store} />, { ...streams, exitOnCtrlC: false })
  const add = store.add

  return {
    info: (text) => add({ kind: "info", text }),
    success: (text) => add({ kind: "success", text }),
    warn: (text) => add({ kind: "warn", text }),
    error: (text) => add({ kind: "error", text }),
    field: (label, value) => add({ kind: "field", label, value }),
    table: (rows) => add({ kind: "table", rows }),
    json: (value) => add({ kind: "info", text: JSON.stringify(value) }),
    async remote(line) {
      add({ kind: "remote", text: line })
      // The next line waits until this one is on the terminal.
      await app.waitUntilRenderFlush()
    },
    async step(label, work, options) {
      if (options?.quiet) {
        add({ kind: "info", text: `${label}…` })
        return work()
      }
      store.set({ step: label })
      try {
        return await work()
      } finally {
        store.set({ step: undefined })
      }
    },
    askSecret(question, fromStdin) {
      if (fromStdin) return readStdin()
      if (!process.stdin.isTTY) {
        throw new CliError("There is no terminal to ask on. Pipe the value in and add `--stdin`.")
      }
      // Echo goes off before the question is drawn, not a moment after: nobody
      // should be able to start typing at a prompt that still shows what is typed.
      process.stdin.setRawMode(true)
      return new Promise<string>((resolve, reject) => {
        store.set({
          prompt: {
            question,
            settle(result) {
              store.set({ prompt: undefined })
              if ("value" in result) resolve(result.value)
              else reject(result.error)
            },
          },
        })
      }).finally(() => process.stdin.setRawMode(false))
    },
    async close() {
      app.unmount()
      await app.waitUntilExit()
    },
  }
}
