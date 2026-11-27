/**
 * The limits of building from source (specs/016-build-from-source,
 * contracts/core.md CO16; T026): every new limit pinned at its value, the
 * limits of feature 014 it keeps unchanged, and the sums the contract builds
 * on. `diskFloorBytes` is the value check L7 confirms; a change of it lands in
 * `protocol/limits.ts` and here, nowhere else.
 */
import { describe, expect, test } from "bun:test"

import { LIMITS } from "../../src/index"

const KiB = 1024
const MiB = 1024 * KiB
const GiB = 1024 * MiB

/** Reads a limit by name, so a missing one reads `undefined`, not a type error. */
const limit = (name: string): unknown =>
  (LIMITS as Readonly<Record<string, unknown>>)[name]

/** Every new limit of CO16, its value and the rule that names it. */
const NEW_LIMITS: readonly (readonly [string, number, string])[] = [
  ["packEntries", 50_000, "FR-016"],
  ["sealedPieceBytes", 8 * MiB + 64 * KiB, "FR-029a"],
  ["planBytes", 256 * KiB, "CO1"],
  ["railpackImages", 8, "CO1"],
  ["missingPieces", 72, "CO10"],
  ["stagingBytes", 2 * GiB, "FR-028"],
  ["stagingSeconds", 86_400, "FR-028"],
  ["keptDeploysPerApp", 3, "CO13"],
  ["keptImagesPerApp", 24, "CO13"],
  ["freshPerApp", 24, "CO13"],
  ["baseDigestsPerBuild", 16, "CO14"],
  ["buildCacheBytes", 10 * GiB, "FR-068"],
  ["diskFloorBytes", 2 * GiB, "FR-040"],
  ["buildDefaultSeconds", 1800, "FR-010"],
  ["buildLineCharacters", 4096, "CO11"],
  ["buildStepCharacters", 1024, "CO11"],
  ["buildsAppsPerRequest", 8, "CO12"],
]

/** The limits of feature 014 on builds, pieces, arguments and secrets. */
const KEPT_LIMITS: readonly (readonly [string, number])[] = [
  ["buildsPerDeploy", 8],
  ["packBytes", 512 * MiB],
  ["chunkBytes", 8 * MiB],
  ["chunksPerDeploy", 64],
  ["argsPerBuild", 32],
  ["argValueBytes", 4 * KiB],
  ["argBytesPerDeploy", 64 * KiB],
  ["buildSecretsPerBuild", 32],
  ["dockerfileLength", 255],
  ["buildSeconds", 7200],
  ["secretsPerDeploy", 256],
  ["secretValueBytes", 64 * KiB],
  ["secretNameLength", 128],
  ["secretsPerServer", 8192],
]

describe("the new limits of CO16", () => {
  for (const [name, value, rule] of NEW_LIMITS)
    test(`${name} is ${value} (${rule})`, () => {
      expect([name, limit(name)]).toEqual([name, value])
    })

  test("no packPathBytes: splitsAsUstar takes the place of path limits", () => {
    expect("packPathBytes" in LIMITS).toBe(false)
  })
})

describe("the limits of 014 stay as they were", () => {
  for (const [name, value] of KEPT_LIMITS)
    test(`${name} is still ${value}`, () => {
      expect([name, limit(name)]).toEqual([name, value])
    })
})

describe("the sums CO16 builds on", () => {
  test("missingPieces is every chunk of a deploy and one plan per build (CO10)", () => {
    expect<number>(LIMITS.missingPieces).toBe(
      LIMITS.chunksPerDeploy + LIMITS.buildsPerDeploy
    )
  })

  test("the images kept are those of the deploys kept, 8 builds each (CO13)", () => {
    expect<number>(LIMITS.keptImagesPerApp).toBe(
      LIMITS.keptDeploysPerApp * LIMITS.buildsPerDeploy
    )
  })

  test("the default time limit of a build is within its signed bound (FR-010)", () => {
    expect(LIMITS.buildDefaultSeconds).toBeGreaterThanOrEqual(1)
    expect(LIMITS.buildDefaultSeconds).toBeLessThanOrEqual(LIMITS.buildSeconds)
  })

  test("a sealed piece has room for one whole chunk (FR-029a)", () => {
    expect(LIMITS.sealedPieceBytes).toBeGreaterThan(LIMITS.chunkBytes)
  })
})
