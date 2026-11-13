/** Every size and count limit, in one place. Sizes are in bytes unless named otherwise. */
export const LIMITS = {
  /** Secrets in one deploy. */
  secretsPerDeploy: 256,
  /** One secret value, as UTF-8. */
  secretValueBytes: 64 * 1024,
  /** Characters in a secret name. */
  secretNameLength: 128,
  /** The service definition carried by a deploy, as UTF-8. */
  composeBytes: 256 * 1024,
  /** Members in a team list. */
  members: 64,
  /** Characters in a member's or a server's display name. */
  memberNameLength: 64,
  /** Servers in a team list. */
  servers: 256,
  /** How far a deploy number may be above the last one accepted for its app. */
  sequenceStep: 2 ** 20,
  /** The signed payload of an envelope. */
  payloadBytes: 1024 * 1024,
  /** Any message read from outside, as received. */
  messageBytes: 32 * 1024 * 1024,
  /** Secret records and removals considered when working out an app's current secrets. */
  secretHistory: 4096,
  /** Deploys in one "pending deploys" response. */
  pendingDeploys: 64,
  /** Team lists in one chain response. */
  rosterChain: 1024,
} as const

/** Longest base64url text that can encode `bytes` bytes. */
export function base64UrlLength(bytes: number): number {
  return Math.ceil((bytes * 4) / 3)
}
