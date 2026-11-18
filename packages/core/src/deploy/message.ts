/**
 * The signed deploy's version 2: its payload, and how it is read. The format
 * is the design's part 5 (specs/010-app-settings/deploy-v2.md), and every rule
 * here is a rule of contracts/message.md (F4 to F19, and F7). The later
 * fields' rules (F20 to F40) are in `later-fields.ts`.
 *
 * Reading is pure: no signature, no state. Every field is present in every
 * payload, and a value outside its rule is refused, never clamped, defaulted
 * or ignored.
 */
import { z } from "zod"

import { fromUtf8, utf8 } from "../crypto/encoding"
import { LIMITS } from "../protocol/limits"
import { ok, refuse, type Result } from "../protocol/result"
import { APP_NAME, secretName, SERVER_ID } from "../secrets/secrets"
import { secretVersion } from "../secrets/statement"
import { isoTime, TEAM_ID } from "../team/roster"
import {
  BuildSchema,
  HealthSchema,
  laterFieldsAreConsistent,
  PredeploySchema,
  RouteSchema,
} from "./later-fields"

export type { Build, Health, Predeploy, Route } from "./later-fields"

const hex64 = z.string().regex(/^[0-9a-f]{64}$/)

/** A time written exactly as `toISOString` writes it, so each time has one spelling. */
const canonicalTime = isoTime.refine((text) => {
  const time = Date.parse(text)
  return Number.isFinite(time) && new Date(time).toISOString() === text
})

const DeployV2Schema = z.strictObject({
  v: z.literal(2),
  teamId: z.string().regex(TEAM_ID),
  /** Hash of the team list the signer was working from. */
  teamHash: hex64,
  serverId: z.string().regex(SERVER_ID),
  app: z.string().regex(APP_NAME),
  /** The app's last accepted number as the signer learned it; 0 when it has none. */
  previous: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 1),
  /** Exactly `previous + 1`. */
  sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  createdAt: isoTime,
  /** After this the deploy may not run; `null` only over SSH, where no relay holds it. */
  expiresAt: canonicalTime.nullable(),
  compose: z
    .string()
    .refine((text) => utf8(text).length <= LIMITS.composeBytes),
  secrets: z
    .array(
      z.strictObject({ name: secretName, hash: hex64, version: secretVersion })
    )
    .max(LIMITS.secretsPerDeploy),
  /** Secrets the team has retired, so the server remembers not to take them back. */
  removed: z
    .array(z.strictObject({ name: secretName, version: secretVersion }))
    .max(LIMITS.secretsPerDeploy),
  builds: z.array(BuildSchema).max(LIMITS.buildsPerDeploy),
  predeploy: PredeploySchema.nullable(),
  health: HealthSchema.nullable(),
  routes: z.array(RouteSchema).max(LIMITS.routesPerDeploy),
})

/** What one server should run for one app, and what of it a runner checks and keeps. */
export type DeployV2 = z.infer<typeof DeployV2Schema>

const sortedAndUnique = (names: readonly string[]) =>
  names.every((name, index) => index === 0 || names[index - 1]! < name)

/** Freezes a value read from JSON and everything in it. */
function freezeDeep<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) freezeDeep(child)
    Object.freeze(value)
  }
  return value
}

/**
 * Steps F4 to F6: the payload's format. A reader of the history uses this
 * alone (`readSignedDeployV2`): it does not judge what a runner carries out.
 */
export function readDeployV2Format(
  json: unknown
): Result<DeployV2, "malformed"> {
  // F4. JSON that is an object.
  if (typeof json !== "object" || json === null || Array.isArray(json))
    return refuse("malformed", "The deploy is not a JSON object.")
  // F5. The strict schema: every field present, no other, each within its rule.
  const parsed = DeployV2Schema.safeParse(json)
  if (!parsed.success)
    return refuse("malformed", "The deploy does not match its definition.")
  // F6. The rules across fields.
  const deploy = parsed.data
  const secretNames = deploy.secrets.map((secret) => secret.name)
  const removedNames = deploy.removed.map((removal) => removal.name)
  if (
    deploy.sequence !== deploy.previous + 1 ||
    !sortedAndUnique(secretNames) ||
    !sortedAndUnique(removedNames) ||
    new Set([...secretNames, ...removedNames]).size !==
      secretNames.length + removedNames.length ||
    !laterFieldsAreConsistent(deploy)
  )
    return refuse("malformed", "The deploy does not match its definition.")
  return ok(freezeDeep(deploy))
}

/**
 * F4 to F6 from the signed bytes, with F41: the payload in its one
 * spelling. Its text must be exactly `JSON.stringify` of what the reader
 * gives for it, the text `createDeployV2` signs. So a key written twice
 * (which `JSON.parse` reads last-wins, where another reader may keep the
 * first), a number written another way (`-0`, `1e0`, `1.0`), whitespace, an
 * escape `JSON.stringify` does not write, or keys in another order than the
 * format's is `malformed`: one signed text is one deploy to every reader
 * (security review S5, S6). No object of the payload has keys of free text,
 * so the order JavaScript gives keys that look like numbers never comes into
 * it. Used by both readers of signed bytes; version 1 and the secret
 * statements are read as before (FR-003).
 */
export function readDeployV2Bytes(
  bytes: Uint8Array
): Result<DeployV2, "malformed"> {
  const text = fromUtf8(bytes)
  let json: unknown
  try {
    json = text === undefined ? undefined : (JSON.parse(text) as unknown)
  } catch {
    json = undefined
  }
  const read = readDeployV2Format(json)
  if (!read.ok) return read
  if (JSON.stringify(read.value) !== text)
    return refuse("malformed", "The deploy is not written in its one spelling.")
  return read
}

/** F7: builds, the pre-deploy command, the health check and routes come in later steps. */
function carriedOut(
  read: Result<DeployV2, "malformed">
): Result<DeployV2, "malformed" | "unsupported_version"> {
  if (!read.ok) return read
  const deploy = read.value
  if (
    deploy.builds.length > 0 ||
    deploy.predeploy !== null ||
    deploy.health !== null ||
    deploy.routes.length > 0
  ) {
    return refuse(
      "unsupported_version",
      "This deploy asks for something this runner does not carry out yet."
    )
  }
  return read
}

/**
 * Reads a version-2 payload, already parsed from JSON, in the order of
 * contracts/message.md: its format (F4 to F6, `malformed`), and only then
 * whether it asks for a field this library does not carry out yet (F7,
 * `unsupported_version`). A later field that breaks its own rule is so
 * refused `malformed` first.
 */
export function readDeployV2Payload(
  json: unknown
): Result<DeployV2, "malformed" | "unsupported_version"> {
  return carriedOut(readDeployV2Format(json))
}

/** `readDeployV2Payload` from the signed bytes: F4 to F6 with F41 (`readDeployV2Bytes`), then F7. */
export function readDeployV2PayloadBytes(
  bytes: Uint8Array
): Result<DeployV2, "malformed" | "unsupported_version"> {
  return carriedOut(readDeployV2Bytes(bytes))
}
