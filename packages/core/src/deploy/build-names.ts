/**
 * The names and patterns zekno and the runner share for a build
 * (specs/016-build-from-source, contracts/core.md CO6; FR-025, FR-036,
 * FR-036b, FR-037b). The signed deploy's schema, zekno's summary and
 * Dockerfile reader (CL3) and the runner (RB4) all use these functions, so
 * zekno never signs a name or a line the runner refuses.
 *
 * Railpack's own build arguments `cache-key` and `secrets-hash` hold a
 * hyphen, which no variable name can, so they need no entry here. Whether
 * `RAILPACK_*` and `MISE_*` join the list waits for check R7 (T224).
 */
import { isReservedSecretName } from "../secrets/secrets"

/** The builders a build names (CO1, `builder.name`). */
export type BuilderName = "dockerfile" | "railpack"

/** Names the builder sets for itself: a build argument of one of them would change how it builds (CO6). */
const BUILDER_OWN =
  /^(?:SOURCE_DATE_EPOCH|TARGETPLATFORM|TARGETOS|TARGETARCH|TARGETVARIANT|BUILDPLATFORM|BUILDOS|BUILDARCH|BUILDVARIANT)$/i

/** The credentials the builder hands to a fetch of git or HTTP sources (CO6, FR-037b). */
const CREDENTIAL =
  /^(?:GIT_AUTH_TOKEN|GIT_AUTH_HEADER)$|^(?:HTTP_AUTH_TOKEN_|HTTP_AUTH_HEADER_)/i

/**
 * True for a name the builder would read as a credential: `GIT_AUTH_TOKEN`,
 * `GIT_AUTH_HEADER`, or a name starting `HTTP_AUTH_TOKEN_` or
 * `HTTP_AUTH_HEADER_`, in any case. Never a build secret (CO6, FR-037b).
 */
export function isCredentialName(name: string): boolean {
  return CREDENTIAL.test(name)
}

/**
 * True for a name a build is never given as an argument (CO6, FR-036):
 * today's reserved names (`isReservedSecretName`), the names the builder
 * reads as its own, in any case, and for a Railpack build also every
 * credential name, since its variables reach the build as build secrets.
 */
export function isNeverGivenArg(name: string, builder: BuilderName): boolean {
  return (
    isReservedSecretName(name) ||
    BUILDER_OWN.test(name) ||
    (builder === "railpack" && isCredentialName(name))
  )
}

/**
 * A Dockerfile line that would choose the builder's reader (CO6, FR-025).
 * `\s` also matches a byte order mark, so a first line that starts with one
 * is found too. No global flag, so the pattern keeps no position between
 * calls.
 */
export const SYNTAX_LINE = /^\s*#\s*syntax\s*=/i

/**
 * True for one line of a Dockerfile that is a `# syntax=` line. zekno's
 * reader (CL3) and the runner (RB4) apply it to every line, wherever it
 * stands, not only before the first instruction (CO6).
 */
export function isSyntaxLine(line: string): boolean {
  return SYNTAX_LINE.test(line)
}
