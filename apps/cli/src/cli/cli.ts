import { CoreError, LIMITS, SECRET_NAME } from "@workspace/core"
import { parseArgs } from "node:util"

import { NO_TEAM_AT_TERMINAL, whichApp, whichServer } from "../asking/asking"
import { deployAtTerminal } from "../asking/first-deploy"
import { deploy, rollback } from "../commands/deploy"
import { doctor } from "../commands/doctor"
import { init } from "../commands/init"
import { link } from "../commands/link"
import { logs, parseTail } from "../commands/logs"
import {
  readImport,
  secretImport,
  secretList,
  secretRemove,
  secretSet,
  type ImportRead,
} from "../commands/secret"
import { serverAdd, serverList, serverUpdate } from "../commands/server"
import {
  settingsCompose,
  settingsInit,
  settingsSet,
  settingsShow,
  settingsUnset,
} from "../commands/settings"
import { status } from "../commands/status"
import { teamOnce, type Deps } from "./context"
import { CliError, UsageError, WrongInput } from "./errors"
import { checkTo } from "../ops/deploy"
import { checkSecretName, sayWhichSecret } from "../ops/secret"
import { profileStore } from "../profile/profile"
import { findProject, isHere, type ProjectLink } from "../project/file"
import { withProject } from "../project/project"
import { notSignedHere, standingOf } from "../project/signed"
import { alreadyLinked } from "../project/write"
import { chooseSource } from "../settings/source"
import { DP2 } from "../settings/words"
import { RUNNER_RELEASE } from "../version/runner-release"
import {
  checkNewest,
  NEWEST,
  newerExists,
  NOT_CHECKED,
} from "../version/newest"
import { versionCells, versionLines, versionObject } from "../version/version"

export const HELP = `zekno: deploy to your own servers. Secrets are encrypted and deploys are signed on this machine.

  zekno init --name <you>
  zekno server add <name> --ssh <user@host> [--runner-path <path>]
  zekno server add <name> --ssh <user@host> --runner-file <path>  (development only)
  zekno server add <name> --local [--home <dir>]
  zekno server update <name> [--yes]
  zekno server ls
  zekno secret set <NAME> [--app <app>] [--server <name>] [--stdin]
  zekno secret import <file> [--app <app>] [--server <name>] [--yes]
  zekno secret rm <NAME> [--app <app>] [--server <name>]
  zekno secret ls [--app <app>] [--server <name>]
  zekno deploy [--app <app>] [--server <name>] [-f <compose file>] [--json]
  zekno rollback [--app <app>] [--server <name>] [--to <number>] [--json]
  zekno status [--server <name>] [--json]
  zekno logs [--app <app>] [--server <name>] [--tail <n>] [--no-follow]
  zekno link [--app <app>] [--server <name>] [-f <compose file>] [--force] [--yes]
  zekno settings [--json]
  zekno settings set <service>.<setting> <value> [--yes]
  zekno settings unset <service>.<setting> [--yes]
  zekno settings compose
  zekno settings init
  zekno doctor [--server <name>] [--json]
  zekno version [--json]
  zekno --version [--json]

In a folder linked with \`zekno link\`, --app, --server and -f come from its zekno.json. Flags win over it.
At a terminal a command asks for a server or an app it was not given, and \`zekno deploy\` sets up what a first deploy needs. In a script it asks nothing.`

/** How many words each command takes, counting its own name. */
const WORDS: Record<string, number> = {
  init: 1,
  "server add": 3,
  "server update": 3,
  "server ls": 2,
  "secret set": 3,
  "secret import": 3,
  "secret rm": 3,
  "secret ls": 2,
  deploy: 1,
  rollback: 1,
  status: 1,
  logs: 1,
  link: 1,
  settings: 1,
  "settings set": 4,
  "settings unset": 3,
  "settings compose": 2,
  "settings init": 2,
  doctor: 1,
  version: 1,
}

/**
 * Said when a value follows `zekno secret set NAME`, worded as on the board
 * "Status, lists, errors and piped output". The name is repeated only when it
 * is one: it is put in front of a person as a command to type.
 */
export function valueAsArgument(name: string | undefined): string {
  const shown =
    name !== undefined &&
    SECRET_NAME.test(name) &&
    name.length <= LIMITS.secretNameLength
      ? name
      : "<NAME>"
  return `A secret value is never given as an argument. It would stay in your shell history. Run \`zekno secret set ${shown}\` and type it when asked.`
}

/** The commands that work without a team, or make one: at a terminal every other command with no team says A3. */
const WITHOUT_TEAM = new Set([
  "init",
  "deploy",
  "doctor",
  "version",
  // specs/010-app-settings: the settings commands need no team (contracts/commands.md).
  "settings",
  "settings set",
  "settings unset",
  "settings compose",
  "settings init",
])

/** The project file that applies to `cwd`, or undefined, also when it cannot be read: for a check that may only stop a command early. */
function readableProject(cwd: string): ProjectLink | undefined {
  try {
    return findProject(cwd)
  } catch {
    return undefined
  }
}

/** The options each settings command takes; any other given to one is refused (security review S7). */
const SETTINGS_OPTIONS: Record<string, readonly string[]> = {
  settings: ["json"],
  "settings set": ["yes"],
  "settings unset": ["yes"],
  "settings compose": [],
  "settings init": [],
}

/** Said when a settings command is given an option it does not take. `-f` is the short form of `--file`. */
export const optionNotTaken = (name: string, option: string): string =>
  `\`zekno ${name}\` does not take ${option === "file" ? "`-f`" : `\`--${option}\``}.`

/**
 * Runs one command and returns the exit status: 0 for success, 1 when the
 * action failed or was refused, 2 for wrong usage.
 */
export async function run(argv: string[], given: Deps): Promise<number> {
  // One verified team for the whole command, opened when first needed: judging zekno.json and the operation read the keychain once between them.
  const team = teamOnce(given)
  const deps: Deps = { ...given, team: team.take }
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        name: { type: "string" },
        ssh: { type: "string" },
        local: { type: "boolean" },
        home: { type: "string" },
        "runner-path": { type: "string" },
        "runner-file": { type: "string" },
        yes: { type: "boolean" },
        app: { type: "string" },
        server: { type: "string" },
        stdin: { type: "boolean" },
        file: { type: "string", short: "f" },
        to: { type: "string" },
        tail: { type: "string" },
        "no-follow": { type: "boolean" },
        force: { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean" },
      },
    })
    const [command, second, third] = positionals
    // `--help` wins over everything, `--version` included (contracts/version.md).
    if (values.help || (!command && !values.version) || command === "help") {
      deps.ui.info(HELP)
      return command || values.help ? 0 : 2
    }

    const grouped =
      command === "server" || command === "secret" || command === "settings"
    const name = `${command} ${grouped ? (second ?? "") : ""}`.trim()
    // Nothing may trail a command. In particular a secret value is never an argument:
    // it would stay in the shell's history and show in the list of processes.
    if (positionals.length > (WORDS[name] ?? Infinity)) {
      throw new UsageError(
        name === "secret set"
          ? valueAsArgument(third)
          : `Unexpected "${positionals[WORDS[name]!]}" after \`zekno ${name}\`.`
      )
    }
    // The settings commands take only their own options: `--app`, `--server` or `-f` would look like a deploy's and change
    // nothing here (specs/010-app-settings, security review S7). Every other command reads its arguments as before.
    const unused = Object.hasOwn(SETTINGS_OPTIONS, name)
      ? Object.keys(values).find(
          (option) => !SETTINGS_OPTIONS[name]!.includes(option)
        )
      : undefined
    if (unused !== undefined) throw new UsageError(optionNotTaken(name, unused))

    // The two versions built into the program, before anything opens the team: no keychain, no profile, no connection, no file.
    // Only the command `version` then asks GitHub whether a newer release exists; `--version` never uses the network (FR-036).
    if (values.version || command === "version") {
      const runner = (deps.release ?? RUNNER_RELEASE).version
      const latest =
        command === "version" ? await checkNewest(deps, runner) : undefined
      if (values.json) {
        deps.ui.json(
          latest === undefined
            ? versionObject(runner)
            : { ...versionObject(runner), latest }
        )
        return 0
      }
      const cells = versionCells(runner)
      versionLines(runner).forEach((line, index) =>
        deps.ui.line(line, cells[index])
      )
      if (latest?.state === "newest") deps.ui.success(NEWEST)
      // At a terminal its first sentence is bold, as the board "The version, and a newer release" draws it; plain output is unchanged.
      else if (latest?.state === "newer")
        deps.ui.warn(newerExists(latest.version), { firstBold: true })
      else if (latest?.state === "not_checked") deps.ui.note(NOT_CHECKED)
      return 0
    }

    // At a terminal a command asks for a server or an app it was not given (specs/006-cli-small-features, contracts/questions.md,
    // plan.md "What each command asks"). Where nobody can answer, `asks` is false and every command takes the path it always took.
    const atTerminal = deps.ui.asks

    // Details not given as flags come from the project file, when it is signed by the team and in use here (contracts/commands.md). Flags win.
    // At a terminal a file not signed by the team is named and left aside, and the command asks instead (research R6).
    const project = (wanted: Parameters<typeof withProject>[2]) =>
      withProject(deps.cwd, values, wanted, {
        profile: deps.home,
        trust: team.trust,
        confirm: (question, refusal) => deps.ui.confirm(question, refusal),
        ...(atTerminal
          ? { leaveAside: (sentence: string) => deps.ui.warn(sentence) }
          : {}),
      })

    /**
     * The details a command acts on: the flags, then the project file, then,
     * at a terminal, a question for each one still missing, the server first
     * (`whichServer`: the one server is used and said) and then the app
     * (`whichApp`, the server's apps). What is asked is handed on as if it
     * had been typed. Given everything, nothing is read and nothing is asked.
     */
    const details = async (wanted: readonly ("app" | "server")[]) => {
      const given = await project(wanted)
      if (!atTerminal || wanted.every((detail) => given[detail] !== undefined))
        return given
      const opened = await team.peek()
      const { server } = await whichServer(deps, opened, given)
      if (!wanted.includes("app")) return { ...given, server: server.name }
      const linked = given.app !== undefined && values.app === undefined
      const { app } = await whichApp(
        deps,
        opened,
        server,
        { app: given.app, linked },
        { offerNew: false, folder: deps.cwd }
      )
      return { ...given, server: server.name, app }
    }

    /**
     * What `zekno link` acts on at a terminal: it asks for the server and the
     * app only when no zekno.json applies here, or the one that applies is
     * not signed by the team (named first, and never used). A file signed by
     * the team is recorded as it always was, after the first-use question.
     */
    const linkDetails = async () => {
      if (values.app !== undefined && values.server !== undefined) return values
      const found = findProject(deps.cwd)
      if (
        found &&
        standingOf(found, await team.trust(), deps.home).kind !== "unsigned"
      )
        return values
      if (found) deps.ui.warn(notSignedHere(found, deps.cwd))
      // A zekno.json is written next, naming the one file here: with both and no -f that is DP2, said before anything is asked (contracts/deploy.md, "zekno link").
      if (
        values.file === undefined &&
        chooseSource(deps.cwd, {}).kind === "both"
      )
        throw new WrongInput(DP2)
      const opened = await team.peek()
      const { server } = await whichServer(deps, opened, {
        server: values.server,
      })
      const { app } = await whichApp(
        deps,
        opened,
        server,
        { app: values.app },
        { offerNew: false, folder: deps.cwd }
      )
      return { ...values, server: server.name, app }
    }

    // The file of `zekno secret import`, read and parsed whole before any question and before the team is opened (contracts/import.md, "Order of checks").
    let imported: ImportRead | undefined
    if (atTerminal && Object.hasOwn(WORDS, name) && !WITHOUT_TEAM.has(name)) {
      // With no team, the way to make one: `zekno deploy` makes it from nothing (A3).
      if (!profileStore(deps.home).exists())
        throw new CliError(NO_TEAM_AT_TERMINAL)
      // What needs no answer is checked before any question (research R1). Only the order of failures at a terminal changes.
      if (name === "secret import") imported = readImport(deps.cwd, third)
      if (name === "secret set") checkSecretName(third)
      if (name === "secret rm" && !third)
        throw new UsageError(sayWhichSecret("rm"))
      if (name === "rollback") checkTo(values.to)
      if (name === "logs") parseTail(values.tail)
      if (name === "link" && !values.force) {
        // Linking would have to replace a file here that is not the team's, which only `--force` does: said before anything is asked.
        const here = readableProject(deps.cwd)
        if (
          here &&
          isHere(here, deps.cwd) &&
          standingOf(here, await team.trust(), deps.home).kind === "unsigned"
        )
          throw new CliError(alreadyLinked(deps.cwd))
      }
    }

    switch (name) {
      case "init":
        await init(deps, values)
        return 0
      case "server add":
        await serverAdd(deps, third, values)
        return 0
      case "server update":
        // The positional name is the server: at a terminal it is asked for when missing, the one server used and said.
        await serverUpdate(
          deps,
          atTerminal && third === undefined
            ? (await whichServer(deps, await team.peek(), {})).server.name
            : third,
          values
        )
        return 0
      case "server ls":
        await serverList(deps)
        return 0
      case "secret set":
        await secretSet(deps, third, await details(["app", "server"]))
        return 0
      case "secret import": {
        const read = imported ?? readImport(deps.cwd, third)
        await secretImport(deps, read, await details(["app", "server"]), {
          yes: values.yes === true,
        })
        return 0
      }
      case "secret rm":
        await secretRemove(deps, third, await details(["app", "server"]))
        return 0
      case "secret ls":
        await secretList(deps, await details(["app", "server"]))
        return 0
      case "deploy":
        // At a terminal it sets up what is missing and asks for what was not given (contracts/first-deploy.md); in a script it is as it always was.
        if (deps.ui.asks)
          return await deployAtTerminal(deps, team, {
            app: values.app,
            server: values.server,
            file: values.file,
          })
        return await deploy(deps, {
          ...(await project(["app", "server", "file"])),
          typed: { app: values.app, server: values.server },
        })
      case "rollback":
        return await rollback(deps, {
          ...(await details(["app", "server"])),
          typed: { app: values.app, server: values.server },
        })
      case "status":
        await status(deps, await details(["server"]))
        return 0
      case "logs":
        await logs(deps, await details(["app", "server"]))
        return 0
      case "link":
        await link(deps, atTerminal ? await linkDetails() : values)
        return 0
      case "settings":
        // It reads this folder's zekno.app.json and never asks; it may open the team to verify the history (ops/settings.ts).
        await settingsShow(deps, { json: values.json })
        return 0
      case "settings set":
        // The value is the fourth word: one argument, quoted for a start command (contracts/commands.md). It contacts no server.
        return await settingsSet(deps, third, positionals[3], {
          yes: values.yes === true,
        })
      case "settings unset":
        return await settingsUnset(deps, third, { yes: values.yes === true })
      case "settings compose":
        // What a deploy of this folder would sign, byte for byte; no team, no keychain, no server.
        settingsCompose(deps)
        return 0
      case "settings init":
        return await settingsInit(deps)
      case "doctor":
        // It never asks and takes nothing from zekno.json: no `withProject`, no asking step (contracts/doctor.md).
        return await doctor(deps, { server: values.server, json: values.json })
      default:
        throw new UsageError(`Unknown command "${positionals.join(" ")}".`)
    }
  } catch (error) {
    if (error instanceof CliError) {
      deps.ui.error(error.message)
      return 1
    }
    if (error instanceof CoreError) {
      deps.ui.error(`That could not be done (${error.code}).`)
      return 1
    }
    // Its sentence already says what to do: no help line (specs/010-app-settings, research R9 item 16).
    if (error instanceof WrongInput) {
      deps.ui.error(error.message)
      return 2
    }
    if (
      error instanceof UsageError ||
      (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
    ) {
      deps.ui.error(
        `${(error as Error).message}\nRun \`zekno --help\` for the list of commands.`
      )
      return 2
    }
    throw error
  }
}
