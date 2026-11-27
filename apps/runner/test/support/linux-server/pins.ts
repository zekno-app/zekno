/**
 * The reader of the stand-in's pin file, `pins.json` beside it
 * (specs/016-build-from-source, plan items 2 (C), 3 (a) and 26;
 * research/map-checks.md part 4; rule LC10): every engine, image and
 * package the Linux check installs or pulls is named there, by exact apt
 * version or by digest, and nowhere else. The workflow and the Mac's script
 * read the same file.
 *
 * Written by hand and strict, with no package the runner does not declare:
 * an unknown key, a missing key, a tag without a digest, a version range or
 * `latest` throws one line naming the key. The Caddy image is not here: its
 * digest lives in `src/proxy/image.ts` alone, and the stand-in imports
 * `PROXY_IMAGE`.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

export const PINS_PATH = join(import.meta.dir, "pins.json")

/** The engines a stand-in can run, as `--engine` names them. */
export const ENGINE_NAMES = [
  "floor",
  "floor-no-buildx",
  "older",
  "distro",
  "distro-no-buildx",
  "newest",
] as const
export type EngineName = (typeof ENGINE_NAMES)[number]

/** Ubuntu's own packages in the stand-in (curl and ca-certificates fetch Docker's key). */
export const UBUNTU_PACKAGES = [
  "ca-certificates",
  "curl",
  "openssh-server",
  "openssh-client",
  "iproute2",
  "docker-registry",
  "strace",
] as const
export type UbuntuPackage = (typeof UBUNTU_PACKAGES)[number]

/**
 * The packages an engine names, by the repository it comes from: the
 * engine, its client (one package in Ubuntu's) and its runtime, then
 * buildx and Compose, which an engine may leave out.
 */
const REPOSITORIES = {
  docker: {
    engine: "docker-ce",
    required: ["docker-ce", "docker-ce-cli", "containerd.io"],
    buildx: "docker-buildx-plugin",
    compose: "docker-compose-plugin",
  },
  ubuntu: {
    engine: "docker.io",
    required: ["docker.io", "containerd", "runc"],
    buildx: "docker-buildx",
    compose: undefined,
  },
} as const
type Repository = keyof typeof REPOSITORIES

/** Every package name an engine may hold. */
export const ENGINE_PACKAGES: readonly string[] = Object.values(
  REPOSITORIES
).flatMap((repository) =>
  [...repository.required, repository.buildx, repository.compose].filter(
    (name): name is NonNullable<typeof name> => name !== undefined
  )
)

export type Image = {
  /** What the registry is asked for, `name:version`. */
  readonly tag: string
  /** What is pulled and run, `name@sha256:<64 hex>`. */
  readonly image: string
}

export type Engine = {
  readonly repository: Repository
  /** The engine's own version, as `docker version` gives it: `29.5.0`. */
  readonly engine: string
  readonly buildx: string | undefined
  readonly compose: string | undefined
  /** Each apt package and its exact version, in the file's order. */
  readonly packages: Readonly<Record<string, string>>
}

export type Pins = {
  readonly lookedUp: string
  readonly images: { readonly ubuntu: Image; readonly fixtures: Image }
  readonly dockerKey: {
    readonly url: string
    /** As Docker prints it: ten groups of four, one space apart. */
    readonly fingerprint: string
    /** The same forty hex digits with no space, as a check compares them. */
    readonly compact: string
  }
  readonly dockerRepository: {
    readonly url: string
    readonly suite: string
    readonly component: string
  }
  readonly ubuntu: Readonly<Record<UbuntuPackage, string>>
  readonly engines: Readonly<Record<EngineName, Engine>>
}

const IMAGE_NAME =
  "[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*"
const TAG = new RegExp(`^(${IMAGE_NAME}):([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})$`)
/**
 * An exact Debian version: an optional epoch, a version that starts with a
 * digit, and a revision unless the package is native (`ca-certificates`).
 * A range, a wildcard or a word such as `latest` has no such form.
 */
const APT_VERSION = /^(?:[0-9]+:)?[0-9][A-Za-z0-9.+~]*(?:-[A-Za-z0-9.+~]+)*$/
const FINGERPRINT = /^(?:[0-9A-F]{4} ){9}[0-9A-F]{4}$/
const SUITE = /^[a-z0-9][a-z0-9.+-]*$/
/**
 * An address over HTTPS with a host and plain path parts only: no port,
 * query, user, quote, space, `$` or backquote, so no shell line it is
 * written into can read it as more than one word.
 */
const HTTPS_URL = /^https:\/\/[a-z0-9][a-z0-9.-]*(?:\/[A-Za-z0-9._~-]+)*$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

function refuse(path: string, what: string): never {
  throw new Error(`pins.json: ${path} ${what}`)
}

/** `value` as an object holding exactly the keys `known`, each checked by the caller. */
function fields(
  value: unknown,
  path: string,
  known: readonly string[],
  optional: readonly string[] = []
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    if (path === "") throw new Error("pins.json is not an object")
    refuse(path, "is not an object")
  }
  const record = value as Record<string, unknown>
  const at = (key: string) => (path === "" ? key : `${path}.${key}`)
  for (const key of Object.keys(record))
    if (!known.includes(key) && !optional.includes(key))
      refuse(at(key), "is not a known key")
  for (const key of known) if (!(key in record)) refuse(at(key), "is missing")
  return record
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string") refuse(path, "is not text")
  return value
}

function aptVersion(value: unknown, path: string): string {
  const version = text(value, path)
  if (!APT_VERSION.test(version))
    refuse(path, `is ${JSON.stringify(version)}, not an exact apt version`)
  return version
}

function httpsUrl(value: unknown, path: string): string {
  const url = text(value, path)
  if (!HTTPS_URL.test(url) || !URL.canParse(url))
    refuse(
      path,
      `is ${JSON.stringify(url)}, not an address over HTTPS of a host and plain path parts`
    )
  return url
}

/** The upstream part of an apt version: `5:29.5.0-1~ubuntu.24.04~noble` is `29.5.0`. */
export function upstream(version: string): string {
  return version.replace(/^[0-9]+:/, "").replace(/-[^-]*$/, "")
}

function readImage(value: unknown, path: string): Image {
  const record = fields(value, path, ["tag", "image"])
  const tag = text(record.tag, `${path}.tag`)
  const parts = TAG.exec(tag)
  if (!parts || parts[2] === "latest")
    refuse(
      `${path}.tag`,
      `is ${JSON.stringify(tag)}, not a name and a version tag`
    )
  const image = text(record.image, `${path}.image`)
  const name = `${parts[1]}@`
  if (
    !image.startsWith(name) ||
    !/^sha256:[0-9a-f]{64}$/.test(image.slice(name.length))
  )
    refuse(
      `${path}.image`,
      `is ${JSON.stringify(image)}, not ${parts[1]}@sha256:<64 hex>`
    )
  return { tag, image }
}

function readEngine(value: unknown, name: EngineName): Engine {
  const path = `engines.${name}`
  const record = fields(value, path, [], ENGINE_PACKAGES)
  const names = Object.keys(record)
  const from = (Object.keys(REPOSITORIES) as Repository[]).filter(
    (repository) => {
      const { required, buildx, compose } = REPOSITORIES[repository]
      return names.some(
        (key) =>
          (required as readonly string[]).includes(key) ||
          key === buildx ||
          key === compose
      )
    }
  )
  if (from.length !== 1)
    refuse(
      path,
      from.length === 0
        ? "names no engine"
        : "names packages of Docker's repository and of Ubuntu's"
    )
  const repository = from[0]!
  const { engine, required, buildx, compose } = REPOSITORIES[repository]
  for (const key of required)
    if (!(key in record)) refuse(`${path}.${key}`, "is missing")
  const packages: Record<string, string> = {}
  for (const key of names)
    packages[key] = aptVersion(record[key], `${path}.${key}`)
  if (
    repository === "docker" &&
    packages["docker-ce-cli"] !== packages["docker-ce"]
  )
    refuse(`${path}.docker-ce-cli`, "is not the version of docker-ce")
  const withoutBuildx = name.endsWith("-no-buildx")
  if (withoutBuildx && buildx in packages)
    refuse(path, "names buildx, which its name leaves out")
  if (!withoutBuildx && !(buildx in packages)) refuse(path, "names no buildx")
  const version = (key: string | undefined) =>
    key !== undefined && key in packages ? upstream(packages[key]!) : undefined
  return {
    repository,
    engine: upstream(packages[engine]!),
    buildx: version(buildx),
    compose: version(compose),
    packages,
  }
}

/** Reads the pin file's text strictly; throws one line naming the key at fault. */
export function readPins(source: string): Pins {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error("pins.json is not JSON")
  }
  const top = fields(parsed, "", [
    "lookedUp",
    "images",
    "dockerKey",
    "dockerRepository",
    "ubuntu",
    "engines",
  ])

  const lookedUp = text(top.lookedUp, "lookedUp")
  if (!DAY.test(lookedUp)) refuse("lookedUp", "is not a day, YYYY-MM-DD")

  const images = fields(top.images, "images", ["ubuntu", "fixtures"])

  const key = fields(top.dockerKey, "dockerKey", ["url", "fingerprint"])
  const fingerprint = text(key.fingerprint, "dockerKey.fingerprint")
  if (!FINGERPRINT.test(fingerprint))
    refuse(
      "dockerKey.fingerprint",
      "is not ten groups of four upper-case hex digits, one space apart"
    )

  const repository = fields(top.dockerRepository, "dockerRepository", [
    "url",
    "suite",
    "component",
  ])
  const word = (field: "suite" | "component") => {
    const value = text(repository[field], `dockerRepository.${field}`)
    if (!SUITE.test(value))
      refuse(
        `dockerRepository.${field}`,
        `is ${JSON.stringify(value)}, not one word`
      )
    return value
  }

  const ubuntuFields = fields(top.ubuntu, "ubuntu", UBUNTU_PACKAGES)
  const ubuntu = Object.fromEntries(
    UBUNTU_PACKAGES.map((name) => [
      name,
      aptVersion(ubuntuFields[name], `ubuntu.${name}`),
    ])
  ) as Record<UbuntuPackage, string>

  const engineFields = fields(top.engines, "engines", ENGINE_NAMES)
  const engines = Object.fromEntries(
    ENGINE_NAMES.map((name) => [name, readEngine(engineFields[name], name)])
  ) as Record<EngineName, Engine>

  return {
    lookedUp,
    images: {
      ubuntu: readImage(images.ubuntu, "images.ubuntu"),
      fixtures: readImage(images.fixtures, "images.fixtures"),
    },
    dockerKey: {
      url: httpsUrl(key.url, "dockerKey.url"),
      fingerprint,
      compact: fingerprint.replaceAll(" ", ""),
    },
    dockerRepository: {
      url: httpsUrl(repository.url, "dockerRepository.url"),
      suite: word("suite"),
      component: word("component"),
    },
    ubuntu,
    engines,
  }
}

/** The committed pin file, read strictly. */
export function loadPins(path: string = PINS_PATH): Pins {
  return readPins(readFileSync(path, "utf8"))
}
