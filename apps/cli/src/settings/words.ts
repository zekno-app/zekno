/**
 * Every sentence and label of app settings (specs/010-app-settings), each
 * with its id in the contracts: SH, CS and IN in contracts/commands.md; DP in
 * contracts/deploy.md; AS in contracts/app-screen.md. Copied from there; a
 * change here is a change to a contract. The faults of a settings file (SR,
 * SJ, SV and SL in contracts/settings-file.md) are in fault-words.ts, and
 * each setting's words in setting-words.ts, split from this file past 500
 * lines (specs/016-build-from-source, contracts/cli.md CL14). Both are
 * re-exported here whole, so every sentence a person reads about settings
 * is still reached through this one module.
 *
 * A sentence is given only names that passed their rule, line numbers and
 * fixed words: never a piece of a settings file. `<file>` is a path as
 * `shownFile` cleans it.
 */
import { LATER } from "./fault-words"
import type { LaterSetting } from "./types"

export * from "./fault-words"
export * from "./setting-words"

// zekno settings, set, unset, compose, init, contracts/commands.md.

/** SH1 */
export const SH1 =
  "This folder has no settings file. Run zekno settings init to start one."
/** SH2 */
export const SH2 = (file: string): string =>
  `This folder deploys ${file}, a Compose file written by hand, so it has no settings to show.`
/**
 * SH3: the zekno.json in use here names another file than this folder's
 * `zekno.app.json`. `folder`: where that zekno.json is, when it is in a
 * folder above, as a sentence shows it; left out for this folder's own.
 */
export const SH3 = (file: string, folder?: string): string =>
  `${folder === undefined ? "This folder's zekno.json" : `The zekno.json in ${folder}`} names ${file}, so zekno deploy uses it, not the zekno.app.json here.`
/**
 * SH4 (security review S6): a zekno.json that applies here carries a
 * signature but is not in use on this machine yet, and names another file
 * than the one here: a deploy asks about it first, and a yes deploys that
 * file. `folder` as for SH3. `here`: the file a deploy here uses today, as a
 * sentence shows it, this folder's `zekno.app.json` unless it is a Compose
 * file written by hand (specs/012-templates, security review T4).
 */
export const SH4 = (
  file: string,
  folder?: string,
  here = "zekno.app.json"
): string =>
  `${folder === undefined ? "This folder's zekno.json" : `The zekno.json in ${folder}`} names ${file} and is not in use on this machine yet: zekno deploy asks about it first, and a yes deploys ${file}, not the ${here} here.`
/** CS1, for `set` or `unset`. */
export const CS1 = (verb: "set" | "unset"): string =>
  verb === "set"
    ? "Say which setting: `zekno settings set <service>.<setting> <value>`."
    : "Say which setting: `zekno settings unset <service>.<setting>`."
/** CS2 */
export const CS2 =
  "Say the new value: `zekno settings set <service>.<setting> <value>`."
/**
 * CS4. `svc` undefined: the name given broke the service rule, so it is not
 * repeated ("no such service"). One service: "Its service is web."
 */
export const CS4 = (
  file: string,
  svc: string | undefined,
  services: readonly string[]
): string => {
  const missing = svc === undefined ? "no such service" : `no service ${svc}`
  const list =
    services.length === 1
      ? `Its service is ${services[0]}.`
      : `Its services are ${services.join(", ")}.`
  return `${file} has ${missing}. ${list}`
}
/** CS5, naming the settings of specs/015-domains-https (CL1) in the order of the file. */
export const CS5 =
  "There is no such setting. The settings are image, start, restart, memory, cpus, health, health-timeout, port, publish, domains, secrets, plain.<NAME> and volumes.<name>."
/** CS6: SL's second sentence for that setting. */
export const CS6 = (setting: Exclude<LaterSetting, "version">): string =>
  LATER[setting].second
/** CS7: `That is not <a label>.` then the rule. */
export const CS7 = (notA: string, rule: string): string => `${notA} ${rule}`
/** CS8 */
export const CS8 = (svc: string, label: string, old: string): string =>
  `${svc} · ${label} is ${old} already. Nothing was written.`
/** CS9: `file` is the settings file changed, as the deploy names it. */
export const CS9 = (file: string): string =>
  `Write this to ${file}? Nothing is deployed until you deploy.`
/** CS10 */
export const CS10 = (file: string): string =>
  `There is no terminal to ask on. Add \`--yes\` to write it to ${file}.`
/** CS11: the text and its detail. */
export const CS11 = { text: "Written", detail: "Run zekno deploy to use it." }
/** CS11's text when the file written is not this folder's own `zekno.app.json` (security review S7). */
export const CS11_TO = (file: string): string => `Written to ${file}`
/** CS12 */
export const CS12 = (file: string): string =>
  `${file} changed since zekno read it, so nothing was written. Try again.`
/** CS13 */
export const CS13 = (file: string): string =>
  `${file} is a symbolic link. zekno changes it only as a file of its own.`
/** CS14 */
export const CS14 = (file: string): string => `Could not write ${file}.`
/** CS15 */
export const CS15 = "A service needs an image, so source.image cannot be unset."
/** CS16 */
export const CS16 = (svc: string, label: string): string =>
  `${svc} · ${label} is not set. Nothing was written.`
/** CS17: `That change cannot be written.` then the place and rule it breaks. */
export const CS17 = (place: string, rule: string): string =>
  `That change cannot be written. ${place === "" ? rule : `${place}: ${rule}`}`
/** IN1, the question. */
export const IN1 = "Image"
/** IN2, the question. */
export const IN2 = "Service name"
/** IN3: the text and its detail. */
export const IN3 = {
  text: "Written zekno.app.json",
  detail: "Run zekno deploy to use it.",
}
/** IN4 */
export const IN4 =
  "There is already a zekno.app.json here. Change it with zekno settings set, or in an editor."
/** IN5 */
export const IN5 =
  "There is no terminal to ask on. Run zekno settings init at a terminal, or write zekno.app.json yourself."
/** IN7: on a disk that ignores letter case, a file such as ZEKNO.APP.JSON takes the name (security review S5). */
export const IN7 =
  "A file here is named zekno.app.json in other capital letters, and this disk takes it as the same name. zekno reads settings only from a file named exactly zekno.app.json: rename that file, or remove it."
/** IN6 */
export const IN6 =
  "This folder has compose.yaml too. zekno deploy asks which to deploy, or takes -f <file>."
/** IN1's reason for an image refused: SV8's rule. */
export const IN1_RULE =
  "Use an image reference, such as ghcr.io/acme/web:1.4.2."
/** IN2's reason for a service name refused. */
export const IN2_RULE =
  "Use lowercase letters, digits and hyphens, starting with a letter."

// zekno deploy, contracts/deploy.md.

/** DP1: the question, its rows (label, detail) and the word left behind. */
export const DP1 = {
  question: "Deploy from which file?",
  rows: [
    { label: "zekno.app.json", detail: "your settings" },
    { label: "compose.yaml", detail: "a Compose file written by hand" },
  ],
  collapsed: "From",
} as const
/** DP2 */
export const DP2 =
  "This folder has zekno.app.json and compose.yaml. Say which with -f <file>."
/** DP3: the `from` row's label, and its dim detail, `<n> services: <names>`. */
export const DP3 = {
  label: "from",
  detail: (services: readonly string[]): string =>
    `${services.length} ${services.length === 1 ? "service" : "services"}: ${services.join(", ")}`,
}
/** DP6: `d` on the settings screen found the file changed since the screen showed it (the review's first "needs validation"). */
export const DP6 =
  "The settings changed since this screen showed them, so nothing was deployed."
/** DP5 */
export const DP5 =
  "This folder has zekno.app.json and compose.yaml. Run zekno link -f <file> here to say which."

// The settings screen, contracts/app-screen.md.

/** AS1 */
export const AS1 =
  "A change is written to the file. It runs after the next deploy."
/** AS2 */
export const AS2 = "One app, one file: zekno.app.json"
/** AS3: `was` undefined when the last deploy had no such setting. */
export const AS3 = (was?: string): string =>
  was === undefined
    ? "! changed, not deployed"
    : `! changed, not deployed (was ${was})`
/**
 * AS8 (security review S3): what the last deploy had and the file no longer
 * has, so the next deploy drops it: a plain variable or a volume, by what it
 * was, a volume's data staying (FR-012); a whole service by the image it
 * ran, or with no old value where there is no room for one.
 */
export const AS8 = (was?: string, volume = false): string =>
  was === undefined
    ? "! removed, not deployed"
    : `! removed, not deployed (was ${was}${volume ? "; its data stays" : ""})`
/**
 * AS9 (security review S4): under a value cut on the settings screen, how
 * many of its lines are not drawn, and the key that shows it whole: the
 * Compose text holds every value, and scrolls. While a change is open `c`
 * does nothing, so the key is left out (`key` false).
 */
export const AS9 = (lines: number, key = true): string =>
  `… ${lines} more ${lines === 1 ? "line" : "lines"}${key ? `: c shows ${lines === 1 ? "it" : "them"} in the Compose text` : ""}`
/** AS4 */
export const AS4 = "Change a setting"
/** AS5 */
export const AS5 = { now: "now", new: "new" }
/** AS6 */
export const AS6 = (app: string, server: string): string =>
  `This folder is linked to ${app} on ${server}. Its settings are on that app's screen.`
/** AS7, on a `none` row of plain or volumes. */
export const AS7 = (svc: string, key: "plain" | "volume"): string =>
  key === "plain"
    ? `Add one with \`zekno settings set ${svc}.plain.<NAME> <value>\`.`
    : `Add one with \`zekno settings set ${svc}.volumes.<name> <path>\`.`
