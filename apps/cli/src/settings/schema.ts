/**
 * Checking a settings file's text (specs/010-app-settings,
 * contracts/settings-file.md, "The settings", "Rules across settings" and
 * "The order of checks"): `checkSettings` gives the settings, or the first
 * fault in that order.
 *
 * Security (the maintainer's decisions, spec010-decisions.md, "Security"):
 * the text is content of the project folder and may be hostile, a cloned
 * repository's. It is bounded in size before it is read, read by zekno's
 * own strict reader (json.ts: depth, string length and duplicate keys,
 * nothing looser than JSON), and held to zod `strictObject`s, as `zekno.json`
 * is (shape.ts), every value to its rule (values.ts). A fault names a place (a service,
 * a section, a setting, or a line) and a fixed rule (words.ts), never a
 * piece of the text: a key that is not known is named by its line, and a
 * name is put into a place only after it passed its rule. Every exception
 * is caught and becomes a fault. Nothing in the file can hold a secret's
 * value, name a path on this machine or a folder of the server, run a
 * command here, or include another file: no setting takes any of these.
 */
import { LIMITS } from "@workspace/core"

import { composeText } from "./compose"
import { acrossRoutes, routeFault } from "./domains-health"
import { pathKey, readJson, type JsonValue } from "./json"
import {
  has,
  JsonNumber,
  LATER,
  SECTIONS,
  ServiceSchema,
  SettingsSchema,
  type ParsedService,
} from "./shape"
import type { ServiceSettings, Settings, SettingsFault } from "./types"
import {
  checkPlainName,
  checkServiceName,
  checkVolumeName,
  secretNameProblem,
  SETTINGS_BYTES,
} from "./values"
import * as words from "./words"
import type { PlaceRule, StartProblem } from "./words"

type Path = readonly (string | number)[]

/** The places of the file in the order of the text: each value's place on entry, and where its last value inside ends. */
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

/** The value at a place of the file, or undefined. */
function valueAt(value: JsonValue, path: Path): JsonValue | undefined {
  let node: JsonValue | undefined = value
  for (const part of path) {
    if (node instanceof Map) node = node.get(String(part))
    else if (Array.isArray(node) && typeof part === "number") node = node[part]
    else return undefined
  }
  return node
}

/**
 * What zod is given: objects of known keys as plain objects (every key of
 * them was found known before), the three objects of names (`services`,
 * `plain`, `volumes`) as `Map`s, so no name can reach a prototype, and
 * numbers with their text.
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
    (path.length === 1 && path[0] === "services") ||
    (path.length === 3 && path[2] === "volumes") ||
    (path.length === 4 && path[2] === "variables" && path[3] === "plain")
  // `Object.fromEntries` makes each key an own property, `__proto__` too: no key reaches a prototype.
  return named ? new Map(inner) : Object.fromEntries(inner)
}

/**
 * A setting a reader other than the settings file's refuses by its presence,
 * as a later setting is (step 4): its place and rule, or undefined. The
 * template reader gives one: a template may not name a domain or a health
 * check (specs/015-domains-https, contracts/cli.md, CL1).
 */
export type NotCarried = (
  svc: string,
  section: string,
  setting: string
) => PlaceRule | undefined

/** Step 4: the first key this zekno does not know, a later setting, or one `notCarried` refuses, in the order of the text. */
function unknownKey(
  top: ReadonlyMap<string, JsonValue>,
  lineOf: (path: Path) => number,
  notCarried?: NotCarried
): SettingsFault | undefined {
  const form = ({ place, rule }: PlaceRule, line: number): SettingsFault => ({
    kind: "form",
    place,
    rule,
    line,
  })
  for (const [key, value] of top) {
    if (!has(SettingsSchema.shape, key))
      return form(words.SV6(lineOf([key])), lineOf([key]))
    if (key !== "services" || !(value instanceof Map)) continue
    for (const [svc, service] of value) {
      // A service whose name breaks its rule is not entered: it cannot be named, and step 5 refuses it (SV4).
      if (checkServiceName(svc) !== undefined || !(service instanceof Map))
        continue
      for (const [section, body] of service) {
        const sectionPath = ["services", svc, section]
        if (!has(ServiceSchema.shape, section))
          return form(words.SV6(lineOf(sectionPath), svc), lineOf(sectionPath))
        const known = SECTIONS.get(section)
        if (known === undefined || !(body instanceof Map)) continue
        for (const [setting] of body) {
          const settingPath = [...sectionPath, setting]
          const isLater = LATER.get(section)?.get(setting)
          if (isLater !== undefined)
            return { kind: "later", setting: isLater, service: svc }
          const refused = notCarried?.(svc, section, setting)
          if (refused !== undefined) return { kind: "form", ...refused }
          if (!has(known, setting))
            return form(
              words.SV6(lineOf(settingPath), svc, section),
              lineOf(settingPath)
            )
        }
      }
    }
  }
  return undefined
}

/** The ids of issues about a name rather than a value: said before the value at the same place. */
const NAME_IDS = new Set(["SV4", "SV23", "SV28"])

/** A zod issue as a place and a rule. Names are put in only once they pass their rule. */
function faultOf(
  id: string,
  path: Path,
  top: JsonValue,
  lineOf: (path: Path) => number
): SettingsFault {
  const form = ({ place, rule }: PlaceRule, line?: number): SettingsFault =>
    line === undefined
      ? { kind: "form", place, rule }
      : { kind: "form", place, rule, line }
  const svc = path[1]
  if (id === "SV3") return form(words.SV3)
  if (id === "SV2" || typeof svc !== "string") return form(words.SV2)
  const servicePath = ["services", svc]
  if (id === "SV4" || checkServiceName(svc) !== undefined)
    return form(words.SV4(lineOf(servicePath)), lineOf(servicePath))
  const section = path[2]
  const name = path[4]
  const volume = path[3]
  // The ids of domains and the health check (specs/015-domains-https, CL1).
  const routed = routeFault(id, svc, path, lineOf)
  if (routed !== undefined) return form(routed.said, routed.line)
  switch (id) {
    case "SV7":
      return form(words.SV7(svc))
    case "SV8":
      return form(words.SV8(svc))
    case "SV10":
      return form(words.SV10(svc))
    case "SV11":
      return form(words.SV11(svc))
    case "SV12":
      return form(words.SV12(svc))
    case "SV13":
      return form(words.SV13(svc))
    case "SV14":
      return form(words.SV14(svc))
    case "SV17":
      return form(words.SV17(svc))
    case "SV18":
    case "SV20":
      return form(
        id === "SV18"
          ? words.SV18(svc, lineOf(path))
          : words.SV20(svc, lineOf(path)),
        lineOf(path)
      )
    case "SV19": {
      const secret = valueAt(top, path)
      // Said with the name only when it passed the secret-name pattern, as a reserved one has.
      return typeof secret === "string" &&
        secretNameProblem(secret) === "reserved"
        ? form(words.SV19(svc, secret), lineOf(path))
        : form(words.SV18(svc, lineOf(path)), lineOf(path))
    }
    case "SV21":
      return form(words.SV21(svc))
    case "SV22":
      return form(words.SV22(svc))
    case "SV26":
      return form(words.SV26(svc))
    case "SV27":
      return form(words.SV27(svc))
    case "SV31":
      return form(words.SV31(svc))
  }
  if (id === "SV23" || id.startsWith("SV24")) {
    const namePath = ["services", svc, "variables", "plain", String(name)]
    const problem =
      id === "SV24:hidden" ? "hidden" : id === "SV24:blank" ? "blank" : "form"
    return id !== "SV23" &&
      typeof name === "string" &&
      checkPlainName(name) === undefined
      ? form(words.SV24(svc, name, problem))
      : form(words.SV23(svc, lineOf(namePath)), lineOf(namePath))
  }
  if (id === "SV28" || id === "SV29") {
    const namePath = ["services", svc, "volumes", String(volume)]
    return id === "SV29" &&
      typeof volume === "string" &&
      checkVolumeName(volume) === undefined
      ? form(words.SV29(svc, volume))
      : form(words.SV28(svc, lineOf(namePath)), lineOf(namePath))
  }
  if (id.startsWith("SV9:"))
    return form(words.SV9(svc, id.slice(4) as StartProblem | "type"))
  // words.SV5, and anything not foreseen: the service, or its section, is not the object it should be.
  return typeof section === "string" && has(ServiceSchema.shape, section)
    ? form(words.SV5(svc, section))
    : form(words.SV5(svc))
}

/**
 * The settings of one service as the schema gave them; a section, list or
 * object with nothing in it is left out, but for a health check, where `{}`
 * is one with neither a path nor a limit.
 */
function serviceOf(service: ParsedService): ServiceSettings {
  const { deploy, networking, variables, volumes } = service
  const plain = [...(variables?.plain ?? [])]
  const mounts = [...(volumes ?? [])]
  const health = deploy?.healthcheck
  return {
    image: service.source.image,
    ...(deploy?.start === undefined ? {} : { start: deploy.start }),
    ...(deploy?.restart === undefined
      ? {}
      : { restart: deploy.restart as ServiceSettings["restart"] }),
    ...(deploy?.memory === undefined ? {} : { memory: deploy.memory }),
    ...(deploy?.cpus === undefined ? {} : { cpus: deploy.cpus.text }),
    ...(health === undefined
      ? {}
      : {
          health: {
            ...(health.path === undefined ? {} : { path: health.path }),
            ...(health.timeout === undefined
              ? {}
              : { timeout: health.timeout.value }),
          },
        }),
    ...(networking?.port === undefined ? {} : { port: networking.port.value }),
    ...(networking?.publish === undefined
      ? {}
      : { publish: networking.publish.value }),
    ...(networking?.domains === undefined || networking.domains.length === 0
      ? {}
      : { domains: networking.domains }),
    ...(variables?.secrets === undefined || variables.secrets.length === 0
      ? {}
      : { secrets: variables.secrets }),
    ...(plain.length === 0 ? {} : { plain }),
    ...(mounts.length === 0 ? {} : { volumes: mounts }),
  }
}

/**
 * Step 6: the rules across settings, in the order listed, then the size of
 * the Compose text (words.SV33). No file within the other limits turns into more
 * than about 237 KiB of Compose text today; words.SV33 is kept so that a limit
 * changed later can never make a deploy larger than a runner takes.
 */
export function acrossSettings(settings: Settings): PlaceRule | undefined {
  const { services } = settings
  for (const [svc, service] of services)
    if (service.publish !== undefined && service.port === undefined)
      return words.SV15(svc)
  const published = new Map<number, string>()
  for (const [svc, service] of services) {
    if (service.publish === undefined) continue
    const other = published.get(service.publish)
    if (other !== undefined) return words.SV16(svc, other)
    published.set(service.publish, svc)
  }
  for (const [svc, service] of services)
    for (const [name] of service.plain ?? [])
      if (service.secrets?.includes(name)) return words.SV25(svc, name)
  for (const [svc, service] of services) {
    const paths = (service.volumes ?? []).map(([, path]) => path)
    if (new Set(paths).size !== paths.length) return words.SV30(svc)
  }
  // specs/015-domains-https, CL1: SV38, SV39, SV44, SV40, SV45.
  const routed = acrossRoutes(settings)
  if (routed !== undefined) return routed
  const secrets = new Set(services.flatMap(([, s]) => s.secrets ?? []))
  if (secrets.size > LIMITS.secretsPerDeploy) return words.SV32
  if (Buffer.byteLength(composeText(settings)) > LIMITS.composeBytes)
    return words.SV33
  return undefined
}

/** The checks of contracts/settings-file.md, "The order of checks", steps 2 to 6. */
function check(text: string): Settings | SettingsFault {
  const read = readJson(text.startsWith("\ufeff") ? text.slice(1) : text)
  if (!("value" in read)) {
    const said =
      read.kind === "syntax"
        ? words.SJ1(read.line)
        : read.kind === "twice"
          ? words.SJ2(read.line, read.first ?? read.line)
          : read.kind === "deep"
            ? words.SJ3(read.line)
            : read.kind === "long"
              ? words.SJ4(read.line)
              : words.SJ5
    return { kind: "form", ...said, line: read.line }
  }
  return checkSettingsValue(
    read.value as ReadonlyMap<string, JsonValue>,
    read.lines,
    read.numbers
  )
}

/**
 * Steps 3 to 6 of contracts/settings-file.md, "The order of checks", on a
 * value `readJson` already read: its top object, the line of each key and
 * the text of each number, by `pathKey`. `checkSettings` calls it after
 * reading a file; the template reader (specs/012-templates, research R2)
 * calls it on a template's `services`, so they are held to the same rules
 * and their faults name the template file's own lines, with `notCarried`
 * for the settings a template may not name.
 */
export function checkSettingsValue(
  top: ReadonlyMap<string, JsonValue>,
  lines: ReadonlyMap<string, number>,
  numbers: ReadonlyMap<string, string>,
  notCarried?: NotCarried
): Settings | SettingsFault {
  const lineOf = (path: Path): number => lines.get(pathKey(path)) ?? 1

  // 3. The version of the file.
  const version = numbers.get(pathKey(["zekno"]))
  if (typeof top.get("zekno") !== "number" || version === undefined)
    return { kind: "form", ...words.SV1 }
  if (version !== "1")
    return /^[1-9][0-9]*$/.test(version)
      ? { kind: "later", setting: "version" }
      : { kind: "form", ...words.SV1 }

  // 4. Every key, in the order of the text.
  const unknown = unknownKey(top, lineOf, notCarried)
  if (unknown !== undefined) return unknown

  // 5. Each value, in the order of the text: of zod's issues, the one met first.
  const parsed = SettingsSchema.safeParse(inputOf(top, [], numbers))
  if (!parsed.success) {
    const { at, end } = placesOf(top)
    const placeOf = (path: Path, id: string): number => {
      const found = at.get(pathKey(path))
      // A name is met before its value; a missing key once its object has ended.
      if (found !== undefined) return NAME_IDS.has(id) ? found - 0.25 : found
      return (end.get(pathKey(path.slice(0, -1))) ?? 0) + 0.25
    }
    const first = parsed.error.issues
      .map((issue) => ({
        id: issue.message,
        path: issue.path.map((part) =>
          typeof part === "symbol" ? String(part) : part
        ),
      }))
      .map((issue) => ({ ...issue, place: placeOf(issue.path, issue.id) }))
      .reduce((a, b) => (b.place < a.place ? b : a))
    return faultOf(first.id, first.path, top, lineOf)
  }

  const settings: Settings = {
    version: 1,
    services: [...parsed.data.services].map(
      ([name, service]) => [name, serviceOf(service)] as const
    ),
  }
  // 6. The rules across settings.
  const across = acrossSettings(settings)
  if (across !== undefined) return { kind: "form", ...across }
  return settings
}

/**
 * Checks the text of a settings file, after a leading byte order mark is
 * dropped: the settings, or the first fault by contracts/settings-file.md,
 * "The order of checks". `file` is the file as a sentence names it. A text
 * larger than a settings file may be is words.SR3, so text zekno writes always
 * reads back. Never throws.
 */
export function checkSettings(
  text: string,
  file: string
): Settings | SettingsFault {
  try {
    if (Buffer.byteLength(text) > SETTINGS_BYTES)
      return { kind: "read", sentence: words.SR3(file) }
    return check(text)
  } catch {
    return { kind: "read", sentence: words.SR5(file) }
  }
}

/** Whether `checkSettings` gave settings rather than a fault. */
export const isSettings = (read: Settings | SettingsFault): read is Settings =>
  "services" in read
