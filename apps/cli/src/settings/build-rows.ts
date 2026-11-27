/**
 * A built service's rows, for `zekno settings` and the settings screen
 * (specs/016-build-from-source, contracts/cli.md CL1, "Rows" and "Changed,
 * not deployed"; FR-011; tasks T115): `root` and `include` under Source
 * (J15), then the Build section between Source and Deploy (G9, J16). rows.ts
 * puts them in place of the image row of a service that runs an image.
 *
 * Values read as G10 reads them: the builder, and the time limit in whole
 * minutes, else in seconds, are given as a value (`SettingRow.value`) with
 * G10's id as the text; a path, a stage and the network as the file holds
 * them. A row's label, and a setting not set, is its row's id (G1 to G8)
 * until the words tasks (FR-092). Only the settings that are set, or marked,
 * for `zekno settings`; every row for the screen.
 *
 * "Changed, not deployed" compares each build setting, as it takes effect
 * (a setting left out as its default), with the build the latest accepted
 * deploy signed, which `deployedSettings` reads back from this machine's
 * history by the key in the image's name. `root` and `include` are not
 * signed and are never marked.
 */
import { sanitize } from "../server/sanitize"
import type { BuildSettingName } from "./build-faults"
import { DEFAULT_DOCKERFILE, DEFAULT_TIMEOUT } from "./build-shape"
import { deployedOf, row, type Comparable } from "./row-marks"
import type {
  BuildRowValue,
  ServiceSettings,
  SettingRow,
  Settings,
} from "./types"

/** G10's time limit: whole minutes, else seconds. */
const timeLimit = (seconds: number): BuildRowValue =>
  seconds % 60 === 0 ? { minutes: seconds / 60 } : { seconds }

/** What a row shows: its text, and for a value G10 reads, that value with G10's id as the text. */
type Shown = { text: string; value?: BuildRowValue }

/** One row: its section, its row's id, the setting it changes, how it reads and, for a signed setting, how it compares. */
type Part = {
  section: "Source" | "Build"
  label: string
  key: BuildSettingName
  shown: (service: ServiceSettings) => Shown | undefined
  /** The value as it takes effect, undefined for a service with no build; none for a setting that is not signed. */
  compared?: (service: ServiceSettings) => Comparable | undefined
}

const text = (value: string | undefined): Shown | undefined =>
  value === undefined ? undefined : { text: value }

/** The rows in their order: G1 and G8 under Source, G2 to G6 under Build. */
const PARTS: readonly Part[] = [
  { section: "Source", label: "G1", key: "root", shown: (s) => text(s.root) },
  {
    section: "Source",
    label: "G8",
    key: "include",
    shown: (s) => text(s.include?.join(", ")),
  },
  {
    section: "Build",
    label: "G2",
    key: "builder",
    shown: (s) =>
      s.build && { text: "G10", value: { builder: s.build.builder } },
    compared: (s) => s.build?.builder,
  },
  {
    section: "Build",
    label: "G3",
    key: "dockerfile",
    shown: (s) => text(s.build?.dockerfile),
    compared: (s) => s.build && (s.build.dockerfile ?? DEFAULT_DOCKERFILE),
  },
  {
    section: "Build",
    label: "G4",
    key: "stage",
    shown: (s) => text(s.build?.stage),
    // The last stage, which no stage name can be.
    compared: (s) => s.build && (s.build.stage ?? ""),
  },
  {
    section: "Build",
    label: "G5",
    key: "build-timeout",
    shown: (s) =>
      s.build?.timeout === undefined
        ? undefined
        : { text: "G10", value: timeLimit(s.build.timeout) },
    compared: (s) => s.build && (s.build.timeout ?? DEFAULT_TIMEOUT),
  },
  {
    section: "Build",
    label: "G6",
    key: "build-network",
    shown: (s) => text(s.build?.network),
    compared: (s) => s.build && (s.build.network ?? "internet"),
  },
]

/**
 * A row's mark against the last deploy: none when it is not known, the
 * setting is not signed, or it takes the same effect; else changed, with
 * what the deploy had when it had this setting.
 */
function markOf(
  part: Part,
  deployed: Settings | undefined,
  name: string,
  now: ServiceSettings
): Pick<SettingRow, "changed"> {
  if (part.compared === undefined || deployed === undefined) return {}
  const old = deployedOf(deployed, name)
  if (old === undefined) return { changed: {} }
  if (part.compared(now) === part.compared(old)) return {}
  const was = part.shown(old)
  return {
    changed: {
      ...(was === undefined ? {} : { was: sanitize(was.text) }),
      ...(was?.value === undefined ? {} : { wasValue: was.value }),
    },
  }
}

/**
 * The rows of a built service in the place of an image row: `every` for the
 * settings screen, each row with its id when not set; else only the
 * settings that are set or marked, for `zekno settings`.
 */
export function buildRows(
  service: readonly [string, ServiceSettings],
  deployed: Settings | undefined,
  every: boolean
): SettingRow[] {
  const [name, settings] = service
  return PARTS.flatMap((part) => {
    const now = part.shown(settings)
    const mark = markOf(part, deployed, name, settings)
    if (!every && now === undefined && mark.changed === undefined) return []
    const made = row(
      part.section,
      part.label,
      { service: name, key: part.key },
      now?.text,
      part.label,
      mark
    )
    return [now?.value === undefined ? made : { ...made, value: now.value }]
  })
}
