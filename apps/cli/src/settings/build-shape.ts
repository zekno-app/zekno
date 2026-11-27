/**
 * The settings' Build section and the fields of Source a build adds
 * (specs/016-build-from-source, data-model.md, "The settings' Build
 * section"; contracts/cli.md CL1; FR-006 to FR-010, FR-077; tasks T105): their
 * zod shapes, the rules across a service's fields, and the fault each issue
 * is said as. shape.ts puts them into a service, schema.ts turns an issue
 * into a fault with `buildFaultOf` and a service into settings with
 * `buildPartsOf`.
 *
 * Each issue carries an id as its message, as shape.ts's do: a row of
 * design/lines.md (C24 to C29, F5), or one of build-faults.ts's own ids. The
 * reach of `source.root` needs the disk, so build-reach.ts checks it after
 * this schema (C22, C23). `build.secrets` is a key this schema does not know
 * (SV6) until step 1b.
 */
import { LIMITS, namesReservedRegistry } from "@workspace/core"
import { z } from "zod"

import type { BuildFault } from "./build-faults"
import { JsonNumber } from "./json-number"
import type { BuildSettings, ServiceSettings, Settings } from "./types"
import { holdsInvisible, holdsOnlyAllowed, isImage } from "./values"

/** The most paths `source.include` holds (data-model.md). */
export const MAX_INCLUDE = 64
/** The most characters of `source.root` and of a path of `source.include`. */
export const MAX_BUILD_PATH = 1024
/** A build's time limit when the file sets none, in seconds (data-model.md, FR-010). */
export const DEFAULT_TIMEOUT = 1800
/** A Dockerfile's path when the file sets none (data-model.md). */
export const DEFAULT_DOCKERFILE = "Dockerfile"
/** A stage of a Dockerfile, as core's build entry holds `target` (data-model.md; core.md CO1). */
export const STAGE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/
/** A time limit as written: a whole number of seconds, no sign, fraction or exponent. At most 7,200 is checked apart. */
const SECONDS = /^[1-9][0-9]{0,3}$/

/** A character a path a person reads may not hold: control, format and line separators (core's path rule, CO1). */
const UNSEEN = /[\p{C}\u2028\u2029]/u

/** Text a person reads where zekno shows a path: allowed characters, none drawn as nothing. */
const readable = (text: string): boolean =>
  holdsOnlyAllowed(text) && !UNSEEN.test(text) && !holdsInvisible(text)

/** Core's rule of a path inside the pack (link.ts `staysInside`): not absolute, no `\`, no `.` or `..` part. */
const staysInside = (path: string): boolean =>
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !path.split("/").some((part) => part === "." || part === "..")

/** `build.dockerfile`: core's path rule (CO1), at most 255 characters, relative and inside the folder sent (C24). */
export const isDockerfilePath = (path: string): boolean =>
  path.length >= 1 &&
  path.length <= LIMITS.dockerfileLength &&
  readable(path) &&
  staysInside(path)

/** `source.root` as written: a relative path, `/` between its parts. Where it leads is build-reach.ts's. */
export const isRootText = (root: string): boolean =>
  root.length >= 1 &&
  root.length <= MAX_BUILD_PATH &&
  readable(root) &&
  !root.startsWith("/") &&
  !root.includes("\\")

/** A path of `source.include`: relative, inside the root, no part empty. */
export const isIncludePath = (path: string): boolean =>
  path.length >= 1 &&
  path.length <= MAX_BUILD_PATH &&
  readable(path) &&
  staysInside(path) &&
  path.split("/").every((part) => part !== "")

/** A time limit as written, read as seconds from 1 to 7,200 (C27), or undefined. */
export function timeoutOf(text: string): number | undefined {
  if (!SECONDS.test(text)) return undefined
  const seconds = Number(text)
  return seconds <= LIMITS.buildSeconds ? seconds : undefined
}

/**
 * Whether an image names the space reserved for the images zekno builds
 * (C29; FR-077): its registry is `zekno.invalid` in any case, with any port,
 * or it holds `zekno.invalid/` anywhere, which core's rule of the Compose
 * text refuses wherever it stands (core.md CO2, as built).
 */
export function namesReservedImage(image: string): boolean {
  const slash = image.indexOf("/")
  if (slash !== -1 && namesReservedRegistry(image.slice(0, slash))) return true
  return /zekno\.invalid(?::[0-9]*)?\//i.test(image)
}

const fails = (id: string) => ({ error: id })

/** A string held to `check`, `id` its fault whether it is no string or breaks the rule. */
const checkedText = (id: string, check: (text: string) => boolean) =>
  z.string(fails(id)).refine(check, fails(id))

/** `source.root` (data-model.md): a relative path; it needs a build. */
export const RootSchema = checkedText("root_form", isRootText)

/**
 * `source.include` (FR-015): a list of at most 64 relative paths inside the
 * root, each once. The count is checked whenever it is a list, even when a
 * path is wrong, as shape.ts's counts are.
 */
export const IncludeSchema = z
  .array(checkedText("include_form", isIncludePath), fails("include_form"))
  .refine((paths) => paths.length <= MAX_INCLUDE, {
    error: "include_too_many",
    when: (payload) => Array.isArray(payload.value),
  })
  .superRefine((paths, context) => {
    const seen = new Set<string>()
    for (const [index, path] of paths.entries()) {
      if (seen.has(path)) {
        context.addIssue({
          code: "custom",
          message: "include_twice",
          path: [index],
        })
        return
      }
      seen.add(path)
    }
  })

/**
 * The Build section (data-model.md; CL1): a builder, `dockerfile` alone in
 * step 1, F5 for `railpack`, which a zekno of step 1 does not build; the
 * Dockerfile's path (C24), its stage, the time limit (C27) and the network
 * (C28), each optional. Anything else, or not an object, is SV5.
 */
export const BuildSchema = z.strictObject(
  {
    builder: z.enum(["dockerfile"], {
      error: (issue) =>
        issue.input === undefined
          ? "builder_missing"
          : issue.input === "railpack"
            ? "F5"
            : "builder_unknown",
    }),
    dockerfile: checkedText("C24", isDockerfilePath).optional(),
    stage: checkedText("stage_form", (stage) => STAGE.test(stage)).optional(),
    timeout: z
      .custom<JsonNumber>((value) => value instanceof JsonNumber, fails("C27"))
      .refine((number) => timeoutOf(number.text) !== undefined, fails("C27"))
      .optional(),
    network: z.enum(["internet", "none"], fails("C28")).optional(),
  },
  fails("SV5")
)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** A list or a value that is set: a list with nothing in it is left out, as the file's other lists are. */
const isSet = (value: unknown): boolean =>
  value !== undefined && !(Array.isArray(value) && value.length === 0)

/**
 * The rules across a service's fields (FR-006; data-model.md, "Rules across
 * fields"): an image or a build, never both (C25) and never neither (C26,
 * for apps that do not build too: plan item 21 (a)); `root` and `include`
 * only with a build. Run on every service that is an object, even when a
 * field of it is wrong, so a fault comes at its place in the text as SV7's
 * did: C26 where the image would end.
 */
export const serviceRules = {
  check: (service: unknown, context: z.RefinementCtx): void => {
    if (!isRecord(service)) return
    const { source, build } = service
    // A source that is not an object is SV5, said at its place.
    if (source !== undefined && !isRecord(source)) return
    const image = source?.image
    if (image !== undefined && build !== undefined)
      context.addIssue({ code: "custom", message: "C25", path: ["build"] })
    else if (image === undefined && build === undefined)
      context.addIssue({
        code: "custom",
        message: "C26",
        path: source === undefined ? ["source"] : ["source", "image"],
      })
    if (build !== undefined) return
    for (const key of ["root", "include"] as const)
      if (isSet(source?.[key]))
        context.addIssue({
          code: "custom",
          message: `needs_build:${key}`,
          path: ["source", key],
        })
  },
  when: (payload: { value: unknown }): boolean => isRecord(payload.value),
}

/** The ids of this file's issues that are rows of design/lines.md. */
const ROW_IDS = new Set(["C24", "C25", "C26", "C27", "C28", "C29", "F5"])
/** The ids of this file's issues that are build-faults.ts's own. */
const OWN_IDS = new Set([
  "include_form",
  "include_too_many",
  "include_twice",
  "builder_unknown",
  "builder_missing",
  "root_form",
  "stage_form",
])

/** The fault of an issue of this file in service `svc`, a name that passed its rule; undefined for an issue of another file. */
export function buildFaultOf(id: string, svc: string): BuildFault | undefined {
  if (ROW_IDS.has(id))
    return { id: id as Exclude<BuildFault["id"], "C22">, service: svc }
  if (OWN_IDS.has(id))
    return { id: id as Exclude<BuildFault["id"], "C22">, service: svc }
  if (id === "needs_build:root" || id === "needs_build:include")
    return {
      id: "needs_build",
      service: svc,
      setting: id === "needs_build:root" ? "root" : "include",
    }
  return undefined
}

/** A service's Source and Build as the schema gave them. */
type ParsedParts = {
  source?: { image?: string; root?: string; include?: string[] }
  build?: {
    builder: "dockerfile"
    dockerfile?: string
    stage?: string
    timeout?: JsonNumber
    network?: "internet" | "none"
  }
}

/** The image, or the root, the files to include and the build, of a service as the schema gave it; what is not set is left out. */
export function buildPartsOf(
  service: ParsedParts
): Pick<ServiceSettings, "image" | "root" | "include" | "build"> {
  const { source, build } = service
  const include = source?.include ?? []
  return {
    ...(source?.image === undefined ? {} : { image: source.image }),
    ...(source?.root === undefined ? {} : { root: source.root }),
    ...(include.length === 0 ? {} : { include }),
    ...(build === undefined ? {} : { build: buildSettingsOf(build) }),
  }
}

/** The Build section as settings: the builder, then each setting that is set. */
function buildSettingsOf(
  build: NonNullable<ParsedParts["build"]>
): BuildSettings {
  return {
    builder: build.builder,
    ...(build.dockerfile === undefined ? {} : { dockerfile: build.dockerfile }),
    ...(build.stage === undefined ? {} : { stage: build.stage }),
    ...(build.timeout === undefined ? {} : { timeout: build.timeout.value }),
    ...(build.network === undefined ? {} : { network: build.network }),
  }
}

/**
 * For the size of the Compose text a file turns into (SV33), before any
 * build is made: each built service's image named as long as a built image's
 * name can be, for the longest app name (core's `APP_NAME`) and a key.
 */
export function longestImages(settings: Settings): ReadonlyMap<string, string> {
  const longest = `zekno.invalid/${"a".repeat(63)}:${"0".repeat(64)}`
  return new Map(
    settings.services
      .filter(([, service]) => service.build !== undefined)
      .map(([name]) => [name, longest] as const)
  )
}

/** Whether a service is built from source rather than run from an image. */
export const isBuilt = (service: ServiceSettings): boolean =>
  service.build !== undefined

/** The build image check of `source.image`: no name under `zekno.invalid` (C29). An image that is no reference is SV8 first. */
export const notReservedImage = (image: string): boolean =>
  !isImage(image) || !namesReservedImage(image)
