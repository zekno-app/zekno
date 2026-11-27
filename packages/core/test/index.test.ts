/**
 * The public names of building from source (specs/016-build-from-source,
 * tasks.md T056): every value and type of step 1 is exported from the
 * library's one entry point, each from the file that holds it, so zekno and
 * the runner import nothing from inside the library. And every module of the
 * library loads when it is the first one imported: no import cycle reads a
 * value before the module that makes it has run.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { join } from "node:path"

import * as core from "../src/index"
import type {
  AppBuilds,
  AppBuildsAnswer,
  Arch,
  Build,
  BuildErrorEvent,
  BuildEvent,
  BuildLineEvent,
  BuildReason,
  BuildRecord,
  Building,
  ImageRef,
  PackItem,
  RunnerBuilder,
  RunnerBuilderRequest,
  RunnerBuilds,
  RunnerBuildsRequest,
  RunnerPack,
  RunnerPackRequest,
} from "../src/index"
import * as hashFile from "../src/crypto/hash"
import * as buildNamesFile from "../src/deploy/build-names"
import * as buildRecordFile from "../src/deploy/build-record"
import * as buildsFile from "../src/deploy/builds"
import * as carriedOutFile from "../src/deploy/carried-out"
import * as gateFile from "../src/deploy/gate"
import * as keptBuildsFile from "../src/deploy/kept-builds"
import type * as stateFile from "../src/deploy/state"
import * as checkFile from "../src/pack/check"
import * as piecesFile from "../src/pack/pieces"
import * as tarFile from "../src/pack/tar"
import * as buildMessagesFile from "../src/protocol/build-messages"
import * as sessionFile from "../src/protocol/session"

/** Each file of step 1, and the values the entry point takes from it. */
const VALUES: readonly [string, Record<string, unknown>, readonly string[]][] =
  [
    [
      "deploy/builds.ts",
      buildsFile,
      [
        "buildKey",
        "baseKey",
        "builtImageName",
        "isImageRef",
        "ImageRefSchema",
        "namesReservedRegistry",
      ],
    ],
    [
      "deploy/build-names.ts",
      buildNamesFile,
      ["isNeverGivenArg", "isCredentialName", "SYNTAX_LINE", "isSyntaxLine"],
    ],
    ["deploy/carried-out.ts", carriedOutFile, ["CARRIED_OUT"]],
    ["deploy/gate.ts", gateFile, ["admitPiece", "stillAllowed"]],
    [
      "deploy/kept-builds.ts",
      keptBuildsFile,
      [
        "keepAfter",
        "withDropped",
        "withFresh",
        "withAppBuilds",
        "withBuilding",
      ],
    ],
    [
      "deploy/build-record.ts",
      buildRecordFile,
      [
        "BuildRecordSchema",
        "readBuildRecord",
        "BUILD_REASONS",
        "ARCHES",
        "DIGEST",
        "DOCKER_VERSION",
      ],
    ],
    ["crypto/hash.ts", hashFile, ["hashStream"]],
    [
      "pack/tar.ts",
      tarFile,
      [
        "compareNames",
        "isPackName",
        "splitsAsUstar",
        "header",
        "paddingFor",
        "TAR_END",
        "PACK_TIME",
        "createTarWriter",
      ],
    ],
    ["pack/check.ts", checkFile, ["createPackChecker"]],
    [
      "pack/pieces.ts",
      piecesFile,
      [
        "pieceLength",
        "cutPieces",
        "sealPiece",
        "pieceFingerprint",
        "openPiece",
      ],
    ],
    [
      "protocol/build-messages.ts",
      buildMessagesFile,
      [
        "BuildEventSchema",
        "BuildLineEventSchema",
        "BuildErrorEventSchema",
        "RunnerPackRequestSchema",
        "RunnerBuildsRequestSchema",
        "AppBuildsAnswerSchema",
        "RunnerBuildsSchema",
        "RunnerBuilderRequestSchema",
        "RunnerBuilderSchema",
      ],
    ],
    ["protocol/session.ts", sessionFile, ["RunnerPackSchema"]],
  ]

const exported = core as Record<string, unknown>

/** True when A and B are the same type, each assignable to the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

describe("the public names of feature 016, step 1", () => {
  test("every value is exported from the library's one entry point", () => {
    for (const [, , names] of VALUES)
      for (const name of names)
        expect([name, typeof exported[name]]).not.toEqual([name, "undefined"])
  })

  test("each value is the one its own file holds", () => {
    for (const [file, module, names] of VALUES)
      for (const name of names)
        expect([file, name, exported[name] === module[name]]).toEqual([
          file,
          name,
          true,
        ])
  })

  test("withTime is exported only if check L4b added it", () => {
    // Item 14 (A): the runner restamps times only if L4b shows BuildKit needs it.
    expect("withTime" in core).toBe("withTime" in tarFile)
  })

  test("every type is exported too, each the one its own file holds", () => {
    // Checked by the type checker: each name must resolve, and each must be
    // the type its own file declares.
    type Exported = [
      Same<Build, buildsFile.Build>,
      Same<ImageRef, buildsFile.ImageRef>,
      Same<AppBuilds, stateFile.AppBuilds>,
      Same<Building, stateFile.Building>,
      Same<BuildRecord, buildRecordFile.BuildRecord>,
      Same<BuildReason, buildRecordFile.BuildReason>,
      Same<Arch, buildRecordFile.Arch>,
      Same<PackItem, checkFile.PackItem>,
      Same<BuildEvent, buildMessagesFile.BuildEvent>,
      Same<BuildLineEvent, buildMessagesFile.BuildLineEvent>,
      Same<BuildErrorEvent, buildMessagesFile.BuildErrorEvent>,
      Same<RunnerPackRequest, buildMessagesFile.RunnerPackRequest>,
      Same<RunnerPack, sessionFile.RunnerPack>,
      Same<RunnerBuildsRequest, buildMessagesFile.RunnerBuildsRequest>,
      Same<AppBuildsAnswer, buildMessagesFile.AppBuildsAnswer>,
      Same<RunnerBuilds, buildMessagesFile.RunnerBuilds>,
      Same<RunnerBuilderRequest, buildMessagesFile.RunnerBuilderRequest>,
      Same<RunnerBuilder, buildMessagesFile.RunnerBuilder>,
    ]
    const same: Exported = [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]
    expect(same.length).toBe(18)
    expect(same.every(Boolean)).toBe(true)
  })

  test("an image reference is text, as CO1 writes it", () => {
    const text: Same<ImageRef, string> = true
    expect(text).toBe(true)
  })
})

/** Every module of the library, by its path under `src`. */
const SRC = join(import.meta.dir, "..", "src")
const MODULES = readdirSync(SRC, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".ts"))
  .sort()

describe("each module loads when it is the first one imported", () => {
  test("no import cycle reads a value before it is made", async () => {
    // A fresh bun for each module, so no other module has loaded first.
    const codes = await Promise.all(
      MODULES.map(async (path) => {
        const child = Bun.spawn(
          [
            process.execPath,
            "--no-env-file",
            "-e",
            `await import(${JSON.stringify(join(SRC, path))})`,
          ],
          { stdout: "ignore", stderr: "ignore" }
        )
        return [path, await child.exited] as const
      })
    )
    expect(MODULES.length).toBeGreaterThan(30)
    expect(codes.filter(([, code]) => code !== 0)).toEqual([])
  }, 60_000)
})
