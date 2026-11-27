/**
 * Images of a Linux check in the stand-in (specs/016-build-from-source,
 * T012 to T014): the fixtures' base, pulled by digest when the stand-in's
 * Docker lacks it and removed again only then; and the words L4 records of
 * an image's identity (plan, "How an image is known again"; map-runner E01,
 * map-checks T10): the iidfile, `docker image inspect`'s `.Id`, and the
 * metadata file's `containerimage.digest` and `containerimage.config.digest`,
 * and which of them are equal.
 *
 *   const base = await ensureImage(open.inStandIn, loadPins().images.fixtures.image)
 *   // ... builds FROM base.image ...
 *   left.push(...(await dropPulled(open.inStandIn, base)))
 */
import { firstLine } from "../host/host-lists"
import { removeImages, type InStandIn } from "./rb7"

const MINUTE = 60_000

export type Present = {
  readonly image: string
  /** True when `ensureImage` pulled it, so the check removes it. */
  readonly pulled: boolean
}

/** `image` in the stand-in's Docker: there already, or pulled now. */
export async function ensureImage(
  run: InStandIn,
  image: string
): Promise<Present> {
  const there = await run([
    "docker",
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    image,
  ])
  if (there.code === 0) return { image, pulled: false }
  const pulled = await run(["docker", "pull", "--quiet", image], {
    timeoutMs: 10 * MINUTE,
  })
  if (pulled.code !== 0)
    throw new Error(`docker pull ${image} failed: ${firstLine(pulled)}`)
  return { image, pulled: true }
}

/** Removes the image `ensureImage` pulled; gives what it could not remove. */
export async function dropPulled(
  run: InStandIn,
  present: Present | undefined
): Promise<string[]> {
  if (present === undefined || !present.pulled) return []
  return removeImages(run, [present.image])
}

export const DIGEST = /^sha256:[0-9a-f]{64}$/

/** A digest a file or a call printed, or undefined for anything else. */
export function digestIn(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined
  const value = text.trim()
  return DIGEST.test(value) ? value : undefined
}

/** `sha256:` and the first 12 hex digits. */
export function shortDigest(digest: string): string {
  return `${digest.slice(0, 19)}…`
}

export type Identity = {
  readonly iidfile?: string
  readonly id?: string
  readonly digest?: string
  readonly config?: string
}

/** The two digests of a build's `meta.json`. */
export function metadataDigests(
  metadata: Readonly<Record<string, unknown>> | undefined
): Pick<Identity, "digest" | "config"> {
  const digest = digestIn(metadata?.["containerimage.digest"])
  const config = digestIn(metadata?.["containerimage.config.digest"])
  return {
    ...(digest === undefined ? {} : { digest }),
    ...(config === undefined ? {} : { config }),
  }
}

const NAMES: readonly (readonly [keyof Identity, string])[] = [
  ["iidfile", "the iidfile"],
  ["id", ".Id"],
  ["digest", "containerimage.digest"],
  ["config", "containerimage.config.digest"],
]

/** Each of the four, short, and which are equal: `equal: the iidfile = containerimage.config.digest; .Id = containerimage.digest`. */
export function identityWords(seen: Identity): string {
  const each = NAMES.map(([key, name]) => {
    const value = seen[key]
    return `${name} ${value === undefined ? "absent" : shortDigest(value)}`
  })
  const groups = new Map<string, string[]>()
  for (const [key, name] of NAMES) {
    const value = seen[key]
    if (value !== undefined)
      groups.set(value, [...(groups.get(value) ?? []), name])
  }
  const equal = [...groups.values()]
    .filter((names) => names.length > 1)
    .map((names) => names.join(" = "))
  return `${each.join(", ")}; ${equal.length === 0 ? "no two equal" : `equal: ${equal.join("; ")}`}`
}
