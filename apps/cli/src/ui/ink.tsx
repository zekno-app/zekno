import { Box, render, Static, Text, useInput, useWindowSize, type RenderOptions } from "ink"
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"

import type { DeployProgress } from "../app/state"
import { logClock } from "../app/time"
import { CliError, Left } from "../errors"
import { keptLines } from "./deploy"
import { DeployBlock, type DeployShown } from "./deploy-view"
import { NO_TERMINAL_FOR_VALUE, readStdin } from "./plain"
import { isCtrlC, ListPrompt, QuestionWords, TypedPrompt, VALUE_EMPTY, valueHasLines, type Settled } from "./questions"
import { applySecretInput } from "./secret-input"
import { BRAND } from "./theme"
import { discardTypedAhead } from "./type-ahead"
import { REMOTE_MARK, type Cell, type ListRow, type LogOutput, type Ui } from "./types"

type Item =
  | { id: number; kind: "info" | "error" | "remote" | "note"; text: string }
  /**
   * `detail`: dim, two spaces after the words (`✔ Runner installed  52 MB, checksum verified`, board "zekno deploy from nothing").
   * `firstBold`: the first sentence in bold (`✔ Stored 4 values for demo on prod.`, board "zekno secret import").
   */
  | { id: number; kind: "success"; text: string; detail?: string; firstBold?: boolean }
  /** `firstBold`: the first sentence in bold (`zekno version`'s newer release, board "The version, and a newer release"). */
  | { id: number; kind: "warn"; text: string; firstBold?: boolean }
  | { id: number; kind: "field"; label: string; value: string }
  | { id: number; kind: "table"; rows: Cell[][] }
  | { id: number; kind: "log"; line: LogOutput; serviceWidth: number }
  | { id: number; kind: "line"; cells: readonly Cell[] }
  | { id: number; kind: "deploy"; shown: DeployShown }
  | { id: number; kind: "chosen"; collapsed: string; label: string }
  | { id: number; kind: "asked"; question: string; answer: string }
  | { id: number; kind: "answered"; question: string; yes: boolean }
  | { id: number; kind: "hidden"; question: string; skipped: boolean }
  | { id: number; kind: "code"; label: string; value: string; about: string }
  | { id: number; kind: "groups"; rows: readonly (readonly [string, string])[] }
  | { id: number; kind: "gap" }

type Prompt = { question: string; settle(result: { value: string } | { error: Error }): void }
/** A yes-or-no question. With `leave`, Esc and Ctrl-C leave instead of answering no. */
type Question = { question: string; leave: boolean; settle(answer: boolean | "left"): void }
/** A list open on the screen. `id` makes each question a new one on the screen, never the one before it reused. */
type ListOpen = { id: number; question: string; rows: readonly ListRow<unknown>[]; settle(result: Settled<number>): void }
/** A one-line answer being typed. */
type TypedOpen = { id: number; question: string; fill?: string; check(answer: string): string | undefined; settle(result: Settled<string>): void }
/** The hidden prompt that can be skipped. `name` is the secret's, for the sentence about a value of several lines. */
type ValueOpen = { id: number; question: string; name: string; settle(result: { kind: "value"; value: string } | { kind: "skipped" } | { kind: "left" }): void }
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
  list?: ListOpen
  typed?: TypedOpen
  value?: ValueOpen
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
  if (item.kind === "chosen") {
    return (
      <Text>
        <Text color={COLOR.success}>{MARK.success}</Text> <Text dimColor>{item.collapsed}</Text>
        {"  "}
        {item.label}
      </Text>
    )
  }
  if (item.kind === "asked") {
    return (
      <Text>
        <Text color={BRAND}>?</Text> <QuestionWords text={item.question} /> <Text dimColor>›</Text> {item.answer}
      </Text>
    )
  }
  if (item.kind === "answered") {
    return (
      <Text>
        <Text color={BRAND}>?</Text> <QuestionWords text={item.question} /> <Text dimColor>(y/N)</Text> {item.yes ? "yes" : "no"}
      </Text>
    )
  }
  if (item.kind === "hidden") {
    return (
      <Text>
        <Text color={BRAND}>?</Text> <QuestionWords text={item.question} />
        <Text dimColor>{item.skipped ? "skipped" : "(hidden)"}</Text>
      </Text>
    )
  }
  if (item.kind === "code") {
    // The code at column 15, as mock-up 3 draws the team code and the server code; what it is for on the line under it.
    return (
      <Box flexDirection="column" width={columns}>
        <Text>
          {"  "}
          <Text dimColor>{item.label.padEnd(CODE_LABEL)}</Text>
          {"  "}
          <Text bold>{item.value}</Text>
        </Text>
        <Box paddingLeft={2}>
          <Text dimColor>{item.about}</Text>
        </Box>
      </Box>
    )
  }
  if (item.kind === "groups") {
    // Each text in a column of its own from column 14, as mock-up 4 draws the groups of an import.
    return (
      <Box flexDirection="column" width={columns}>
        {item.rows.map(([label, text], index) => (
          <Box key={index} paddingLeft={2}>
            <Box width={GROUP_LABEL} flexShrink={0}>
              <Text dimColor>{label}</Text>
            </Box>
            <Text>
              {/* A reason in brackets, such as "(zekno keeps this name)", is dim (board "zekno secret import"). */}
              {text.split(/(\([^()]*\))/).map((part, at) => (
                <Text key={at} dimColor={at % 2 === 1}>
                  {part}
                </Text>
              ))}
            </Text>
          </Box>
        ))}
      </Box>
    )
  }
  if (item.kind === "gap") return <Text> </Text>
  if (item.kind === "note") {
    return (
      <Box paddingLeft={2} width={columns}>
        <Text dimColor>{item.text}</Text>
      </Box>
    )
  }
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
      {(item.kind === "warn" || item.kind === "success") && item.firstBold ? (
        <QuestionWords text={item.text} />
      ) : item.kind === "success" && item.detail !== undefined ? (
        <Text>
          {item.text}
          {"  "}
          <Text dimColor>{item.detail}</Text>
        </Text>
      ) : (
        <Text>{item.text}</Text>
      )}
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

/** The label column of a code (mock-up 3) and of the groups of an import (mock-up 4). */
const CODE_LABEL = 11
const GROUP_LABEL = 12

/**
 * What each question leaves on the screen once it is answered, above
 * whatever comes next. A list collapses to `✔ Server  prod` (mock-ups 1 and
 * 2). The rest is research Q1, built as recommended and not yet approved by
 * the maintainer: a typed answer stays as `? Your name › ada`; a yes-or-no
 * question as `? <question> (y/N) yes`, the questions that existed before
 * included; the skippable hidden prompt as its line ending `(hidden)` or
 * `skipped`. The hidden prompt of `zekno secret set` leaves nothing, as before.
 */
const LEFT_BEHIND = {
  choose: (collapsed: string, label: string) => ({ kind: "chosen", collapsed, label }),
  ask: (question: string, answer: string) => ({ kind: "asked", question, answer }),
  confirm: (question: string, yes: boolean) => ({ kind: "answered", question, yes }),
  askValue: (question: string, skipped: boolean) => ({ kind: "hidden", question, skipped }),
} satisfies Record<string, (...args: never[]) => Omit<Item, "id">>

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
      <Text color={BRAND}>?</Text> <QuestionWords text={prompt.question} />
      <Text dimColor>(hidden)</Text>
    </Text>
  )
}

/**
 * The hidden prompt of a first deploy (contracts/questions.md): nothing of
 * the value is drawn, not even its length, and it is never kept in React
 * state. Esc skips the value; Ctrl-C leaves. Nothing, or several lines, is
 * refused with its reason under the line, and the prompt stays open.
 */
function ValuePrompt({ open }: { open: ValueOpen }) {
  const value = useRef("")
  const [reason, setReason] = useState<string | undefined>(undefined)
  useInput((input, key) => {
    if (isCtrlC(input, key)) return open.settle({ kind: "left" })
    if (key.escape) {
      value.current = ""
      return open.settle({ kind: "skipped" })
    }
    const next = applySecretInput(value.current, input, key)
    if (next.kind === "typing") {
      value.current = next.value
      return
    }
    value.current = ""
    if (next.kind === "done" && next.value !== "") return open.settle({ kind: "value", value: next.value })
    setReason(next.kind === "done" ? VALUE_EMPTY : valueHasLines(open.name))
  })
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={BRAND}>?</Text> <QuestionWords text={open.question} />
        <Text dimColor>(hidden)</Text>
        {"   "}
        <Text dimColor>esc skips it</Text>
      </Text>
      {reason === undefined ? null : (
        <Text>
          <Text color={COLOR.warn}>{MARK.warn}</Text> {reason}
        </Text>
      )}
    </Box>
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

/** A yes-or-no question, answered with one key. Asked with `leave`, Esc and Ctrl-C leave it. */
function QuestionPrompt({ question }: { question: Question }) {
  useInput((input, key) => {
    if (question.leave && (key.escape || isCtrlC(input, key))) return question.settle("left")
    const answer = yesOrNo(input, key)
    if (answer !== undefined) question.settle(answer)
  })
  return (
    <Text>
      <Text color={BRAND}>?</Text> <QuestionWords text={question.question} /> <Text dimColor>(y/N)</Text>
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
      ) : state.value ? (
        <ValuePrompt key={`value-${state.value.id}`} open={state.value} />
      ) : state.question ? (
        <QuestionPrompt question={state.question} />
      ) : state.list ? (
        <ListPrompt key={`list-${state.list.id}`} question={state.list.question} rows={state.list.rows} settle={state.list.settle} />
      ) : state.typed ? (
        <TypedPrompt key={`typed-${state.typed.id}`} question={state.typed.question} fill={state.typed.fill} check={state.typed.check} settle={state.typed.settle} />
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
  // The input Ink reads keys from. Every question turns raw mode on and throws away what was typed before it on this
  // same input, so a stand-in terminal in a test is treated as a person's terminal is.
  const input = (streams.stdin ?? process.stdin) as NodeJS.ReadStream
  // Ink is not left to act on Ctrl-C: it would close the interface and leave the
  // command waiting for an answer that never comes. While the prompt is open
  // the prompt cancels the command; the rest of the time the terminal turns
  // Ctrl-C into the usual interrupt.
  const app = render(<App store={store} />, { ...streams, exitOnCtrlC: false })
  const add = store.add
  // The service column grows to the longest name seen so far, up to a bound, so lines stay aligned.
  let serviceWidth = 0
  // Each question is drawn as a new one, so nothing of the one before (a selection, an answer so far) carries over.
  let questions = 0

  /**
   * Opens one question at a terminal (contracts/questions.md, "Keys typed
   * before a question"): raw mode goes on first, so nothing typed from now on
   * is echoed or held back by the terminal; what was typed before is thrown
   * away; then the question is drawn by `open`, which settles once.
   */
  async function asking<T>(open: (resolve: (value: T) => void, reject: (error: Error) => void) => void): Promise<T> {
    input.setRawMode(true)
    try {
      // What was typed before the question is drawn is not its answer, such as a `y` typed while the keychain asked.
      await discardTypedAhead(input)
      return await new Promise<T>((resolve, reject) => {
        let settled = false
        open(
          (value) => {
            if (settled) return
            settled = true
            resolve(value)
          },
          (error) => {
            if (settled) return
            settled = true
            reject(error)
          }
        )
      })
    } finally {
      input.setRawMode(false)
    }
  }

  return {
    info: (text) => add({ kind: "info", text }),
    success: (text, detail, options) =>
      add({ kind: "success", text, ...(detail === undefined ? {} : { detail }), ...(options?.firstBold ? { firstBold: true } : {}) }),
    warn: (text, options) => add({ kind: "warn", text, ...(options?.firstBold ? { firstBold: true } : {}) }),
    error: (text) => add({ kind: "error", text }),
    note: (text) => add({ kind: "note", text }),
    code: (label, value, about) => add({ kind: "code", label, value, about }),
    groups: (rows) => add({ kind: "groups", rows }),
    gap: () => add({ kind: "gap" }),
    asks: Boolean(input.isTTY),
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
    async askSecret(question, fromStdin) {
      if (fromStdin) return readStdin()
      if (!input.isTTY) throw new CliError(NO_TERMINAL_FOR_VALUE)
      // Echo goes off before the question is drawn, not a moment after: nobody
      // should be able to start typing at a prompt that still shows what is
      // typed. What was typed before it is thrown away, so it never becomes
      // part of the value (specs/004-cli-app/security-review.md, "Left").
      return asking<string>((resolve, reject) =>
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
      )
    },
    async askValue(question, name) {
      if (!input.isTTY) throw new CliError(NO_TERMINAL_FOR_VALUE)
      return asking<string | undefined>((resolve, reject) =>
        store.set({
          value: {
            id: questions++,
            question,
            name,
            settle(result) {
              store.set({ value: undefined })
              if (result.kind === "left") return reject(new Left())
              add(LEFT_BEHIND.askValue(question, result.kind === "skipped"))
              resolve(result.kind === "value" ? result.value : undefined)
            },
          },
        })
      )
    },
    async confirm(question, refusal, options) {
      if (!input.isTTY) throw new CliError(refusal)
      return asking<boolean>((resolve, reject) =>
        store.set({
          question: {
            question,
            leave: options?.leave === true,
            settle(answer) {
              store.set({ question: undefined })
              if (answer === "left") return reject(new Left())
              add(LEFT_BEHIND.confirm(question, answer))
              resolve(answer)
            },
          },
        })
      )
    },
    async choose(question) {
      if (!input.isTTY) throw question.missing
      return asking((resolve, reject) =>
        store.set({
          list: {
            id: questions++,
            question: question.question,
            rows: question.rows,
            settle(result) {
              store.set({ list: undefined })
              if ("left" in result) return reject(new Left())
              const row = question.rows[result.answer]!
              add(LEFT_BEHIND.choose(question.collapsed, row.label))
              resolve(row.value)
            },
          },
        })
      )
    },
    async ask(question) {
      if (!input.isTTY) throw question.missing
      return asking<string>((resolve, reject) =>
        store.set({
          typed: {
            id: questions++,
            question: question.question,
            fill: question.fill,
            check: question.check,
            settle(result) {
              store.set({ typed: undefined })
              if ("left" in result) return reject(new Left())
              add(LEFT_BEHIND.ask(question.question, result.answer))
              resolve(result.answer)
            },
          },
        })
      )
    },
    async close() {
      app.unmount()
      await app.waitUntilExit()
    },
  }
}
