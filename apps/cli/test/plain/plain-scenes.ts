/**
 * What every command that existed before feature 006 does with no terminal
 * (specs/006-cli-small-features, FR-028 and SC-006): which calls it makes, in
 * which order, what it writes on which stream, and its exit status. Each
 * scene runs `zekno` through `run` with the plain interface, as a script gets
 * it, and gives back one transcript per command: the calls of the interface,
 * the lines written (`out`, `err`, `remote`), each connection made and each
 * use of the keychain. Paths, codes, ids and times that differ between runs
 * are replaced by placeholders, so a transcript can be compared with the one
 * recorded at 5264e8a (plain-unchanged.test.ts).
 */
import { realpathSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { HELP, run } from "../../src/cli/cli"
import type { Deps } from "../../src/cli/context"
import type { KeyStore } from "../../src/profile/keystore"
import { plainUi } from "../../src/ui/plain/plain"
import type { Ui } from "../../src/ui/types"
import { COMPOSE_V1, machine, twin } from "../support/helpers"

type Machine = ReturnType<typeof machine>

/** A command of a scene: its words, and the hidden values queued for it. */
type Step = { argv: string[]; typed?: string[] }

/** What one command did: its words, its exit status and every call and line, in order. */
export type Transcript = { argv: string[]; code: number; calls: string[] }

/** The help text stands in a transcript as this, so the help can be compared on its own (contracts/help.md). */
export const HELP_MARK = "<HELP>"

/** Everything in a line that differs between two runs, replaced by a placeholder. */
function normalizer(places: readonly (readonly [string, string])[]) {
  const pairs = places.flatMap(([path, name]) => {
    let real = path
    try {
      real = realpathSync(path)
    } catch {
      // Not there (any more): only the path as given can appear.
    }
    return real === path
      ? [[path, name] as const]
      : [[real, name] as const, [path, name] as const]
  })
  pairs.sort((a, b) => b[0].length - a[0].length)
  return (text: string): string => {
    if (text === HELP) return HELP_MARK
    let line = text
    for (const [path, name] of pairs) line = line.split(path).join(name)
    return line
      .replace(/\b[0-9A-Z]{4}(-[0-9A-Z]{4}){4}\b/g, "<code>")
      .replace(/srv_[0-9a-f]{32}/g, "<server-id>")
      .replace(/team_[A-Za-z0-9_-]{16,}/g, "<team-id>")
      .replace(/zk_[a-z]+_[A-Za-z0-9_-]{16,}/g, "<key>")
      .replace(/\b[0-9a-f]{64}\b/g, "<hash>")
      .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, "<time>")
      .replace(/\b\d+(\.\d+)?s\b/g, "<seconds>")
  }
}

/**
 * Hands a machine the plain interface, wrapped so that every call it gets is
 * written down with the lines it writes. A hidden value is taken from
 * `typed` when the test queued one; otherwise the plain interface answers as
 * it does in a script.
 */
function recorder(m: Machine, normalize: (text: string) => string) {
  let calls: string[] = []
  const typed: string[] = []
  const note = (line: string) => void calls.push(normalize(line))
  const wrote = (stream: string, line: string) =>
    void calls.push(`${stream}: ${normalize(line)}`)
  const plain = plainUi(
    (line) => wrote("out", line),
    (line) => wrote("err", line),
    (text) => wrote("remote", text.replace(/\n$/, ""))
  )
  const wrapped = new Proxy(plain, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof value !== "function" || typeof property !== "string")
        return value
      return (...args: unknown[]) => {
        if (property === "step") note(`ui.step ${String(args[0])}`)
        else if (property === "askSecret")
          note(`ui.askSecret ${String(args[0])} ${String(args[1])}`)
        else if (property === "confirm") note(`ui.confirm ${String(args[0])}`)
        else note(`ui.${property}`)
        if (property === "askSecret") {
          const value = typed.shift()
          if (value !== undefined) return Promise.resolve(value)
        }
        const result = (value as (...rest: unknown[]) => unknown).apply(
          target,
          args
        )
        if (property !== "deploy") return result
        const view = result as ReturnType<Ui["deploy"]>
        return {
          stage: (stage: string, info: unknown) => (
            note(`deploy.stage ${stage}`),
            view.stage(stage as never, info as never)
          ),
          progress: (line: string) => (
            note(`deploy.progress ${line}`),
            view.progress(line)
          ),
          end: (ending: { outcome: string }) => (
            note(`deploy.end ${ending.outcome}`),
            view.end(ending as never)
          ),
        }
      }
    },
  })
  const keyStore = m.deps.keyStore
  const counted: KeyStore = {
    get: (name) => (note("keychain.get"), keyStore.get(name)),
    set: (name, value) => (note("keychain.set"), keyStore.set(name, value)),
    delete: (name) => (note("keychain.delete"), keyStore.delete(name)),
  }
  const connect = m.deps.connect
  const deps: Deps = {
    ...m.deps,
    keyStore: counted,
    ui: wrapped,
    connect: (target, localRunner, options) => (
      note(`connect ${target.kind}${options?.batch ? " batch" : ""}`),
      connect(target, localRunner, options)
    ),
  }
  return {
    async run(step: Step): Promise<Transcript> {
      calls = []
      typed.splice(0, typed.length, ...(step.typed ?? []))
      const code = await run(step.argv, deps)
      return { argv: step.argv.map(normalize), code, calls }
    },
  }
}

const where = ["--app", "web", "--server", "dev"]

/** Runs the steps on one machine, in order, and gives back what each did. */
async function scene(
  m: Machine,
  steps: readonly Step[],
  extra: readonly (readonly [string, string])[] = []
): Promise<Transcript[]> {
  const normalize = normalizer([
    [m.home, "<home>"],
    [m.project, "<project>"],
    ...extra,
  ])
  const r = recorder(m, normalize)
  const records: Transcript[] = []
  for (const step of steps) records.push(await r.run(step))
  return records
}

const s = (...argv: string[]): Step => ({ argv })

/** No team on this machine: every command, and wrong usage. */
export async function noTeam(): Promise<Transcript[]> {
  const m = machine()
  m.compose(COMPOSE_V1)
  return scene(m, [
    s(),
    s("--help"),
    s("-h"),
    s("help"),
    s("nope"),
    s("--bogus"),
    s("init"),
    s("server"),
    s("server", "ls"),
    s("server", "ls", "extra"),
    s("server", "add", "dev", "--local"),
    s("server", "add", "dev"),
    s("server", "update"),
    s("server", "update", "dev"),
    s("server", "update", "dev", "--yes"),
    s("secret"),
    s("secret", "set"),
    s("secret", "set", "GREETING"),
    s("secret", "set", "GREETING", "hunter2"),
    s("secret", "set", "GREETING", ...where),
    s("secret", "rm", "GREETING"),
    s("secret", "ls"),
    s("secret", "ls", ...where),
    s("deploy"),
    s("deploy", "--json"),
    s("deploy", "extra"),
    s("deploy", ...where),
    s("rollback"),
    s("rollback", "--to", "x"),
    s("status"),
    s("status", "--json"),
    s("status", "--server", "dev"),
    s("logs", "--no-follow"),
    s("logs", "--tail", "9999"),
    s("link"),
    s("link", ...where),
  ])
}

/** A team with no server yet. */
export async function noServer(): Promise<Transcript[]> {
  const m = machine()
  m.compose(COMPOSE_V1)
  return scene(m, [
    s("init", "--name", "Ada"),
    s("server", "ls"),
    s("status"),
    s("status", "--server", "dev"),
    s("deploy"),
    s("deploy", "--server", "dev"),
    s("deploy", ...where),
    s("rollback", ...where),
    s("secret", "set", "GREETING", ...where),
    s("secret", "ls", "--server", "dev"),
    s("logs", ...where, "--no-follow"),
    s("link", ...where),
    s("server", "update", "dev"),
  ])
}

/** A team, one server and then two, in a folder that is not linked; then linked. */
export async function servers(): Promise<Transcript[]> {
  const m = machine()
  m.compose(COMPOSE_V1)
  const staging = tempDir("staging")
  m.docker.ps(
    "web",
    '{"Service":"web","State":"running","ExitCode":0,"Health":""}\n'
  )
  // A server's line with an escape sequence and a tab in it: plain output cleans it.
  m.docker.logs(
    "web",
    "web-1     | 2026-11-13T16:56:04.136118801Z \x1b[31mstarted\x1b[0m on\t8080\n"
  )
  return scene(
    m,
    [
      s("init", "--name", "Ada"),
      s("init", "--name", "Bob"),
      s("server", "add", "dev", "--local"),
      s("server", "add", "dev", "--local"),
      s("server", "add", "Bad", "--local"),
      s("server", "ls"),
      // One server: nothing is filled in without a terminal either.
      s("status"),
      s("deploy"),
      s("deploy", "--server", "dev"),
      s("secret", "ls", "--server", "dev"),
      s("server", "add", "staging", "--local", "--home", staging),
      s("server", "ls"),
      s("server", "ls", "--json"),
      s("status"),
      s("status", "--json"),
      s("status", "--server", "nope"),
      s("status", "--server", "dev"),
      s("status", "--server", "dev", "--json"),
      s("secret", "set", "GREETING"),
      s("secret", "set", "GREETING", "--server", "dev"),
      s("secret", "set", "--app", "web", "--server", "dev"),
      s("secret", "set", "A=b", ...where),
      s("secret", "set", "PATH", ...where),
      s("secret", "set", "1X", ...where),
      { argv: ["secret", "set", "GREETING", ...where], typed: ["hello"] },
      s("secret", "set", "OTHER", ...where),
      { argv: ["secret", "set", "MULTI", ...where], typed: ["a\nb"] },
      s("secret", "ls"),
      s("secret", "ls", "--server", "dev"),
      s("secret", "ls", ...where),
      s("secret", "ls", ...where, "--json"),
      s("deploy"),
      s("deploy", "--server", "dev"),
      s("deploy", "--app", "web"),
      s("deploy", ...where),
      s("deploy", ...where, "--json"),
      s("deploy", ...where, "-f", "missing.yaml"),
      s("deploy", "--app", "Bad", "--server", "dev"),
      s("rollback"),
      s("rollback", "--server", "dev"),
      s("rollback", ...where, "--to", "x"),
      s("rollback", ...where, "--to", "9"),
      s("rollback", ...where),
      s("rollback", ...where, "--json", "--to", "1"),
      s("status", "--server", "dev"),
      s("logs"),
      s("logs", "--no-follow"),
      s("logs", "--server", "dev", "--no-follow"),
      s("logs", "--tail", "9999", "--server", "dev"),
      s("logs", ...where, "--no-follow"),
      s("logs", ...where, "--no-follow", "--tail", "1"),
      s("logs", ...where),
      s("logs", "--app", "nope", "--server", "dev", "--no-follow"),
      s("secret", "rm", "GREETING"),
      s("secret", "rm", "--app", "web", "--server", "dev"),
      s("secret", "rm", "NEVER", ...where),
      s("secret", "rm", "GREETING", ...where),
      s("secret", "ls", ...where),
      s("server", "update"),
      s("server", "update", "nope"),
      s("server", "update", "dev"),
      s("server", "update", "staging", "--yes"),
      s("link"),
      s("link", "--server", "dev"),
      s("link", "--app", "web"),
      s("link", ...where, "-f", "missing.yaml"),
      s("link", ...where),
      s("link"),
      s("link", ...where),
      s("link", "--app", "api", "--server", "staging"),
      s("status"),
      s("deploy"),
      s("secret", "ls"),
      s("deploy", "--server", "staging"),
      s("link", "--app", "api", "--server", "staging", "--force"),
      s("deploy", "--json"),
    ],
    [[staging, "<staging>"]]
  )
}

/** A zekno.json that is not signed by the team: every command that would take a name from it. */
export async function unsignedLink(): Promise<Transcript[]> {
  const m = machine()
  m.compose(COMPOSE_V1)
  const setup = await scene(m, [
    s("init", "--name", "Ada"),
    s("server", "add", "dev", "--local"),
  ])
  await Bun.write(
    join(m.project, "zekno.json"),
    `${JSON.stringify({ app: "web", server: "dev", compose: "compose.yaml" })}\n`
  )
  return [
    ...setup,
    ...(await scene(m, [
      s("status"),
      s("status", "--json"),
      s("deploy"),
      s("deploy", "--server", "dev"),
      s("rollback"),
      s("logs", "--no-follow"),
      s("secret", "set", "GREETING"),
      s("secret", "rm", "GREETING"),
      s("secret", "ls"),
      s("link"),
      s("link", ...where),
      s("status", "--server", "dev"),
      s("deploy", ...where),
    ])),
  ]
}

/** A zekno.json signed by the team on one machine, met for the first time by the same member's second machine. */
export async function signedElsewhere(): Promise<Transcript[]> {
  const m = machine()
  m.compose(COMPOSE_V1)
  const first = await scene(m, [
    s("init", "--name", "Ada"),
    s("server", "add", "dev", "--local"),
    s("link", ...where),
    s("deploy"),
  ])
  const other = await twin(m)
  other.deps.cwd = m.project
  return [
    ...first,
    ...(await scene(
      other,
      [
        s("status"),
        s("deploy"),
        s("deploy", "--json"),
        s("rollback"),
        s("logs", "--no-follow"),
        s("secret", "set", "GREETING"),
        s("secret", "rm", "GREETING"),
        s("secret", "ls"),
        s("deploy", "--server", "dev"),
        s("link"),
        s("link", "--yes"),
        s("status"),
        s("secret", "ls"),
      ],
      [
        [m.project, "<project>"],
        [m.home, "<first-home>"],
      ]
    )),
  ]
}

/** Every scene, by name. */
export const SCENES = {
  noTeam,
  noServer,
  servers,
  unsignedLink,
  signedElsewhere,
} as const
