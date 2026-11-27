/**
 * `zekno settings set` and `unset` for the Build section and the fields of
 * Source a build adds (specs/016-build-from-source, contracts/cli.md CL1,
 * "Keys" and "Values refused by set"; FR-006, FR-011, FR-071b; tasks T112):
 * each value read and held to its rule, an image replaced by a build or a
 * build by an image in one change (G12, G13), and the whole file read back
 * as the reader reads it. change.ts hands these keys here, and an image whose
 * change concerns a build.
 *
 * A value refused is exit status 2: G20 in its form, or an id of its own for
 * a rule with no row yet (build-faults.ts). Until the words tasks the text of
 * a refusal, and a change's label, is a line's id (FR-092); a value is shown
 * as the file holds it, a setting not set by the id of its row (G1 to G8).
 */
import { sanitize } from "../server/sanitize"
import type { LineOf } from "../shared/build-lines"
import type { BuildSettingName, OwnBuildLine } from "./build-faults"
import { rootReach } from "./build-reach"
import {
  DEFAULT_DOCKERFILE,
  isDockerfilePath,
  isIncludePath,
  isRootText,
  MAX_INCLUDE,
  namesReservedImage,
  STAGE,
  timeoutOf,
} from "./build-shape"
import { checkSettings, isSettings } from "./schema"
import { settingsText } from "./text"
import type {
  BuildSettings,
  Change,
  ServiceSettings,
  SettingPath,
  Settings,
} from "./types"
import { isImage } from "./values"
import { CS16, CS17, CS8 } from "./words"

/** A setting of the Build section or of the Source fields a build adds. */
export type BuildPath = { service: string; key: BuildSettingName }

/** The line a refused change says, for the Build section. */
export type RefusedLine = LineOf<"G16" | "G17" | "G20"> | OwnBuildLine

/** A change refused or with nothing to write: its text, its exit status, and for the Build section the line said. */
export type Refusal = {
  refused: string
  status: 0 | 2
  line?: RefusedLine
}

/** Each setting's row in design/lines.md (G1 to G8): its label and its value when not set, until the words tasks (FR-092). */
const ROW: Record<BuildSettingName, string> = {
  root: "G1",
  builder: "G2",
  dockerfile: "G3",
  stage: "G4",
  "build-timeout": "G5",
  "build-network": "G6",
  include: "G8",
}

/** Whether a setting's path is one of the Build section's. */
export const isBuildPath = (path: SettingPath): path is BuildPath =>
  Object.hasOwn(ROW, path.key)

/** A setting's row (G1 to G8): its label and its question on the settings screen until the words tasks (J18; FR-092). */
export const buildRowId = (key: BuildSettingName): string => ROW[key]

/** A refusal saying `line`, exit status 2. */
const refuse = (line: RefusedLine): Refusal => ({
  refused: line.id,
  status: 2,
  line,
})

/** G20 in its form for `refused`. */
const g20 = (refused: LineOf<"G20">["refused"]): Refusal =>
  refuse({ id: "G20", refused })

/** The Build section's field a key sets, for the keys under `build`. */
const FIELD = {
  dockerfile: "dockerfile",
  stage: "stage",
  "build-timeout": "timeout",
  "build-network": "network",
} as const satisfies Partial<Record<BuildSettingName, keyof BuildSettings>>

type BuildField = keyof typeof FIELD

/** A setting's value as the file holds it, or undefined when it is not set. */
function valueOf(
  service: ServiceSettings | undefined,
  key: BuildSettingName
): string | number | readonly string[] | undefined {
  if (key === "root") return service?.root
  if (key === "include") return service?.include
  if (key === "builder") return service?.build?.builder
  return service?.build?.[FIELD[key]]
}

/**
 * How a setting reads in a change line and in CS8 and CS16, cleaned: its
 * value as the file holds it (paths to include joined with `, `), or, not
 * set, the id of its row, whose "Not set" column the words tasks draw.
 */
export function buildShown(
  service: ServiceSettings | undefined,
  key: BuildSettingName
): string {
  const value = valueOf(service, key)
  if (value === undefined) return ROW[key]
  return sanitize(Array.isArray(value) ? value.join(", ") : String(value))
}

/**
 * A setting's value as the file holds it, as `set` takes it, to be filled in
 * on the settings screen (J18): paths to include joined with `, `, a time
 * limit in seconds; empty when it is not set.
 */
export function buildRaw(
  service: ServiceSettings | undefined,
  key: BuildSettingName
): string {
  const value = valueOf(service, key)
  if (value === undefined) return ""
  return Array.isArray(value) ? value.join(", ") : String(value)
}

/**
 * `.include` as typed: the whole list, comma-separated, spaces around each
 * path dropped, as `.secrets` is read; at most 64 relative paths inside the
 * root, each once (data-model.md). Refused by ids of their own.
 */
function readInclude(text: string, service: string): string[] | Refusal {
  const paths = text.split(",").map((path) => path.replace(/^ +| +$/g, ""))
  if (paths.length > MAX_INCLUDE)
    return refuse({ id: "include_too_many", service })
  const seen = new Set<string>()
  for (const path of paths) {
    if (!isIncludePath(path)) return refuse({ id: "include_form", service })
    if (seen.has(path)) return refuse({ id: "include_twice", service })
    seen.add(path)
  }
  return paths
}

/** A value typed for a key under `build`, held to its rule, or G20 in its form. */
function readField(key: BuildField, text: string): string | number | Refusal {
  switch (key) {
    case "dockerfile":
      return isDockerfilePath(text) ? text : g20("dockerfile")
    case "stage":
      return STAGE.test(text) ? text : g20("stage")
    case "build-timeout":
      return timeoutOf(text) ?? g20("build-timeout")
    case "build-network":
      return text === "internet" || text === "none"
        ? text
        : g20("build-network")
  }
}

/** A refusal rather than a value. */
const isRefusal = (value: unknown): value is Refusal =>
  typeof value === "object" && value !== null && "refused" in value

/** A service with a setting of the Build section set to `value`, or left out when it is undefined. */
function withValue(
  service: ServiceSettings,
  key: Exclude<BuildSettingName, "builder">,
  value: string | number | readonly string[] | undefined
): ServiceSettings {
  const next: Record<string, unknown> = { ...service }
  if (key === "root" || key === "include") {
    if (value === undefined) delete next[key]
    else next[key] = value
    return next as ServiceSettings
  }
  const build: Record<string, unknown> = { ...service.build }
  if (value === undefined) delete build[FIELD[key]]
  else build[FIELD[key]] = value
  next.build = build
  return next as ServiceSettings
}

/** Whether two values of a setting are the same: lists path by path. */
function same(
  a: string | number | readonly string[] | undefined,
  b: string | number | readonly string[]
): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item, at) => item === b[at])
  return a === b
}

/**
 * Whether a root typed for `set` is in reach of the settings file read from
 * `settingsFile` (build-reach.ts: C22 and C23 are G20's root form here); a
 * folder that cannot be looked at is out of reach. Without the file's path,
 * the reach is left to the reader.
 */
function inReach(settingsFile: string | undefined, root: string): boolean {
  if (settingsFile === undefined) return true
  try {
    return !("id" in rootReach(settingsFile, root))
  } catch {
    return false
  }
}

/**
 * The settings with service `index` replaced by `next`, read back as the
 * reader reads a file, or the rule across settings it breaks (CS17; a build's
 * fault by its id), exit status 2.
 */
function readBack(
  settings: Settings,
  index: number,
  next: ServiceSettings,
  file: string
): Settings | Refusal {
  const all: Settings = {
    version: 1,
    services: settings.services.map((entry, at) =>
      at === index ? ([entry[0], next] as const) : entry
    ),
  }
  const checked = checkSettings(settingsText(all), file)
  if (isSettings(checked)) return checked
  switch (checked.kind) {
    case "form":
      return { refused: CS17(checked.place, checked.rule), status: 2 }
    case "build":
      return { refused: checked.fault.id, status: 2 }
    case "read":
      return { refused: CS17("", checked.sentence), status: 2 }
    case "later":
      return { refused: CS17("", ""), status: 2 }
  }
}

/** The service without its image, or without its build and the Source fields a build adds. */
function without(
  service: ServiceSettings,
  keys: readonly ("image" | "build" | "root" | "include")[]
): ServiceSettings {
  const next: Record<string, unknown> = { ...service }
  for (const key of keys) delete next[key]
  return next as ServiceSettings
}

/**
 * A change of a setting of the Build section of service `index` (`value`
 * given) or its removal (`value` undefined), or why not. `settingsFile`: the
 * path the settings file was read from, for the reach of a root; without it
 * the reach is left to the reader.
 */
export function buildChange(
  settings: Settings,
  index: number,
  path: BuildPath,
  value: string | undefined,
  file: string,
  settingsFile?: string
): Change | Refusal {
  const [svc, service] = settings.services[index]!
  const label = ROW[path.key]
  const now = buildShown(service, path.key)
  const done = (
    next: ServiceSettings,
    typed: string | number | readonly string[] | undefined,
    line?: LineOf<"G12" | "G13">
  ): Change | Refusal => {
    const checked = readBack(settings, index, next, file)
    if (isRefusal(checked)) return checked
    return {
      path,
      label: line?.id ?? label,
      now: line === undefined ? now : sanitize(service.image ?? now),
      next: buildShown(checked.services[index]![1], path.key),
      ...(typed === undefined ? {} : { value: typed }),
      settings: checked,
      ...(line === undefined ? {} : { line }),
    }
  }
  if (value === undefined) {
    if (path.key === "builder" && service.build !== undefined)
      return refuse({ id: "G17", service: svc })
    if (valueOf(service, path.key) === undefined)
      return { refused: CS16(svc, label), status: 0 }
    return done(
      withValue(
        service,
        path.key as Exclude<BuildSettingName, "builder">,
        undefined
      ),
      undefined
    )
  }
  if (path.key === "builder") {
    if (value === "railpack") return g20("railpack")
    if (value !== "dockerfile") return g20("builder")
    if (service.build !== undefined)
      return { refused: CS8(svc, label, now), status: 0 }
    // G12: the image goes, in the same change (FR-011).
    const next: ServiceSettings = {
      ...without(service, ["image"]),
      build: { builder: "dockerfile" },
    }
    return done(next, value, {
      id: "G12",
      service: svc,
      image: sanitize(service.image ?? ""),
      dockerfile: DEFAULT_DOCKERFILE,
    })
  }
  if (service.build === undefined)
    return refuse({ id: "needs_build", service: svc, setting: path.key })
  let typed: string | number | readonly string[]
  if (path.key === "include") {
    const read = readInclude(value, svc)
    if (isRefusal(read)) return read
    typed = read
  } else if (path.key === "root") {
    if (!isRootText(value) || !inReach(settingsFile, value)) return g20("root")
    typed = value
  } else {
    const read = readField(path.key, value)
    if (isRefusal(read)) return read
    typed = read
  }
  if (same(valueOf(service, path.key), typed))
    return { refused: CS8(svc, label, now), status: 0 }
  return done(withValue(service, path.key, typed), typed)
}

/**
 * A change of `<service>.image` that concerns a build, or undefined when it
 * is today's: an image under `zekno.invalid` refused (G20), the image of a
 * service with no build kept (G16, for apps that do not build too: plan item
 * 21 (a)), and an image set on a built service, which replaces the build,
 * its root and its files to include in one change (G13). An image that is no
 * reference is today's CS7.
 */
export function imageChange(
  settings: Settings,
  index: number,
  path: SettingPath & { key: "image" },
  value: string | undefined,
  file: string
): Change | Refusal | undefined {
  const [svc, service] = settings.services[index]!
  if (value === undefined)
    return service.build === undefined
      ? refuse({ id: "G16", service: svc })
      : undefined
  if (!isImage(value)) return undefined
  if (namesReservedImage(value)) return g20("image")
  if (service.build === undefined) return undefined
  const line: LineOf<"G13"> = {
    id: "G13",
    service: svc,
    dockerfile: sanitize(service.build.dockerfile ?? DEFAULT_DOCKERFILE),
    image: sanitize(value),
  }
  const next = {
    ...without(service, ["build", "root", "include"]),
    image: value,
  }
  const checked = readBack(settings, index, next, file)
  if (isRefusal(checked)) return checked
  return {
    path,
    label: line.id,
    now: sanitize(service.build.builder),
    next: sanitize(value),
    value,
    settings: checked,
    line,
  }
}
