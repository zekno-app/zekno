/**
 * Reading and checking a template file (specs/012-templates,
 * contracts/template-file.md, "The order of checks"; research R2):
 * `readTemplate` gives the template, or the first fault in that order.
 *
 * A template is reviewed data inside the CLI, read strictly all the same,
 * whatever its history: its name, then its size (at most 16 KiB), strict
 * UTF-8 (one leading byte order mark dropped), JSON by feature 010's strict
 * reader (settings/json.ts: no key written twice at any depth, depth and
 * string length bounded, numbers kept as written, objects as `Map`s so no key
 * reaches a prototype), only the fields this zekno knows (`asks` refused by
 * its presence), each field held to its rule (shape.ts), its `services` held
 * to every rule of a settings file (settings/schema.ts, `checkSettingsValue`),
 * then the rules a settings file does not have: the image pinned by digest,
 * with a tag, from an allowed source (publishers.ts); no published port;
 * every secret a service reads made by the template; no two volumes added
 * under one name; every made secret read; connection secrets built only
 * from made secrets and `{service}`, pointing at `{service}` and nowhere
 * else; the backup note; the version its image's tag names.
 *
 * A fault never holds content of the file: it is a place built from names
 * that passed their rule, a line number, and fixed words (file-words.ts).
 * Every exception is caught and becomes a fault.
 */
import { sanitize } from "../server/sanitize"
import { pathKey, readJson, type JsonValue } from "../settings/json"
import { checkSettingsValue } from "../settings/schema"
import { JsonNumber } from "../settings/shape"
import type { Settings, SettingsFault } from "../settings/types"
import { checkVolumeName } from "../settings/values"
import * as words from "./file-words"
import type { PlaceRule } from "./file-words"
import { isPinned, publisherOf, tagOf } from "./publishers"
import {
  fieldsShape,
  MAX_SERVICES,
  TEMPLATE_BYTES,
  TEMPLATE_NAME,
  type ParsedFields,
} from "./shape"
import type { Offer, Template, TemplateFault, TemplateService } from "./types"

type Path = readonly (string | number)[]

/** The fields a template file may have, `asks` among them: refused by its presence (TF4). */
const KNOWN = new Set([
  "template",
  "name",
  "title",
  "about",
  "software",
  "author",
  "also",
  "services",
  "makes",
  "offers",
  "notes",
  "asks",
])

/** The note a template says when a service keeps data in a volume (TF31). */
export const BACKUP_NOTE = "Zekno does not back up this data."

/** A surrogate that is not half of a pair: a text that no UTF-8 file decodes to. */
const LONE_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

/** The byte order mark, dropped once at the very start. */
const BOM = String.fromCharCode(0xfeff)

/** A placeholder of an offer: `{service}` or `{NAME}`. */
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g

/** Thrown inside the reader to stop at a fault. */
class Stop {
  constructor(readonly fault: TemplateFault) {}
}

const form = ({ place, rule }: PlaceRule, line?: number): TemplateFault =>
  line === undefined
    ? { kind: "form", place, rule }
    : { kind: "form", place, rule, line }

const stop = (said: PlaceRule, line?: number): Stop =>
  new Stop(form(said, line))

/** A template's name from its file's name: `<name>.json`, `<name>` held to the name rule; undefined otherwise (TR1). */
export function templateNameOf(file: string): string | undefined {
  if (!file.endsWith(".json")) return undefined
  const name = file.slice(0, -".json".length)
  return TEMPLATE_NAME.test(name) ? name : undefined
}

/** A fault as the sentence a person reads: `<name> <place>: <rule>`, or a later version's or a question's two sentences. */
export function faultSentence(file: string, fault: TemplateFault): string {
  return fault.kind === "later"
    ? `${fault.first} ${fault.second}`
    : words.inTemplate(templateNameOf(file), fault.place, fault.rule)
}

/** Steps 1 and 2: the file's text, strict UTF-8 within the size, one leading byte order mark dropped. */
function textOf(text: string | Uint8Array): string {
  let decoded: string
  if (typeof text === "string") {
    if (Buffer.byteLength(text, "utf8") > TEMPLATE_BYTES) throw stop(words.TR2)
    if (LONE_SURROGATE.test(text)) throw stop(words.TR3)
    decoded = text
  } else {
    if (text.length > TEMPLATE_BYTES) throw stop(words.TR2)
    try {
      decoded = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(text)
    } catch {
      throw stop(words.TR3)
    }
  }
  return decoded.startsWith(BOM) ? decoded.slice(1) : decoded
}

/** The places of a value in the order of the text: each value's place on entry, and where its last value inside ends. */
function placesOf(value: JsonValue): {
  at: Map<string, number>
  end: Map<string, number>
} {
  const at = new Map<string, number>()
  const end = new Map<string, number>()
  let count = 0
  const walk = (node: JsonValue, path: Path): void => {
    const key = pathKey(path)
    at.set(key, count++)
    if (node instanceof Map)
      for (const [name, inner] of node) walk(inner, [...path, name])
    else if (Array.isArray(node))
      for (const [index, inner] of node.entries()) walk(inner, [...path, index])
    end.set(key, count - 1)
  }
  walk(value, [])
  return { at, end }
}

/**
 * What zod is given for the fields: the top and each made secret as plain
 * objects (every key of the top was found known before; `Object.fromEntries`
 * makes each key an own property, so none reaches a prototype), `makes` and
 * `offers` as `Map`s, and numbers with their text.
 */
function inputOf(
  node: JsonValue,
  path: Path,
  numbers: ReadonlyMap<string, string>
): unknown {
  if (typeof node === "number")
    return new JsonNumber(numbers.get(pathKey(path)) ?? String(node), node)
  if (Array.isArray(node))
    return node.map((item, index) => inputOf(item, [...path, index], numbers))
  if (!(node instanceof Map)) return node
  const inner = [...node].map(
    ([key, value]) =>
      [key, inputOf(value, [...path, key], numbers)] as [string, unknown]
  )
  const named =
    path.length === 1 && (path[0] === "makes" || path[0] === "offers")
  return named ? new Map(inner) : Object.fromEntries(inner)
}

/** The ids of issues about a name rather than a value: said before the value at the same place. */
const NAME_IDS = new Set(["TF15", "TF18"])

/** Step 6's issue as a fault. Names are put in only once they pass their rule. */
function fieldFault(
  id: string,
  path: Path,
  name: string,
  lineOf: (path: Path) => number
): Stop {
  const field = String(path[0])
  const key = String(path[1])
  switch (id) {
    case "TF5":
      return stop(words.TF5(field))
    case "TF6":
      return stop(words.TF6)
    case "TF7":
      return stop(words.TF7(name))
    case "TF8":
      return stop(words.TF8)
    case "TF9":
      return stop(words.TF9)
    case "TF10":
      return stop(words.TF10)
    case "TF11":
      return stop(words.TF11)
    case "TF12":
      return stop(words.TF12)
    case "TF15":
      return stop(words.TF15(lineOf(["makes", key])), lineOf(["makes", key]))
    case "TF16":
      return stop(words.TF16(key))
    case "TF17":
      return stop(words.TF17)
    case "TF18":
      return stop(words.TF18(lineOf(["offers", key])), lineOf(["offers", key]))
    case "TF19":
      return stop(words.TF19(key))
    case "TF20":
      return stop(words.TF20)
  }
  // TF14, and anything not foreseen: the field is said, never its value.
  return stop(field === "makes" ? words.TF14 : words.TF5(field))
}

/** Step 6: each field of its form, in the order of the text; then a field left out, in the order of the format. */
function checkFields(
  top: ReadonlyMap<string, JsonValue>,
  name: string,
  lines: ReadonlyMap<string, number>,
  numbers: ReadonlyMap<string, string>
): ParsedFields {
  const lineOf = (path: Path): number => lines.get(pathKey(path)) ?? 1
  const parsed = fieldsShape(name).safeParse(inputOf(top, [], numbers))
  if (parsed.success) return parsed.data
  const { at, end } = placesOf(top)
  const placeOf = (path: Path, id: string): number => {
    const found = at.get(pathKey(path))
    // A name is met before its value; a field left out once the file has ended.
    if (found !== undefined) return NAME_IDS.has(id) ? found - 0.25 : found
    return (end.get(pathKey(path.slice(0, -1))) ?? 0) + 0.25
  }
  const first = parsed.error.issues
    .map((issue) => {
      const path = issue.path.map((part) =>
        typeof part === "symbol" ? String(part) : part
      )
      return { id: issue.message, path, place: placeOf(path, issue.message) }
    })
    .reduce((a, b) => (b.place < a.place ? b : a))
  throw fieldFault(first.id, first.path, name, lineOf)
}

/** Step 7: a fault of feature 010's settings rules, said at its place in the template file (TS). */
function servicesFault(fault: SettingsFault): Stop {
  switch (fault.kind) {
    case "form":
      return stop(
        { place: words.templatePlace(fault.place), rule: fault.rule },
        fault.line
      )
    case "later":
      // Only `zekno` 1 is given, so the later setting is one of a service's.
      if (fault.setting !== "version" && fault.service !== undefined)
        return stop(words.laterInTemplate(fault.setting, fault.service))
      throw new Error("A later version of the settings was not given.")
    case "read":
      throw new Error("The settings rules read no file here.")
    case "build":
      // specs/016-build-from-source, CL1: a fault of a service's build settings, at the service's place, said by its line's id until the words tasks (FR-092).
      return stop({
        place: words.templatePlace(fault.fault.service),
        rule: fault.fault.id,
      })
  }
}

/** The names of the placeholders of an offer, in its order. */
const placeholdersOf = (text: string): string[] =>
  [...text.matchAll(PLACEHOLDER)].map((found) => found[1]!)

/**
 * TF34 (security review T5): an offer holds `{service}` exactly once, as the
 * whole host of its address. Right after `//` or `@`, and followed by `:`,
 * `/`, `?` or the end; inside the authority, so nothing before it but its
 * `//` is a `/` or `?` (a `{service}` in the path names no host); with no
 * `@` after it, so it is not the user part of another host's address. A
 * connection secret carries a made password to the user's own services, so
 * it may send them to the template's first service and nowhere else.
 */
function pointsAtService(text: string): boolean {
  const parts = text.split("{service}")
  if (parts.length !== 2) return false
  const [before, after] = parts as [string, string]
  return (
    /(?:\/\/|@)$/.test(before) &&
    /^(?:[:/?]|$)/.test(after) &&
    !/[/?]/.test(before.replace("//", "")) &&
    !after.includes("@")
  )
}

/**
 * Step 8: the template's own rules, in the contract's order; the services,
 * each with its image. A template's service runs an image, never a build:
 * since a settings file's service may build (specs/016-build-from-source,
 * CL1), one with no image is refused as one whose image is not pinned (TF21).
 */
function ownRules(
  settings: Settings,
  fields: ParsedFields,
  software: string,
  notes: readonly string[]
): Template["services"] {
  const services = settings.services
  const made = [...fields.makes.keys()]
  const offers = [...(fields.offers ?? new Map<string, string>())]
  const imaged: (readonly [string, TemplateService])[] = []
  for (const [svc, service] of services) {
    const { image } = service
    if (image === undefined || !isPinned(image)) throw stop(words.TF21(svc))
    if (tagOf(image) === undefined) throw stop(words.TF22(svc))
    if (publisherOf(image) === undefined) throw stop(words.TF23(svc))
    imaged.push([svc, { ...service, image }])
  }
  for (const [svc, service] of services)
    if (service.publish !== undefined) throw stop(words.TF24(svc))
  for (const [svc, service] of services)
    for (const secret of service.secrets ?? [])
      if (!made.includes(secret)) throw stop(words.TF25(svc, secret))
  for (const [svc, service] of services)
    for (const [volume] of service.volumes ?? [])
      if (checkVolumeName(`${svc}-${volume}`) !== undefined)
        throw stop(words.TF32(svc, volume))
  // Two services' volumes added under one name would be one volume of the app, shared (research R5): `a` with `b-c`, `a-b` with `c`.
  const added = new Map<string, string>()
  for (const [svc, service] of services)
    for (const [volume] of service.volumes ?? []) {
      const other = added.get(`${svc}-${volume}`)
      if (other !== undefined) throw stop(words.TF33(svc, volume, other))
      added.set(`${svc}-${volume}`, svc)
    }
  const read = new Set(services.flatMap(([, service]) => service.secrets ?? []))
  for (const name of made) if (!read.has(name)) throw stop(words.TF26(name))
  for (const [offer] of offers)
    if (made.includes(offer) || read.has(offer)) throw stop(words.TF27(offer))
  for (const [offer, text] of offers)
    if (
      placeholdersOf(text).some(
        (placeholder) =>
          placeholder !== "service" && !made.includes(placeholder)
      )
    )
      throw stop(words.TF28(offer))
  for (const [offer, text] of offers)
    if (!placeholdersOf(text).some((placeholder) => made.includes(placeholder)))
      throw stop(words.TF29(offer))
  for (const [offer, text] of offers)
    if (!pointsAtService(text)) throw stop(words.TF34(offer))
  // `services` holds 1 to 8 services here, and the first has a tag (TF22).
  const tag = tagOf(imaged[0]![1].image)!
  if (tag !== software && !tag.startsWith(`${software}.`))
    throw stop(words.TF30(tag))
  const keepsData = services.some(([, service]) => service.volumes?.length)
  if (keepsData && !notes.includes(BACKUP_NOTE)) throw stop(words.TF31)
  return imaged
}

/** Steps 3 to 8 on the file's text (contracts/template-file.md, "The order of checks"). */
function read(name: string, text: string): Template | TemplateFault {
  // 3. JSON, by the settings file's strict reader.
  const json = readJson(text)
  if (!("value" in json)) {
    const said =
      json.kind === "syntax"
        ? words.TR4_SYNTAX(json.line)
        : json.kind === "twice"
          ? words.TR4_TWICE(json.line, json.first ?? json.line)
          : json.kind === "deep"
            ? words.TR4_DEEP(json.line)
            : json.kind === "long"
              ? words.TR4_LONG(json.line)
              : words.TR4_TOP
    return form(said, json.line)
  }
  const top = json.value as ReadonlyMap<string, JsonValue>
  const lineOf = (path: Path): number => json.lines.get(pathKey(path)) ?? 1

  // 4. The version of the format.
  const version = json.numbers.get(pathKey(["template"]))
  if (typeof top.get("template") !== "number" || version === undefined)
    return form(words.TF1)
  if (version !== "1")
    return /^[1-9][0-9]*$/.test(version)
      ? { kind: "later", ...words.TF2(name) }
      : form(words.TF1)

  // 5. Every key of the top, in the order of the text: one not known, or `asks`.
  for (const [key] of top) {
    if (key === "asks") return { kind: "later", ...words.TF4(name) }
    if (!KNOWN.has(key)) return form(words.TF3(lineOf([key])), lineOf([key]))
  }

  // 6. Each field of its form.
  const fields = checkFields(top, name, json.lines, json.numbers)

  // 7. `services` by the settings file's steps 3 to 6, as a settings file of version 1 holding them, then its count. A domain
  // and a health check are refused by their presence at step 4, as before feature 015 (specs/015-domains-https, CL1).
  const numbers = new Map(json.numbers)
  numbers.set(pathKey(["zekno"]), "1")
  const settings = checkSettingsValue(
    new Map<string, JsonValue>([
      ["zekno", 1],
      ["services", top.get("services")!],
    ]),
    json.lines,
    numbers,
    words.notInTemplate
  )
  if (!("services" in settings)) throw servicesFault(settings)
  if (settings.services.length > MAX_SERVICES) return form(words.TF13)

  // 8. The template's own rules.
  const services = ownRules(settings, fields, fields.software, fields.notes)

  return {
    name: fields.name,
    title: fields.title,
    about: fields.about,
    software: fields.software,
    author: fields.author,
    also: fields.also ?? [],
    services,
    makes: [...fields.makes].map(([made, secret]) => ({
      name: made,
      kind: secret.kind,
      length: secret.length.value,
    })),
    offers: [...(fields.offers ?? [])].map(([offer, text]): Offer => ({
      name: offer,
      text,
    })),
    notes: fields.notes,
  }
}

/**
 * Reads and checks one template file: `file` its name (`postgres.json`),
 * `text` its content as text or bytes. The template, or the first fault by
 * contracts/template-file.md, "The order of checks". Never throws: an
 * exception while decoding is TR3, any other TR4's `this is not JSON.`
 */
export function readTemplate(
  file: string,
  text: string | Uint8Array
): Template | TemplateFault {
  let decoding = true
  try {
    // 1. The file's name.
    const name = templateNameOf(file)
    if (name === undefined) return form(words.TR1(sanitize(file)))
    // 2. The bytes.
    const decoded = textOf(text)
    decoding = false
    return read(name, decoded)
  } catch (error) {
    if (error instanceof Stop) return error.fault
    return form(decoding ? words.TR3 : words.TR4_SYNTAX(1))
  }
}

/** Whether `readTemplate` gave a template rather than a fault. */
export const isTemplate = (read: Template | TemplateFault): read is Template =>
  "services" in read

/**
 * Step 9, across the catalogue (TC1, TC2): the first template, in the order
 * given, whose name is another's name or in another's `also`, or one of whose
 * `also` is; each is compared with those before it. Its name and the fault,
 * or undefined.
 */
export function acrossTemplates(
  templates: readonly Template[]
): { name: string; fault: TemplateFault } | undefined {
  for (const [index, template] of templates.entries()) {
    const before = templates.slice(0, index)
    const taken = new Set(
      before.flatMap((other) => [other.name, ...other.also])
    )
    if (taken.has(template.name))
      return { name: template.name, fault: form(words.TC1) }
    const clash = template.also.find((other) => taken.has(other))
    if (clash !== undefined)
      return { name: template.name, fault: form(words.TC2(clash)) }
  }
  return undefined
}
