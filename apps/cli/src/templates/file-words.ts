/**
 * Every sentence about a template file (specs/012-templates,
 * contracts/template-file.md, "Sentences" and "The services, by the settings
 * rules"), each with its id there: TR1 to TR4, TF1 to TF34, TC1 and TC2.
 * Copied from the contract; a change here is a change to the contract.
 *
 * A fault is said as `<name> <place>: <rule>`, `<name>` being the file's
 * name without `.json` once it passed TR1. A sentence is given only names
 * that passed their rule, line numbers and fixed words: never a value of
 * the file.
 */
import { CS6 } from "../settings/words"

/** A place in a template file and the rule it breaks. */
export type PlaceRule = { place: string; rule: string }

const at = (place: string, rule: string): PlaceRule => ({ place, rule })
const line = (n: number): string => `line ${n}`

/** A fault said as a sentence: `<name> <place>: <rule>`; before the file's name passed TR1, `<place>: <rule>`. */
export const inTemplate = (
  name: string | undefined,
  place: string,
  rule: string
): string =>
  name === undefined ? `${place}: ${rule}` : `${name} ${place}: ${rule}`

// Reading.

/** TR1: the place is the file's own name, cleaned with `sanitize`, when it is not a template file's name. */
export const TR1 = (file: string): PlaceRule =>
  at(
    file,
    "name a template file <name>.json, its name lowercase letters, digits and hyphens, starting with a letter, at most 32 characters."
  )
/** TR2 */
export const TR2: PlaceRule = at("file", "a template file is at most 16 KiB.")
/** TR3 */
export const TR3: PlaceRule = at("file", "a template file is UTF-8 text.")
/** TR4, SJ1's rule. */
export const TR4_SYNTAX = (n: number): PlaceRule =>
  at(line(n), "this is not JSON.")
/** TR4, SJ2's rule: `m` the second use, `n` the first. */
export const TR4_TWICE = (m: number, n: number): PlaceRule =>
  at(line(m), `the same name as line ${n}.`)
/** TR4, SJ3's rule. */
export const TR4_DEEP = (n: number): PlaceRule =>
  at(line(n), "nested deeper than templates go.")
/** TR4, SJ4's rule. */
export const TR4_LONG = (n: number): PlaceRule =>
  at(line(n), "a text longer than 4096 characters.")
/** TR4, SJ5's rule. */
export const TR4_TOP: PlaceRule = at(line(1), "a template is one JSON object.")

// The fields.

/** TF1 */
export const TF1: PlaceRule = at(
  "template",
  "use 1, the version of templates this zekno reads."
)
/** TF2: two sentences, as SL0. */
export const TF2 = (name: string): { first: string; second: string } => ({
  first: `${name} is written for a later version of zekno.`,
  second: "Update zekno to use it.",
})
/** TF3 */
export const TF3 = (n: number): PlaceRule =>
  at(line(n), "a field this zekno does not know.")
/** TF4: two sentences. */
export const TF4 = (name: string): { first: string; second: string } => ({
  first: `${name} asks a question when it is added.`,
  second:
    "Questions are not in this version of zekno yet. They come with domains.",
})
/** TF5 */
export const TF5 = (field: string): PlaceRule =>
  at(field, "a template needs this field.")
/** TF6 */
export const TF6: PlaceRule = at(
  "name",
  "use lowercase letters, digits and hyphens, starting with a letter, at most 32 characters."
)
/** TF7: `name` is the file's own name without `.json`. */
export const TF7 = (name: string): PlaceRule =>
  at("name", `use the file's own name, ${name}.`)
/** TF8 */
export const TF8: PlaceRule = at(
  "title",
  'use 1 to 40 letters, digits, spaces, dots, plus signs and hyphens, such as "PostgreSQL".'
)
/** TF9 */
export const TF9: PlaceRule = at(
  "about",
  'use one sentence of at most 80 characters that ends with a full stop, such as "A relational database."'
)
/** TF10 */
export const TF10: PlaceRule = at(
  "software",
  'use the software\'s version as people name it, such as "18.7" or "9.7".'
)
/** TF11 */
export const TF11: PlaceRule = at(
  "author",
  "use a name of letters, digits and inner hyphens, at most 39 characters, such as a GitHub user name."
)
/** TF12 */
export const TF12: PlaceRule = at(
  "also",
  "use a list of at most 8 other names people may type, each written as a template's name, none twice and not this one's, such as [\"mongo\"]."
)
/** TF13 */
export const TF13: PlaceRule = at(
  "services",
  'name 1 to 8 services, such as { "postgres": { "source": { "image": "postgres:18.7@sha256:..." } } }.'
)
/** TF14 */
export const TF14: PlaceRule = at(
  "makes",
  'name 1 to 16 secrets the template makes, such as { "POSTGRES_PASSWORD": { "kind": "password", "length": 32 } }.'
)
/** TF15 */
export const TF15 = (n: number): PlaceRule =>
  at(
    "makes",
    `a made secret's name uses capital letters, digits and underscore, starts with a letter, is at most 128 characters and is not one zekno keeps for itself (line ${n}).`
  )
/** TF16 */
export const TF16 = (made: string): PlaceRule =>
  at(
    `makes.${made}`,
    'use { "kind": "password", "length": <a number from 24 to 64> }.'
  )
/** TF17 */
export const TF17: PlaceRule = at(
  "offers",
  'name at most 4 connection secrets, such as { "DATABASE_URL": "postgres://app:{POSTGRES_PASSWORD}@{service}:5432/app" }.'
)
/** TF18 */
export const TF18 = (n: number): PlaceRule =>
  at(
    "offers",
    `a connection secret's name uses capital letters, digits and underscore, starts with a letter, is at most 128 characters and is not one zekno keeps for itself (line ${n}).`
  )
/** TF19 */
export const TF19 = (offer: string): PlaceRule =>
  at(
    `offers.${offer}`,
    "use at most 512 characters of letters, digits and :/@?&=._%+~- with {service} and the made secrets in braces."
  )
/** TF20 */
export const TF20: PlaceRule = at(
  "notes",
  "use a list of 1 to 8 sentences, each at most 200 characters and ending with a full stop."
)

// The template's own rules.

const image = (svc: string): string => `services.${svc}.source.image`

/** TF21 (board) */
export const TF21 = (svc: string): PlaceRule =>
  at(image(svc), "pin the image by digest.")
/** TF22 */
export const TF22 = (svc: string): PlaceRule =>
  at(
    image(svc),
    "name the image's version with a tag, such as postgres:18.7@sha256:<digest>."
  )
/** TF23 */
export const TF23 = (svc: string): PlaceRule =>
  at(
    image(svc),
    "use a Docker Official Image, or another source apps/cli/src/templates/publishers.ts lists."
  )
/** TF24 */
export const TF24 = (svc: string): PlaceRule =>
  at(`services.${svc}.networking.publish`, "a template publishes no port.")
/** TF25: `secret` passed the secret-name rule already. */
export const TF25 = (svc: string, secret: string): PlaceRule =>
  at(
    `services.${svc}.variables.secrets`,
    `${secret} is not made by this template. A template's services read only the secrets it makes.`
  )
/** TF26 */
export const TF26 = (made: string): PlaceRule =>
  at(`makes.${made}`, "no service of this template reads it.")
/** TF27 */
export const TF27 = (offer: string): PlaceRule =>
  at(
    `offers.${offer}`,
    "it is the name of a made secret, or of one a service of this template reads."
  )
/** TF28 */
export const TF28 = (offer: string): PlaceRule =>
  at(
    `offers.${offer}`,
    "each {...} names {service} or a secret this template makes."
  )
/** TF29 */
export const TF29 = (offer: string): PlaceRule =>
  at(
    `offers.${offer}`,
    "build it from at least one secret this template makes."
  )
/** TF30: `tag` is the first service's image tag, which passed the tag rule. */
export const TF30 = (tag: string): PlaceRule =>
  at(
    "software",
    `use the version the first service's image tag names, ${tag}, or its start before a dot, such as 9.7 for 9.7.4.`
  )
/** TF31 */
export const TF31: PlaceRule = at(
  "notes",
  'say "Zekno does not back up this data." when a service keeps data in a volume.'
)
/** TF32 */
export const TF32 = (svc: string, volume: string): PlaceRule =>
  at(
    `services.${svc}.volumes.${volume}`,
    `it is added as ${svc}-${volume}, which must be a volume name of at most 63 characters.`
  )
/** TF33: `other` is the service before `svc` whose volume is added under the same name. */
export const TF33 = (svc: string, volume: string, other: string): PlaceRule =>
  at(
    `services.${svc}.volumes.${volume}`,
    `it is added as ${svc}-${volume}, as a volume of ${other} is.`
  )

/** TF34 (security review T5) */
export const TF34 = (offer: string): PlaceRule =>
  at(
    `offers.${offer}`,
    "a connection secret points at {service} and nowhere else."
  )

// Across the catalogue.

/** TC1 */
export const TC1: PlaceRule = at(
  "name",
  "another template has this name, or names it in its also."
)
/** TC2: `also` passed the name rule. */
export const TC2 = (also: string): PlaceRule =>
  at("also", `${also} is another template's name, or in its also.`)

// The services, by the settings rules (TS).

/**
 * A place of feature 010's settings rules as a path of the template file
 * (contracts/template-file.md, "The services, by the settings rules"): its
 * `, ` becomes `.` and `services.` goes before it; `services` stays
 * `services`. The settings reader is given only `zekno` and `services`, so
 * a fault with no place (a key at the top) cannot come from it; it is said
 * at `services` too.
 */
export const templatePlace = (settingsPlace: string): string =>
  settingsPlace === "" || settingsPlace === "services"
    ? "services"
    : `services.${settingsPlace.split(", ").join(".")}`

/** Where each later setting is in a service, by the setting (SL1 to SL5). */
const LATER_PLACE = {
  build: "source.build",
  predeploy: "deploy.predeploy",
  healthcheck: "deploy.healthcheck",
  replicas: "deploy.replicas",
  domains: "networking.domains",
} as const

/** A later setting of a template's service (SL1 to SL5): its place in the file, and SL's second sentence as the rule. */
export const laterInTemplate = (
  setting: keyof typeof LATER_PLACE,
  svc: string
): PlaceRule => at(`services.${svc}.${LATER_PLACE[setting]}`, CS6(setting))
