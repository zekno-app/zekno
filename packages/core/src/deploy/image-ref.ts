/**
 * The image reference grammar (specs/016-build-from-source, contracts/core.md
 * CO3; FR-077, item 15): `<host>[:<port>]/<path>[:<tag>]@sha256:<64 hex>`,
 * for a Railpack build's frontend and images, the bases of a build record and
 * `railpackPlanImages`. zekno's Dockerfile reader keeps Docker's full grammar
 * for references without digests (CL3); this is the only one core holds.
 *
 * It imports nothing of the library, so `builds.ts`, which re-exports it, and
 * `build-record.ts` both read it with no import cycle.
 */
import { z } from "zod"

/** A DNS label: a letter or digit, then letters, digits and `-`, ending with a letter or digit, at most 63 characters. */
const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
/** One part of a path: lowercase letters and digits, single separators between them. */
const PATH_PART = "[a-z0-9]+(?:[._-][a-z0-9]+)*"
const IMAGE_REF = new RegExp(
  `^(${LABEL}(?:\\.${LABEL})*)(?::([1-9][0-9]{0,4}))?` +
    `/${PATH_PART}(?:/${PATH_PART})*` +
    "(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?" +
    "@sha256:[0-9a-f]{64}$"
)
const IMAGE_REF_LENGTH = 255

/** The registry no image is pulled from: the images a runner builds are named under it (FR-077). */
export const RESERVED_REGISTRY = "zekno.invalid"

/**
 * True for `zekno.invalid` in any case, with or without a port (CO3, item
 * 15): a reference to it would name an image a runner built, so it is
 * refused wherever a reference is read.
 */
export function namesReservedRegistry(host: string): boolean {
  return /^zekno\.invalid(?::[0-9]+)?$/i.test(host)
}

/**
 * True when `text` is a reference by digest that CO3 reads, at most 255
 * characters. The first part is a host only when it holds a `.`, carries a
 * `:<port>`, or is `localhost`, as Docker reads it, so `library/node@…`, which
 * Docker reads as an image of Docker Hub, is refused: every reference names
 * its registry. The port is 1 to 65535 with no leading zero. A reference to
 * `zekno.invalid` is refused (FR-077).
 */
export function isImageRef(text: string): boolean {
  if (typeof text !== "string" || text.length > IMAGE_REF_LENGTH) return false
  const match = IMAGE_REF.exec(text)
  if (!match) return false
  const host = match[1]!
  const port = match[2]
  if (port !== undefined && Number(port) > 65535) return false
  if (!(host.includes(".") || port !== undefined || host === "localhost"))
    return false
  return !namesReservedRegistry(host)
}

/** A Railpack build's frontend or one of its images (CO1, CO3). */
export const ImageRefSchema = z.string().refine(isImageRef)
/** A reference by digest that `isImageRef` reads: text, as CO1 writes it. */
export type ImageRef = z.infer<typeof ImageRefSchema>
