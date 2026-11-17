/**
 * Every sentence and word of `zekno add` (specs/012-templates,
 * contracts/commands.md, "Sentences" and "The summary's words"), each with
 * its id there: AD1 to AD28 (AD2 and AD26 are not used), AU1 to AU10, AL1
 * to AL4, AV1 to AV6, AH1 to AH9 (AH7 is not used), and the summary's words.
 * Copied from the contract; a change here is a change to the contract.
 *
 * A sentence is given only names that passed their rule, numbers and fixed
 * words: never a made secret's value. `<file>` is a file as `shownFile`
 * cleans it. A refusal of two sentences is one string, the first sentence
 * then the second, as `ErrorLine` splits it at a terminal and plain output
 * prints it on one line.
 */
import { LIMITS } from "@workspace/core"

import { restartShown } from "../settings/words"

/** `A`, `A and B`, `A, B and C`: names joined as a sentence lists them (AD17). */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

const WORDS = ["two", "three", "four", "five", "six", "seven", "eight", "nine"]

/** A count as AH6 says it: two to nine as words, digits otherwise. */
export const countWord = (n: number): string =>
  n >= 2 && n <= 9 ? WORDS[n - 2]! : String(n)

// Adding.

/** AD1 (board) [2] */
export const AD1 =
  "There is no server to keep secrets for yet. Run zekno deploy first. It sets up your team and a server."
/** AD3 (board; the question) */
export const AD3 = (service: string, app: string): string =>
  `Add ${service} to ${app}? Nothing is deployed until you deploy.`
/** AD4 (board) [1] */
export const AD4 = (file: string): string =>
  `Adding a template changes ${file} and stores secrets. Say --yes to go ahead.`
/** AD5 (board) [2] */
export const AD5 = (app: string, secret: string): string =>
  `${app} already has a secret named ${secret}. A template can be added once to an app in this version.`
/** AD6 (board; the second `<service>` is written as is) [2] */
export const AD6 = (file: string, service: string): string =>
  `${file} already has a service named ${service}. Give this one another name with --name <service>.`
/** AD7 (board; `<service>` is written as is) [2] */
export const AD7 = (svc: string, secret: string): string =>
  `${svc} already has a variable named ${secret}. Remove it, or leave ${svc} out with --for <service>.`
/** AD8 (board) [1, as CS12; D27] */
export const AD8 = (file: string, template: string): string =>
  `${file} changed while this was open. Nothing was added. Run zekno add ${template} again.`
/** AD9 (new, D1; `<service>` is written as is) [2] */
export const AD9 = (file: string, volume: string): string =>
  `${file} already has a volume named ${volume}. Give this one another name with --name <service>.`
/** AD10 (board; the question) */
export const AD10 = (secret: string): string => `Which services read ${secret}?`
/** AD10's collapsed word: the line the readers question leaves behind, `✔ Read by  web, worker` (new, D13). */
export const READ_BY = "Read by"
/** AD11 (new, D13; the reason under the rows) */
export const AD11 = "Pick at least one service."
/** AD12 (new, D14; `<service>` is written as is) [2] */
export const AD12 = (file: string, secret: string): string =>
  `${file} has several services. Say which read ${secret} with --for <service>.`
/** AD13 (board) [1, as SH1; D27] */
export const AD13 =
  "This folder has no settings file. Run zekno settings init to start one, then add the template."
/**
 * AD14 (new, as CS4) [2]. `svc` undefined: the name given broke the service
 * rule, so it is not repeated ("no such service"). One service: "Its service
 * is web."
 */
export const AD14 = (
  file: string,
  svc: string | undefined,
  services: readonly string[]
): string => {
  const missing =
    svc === undefined ? "no such service" : `no service named ${svc}`
  const list =
    services.length === 1
      ? `Its service is ${services[0]}.`
      : `Its services are ${services.join(", ")}.`
  return `${file} has ${missing}. ${list}`
}
/**
 * AD15 (new, D21) [2]: the settings sentence's place and rule, or `size`
 * for a file that would pass 64 KiB.
 */
export const AD15 = (
  service: string,
  file: string,
  broken: { place: string; rule: string } | "size"
): string => {
  const second =
    broken === "size"
      ? `${file} would be larger than the 64 KiB a settings file may be.`
      : broken.place === ""
        ? broken.rule
        : `${broken.place}: ${broken.rule}`
  return `${service} cannot be added to ${file}. ${second}`
}
/** AD16 (board) */
export const AD16 = (service: string, file: string): string =>
  `Added ${service} to ${file}`
/** AD17 (board): the made secrets then the connection secrets, in the template's order. */
export const AD17 = (names: readonly string[], server: string): string =>
  `Stored ${joinNames(names)}, sealed for ${server}`
/** AD18 (board) */
export const AD18 = "Run zekno deploy to start it."
/** AD19 (new) [1] */
export const AD19 = (service: string, file: string): string =>
  `${service} was added to ${file}, but its secrets could not be stored, and the file could not be put back. Remove ${service} from ${file} before you deploy.`
/** AD20 (new) [1] */
export const AD20 =
  "The secrets could not be stored on this machine, so nothing was added."
/** AD21 (new, as AD8) [1] */
export const AD21 = (app: string, server: string, template: string): string =>
  `The secrets of ${app} on ${server} changed while this was open. Nothing was added. Run zekno add ${template} again.`
/** AD22 (board) [1] */
export const AD22 = "Nothing was added."
/** AD23 (board) [0]: the plain lines, with tabs. */
export const AD23 = {
  added: (service: string, file: string): string =>
    `added\t${service}\t${file}`,
  stored: (secret: string, version: number): string =>
    `stored\t${secret}\t${version}`,
}
/** AD24 (new, as I13) [1] */
export const AD24 = (app: string, server: string): string =>
  `${app} on ${server} would have more than ${LIMITS.secretsPerDeploy} secrets, more than one deploy carries. Nothing was added.`
/** AD25 (new, as I14) [1] */
export const AD25 = (app: string, server: string): string =>
  `${app} on ${server} would have more than ${LIMITS.secretHistory} secret records on this machine. Nothing was added.`
/** AD27 (new) [1] */
export const AD27 = (template: string): string =>
  `This zekno's template ${template} does not pass its own checks. Nothing was added.`
/** AD28 (new, D20; TF4) [2] */
export const AD28 = (template: string): string =>
  `${template} asks a question when it is added. Questions are not in this version of zekno yet. They come with domains.`

// Usage, with the help line (status 2).

/** AU1 (new) */
export const AU1 =
  "Say which template: `zekno add <template>`, or see them with `zekno add --list`."
/** AU2 (new) */
export const AU2 = "`zekno add --list` takes no template."
/** AU3 (new) */
export const AU3 = "Say which template to show: `zekno add <template> --show`."
/** AU4 (new) */
export const AU4 = "Use `--list` or `--show`, not both."
/** AU5 (new) */
export const AU5 = "`zekno add` takes `--json` with `--list` or `--show` only."
/** AU6 (new), for `--name`, `--for`, `--app`, `--server` and `--yes`. */
export const AU6 = (looking: "list" | "show", option: string): string =>
  `\`zekno add --${looking}\` does not take \`--${option}\`.`
/** AU7: the sentence `optionNotTaken` of cli/cli.ts says for `zekno add`. */
export const AU7 = (option: string): string =>
  `\`zekno add\` does not take ${option === "file" ? "`-f`" : `\`--${option}\``}.`

// Usage, without the help line (`WrongInput`, status 2).

/** AU8 (new) */
export const AU8 =
  "That is not a service name. Use lowercase letters, digits and hyphens, starting with a letter."
/** AU9 (new, D19) */
export const AU9 = (template: string): string =>
  `${template} adds several services, so it takes no --name in this version.`
/** AU10 (new) */
export const AU10 = (file: string): string =>
  `--for works with a settings file. With ${file}, add the line to each service that uses it.`

// Looking.

/** AL1 (board; the picker's question) */
export const AL1 = "Add which template?"
/** AL2 (new; the picker's collapsed word) */
export const AL2 = "Template"
/** AL3 [2]: `also` is the template whose `also` holds the name typed (board); else the list (new). */
export const AL3 = (name: string, also?: string): string =>
  `There is no template named ${name}. ${also === undefined ? "Run zekno add --list to see them." : `Run zekno add ${also}.`}`
/** AL4 (new; for a name that breaks the name rule) [2] */
export const AL4 =
  "There is no template of that name. Run zekno add --list to see them."
/** AV1 (board): after the about, in `--show`'s first line. */
export const AV1 = (author: string): string => `By ${author}.`
/** AV2 (board; `built from them`, new): the heading and each row's words. */
export const AV2 = {
  heading: "Secrets",
  made: (length: number): string =>
    `made on your machine, ${length} random characters`,
  built: (several: boolean): string =>
    `built from ${several ? "them" : "it"}, for your own services`,
}
/** AV3 (board) */
export const AV3 =
  "Zekno does not back up this data. It is kept in a Docker volume on your server."
/** AV4 (board) */
export const AV4 =
  "The image is the official one, pinned by digest. A newer one comes with a newer zekno."
/** AV5 (board) */
export const AV5 = "Nothing was changed."
/** AV6 (board) */
export const AV6 = "Good to know"

// The summary's words (board `AddTemplate`). Counts are digits.

export const SUMMARY = {
  /** `by <author>`, after the title line. */
  by: (author: string): string => `by ${author}`,
  /** The box's three labels. */
  app: "app",
  server: "server",
  file: "file",
  /** `Adds a service`, `Adds <n> services` (new). */
  adds: (count: number): string =>
    count === 1 ? "Adds a service" : `Adds ${count} services`,
  pinned: "pinned by digest",
  /** `restart always`; `on-failure` reads `on failure`. */
  restart: (rule: string): string => `restart ${restartShown(rule)}`,
  port: (port: number): string => `port ${port}, not published`,
  /** The dot between the restart rule and the port, drawn dim. */
  dot: " · ",
  /** `data kept in volume <vol>`, `volumes <a>, <b>` for several (new). */
  volumes: (volumes: readonly string[]): string =>
    volumes.length === 1
      ? `data kept in volume ${volumes[0]}`
      : `volumes ${volumes.join(", ")}`,
  /** `Makes a secret on this machine`, `Makes <n> secrets on this machine` (new). */
  makes: (count: number): string =>
    count === 1
      ? "Makes a secret on this machine"
      : `Makes ${count} secrets on this machine`,
  neverShown: "never shown",
  random: (length: number): string => `${length} random characters`,
  readBy: (services: readonly string[]): string =>
    `read by ${services.join(", ")}`,
  /** `Builds a secret from it`, `from them` when it uses several made secrets (new). */
  builds: (several: boolean): string =>
    `Builds a secret from ${several ? "them" : "it"}`,
  /** In place of each made value in a connection secret. */
  hidden: "••••",
  /** Before each note, the whole line in the warning colour. */
  note: (note: string): string => `! ${note}`,
}

// A hand-written Compose file.

/** AH1 (board): the file drawn bold. */
export const AH1 = (file: string): string =>
  `This folder deploys from ${file}, a file written by hand.`
/** AH2 (board) */
export const AH2 = "Zekno does not edit it. Add these lines yourself."
/** AH3 (board) */
export const AH3 = "Under services:"
/** AH4 (board): several volumes after one another, two spaces apart. */
export const AH4 = (volumes: readonly string[]): string =>
  `Under volumes:  ${volumes.map((volume) => `${volume}:`).join("  ")}`
/** AH5 (board) */
export const AH5 = "In the environment: of each service that uses it"
/** AH6 (board: `two`; one, new): the question. */
export const AH6 = (count: number, app: string, server: string): string =>
  count === 1
    ? `Make and store its secret for ${app} on ${server}?`
    : `Make and store its ${countWord(count)} secrets for ${app} on ${server}?`
/** AH8 (new, D17) [1] */
export const AH8 =
  "Making its secrets stores them on this machine. Say --yes to go ahead."
/** AH9 (new, D17) [1] */
export const AH9 = "No secret was made."
