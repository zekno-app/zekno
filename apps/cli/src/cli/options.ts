/**
 * The options each command reads, and which commands need a team, moved out
 * of cli.ts before it grew past 500 lines (specs/015-domains-https, plan.md;
 * tasks T044). An option only one command reads is parsed for that command
 * alone: given to any other, parsing fails exactly as it did before that
 * command existed, with the same sentence and status 2 (specs/012-templates,
 * research R9; FR-019).
 */
import { parseArgs } from "node:util"

/** The commands that work without a team, or make one: at a terminal every other command with no team says A3. */
export const WITHOUT_TEAM = new Set([
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
  // specs/012-templates: with no server it says AD1 (contracts/commands.md).
  "add",
  // specs/015-domains-https, CL2: they only change the settings file, as `zekno settings set` does.
  "domain add",
  "domain rm",
])

/**
 * The options each command of these takes; any other given to one is
 * refused (specs/010-app-settings, security review S7): `--app`, `--server`
 * or `-f` would look like a deploy's and change nothing here.
 */
export const OWN_OPTIONS: Record<string, readonly string[]> = {
  settings: ["json"],
  "settings set": ["yes"],
  "settings unset": ["yes"],
  "settings compose": [],
  "settings init": [],
  // specs/015-domains-https, CL2: `--json` gives the change, and the record when known.
  "domain add": ["service", "yes", "json"],
  "domain rm": ["yes", "json"],
  // CL4: the folder's linked app and server, from its zekno.json only.
  domain: ["json"],
}

/** The options every command read before feature 012, as `parseArgs` takes them. */
const OPTIONS = {
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
} as const

/** The options only `zekno add` reads (specs/012-templates). */
const ADD_ONLY = {
  for: { type: "string", multiple: true },
  list: { type: "boolean" },
  show: { type: "boolean" },
} as const

/** The option only `zekno domain add` reads (specs/015-domains-https, CL2). */
const DOMAIN_ONLY = {
  service: { type: "string" },
} as const

/** The option only `zekno deploy` reads (specs/015-domains-https, CL3): on another command it is an unknown option. */
const DEPLOY_ONLY = {
  "skip-dns-check": { type: "boolean" },
} as const

/**
 * The words and options of a run. Every command is parsed first with the
 * option table it had before the options of `zekno add`, of `zekno domain`
 * and of `zekno deploy --skip-dns-check` came, plus its own, so an option
 * another command reads, or anything else wrong, fails exactly as it did:
 * the same sentence, status 2.
 */
export function parsed(args: string[]) {
  const options = { ...OPTIONS, ...ADD_ONLY, ...DOMAIN_ONLY, ...DEPLOY_ONLY }
  const at = { args, allowPositionals: true } as const
  const first = parseArgs({ ...at, strict: false, options }).positionals[0]
  const own =
    first === "add"
      ? { ...OPTIONS, ...ADD_ONLY }
      : first === "domain"
        ? { ...OPTIONS, ...DOMAIN_ONLY }
        : first === "deploy"
          ? { ...OPTIONS, ...DEPLOY_ONLY }
          : OPTIONS
  parseArgs({ ...at, strict: true, options: own })
  return parseArgs({ ...at, strict: true, options })
}

/** Said when a command with options of its own is given one it does not take. `-f` is the short form of `--file`. */
export const optionNotTaken = (name: string, option: string): string =>
  `\`zekno ${name}\` does not take ${option === "file" ? "`-f`" : `\`--${option}\``}.`
