/**
 * Reading a settings file from the disk (specs/010-app-settings,
 * contracts/settings-file.md, "Reading the file"): once, from one open file,
 * with the descriptor checks a Compose file has (project/compose-read.ts:
 * inside its folder by its real path, never through a link put there since,
 * never waiting on a pipe, a regular file of this user's with one name on
 * the disk, at most 64 KiB by `fstat` and while reading, the very file
 * found again), then strict UTF-8, then `checkSettings`. A file named with
 * `-f` is the person's own path: links are followed, as for a Compose file.
 *
 * The file may be hostile. Every problem is one sentence that names the
 * file and, for its content, a place and a rule: never a piece of it.
 */
import { createHash } from "node:crypto"
import { basename, dirname, join, resolve } from "node:path"

import { CliError } from "../cli/errors"
import {
  readGivenBytes,
  readInsideBytes,
  type ComposeSource,
  type ReadBytes,
  type Words,
} from "../project/compose-read"
import { listsExactly } from "../project/file"
import { shownFile, shownPath } from "../project/shown"
import { sanitize } from "../server/sanitize"
import { checkSettings, isSettings } from "./schema"
import type { SettingsFault, SettingsRead } from "./types"
import { SETTINGS_BYTES, SETTINGS_FILE } from "./values"
import {
  laterSentences,
  notSettings,
  SR1,
  SR1_LINKED,
  SR3,
  SR4,
  SR5,
  SR9,
} from "./words"

export { SETTINGS_BYTES, SETTINGS_FILE } from "./values"

/** Whether a path names a settings file: its last part is exactly `zekno.app.json` (research R3). Any other is a Compose file. */
export const isSettingsFile = (path: string): boolean =>
  path.split("/").at(-1) === SETTINGS_FILE

/** A fault of a settings file as the sentence a person reads: SR's, `notSettings`, or SL's two. */
export function faultSentence(fault: SettingsFault, file: string): string {
  switch (fault.kind) {
    case "read":
      return fault.sentence
    case "form":
      return notSettings(file, fault.place, fault.rule)
    case "later":
      return laterSentences(file, fault.setting, fault.service).join(" ")
  }
}

/** The file as sentences name it, and the reading sentences SR1, SR5 and SR9 for it. */
function wordsOf(
  source: ComposeSource,
  cwd: string
): { shown: string; words: Words } {
  switch (source.kind) {
    case "project": {
      const shown = shownFile(
        cwd,
        resolve(source.link.folder, source.link.compose)
      )
      return {
        shown,
        words: {
          subject: shown,
          missing: SR1_LINKED(
            shownPath(source.link.path),
            sanitize(source.link.compose),
            shownPath(source.link.folder)
          ),
          outside: SR9(shown),
          folder: SR5(shownPath(source.link.folder)),
        },
      }
    }
    case "default": {
      const shown = shownFile(cwd, resolve(source.folder, SETTINGS_FILE))
      return {
        shown,
        words: {
          subject: shown,
          missing: SR1(shown),
          outside: SR9(shown),
          folder: SR5(shownPath(source.folder)),
        },
      }
    }
    case "given": {
      const shown = shownFile(cwd, source.path)
      return {
        shown,
        words: {
          subject: shown,
          missing: SR1(shown),
          outside: SR9(shown),
          folder: SR5(shown),
        },
      }
    }
  }
}

/**
 * Whether a settings file found by its name in a folder (this folder's, or
 * the one a zekno.json names) is listed there exactly as `zekno.app.json`:
 * on a disk that ignores letter case `ZEKNO.APP.JSON` would be opened under
 * that name, and it is not a settings file (security review S5). A folder
 * that cannot be listed is left to the reader, which says what is wrong.
 */
function listedHere(
  source: Exclude<ComposeSource, { kind: "given" }>
): boolean {
  const path =
    source.kind === "default"
      ? join(source.folder, SETTINGS_FILE)
      : resolve(source.link.folder, source.link.compose)
  try {
    return listsExactly(dirname(path), basename(path))
  } catch {
    return true
  }
}

/**
 * Reads and checks a settings file, once. `source` names it as a Compose
 * file would be named (`default`: `zekno.app.json` in that folder;
 * `project`: the file a zekno.json names; `given`: `-f`). Every problem is a
 * `CliError` with one of SR1 to SR9, or the fault's sentences.
 */
export function readSettingsFile(
  source: ComposeSource,
  cwd: string
): SettingsRead {
  const { shown, words } = wordsOf(source, cwd)
  const tooLarge = SR3(shown)
  if (source.kind !== "given" && !listedHere(source))
    throw new CliError(words.missing)
  try {
    let read: ReadBytes
    switch (source.kind) {
      case "given":
        read = readGivenBytes(source.path, words, SETTINGS_BYTES, tooLarge)
        break
      case "default":
        read = readInsideBytes(
          source.folder,
          SETTINGS_FILE,
          words,
          SETTINGS_BYTES,
          tooLarge
        )
        break
      case "project":
        read = readInsideBytes(
          source.link.folder,
          source.link.compose,
          words,
          SETTINGS_BYTES,
          tooLarge
        )
        break
    }
    let text: string
    try {
      // The decoder keeps a byte order mark, so `checkSettings` drops exactly one, as for any text.
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        read.bytes
      )
    } catch {
      throw new CliError(SR4(shown))
    }
    const checked = checkSettings(text, shown)
    if (!isSettings(checked)) throw new CliError(faultSentence(checked, shown))
    return {
      path: read.path,
      shown,
      sha256: createHash("sha256").update(read.bytes).digest("hex"),
      bytes: read.bytes,
      dev: read.dev,
      ino: read.ino,
      mode: read.mode,
      settings: checked,
    }
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(SR5(shown))
  }
}
