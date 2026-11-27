/**
 * Each setting's words (specs/010-app-settings, contracts/commands.md and
 * contracts/app-screen.md): its label, its question and its rule, the words
 * of a setting not set, and how a value reads. Split from words.ts, which
 * re-exports all of it (specs/016-build-from-source, contracts/cli.md CL14).
 */
import { ROUTE_NOT_SET, routeWords, type RouteKey } from "./domains-health"
import { START_RULES, type StartProblem } from "./fault-words"

/** The screen's refusal of an empty image (contracts/app-screen.md, "Changing a value"). */
export const IMAGE_NEEDED = "A service needs an image."

// Each setting's words, contracts/commands.md and contracts/app-screen.md.

/** The settings `set` and the screen change, by key. */
export type SettingKey =
  | "image"
  | "start"
  | "restart"
  | "memory"
  | "cpus"
  | "port"
  | "publish"
  | "secrets"
  | "plain"
  | "volume"
  | RouteKey

/** The rule of a start command refused, as a sentence: SV9 (a) to (e). */
export const startRule = (problem: StartProblem): string => {
  const rule = START_RULES[problem]
  return `${rule.charAt(0).toUpperCase()}${rule.slice(1)}`
}

/** One setting's words: its label after `<svc> · `, its question, `That is not <a label>.`, and its rule. */
export type SettingWords = {
  label: string
  question: string
  notA: string
  rule: string
}

/** The words of each setting. A plain variable and a volume take their name; a start command's rule is its problem's. */
export function settingWords(key: SettingKey, name = ""): SettingWords {
  switch (key) {
    case "image":
      return {
        label: "image",
        question: "Image",
        notA: "That is not an image reference.",
        rule: "Use one such as ghcr.io/acme/web:1.4.2.",
      }
    case "start":
      return {
        label: "start command",
        question: "Start command",
        notA: "That is not a start command zekno can run.",
        rule: startRule("empty"),
      }
    case "restart":
      return {
        label: "restart rule",
        question: "Restart rule",
        notA: "That is not a restart rule.",
        rule: "Use no, on-failure or always.",
      }
    case "memory":
      return {
        label: "memory limit",
        question: "Memory limit",
        notA: "That is not a memory limit.",
        rule: "Use a size such as 512m or 1g.",
      }
    case "cpus":
      return {
        label: "processor limit",
        question: "Processor limit",
        notA: "That is not a processor limit.",
        rule: "Use a number of processors, such as 0.5 or 2.",
      }
    case "port":
      return {
        label: "port",
        question: "Port",
        notA: "That is not a port.",
        rule: "Use a port from 1 to 65535.",
      }
    case "publish":
      return {
        label: "published port",
        question: "Published port",
        notA: "That is not a port.",
        rule: "Use a port from 1 to 65535.",
      }
    case "secrets":
      return {
        label: "secrets",
        question: "Secrets",
        notA: "That is not a list of secret names.",
        rule: "A secret name uses letters, digits and underscore, does not start with a digit, and is not one zekno keeps for itself.",
      }
    case "plain":
      return {
        label: name,
        question: name,
        notA: "That is not a value zekno can write.",
        rule: "Use one line with no control character, at most 4096 characters.",
      }
    case "volume":
      return {
        label: `volume ${name}`,
        question: `Mount path for ${name}`,
        notA: "That is not a mount path.",
        rule: "Use an absolute path in the container, such as /data.",
      }
    default:
      return routeWords(key)
  }
}

/** The words of a setting that is not set (dim on the screen; also the old or new value of a change). */
export const NOT_SET: Record<SettingKey, string> = {
  image: "none",
  start: "the image's own",
  restart: "no",
  memory: "no limit",
  cpus: "no limit",
  port: "none",
  publish: "not published",
  secrets: "none",
  plain: "none",
  volume: "none",
  ...ROUTE_NOT_SET,
}

/** A restart rule as a person reads it: `on-failure` reads `on failure`. */
export const restartShown = (restart: string): string =>
  restart === "on-failure" ? "on failure" : restart

/** The port row of `zekno settings`: `3000, not published` or `3000, published on 8080`. */
export const portShown = (port: number, publish?: number): string =>
  publish === undefined
    ? `${port}, not published`
    : `${port}, published on ${publish}`
