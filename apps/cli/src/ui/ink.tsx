import { Box, render, Static, Text, useInput, useWindowSize, type RenderOptions } from "ink"
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"

import type { DeployProgress } from "../app/state"
import { logClock } from "../app/time"
import { CliError } from "../errors"
import { keptLines } from "./deploy"
import { DeployBlock, type DeployShown } from "./deploy-view"
import { readStdin } from "./plain"
import { applySecretInput } from "./secret-input"
import { BRAND } from "./theme"
import { discardTypedAhead } from "./type-ahead"
import { REMOTE_MARK, type Cell, type LogOutput, type Ui } from "./types"

type Item =
  | { id: number; kind: "info" | "success" | "warn" | "error" | "remote"; text: string }
  | { id: number; kind: "field"; label: string; value: string }
  | { id: number; kind: "table"; rows: Cell[][] }
  | { id: number; kind: "log"; line: LogOutput; serviceWidth: number }
  | { id: number; kind: "line"; cells: readonly Cell[] }
  | { id: number; kind: "deploy"; shown: DeployShown }

type Prompt = { question: string; settle(result: { value: string } | { error: Error }): void }
type Question = { question: string; settle(yes: boolean): void }
/**
 * `generation` changes when lines already drawn are let go; Static then
 * starts afresh with what is left. `deploy` is a deploy still running, drawn
 * below the lines and redrawn as it goes; once it ends it becomes a line.
 * `step` is work in progress, with a spinner, or `still` without one.
 */
type State = {
  items: Item[]
  generation: number
  step?: { label: string; still: boolean }
  prompt?: Prompt
  question?: Question
  deploy?: DeployShown
}

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
const TONE = { success: "green", danger: "red", warning: "yellow" } as const

/** A cell as a terminal draws it: a marked cell's symbol before its word, a styled cell's words for a terminal. */
const drawnCell = (cell: Cell | undefined): string => {
  if (cell === undefined) return ""
  if (typeof cell === "string") return cell
  return "mark" in cell ? `${cell.mark} ${cell.text}` : (cell.terminal ?? cell.text)
}

/**
 * One cell in its look: a marked cell in its tone's colour, a styled cell
 * bold, faint or in the text colour, and a bare word as `bare` says.
 */
function CellText({ cell, text, bare }: { cell: Cell; text: string; bare: "plain" | "quiet" }) {
  if (typeof cell === "string") return <Text dimColor={bare === "quiet"}>{text}</Text>
  if ("mark" in cell) {
    return (
      <Text color={cell.tone === "quiet" ? undefined : TONE[cell.tone]} dimColor={cell.tone === "quiet"}>
        {text}
      </Text>
    )
  }
  return (
    <Text bold={cell.style === "strong"} dimColor={cell.style === "quiet"}>
      {text}
    </Text>
  )
}

/** A sentence's end: a full stop before a space or a line break. */
const SENTENCE_END = /\.(?=\s)/

/**
 * An error as the board "Status, lists, errors and piped output" draws it:
 * its first sentence, in bold after ✖, and the rest faint on the lines
 * below, in line with that sentence. Commands are drawn as the board draws
 * them, without the backticks plain output keeps around them.
 */
export function ErrorLine({ text }: { text: string }) {
  const shown = text.replace(/`([^`\n]+)`/g, "$1")
  const end = shown.search(SENTENCE_END)
  const first = end === -1 ? shown : shown.slice(0, end + 1)
  const rest = end === -1 ? "" : shown.slice(end + 1).trim()
  return (
    <Box flexDirection="column">
      <Box>
        <Box flexShrink={0} marginRight={1}>
          <Text color={COLOR.error}>{MARK.error}</Text>
        </Box>
        <Text bold>{first}</Text>
      </Box>
      {rest ? (
        <Box paddingLeft={2}>
          <Text dimColor>{rest}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** How often, at most, the live line under a running deploy is redrawn. */
const LIVE_LINE_MS = 100

/** The widest service column `zekno logs` lines up to; a longer name is cut. */
const SERVICE_COLUMN = 16

/**
 * One line of `zekno logs` at a terminal, as on the board "Live logs": the
 * time, faint; the service; the text. A line wider than the terminal goes on
 * under its own text, never at the left edge, so the part after the wrap
 * cannot pass for a line with a time and a service of its own. `columns`
 * bounds it, as for a server's line (`RemoteLine`).
 */
export function LogItem({ line, serviceWidth, columns }: { line: LogOutput; serviceWidth: number; columns?: number }) {
  return (
    <Box width={columns}>
      <Box flexShrink={0} width={10}>
        <Text dimColor>{logClock(line.time)}</Text>
      </Box>
      <Box flexShrink={0} width={serviceWidth + 2}>
        <Text color={BRAND} wrap="truncate-end">
          {line.service}
        </Text>
      </Box>
      <Text>{line.text}</Text>
    </Box>
  )
}

function Line({ item, columns }: { item: Item; columns: number }) {
  if (item.kind === "field") {
    return (
      <Text>
        {"  "}
        <Text dimColor>{item.label}</Text> <Text bold>{item.value}</Text>
      </Text>
    )
  }
  if (item.kind === "table") {
    const widths = item.rows[0]?.map((_, column) => Math.max(...item.rows.map((row) => drawnCell(row[column]).length))) ?? []
    // At the left edge, as the board's lists: a bare first column in the text colour, the others faint.
    return (
      <Box flexDirection="column">
        {item.rows.map((row, index) => (
          <Text key={index}>
            {row.map((cell, column) => (
              <CellText key={column} cell={cell} text={drawnCell(cell).padEnd((widths[column] ?? 0) + 2)} bare={column > 0 ? "quiet" : "plain"} />
            ))}
          </Text>
        ))}
      </Box>
    )
  }
  if (item.kind === "line") {
    return (
      <Text>
        {item.cells.map((cell, index) => (
          <Text key={index}>
            {index > 0 ? " " : ""}
            <CellText cell={cell} text={drawnCell(cell)} bare="plain" />
          </Text>
        ))}
      </Text>
    )
  }
  if (item.kind === "log") return <LogItem line={item.line} serviceWidth={item.serviceWidth} columns={columns} />
  if (item.kind === "deploy") return <DeployBlock shown={item.shown} columns={columns} />

  if (item.kind === "info") {
    // Indented as a block, so text of several lines stays aligned with the marked lines.
    return (
      <Box marginLeft={2}>
        <Text>{item.text}</Text>
      </Box>
    )
  }
  if (item.kind === "remote") return <RemoteLine text={item.text} columns={columns} />
  if (item.kind === "error") return <ErrorLine text={item.text} />
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
 * Single commands draw it among the lines already written, where nothing
 * bounds its width: `columns` does, so a word longer than the room left,
 * such as a path, is broken here and not by the terminal.
 */
export function RemoteLine({ text, columns }: { text: string; columns?: number }) {
  return (
    <Box width={columns}>
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

/** What a key answers to a yes-or-no question: `y` is yes; `n`, Enter, Esc and Ctrl-C are no; anything else, nothing yet. */
export function yesOrNo(input: string, key: { return?: boolean; escape?: boolean; ctrl?: boolean }): boolean | undefined {
  if (key.ctrl) return input === "c" ? false : undefined
  if (key.return || key.escape) return false
  if (input === "y" || input === "Y") return true
  if (input === "n" || input === "N") return false
  return undefined
}

/** A yes-or-no question, answered with one key. */
function QuestionPrompt({ question }: { question: Question }) {
  useInput((input, key) => {
    const answer = yesOrNo(input, key)
    if (answer !== undefined) question.settle(answer)
  })
  return (
    <Text>
      <Text color="cyan">?</Text> {question.question} <Text dimColor>(y/N)</Text>
    </Text>
  )
}

function App({ store }: { store: ReturnType<typeof createStore> }) {
  const state = useSyncExternalStore(store.subscribe, store.get)
  const { columns } = useWindowSize()
  // Ink writes Static's new items to the terminal as the commit ends, before this runs.
  useLayoutEffect(() => store.drawn(state.generation, state.items.length))
  return (
    <>
      <Static key={state.generation} items={state.items}>
        {(item) => <Line key={item.id} item={item} columns={columns} />}
      </Static>
      {state.deploy ? <DeployBlock shown={state.deploy} columns={columns} /> : null}
      {state.prompt ? (
        <SecretPrompt prompt={state.prompt} />
      ) : state.question ? (
        <QuestionPrompt question={state.question} />
      ) : state.step?.still ? (
        <Box marginLeft={2}>
          <Text>{state.step.label}…</Text>
        </Box>
      ) : state.step ? (
        <Spinner label={state.step.label} />
      ) : null}
    </>
  )
}

/**
 * The interface at a terminal: progress, a hidden prompt, aligned tables and
 * colour. Tests pass their own streams.
 */
export function inkUi(streams: Pick<RenderOptions, "stdout" | "stdin" | "stderr" | "interactive"> = {}): Ui {
  const store = createStore()
  // Ink is not left to act on Ctrl-C: it would close the interface and leave the
  // command waiting for an answer that never comes. While the prompt is open
  // the prompt cancels the command; the rest of the time the terminal turns
  // Ctrl-C into the usual interrupt.
  const app = render(<App store={store} />, { ...streams, exitOnCtrlC: false })
  const add = store.add
  // The service column grows to the longest name seen so far, up to a bound, so lines stay aligned.
  let serviceWidth = 0

  return {
    info: (text) => add({ kind: "info", text }),
    success: (text) => add({ kind: "success", text }),
    warn: (text) => add({ kind: "warn", text }),
    error: (text) => add({ kind: "error", text }),
    field: (label, value) => add({ kind: "field", label, value }),
    table: (rows) => add({ kind: "table", rows }),
    line: (_plain, cells) => {
      if (cells !== undefined && cells.length > 0) add({ kind: "line", cells })
    },
    deploy(start) {
      const kept = keptLines()
      // Nothing is drawn until the runner has answered: until then SSH may be asking for a password on this terminal.
      let shown: DeployShown | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      let ended = false
      const latest = (): string[] => (kept.lines.length > 0 ? [kept.lines.at(-1)!] : [])
      const show = (deploy: DeployProgress) => {
        shown = { start, deploy, dropped: 0 }
        store.set({ deploy: shown })
      }
      return {
        stage(stage, info) {
          if (ended) return
          const deploy = shown?.deploy ?? { server: start.server, app: start.app, lines: [], running: true, since: Date.now() }
          show({ ...deploy, stage, sequence: info.sequence, secrets: info.secrets, lines: latest() })
        },
        progress(line) {
          kept.push(line)
          // The live line is redrawn a few times a second at most, however fast Docker writes.
          if (shown && !ended && timer === undefined) {
            timer = setTimeout(() => {
              timer = undefined
              if (shown && !ended) show({ ...shown.deploy, lines: latest() })
            }, LIVE_LINE_MS)
          }
        },
        async end(ending) {
          if (ended) return
          ended = true
          clearTimeout(timer)
          const was = shown?.deploy
          store.set({ deploy: undefined })
          // A deploy that ended before the runner answered was never drawn: the error says it all.
          if (!was && ending.outcome === "error") return
          const sequence = ending.outcome === "error" ? was?.sequence : ending.sequence
          const secrets = ending.outcome === "error" ? was?.secrets : ending.secrets
          const stage = ending.outcome === "started" ? "started" : ending.outcome === "start_failed" ? "failed" : was?.stage
          const deploy: DeployProgress = {
            ...(was ?? { server: start.server, app: start.app, since: Date.now() }),
            sequence,
            secrets,
            stage,
            running: false,
            outcome: ending.outcome,
            lines: [...kept.lines],
          }
          // The last frame becomes a line of its own, so whatever comes next is said below it.
          add({ kind: "deploy", shown: { start, deploy, dropped: kept.dropped, ms: ending.outcome === "error" ? undefined : ending.ms } })
          await app.waitUntilRenderFlush()
        },
      }
    },
    json: (value) => add({ kind: "info", text: JSON.stringify(value) }),
    async remote(line) {
      add({ kind: "remote", text: line })
      // The next line waits until this one is on the terminal.
      await app.waitUntilRenderFlush()
    },
    async logLine(line) {
      serviceWidth = Math.min(Math.max(serviceWidth, line.service.length), SERVICE_COLUMN)
      add({ kind: "log", line, serviceWidth })
      // As for a server's line: the next one waits until this one is on the terminal.
      await app.waitUntilRenderFlush()
    },
    async step(label, work, options) {
      // Quiet, it is not animated, so nothing is redrawn over what SSH may write unless a line comes to be drawn above it. Either way it is erased once the work ends.
      store.set({ step: { label, still: options?.quiet === true } })
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
    async confirm(question, refusal) {
      if (!process.stdin.isTTY) throw new CliError(refusal)
      process.stdin.setRawMode(true)
      try {
        // What was typed before the question is drawn is not its answer, such as a `y` typed while the keychain asked.
        await discardTypedAhead(process.stdin)
        return await new Promise<boolean>((resolve) => {
          store.set({
            question: {
              question,
              settle(yes) {
                store.set({ question: undefined })
                add({ kind: "info", text: `${question} ${yes ? "yes" : "no"}` })
                resolve(yes)
              },
            },
          })
        })
      } finally {
        process.stdin.setRawMode(false)
      }
    },
    async close() {
      app.unmount()
      await app.waitUntilExit()
    },
  }
}
