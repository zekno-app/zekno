/**
 * The build entry of the signed deploy's version 2: a build of an image on
 * the server, from source zekno packed (specs/016-build-from-source,
 * contracts/core.md CO1 to CO4; 014's contracts/message.md, F20 to F30). The
 * name of a built image, the entry's schema, its key and the rules that look
 * across the deploy's builds (F6) are here, and the image reference grammar
 * (CO3, from `image-ref.ts`) is given from here too;
 * `message.ts` reads them as part of the payload, and `carried-out.ts` says
 * which builds this release carries out (CO7).
 */
import { z } from "zod"

import { isWellFormed, toHex, utf8 } from "../crypto/encoding"
import { hash } from "../crypto/hash"
import { LIMITS } from "../protocol/limits"
import { CoreError } from "../protocol/result"
import { APP_NAME, secretName } from "../secrets/secrets"
import { isCredentialName, isNeverGivenArg } from "./build-names"
import { ImageRefSchema, RESERVED_REGISTRY } from "./image-ref"
import { staysInside } from "./link"

// CO3's grammar lives in `image-ref.ts`, which imports nothing of the
// library, so `build-record.ts` reads it with no import cycle; it is also
// given from here, beside the build entry that uses it.
export {
  ImageRefSchema,
  isImageRef,
  namesReservedRegistry,
  type ImageRef,
} from "./image-ref"

const HEX64 = /^[0-9a-f]{64}$/
const hex64 = z.string().regex(HEX64)

/**
 * The name of the image a runner builds for `app` with this build `key`:
 * `zekno.invalid/<app>:<key>` (CO2, FR-022). zekno's Compose text, the
 * runner's tag and CO2's rule all use it. An app outside `APP_NAME`, an app
 * ending with `-` (item 15) or a key that is not 64 lowercase hex throws.
 */
export function builtImageName(app: string, key: string): string {
  if (
    typeof app !== "string" ||
    !APP_NAME.test(app) ||
    app.endsWith("-") ||
    typeof key !== "string" ||
    !HEX64.test(key)
  )
    throw new CoreError(
      "invalid_argument",
      "A built image is named by an app that does not end with a hyphen and a build key."
    )
  return `${RESERVED_REGISTRY}/${app}:${key}`
}

const bytesOf = (text: string) => utf8(text).length

/** Text handed to a program as it is: no lone surrogate, no NUL. */
const plainText = (text: string) =>
  isWellFormed(text) && !text.includes("\u0000")

/** True when each name comes after the one before it, so the list is sorted and has no repeat. */
const sortedAndUnique = (names: readonly string[]) =>
  names.every((name, index) => index === 0 || names[index - 1]! < name)

/** A build from a Dockerfile in the pack (CO1). */
const DockerfileBuilderSchema = z.strictObject({
  name: z.literal("dockerfile"),
  /** Inside the pack, as a person reads it: no control, format or line-separator character (014's path rule). */
  dockerfile: z
    .string()
    .min(1)
    .max(LIMITS.dockerfileLength)
    .refine((path) => isWellFormed(path) && !/[\p{C}\u2028\u2029]/u.test(path))
    .refine(staysInside),
  /** The stage to build, or `null` for the last one. */
  target: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/)
    .nullable(),
})

/** A build by Railpack, its frontend, images and plan pinned (CO1; carried out from step 2, CO7). */
const RailpackBuilderSchema = z.strictObject({
  name: z.literal("railpack"),
  version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,6}$/),
  frontend: ImageRefSchema,
  /** Every image the plan names, sorted and each once. */
  images: z
    .array(ImageRefSchema)
    .min(1)
    .max(LIMITS.railpackImages)
    .refine(sortedAndUnique),
  plan: z.strictObject({
    /** `hash("zekno/v1/plan", the plan's bytes)`. */
    hash: hex64,
    size: z.number().int().min(1).max(LIMITS.planBytes),
    /** `hash("zekno/v1/pack-chunk", sealed plan)`: the plan travels as one piece. */
    piece: hex64,
  }),
})

/**
 * A build of an image on the server, from source zekno packed (CO1; FR-008,
 * FR-021, FR-021a, FR-024). Its keys in this order are its one spelling
 * (F41). Any break of a rule is `malformed`. The rules across fields, and
 * `fresh`'s upper bound, the deploy's `sequence`, are `buildsAreConsistent`'s
 * (CO2).
 */
export const BuildSchema = z
  .strictObject({
    /** The build key, `buildKey` of this build; it names the image in the Compose text. */
    key: hex64,
    pack: z
      .strictObject({
        /** `hash("zekno/v1/pack", the pack's bytes)`. */
        hash: hex64,
        size: z.number().int().min(1).max(LIMITS.packBytes),
        /** In order, `hash("zekno/v1/pack-chunk", sealed chunk)` of each chunk. */
        chunks: z.array(hex64).min(1).max(LIMITS.chunksPerDeploy),
      })
      .refine(
        (pack) =>
          pack.chunks.length === Math.ceil(pack.size / LIMITS.chunkBytes)
      ),
    builder: z.discriminatedUnion("name", [
      DockerfileBuilderSchema,
      RailpackBuilderSchema,
    ]),
    /** Plain build arguments, signed and readable by the hosted service, sorted and each once. */
    args: z
      .array(
        z.strictObject({
          name: secretName,
          value: z
            .string()
            .refine(
              (value) =>
                plainText(value) && bytesOf(value) <= LIMITS.argValueBytes
            ),
        })
      )
      .max(LIMITS.argsPerBuild)
      .refine((args) => sortedAndUnique(args.map((arg) => arg.name))),
    /** Names of the deploy's secrets the build may read, sorted and each once; never a credential name (FR-037b). */
    secrets: z
      .array(secretName.refine((name) => !isCredentialName(name)))
      .max(LIMITS.buildSecretsPerBuild)
      .refine(sortedAndUnique),
    /** `"none"`: no network for the build's `RUN` steps. */
    network: z.enum(["default", "none"]),
    timeout: z.number().int().min(1).max(LIMITS.buildSeconds),
    /** `null`, or the number of the deploy that asked for a fresh build of this base (FR-021a). */
    fresh: z.number().int().min(1).nullable(),
  })
  // CO6: never an argument the builder reads as its own, or, for Railpack, a credential.
  .refine((build) =>
    build.args.every((arg) => !isNeverGivenArg(arg.name, build.builder.name))
  )
export type Build = z.infer<typeof BuildSchema>

/** A secret the deploy lists: its name and the fingerprint of its sealed value, never the value. */
export type ListedSecret = { readonly name: string; readonly hash: string }

/** What a build key is made of: a build without its key, its sizes, its pieces and its time limit (CO4). */
export type BuildRecipe = {
  readonly pack: { readonly hash: string }
  readonly builder:
    | {
        readonly name: "dockerfile"
        readonly dockerfile: string
        readonly target: string | null
      }
    | {
        readonly name: "railpack"
        readonly version: string
        readonly frontend: string
        readonly images: readonly string[]
        readonly plan: { readonly hash: string }
      }
  readonly args: readonly { readonly name: string; readonly value: string }[]
  readonly secrets: readonly string[]
  readonly network: string
  readonly fresh: number | null
}

const isText = (value: unknown): value is string => typeof value === "string"

/** The recipe part of the key: what the builder is, and what it reads (CO4). */
function recipeOf(builder: BuildRecipe["builder"]): unknown[] | undefined {
  if (
    builder?.name === "dockerfile" &&
    isText(builder.dockerfile) &&
    (builder.target === null || isText(builder.target))
  )
    return ["dockerfile", builder.dockerfile, builder.target]
  if (
    builder?.name === "railpack" &&
    isText(builder.version) &&
    isText(builder.frontend) &&
    Array.isArray(builder.images) &&
    builder.images.every(isText) &&
    isText(builder.plan?.hash)
  )
    return [
      "railpack",
      builder.version,
      builder.frontend,
      [...builder.images],
      builder.plan.hash,
    ]
  return undefined
}

/**
 * The build key (CO4; FR-021a, FR-022, FR-037e): `hash("zekno/v1/build", …)`
 * in hex, of the UTF-8 of `JSON.stringify` of `[pack hash, recipe,
 * [[name, value]…], [[secret name, its listed hash]…], network, fresh]`,
 * where `recipe` is `["dockerfile", dockerfile, target]` or `["railpack",
 * version, frontend, images, plan hash]` and `fresh` is `null` or the number
 * as text. Only arrays, strings and null go in, so zekno and the runner make
 * the same bytes. Each build secret's hash is the one the deploy lists for it,
 * the fingerprint of its sealed value, so a build that read an old value is
 * not reused once the secret is set again. A build secret the listing does
 * not name throws. The sizes, the pieces and the time limit are signed and
 * not in the key.
 */
export function buildKey(
  build: BuildRecipe,
  listed: readonly ListedSecret[]
): string {
  const hashes = new Map(listed.map((secret) => [secret.name, secret.hash]))
  const recipe = recipeOf(build.builder)
  if (
    !isText(build.pack?.hash) ||
    recipe === undefined ||
    !Array.isArray(build.args) ||
    !build.args.every((arg) => isText(arg?.name) && isText(arg.value)) ||
    !Array.isArray(build.secrets) ||
    !build.secrets.every((name) => isText(name) && isText(hashes.get(name))) ||
    !isText(build.network) ||
    !(build.fresh === null || Number.isSafeInteger(build.fresh))
  ) {
    throw new CoreError(
      "invalid_argument",
      "A build key is made of text only, and of secrets the deploy lists."
    )
  }
  const bytes = utf8(
    JSON.stringify([
      build.pack.hash,
      recipe,
      build.args.map((arg) => [arg.name, arg.value]),
      build.secrets.map((name) => [name, hashes.get(name)!]),
      build.network,
      build.fresh === null ? null : String(build.fresh),
    ])
  )
  return toHex(hash("zekno/v1/build", bytes))
}

/**
 * The base key (CO4; FR-021a, FR-037e): the key of the same build with
 * `fresh` null. A fresh build and the builds before it share it, so the
 * runner can say which base a fresh build replaced. A secret set again
 * changes it, as it changes the key.
 */
export function baseKey(
  build: BuildRecipe,
  listed: readonly ListedSecret[]
): string {
  return buildKey({ ...build, fresh: null }, listed)
}

/** A character that goes on a reference: after a built image's name, it would make the name another (CO2). */
const GOES_ON = /^[\p{L}\p{N}_.\-:@/]/u
/** The same, as the last character before a name: `ghcr.io/zekno.invalid/…` is an image of ghcr.io (CO2). */
const GOES_BEFORE = /[\p{L}\p{N}_.\-:@/]$/u

/**
 * True when the Compose text runs each build's image and names no other
 * under `zekno.invalid` (CO2; FR-022, FR-077): it holds
 * `builtImageName(app, key)` for each key, and every `zekno.invalid/` in it,
 * found without regard to case, is exactly one of those names, after the
 * start of the text or a character that cannot go on a reference, and
 * followed by the end of the text or such a character. A lexical check that
 * holds zekno's own text to its form, not a boundary: no registry answers
 * for `zekno.invalid`, and the runner never pulls.
 */
function composeRunsBuilds(
  compose: string,
  app: string,
  keys: readonly string[]
): boolean {
  const names = new Set(keys.map((key) => builtImageName(app, key)))
  const held = new Set<string>()
  // Without the `u` flag, `i` folds ASCII letters only, as a reference is ASCII.
  for (const found of compose.matchAll(/zekno\.invalid\//gi)) {
    const at = found.index
    const name = [...names].find((one) => compose.startsWith(one, at))
    if (name === undefined) return false
    // The character before and the one after only: two code units hold any one character.
    if (GOES_BEFORE.test(compose.slice(Math.max(0, at - 2), at))) return false
    const end = at + name.length
    if (GOES_ON.test(compose.slice(end, end + 2))) return false
    held.add(name)
  }
  return held.size === names.size
}

/**
 * The builds' rules that look across fields (F6, CO2; FR-012, FR-022,
 * FR-023, FR-036e, FR-077, item 15): builds sorted by key, each key once;
 * each build secret in the deploy's `secrets`; no build argument named like a
 * secret the deploy lists; at most 64 distinct code pieces across the deploy,
 * and no plan piece that is also a code piece; the byte total of build
 * arguments; `fresh` at most the deploy's `sequence`; each key equal to this
 * library's own computation; and a Compose text that runs each build's
 * image and names no other under `zekno.invalid`. A deploy with builds for an
 * app whose name ends with `-` is refused (item 15).
 */
export function buildsAreConsistent(deploy: {
  readonly app: string
  readonly sequence: number
  readonly compose: string
  readonly secrets: readonly ListedSecret[]
  readonly builds: readonly Build[]
}): boolean {
  const { builds } = deploy
  if (builds.length > 0 && deploy.app.endsWith("-")) return false
  if (!sortedAndUnique(builds.map((build) => build.key))) return false
  const listed = new Set(deploy.secrets.map((secret) => secret.name))
  const chunks = new Set<string>()
  const plans: string[] = []
  let argBytes = 0
  for (const build of builds) {
    if (
      !build.secrets.every((name) => listed.has(name)) ||
      build.args.some((arg) => listed.has(arg.name)) ||
      (build.fresh !== null && build.fresh > deploy.sequence)
    )
      return false
    for (const chunk of build.pack.chunks) chunks.add(chunk)
    if (build.builder.name === "railpack") plans.push(build.builder.plan.piece)
    for (const arg of build.args) argBytes += bytesOf(arg.value)
    if (build.key !== buildKey(build, deploy.secrets)) return false
  }
  return (
    chunks.size <= LIMITS.chunksPerDeploy &&
    !plans.some((piece) => chunks.has(piece)) &&
    argBytes <= LIMITS.argBytesPerDeploy &&
    composeRunsBuilds(
      deploy.compose,
      deploy.app,
      builds.map((build) => build.key)
    )
  )
}
