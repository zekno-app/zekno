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
  lstatSync,
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
import {
  createSettings,
  restoreSettings,
  writeSettings,
} from "../../src/settings/write"
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

describe("putting a file back (specs/012-templates, research R7, step f; tasks T017)", () => {
  /** design.md's file read, then written with web's memory changed: what step d of adding leaves. */
  function written() {
    const { folder, read } = readDesign()
    chmodSync(read.path, 0o640)
    const before = readSettingsFile({ kind: "default", folder }, folder)
    writeSettings(before, changed())
    const { bytes } = before
    if (bytes === undefined) throw new Error("the read kept no bytes")
    return {
      folder,
      path: before.path,
      back: {
        path: before.path,
        shown: before.shown,
        wrote: settingsText(changed()),
        bytes,
        mode: before.mode,
      },
    }
  }

  const CHANGED =
    "zekno.app.json changed since zekno read it, so nothing was written. Try again."

  test("the bytes read are put back, with the mode, through a new file and a rename, while the file is the one written", () => {
    const { folder, path, back } = written()
    const inode = statSync(path).ino
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
      restoreSettings(back)
    } finally {
      syncs.mockRestore()
      renames.mockRestore()
    }
    expect(order).toEqual(["fsync", "rename"])
    expect(readFileSync(path, "utf8")).toBe(DESIGN_FILE)
    expect(statSync(path).mode & 0o777).toBe(0o640)
    expect(statSync(path).ino).not.toBe(inode)
    onlyFiles(folder, [SETTINGS_FILE])
  })

  test("CS12: the file changed since it was written", () => {
    const { folder, path, back } = written()
    writeFileSync(path, DESIGN_FILE.replace('"1g"', '"2g"'))
    expect(refused(() => restoreSettings(back))).toBe(CHANGED)
    expect(readFileSync(path, "utf8")).toBe(DESIGN_FILE.replace('"1g"', '"2g"'))
    onlyFiles(folder, [SETTINGS_FILE])
  })

  test("CS12: the file removed since it was written", () => {
    const { folder, path, back } = written()
    fs.rmSync(path)
    expect(refused(() => restoreSettings(back))).toBe(CHANGED)
    onlyFiles(folder, [])
  })

  test("CS12: a symbolic link in its place, to a copy of what was written", () => {
    const { folder, path, back } = written()
    const copy = join(folder, "copy.json")
    writeFileSync(copy, back.wrote)
    fs.rmSync(path)
    symlinkSync(copy, path)
    expect(refused(() => restoreSettings(back))).toBe(CHANGED)
    expect(lstatSync(path).isSymbolicLink()).toBe(true)
    expect(readFileSync(copy, "utf8")).toBe(back.wrote)
    onlyFiles(folder, [SETTINGS_FILE, "copy.json"])
  })

  test("CS12: a second name given to the file (a hard link)", () => {
    const { folder, path, back } = written()
    linkSync(path, join(tempDir("settings-write"), "second"))
    expect(refused(() => restoreSettings(back))).toBe(CHANGED)
    expect(readFileSync(path, "utf8")).toBe(back.wrote)
    onlyFiles(folder, [SETTINGS_FILE])
  })

  test("CS12: a file that belongs to another user", () => {
    const { folder, path, back } = written()
    const uid = process.getuid?.() ?? 0
    const other = spyOn(process, "getuid").mockImplementation(() => uid + 1)
    try {
      expect(refused(() => restoreSettings(back))).toBe(CHANGED)
    } finally {
      other.mockRestore()
    }
    expect(readFileSync(path, "utf8")).toBe(back.wrote)
    onlyFiles(folder, [SETTINGS_FILE])
  })

  test("CS14: a folder made read-only, and the file as it was", () => {
    if (process.getuid?.() === 0) return
    const { folder, path, back } = written()
    chmodSync(folder, 0o555)
    try {
      expect(refused(() => restoreSettings(back))).toBe(
        "Could not write zekno.app.json."
      )
    } finally {
      chmodSync(folder, 0o755)
    }
    expect(readFileSync(path, "utf8")).toBe(back.wrote)
    onlyFiles(folder, [SETTINGS_FILE])
  })

  test("a failure after the new file was made leaves no temporary file", () => {
    const { folder, path, back } = written()
    const fail = spyOn(fs, "fsyncSync").mockImplementation(() => {
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" })
    })
    try {
      expect(refused(() => restoreSettings(back))).toBe(
        "Could not write zekno.app.json."
      )
    } finally {
      fail.mockRestore()
    }
    expect(readFileSync(path, "utf8")).toBe(back.wrote)
    onlyFiles(folder, [SETTINGS_FILE])
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

  /** A hard link that fails as on a disk that has none (exFAT, some network shares). */
  const noHardLinks = (code: string) => () => {
    throw Object.assign(new Error("not supported"), { code })
  }

  test("on a disk without hard links: the file is made, mode 644, whole, with no temporary file left (security review, needs validation)", () => {
    for (const code of ["ENOTSUP", "EPERM", "EOPNOTSUPP", "EMLINK", "ENOSYS"]) {
      const folder = tempDir("settings-create")
      const path = createSettings(folder, small, { link: noHardLinks(code) })
      expect({ code, text: readFileSync(path, "utf8") }).toEqual({
        code,
        text: settingsText(small),
      })
      expect(statSync(path).mode & 0o777).toBe(0o644)
      onlyFiles(folder, [SETTINGS_FILE])
    }
  })

  test("on a disk without hard links: a file that appears between the check and the placing is never replaced, IN4", () => {
    const folder = tempDir("settings-create")
    expect(
      refused(() =>
        createSettings(folder, small, {
          link: noHardLinks("ENOTSUP"),
          beforeFallback: () =>
            writeFileSync(join(folder, SETTINGS_FILE), "appeared"),
        })
      )
    ).toBe(
      "There is already a zekno.app.json here. Change it with zekno settings set, or in an editor."
    )
    expect(readFileSync(join(folder, SETTINGS_FILE), "utf8")).toBe("appeared")
    onlyFiles(folder, [SETTINGS_FILE])
    // Nor a link to nowhere put there in between.
    const other = tempDir("settings-create")
    expect(
      refused(() =>
        createSettings(other, small, {
          link: noHardLinks("ENOTSUP"),
          beforeFallback: () =>
            symlinkSync("/nowhere", join(other, SETTINGS_FILE)),
        })
      )
    ).toContain("There is already")
    expect(lstatSync(join(other, SETTINGS_FILE)).isSymbolicLink()).toBe(true)
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
