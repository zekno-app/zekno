/** The outcome of judging untrusted input: a value, or a refusal with a stable code. */
export type Ok<T> = { readonly ok: true; readonly value: T }
export type Refused<C extends string> = {
  readonly ok: false
  readonly error: { readonly code: C; readonly message: string }
}
export type Result<T, C extends string> = Ok<T> | Refused<C>

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

export function refuse<C extends string>(code: C, message: string): Refused<C> {
  return { ok: false, error: { code, message } }
}

/** Reasons a message read from outside is rejected before its content is used. */
export const MESSAGE_REFUSALS = ["malformed", "too_large"] as const
export type MessageRefusal = (typeof MESSAGE_REFUSALS)[number]

/** Reasons a runner refuses a deploy. Safe to report to the control plane. */
export const DEPLOY_REFUSALS = [
  "malformed",
  "too_large",
  "unsupported_version",
  "wrong_payload_type",
  "unknown_signer",
  "bad_signature",
  "role_not_allowed",
  "wrong_team",
  "stale_team",
  "wrong_server",
  "unknown_server",
  "replayed",
  "sequence_jump",
  "secrets_mismatch",
  "stale_secret",
] as const
export type DeployRefusal = (typeof DEPLOY_REFUSALS)[number]

/** Reasons a team list is refused. */
export const ROSTER_REFUSALS = [
  "malformed",
  "too_large",
  "unsupported_version",
  "wrong_payload_type",
  "unknown_signer",
  "bad_signature",
  "not_admin",
  "wrong_team",
  "wrong_version",
  "wrong_previous",
  "invalid_members",
  "code_mismatch",
] as const
export type RosterRefusal = (typeof ROSTER_REFUSALS)[number]

/** Reasons a signed secret is not trusted. */
export const SECRET_REFUSALS = [
  "malformed",
  "too_large",
  "unsupported_version",
  "wrong_payload_type",
  "unknown_signer",
  "bad_signature",
  "wrong_team",
  "wrong_server",
  "wrong_app",
  "secrets_mismatch",
] as const
export type SecretRefusal = (typeof SECRET_REFUSALS)[number]

/** Reasons the secrets of a deploy cannot be opened. */
export const OPEN_REFUSALS = [
  "not_verified",
  "wrong_server_key",
  "decrypt_failed",
  "binding_mismatch",
] as const
export type OpenRefusal = (typeof OPEN_REFUSALS)[number]

/** Mistakes by the caller of this library, as opposed to untrusted input. */
export type CoreErrorCode =
  | "invalid_key"
  | "invalid_argument"
  | "invalid_name"
  | "invalid_value"
  | "invalid_members"
  | "too_large"
  | "not_admin"
  | "not_member"
  | "untrusted_secret"
  | "unknown_server"
  | "signer_failed"

/**
 * Thrown when this library is called with arguments it cannot accept. The
 * message never contains a secret value or private key material.
 */
export class CoreError extends Error {
  readonly code: CoreErrorCode

  constructor(code: CoreErrorCode, message: string) {
    super(message)
    this.name = "CoreError"
    this.code = code
  }
}
