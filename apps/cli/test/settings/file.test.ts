/**
 * Reading a settings file from the disk (specs/010-app-settings,
 * contracts/settings-file.md, "Reading the file"; tasks T012): the
 * descriptor checks a Compose file has, the size, strict UTF-8, links and
 * pipes, and every file of the test set read from a real file. Each runs in
 * a temporary folder; nothing outside it is touched.
 */
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  chmodSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { CliError } from "../../src/cli/errors"
import type { ProjectLink } from "../../src/project/file"
import {
  isSettingsFile,
  readSettingsFile,
  SETTINGS_BYTES,
  SETTINGS_FILE,
} from "../../src/settings/file"
import {
  DESIGN_FILE,
  DESIGN_SETTINGS,
  FILES,
  SENTINEL,
} from "../support/settings-files"

/** A folder holding `zekno.app.json` with `content`. */
function folderWith(content: string | Uint8Array = DESIGN_FILE): string {
  const folder = tempDir("settings-file")
  writeFileSync(join(folder, SETTINGS_FILE), content)
  return folder
}

/** The error reading throws, which must be a `CliError` holding no sentinel. */
function refused(read: () => unknown): string {
  try {
    read()
  } catch (error) {
    expect(error).toBeInstanceOf(CliError)
    const { message, stack } = error as Error
    expect(message).not.toContain(SENTINEL)
    expect(stack ?? "").not.toContain(SENTINEL)
    return message
  }
  throw new Error("expected the read to be refused")
}

/** A zekno.json as `findProject` would give it, naming `compose` in `folder`. */
const linkIn = (folder: string, compose = SETTINGS_FILE): ProjectLink => ({
  app: "demo",
  server: "dev",
  compose,
  folder: realpathSync(folder),
  path: join(realpathSync(folder), "zekno.json"),
  sha256: "",
})

describe("what a read gives", () => {
  test("design.md's file in this folder: the settings, the SHA-256 of its bytes, its device, inode and mode", () => {
    const folder = folderWith()
    chmodSync(join(folder, SETTINGS_FILE), 0o640)
    const read = readSettingsFile({ kind: "default", folder }, folder)
    const stat = statSync(join(folder, SETTINGS_FILE))
    expect(read).toEqual({
      path: realpathSync(join(folder, SETTINGS_FILE)),
      shown: "zekno.app.json",
      sha256: createHash("sha256").update(DESIGN_FILE).digest("hex"),
      bytes: Buffer.from(DESIGN_FILE),
      dev: stat.dev,
      ino: stat.ino,
      mode: stat.mode,
      settings: DESIGN_SETTINGS,
    })
    expect(read.mode & 0o777).toBe(0o640)
  })

  test("the bytes read, kept so a run that wrote the file can put it back exactly (specs/012-templates, research R7)", () => {
    const folder = folderWith(`\ufeff${DESIGN_FILE.replace(/\n/g, "\r\n")}`)
    const read = readSettingsFile({ kind: "default", folder }, folder)
    const onDisk = readFileSync(join(folder, SETTINGS_FILE))
    const { bytes } = read
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(bytes).equals(onDisk)).toBe(true)
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(read.sha256)
  })

  test("the file a zekno.json names, inside its folder, also in a folder below", () => {
    const folder = tempDir("settings-file")
    mkdirSync(join(folder, "deploy"))
    writeFileSync(join(folder, "deploy", SETTINGS_FILE), DESIGN_FILE)
    const read = readSettingsFile(
      { kind: "project", link: linkIn(folder, "deploy/zekno.app.json") },
      folder
    )
    expect(read.settings).toEqual(DESIGN_SETTINGS)
    expect(read.shown).toBe("deploy/zekno.app.json")
  })

  test("with -f, a link to a file elsewhere is followed", () => {
    const elsewhere = folderWith()
    const folder = tempDir("settings-file")
    symlinkSync(join(elsewhere, SETTINGS_FILE), join(folder, SETTINGS_FILE))
    const path = join(folder, SETTINGS_FILE)
    const read = readSettingsFile({ kind: "given", path }, folder)
    expect(read.settings).toEqual(DESIGN_SETTINGS)
    expect(read.path).toBe(path)
  })

  test("one byte order mark is dropped; a second is not JSON", () => {
    const twice = folderWith(`\ufeff\ufeff${DESIGN_FILE}`)
    expect(
      refused(() => readSettingsFile({ kind: "default", folder: twice }, twice))
    ).toBe(
      "zekno.app.json could not be read as settings. line 1: this is not JSON."
    )
    const folder = folderWith(`\ufeff${DESIGN_FILE}`)
    expect(
      readSettingsFile({ kind: "default", folder }, folder).settings
    ).toEqual(DESIGN_SETTINGS)
  })
})

describe("SR1 to SR9", () => {
  test("SR1: a file named by -f that is not there", () => {
    const folder = tempDir("settings-file")
    expect(
      refused(() =>
        readSettingsFile(
          { kind: "given", path: join(folder, "zekno.app.json") },
          folder
        )
      )
    ).toBe("No settings file at zekno.app.json.")
  })

  test("SR1: the file a zekno.json names is not there", () => {
    const folder = tempDir("settings-file")
    const message = refused(() =>
      readSettingsFile({ kind: "project", link: linkIn(folder) }, folder)
    )
    expect(message).toMatch(
      /^.+\/zekno\.json names zekno\.app\.json, and there is no such file in .+\.$/
    )
  })

  test("SR2: a folder", () => {
    const folder = tempDir("settings-file")
    mkdirSync(join(folder, SETTINGS_FILE))
    expect(
      refused(() => readSettingsFile({ kind: "default", folder }, folder))
    ).toBe("zekno.app.json is not a file.")
    expect(
      refused(() =>
        readSettingsFile(
          { kind: "given", path: join(folder, SETTINGS_FILE) },
          folder
        )
      )
    ).toBe("zekno.app.json is not a file.")
  })

  test("SR2: a named pipe, at once, never waited on", () => {
    const folder = tempDir("settings-file")
    const path = join(folder, SETTINGS_FILE)
    expect(Bun.spawnSync(["mkfifo", path]).exitCode).toBe(0)
    const started = performance.now()
    expect(
      refused(() => readSettingsFile({ kind: "default", folder }, folder))
    ).toBe("zekno.app.json is not a file.")
    expect(
      refused(() => readSettingsFile({ kind: "given", path }, folder))
    ).toBe("zekno.app.json is not a file.")
    expect(performance.now() - started).toBeLessThan(2000)
  })

  test("SR3: a sparse file of 65,537 bytes, by its size; and 65,536 bytes is read", () => {
    const folder = folderWith("")
    truncateSync(join(folder, SETTINGS_FILE), SETTINGS_BYTES + 1)
    expect(
      refused(() => readSettingsFile({ kind: "default", folder }, folder))
    ).toBe("zekno.app.json is larger than the 64 KiB a settings file may be.")
    const fits = folderWith(
      DESIGN_FILE + " ".repeat(SETTINGS_BYTES - Buffer.byteLength(DESIGN_FILE))
    )
    expect(
      readSettingsFile({ kind: "default", folder: fits }, fits).settings
    ).toEqual(DESIGN_SETTINGS)
  })

  test("SR4: a byte that is not UTF-8", () => {
    const folder = folderWith(
      Uint8Array.from([...Buffer.from('{"zekno": 1, "'), 0xff, 0x22, 0x7d])
    )
    expect(
      refused(() => readSettingsFile({ kind: "default", folder }, folder))
    ).toBe("zekno.app.json is not UTF-8 text.")
    const overlong = folderWith(Uint8Array.from([0xc0, 0xaf]))
    expect(
      refused(() =>
        readSettingsFile({ kind: "default", folder: overlong }, overlong)
      )
    ).toBe("zekno.app.json is not UTF-8 text.")
    const surrogate = folderWith(Uint8Array.from([0xed, 0xa0, 0x80]))
    expect(
      refused(() =>
        readSettingsFile({ kind: "default", folder: surrogate }, surrogate)
      )
    ).toBe("zekno.app.json is not UTF-8 text.")
  })

  test("SR5: a file that cannot be read", () => {
    if (process.getuid?.() === 0) return
    const folder = folderWith()
    const path = join(folder, SETTINGS_FILE)
    chmodSync(path, 0o000)
    expect(
      refused(() => readSettingsFile({ kind: "given", path }, folder))
    ).toBe("zekno.app.json could not be read.")
    // In a folder, Bun's realpath of a file this user cannot read fails before the file is opened, and the shared
    // reader (project/compose-read.ts, unchanged for a Compose file) says it as a missing file. Still refused, still no content.
    expect(
      refused(() => readSettingsFile({ kind: "default", folder }, folder))
    ).toMatch(
      /^(zekno\.app\.json could not be read\.|No settings file at zekno\.app\.json\.)$/
    )
  })

  test("SR7: a second name on the disk (a hard link)", () => {
    const elsewhere = folderWith()
    const folder = tempDir("settings-file")
    linkSync(join(elsewhere, SETTINGS_FILE), join(folder, SETTINGS_FILE))
    expect(
      refused(() => readSettingsFile({ kind: "default", folder }, folder))
    ).toBe(
      "zekno.app.json has more than one name on this disk (a hard link), so zekno cannot tell that it stays inside its folder."
    )
  })

  test("SR9: a link in this folder to a file outside it", () => {
    const elsewhere = folderWith()
    const folder = tempDir("settings-file")
    symlinkSync(join(elsewhere, SETTINGS_FILE), join(folder, SETTINGS_FILE))
    expect(
      refused(() => readSettingsFile({ kind: "default", folder }, folder))
    ).toBe(
      "zekno.app.json leads outside the folder that holds it. zekno does not follow it there."
    )
    expect(
      refused(() =>
        readSettingsFile({ kind: "project", link: linkIn(folder) }, folder)
      )
    ).toBe(
      "zekno.app.json leads outside the folder that holds it. zekno does not follow it there."
    )
  })

  test("a link that stays inside the folder is read", () => {
    const folder = tempDir("settings-file")
    writeFileSync(join(folder, "real.json"), DESIGN_FILE)
    symlinkSync("real.json", join(folder, SETTINGS_FILE))
    expect(
      readSettingsFile({ kind: "default", folder }, folder).settings
    ).toEqual(DESIGN_SETTINGS)
  })

  test("a fault of the content is the schema's sentence, as a CliError", () => {
    const folder = folderWith(DESIGN_FILE.replace('"1g"', `"${SENTINEL}"`))
    expect(
      refused(() => readSettingsFile({ kind: "default", folder }, folder))
    ).toBe(
      "zekno.app.json could not be read as settings. web, deploy.memory: use a size such as 512m or 1g."
    )
  })

  test("a later setting is its two sentences", () => {
    const folder = folderWith(
      DESIGN_FILE.replace(
        '"networking": { "port": 3000 }',
        `"networking": { "port": 3000, "domains": ["${SENTINEL}"] }`
      )
    )
    expect(
      refused(() => readSettingsFile({ kind: "default", folder }, folder))
    ).toBe(
      "zekno.app.json sets a domain for web. Domains are not in this version of zekno yet."
    )
  })

  test("the file is named as a person knows it: from this folder, or from home", () => {
    const folder = folderWith(DESIGN_FILE.replace('"1g"', '"lots"'))
    const other = tempDir("settings-file")
    const message = refused(() =>
      readSettingsFile(
        { kind: "given", path: join(folder, SETTINGS_FILE) },
        other
      )
    )
    expect(message).toStartWith(
      join(folder, SETTINGS_FILE).replace(/^\/private/, "")
    )
  })
})

describe("every file of the test set, read from the disk", () => {
  for (const file of FILES) {
    test(file.name, () => {
      const folder = folderWith(file.text)
      const read = () => readSettingsFile({ kind: "default", folder }, folder)
      if ("settings" in file.expect)
        expect(read().settings).toEqual(file.expect.settings)
      else expect(refused(read)).toBe(file.expect.fault)
    })
  }
})

test("isSettingsFile: the last part of the path is exactly zekno.app.json", () => {
  for (const path of [
    "zekno.app.json",
    "a/b/zekno.app.json",
    "/x/zekno.app.json",
    "./zekno.app.json",
  ])
    expect([path, isSettingsFile(path)]).toEqual([path, true])
  for (const path of [
    "zekno.app.json.bak",
    "Zekno.app.json",
    "zekno.app.yaml",
    "x.app.json",
    "zekno.app.json/",
    "a\\zekno.app.json",
    "compose.yaml",
    "",
  ])
    expect([path, isSettingsFile(path)]).toEqual([path, false])
})
