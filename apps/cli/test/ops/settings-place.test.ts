/**
 * Where a deploy in this folder would take its file from, as an answer
 * rather than an error (specs/012-templates, research R8; tasks T019):
 * `findPlace` in each folder of test/support/settings-places.ts (the three
 * folders of feature 010's security review, finding S1) and in the plain
 * folders, SH4 and the reader's faults still thrown. `readPlaced`, built on
 * it, keeps every sentence of the settings commands (test/ops/settings.test.ts).
 * The keychain and every connection throw, so that reading them fails the test.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { OpDeps } from "../../src/cli/context"
import { findPlace } from "../../src/ops/settings"
import { SH4 } from "../../src/settings/words"
import { COMPOSE_V1, machine, ready, twin } from "../support/helpers"
import {
  DESIGN_FILE,
  DESIGN_SETTINGS,
  SENTINEL,
} from "../support/settings-files"
import {
  HIDDEN,
  linkedCompose,
  linkedElsewhere,
  ROOT,
  runs,
  subFolder,
  VISIBLE,
} from "../support/settings-places"

/** A keychain, a connection and a fetch that fail whatever touches them. */
function untouched(deps: OpDeps): OpDeps {
  const no = (what: string) => () => {
    throw new Error(what)
  }
  return {
    ...deps,
    keyStore: {
      get: no("the keychain was read"),
      set: no("the keychain was written"),
      delete: no("the keychain was written"),
    },
    connect: no("a connection was made"),
    fetch: no("the network was used"),
  }
}

/** A ready machine whose folder holds only `files`. */
async function folderWith(files: Record<string, string>) {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(m.project, name), text)
  return m
}

describe("findPlace: the file a deploy here would use, as an answer (specs/012-templates, research R8; tasks T019)", () => {
  test("A: in a folder below the zekno.json in use, the settings file it names, read; this folder's own left aside", async () => {
    const { m, signedFile } = await subFolder()
    const found = findPlace(untouched(m.deps))
    if (found.kind !== "settings") throw new Error(found.kind)
    expect(found.read.path).toBe(signedFile)
    expect(found.read.settings).toEqual(runs(ROOT))
    expect(found.place.source.kind).toBe("project")
    expect(found.place.both).toBe(false)
  }, 60_000)

  test("B: the zekno.json in use names compose.yaml while zekno.app.json lies here: the Compose file, its link, and settingsHere", async () => {
    const { m } = await linkedCompose()
    const found = findPlace(untouched(m.deps))
    if (found.kind !== "compose") throw new Error(found.kind)
    expect([found.file, found.settingsHere]).toEqual(["compose.yaml", true])
    expect(found.link?.compose).toBe("compose.yaml")
    expect(found.link?.app).toBe("demo")
  }, 60_000)

  test("C: the zekno.json in use names deploy/zekno.app.json: that file, read; this folder's own left aside", async () => {
    const { m, signedFile } = await linkedElsewhere()
    const found = findPlace(untouched(m.deps))
    if (found.kind !== "settings") throw new Error(found.kind)
    expect(realpathSync(found.read.path)).toBe(realpathSync(signedFile))
    expect(found.read.settings).toEqual(runs(HIDDEN))
    expect(found.read.settings).not.toEqual(runs(VISIBLE))
    expect(found.read.shown).toBe("deploy/zekno.app.json")
  }, 60_000)

  test("a folder with neither file, with compose.yaml only, with zekno.app.json only, and with both", () => {
    const bare = machine()
    expect(findPlace(untouched(bare.deps))).toEqual({ kind: "none" })

    const compose = machine()
    writeFileSync(join(compose.project, "compose.yaml"), COMPOSE_V1)
    expect(findPlace(untouched(compose.deps))).toEqual({
      kind: "compose",
      file: "compose.yaml",
      settingsHere: false,
    })

    const settings = machine()
    writeFileSync(join(settings.project, "zekno.app.json"), DESIGN_FILE)
    const one = findPlace(untouched(settings.deps))
    if (one.kind !== "settings") throw new Error(one.kind)
    expect([one.read.settings, one.place.both]).toEqual([
      DESIGN_SETTINGS,
      false,
    ])

    writeFileSync(join(settings.project, "compose.yaml"), COMPOSE_V1)
    const both = findPlace(untouched(settings.deps))
    if (both.kind !== "settings") throw new Error(both.kind)
    expect(both.place.both).toBe(true)
  })

  test("a fault of the settings file is the reader's sentence, thrown, with nothing of the file", () => {
    const m = machine()
    writeFileSync(
      join(m.project, "zekno.app.json"),
      DESIGN_FILE.replace('"1g"', `"${SENTINEL}"`)
    )
    expect(() => findPlace(untouched(m.deps))).toThrow(
      "zekno.app.json could not be read as settings. web, deploy.memory: use a size such as 512m or 1g."
    )
  })

  test("SH4: a zekno.json signed and not in use here yet that names another file than this folder's", async () => {
    const m = await folderWith({})
    mkdirSync(join(m.project, "deploy"))
    writeFileSync(join(m.project, "deploy", "zekno.app.json"), DESIGN_FILE)
    expect(
      await m.zekno(
        "link",
        "--app",
        "demo",
        "--server",
        "dev",
        "-f",
        "deploy/zekno.app.json"
      )
    ).toBe(0)
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    const other = await twin(m)
    other.deps.cwd = m.project
    expect(() => findPlace(untouched(other.deps))).toThrow(
      SH4("deploy/zekno.app.json")
    )
  }, 60_000)
})
