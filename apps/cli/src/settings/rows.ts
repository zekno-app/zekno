/**
 * What `zekno settings` and the settings screen show (specs/010-app-settings,
 * contracts/commands.md, "At a terminal"; contracts/app-screen.md, "Rows";
 * research R9 items 11 and 12): a service's settings as rows in sections,
 * and which differ from this machine's last deploy made from settings
 * ("changed, not deployed", research R4), and what that deploy had and the
 * file no longer has ("removed, not deployed", security review S3): a
 * setting no longer set, a plain variable, a volume, a whole service.
 *
 * A value is compared by its meaning: a start command by its words, a
 * processor limit as a number. Nothing is marked when the deployed settings
 * are not known. Every value shown, an old one too, is cleaned with
 * `sanitize`, though nothing a setting holds should need it.
 */
import { healthOf } from "../domains/routes"
import { DOMAINS_LABEL, HEALTH_LABEL } from "../domains/words"
import { sanitize } from "../server/sanitize"
import { healthWords, secondsOf } from "./domains-health"
import type {
  ServiceSettings,
  SettingPath,
  SettingRow,
  Settings,
  SettingsReport,
} from "./types"
import { SETTINGS_FILE, splitStart } from "./values"
import { NOT_SET, portShown, restartShown } from "./words"

/** A value as compared: a start command's words, a processor limit's number, a list, or the value itself. */
type Comparable = string | number | readonly (string | number | undefined)[]

/** Whether two values compare equal. */
function same(a: Comparable | undefined, b: Comparable | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item, at) => item === b[at])
  return a === b
}

/** A start command's words, or the text itself when it does not split. */
const wordsOf = (start: string): Comparable => {
  const split = splitStart(start)
  return "words" in split ? split.words : start
}

/**
 * One row's mark: none when nothing deployed is known or the value is the
 * deployed one; else changed, with the old value when the deployed settings
 * had this setting of this service.
 */
function markOf(
  deployed: Settings | undefined,
  service: string,
  now: Comparable | undefined,
  before: (deployed: ServiceSettings) => {
    value: Comparable | undefined
    shown?: string
  }
): Pick<SettingRow, "changed"> {
  if (deployed === undefined) return {}
  const old = deployed.services.find(([name]) => name === service)?.[1]
  if (old === undefined) return { changed: {} }
  const { value, shown } = before(old)
  if (same(now, value)) return {}
  return value === undefined || shown === undefined
    ? { changed: {} }
    : { changed: { was: sanitize(shown) } }
}

type Section = SettingRow["section"]

/** A row of a setting, set or not. */
const row = (
  section: Section,
  label: string,
  path: SettingRow["path"],
  shown: string | undefined,
  notSet: string,
  mark: Pick<SettingRow, "changed">
): SettingRow => ({
  section,
  label,
  path,
  shown: sanitize(shown ?? notSet),
  set: shown !== undefined,
  ...mark,
})

/** The parts of a service a row reads, each with how it compares and how it reads. */
const PARTS = {
  image: (s: ServiceSettings) => ({ value: s.image, shown: s.image }),
  start: (s: ServiceSettings) => ({
    value: s.start === undefined ? undefined : wordsOf(s.start),
    shown: s.start,
  }),
  restart: (s: ServiceSettings) => ({
    value: s.restart,
    shown: s.restart === undefined ? undefined : restartShown(s.restart),
  }),
  memory: (s: ServiceSettings) => ({ value: s.memory, shown: s.memory }),
  cpus: (s: ServiceSettings) => ({
    value: s.cpus === undefined ? undefined : Number(s.cpus),
    shown: s.cpus,
  }),
  port: (s: ServiceSettings) => ({
    value: s.port,
    shown: s.port === undefined ? undefined : String(s.port),
  }),
  publish: (s: ServiceSettings) => ({
    value: s.publish,
    shown: s.publish === undefined ? undefined : String(s.publish),
  }),
  secrets: (s: ServiceSettings) => ({
    value: s.secrets,
    shown: s.secrets?.join(", "),
  }),
} satisfies Record<
  string,
  (s: ServiceSettings) => { value: Comparable | undefined; shown?: string }
>

type Part = keyof typeof PARTS

/** The row of one setting of `PARTS`, marked against the deployed settings. */
function partRow(
  service: readonly [string, ServiceSettings],
  deployed: Settings | undefined,
  section: Section,
  label: string,
  key: Part
): SettingRow {
  const [name, settings] = service
  const now = PARTS[key](settings)
  return row(
    section,
    label,
    { service: name, key } as SettingPath,
    now.shown,
    NOT_SET[key],
    markOf(deployed, name, now.value, PARTS[key])
  )
}

/** The settings the last deploy had for `service`, or undefined when not known or it had no such service. */
const deployedOf = (
  deployed: Settings | undefined,
  service: string
): ServiceSettings | undefined =>
  deployed?.services.find(([name]) => name === service)?.[1]

/**
 * One row for each plain variable, or each volume, the last deploy had for
 * this service and the file no longer has (security review S3), in the
 * deploy's order: its value reads as a setting left out (`none`), marked
 * removed with what it was. A plain variable is labelled `plain` only when
 * no plain row comes before it (`after`); a volume by its name. It adds a
 * setting, as a `none` row does.
 */
function removedRows(
  service: readonly [string, ServiceSettings],
  deployed: Settings | undefined,
  key: "plain" | "volume",
  after: boolean
): SettingRow[] {
  const [name, settings] = service
  const old = deployedOf(deployed, name)
  if (old === undefined) return []
  const listed = (each: ServiceSettings) =>
    (key === "plain" ? each.plain : each.volumes) ?? []
  const now = new Set(listed(settings).map(([each]) => each))
  return listed(old)
    .filter(([each]) => !now.has(each))
    .map(([each, value], at) => ({
      section: key === "plain" ? "Variables" : "Volumes",
      label: key === "volume" ? sanitize(each) : after || at > 0 ? "" : "plain",
      path: { service: name, key, adding: true },
      shown: NOT_SET[key],
      set: false,
      removed: { was: sanitize(key === "plain" ? `${each}=${value}` : value) },
    }))
}

/** One row per plain variable, `NAME=value`, labelled `plain` on the first only. */
function plainRows(
  service: readonly [string, ServiceSettings],
  deployed: Settings | undefined
): SettingRow[] {
  const [name, settings] = service
  return (settings.plain ?? []).map(([variable, value], at) =>
    row(
      "Variables",
      at === 0 ? "plain" : "",
      { service: name, key: "plain", name: variable },
      `${variable}=${value}`,
      NOT_SET.plain,
      markOf(deployed, name, value, (old) => {
        const before = old.plain?.find(([each]) => each === variable)?.[1]
        return {
          value: before,
          shown: before === undefined ? undefined : `${variable}=${before}`,
        }
      })
    )
  )
}

/**
 * The `health` row (specs/015-domains-https, design/lines.md C5 and C6):
 * `GET /health, within 60s`, `stays up, within 60s`, or `not set`. It is
 * marked against what the last deploy signed: its path, and the deploy's one
 * limit, which `seconds` is for the file (`healthOf`, the largest of its
 * services'), so a service's own limit marks it only when the limit the next
 * deploy signs changes (research R14, R30).
 */
export function healthRow(
  service: readonly [string, ServiceSettings],
  deployed: Settings | undefined,
  seconds: number | undefined
): SettingRow {
  const [name, { health }] = service
  return row(
    "Deploy",
    HEALTH_LABEL,
    { service: name, key: "health" },
    health === undefined ? undefined : healthWords(health),
    NOT_SET.health,
    markOf(
      deployed,
      name,
      health === undefined ? undefined : [health.path, seconds],
      (old) =>
        old.health === undefined
          ? { value: undefined }
          : {
              value: [old.health.path, secondsOf(old.health)],
              shown: healthWords(old.health),
            }
    )
  )
}

/**
 * The `domains` rows (design/lines.md, E1): one a domain, in the file's
 * order, labelled on the first only, each marked when the last deploy did
 * not route it; then one for each domain the last deploy routed and the file
 * no longer names, marked removed with it (security review S3's pattern for
 * plain variables). With neither, a `none` row when `none` is asked for (the
 * settings screen), else no row.
 */
export function domainRows(
  service: readonly [string, ServiceSettings],
  deployed: Settings | undefined,
  none: boolean
): SettingRow[] {
  const [name, settings] = service
  const now = settings.domains ?? []
  const path = { service: name, key: "domains" } as const
  const rows = now.map((domain, at) =>
    row(
      "Networking",
      at === 0 ? DOMAINS_LABEL : "",
      path,
      domain,
      NOT_SET.domains,
      markOf(deployed, name, domain, (old) => ({
        value: old.domains?.includes(domain) ? domain : undefined,
      }))
    )
  )
  const gone = (deployedOf(deployed, name)?.domains ?? []).filter(
    (domain) => !now.includes(domain)
  )
  rows.push(
    ...gone.map((domain, at): SettingRow => ({
      section: "Networking",
      label: now.length === 0 && at === 0 ? DOMAINS_LABEL : "",
      path,
      shown: NOT_SET.domains,
      set: false,
      removed: { was: sanitize(domain) },
    }))
  )
  if (rows.length === 0 && none)
    rows.push(
      row("Networking", DOMAINS_LABEL, path, undefined, NOT_SET.domains, {})
    )
  return rows
}

/** One row per volume, its name as the label and its path as the value. */
function volumeRows(
  service: readonly [string, ServiceSettings],
  deployed: Settings | undefined
): SettingRow[] {
  const [name, settings] = service
  return (settings.volumes ?? []).map(([volume, path]) =>
    row(
      "Volumes",
      volume,
      { service: name, key: "volume", name: volume },
      path,
      NOT_SET.volume,
      markOf(deployed, name, path, (old) => {
        const before = old.volumes?.find(([each]) => each === volume)?.[1]
        return { value: before, shown: before }
      })
    )
  )
}

/**
 * The rows `zekno settings` prints for one service: the settings that are
 * set, and those the last deploy had and the file no longer has, marked as
 * the screen marks them, in the order of the sections; the port with
 * whether it is published (`publish` has no row of its own).
 */
function reportRows(
  service: readonly [string, ServiceSettings],
  deployed: Settings | undefined,
  seconds: number | undefined
): SettingRow[] {
  const [name, settings] = service
  const old = deployedOf(deployed, name)
  // A setting no longer set keeps its row when the last deploy had it: the next deploy drops it (security review S3).
  const shows = (key: keyof ServiceSettings): boolean =>
    settings[key] !== undefined || old?.[key] !== undefined
  const rows: SettingRow[] = [
    partRow(service, deployed, "Source", "image", "image"),
  ]
  for (const [key, section] of [
    ["start", "Deploy"],
    ["restart", "Deploy"],
    ["memory", "Deploy"],
    ["cpus", "Deploy"],
  ] as const)
    if (shows(key)) rows.push(partRow(service, deployed, section, key, key))
  // specs/015-domains-https, CL1: `health` after `cpus`; the domains after the port, one a row.
  if (shows("health")) rows.push(healthRow(service, deployed, seconds))
  if (shows("port")) {
    const { port, publish } = settings
    rows.push(
      row(
        "Networking",
        "port",
        { service: name, key: "port" },
        port === undefined ? undefined : portShown(port, publish),
        NOT_SET.port,
        markOf(deployed, name, [port, publish], (old) => ({
          value: [old.port, old.publish],
          shown:
            old.port === undefined
              ? undefined
              : portShown(old.port, old.publish),
        }))
      )
    )
  }
  rows.push(...domainRows(service, deployed, false))
  if (shows("secrets"))
    rows.push(partRow(service, deployed, "Variables", "secrets", "secrets"))
  const plain = plainRows(service, deployed)
  rows.push(
    ...plain,
    ...removedRows(service, deployed, "plain", plain.length > 0),
    ...volumeRows(service, deployed),
    ...removedRows(service, deployed, "volume", false)
  )
  return rows
}

/**
 * The services the last deploy had and the file no longer has, each with
 * the image it ran, in the deploy's order (security review S3): the next
 * deploy stops them. None when the last deploy is not known.
 */
export function removedServices(
  settings: Settings,
  deployed?: Settings
): { name: string; was: string }[] {
  const now = new Set(settings.services.map(([name]) => name))
  return (deployed?.services ?? [])
    .filter(([name]) => !now.has(name))
    .map(([name, service]) => ({
      name: sanitize(name),
      was: sanitize(service.image),
    }))
}

/**
 * What `zekno settings` shows: every service, its rows that are set or were
 * deployed, marked against `deployed` when it is known, and the services it
 * no longer has.
 */
export function reportOf(
  settings: Settings,
  deployed?: Settings,
  app?: string,
  file = SETTINGS_FILE
): SettingsReport {
  const removed = removedServices(settings, deployed)
  const seconds = healthOf(settings)?.timeout
  return {
    ...(app === undefined ? {} : { app }),
    file,
    services: settings.services.map((service) => ({
      name: service[0],
      rows: reportRows(service, deployed, seconds),
    })),
    ...(removed.length > 0 ? { removed } : {}),
  }
}

/**
 * Every row of one service on the settings screen, set or not
 * (contracts/app-screen.md, "Rows"), the ones not set with the words of a
 * setting left out; a `plain` or volumes row `none` adds one. A plain
 * variable or a volume the last deploy had and the file no longer has is a
 * row of its own, marked removed, after those the file has (security review
 * S3); a `none` row is there only when there is neither.
 */
export function screenRows(
  service: readonly [string, ServiceSettings],
  deployed?: Settings
): SettingRow[] {
  const [name] = service
  // A `none` row is marked when the deployed service had a variable, or a volume, and has none now; it names no old value.
  const none = (
    section: Section,
    label: string,
    key: "plain" | "volume",
    deployedHas: (old: ServiceSettings) => boolean
  ): SettingRow =>
    row(
      section,
      label,
      { service: name, key, adding: true },
      undefined,
      NOT_SET[key],
      markOf(deployed, name, 0, (old) => ({
        value: deployedHas(old) ? undefined : 0,
      }))
    )
  const plain = [
    ...plainRows(service, deployed),
    ...removedRows(
      service,
      deployed,
      "plain",
      Boolean(service[1].plain?.length)
    ),
  ]
  const volumes = [
    ...volumeRows(service, deployed),
    ...removedRows(service, deployed, "volume", false),
  ]
  return [
    partRow(service, deployed, "Source", "image", "image"),
    partRow(service, deployed, "Deploy", "start", "start"),
    partRow(service, deployed, "Deploy", "restart", "restart"),
    partRow(service, deployed, "Deploy", "memory", "memory"),
    partRow(service, deployed, "Deploy", "cpus", "cpus"),
    partRow(service, deployed, "Networking", "port", "port"),
    partRow(service, deployed, "Networking", "published", "publish"),
    partRow(service, deployed, "Variables", "secrets", "secrets"),
    ...(plain.length > 0
      ? plain
      : [
          none("Variables", "plain", "plain", (old) =>
            Boolean(old.plain?.length)
          ),
        ]),
    ...(volumes.length > 0
      ? volumes
      : [none("Volumes", "", "volume", (old) => Boolean(old.volumes?.length))]),
  ]
}
