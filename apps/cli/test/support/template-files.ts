/**
 * The template files every template test reads (specs/012-templates, tasks
 * T006): the first set exactly as contracts/template-file.md writes it
 * (template-first-set.ts), good files at the edges of the rules, and one
 * faulty file per sentence of that contract, each built so that its sentence
 * and no earlier one (by "The order of checks") applies. Where a faulty file
 * has a wrong place (a bad value, a key not known, a bad name), it holds
 * `TEMPLATE_SENTINEL` there, which no fault, sentence or error may repeat.
 *
 * The expected sentences are copied from the contract, not from the code.
 */
import type { ServiceSettings } from "../../src/settings/types"
import type { Template } from "../../src/templates/types"
import { lineOf } from "./settings-files"
import { FIRST_SET, FIRST_TEMPLATES } from "./template-first-set"

export { FIRST_SET, FIRST_TEMPLATES }

/** A marker that must never appear in any fault, sentence, message or stack. */
export const TEMPLATE_SENTINEL = "zk_SENTINEL_5d2a"
const S = TEMPLATE_SENTINEL

const BACKUP = "Zekno does not back up this data."

// A made-up template, `acme-db`, valid in every way, that the other files change one thing of.

const HEX = "0123456789abcdef".repeat(4)
const IMAGE = `acme:1.2.3@sha256:${HEX}`
const DB_SERVICE = {
  source: { image: IMAGE },
  deploy: { restart: "always" },
  networking: { port: 5432 },
  variables: { secrets: ["DB_PASSWORD"], plain: { DB_USER: "app" } },
  volumes: { data: "/var/lib/db" },
}
const DB_SETTINGS: ServiceSettings = {
  image: IMAGE,
  restart: "always",
  port: 5432,
  secrets: ["DB_PASSWORD"],
  plain: [["DB_USER", "app"]],
  volumes: [["data", "/var/lib/db"]],
}
const URL = "acme://app:{DB_PASSWORD}@{service}:5432/app"
const MADE = { kind: "password", length: 32 }
const BASE: Record<string, unknown> = {
  template: 1,
  name: "acme-db",
  title: "Acme DB",
  about: "A test database.",
  software: "1.2",
  author: "zekno",
  also: [],
  services: { db: DB_SERVICE },
  makes: { DB_PASSWORD: MADE },
  offers: { DATABASE_URL: URL },
  notes: [BACKUP],
}

/** A file in the form `JSON.stringify` writes, two spaces in, with a final line feed. */
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

/** acme-db's file with `fields` put in place (a new key goes last), and the fields `drop` taken out. */
const acme = (fields: Record<string, unknown> = {}, drop: string[] = []) => {
  const file: Record<string, unknown> = { ...BASE, ...fields }
  for (const key of drop) delete file[key]
  return json(file)
}
/** acme-db's file with its service `db` given `sections`. */
const db = (sections: Record<string, unknown>) =>
  acme({ services: { db: { ...DB_SERVICE, ...sections } } })

/** acme-db as the reader gives it, with `changes`. */
const acmeTemplate = (changes: Partial<Template> = {}): Template => ({
  name: "acme-db",
  title: "Acme DB",
  about: "A test database.",
  software: "1.2",
  author: "zekno",
  also: [],
  services: [["db", DB_SETTINGS]],
  makes: [{ name: "DB_PASSWORD", kind: "password", length: 32 }],
  offers: [{ name: "DATABASE_URL", text: URL }],
  notes: [BACKUP],
  ...changes,
})

/** acme-db's text padded with spaces after its object to exactly `bytes` bytes. */
const padded = (bytes: number, fields: Record<string, unknown> = {}) => {
  const text = acme(fields)
  return `${text.slice(0, -1)}${" ".repeat(bytes - Buffer.byteLength(text))}\n`
}

/** A good file, and the template it reads to. */
export type GoodFile = { file: string; text: string; template: Template }

const F = "acme-db.json"
const many = Array.from({ length: 16 }, (_, at) => `P${at}`)
const note200 = (at: number) => `${"n".repeat(197)}${String(at).padStart(2)}.`
const CACHE = `cache:7.0@sha256:${HEX}`

export const GOOD: GoodFile[] = [
  ...Object.entries(FIRST_SET).map(([name, text]) => ({
    file: `${name}.json`,
    text,
    template: FIRST_TEMPLATES[name]!,
  })),
  { file: F, text: acme(), template: acmeTemplate() },
  {
    // Two services; the offer's {service} is the first one's name.
    file: F,
    text: acme({
      services: {
        db: DB_SERVICE,
        cache: {
          source: { image: CACHE },
          variables: { secrets: ["CACHE_PASSWORD"] },
        },
      },
      makes: { DB_PASSWORD: MADE, CACHE_PASSWORD: { ...MADE, length: 24 } },
    }),
    template: acmeTemplate({
      services: [
        ["db", DB_SETTINGS],
        ["cache", { image: CACHE, secrets: ["CACHE_PASSWORD"] }],
      ],
      makes: [
        { name: "DB_PASSWORD", kind: "password", length: 32 },
        { name: "CACHE_PASSWORD", kind: "password", length: 24 },
      ],
    }),
  },
  {
    file: F,
    text: acme({}, ["offers"]),
    template: acmeTemplate({ offers: [] }),
  },
  {
    // 16 made secrets of 64 characters, each read by the service.
    file: F,
    text: acme({
      services: { db: { ...DB_SERVICE, variables: { secrets: many } } },
      makes: Object.fromEntries(
        many.map((made) => [made, { ...MADE, length: 64 }])
      ),
      offers: { DATABASE_URL: "acme://app:{P0}@{service}:5432/app" },
    }),
    template: acmeTemplate({
      services: [["db", { ...DB_SETTINGS, secrets: many, plain: undefined }]],
      makes: many.map((made) => ({ name: made, kind: "password", length: 64 })),
      offers: [
        { name: "DATABASE_URL", text: "acme://app:{P0}@{service}:5432/app" },
      ],
    }),
  },
  {
    // 8 notes of 200 characters: no volume, so no backup note is needed.
    file: F,
    text: acme({
      services: { db: { ...DB_SERVICE, volumes: undefined } },
      notes: Array.from({ length: 8 }, (_, at) => note200(at)),
    }),
    template: acmeTemplate({
      services: [["db", { ...DB_SETTINGS, volumes: undefined }]],
      notes: Array.from({ length: 8 }, (_, at) => note200(at)),
    }),
  },
  {
    file: F,
    text: db({
      deploy: { start: "acme-server --port 5432", restart: "always" },
    }),
    template: acmeTemplate({
      services: [["db", { ...DB_SETTINGS, start: "acme-server --port 5432" }]],
    }),
  },
  { file: F, text: padded(16_384), template: acmeTemplate() },
]

/** A faulty file and its exact sentence. `before`: TC1 and TC2 are about two files, this one read after `before`. */
export type BadFile = {
  file: string
  text: string | Uint8Array
  sentence: string
  before?: { file: string; text: string }
}

/** The board's broken file: `"image": "acme/db:1.0"` in a service `db`. */
export const ACME_DB_BOARD = db({ source: { image: "acme/db:1.0" } })

const LONG = "d".repeat(60)
const NAME_RULE =
  "uses capital letters, digits and underscore, starts with a letter, is at most 128 characters and is not one zekno keeps for itself"

function faulty(): BadFile[] {
  const cases: BadFile[] = []
  /** A fault of acme-db.json, said `acme-db <place>: <rule>`. */
  const fault = (text: string | Uint8Array, placeAndRule: string) =>
    cases.push({ file: F, text, sentence: `acme-db ${placeAndRule}` })
  const withS = acme({ title: S })
  const bytes = Buffer.from(withS)
  const at = bytes.indexOf(S) + S.length
  const twice = acme().replace(
    '"title": "Acme DB",',
    `"title": "${S}",\n  "title": "${S}",`
  )
  const long = acme({ title: `${S}${"a".repeat(4097 - S.length)}` })
  const unknown = acme({ [S]: 1 })
  const constructor = acme({ constructor: S })
  const badMade = acme({ makes: { [S]: MADE, DB_PASSWORD: MADE } })
  const badOffer = acme({ offers: { [S]: "acme://{DB_PASSWORD}" } })
  const unknownSetting = db({ deploy: { restart: "always", [S]: 1 } })
  const badVolume = db({ volumes: { [S]: "/var/lib/db" } })
  const nine = [
    ["db", DB_SERVICE],
    ...Array.from({ length: 8 }, (_, n) => [
      `s${n}`,
      { source: { image: IMAGE } },
    ]),
  ]

  // Reading (TR1 to TR4).
  cases.push({
    file: "Bad Name.json",
    text: withS,
    sentence:
      "Bad Name.json: name a template file <name>.json, its name lowercase letters, digits and hyphens, starting with a letter, at most 32 characters.",
  })
  fault(
    padded(16_385, { title: S }),
    "file: a template file is at most 16 KiB."
  )
  fault(
    Uint8Array.from([...bytes.subarray(0, at), 0xff, ...bytes.subarray(at)]),
    "file: a template file is UTF-8 text."
  )
  fault(`{\n  // ${S}\n  "template": 1\n}\n`, "line 2: this is not JSON.")
  fault(
    twice,
    `line ${lineOf(twice, S) + 1}: the same name as line ${lineOf(twice, S)}.`
  )
  fault(
    `{"template":1,"services":{"db":{"variables":{"plain":{"A":{"B":{"${S}":1}}}}}}}`,
    "line 1: nested deeper than templates go."
  )
  fault(long, `line ${lineOf(long, S)}: a text longer than 4096 characters.`)
  fault(`["${S}"]\n`, "line 1: a template is one JSON object.")

  // The version, the keys, the fields (TF1 to TF20).
  fault(
    acme({ template: S }),
    "template: use 1, the version of templates this zekno reads."
  )
  cases.push({
    file: F,
    text: json({ template: 2, [S]: 1, services: { [S]: S } }),
    sentence:
      "acme-db is written for a later version of zekno. Update zekno to use it.",
  })
  fault(
    unknown,
    `line ${lineOf(unknown, S)}: a field this zekno does not know.`
  )
  fault(
    constructor,
    `line ${lineOf(constructor, '"constructor"')}: a field this zekno does not know.`
  )
  cases.push({
    file: F,
    text: acme({ asks: [] }),
    sentence:
      "acme-db asks a question when it is added. Questions are not in this version of zekno yet. They come with domains.",
  })
  fault(acme({}, ["title"]), "title: a template needs this field.")
  fault(acme({}, ["services"]), "services: a template needs this field.")
  fault(
    acme({ name: S }),
    "name: use lowercase letters, digits and hyphens, starting with a letter, at most 32 characters."
  )
  fault(acme({ name: "other-db" }), "name: use the file's own name, acme-db.")
  fault(
    acme({ title: S }),
    'title: use 1 to 40 letters, digits, spaces, dots, plus signs and hyphens, such as "PostgreSQL".'
  )
  fault(
    acme({ about: S }),
    'about: use one sentence of at most 80 characters that ends with a full stop, such as "A relational database."'
  )
  fault(
    acme({ software: `${S} 1` }),
    'software: use the software\'s version as people name it, such as "18.7" or "9.7".'
  )
  fault(
    acme({ author: S }),
    "author: use a name of letters, digits and inner hyphens, at most 39 characters, such as a GitHub user name."
  )
  fault(
    acme({ also: [S] }),
    "also: use a list of at most 8 other names people may type, each written as a template's name, none twice and not this one's, such as [\"mongo\"]."
  )
  fault(
    acme({ services: Object.fromEntries(nine) }),
    'services: name 1 to 8 services, such as { "postgres": { "source": { "image": "postgres:18.7@sha256:..." } } }.'
  )
  fault(
    acme({ makes: S }),
    'makes: name 1 to 16 secrets the template makes, such as { "POSTGRES_PASSWORD": { "kind": "password", "length": 32 } }.'
  )
  fault(
    badMade,
    `makes: a made secret's name ${NAME_RULE} (line ${lineOf(badMade, S)}).`
  )
  fault(
    acme({ makes: { DB_PASSWORD: { kind: S, length: 32 } } }),
    'makes.DB_PASSWORD: use { "kind": "password", "length": <a number from 24 to 64> }.'
  )
  fault(
    acme({ offers: S }),
    'offers: name at most 4 connection secrets, such as { "DATABASE_URL": "postgres://app:{POSTGRES_PASSWORD}@{service}:5432/app" }.'
  )
  fault(
    badOffer,
    `offers: a connection secret's name ${NAME_RULE} (line ${lineOf(badOffer, S)}).`
  )
  fault(
    acme({ offers: { DATABASE_URL: `${S} {DB_PASSWORD}` } }),
    "offers.DATABASE_URL: use at most 512 characters of letters, digits and :/@?&=._%+~- with {service} and the made secrets in braces."
  )
  fault(
    acme({ notes: [S] }),
    "notes: use a list of 1 to 8 sentences, each at most 200 characters and ending with a full stop."
  )

  // The services, by the settings rules (TS).
  fault(
    acme({ services: {} }),
    'services: name at least one service, such as "web".'
  )
  fault(
    unknownSetting,
    `services.db.deploy: a setting this zekno does not know (line ${lineOf(unknownSetting, S)}).`
  )
  fault(
    db({ source: { image: S } }),
    "services.db.source.image: use an image reference, such as ghcr.io/acme/web:1.4.2."
  )
  fault(
    db({ deploy: { start: `${S} && b` } }),
    "services.db.deploy.start: it runs without a shell, so put ; & | < > ( ) $ and backquotes in quotes. To use a shell, start it with sh -c."
  )
  fault(
    badVolume,
    `services.db.volumes: a volume name is lowercase letters, digits, hyphens and underscores, and starts with a letter (line ${lineOf(badVolume, S)}).`
  )
  fault(
    db({ volumes: { data: S } }),
    "services.db.volumes.data: use an absolute path in the container, such as /data. A folder of the server cannot be mounted from settings."
  )
  fault(
    db({ networking: { port: 5432, domains: [S] } }),
    "services.db.networking.domains: Domains are not in this version of zekno yet."
  )

  // The template's own rules (TF21 to TF34).
  fault(ACME_DB_BOARD, "services.db.source.image: pin the image by digest.")
  fault(
    db({ source: { image: `acme@sha256:${HEX}` } }),
    "services.db.source.image: name the image's version with a tag, such as postgres:18.7@sha256:<digest>."
  )
  fault(
    db({ source: { image: `ghcr.io/acme/db:1.2.3@sha256:${HEX}` } }),
    "services.db.source.image: use a Docker Official Image, or another source apps/cli/src/templates/publishers.ts lists."
  )
  fault(
    db({ networking: { port: 5432, publish: 5432 } }),
    "services.db.networking.publish: a template publishes no port."
  )
  fault(
    db({ variables: { secrets: ["DB_PASSWORD", "OTHER_SECRET"] } }),
    "services.db.variables.secrets: OTHER_SECRET is not made by this template. A template's services read only the secrets it makes."
  )
  fault(
    acme({ makes: { DB_PASSWORD: MADE, EXTRA_PASSWORD: MADE } }),
    "makes.EXTRA_PASSWORD: no service of this template reads it."
  )
  fault(
    acme({ offers: { DB_PASSWORD: "acme://app:{DB_PASSWORD}@{service}" } }),
    "offers.DB_PASSWORD: it is the name of a made secret, or of one a service of this template reads."
  )
  fault(
    acme({ offers: { DATABASE_URL: URL.replace("{service}", "{SERVICE}") } }),
    "offers.DATABASE_URL: each {...} names {service} or a secret this template makes."
  )
  fault(
    acme({ offers: { DATABASE_URL: "acme://app@{service}:5432/app" } }),
    "offers.DATABASE_URL: build it from at least one secret this template makes."
  )
  // TF34 (security review T5): the review's two hosts, and {service} twice, in the path, or before another host.
  for (const offer of [
    `acme://app:{DB_PASSWORD}@${S}.example:5432/app`,
    `acme://app:{DB_PASSWORD}@{service}.${S}.example:5432/app`,
    `acme://app:{DB_PASSWORD}@{service}:5432/{service}${S}`,
    `acme://${S}.example/@{service}:5432/app?p={DB_PASSWORD}`,
    `acme://app:{DB_PASSWORD}@{service}:5432@${S}.example/app`,
    `acme://app:{DB_PASSWORD}{service}:5432/${S}`,
  ])
    fault(
      acme({ offers: { DATABASE_URL: offer } }),
      "offers.DATABASE_URL: a connection secret points at {service} and nowhere else."
    )
  fault(
    acme({ software: S }),
    "software: use the version the first service's image tag names, 1.2.3, or its start before a dot, such as 9.7 for 9.7.4."
  )
  fault(
    acme({ notes: ["Something else."] }),
    'notes: say "Zekno does not back up this data." when a service keeps data in a volume.'
  )
  fault(
    acme({ services: { [LONG]: DB_SERVICE } }),
    `services.${LONG}.volumes.data: it is added as ${LONG}-data, which must be a volume name of at most 63 characters.`
  )
  fault(
    acme({
      services: {
        a: { ...DB_SERVICE, volumes: { "b-c": "/var/lib/db" } },
        "a-b": { source: { image: IMAGE }, volumes: { c: "/data" } },
      },
    }),
    "services.a-b.volumes.c: it is added as a-b-c, as a volume of a is."
  )

  // Across the catalogue (TC1, TC2): this file read after `before`.
  cases.push({
    file: F,
    text: acme(),
    sentence:
      "acme-db name: another template has this name, or names it in its also.",
    before: {
      file: "acme-old.json",
      text: acme({ name: "acme-old", also: ["acme-db"] }),
    },
  })
  cases.push({
    file: "other-db.json",
    text: acme({ name: "other-db", also: ["acme"] }),
    sentence: "other-db also: acme is another template's name, or in its also.",
    before: { file: F, text: acme({ also: ["acme"] }) },
  })
  return cases
}

/** One faulty file per sentence of contracts/template-file.md, in the order of the contract. */
export const BAD: BadFile[] = faulty()
