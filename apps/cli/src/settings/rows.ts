/**
 * What `zekno settings` and the settings screen show (specs/010-app-settings,
 * contracts/commands.md, "At a terminal"; contracts/app-screen.md, "Rows";
 * research R9 items 11 and 12): a service's settings as rows in sections,
 * and which differ from this machine's last deploy made from settings
 * ("changed, not deployed", research R4).
 *
 * A value is compared by its meaning: a start command by its words, a
 * processor limit as a number. Nothing is marked when the deployed settings
 * are not known. Every value shown, an old one too, is cleaned with
 * `sanitize`, though nothing a setting holds should need it.
 */
import { sanitize } from "../server/sanitize"
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
 * The rows `zekno settings` prints for one service: only the settings that
 * are set, in the order of the sections; the port with whether it is
 * published (`publish` has no row of its own).
 */
function reportRows(
  service: readonly [string, ServiceSettings],
  deployed: Settings | undefined
): SettingRow[] {
  const [name, settings] = service
  const rows: SettingRow[] = [
    partRow(service, deployed, "Source", "image", "image"),
  ]
  for (const [key, section] of [
    ["start", "Deploy"],
    ["restart", "Deploy"],
    ["memory", "Deploy"],
    ["cpus", "Deploy"],
  ] as const)
    if (settings[key] !== undefined)
      rows.push(partRow(service, deployed, section, key, key))
  if (settings.port !== undefined) {
    const port = settings.port
    rows.push(
      row(
        "Networking",
        "port",
        { service: name, key: "port" },
        portShown(port, settings.publish),
        NOT_SET.port,
        markOf(deployed, name, [port, settings.publish], (old) => ({
          value: [old.port, old.publish],
          shown:
            old.port === undefined
              ? undefined
              : portShown(old.port, old.publish),
        }))
      )
    )
  }
  if (settings.secrets !== undefined)
    rows.push(partRow(service, deployed, "Variables", "secrets", "secrets"))
  rows.push(...plainRows(service, deployed), ...volumeRows(service, deployed))
  return rows
}

/** What `zekno settings` shows: every service, its rows that are set, marked against `deployed` when it is known. */
export function reportOf(
  settings: Settings,
  deployed?: Settings,
  app?: string,
  file = SETTINGS_FILE
): SettingsReport {
  return {
    ...(app === undefined ? {} : { app }),
    file,
    services: settings.services.map((service) => ({
      name: service[0],
      rows: reportRows(service, deployed),
    })),
  }
}

/**
 * Every row of one service on the settings screen, set or not
 * (contracts/app-screen.md, "Rows"), the ones not set with the words of a
 * setting left out; a `plain` or volumes row `none` adds one.
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
  const plain = plainRows(service, deployed)
  const volumes = volumeRows(service, deployed)
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
