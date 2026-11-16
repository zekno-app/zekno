/**
 * The interface single commands use at a terminal (`Ui`, ui/types.ts), drawn
 * with Ink. `inkUi` puts the pieces of this folder together:
 *
 * - what is on the screen: store.ts;
 * - the lines written once: lines.tsx, with cells.tsx, marks.tsx,
 *   doctor-report.tsx, settings-report.tsx and deploy-view.tsx;
 * - a deploy as it runs: deploy-live.ts; work in progress: spinner.tsx;
 * - the questions: questions.tsx (a list, a typed answer), yes-or-no.tsx,
 *   hidden-prompts.tsx; what each leaves behind: left-behind.ts;
 * - raw mode, keys typed before a question, and raw mode kept on between two
 *   hidden values: raw-mode.tsx.
 */
import {
  Box,
  render,
  Static,
  Text,
  useWindowSize,
  type RenderOptions,
} from "ink"
import { useLayoutEffect, useSyncExternalStore } from "react"

import { CliError, Left } from "../../cli/errors"
import { DeployBlock } from "./deploy-view"
import { NO_TERMINAL_FOR_VALUE, readStdin } from "../plain/plain"
import { ListPrompt, TypedPrompt } from "./questions"
import type { Ui } from "../types"
import { liveDeploy } from "./deploy-live"
import { SecretPrompt, ValuePrompt } from "./hidden-prompts"
import { LEFT_BEHIND } from "./left-behind"
import { Line } from "./lines"
import { HeldInput, rawMode } from "./raw-mode"
import { Spinner } from "./spinner"
import { createStore } from "./store"
import { QuestionPrompt } from "./yes-or-no"

/** The widest service column `zekno logs` lines up to; a longer name is cut. */
const SERVICE_COLUMN = 16

function App({
  store,
  interrupt,
}: {
  store: ReturnType<typeof createStore>
  interrupt(): void
}) {
  const state = useSyncExternalStore(store.subscribe, store.get)
  const { columns } = useWindowSize()
  // Ink writes Static's new items to the terminal as the commit ends, before this runs.
  useLayoutEffect(() => store.drawn(state.generation, state.items.length))
  return (
    <>
      <Static key={state.generation} items={state.items}>
        {(item) => <Line key={item.id} item={item} columns={columns} />}
      </Static>
      {state.deploy ? (
        <DeployBlock shown={state.deploy} columns={columns} />
      ) : null}
      {state.prompt ? (
        <SecretPrompt prompt={state.prompt} />
      ) : state.value ? (
        <ValuePrompt key={`value-${state.value.id}`} open={state.value} />
      ) : state.question ? (
        <QuestionPrompt question={state.question} />
      ) : state.list ? (
        <ListPrompt
          key={`list-${state.list.id}`}
          question={state.list.question}
          rows={state.list.rows}
          settle={state.list.settle}
        />
      ) : state.typed ? (
        <TypedPrompt
          key={`typed-${state.typed.id}`}
          question={state.typed.question}
          fill={state.typed.fill}
          check={state.typed.check}
          settle={state.typed.settle}
        />
      ) : state.hold ? (
        <HeldInput interrupt={interrupt} />
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
export function inkUi(
  streams: Pick<
    RenderOptions,
    "stdout" | "stdin" | "stderr" | "interactive"
  > = {}
): Ui {
  const store = createStore()
  // The input Ink reads keys from. Every question turns raw mode on and throws away what was typed before it on this
  // same input, so a stand-in terminal in a test is treated as a person's terminal is.
  const input = (streams.stdin ?? process.stdin) as NodeJS.ReadStream
  // Raw mode on that input for each question, and kept on after a hidden value (raw-mode.tsx).
  const { asking, showQuestion, keepAfter, release, interrupt } = rawMode(
    input,
    store
  )
  // Ink is not left to act on Ctrl-C: it would close the interface and leave the
  // command waiting for an answer that never comes. While the prompt is open
  // the prompt cancels the command; the rest of the time the terminal turns
  // Ctrl-C into the usual interrupt, or `HeldInput` sends that interrupt itself
  // while raw mode is kept on between two hidden values.
  const app = render(<App store={store} interrupt={() => interrupt()} />, {
    ...streams,
    exitOnCtrlC: false,
  })
  // Anything drawn but a hidden value's own line ends what is held.
  const add = (item: Record<string, unknown>) => {
    if (item.kind !== "hidden") release()
    store.add(item)
  }
  // The service column grows to the longest name seen so far, up to a bound, so lines stay aligned.
  let serviceWidth = 0
  // Each question is drawn as a new one, so nothing of the one before (a selection, an answer so far) carries over.
  let questions = 0

  return {
    info: (text) => add({ kind: "info", text }),
    success: (text, detail, options) =>
      add({
        kind: "success",
        text,
        ...(detail === undefined ? {} : { detail }),
        ...(options?.firstBold ? { firstBold: true } : {}),
      }),
    warn: (text, options) =>
      add({
        kind: "warn",
        text,
        ...(options?.firstBold ? { firstBold: true } : {}),
      }),
    error: (text) => add({ kind: "error", text }),
    note: (text) => add({ kind: "note", text }),
    code: (label, value, about) => add({ kind: "code", label, value, about }),
    groups: (rows) => add({ kind: "groups", rows }),
    gap: () => add({ kind: "gap" }),
    doctorReport: (report) => add({ kind: "doctor", report }),
    settingChange: (change) => add({ kind: "change", change }),
    settingsReport(report) {
      add({ kind: "settings", report })
      // SH3 after the services, as a warning, an empty line apart as each service is.
      if (report.note !== undefined) {
        add({ kind: "gap" })
        add({ kind: "warn", text: report.note })
      }
    },
    asks: Boolean(input.isTTY),
    field: (label, value) => add({ kind: "field", label, value }),
    table: (rows) => add({ kind: "table", rows }),
    line: (_plain, cells) => {
      if (cells !== undefined && cells.length > 0) add({ kind: "line", cells })
    },
    deploy(start) {
      release()
      return liveDeploy(start, store, add, app)
    },
    json: (value) => add({ kind: "info", text: JSON.stringify(value) }),
    async remote(line) {
      add({ kind: "remote", text: line })
      // The next line waits until this one is on the terminal.
      await app.waitUntilRenderFlush()
    },
    async logLine(line) {
      serviceWidth = Math.min(
        Math.max(serviceWidth, line.service.length),
        SERVICE_COLUMN
      )
      add({ kind: "log", line, serviceWidth })
      // As for a server's line: the next one waits until this one is on the terminal.
      await app.waitUntilRenderFlush()
    },
    async step(label, work, options) {
      release()
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
        showQuestion({
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
        showQuestion({
          value: {
            id: questions++,
            question,
            name,
            settle(result) {
              if (result.kind === "left") {
                store.set({ value: undefined })
                add(LEFT_BEHIND.left(question, "hidden"))
                return reject(new Left())
              }
              // Another hidden value may follow once this one is stored: the terminal must not echo what is typed meanwhile.
              keepAfter({ value: undefined })
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
        showQuestion({
          question: {
            question,
            leave: options?.leave === true,
            settle(answer) {
              store.set({ question: undefined })
              if (answer === "left") {
                add(LEFT_BEHIND.left(question, "yes-or-no"))
                return reject(new Left())
              }
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
        showQuestion({
          list: {
            id: questions++,
            question: question.question,
            rows: question.rows,
            settle(result) {
              store.set({ list: undefined })
              if ("left" in result) {
                add(LEFT_BEHIND.left(question.question, "list"))
                return reject(new Left())
              }
              const row = question.rows[result.answer]!
              // A row that asks a question of its own, such as `+ a new app`, leaves no line: that question takes its place (mock-up 2).
              if (row.asksNext !== true)
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
        showQuestion({
          typed: {
            id: questions++,
            question: question.question,
            fill: question.fill,
            check: question.check,
            settle(result) {
              store.set({ typed: undefined })
              if ("left" in result) {
                add(
                  LEFT_BEHIND.left(
                    question.question,
                    "typed",
                    result.typed ?? ""
                  )
                )
                return reject(new Left())
              }
              add(LEFT_BEHIND.ask(question.question, result.answer))
              resolve(result.answer)
            },
          },
        })
      )
    },
    async close() {
      release()
      app.unmount()
      await app.waitUntilExit()
    },
  }
}
