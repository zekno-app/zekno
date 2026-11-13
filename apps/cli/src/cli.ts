import { CoreError } from "@workspace/core"
import { parseArgs } from "node:util"

import { deploy, rollback } from "./commands/deploy"
import { init } from "./commands/init"
import { logs } from "./commands/logs"
import { secretList, secretRemove, secretSet } from "./commands/secret"
import { serverAdd, serverList, serverUpdate } from "./commands/server"
import { status } from "./commands/status"
import type { Deps } from "./context"
import { CliError, UsageError } from "./errors"

export const HELP = `zekno: deploy to your own servers. Secrets are encrypted and deploys are signed on this machine.

  zekno init --name <you>
  zekno server add <name> --ssh <user@host> [--runner-path <path>]
  zekno server add <name> --ssh <user@host> --runner-file <path>  (development only)
  zekno server add <name> --local [--home <dir>]
  zekno server update <name> [--yes]
  zekno server ls
  zekno secret set <NAME> --app <app> --server <name> [--stdin]
  zekno secret rm <NAME> --app <app> --server <name>
  zekno secret ls --app <app> --server <name>
  zekno deploy --app <app> --server <name> [-f <compose file>] [--json]
  zekno rollback --app <app> --server <name> [--to <number>] [--json]
  zekno status --server <name> [--json]
  zekno logs --app <app> --server <name> [--tail <n>] [--no-follow]`

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
}

/**
 * Runs one command and returns the exit status: 0 for success, 1 when the
 * action failed or was refused, 2 for wrong usage.
 */
export async function run(argv: string[], deps: Deps): Promise<number> {
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
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    })
    const [command, second, third] = positionals
    if (values.help || !command || command === "help") {
      deps.ui.info(HELP)
      return command || values.help ? 0 : 2
    }

    const grouped = command === "server" || command === "secret"
    const name = `${command} ${grouped ? (second ?? "") : ""}`.trim()
    // Nothing may trail a command. In particular a secret value is never an argument:
    // it would stay in the shell's history and show in the list of processes.
    if (positionals.length > (WORDS[name] ?? Infinity)) {
      throw new UsageError(
        name === "secret set"
          ? "A secret value is never given as an argument. Leave it out to be asked for it, or pipe it in with `--stdin`."
          : `Unexpected "${positionals[WORDS[name]!]}" after \`zekno ${name}\`.`
      )
    }

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
        await secretSet(deps, third, values)
        return 0
      case "secret rm":
        await secretRemove(deps, third, values)
        return 0
      case "secret ls":
        await secretList(deps, values)
        return 0
      case "deploy":
        return await deploy(deps, values)
      case "rollback":
        return await rollback(deps, values)
      case "status":
        await status(deps, values)
        return 0
      case "logs":
        await logs(deps, values)
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
