/**
 * The fields of the signed deploy's version 2 that a runner carries out in
 * later steps: builds, the pre-deploy command, the health check and routes.
 * Their whole format is fixed now, as the design's part 5 gives it
 * (specs/010-app-settings/deploy-v2.md) and contracts/message.md states it
 * (F20 to F40), so a later feature adds behaviour and never changes the
 * format. Every rule here is checked in full; `message.ts` then refuses a
 * deploy that uses one of these fields (`unsupported_version`).
 */
import { domainToASCII, domainToUnicode } from "node:url"
import { z } from "zod"

import { isWellFormed, toHex, utf8 } from "../crypto/encoding"
import { hash } from "../crypto/hash"
import { LIMITS } from "../protocol/limits"
import { SERVICE_NAME } from "../protocol/protocol"
import { CoreError } from "../protocol/result"
import { isReservedSecretName, secretName } from "../secrets/secrets"
import { staysInside } from "./link"

const hex64 = z.string().regex(/^[0-9a-f]{64}$/)
const seconds = (max: number) => z.number().int().min(1).max(max)
const port = z.number().int().min(1).max(65535)
const service = z.string().regex(SERVICE_NAME)

const bytesOf = (text: string) => utf8(text).length

/** Text handed to a program as it is: no lone surrogate, no NUL. */
const plainText = (text: string) =>
  isWellFormed(text) && !text.includes("\u0000")

/** True when each name comes after the one before it, so the list is sorted and has no repeat. */
const sortedAndUnique = (names: readonly string[]) =>
  names.every((name, index) => index === 0 || names[index - 1]! < name)

/** A build of an image on the server, from source the CLI packed (design, part 4.1 b). */
export const BuildSchema = z.strictObject({
  /** The build key, `buildKey` of this build; it names the image in the Compose text. */
  key: hex64,
  pack: z.strictObject({
    /** `hash("zekno/v1/pack", the pack's bytes)`. */
    hash: hex64,
    size: z.number().int().min(1).max(LIMITS.packBytes),
    /** In order, `hash("zekno/v1/pack-chunk", sealed chunk)` of each chunk. */
    chunks: z.array(hex64).min(1).max(LIMITS.chunksPerDeploy),
  }),
  /** Inside the pack, as a person reads it: no control, format or line-separator character. */
  dockerfile: z
    .string()
    .min(1)
    .max(LIMITS.dockerfileLength)
    .refine((path) => isWellFormed(path) && !/[\p{C}\u2028\u2029]/u.test(path))
    .refine(staysInside),
  target: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/)
    .nullable(),
  /** Plain build arguments, signed and readable by the hosted service. Never a name the runner keeps. */
  args: z
    .array(
      z.strictObject({
        name: secretName.refine((name) => !isReservedSecretName(name)),
        value: z
          .string()
          .refine(
            (value) =>
              plainText(value) && bytesOf(value) <= LIMITS.argValueBytes
          ),
      })
    )
    .max(LIMITS.argsPerBuild),
  /** Names of the deploy's secrets the build may read. */
  secrets: z.array(secretName).max(LIMITS.buildSecretsPerBuild),
  /** `"none"`: no network for the build's `RUN` steps. */
  network: z.enum(["default", "none"]),
  timeout: seconds(LIMITS.buildSeconds),
})
export type Build = z.infer<typeof BuildSchema>

/** A command run once, before the new version starts, in a container of the new version (part 4.4). */
export const PredeploySchema = z.strictObject({
  service,
  /** Separate words, never handed to a shell. */
  command: z
    .array(z.string().max(LIMITS.predeployWordLength).refine(plainText))
    .min(1)
    .max(LIMITS.predeployWords),
  timeout: seconds(LIMITS.predeploySeconds),
})
export type Predeploy = z.infer<typeof PredeploySchema>

/**
 * An HTTP path and query, as RFC 3986 allows them: no space, no `#`, and `%`
 * only before two hex digits.
 */
const PATH = /^\/(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9A-Fa-f]{2}){0,1023}$/

/** When the deploy counts as done: each service up, and answering on `http` if given (part 4.3). */
export const HealthSchema = z.strictObject({
  timeout: seconds(LIMITS.healthSeconds),
  services: z
    .array(
      z.strictObject({
        service,
        http: z
          .strictObject({
            port,
            path: z.string().max(LIMITS.healthPathLength).regex(PATH),
          })
          .nullable(),
      })
    )
    .min(1)
    .max(LIMITS.healthServices),
})
export type Health = z.infer<typeof HealthSchema>

/** Names that never reach the public internet, or that this program keeps for itself (`zekno.invalid`). */
const SPECIAL_USE = new Set([
  "localhost",
  "invalid",
  "test",
  "example",
  "local",
  "internal",
  "alt",
  "onion",
  "arpa",
])

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * An `xn--` label counts only as the one spelling of what it shows: it
 * decodes, and encodes back to the same text. Otherwise two texts could name
 * what a browser shows as one domain.
 */
function isALabel(label: string): boolean {
  const shown = domainToUnicode(label)
  return shown !== "" && domainToASCII(shown) === label
}

/**
 * The domain rule (F40). Lowercase ASCII, at most 253 characters, at least two
 * labels of 1 to 63 letters, digits and hyphens, none starting or ending with
 * a hyphen; an `xn--` label only when it is a valid A-label; a last label that
 * is not all digits (never an address); not a special-use name or under one.
 * So two spellings of one domain cannot both pass, and comparing the text
 * compares the domains.
 */
export function isRoutableDomain(domain: string): boolean {
  if (domain.length > LIMITS.domainLength) return false
  const labels = domain.split(".")
  if (labels.length < 2) return false
  for (const label of labels) {
    if (!LABEL.test(label)) return false
    if (label.startsWith("xn--") && !isALabel(label)) return false
  }
  const last = labels.at(-1)!
  return !/^[0-9]+$/.test(last) && !SPECIAL_USE.has(last)
}

/** Where a domain's traffic goes: a service of the app and a port of its containers (part 4.2). */
export const RouteSchema = z.strictObject({
  domain: z.string().refine(isRoutableDomain),
  service,
  port,
})
export type Route = z.infer<typeof RouteSchema>

/** What a build key is made of: a build without its key and time limit. */
export type BuildRecipe = {
  readonly pack: { readonly hash: string }
  readonly dockerfile: string
  readonly target: string | null
  readonly args: readonly { readonly name: string; readonly value: string }[]
  readonly secrets: readonly string[]
  readonly network: string
}

/**
 * The build key (F21): `hash("zekno/v1/build", …)` in hex, of the UTF-8 of
 * `JSON.stringify` of `[pack hash, dockerfile, target, [[name, value], …],
 * [[secret name, its listed hash], …], network]`. Only arrays, strings and
 * null go in, so the CLI and the runner compute the same bytes. Each build
 * secret's hash is the one the deploy lists for it, so a build that read an
 * old value is not reused once the secret is replaced.
 */
export function buildKey(
  build: BuildRecipe,
  secrets: readonly { readonly name: string; readonly hash: string }[]
): string {
  const text = (value: unknown) => typeof value === "string"
  const hashes = new Map(secrets.map((secret) => [secret.name, secret.hash]))
  if (
    !text(build.pack?.hash) ||
    !text(build.dockerfile) ||
    !(build.target === null || text(build.target)) ||
    !text(build.network) ||
    !build.args.every((arg) => text(arg.name) && text(arg.value)) ||
    !build.secrets.every((name) => text(hashes.get(name)))
  ) {
    throw new CoreError(
      "invalid_argument",
      "A build key is made of text only, and of secrets the deploy lists."
    )
  }
  const bytes = utf8(
    JSON.stringify([
      build.pack.hash,
      build.dockerfile,
      build.target,
      build.args.map((arg) => [arg.name, arg.value]),
      build.secrets.map((name) => [name, hashes.get(name)!]),
      build.network,
    ])
  )
  return toHex(hash("zekno/v1/build", bytes))
}

/**
 * The later fields' rules that look across fields (F6): sorted and unique
 * lists; each build secret in the deploy's `secrets`; each pack cut into as
 * many chunks as its size needs, and at most 64 distinct across the deploy;
 * each build key equal to this library's own computation; and the byte totals
 * of build arguments and of the pre-deploy command.
 */
export function laterFieldsAreConsistent(deploy: {
  readonly secrets: readonly { readonly name: string; readonly hash: string }[]
  readonly builds: readonly Build[]
  readonly predeploy: Predeploy | null
  readonly health: Health | null
  readonly routes: readonly Route[]
}): boolean {
  const listed = new Set(deploy.secrets.map((secret) => secret.name))
  const chunks = new Set<string>()
  let argBytes = 0
  for (const build of deploy.builds) {
    if (
      !sortedAndUnique(build.args.map((arg) => arg.name)) ||
      !sortedAndUnique(build.secrets) ||
      !build.secrets.every((name) => listed.has(name)) ||
      build.pack.chunks.length !==
        Math.ceil(build.pack.size / LIMITS.chunkBytes)
    )
      return false
    for (const chunk of build.pack.chunks) chunks.add(chunk)
    for (const arg of build.args) argBytes += bytesOf(arg.value)
    if (build.key !== buildKey(build, deploy.secrets)) return false
  }
  if (
    chunks.size > LIMITS.chunksPerDeploy ||
    argBytes > LIMITS.argBytesPerDeploy
  )
    return false
  if (
    deploy.predeploy &&
    deploy.predeploy.command.reduce((total, word) => total + bytesOf(word), 0) >
      LIMITS.predeployBytes
  )
    return false
  if (
    deploy.health &&
    !sortedAndUnique(deploy.health.services.map((entry) => entry.service))
  )
    return false
  return sortedAndUnique(deploy.routes.map((route) => route.domain))
}
