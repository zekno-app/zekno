/**
 * Every sentence and label of app settings (specs/010-app-settings), each
 * with its id in the contracts: SR, SJ, SV and SL in
 * contracts/settings-file.md; SH, CS and IN in contracts/commands.md; DP in
 * contracts/deploy.md; AS in contracts/app-screen.md. Copied from there; a
 * change here is a change to a contract. It is one file, longer than most,
 * on purpose: every sentence a person reads about settings is in one place,
 * to be read against the contracts in one pass.
 *
 * A sentence is given only names that passed their rule, line numbers and
 * fixed words: never a piece of a settings file. `<file>` is a path as
 * `shownFile` cleans it.
 */

/** A place in the file and the rule it breaks, said as `<place>: <rule>` after SR's first sentence. An empty place: the rule alone. */
export type PlaceRule = { place: string; rule: string }

// Reading (status 1), contracts/settings-file.md.

/** SR1, a file named with `-f`. */
export const SR1 = (file: string): string => `No settings file at ${file}.`
/** SR1, the file a zekno.json names. */
export const SR1_LINKED = (
  zeknoJson: string,
  named: string,
  folder: string
): string =>
  `${zeknoJson} names ${named}, and there is no such file in ${folder}.`
/** SR2 */
export const SR2 = (file: string): string => `${file} is not a file.`
/** SR3 */
export const SR3 = (file: string): string =>
  `${file} is larger than the 64 KiB a settings file may be.`
/** SR4 */
export const SR4 = (file: string): string => `${file} is not UTF-8 text.`
/** SR5 */
export const SR5 = (file: string): string => `${file} could not be read.`
/** SR6 */
export const SR6 = (file: string): string =>
  `${file} was changed while zekno read it. Try again.`
/** SR7 */
export const SR7 = (file: string): string =>
  `${file} has more than one name on this disk (a hard link), so zekno cannot tell that it stays inside its folder.`
/** SR8 */
export const SR8 = (file: string): string =>
  `${file} belongs to another user, so zekno does not use it.`
/** SR9 */
export const SR9 = (file: string): string =>
  `${file} leads outside the folder that holds it. zekno does not follow it there.`

// Not in the right form (status 1), contracts/settings-file.md.

/** The two sentences of a fault of form: `<file> could not be read as settings.` then `<place>: <rule>`. */
export function notSettings(file: string, place: string, rule: string): string {
  const said = place === "" ? rule : `${place}: ${rule}`
  return `${file} could not be read as settings. ${said}`
}

const at = (place: string, rule: string): PlaceRule => ({ place, rule })
const line = (n: number): string => `line ${n}`

/** SJ1 */
export const SJ1 = (n: number): PlaceRule => at(line(n), "this is not JSON.")
/** SJ2: `m` the second use, `n` the first. */
export const SJ2 = (m: number, n: number): PlaceRule =>
  at(line(m), `the same name as line ${n}.`)
/** SJ3 */
export const SJ3 = (n: number): PlaceRule =>
  at(line(n), "nested deeper than settings go.")
/** SJ4 */
export const SJ4 = (n: number): PlaceRule =>
  at(line(n), "a text longer than 4096 characters.")
/** SJ5 */
export const SJ5: PlaceRule = at(line(1), "settings are one JSON object.")
/** SV1 */
export const SV1: PlaceRule = at(
  "zekno",
  "use 1, the version of settings this zekno reads."
)
/** SV2 */
export const SV2: PlaceRule = at(
  "services",
  'name at least one service, such as "web".'
)
/** SV3 */
export const SV3: PlaceRule = at("services", "at most 32 services.")
/** SV4 */
export const SV4 = (n: number): PlaceRule =>
  at(
    "services",
    `a service name is lowercase letters, digits and hyphens, and starts with a letter (line ${n}).`
  )
/** SV5: a service that is not an object, or one of its sections. */
export const SV5 = (svc: string, section?: string): PlaceRule =>
  section === undefined
    ? at(svc, "use an object of sections.")
    : at(`${svc}, ${section}`, "use an object.")
/** SV6: a key not known, in a section, in a service, or at the top. */
export const SV6 = (n: number, svc?: string, section?: string): PlaceRule => {
  if (svc === undefined)
    return at("", `A setting this zekno does not know (line ${n}).`)
  const place = section === undefined ? svc : `${svc}, ${section}`
  return at(place, `a setting this zekno does not know (line ${n}).`)
}
/** SV7 */
export const SV7 = (svc: string): PlaceRule =>
  at(
    `${svc}, source.image`,
    "a service needs an image, such as ghcr.io/acme/web:1.4.2."
  )
/** SV8 */
export const SV8 = (svc: string): PlaceRule =>
  at(
    `${svc}, source.image`,
    "use an image reference, such as ghcr.io/acme/web:1.4.2."
  )

/** What can be wrong with a start command: SV9 (a) to (e) and (g); (f) is not a string. */
export type StartProblem =
  "empty" | "quote" | "shell" | "long" | "control" | "hidden"

/** The rule of a value holding a character drawn as nothing (security review S2), after its place: SV9 (g) and SV24's second form. */
const HIDDEN =
  "use no invisible character, such as a zero-width space or a right-to-left mark."

/** SV9 (a) to (e) and (g), as the rule after the place. */
const START_RULES: Record<StartProblem, string> = {
  empty: "use a command, or leave start out to run the image's own.",
  quote: "a quote does not close.",
  shell:
    "it runs without a shell, so put ; & | < > ( ) $ and backquotes in quotes. To use a shell, start it with sh -c.",
  long: "use at most 4096 characters and 256 words.",
  control: "use one line with no control character.",
  hidden: HIDDEN,
}
/** The same rule as a sentence of its own, after `That is not ...` (CS7) for a value typed. */
export const HIDDEN_RULE = `${HIDDEN.charAt(0).toUpperCase()}${HIDDEN.slice(1)}`
/** SV9: (a) to (e) and (g) by the problem, (f) `type` for a start that is not a string. */
export const SV9 = (svc: string, problem: StartProblem | "type"): PlaceRule =>
  at(
    `${svc}, deploy.start`,
    problem === "type"
      ? 'use a command in quotes, such as "bun run start".'
      : START_RULES[problem]
  )
/** SV10 */
export const SV10 = (svc: string): PlaceRule =>
  at(`${svc}, deploy.restart`, "use no, on-failure or always.")
/** SV11 */
export const SV11 = (svc: string): PlaceRule =>
  at(`${svc}, deploy.memory`, "use a size such as 512m or 1g.")
/** SV12 */
export const SV12 = (svc: string): PlaceRule =>
  at(`${svc}, deploy.cpus`, "use a number of processors, such as 0.5 or 2.")
/** SV13 */
export const SV13 = (svc: string): PlaceRule =>
  at(`${svc}, networking.port`, "use a port from 1 to 65535.")
/** SV14 */
export const SV14 = (svc: string): PlaceRule =>
  at(`${svc}, networking.publish`, "use a port from 1 to 65535.")
/** SV15 */
export const SV15 = (svc: string): PlaceRule =>
  at(
    `${svc}, networking.publish`,
    "set networking.port too, the port it reaches."
  )
/** SV16: `other` is the service that publishes the port first. */
export const SV16 = (svc: string, other: string): PlaceRule =>
  at(`${svc}, networking.publish`, `${other} publishes the same port.`)
/** SV17 */
export const SV17 = (svc: string): PlaceRule =>
  at(
    `${svc}, variables.secrets`,
    'use a list of names, such as ["DATABASE_URL"].'
  )
/** SV18 */
export const SV18 = (svc: string, n: number): PlaceRule =>
  at(
    `${svc}, variables.secrets`,
    `a secret name uses letters, digits and underscore, does not start with a digit, and is at most 128 characters (line ${n}).`
  )
/** SV19: `name` passed the secret-name pattern; it is reserved. */
export const SV19 = (svc: string, name: string): PlaceRule =>
  at(`${svc}, variables.secrets`, `${name} is a name zekno keeps for itself.`)
/** SV20 */
export const SV20 = (svc: string, n: number): PlaceRule =>
  at(`${svc}, variables.secrets`, `a name is there twice (line ${n}).`)
/** SV21 */
export const SV21 = (svc: string): PlaceRule =>
  at(`${svc}, variables.secrets`, "at most 256 names.")
/** SV22 */
export const SV22 = (svc: string): PlaceRule =>
  at(
    `${svc}, variables.plain`,
    'use an object of names and values, such as { "NODE_ENV": "production" }.'
  )
/** SV23 */
export const SV23 = (svc: string, n: number): PlaceRule =>
  at(
    `${svc}, variables.plain`,
    `a variable name uses letters, digits and underscore, does not start with a digit, and is at most 128 characters (line ${n}).`
  )
/** SV24; `hidden`: the value holds a character drawn as nothing (security review S2). */
export const SV24 = (svc: string, name: string, hidden = false): PlaceRule =>
  at(
    `${svc}, variables.plain.${name}`,
    hidden
      ? HIDDEN
      : "use a value in quotes, one line with no control character, at most 4096 characters."
  )
/** SV25 */
export const SV25 = (svc: string, name: string): PlaceRule =>
  at(
    `${svc}, variables.plain.${name}`,
    `it is a secret of ${svc} too. Keep it in one place.`
  )
/** SV26 */
export const SV26 = (svc: string): PlaceRule =>
  at(`${svc}, variables.plain`, "at most 128 variables.")
/** SV27 */
export const SV27 = (svc: string): PlaceRule =>
  at(
    `${svc}, volumes`,
    'use an object of volume names and mount paths, such as { "data": "/data" }.'
  )
/** SV28 */
export const SV28 = (svc: string, n: number): PlaceRule =>
  at(
    `${svc}, volumes`,
    `a volume name is lowercase letters, digits, hyphens and underscores, and starts with a letter (line ${n}).`
  )
/** SV29 */
export const SV29 = (svc: string, vol: string): PlaceRule =>
  at(
    `${svc}, volumes.${vol}`,
    "use an absolute path in the container, such as /data. A folder of the server cannot be mounted from settings."
  )
/** SV30 */
export const SV30 = (svc: string): PlaceRule =>
  at(`${svc}, volumes`, "two volumes are mounted at the same path.")
/** SV31 */
export const SV31 = (svc: string): PlaceRule =>
  at(`${svc}, volumes`, "at most 16 volumes.")
/** SV32 */
export const SV32: PlaceRule = at(
  "services",
  "they read more than 256 secrets, more than one deploy carries."
)
/** SV33 */
export const SV33: PlaceRule = at(
  "services",
  "they turn into Compose text larger than the 256 KiB a deploy carries."
)

// A later setting (status 1), contracts/settings-file.md.

/** What each later setting is called in SL's first sentence, and SL's second sentence (CS6 too). */
const LATER: Record<
  "build" | "predeploy" | "healthcheck" | "replicas" | "domains",
  { sets: string; second: string }
> = {
  build: {
    sets: "a build",
    second: "Building from source is not in this version of zekno yet.",
  },
  predeploy: {
    sets: "a pre-deploy command",
    second: "A pre-deploy command is not in this version of zekno yet.",
  },
  healthcheck: {
    sets: "a health check",
    second: "Health checks are not in this version of zekno yet.",
  },
  replicas: {
    sets: "replicas",
    second: "Several copies of a service are not in this version of zekno yet.",
  },
  domains: {
    sets: "a domain",
    second: "Domains are not in this version of zekno yet.",
  },
}

/** SL0 to SL5: the first sentence and the second. SL0 is `version`, the file's own `zekno`. */
export function laterSentences(
  file: string,
  setting:
    "version" | "build" | "predeploy" | "healthcheck" | "replicas" | "domains",
  svc?: string
): [first: string, second: string] {
  if (setting === "version")
    return [
      `${file} is written for a later version of zekno.`,
      "Update zekno to use it.",
    ]
  const later = LATER[setting]
  return [`${file} sets ${later.sets} for ${svc}.`, later.second]
}

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
 * than this folder's `zekno.app.json`: a deploy asks about it first, and a
 * yes deploys that file. `folder` as for SH3.
 */
export const SH4 = (file: string, folder?: string): string =>
  `${folder === undefined ? "This folder's zekno.json" : `The zekno.json in ${folder}`} names ${file} and is not in use on this machine yet: zekno deploy asks about it first, and a yes deploys ${file}, not the zekno.app.json here.`
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
/** CS5 */
export const CS5 =
  "There is no such setting. The settings are image, start, restart, memory, cpus, port, publish, secrets, plain.<NAME> and volumes.<name>."
/** CS6: SL's second sentence for that setting. */
export const CS6 = (
  setting: "build" | "predeploy" | "healthcheck" | "replicas" | "domains"
): string => LATER[setting].second
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
 * Compose text holds every value, and scrolls.
 */
export const AS9 = (lines: number): string =>
  `… ${lines} more ${lines === 1 ? "line" : "lines"}: c shows ${lines === 1 ? "it" : "them"} in the Compose text`
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
/** The screen's refusal of an empty image (contracts/app-screen.md, "Changing a value"). */
export const IMAGE_NEEDED = "A service needs an image."

// Each setting's words, contracts/commands.md and contracts/app-screen.md.

/** The settings `set` and the screen change, by key. */
export type SettingKey =
  | "image"
  | "start"
  | "restart"
  | "memory"
  | "cpus"
  | "port"
  | "publish"
  | "secrets"
  | "plain"
  | "volume"

/** The rule of a start command refused, as a sentence: SV9 (a) to (e). */
export const startRule = (problem: StartProblem): string => {
  const rule = START_RULES[problem]
  return `${rule.charAt(0).toUpperCase()}${rule.slice(1)}`
}

/** One setting's words: its label after `<svc> · `, its question, `That is not <a label>.`, and its rule. */
export type SettingWords = {
  label: string
  question: string
  notA: string
  rule: string
}

/** The words of each setting. A plain variable and a volume take their name; a start command's rule is its problem's. */
export function settingWords(key: SettingKey, name = ""): SettingWords {
  switch (key) {
    case "image":
      return {
        label: "image",
        question: "Image",
        notA: "That is not an image reference.",
        rule: "Use one such as ghcr.io/acme/web:1.4.2.",
      }
    case "start":
      return {
        label: "start command",
        question: "Start command",
        notA: "That is not a start command zekno can run.",
        rule: startRule("empty"),
      }
    case "restart":
      return {
        label: "restart rule",
        question: "Restart rule",
        notA: "That is not a restart rule.",
        rule: "Use no, on-failure or always.",
      }
    case "memory":
      return {
        label: "memory limit",
        question: "Memory limit",
        notA: "That is not a memory limit.",
        rule: "Use a size such as 512m or 1g.",
      }
    case "cpus":
      return {
        label: "processor limit",
        question: "Processor limit",
        notA: "That is not a processor limit.",
        rule: "Use a number of processors, such as 0.5 or 2.",
      }
    case "port":
      return {
        label: "port",
        question: "Port",
        notA: "That is not a port.",
        rule: "Use a port from 1 to 65535.",
      }
    case "publish":
      return {
        label: "published port",
        question: "Published port",
        notA: "That is not a port.",
        rule: "Use a port from 1 to 65535.",
      }
    case "secrets":
      return {
        label: "secrets",
        question: "Secrets",
        notA: "That is not a list of secret names.",
        rule: "A secret name uses letters, digits and underscore, does not start with a digit, and is not one zekno keeps for itself.",
      }
    case "plain":
      return {
        label: name,
        question: name,
        notA: "That is not a value zekno can write.",
        rule: "Use one line with no control character, at most 4096 characters.",
      }
    case "volume":
      return {
        label: `volume ${name}`,
        question: `Mount path for ${name}`,
        notA: "That is not a mount path.",
        rule: "Use an absolute path in the container, such as /data.",
      }
  }
}

/** The words of a setting that is not set (dim on the screen; also the old or new value of a change). */
export const NOT_SET: Record<SettingKey, string> = {
  image: "none",
  start: "the image's own",
  restart: "no",
  memory: "no limit",
  cpus: "no limit",
  port: "none",
  publish: "not published",
  secrets: "none",
  plain: "none",
  volume: "none",
}

/** A restart rule as a person reads it: `on-failure` reads `on failure`. */
export const restartShown = (restart: string): string =>
  restart === "on-failure" ? "on failure" : restart

/** The port row of `zekno settings`: `3000, not published` or `3000, published on 8080`. */
export const portShown = (port: number, publish?: number): string =>
  publish === undefined
    ? `${port}, not published`
    : `${port}, published on ${publish}`
