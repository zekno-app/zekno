import { CoreError, LIMITS, SECRET_NAME } from "@workspace/core"
import { parseArgs } from "node:util"

import { deploy, rollback } from "./commands/deploy"
import { init } from "./commands/init"
import { link } from "./commands/link"
import { logs } from "./commands/logs"
import { secretList, secretRemove, secretSet } from "./commands/secret"
import { serverAdd, serverList, serverUpdate } from "./commands/server"
import { status } from "./commands/status"
import { teamOnce, type Deps } from "./context"
import { CliError, UsageError } from "./errors"
import { checkNewest, NEWEST, newerExists, NOT_CHECKED } from "./newest"
import { withProject } from "./project"
import { RUNNER_RELEASE } from "./runner-release"
import { versionCells, versionLines, versionObject } from "./version"

export const HELP = `zekno: deploy to your own servers. Secrets are encrypted and deploys are signed on this machine.

  zekno init --name <you>
  zekno server add <name> --ssh <user@host> [--runner-path <path>]
  zekno server add <name> --ssh <user@host> --runner-file <path>  (development only)
  zekno server add <name> --local [--home <dir>]
  zekno server update <name> [--yes]
  zekno server ls
  zekno secret set <NAME> [--app <app>] [--server <name>] [--stdin]
  zekno secret rm <NAME> [--app <app>] [--server <name>]
  zekno secret ls [--app <app>] [--server <name>]
  zekno deploy [--app <app>] [--server <name>] [-f <compose file>] [--json]
  zekno rollback [--app <app>] [--server <name>] [--to <number>] [--json]
  zekno status [--server <name>] [--json]
  zekno logs [--app <app>] [--server <name>] [--tail <n>] [--no-follow]
  zekno link [--app <app>] [--server <name>] [-f <compose file>] [--force] [--yes]
  zekno version [--json]
  zekno --version [--json]

In a folder linked with \`zekno link\`, --app, --server and -f come from its zekno.json. Flags win over it.`

/** How many words each command takes, counting its own name. */
const WORDS: Record<string, number> = {
  init: 1,
  "server add": 3,
  "server update": 3,
  "server ls": 2,
  "secret set": 3,
  "secret rm": 3,
  "secret ls": 2,
  deploy: 1,
  rollback: 1,
  status: 1,
  logs: 1,
  link: 1,
  version: 1,
}

/**
 * Said when a value follows `zekno secret set NAME`, worded as on the board
 * "Status, lists, errors and piped output". The name is repeated only when it
 * is one: it is put in front of a person as a command to type.
 */
export function valueAsArgument(name: string | undefined): string {
  const shown = name !== undefined && SECRET_NAME.test(name) && name.length <= LIMITS.secretNameLength ? name : "<NAME>"
  return `A secret value is never given as an argument. It would stay in your shell history. Run \`zekno secret set ${shown}\` and type it when asked.`
}

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

    const grouped = command === "server" || command === "secret"
    const name = `${command} ${grouped ? (second ?? "") : ""}`.trim()
    // Nothing may trail a command. In particular a secret value is never an argument:
    // it would stay in the shell's history and show in the list of processes.
    if (positionals.length > (WORDS[name] ?? Infinity)) {
      throw new UsageError(name === "secret set" ? valueAsArgument(third) : `Unexpected "${positionals[WORDS[name]!]}" after \`zekno ${name}\`.`)
    }

    // The two versions built into the program, before anything opens the team: no keychain, no profile, no connection, no file.
    // Only the command `version` then asks GitHub whether a newer release exists; `--version` never uses the network (FR-036).
    if (values.version || command === "version") {
      const runner = (deps.release ?? RUNNER_RELEASE).version
      const latest = command === "version" ? await checkNewest(deps, runner) : undefined
      if (values.json) {
        deps.ui.json(latest === undefined ? versionObject(runner) : { ...versionObject(runner), latest })
        return 0
      }
      const cells = versionCells(runner)
      versionLines(runner).forEach((line, index) => deps.ui.line(line, cells[index]))
      if (latest?.state === "newest") deps.ui.success(NEWEST)
      else if (latest?.state === "newer") deps.ui.warn(newerExists(latest.version))
      else if (latest?.state === "not_checked") deps.ui.note(NOT_CHECKED)
      return 0
    }

    // Details not given as flags come from the project file, when it is signed by the team and in use here (contracts/commands.md). Flags win.
    const project = (wanted: Parameters<typeof withProject>[2]) =>
      withProject(deps.cwd, values, wanted, {
        profile: deps.home,
        trust: team.trust,
        confirm: (question, refusal) => deps.ui.confirm(question, refusal),
      })
    switch (name) {
      case "init":
        await init(deps, values)
        return 0
      case "server add":
        await serverAdd(deps, third, values)
        return 0
      case "server update":
        await serverUpdate(deps, third, values)
        return 0
      case "server ls":
        await serverList(deps)
        return 0
      case "secret set":
        await secretSet(deps, third, await project(["app", "server"]))
        return 0
      case "secret rm":
        await secretRemove(deps, third, await project(["app", "server"]))
        return 0
      case "secret ls":
        await secretList(deps, await project(["app", "server"]))
        return 0
      case "deploy":
        return await deploy(deps, { ...(await project(["app", "server", "file"])), typed: { app: values.app, server: values.server } })
      case "rollback":
        return await rollback(deps, { ...(await project(["app", "server"])), typed: { app: values.app, server: values.server } })
      case "status":
        await status(deps, await project(["server"]))
        return 0
      case "logs":
        await logs(deps, await project(["app", "server"]))
        return 0
      case "link":
        await link(deps, values)
        return 0
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
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      deps.ui.error(`${(error as Error).message}\nRun \`zekno --help\` for the list of commands.`)
      return 2
    }
    throw error
  }
}
