/**
 * The image a build made (specs/016-build-from-source, contracts/runner.md
 * RB11 first three bullets, RB9 last bullet; FR-041, FR-061, FR-066).
 *
 * `readMeta` reads the build's `--metadata-file`, `<work>/meta.json`: the
 * manifest digest (`containerimage.digest`) and the config digest
 * (`containerimage.config.digest`), never the iidfile, since which of the
 * two `docker image inspect` gives as `.Id` depends on the image store
 * (map-runner E01, check L4); and the base images of the provenance
 * materials, by digest, at most 16. The file also holds the build arguments
 * with their values: nothing else of it is kept, and it is deleted once
 * read. The digests stay in the caller's memory until B2 or B3.
 *
 * `checkImage` holds the tag the build made to them: `.Id` must be one of
 * the two digests, else the tag is not this build's (`step_failed`), and the
 * image's architecture must be the server's (`wrong_processor`).
 *
 *   const meta = readMeta(work)
 *   const image = await checkImage(dir, app, key, meta.digests, facts.arch)
 */
import {
  builtImageName,
  DIGEST,
  isImageRef,
  LIMITS,
  type Arch,
} from "@workspace/core"
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  rmSync,
} from "node:fs"
import { join } from "node:path"

import { runDocker } from "../docker/run"

/** The longest `meta.json` read; a longer one is not read at all (RB11). */
export const MAX_META_BYTES = 1024 * 1024

/** The two digests a build's image may have as `.Id`, one per image store (E01). */
export type Digests = { readonly manifest: string; readonly config: string }

/** What the runner keeps of `meta.json`. */
export type Meta = {
  /** Both digests, each `sha256:` and 64 hex; absent when either is missing or malformed. */
  readonly digests?: Digests
  /** The base images by digest, each held to core's reference pattern, sorted, each once, at most 16 (CO14). */
  readonly bases: readonly string[]
}

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** `path` as text when it is a plain file of at most `MAX_META_BYTES`, never through a link; else undefined. */
function readBounded(path: string): string | undefined {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    return undefined
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_META_BYTES) return undefined
    const buffer = Buffer.alloc(MAX_META_BYTES + 1)
    let size = 0
    for (;;) {
      const read = readSync(fd, buffer, size, buffer.length - size, null)
      if (read === 0) break
      size += read
      if (size > MAX_META_BYTES) return undefined
    }
    return buffer.subarray(0, size).toString("utf8")
  } catch {
    return undefined
  } finally {
    closeSync(fd)
  }
}

const digestIn = (value: unknown) =>
  typeof value === "string" && DIGEST.test(value) ? value : undefined

/** What `docker` names an image without a registry (`busybox`, `docker/dockerfile`), as Docker reads it. */
function fullName(name: string): string {
  const parts = name.split("/")
  if (parts.length === 1) return `docker.io/library/${name}`
  const first = parts[0]!
  return first.includes(".") || first.includes(":") || first === "localhost"
    ? name
    : `docker.io/${name}`
}

const decoded = (text: string) => {
  try {
    return decodeURIComponent(text)
  } catch {
    return undefined
  }
}

/** BuildKit names an image a build used as a package URL: `pkg:docker/<name>@<tag or digest>?platform=…`. */
const IMAGE_MATERIAL = "pkg:docker/"

/**
 * One material as a reference by digest, `<host>/<path>[:<tag>]@sha256:<64
 * hex>`, when it names an image with a SHA-256 digest and the reference
 * fits core's pattern (CO3: at most 255 characters, a registry named, never
 * `zekno.invalid`); else undefined.
 */
function baseOf(material: unknown): string | undefined {
  if (!isObject(material) || typeof material.uri !== "string") return undefined
  if (!material.uri.startsWith(IMAGE_MATERIAL)) return undefined
  const digest = isObject(material.digest) ? material.digest.sha256 : undefined
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest))
    return undefined
  const rest = material.uri.slice(IMAGE_MATERIAL.length).split(/[?#]/)[0]!
  const at = rest.lastIndexOf("@")
  const name = decoded(at === -1 ? rest : rest.slice(0, at))
  const version = decoded(at === -1 ? "" : rest.slice(at + 1))
  if (name === undefined || name === "" || version === undefined)
    return undefined
  // A version that is a digest names no tag; the material's own digest is the one kept.
  const tag =
    version === "" || version.startsWith("sha256:") ? "" : `:${version}`
  const ref = `${fullName(name)}${tag}@sha256:${digest}`
  return isImageRef(ref) ? ref : undefined
}

/** The materials of `buildx.build.provenance`: SLSA 0.2's `materials`, or 1.0's `buildDefinition.resolvedDependencies`. */
function materialsOf(provenance: unknown): unknown[] {
  if (!isObject(provenance)) return []
  if (Array.isArray(provenance.materials)) return provenance.materials
  const definition = provenance.buildDefinition
  return isObject(definition) && Array.isArray(definition.resolvedDependencies)
    ? definition.resolvedDependencies
    : []
}

/**
 * Reads `<work>/meta.json` (at most 1 MiB, only the fields used), then
 * deletes it, whatever it held. A file missing, too long, not JSON or a
 * link gives no digests and no bases.
 */
export function readMeta(work: string): Meta {
  const path = join(work, "meta.json")
  const text = readBounded(path)
  try {
    rmSync(path, { force: true })
  } catch {
    // The work folder, and the file with it, is deleted when the build ends (FR-050).
  }
  let parsed: unknown
  try {
    parsed = text === undefined ? undefined : JSON.parse(text)
  } catch {
    parsed = undefined
  }
  if (!isObject(parsed)) return { bases: [] }
  const manifest = digestIn(parsed["containerimage.digest"])
  const config = digestIn(parsed["containerimage.config.digest"])
  const bases = new Set<string>()
  for (const material of materialsOf(parsed["buildx.build.provenance"])) {
    const base = baseOf(material)
    if (base !== undefined) bases.add(base)
  }
  return {
    ...(manifest === undefined || config === undefined
      ? {}
      : { digests: { manifest, config } }),
    bases: [...bases].sort().slice(0, LIMITS.baseDigestsPerBuild),
  }
}

/** What `checkImage` found: the image is this build's and the server's processor's, or the reason it is not (RB16). */
export type ImageCheck =
  | { readonly ok: true; readonly arch: Arch }
  | { readonly ok: false; readonly reason: "step_failed" }
  | {
      readonly ok: false
      readonly reason: "wrong_processor"
      readonly arch: { readonly image: Arch; readonly server: Arch }
    }

/** An image's `.Architecture`, as Go names processors, read as CO10's `Arch`. */
const archOf = (word: string): Arch =>
  word === "amd64" || word === "arm64" ? word : "other"

const STEP_FAILED: ImageCheck = { ok: false, reason: "step_failed" }

/**
 * Inspects the tag the build made, `zekno.invalid/<app>:<key>`, through
 * `runDocker` from `dir` (the runner's folder): its `.Id` must be one of
 * `digests`, else `step_failed` (no digests, no such image, or an answer
 * that cannot be read, too); then its architecture must be `serverArch`,
 * else `wrong_processor` with both. An image of a processor other than
 * `amd64` or `arm64` is never taken as the server's.
 */
export async function checkImage(
  dir: string,
  app: string,
  key: string,
  digests: Digests | undefined,
  serverArch: Arch,
  options: { timeoutMs?: number } = {}
): Promise<ImageCheck> {
  if (digests === undefined) return STEP_FAILED
  const answer = await runDocker(
    dir,
    [
      "image",
      "inspect",
      "--format",
      "{{.Id}} {{.Architecture}}",
      builtImageName(app, key),
    ],
    options
  )
  if (answer.code !== 0) return STEP_FAILED
  const words = answer.stdout.replace(/\n$/, "").split(" ")
  if (words.length !== 2) return STEP_FAILED
  const [id, architecture] = words as [string, string]
  if (id !== digests.manifest && id !== digests.config) return STEP_FAILED
  const image = archOf(architecture)
  if (image === "other" || image !== serverArch)
    return {
      ok: false,
      reason: "wrong_processor",
      arch: { image, server: serverArch },
    }
  return { ok: true, arch: image }
}
