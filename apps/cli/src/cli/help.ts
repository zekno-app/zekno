/**
 * The help and the words of each command (contracts/help.md of
 * specs/006-cli-small-features, and the lines each feature since adds), moved
 * out of cli.ts before it grew past 500 lines (specs/015-domains-https,
 * plan.md; tasks T044). `HELP` is still exported from cli/cli.ts, where the
 * tests and the docs read it. A line of the help is never edited: a feature
 * adds lines of its own (research R32).
 */
import { LIMITS, SECRET_NAME } from "@workspace/core"

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
  zekno domain add <domain> [--service <name>] [--yes]
  zekno domain rm <domain> [--yes]
  zekno add [<template>] [--name <service>] [--for <service>] [--app <app>] [--server <name>] [--yes]
  zekno add --list [--json]
  zekno add <template> --show [--json]
  zekno doctor [--server <name>] [--json]
  zekno version [--json]
  zekno --version [--json]

In a folder linked with \`zekno link\`, --app, --server and -f come from its zekno.json. Flags win over it.
At a terminal a command asks for a server or an app it was not given, and \`zekno deploy\` sets up what a first deploy needs. In a script it asks nothing.`

/** How many words each command takes, counting its own name. */
export const WORDS: Record<string, number> = {
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
  // specs/015-domains-https, contracts/cli.md, CL2.
  "domain add": 3,
  "domain rm": 3,
  add: 2,
  doctor: 1,
  version: 1,
}

/** The commands whose second word names what they do: `server add`, `secret set`, `settings init`, `domain add`. */
export const GROUPS = new Set(["server", "secret", "settings", "domain"])

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
