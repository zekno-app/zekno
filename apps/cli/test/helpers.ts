import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { fakeDocker, filesUnder, RUNNER_MAIN } from "../../runner/test/helpers"
import { run } from "../src/cli"
import type { Deps } from "../src/context"
import { Left } from "../src/errors"
import { memoryKeyStore } from "../src/keystore"
import { connect } from "../src/transport"
import { plainUi } from "../src/ui/plain"
import type { Ui } from "../src/ui/types"

export { filesUnder }

export const COMPOSE_V1 = "services:\n  web:\n    image: example/web:1\n    environment:\n      - GREETING\n"
export const COMPOSE_V2 = COMPOSE_V1.replace("web:1", "web:2")

/**
 * A developer's machine for tests: a temporary profile folder and project
 * folder, an in-memory key store instead of the real keychain, and a local
 * runner process that uses a stand-in Docker (or the real one).
 */
export function machine(options: { realDocker?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), "zekno-home-"))
  const project = mkdtempSync(join(tmpdir(), "zekno-project-"))
  const docker = fakeDocker()
  const keyStore = memoryKeyStore()
  const out: string[] = []
  const err: string[] = []
  const answers: string[] = []
  const deps: Deps = {
    home,
    cwd: project,
    keyStore,
    connect,
    // The plain interface, as used when output is piped, with typed answers queued by the test.
    ui: {
      ...plainUi(
        (line) => out.push(line),
        (line) => err.push(line)
      ),
      askSecret: async () => {
        const answer = answers.shift()
        if (answer === undefined) throw new Error("the test did not provide a secret value")
        return answer
      },
    },
    localRunner: options.realDocker
      ? [process.execPath, RUNNER_MAIN]
      : ["env", `ZEKNO_DOCKER=${docker.path}`, process.execPath, RUNNER_MAIN],
  }
  return {
    home,
    project,
    runnerHome: join(home, "runner", "dev"),
    docker,
    keyStore,
    out,
    err,
    deps,
    /** Runs `zekno <args>` and returns the exit status. */
    zekno: (...args: string[]) => run(args, deps),
    /** Queues the value the next `secret set` will read. */
    typing: (value: string) => void answers.push(value),
    compose: (content: string, name = "compose.yaml") => writeFileSync(join(project, name), content),
    /** Reads and rewrites one JSON file in the profile folder, as something other than zekno might. */
    tamper(file: string, change: (json: any) => unknown) {
      const path = join(home, file)
      writeFileSync(path, JSON.stringify(change(JSON.parse(readFileSync(path, "utf8")))))
    },
    lastOut: () => out.at(-1) ?? "",
    lastErr: () => err.at(-1) ?? "",
  }
}

/**
 * Another machine of the same member: a profile folder of its own with the
 * same team and servers, and the same key in a key store of its own, as on a
 * second computer. It has no `links.json` of its own yet, so a zekno.json
 * used on the first machine is new to it.
 */
export async function twin(m: ReturnType<typeof machine>) {
  const other = machine()
  const profile = readFileSync(join(m.home, "profile.json"), "utf8")
  writeFileSync(join(other.home, "profile.json"), profile, { mode: 0o600 })
  const keyName: string = JSON.parse(profile).keyName
  await other.keyStore.set(keyName, (await m.keyStore.get(keyName))!)
  return other
}

/**
 * The lines a terminal shows once it has received `raw`, as far as Ink writes
 * outside the full-screen app: text, line breaks, erasing a line, moving up a
 * line and back to the first column. Colours and other modes are left out.
 */
export function screenOf(raw: string): string[] {
  const rows = [""]
  let row = 0
  let column = 0
  for (const token of raw.split(/(\x1b\[[0-9;?]*[A-Za-z]|\r|\n)/)) {
    if (token === "") continue
    if (token === "\n") {
      row++
      column = 0
      rows[row] ??= ""
      continue
    }
    if (token === "\r") {
      column = 0
      continue
    }
    const csi = /^\x1b\[([0-9;?]*)([A-Za-z])$/.exec(token)
    if (csi) {
      const [, count, final] = csi
      if (final === "K") rows[row] = ""
      if (final === "A") row = Math.max(0, row - Number(count || 1))
      if (final === "G") column = 0
      continue
    }
    for (const char of token) {
      const line = [...(rows[row] ?? "")]
      while (line.length < column) line.push(" ")
      line[column] = char
      rows[row] = line.join("")
      column++
    }
  }
  return rows.map((line) => line.trimEnd())
}

/** A machine with a team, a connected local runner, and a Compose file. */
export async function ready(options: { realDocker?: boolean } = {}) {
  const m = machine(options)
  if ((await m.zekno("init", "--name", "Ada")) !== 0) throw new Error(m.lastErr())
  if ((await m.zekno("server", "add", "dev", "--local")) !== 0) throw new Error(m.lastErr())
  m.compose(COMPOSE_V1)
  return m
}

/** One answer `answering` gives to the next question, in the order they are asked. */
export type Answer = { choose: string } | { type: string } | { yes: boolean } | { value: string } | "skip" | "leave"

/** A question as `answering` saw it: its kind, its words, the rows it offered (label and detail joined by a tab) and the value filled in. */
export type Asked = { kind: "choose" | "ask" | "confirm" | "askValue"; question: string; rows?: string[]; fill?: string }

/**
 * A person at a terminal, for tests (specs/006-cli-small-features, research
 * R15): the machine's plain interface with `asks` true, whose questions are
 * answered from `answers`, one each, in order. A typed answer goes through
 * the question's own check; one it refuses is kept in `refused` with its
 * reason, and the next answer is tried. `"leave"` is Esc: it leaves a list, a
 * typed answer, the hidden prompt and a yes-or-no question asked with
 * `leave`, and answers no to one asked without. Every question is kept in
 * `asked`, and what `note`, `code`, `groups`, `gap` and `doctorReport` were given in `lines`;
 * the plain interface still writes them, so `m.out` keeps them in order with
 * everything else. A question with no answer left fails the test.
 */
export function answering(m: ReturnType<typeof machine>, answers: Answer[]) {
  const queue = [...answers]
  const asked: Asked[] = []
  const lines: string[][] = []
  const refused: { answer: string; reason: string }[] = []
  const plain = m.deps.ui
  const next = (question: string): Answer => {
    const answer = queue.shift()
    if (answer === undefined) throw new Error(`the test gave no answer for: ${question}`)
    return answer
  }
  const wrong = (question: string, answer: Answer): Error => new Error(`the test answered "${question}" with ${JSON.stringify(answer)}`)
  const ui: Ui = {
    ...plain,
    asks: true,
    async choose(question) {
      asked.push({ kind: "choose", question: question.question, rows: question.rows.map((row) => (row.detail === undefined ? row.label : `${row.label}\t${row.detail}`)) })
      const answer = next(question.question)
      if (answer === "leave") throw new Left()
      if (typeof answer !== "object" || !("choose" in answer)) throw wrong(question.question, answer)
      const row = question.rows.find((entry) => entry.label === answer.choose)
      if (!row) throw new Error(`"${question.question}" offers no row ${answer.choose}`)
      return row.value
    },
    async ask(question) {
      asked.push({ kind: "ask", question: question.question, ...(question.fill === undefined ? {} : { fill: question.fill }) })
      for (;;) {
        const answer = next(question.question)
        if (answer === "leave") throw new Left()
        if (typeof answer !== "object" || !("type" in answer)) throw wrong(question.question, answer)
        const reason = question.check(answer.type)
        if (reason === undefined) return answer.type
        refused.push({ answer: answer.type, reason })
      }
    },
    async confirm(question, _refusal, options) {
      asked.push({ kind: "confirm", question })
      const answer = next(question)
      if (answer === "leave") {
        if (options?.leave) throw new Left()
        return false
      }
      if (typeof answer !== "object" || !("yes" in answer)) throw wrong(question, answer)
      return answer.yes
    },
    async askValue(question) {
      asked.push({ kind: "askValue", question })
      const answer = next(question)
      if (answer === "leave") throw new Left()
      if (answer === "skip") return undefined
      if (typeof answer !== "object" || !("value" in answer)) throw wrong(question, answer)
      return answer.value
    },
    note(text) {
      lines.push(["note", text])
      plain.note(text)
    },
    code(label, value, about) {
      lines.push(["code", label, value, about])
      plain.code(label, value, about)
    },
    groups(rows) {
      lines.push(["groups", ...rows.map(([label, text]) => `${label}\t${text}`)])
      plain.groups(rows)
    },
    gap() {
      lines.push(["gap"])
      plain.gap()
    },
    doctorReport(report) {
      lines.push(["doctorReport", `${report.problems} problems`, `${report.warnings} warnings`])
      plain.doctorReport(report)
    },
  }
  m.deps.ui = ui
  return { asked, lines, refused, unanswered: () => queue.length }
}
