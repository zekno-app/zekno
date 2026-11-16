/**
 * Writing a settings file (specs/010-app-settings, research R5; tasks
 * T020), in temporary folders on the real file system: whole or nothing,
 * never over a file changed since it was read, never through a link, never
 * over a file when creating, the mode kept, no temporary file left behind.
 */
import { describe, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import {
  chmodSync,
  linkSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../../runner/test/support/helpers"
import { CliError } from "../../src/cli/errors"
import { applyChange } from "../../src/settings/change"
import { readSettingsFile, SETTINGS_FILE } from "../../src/settings/file"
import { settingsText } from "../../src/settings/text"
import type { Settings, SettingsRead } from "../../src/settings/types"
import { createSettings, writeSettings } from "../../src/settings/write"
import { DESIGN_FILE, DESIGN_SETTINGS } from "../support/settings-files"

/** A folder holding design.md's file, read as a command reads it. */
function readDesign(content = DESIGN_FILE): {
  folder: string
  read: SettingsRead
} {
  const folder = tempDir("settings-write")
  writeFileSync(join(folder, SETTINGS_FILE), content)
  return { folder, read: readSettingsFile({ kind: "default", folder }, folder) }
}

/** design.md's settings with web's memory changed. */
const changed = (memory = "512m"): Settings => {
  const got = applyChange(
    DESIGN_SETTINGS,
    { service: "web", key: "memory" },
    memory
  )
  if ("refused" in got) throw new Error(got.refused)
  return got.settings
}

/** The folder holds only these names: no temporary file is left. */
const onlyFiles = (folder: string, names: string[]) =>
  expect(readdirSync(folder).sort()).toEqual(names.sort())

/** The `CliError` a write throws. */
function refused(write: () => unknown): string {
  try {
    write()
  } catch (error) {
    expect(error).toBeInstanceOf(CliError)
    return (error as Error).message
  }
  throw new Error("expected the write to be refused")
}

describe("writeSettings", () => {
  test("replaces the file with settingsText of the settings, and keeps its mode", () => {
    const { folder, read } = readDesign()
    chmodSync(read.path, 0o640)
    const again = readSettingsFile({ kind: "default", folder }, folder)
    writeSettings(again, changed())
    const path = join(folder, SETTINGS_FILE)
    expect(readFileSync(path, "utf8")).toBe(settingsText(changed()))
    expect(statSync(path).mode & 0o777).toBe(0o640)
    onlyFiles(folder, [SETTINGS_FILE])
    expect(
      readSettingsFile({ kind: "default", folder }, folder).settings
    ).toEqual(changed())
  })

  test("the file is flushed to the disk before it is renamed into place", () => {
    const { folder, read } = readDesign()
    const order: string[] = []
    const fsync = fs.fsyncSync
    const rename = fs.renameSync
    const syncs = spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      order.push("fsync")
      fsync(fd)
    })
    const renames = spyOn(fs, "renameSync").mockImplementation((from, to) => {
      order.push("rename")
      rename(from, to)
    })
    try {
      writeSettings(read, changed())
    } finally {
      syncs.mockRestore()
      renames.mockRestore()
    }
    expect(order).toEqual(["fsync", "rename"])
    onlyFiles(folder, [SETTINGS_FILE])
  })

  test("CS12: a file rewritten by another writer after the read is not overwritten", () => {
    const { folder, read } = readDesign()
    const path = join(folder, SETTINGS_FILE)
    // The same inode, other bytes: an editor that writes in place.
    writeFileSync(path, DESIGN_FILE.replace('"1g"', '"2g"'))
    expect(refused(() => writeSettings(read, changed()))).toBe(
      "zekno.app.json changed since zekno read it, so nothing was written. Try again."
    )
    expect(readFileSync(path, "utf8")).toBe(DESIGN_FILE.replace('"1g"', '"2g"'))
    onlyFiles(folder, [SETTINGS_FILE])
  })

  test("CS12: a file replaced by another file (an editor that renames) is not overwritten", () => {
    const { folder, read } = readDesign()
    const path = join(folder, SETTINGS_FILE)
    writeFileSync(join(folder, "other"), DESIGN_FILE)
    renameSync(join(folder, "other"), path)
    expect(refused(() => writeSettings(read, changed()))).toBe(
      "zekno.app.json changed since zekno read it, so nothing was written. Try again."
    )
    expect(readFileSync(path, "utf8")).toBe(DESIGN_FILE)
    onlyFiles(folder, [SETTINGS_FILE])
  })

  test("CS12: a file removed since the read", () => {
    const { folder, read } = readDesign()
    fs.rmSync(read.path)
    expect(refused(() => writeSettings(read, changed()))).toBe(
      "zekno.app.json changed since zekno read it, so nothing was written. Try again."
    )
    onlyFiles(folder, [])
  })

  test("CS13: the file replaced by a symbolic link to a copy", () => {
    const { folder, read } = readDesign()
    const copy = join(folder, "copy.json")
    writeFileSync(copy, DESIGN_FILE)
    fs.rmSync(read.path)
    symlinkSync(copy, read.path)
    expect(refused(() => writeSettings(read, changed()))).toBe(
      "zekno.app.json is a symbolic link. zekno changes it only as a file of its own."
    )
    expect(readFileSync(copy, "utf8")).toBe(DESIGN_FILE)
    expect(fs.lstatSync(read.path).isSymbolicLink()).toBe(true)
    onlyFiles(folder, [SETTINGS_FILE, "copy.json"])
  })

  test("a file read through a link (-f) is never written through it", () => {
    const elsewhere = tempDir("settings-write")
    writeFileSync(join(elsewhere, "real.json"), DESIGN_FILE)
    const folder = tempDir("settings-write")
    const path = join(folder, SETTINGS_FILE)
    symlinkSync(join(elsewhere, "real.json"), path)
    const read = readSettingsFile({ kind: "given", path }, folder)
    expect(refused(() => writeSettings(read, changed()))).toBe(
      "zekno.app.json is a symbolic link. zekno changes it only as a file of its own."
    )
    expect(readFileSync(join(elsewhere, "real.json"), "utf8")).toBe(DESIGN_FILE)
    onlyFiles(folder, [SETTINGS_FILE])
  })

  test("a file given a second name (a hard link) since the read is refused", () => {
    const { folder, read } = readDesign()
    const elsewhere = tempDir("settings-write")
    linkSync(read.path, join(elsewhere, "second"))
    expect(refused(() => writeSettings(read, changed()))).toBe(
      "zekno.app.json changed since zekno read it, so nothing was written. Try again."
    )
    expect(readFileSync(read.path, "utf8")).toBe(DESIGN_FILE)
    onlyFiles(folder, [SETTINGS_FILE])
  })

  test("CS14: a folder made read-only, and the file as it was", () => {
    if (process.getuid?.() === 0) return
    const { folder, read } = readDesign()
    chmodSync(folder, 0o555)
    try {
      expect(refused(() => writeSettings(read, changed()))).toBe(
        "Could not write zekno.app.json."
      )
    } finally {
      chmodSync(folder, 0o755)
    }
    expect(readFileSync(read.path, "utf8")).toBe(DESIGN_FILE)
    onlyFiles(folder, [SETTINGS_FILE])
  })

  test("a failure after the new file was made leaves no temporary file", () => {
    const { folder, read } = readDesign()
    const fail = spyOn(fs, "fsyncSync").mockImplementation(() => {
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" })
    })
    try {
      expect(refused(() => writeSettings(read, changed()))).toBe(
        "Could not write zekno.app.json."
      )
    } finally {
      fail.mockRestore()
    }
    expect(readFileSync(read.path, "utf8")).toBe(DESIGN_FILE)
    onlyFiles(folder, [SETTINGS_FILE])
  })

  test("a text the reader does not read back stops before anything is written", () => {
    const { folder, read } = readDesign()
    const broken = (settings: Settings) =>
      settingsText(settings).replace('"512m"', '"lots"')
    expect(
      refused(() => writeSettings(read, changed(), { text: broken }))
    ).toBe("Could not write zekno.app.json.")
    const lossy = (settings: Settings) =>
      settingsText(settings).replace('"512m"', '"2g"')
    expect(refused(() => writeSettings(read, changed(), { text: lossy }))).toBe(
      "Could not write zekno.app.json."
    )
    expect(readFileSync(read.path, "utf8")).toBe(DESIGN_FILE)
    onlyFiles(folder, [SETTINGS_FILE])
  })

  test("a change made between the check and the rename is the known limit: the window is a few calls", () => {
    const { read } = readDesign()
    writeSettings(read, changed(), {
      beforePlace: () => writeFileSync(read.path, "{}"),
    })
    // Research R5, Known limit: the write in that window is lost; the file is the change, whole.
    expect(readFileSync(read.path, "utf8")).toBe(settingsText(changed()))
  })
})

describe("createSettings", () => {
  const small: Settings = {
    version: 1,
    services: [["web", { image: "ghcr.io/acme/demo-web:1.4.2" }]],
  }

  test("creates the file, mode 644, that the reader reads", () => {
    const folder = tempDir("settings-create")
    const path = createSettings(folder, small)
    expect(path).toBe(join(folder, SETTINGS_FILE))
    expect(readFileSync(path, "utf8")).toBe(settingsText(small))
    expect(statSync(path).mode & 0o777).toBe(0o644)
    expect(statSync(path).nlink).toBe(1)
    expect(
      readSettingsFile({ kind: "default", folder }, folder).settings
    ).toEqual(small)
    onlyFiles(folder, [SETTINGS_FILE])
  })

  test("IN4: never replaces a file that is there", () => {
    const folder = tempDir("settings-create")
    writeFileSync(join(folder, SETTINGS_FILE), "mine")
    expect(refused(() => createSettings(folder, small))).toBe(
      "There is already a zekno.app.json here. Change it with zekno settings set, or in an editor."
    )
    expect(readFileSync(join(folder, SETTINGS_FILE), "utf8")).toBe("mine")
    onlyFiles(folder, [SETTINGS_FILE])
  })

  test("IN4: nor a link, nor a file that appears between the check and the link", () => {
    const folder = tempDir("settings-create")
    symlinkSync("/nowhere", join(folder, SETTINGS_FILE))
    expect(refused(() => createSettings(folder, small))).toContain(
      "There is already"
    )
    const other = tempDir("settings-create")
    expect(
      refused(() =>
        createSettings(other, small, {
          beforePlace: () =>
            writeFileSync(join(other, SETTINGS_FILE), "appeared"),
        })
      )
    ).toContain("There is already")
    expect(readFileSync(join(other, SETTINGS_FILE), "utf8")).toBe("appeared")
    onlyFiles(other, [SETTINGS_FILE])
  })

  test("CS14: a folder that cannot be written", () => {
    if (process.getuid?.() === 0) return
    const folder = tempDir("settings-create")
    chmodSync(folder, 0o555)
    try {
      expect(refused(() => createSettings(folder, small))).toBe(
        "Could not write zekno.app.json."
      )
    } finally {
      chmodSync(folder, 0o755)
    }
    onlyFiles(folder, [])
  })

  test("settings the reader would refuse are never written", () => {
    const folder = tempDir("settings-create")
    const bad: Settings = { version: 1, services: [["Web", { image: "x" }]] }
    expect(refused(() => createSettings(folder, bad))).toBe(
      "Could not write zekno.app.json."
    )
    onlyFiles(folder, [])
  })
})
