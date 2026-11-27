/**
 * The faults of a settings file (specs/010-app-settings,
 * contracts/settings-file.md), each with its id: SR, reading it; SJ and SV,
 * not in the right form; SL, a later setting. Copied from there; a change
 * here is a change to a contract. Split from words.ts, which re-exports
 * all of it (specs/016-build-from-source, contracts/cli.md CL14).
 *
 * A sentence is given only names that passed their rule, line numbers and
 * fixed words: never a piece of a settings file. `<file>` is a path as
 * `shownFile` cleans it.
 */
import type { LaterSetting } from "./types"

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

/** What can be wrong with a start command: SV9 (a) to (e), (g) and (h); (f) is not a string. */
export type StartProblem =
  "empty" | "quote" | "shell" | "long" | "control" | "hidden" | "blank"

/** The rule of a value holding a character drawn as nothing (security review S2), after its place: SV9 (g) and SV24's second form. */
const HIDDEN =
  "use no invisible character, such as a zero-width space or a right-to-left mark."

/** The rule of a value that starts or ends with a blank (security review S8), after its place: SV9 (h) and SV24's third form. */
const BLANK_ENDS = "use no space or other blank at its start or end."

/** SV9 (a) to (e), (g) and (h), as the rule after the place. */
export const START_RULES: Record<StartProblem, string> = {
  empty: "use a command, or leave start out to run the image's own.",
  quote: "a quote does not close.",
  shell:
    "it runs without a shell, so put ; & | < > ( ) $ and backquotes in quotes. To use a shell, start it with sh -c.",
  long: "use at most 4096 characters and 256 words.",
  control: "use one line with no control character.",
  hidden: HIDDEN,
  blank: BLANK_ENDS,
}
/** A rule after its place, as a sentence of its own. */
const sentence = (rule: string): string =>
  `${rule.charAt(0).toUpperCase()}${rule.slice(1)}`
/** The same rule as a sentence of its own, after `That is not ...` (CS7) for a value typed. */
export const HIDDEN_RULE = sentence(HIDDEN)
/** The same for a blank at either end (security review S8). */
export const BLANK_RULE = sentence(BLANK_ENDS)
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
/** SV24; `hidden`: the value holds a character drawn as nothing (security review S2); `blank`: it starts or ends with a blank (S8). */
export const SV24 = (
  svc: string,
  name: string,
  problem: "form" | "hidden" | "blank" = "form"
): PlaceRule =>
  at(
    `${svc}, variables.plain.${name}`,
    problem === "hidden"
      ? HIDDEN
      : problem === "blank"
        ? BLANK_ENDS
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

/**
 * What each later setting is called in SL's first sentence, and SL's second
 * sentence (CS6 too). Domains and health checks left this list with feature
 * 015 (specs/015-domains-https, CL1): their two sentences went. A build is
 * no later setting since feature 016 (specs/016-build-from-source, CL1): no
 * reader or `set` says these words (C30 went). They stay only while
 * app/effects/settings.ts and templates/file-words.ts still name them, and
 * go with them.
 */
export const LATER: Record<
  Exclude<LaterSetting, "version">,
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
  replicas: {
    sets: "replicas",
    second: "Several copies of a service are not in this version of zekno yet.",
  },
}

/** SL0 to SL4: the first sentence and the second. SL0 is `version`, the file's own `zekno`. */
export function laterSentences(
  file: string,
  setting: LaterSetting,
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
