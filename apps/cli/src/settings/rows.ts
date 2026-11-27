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
 *
 * A built service shows build-rows.ts's rows in the place of the image row
 * (specs/016-build-from-source, CL1, "Rows"; tasks T115).
 */
import { healthOf } from "../domains/routes"
import { sanitize } from "../server/sanitize"
import { buildRows } from "./build-rows"
import {
  deployedOf,
  markOf,
  row,
  type Comparable,
  type Section,
} from "./row-marks"
import { domainRows, healthRow } from "./route-rows"
import type {
  ServiceSettings,
  SettingPath,
  SettingRow,
  Settings,
  SettingsReport,
} from "./types"
import { SETTINGS_FILE, splitStart } from "./values"
import { NOT_SET, portShown, restartShown } from "./words"

// Moved to route-rows.ts, and re-exported so that what imports them from here is unchanged.
export { domainRows, healthRow } from "./route-rows"

/** A start command's words, or the text itself when it does not split. */
const wordsOf = (start: string): Comparable => {
  const split = splitStart(start)
  return "words" in split ? split.words : start
}

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
  // specs/016-build-from-source, G9: a built service's Source and Build rows in the place of the image row.
  const rows: SettingRow[] =
    settings.build === undefined
      ? [partRow(service, deployed, "Source", "image", "image")]
      : buildRows(service, deployed, false)
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
      // A built service by its builder as G10 reads it, by its id until the words tasks (specs/016-build-from-source, FR-092).
      was: sanitize(service.image ?? "G10"),
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
  deployed?: Settings,
  seconds?: number
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
  // specs/015-domains-https, E6 (board `DomainsApp`): `health` after `cpus`, the domains after `published`, one a row.
  return [
    // specs/016-build-from-source, J15 and J16: a built service's Source and Build rows in the place of the image row.
    ...(service[1].build === undefined
      ? [partRow(service, deployed, "Source", "image", "image")]
      : buildRows(service, deployed, true)),
    partRow(service, deployed, "Deploy", "start", "start"),
    partRow(service, deployed, "Deploy", "restart", "restart"),
    partRow(service, deployed, "Deploy", "memory", "memory"),
    partRow(service, deployed, "Deploy", "cpus", "cpus"),
    healthRow(service, deployed, seconds),
    partRow(service, deployed, "Networking", "port", "port"),
    partRow(service, deployed, "Networking", "published", "publish"),
    ...domainRows(service, deployed, true),
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
