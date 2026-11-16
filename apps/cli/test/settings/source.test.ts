/**
 * Which file a deploy uses, and reading it once (specs/010-app-settings,
 * contracts/deploy.md, "Which file a deploy uses"; tasks T024): every row of
 * the rule, in temporary folders with a stand-in project link.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { CliError } from "../../src/cli/errors"
import { readCompose } from "../../src/project/compose-read"
import type { ProjectLink } from "../../src/project/file"
import { composeText } from "../../src/settings/compose"
import { chooseSource, readSource } from "../../src/settings/source"
import type { DeploySource } from "../../src/settings/types"
import { COMPOSE_V1 } from "../support/helpers"
import {
  DESIGN_COMPOSE,
  DESIGN_FILE,
  DESIGN_SETTINGS,
} from "../support/settings-files"

/** A folder holding the files named. */
function folderWith(files: Record<string, string>): string {
  const folder = tempDir("settings-source")
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(folder, name, ".."), { recursive: true })
    writeFileSync(join(folder, name), text)
  }
  return folder
}

/** A zekno.json, signed and in use, naming `compose` in `folder`. */
const linkNaming = (folder: string, compose: string): ProjectLink => ({
  app: "demo",
  server: "dev",
  compose,
  folder: realpathSync(folder),
  path: join(realpathSync(folder), "zekno.json"),
  sha256: "",
})

const BOTH = { "zekno.app.json": DESIGN_FILE, "compose.yaml": COMPOSE_V1 }

describe("chooseSource: the first rule that applies decides", () => {
  test("1. -f, either kind, whatever the folder holds", () => {
    const folder = folderWith(BOTH)
    const given = (
      file: string,
      kind: "compose" | "settings"
    ): DeploySource => ({
      kind,
      source: { kind: "given", path: join(folder, file) },
    })
    expect(chooseSource(folder, { file: "zekno.app.json" })).toEqual(
      given("zekno.app.json", "settings")
    )
    expect(chooseSource(folder, { file: "sub/zekno.app.json" })).toEqual(
      given("sub/zekno.app.json", "settings")
    )
    expect(chooseSource(folder, { file: "other.yaml" })).toEqual(
      given("other.yaml", "compose")
    )
    expect(chooseSource(folder, { file: "compose.yaml" })).toEqual(
      given("compose.yaml", "compose")
    )
    expect(chooseSource(folder, { file: "/abs/zekno.app.json" })).toEqual({
      kind: "settings",
      source: { kind: "given", path: "/abs/zekno.app.json" },
    })
    expect(chooseSource(folder, { file: "zekno.app.json.bak" }).kind).toBe(
      "compose"
    )
    // -f wins over a link too.
    expect(
      chooseSource(folder, {
        file: "compose.yaml",
        project: linkNaming(folder, "zekno.app.json"),
      }).kind
    ).toBe("compose")
  })

  test("2. the file the link names, by its name", () => {
    const folder = folderWith(BOTH)
    for (const compose of ["zekno.app.json", "deploy/zekno.app.json"]) {
      const link = linkNaming(folder, compose)
      expect(chooseSource(folder, { project: link })).toEqual({
        kind: "settings",
        source: { kind: "project", link },
      })
    }
    const link = linkNaming(folder, "compose.yaml")
    expect(chooseSource(folder, { project: link })).toEqual({
      kind: "compose",
      source: { kind: "project", link },
    })
  })

  test("3. the one that exists", () => {
    const onlyCompose = folderWith({ "compose.yaml": COMPOSE_V1 })
    expect(chooseSource(onlyCompose, {})).toEqual({
      kind: "compose",
      source: { kind: "default", folder: onlyCompose },
    })
    const onlySettings = folderWith({ "zekno.app.json": DESIGN_FILE })
    expect(chooseSource(onlySettings, {})).toEqual({
      kind: "settings",
      source: { kind: "default", folder: onlySettings },
    })
  })

  test("4. both, and nothing above: both, never a silent pick", () => {
    const folder = folderWith(BOTH)
    expect(chooseSource(folder, {})).toEqual({ kind: "both", folder })
  })

  test("neither: the Compose file, so today's sentence comes out of readCompose", () => {
    const folder = folderWith({})
    const source = chooseSource(folder, {})
    expect(source).toEqual({
      kind: "compose",
      source: { kind: "default", folder },
    })
    expect(() =>
      readSource(source as DeploySource & { kind: "compose" }, folder)
    ).toThrow(
      `No Compose file at ${join(folder, "compose.yaml")}. Point to one with \`-f <file>\`.`
    )
  })

  test("a link is not followed to decide whether a file is there: a link to nowhere, a link out of the folder and a folder of that name all count, so neither name vanishes and lets the other win", () => {
    const outside = folderWith({ "compose.yaml": COMPOSE_V1 })
    const settingsOutside = folderWith({ "zekno.app.json": DESIGN_FILE })
    const cases: [string, (folder: string) => void][] = [
      [
        "compose.yaml a link to nowhere",
        (folder) =>
          symlinkSync(join(folder, "gone.yaml"), join(folder, "compose.yaml")),
      ],
      [
        "compose.yaml a link out of the folder",
        (folder) =>
          symlinkSync(
            join(outside, "compose.yaml"),
            join(folder, "compose.yaml")
          ),
      ],
      [
        "compose.yaml a folder",
        (folder) => mkdirSync(join(folder, "compose.yaml")),
      ],
    ]
    for (const [name, make] of cases) {
      const folder = folderWith({ "zekno.app.json": DESIGN_FILE })
      make(folder)
      expect({ name, source: chooseSource(folder, {}) }).toEqual({
        name,
        source: { kind: "both", folder },
      })
    }
    const mirrored: [string, (folder: string) => void][] = [
      [
        "zekno.app.json a link to nowhere",
        (folder) =>
          symlinkSync(
            join(folder, "gone.json"),
            join(folder, "zekno.app.json")
          ),
      ],
      [
        "zekno.app.json a link out of the folder",
        (folder) =>
          symlinkSync(
            join(settingsOutside, "zekno.app.json"),
            join(folder, "zekno.app.json")
          ),
      ],
      [
        "zekno.app.json a folder",
        (folder) => mkdirSync(join(folder, "zekno.app.json")),
      ],
    ]
    for (const [name, make] of mirrored) {
      const folder = folderWith({ "compose.yaml": COMPOSE_V1 })
      make(folder)
      expect({ name, source: chooseSource(folder, {}) }).toEqual({
        name,
        source: { kind: "both", folder },
      })
    }
  })

  test("alone, such a name is the one chosen, and its reader says what is wrong with it: nothing is read through it", () => {
    const read = (folder: string) => {
      const source = chooseSource(folder, {})
      if (source.kind === "both") throw new Error("both")
      try {
        readSource(source, folder)
        return "read"
      } catch (error) {
        return `${source.kind}: ${(error as Error).message}`
      }
    }
    const outside = folderWith({ "zekno.app.json": DESIGN_FILE })

    const danglingCompose = folderWith({})
    symlinkSync(
      join(danglingCompose, "gone.yaml"),
      join(danglingCompose, "compose.yaml")
    )
    expect(read(danglingCompose)).toBe(
      `compose: No Compose file at ${join(danglingCompose, "compose.yaml")}. Point to one with \`-f <file>\`.`
    )

    const danglingSettings = folderWith({})
    symlinkSync(
      join(danglingSettings, "gone.json"),
      join(danglingSettings, "zekno.app.json")
    )
    expect(read(danglingSettings)).toBe(
      "settings: No settings file at zekno.app.json."
    )

    const leading = folderWith({})
    symlinkSync(
      join(outside, "zekno.app.json"),
      join(leading, "zekno.app.json")
    )
    expect(read(leading)).toBe(
      "settings: zekno.app.json leads outside the folder that holds it. zekno does not follow it there."
    )

    const folderNamed = folderWith({})
    mkdirSync(join(folderNamed, "zekno.app.json"))
    expect(read(folderNamed)).toBe("settings: zekno.app.json is not a file.")
  })

  test("a settings file elsewhere in the folder tree does not count: only this folder's", () => {
    const folder = folderWith({
      "compose.yaml": COMPOSE_V1,
      "sub/zekno.app.json": DESIGN_FILE,
    })
    expect(chooseSource(folder, {}).kind).toBe("compose")
  })
})

describe("readSource: the chosen file, read once", () => {
  test("a Compose file gives the same text as readCompose", () => {
    const folder = folderWith(BOTH)
    const source = { kind: "default", folder } as const
    expect(readSource({ kind: "compose", source }, folder)).toEqual(
      readCompose(source)
    )
    expect(
      readSource({ kind: "compose", source }, folder).settings
    ).toBeUndefined()
  })

  test("a settings file gives its Compose text, its path and its services", () => {
    const folder = folderWith(BOTH)
    const read = readSource(
      { kind: "settings", source: { kind: "default", folder } },
      folder
    )
    expect(read).toEqual({
      text: DESIGN_COMPOSE,
      path: realpathSync(join(folder, "zekno.app.json")),
      settings: {
        services: ["web", "worker"],
        // The bytes read, so the app's d can tell them from what its screen showed.
        sha256: new Bun.CryptoHasher("sha256")
          .update(DESIGN_FILE)
          .digest("hex"),
      },
    })
    expect(read.text).toBe(composeText(DESIGN_SETTINGS))
  })

  test("the file a link names, and one named with -f", () => {
    const folder = folderWith({ "deploy/zekno.app.json": DESIGN_FILE })
    const link = linkNaming(folder, "deploy/zekno.app.json")
    expect(
      readSource(
        { kind: "settings", source: { kind: "project", link } },
        folder
      ).text
    ).toBe(DESIGN_COMPOSE)
    const path = join(folder, "deploy/zekno.app.json")
    expect(
      readSource({ kind: "settings", source: { kind: "given", path } }, folder)
        .text
    ).toBe(DESIGN_COMPOSE)
  })

  test("a fault of the settings file is its CliError", () => {
    const folder = folderWith({
      "zekno.app.json": DESIGN_FILE.replace('"1g"', '"lots"'),
    })
    expect(() =>
      readSource(
        { kind: "settings", source: { kind: "default", folder } },
        folder
      )
    ).toThrow(
      new CliError(
        "zekno.app.json could not be read as settings. web, deploy.memory: use a size such as 512m or 1g."
      )
    )
  })
})
