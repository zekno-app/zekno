/**
 * The rule of each value of a settings file (specs/010-app-settings,
 * contracts/settings-file.md, "Each value" and "The start command"; research
 * R1), and the limits of the file. The same check is used wherever a value
 * comes from: the file, `zekno settings set`, the settings screen.
 *
 * Each check gives `undefined` for a good value, or the rule it breaks as a
 * sentence a person can act on (contracts/commands.md, "Each setting's
 * words"). Every string is first held to `holdsOnlyAllowed`, so nothing a
 * setting holds can end a line or need escaping in the Compose text beyond
 * what `quote` does (research R2); the two that may hold text outside ASCII,
 * the start command and a plain value, are then held to `holdsInvisible`,
 * so nothing they hold hides itself where it is shown (security review S2).
 */
import { isReservedSecretName, LIMITS, SECRET_NAME } from "@workspace/core"

import { holdsHidden } from "../server/sanitize"
import {
  BLANK_RULE,
  HIDDEN_RULE,
  IN2_RULE,
  settingWords,
  startRule,
  type StartProblem,
} from "./words"
import type { SettingPath } from "./types"

/** The settings file's name: a file of exactly this name is read as settings, any other as a Compose file. */
export const SETTINGS_FILE = "zekno.app.json"
/** The most bytes a settings file may hold (SR3). */
export const SETTINGS_BYTES = 65_536
/** The most services a file may name (SV3). */
export const MAX_SERVICES = 32
/** The most secret names a service may list (SV21). */
export const MAX_SECRETS = 256
/** The most plain variables a service may set (SV26). */
export const MAX_PLAIN = 128
/** The most volumes a service may mount (SV31). */
export const MAX_VOLUMES = 16
/** The most characters of a start command or a plain value. */
export const MAX_TEXT = 4096
/** The most words of a start command. */
export const MAX_WORDS = 256
/** The most characters of an image reference, and of a mount path. */
export const MAX_IMAGE = 255
export const MAX_MOUNT = 255

/** A service's name: lowercase, starts with a letter, at most 63 characters. It is also a host name the other services reach it by. */
export const SERVICE_NAME = /^[a-z][a-z0-9-]{0,62}$/
/** A volume's name: as a service's, and underscores. */
export const VOLUME_NAME = /^[a-z][a-z0-9_-]{0,62}$/
/** A memory limit: a size in megabytes or gigabytes, no leading zero. At least 6m, Docker's least, is checked apart. */
export const MEMORY = /^[1-9][0-9]{0,4}[mg]$/
/** A processor limit as the JSON number is written: no exponent, at most two decimals. More than 0 and at most 1024 is checked apart. */
export const CPUS = /^(0|[1-9][0-9]{0,3})(\.[0-9]{1,2})?$/
/** A port as written: an integer with no sign, exponent or fraction. At most 65535 is checked apart. */
export const PORT = /^[1-9][0-9]{0,4}$/
/** An absolute path in the container: parts of letters, digits and `._@+-`. No `.` or `..` part is checked apart. */
export const MOUNT_PATH = /^(\/[A-Za-z0-9._@+-]+)+$/
/** An image's host: dot-separated parts of letters, digits and inner hyphens, and a port. */
export const IMAGE_HOST =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*(?::[0-9]{1,5})?$/
/** One part of an image's path: lowercase letters and digits, joined by `.`, `_`, `__` or hyphens. */
export const IMAGE_PATH_PART = /^[a-z0-9]+(?:(?:\.|_|__|-+)[a-z0-9]+)*$/
/** An image's tag. */
export const IMAGE_TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/
/** An image's digest: sha256 and 64 lowercase hex digits. */
export const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/
/** The characters a start command keeps for the shell it does not run in, refused outside quotes. */
export const SHELL_CHARACTERS = ";&|<>()$`"

/**
 * Characters no setting may hold (research R1): Unicode's control
 * characters (`Cc`: C0, DEL and C1, line breaks and tabs among them), the
 * line and paragraph separators, the byte order mark, and U+FFFE and U+FFFF.
 */
const NOT_ALLOWED = /[\p{Cc}\u2028\u2029\ufeff\ufffe\uffff]/u
/** A surrogate that is not half of a pair: text that is not well formed. */
const LONE_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

/** Whether a string holds only characters a setting may hold, and is well formed (research R1). Every check of a string uses it. */
export function holdsOnlyAllowed(text: string): boolean {
  return !NOT_ALLOWED.test(text) && !LONE_SURROGATE.test(text)
}

/**
 * Whether a string a person reads where zekno shows it holds a character
 * drawn as nothing or that turns text around: zero-width spaces and
 * joiners, the soft hyphen, bidirectional controls, tag characters, Hangul
 * fillers, variation selectors not after a pictograph, and every other
 * character `sanitize` takes out when it draws (security review S2; one
 * definition, `holdsHidden` in server/sanitize.ts). Such a value would read
 * as another everywhere it is shown and be signed as it is. Only the start
 * command and a plain value can hold a character outside ASCII; every other
 * setting is held to an ASCII pattern, which refuses them already.
 */
export const holdsInvisible = (text: string): boolean => holdsHidden(text)

/** A blank: Unicode's `White_Space`, and the braille blank (U+2800), which draws as a space too. */
const BLANK = /^[\p{White_Space}\u2800]$/u

/**
 * Whether a text starts or ends with a blank (security review S8): drawn at
 * the end of a line it is not seen, so `true ` would read as `true` and be
 * signed as it is. A blank inside a text is seen, and stays allowed.
 */
export function blankAtAnEnd(text: string): boolean {
  const chars = [...text]
  return (
    chars.length > 0 && (BLANK.test(chars[0]!) || BLANK.test(chars.at(-1)!))
  )
}

/** Characters as a person counts them: code points, not UTF-16 units. */
export const characters = (text: string): number => [...text].length

/** A service's name. */
export function checkServiceName(name: string): string | undefined {
  return SERVICE_NAME.test(name) ? undefined : IN2_RULE
}

/** Whether a text is an image reference as Docker reads one: `[host/]path[:tag][@sha256:<hex>]`. */
export function isImage(image: string): boolean {
  if (
    image.length === 0 ||
    image.length > MAX_IMAGE ||
    !holdsOnlyAllowed(image)
  )
    return false
  let rest = image
  const digest = rest.indexOf("@")
  if (digest !== -1) {
    if (!IMAGE_DIGEST.test(rest.slice(digest + 1))) return false
    rest = rest.slice(0, digest)
  }
  const tag = rest.lastIndexOf(":")
  if (tag > rest.lastIndexOf("/")) {
    if (!IMAGE_TAG.test(rest.slice(tag + 1))) return false
    rest = rest.slice(0, tag)
  }
  const parts = rest.split("/")
  // The first of several parts is a host when it holds a `.` or a `:`, or is localhost, as Docker reads it.
  const first = parts[0] ?? ""
  if (parts.length > 1 && (/[.:]/.test(first) || first === "localhost")) {
    if (!IMAGE_HOST.test(first)) return false
    parts.shift()
  }
  return parts.every((part) => IMAGE_PATH_PART.test(part))
}

/** An image reference. */
export function checkImage(image: string): string | undefined {
  return isImage(image) ? undefined : settingWords("image").rule
}

/**
 * A start command split into the words that run, by the grammar of
 * contracts/settings-file.md, "The start command", or what is wrong with it,
 * the first thing met in the order: a character no setting holds, too long,
 * then reading from the start a quote that does not close or a character
 * kept for the shell outside quotes (a backslash outside quotes, or one in
 * double quotes before anything but `"` or `\`, counts as one: there is no
 * shell to read it as an escape), then no word, then too many words.
 */
export function splitStart(
  command: string
): { words: string[] } | { problem: StartProblem } {
  if (!holdsOnlyAllowed(command)) return { problem: "control" }
  if (holdsInvisible(command)) return { problem: "hidden" }
  if (characters(command) > MAX_TEXT) return { problem: "long" }
  const words: string[] = []
  const end = command.length
  let at = 0
  for (;;) {
    while (command[at] === " ") at++
    if (at >= end) break
    let word = ""
    while (at < end && command[at] !== " ") {
      const char = command[at]!
      if (char === "'") {
        const close = command.indexOf("'", at + 1)
        if (close === -1) return { problem: "quote" }
        word += command.slice(at + 1, close)
        at = close + 1
      } else if (char === '"') {
        at++
        for (;;) {
          if (at >= end) return { problem: "quote" }
          const inner = command[at]!
          if (inner === '"') {
            at++
            break
          }
          if (inner === "\\") {
            const escaped = command[at + 1]
            if (escaped === undefined) return { problem: "quote" }
            if (escaped !== '"' && escaped !== "\\") return { problem: "shell" }
            word += escaped
            at += 2
            continue
          }
          word += inner
          at++
        }
      } else if (char === "\\" || SHELL_CHARACTERS.includes(char)) {
        return { problem: "shell" }
      } else {
        word += char
        at++
      }
    }
    words.push(word)
  }
  if (words.length === 0) return { problem: "empty" }
  // Spaces around the words only separate them and are never signed (the Compose text holds the words); any other blank
  // at either end would be part of the first or the last word, run as it is and not seen (security review S8).
  if (blankAtAnEnd(command.replace(/^ +| +$/g, ""))) return { problem: "blank" }
  if (words.length > MAX_WORDS) return { problem: "long" }
  return { words }
}

/** What is wrong with a start command, or undefined. */
export function startProblem(command: string): StartProblem | undefined {
  const split = splitStart(command)
  return "problem" in split ? split.problem : undefined
}

/** A start command. */
export function checkStart(command: string): string | undefined {
  const problem = startProblem(command)
  return problem === undefined ? undefined : startRule(problem)
}

/** A word `joinStart` puts in double quotes: empty, or holding a space, a quote, a backslash or a shell character. */
const NEEDS_QUOTES = /[ '"\\;&|<>()$`]/

/**
 * Words joined into a start command that `splitStart` reads back as the same
 * words (contracts/compose-text.md, "Reading it back"): one space between
 * them; a word that needs it in double quotes, `\` written `\\` and `"`
 * written `\"`.
 */
export function joinStart(words: readonly string[]): string {
  return words
    .map((word) =>
      word === "" || NEEDS_QUOTES.test(word)
        ? `"${word.replace(/[\\"]/g, (char) => `\\${char}`)}"`
        : word
    )
    .join(" ")
}

/** A restart rule. */
export function checkRestart(restart: string): string | undefined {
  return restart === "no" || restart === "on-failure" || restart === "always"
    ? undefined
    : settingWords("restart").rule
}

/** A memory limit: at least 6m, Docker's least. */
export function checkMemory(memory: string): string | undefined {
  if (MEMORY.test(memory)) {
    const megabytes =
      Number(memory.slice(0, -1)) * (memory.endsWith("g") ? 1024 : 1)
    if (megabytes >= 6) return undefined
  }
  return settingWords("memory").rule
}

/** A processor limit, as the number is written: more than 0, at most 1024, at most two decimals. */
export function checkCpus(text: string): string | undefined {
  if (CPUS.test(text)) {
    const cpus = Number(text)
    if (cpus > 0 && cpus <= 1024) return undefined
  }
  return settingWords("cpus").rule
}

/** A port, as the number is written: an integer from 1 to 65535. */
export function checkPort(text: string): string | undefined {
  return PORT.test(text) && Number(text) <= 65535
    ? undefined
    : settingWords("port").rule
}

/** What is wrong with a secret's name: not the secret-name pattern of at most 128 characters (`form`), or a name zekno keeps for itself (`reserved`). */
export function secretNameProblem(
  name: string
): "form" | "reserved" | undefined {
  if (!SECRET_NAME.test(name) || name.length > LIMITS.secretNameLength)
    return "form"
  return isReservedSecretName(name) ? "reserved" : undefined
}

/** A secret's name: the pattern, and not reserved. */
export function checkSecretName(name: string): string | undefined {
  return secretNameProblem(name) === undefined
    ? undefined
    : settingWords("secrets").rule
}

/** A plain variable's name: as a secret's, reserved names allowed (research R9, item 18). */
export function checkPlainName(name: string): string | undefined {
  return SECRET_NAME.test(name) && name.length <= LIMITS.secretNameLength
    ? undefined
    : "A variable name uses letters, digits and underscore, does not start with a digit, and is at most 128 characters."
}

/**
 * What is wrong with a plain variable's value: a character no setting holds
 * or more than 4096 characters (`form`), a character drawn as nothing
 * (`hidden`), or a blank at either end (`blank`); empty is a value.
 */
export function plainValueProblem(
  value: string
): "form" | "hidden" | "blank" | undefined {
  if (!holdsOnlyAllowed(value) || characters(value) > MAX_TEXT) return "form"
  if (holdsInvisible(value)) return "hidden"
  return blankAtAnEnd(value) ? "blank" : undefined
}

/** A plain variable's value: one line, no control or invisible character, at most 4096 characters; empty is a value. */
export function checkPlainValue(value: string): string | undefined {
  const problem = plainValueProblem(value)
  if (problem === undefined) return undefined
  if (problem === "blank") return BLANK_RULE
  return problem === "form" ? settingWords("plain").rule : HIDDEN_RULE
}

/** A volume's name. */
export function checkVolumeName(name: string): string | undefined {
  return VOLUME_NAME.test(name)
    ? undefined
    : "Use lowercase letters, digits, hyphens and underscores, starting with a letter."
}

/** A mount path: absolute, in the container, no `.` or `..` part, at most 255 characters. */
export function checkMountPath(path: string): string | undefined {
  const good =
    path.length <= MAX_MOUNT &&
    MOUNT_PATH.test(path) &&
    path
      .split("/")
      .slice(1)
      .every((part) => part !== "." && part !== "..")
  return good ? undefined : settingWords("volume").rule
}

/**
 * A value as typed for `zekno settings set` or on the settings screen, read
 * as the setting holds it and checked by its rule: a processor limit as its
 * text (`"0.5"`), a port as a number, secrets as names separated by `,`
 * (spaces around each dropped), a plain value exactly as typed. Refused: the
 * rule, as a sentence.
 */
export function readTyped(
  path: SettingPath,
  text: string
): { value: string | number | readonly string[] } | { refused: string } {
  const checked = (refused: string | undefined, value: string | number) =>
    refused === undefined ? { value } : { refused }
  switch (path.key) {
    case "image":
      return checked(checkImage(text), text)
    case "start":
      return checked(checkStart(text), text)
    case "restart":
      return checked(checkRestart(text), text)
    case "memory":
      return checked(checkMemory(text), text)
    case "cpus":
      return checked(checkCpus(text), text)
    case "port":
    case "publish":
      return checked(
        checkPort(text) === undefined ? undefined : settingWords(path.key).rule,
        Number(text)
      )
    case "secrets": {
      const names = text.split(",").map((name) => name.replace(/^ +| +$/g, ""))
      return names.every((name) => checkSecretName(name) === undefined)
        ? { value: names }
        : { refused: settingWords("secrets").rule }
    }
    case "plain":
      return checked(checkPlainValue(text), text)
    case "volume":
      return checked(checkMountPath(text), text)
  }
}
