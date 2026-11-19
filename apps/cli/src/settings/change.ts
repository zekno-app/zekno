/**
 * One change to an app's settings (specs/010-app-settings, data-model.md, "A
 * change"; contracts/commands.md, `set` and `unset`): which setting a name
 * such as `web.memory` is, the settings with that one setting changed, and
 * how a value reads for a person. Nothing here reads or writes a file.
 *
 * The value is checked by its rule (values.ts), and the whole file with the
 * change by the reader itself (`checkSettings` of `settingsText`), so a
 * change can never write a file zekno would refuse to read. A name typed by
 * the person is put into a sentence only once it passed its rule.
 */
import { sanitize } from "../server/sanitize"
import {
  routeChanged,
  routeIsNow,
  routeIsSet,
  routeShown,
  type RouteKey,
} from "./domains-health"
import { checkSettings, isSettings } from "./schema"
import { settingsText } from "./text"
import type {
  Change,
  LaterSetting,
  ServiceSettings,
  SettingPath,
  Settings,
} from "./types"
import {
  checkPlainName,
  checkServiceName,
  checkVolumeName,
  readTyped,
  SETTINGS_FILE,
  splitStart,
} from "./values"
import {
  CS15,
  CS16,
  CS17,
  CS4,
  CS7,
  CS8,
  laterSentences,
  NOT_SET,
  restartShown,
  settingWords,
} from "./words"

/** The settings a single name gives, with and without its section. Maps, so no name reaches a prototype. */
const SINGLE = new Map<string, Exclude<SettingPath["key"], "plain" | "volume">>(
  [
    ["image", "image"],
    ["source.image", "image"],
    ["start", "start"],
    ["deploy.start", "start"],
    ["restart", "restart"],
    ["deploy.restart", "restart"],
    ["memory", "memory"],
    ["deploy.memory", "memory"],
    ["cpus", "cpus"],
    ["deploy.cpus", "cpus"],
    ["port", "port"],
    ["networking.port", "port"],
    ["publish", "publish"],
    ["networking.publish", "publish"],
    ["secrets", "secrets"],
    ["variables.secrets", "secrets"],
    // specs/015-domains-https, CL1: `domains`, `health` and `health-timeout`, and their places in the file.
    ["domains", "domains"],
    ["networking.domains", "domains"],
    ["health", "health"],
    ["healthcheck", "health"],
    ["deploy.healthcheck", "health"],
    ["health-timeout", "health-timeout"],
    ["deploy.healthcheck.timeout", "health-timeout"],
  ]
)

/** The later settings, with and without their section (CS6). */
const LATER = new Map<string, Exclude<LaterSetting, "version">>([
  ["build", "build"],
  ["source.build", "build"],
  ["predeploy", "predeploy"],
  ["deploy.predeploy", "predeploy"],
  ["replicas", "replicas"],
  ["deploy.replicas", "replicas"],
])

/** Whether a setting is one of specs/015-domains-https's, which settings/domains-health.ts reads, shows and changes. */
const isRoute = (key: SettingPath["key"]): key is RouteKey =>
  key === "domains" || key === "health" || key === "health-timeout"

/**
 * The setting `<service>.<setting>` names (contracts/commands.md's table,
 * research R9 item 17): `web.memory` and `web.deploy.memory`,
 * `web.plain.NAME` and `web.variables.plain.NAME`, `web.volumes.name`; a
 * later setting is its own answer (CS6), anything else is unknown (CS5). The
 * service is kept as typed: whether the file has it, and whether it may be
 * named in a sentence, is for `applyChange` (CS4).
 */
export function parseSettingPath(
  text: string
):
  | SettingPath
  | { later: Exclude<LaterSetting, "version"> }
  | { unknown: true } {
  const dot = text.indexOf(".")
  if (dot <= 0) return { unknown: true }
  const service = text.slice(0, dot)
  const setting = text.slice(dot + 1)
  const later = LATER.get(setting)
  if (later !== undefined) return { later }
  const key = SINGLE.get(setting)
  if (key !== undefined) return { service, key }
  for (const prefix of ["plain.", "variables.plain."]) {
    if (!setting.startsWith(prefix)) continue
    const name = setting.slice(prefix.length)
    if (checkPlainName(name) === undefined)
      return { service, key: "plain", name }
  }
  if (setting.startsWith("volumes.")) {
    const name = setting.slice("volumes.".length)
    if (checkVolumeName(name) === undefined)
      return { service, key: "volume", name }
  }
  return { unknown: true }
}

/** The words of a path: its label, question, `That is not ...` and rule. */
const wordsOf = (path: SettingPath) =>
  settingWords(
    path.key,
    path.key === "plain" || path.key === "volume" ? path.name : ""
  )

/** A plain variable's value as a person reads it: an empty one as `""`, so it is seen. */
const plainShown = (value: string): string => (value === "" ? '""' : value)

/** How the value of `path` reads in `settings`, cleaned: the words of a setting left out when it is not set. */
export function shownValue(path: SettingPath, settings: Settings): string {
  const service = settings.services.find(([name]) => name === path.service)?.[1]
  const shown = (): string | undefined => {
    if (service === undefined) return undefined
    switch (path.key) {
      case "image":
        return service.image
      case "start":
        return service.start
      case "restart":
        return service.restart && restartShown(service.restart)
      case "memory":
        return service.memory
      case "cpus":
        return service.cpus
      case "port":
        return service.port === undefined ? undefined : String(service.port)
      case "publish":
        return service.publish === undefined
          ? undefined
          : String(service.publish)
      case "secrets":
        return service.secrets?.join(", ")
      case "plain": {
        const value = service.plain?.find(([name]) => name === path.name)?.[1]
        return value === undefined ? undefined : plainShown(value)
      }
      case "volume":
        return service.volumes?.find(([name]) => name === path.name)?.[1]
      default:
        return routeShown(service, path.key)
    }
  }
  return sanitize(shown() ?? NOT_SET[path.key])
}

/** Two start commands are the same when they split into the same words. */
function sameStart(a: string, b: string): boolean {
  const left = splitStart(a)
  const right = splitStart(b)
  return (
    "words" in left &&
    "words" in right &&
    left.words.length === right.words.length &&
    left.words.every((word, index) => word === right.words[index])
  )
}

/** Whether `value` is what `path` holds now. */
function isNow(
  service: ServiceSettings,
  path: SettingPath,
  value: string | number | readonly string[]
): boolean {
  if (isRoute(path.key)) return routeIsNow(service, path.key, value)
  switch (path.key) {
    case "start":
      return (
        service.start !== undefined && sameStart(service.start, String(value))
      )
    case "cpus":
      return (
        service.cpus !== undefined && Number(service.cpus) === Number(value)
      )
    case "secrets": {
      const now = service.secrets ?? []
      const next = value as readonly string[]
      return (
        now.length === next.length &&
        now.every((name, index) => name === next[index])
      )
    }
    case "plain":
      return service.plain?.find(([name]) => name === path.name)?.[1] === value
    case "volume":
      return (
        service.volumes?.find(([name]) => name === path.name)?.[1] === value
      )
    default:
      return service[path.key] === value
  }
}

/** Whether `path` is set in a service. */
function isSet(service: ServiceSettings, path: SettingPath): boolean {
  if (isRoute(path.key)) return routeIsSet(service, path.key)
  if (path.key === "plain")
    return service.plain?.some(([name]) => name === path.name) ?? false
  if (path.key === "volume")
    return service.volumes?.some(([name]) => name === path.name) ?? false
  return service[path.key] !== undefined
}

/** A list of pairs with `name` set to `value`: in its place when it is there, else last. */
function withPair(
  pairs: readonly (readonly [string, string])[] | undefined,
  name: string,
  value: string
): (readonly [string, string])[] {
  const list = [...(pairs ?? [])]
  const at = list.findIndex(([each]) => each === name)
  if (at === -1) list.push([name, value])
  else list[at] = [name, value]
  return list
}

/** A service with `path` set to `value`, or left out when `value` is undefined. A list left empty is left out. */
function changed(
  service: ServiceSettings,
  path: SettingPath,
  value: string | number | readonly string[] | undefined
): ServiceSettings {
  if (isRoute(path.key)) return routeChanged(service, path.key, value)
  const next: Record<string, unknown> = { ...service }
  if (path.key === "plain" || path.key === "volume") {
    const field = path.key === "plain" ? "plain" : "volumes"
    const pairs =
      value === undefined
        ? (service[field] ?? []).filter(([name]) => name !== path.name)
        : withPair(service[field], path.name, String(value))
    if (pairs.length === 0) delete next[field]
    else next[field] = pairs
  } else if (value === undefined) delete next[path.key]
  else next[path.key] = value
  return next as ServiceSettings
}

/**
 * The settings with one setting changed (`value` given) or removed
 * (`value` undefined), checked whole, or why not, with the exit status
 * contracts/commands.md gives it: CS4 (no such service), CS7 (a value its
 * rule refuses), CS15 (the image unset) and CS17 (a rule across settings)
 * with 2; CS8 (the same value) and CS16 (unset of a setting not set) with 0.
 * `file` is the file as CS4 names it.
 */
export function applyChange(
  settings: Settings,
  path: SettingPath,
  value: string | undefined,
  file = SETTINGS_FILE
): Change | { refused: string; status: 0 | 2 } {
  const index = settings.services.findIndex(([name]) => name === path.service)
  if (index === -1)
    return {
      refused: CS4(
        file,
        checkServiceName(path.service) === undefined ? path.service : undefined,
        settings.services.map(([name]) => name)
      ),
      status: 2,
    }
  const [svc, service] = settings.services[index]!
  const words = wordsOf(path)
  const now = shownValue(path, settings)
  // specs/015-domains-https, CL1: a limit is a health check's; with none, CS16 names `health`, refused when it is set.
  if (path.key === "health-timeout" && service.health === undefined)
    return {
      refused: CS16(svc, words.label),
      status: value === undefined ? 0 : 2,
    }
  let typed: string | number | readonly string[] | undefined
  if (value === undefined) {
    if (path.key === "image") return { refused: CS15, status: 2 }
    // A limit left out is 60 seconds already: unset of it changes nothing.
    if (path.key === "health-timeout" && !isSet(service, path))
      return { refused: CS8(svc, words.label, now), status: 0 }
    if (!isSet(service, path))
      return { refused: CS16(svc, words.label), status: 0 }
  } else {
    const read = readTyped(path, value)
    // A domain refused is said as `zekno domain add` says it, naming it (A10, A11).
    if ("refused" in read)
      return {
        refused:
          path.key === "domains" ? read.refused : CS7(words.notA, read.refused),
        status: 2,
      }
    if (isNow(service, path, read.value))
      return { refused: CS8(svc, words.label, now), status: 0 }
    typed = read.value
  }
  const next: Settings = {
    version: 1,
    services: settings.services.map((entry, at) =>
      at === index ? ([svc, changed(service, path, typed)] as const) : entry
    ),
  }
  // The whole file with the change, read back as the reader reads a file: the rules across settings are the schema's.
  const checked = checkSettings(settingsText(next), file)
  if (!isSettings(checked)) {
    const refused =
      checked.kind === "form"
        ? CS17(checked.place, checked.rule)
        : CS17(
            "",
            checked.kind === "read"
              ? checked.sentence
              : laterSentences(file, checked.setting, checked.service).join(" ")
          )
    return { refused, status: 2 }
  }
  return {
    path,
    label: words.label,
    now,
    next: shownValue(path, checked),
    ...(typed === undefined ? {} : { value: typed }),
    settings: checked,
  }
}
