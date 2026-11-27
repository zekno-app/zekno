/**
 * An image reference as Docker reads one (specs/016-build-from-source,
 * contracts/cli.md CL3; FR-042, FR-042a), written in the project with no
 * package (plan.md item 8 (a)), as a port of distribution/reference's
 * `regexp.go` and `normalize.go` (`ParseNormalizedNamed`, which BuildKit
 * reads every base image with) and of go-digest's check of a digest.
 * References without a digest are read too: core's grammar (CO3) holds only
 * references by digest.
 *
 * Normalizing gives every reference its registry: a first part with a dot, a
 * colon, `localhost` or a capital is a registry; else the reference is of
 * Docker Hub (`docker.io`, an official image under `library/`). So zekno knows
 * which registry each image place names (C10).
 */

/** Docker's lowercase letters and digits, the parts of a path. */
const ALPHANUMERIC = "[a-z0-9]+"
/** One dot, one or two underscores, or any dashes. */
const SEPARATOR = "(?:[._]|__|[-]+)"
const PATH_COMPONENT = `${ALPHANUMERIC}(?:${SEPARATOR}${ALPHANUMERIC})*`
const DOMAIN_COMPONENT = "(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])"
const DOMAIN_NAME = `${DOMAIN_COMPONENT}(?:\\.${DOMAIN_COMPONENT})*`
const IPV6_ADDRESS = "\\[(?:[a-fA-F0-9:]+)\\]"
const DOMAIN_AND_PORT = `(?:${DOMAIN_NAME}|${IPV6_ADDRESS})(?::[0-9]+)?`
const REMOTE_NAME = `${PATH_COMPONENT}(?:/${PATH_COMPONENT})*`
const NAME = `(?:${DOMAIN_AND_PORT}/)?${REMOTE_NAME}`
/** Go's `\w` is ASCII, as JavaScript's is. */
const TAG = "[\\w][\\w.-]{0,127}"
const DIGEST =
  "[A-Za-z][A-Za-z0-9]*(?:[-_+.][A-Za-z][A-Za-z0-9]*)*:[0-9a-fA-F]{32,}"

const REFERENCE = new RegExp(`^(${NAME})(?::(${TAG}))?(?:@(${DIGEST}))?$`)
const ANCHORED_NAME = new RegExp(`^(?:(${DOMAIN_AND_PORT})/)?(${REMOTE_NAME})$`)
/** 64 lowercase hex digits alone: an image id, which Docker refuses as a name. */
const IDENTIFIER = /^[a-f0-9]{64}$/

/** The most characters a name may have (`NameTotalLengthMax`). */
const NAME_LENGTH = 255

/**
 * The longest text that can be a reference: a name, a tag and the longest
 * digest Docker knows. A longer text is refused before the grammar is tried,
 * so no text from a Dockerfile of 1 MiB makes the match slow.
 */
const REFERENCE_LENGTH = NAME_LENGTH + 1 + 128 + 1 + "sha512:".length + 128

/** The digests go-digest checks, by the length of their lowercase hex. */
const DIGEST_HEX: Record<string, number> = {
  sha256: 64,
  sha384: 96,
  sha512: 128,
}

/** Docker Hub, the registry of a reference that names none. */
export const DOCKER_HUB = "docker.io"

/** A reference, normalized as Docker normalizes it. */
export type ImageReference = {
  /** The registry with its port, as written, `docker.io` when none is written. */
  readonly domain: string
  /** The path in the registry, `library/` before an official image. */
  readonly path: string
  readonly tag: string | null
  /** `<algorithm>:<hex>`, null when the reference names none. */
  readonly digest: string | null
}

/** Whether a digest is one go-digest takes: an algorithm it knows, with lowercase hex of its length. */
function knownDigest(digest: string): boolean {
  const [algorithm, hex] = digest.split(":") as [string, string]
  const length = DIGEST_HEX[algorithm]
  return (
    length !== undefined && hex.length === length && /^[a-f0-9]+$/.test(hex)
  )
}

/** `splitDockerDomain`: the registry, and the rest of the reference. */
function splitDomain(text: string): { domain: string; remainder: string } {
  const slash = text.indexOf("/")
  const first = slash < 0 ? "" : text.slice(0, slash)
  let domain = first
  let remainder = text.slice(slash + 1)
  if (
    slash < 0 ||
    (!/[.:]/.test(first) &&
      first !== "localhost" &&
      first.toLowerCase() === first)
  ) {
    domain = DOCKER_HUB
    remainder = text
  }
  if (domain === "index.docker.io") domain = DOCKER_HUB
  if (domain === DOCKER_HUB && !remainder.includes("/"))
    remainder = `library/${remainder}`
  return { domain, remainder }
}

/**
 * A text read as Docker's `ParseNormalizedNamed` reads it, or undefined for
 * one Docker refuses: not the grammar, an image id alone, a capital in the
 * path, a name past 255 characters, a digest go-digest does not take.
 */
export function parseReference(text: string): ImageReference | undefined {
  if (text.length > REFERENCE_LENGTH || IDENTIFIER.test(text)) return undefined
  const { domain, remainder } = splitDomain(text)
  const colon = remainder.indexOf(":")
  const remote = colon < 0 ? remainder : remainder.slice(0, colon)
  if (remote.toLowerCase() !== remote) return undefined
  const match = REFERENCE.exec(`${domain}/${remainder}`)
  if (match === null || match[1]!.length > NAME_LENGTH) return undefined
  const name = ANCHORED_NAME.exec(match[1]!)
  if (name === null || name[1] === undefined) return undefined
  const digest = match[3] ?? null
  if (digest !== null && !knownDigest(digest)) return undefined
  return {
    domain: name[1],
    path: name[2]!,
    tag: match[2] ?? null,
    digest,
  }
}
