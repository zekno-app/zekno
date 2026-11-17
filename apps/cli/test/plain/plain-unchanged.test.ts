/**
 * FR-028 and SC-006 (specs/006-cli-small-features): with no terminal, every
 * command that existed before feature 006 makes the same calls in the same
 * order, writes the same lines on the same streams and ends with the same
 * exit status as at 5264e8a. The scenes are in plain-scenes.ts; what they
 * did at 5264e8a is in plain-at-head.ts.
 *
 * The one difference allowed is the help text, which gains the lines of the
 * new commands (contracts/help.md). A transcript holds the help as a mark,
 * and the help itself is compared here line by line.
 */
import { describe, expect, test } from "bun:test"

import { HELP } from "../../src/cli/cli"
import { machine } from "../support/helpers"
import { AT_HEAD, HELP_AT_HEAD } from "./plain-at-head"
import { SCENES } from "./plain-scenes"

/** The lines feature 006 adds to the help, exactly as contracts/help.md writes them, and those of feature 010 (specs/010-app-settings, contracts/commands.md). Nothing else may change. */
const ADDED_TO_HELP = [
  "  zekno secret import <file> [--app <app>] [--server <name>] [--yes]",
  "  zekno doctor [--server <name>] [--json]",
  "  zekno version [--json]",
  "  zekno --version [--json]",
  "At a terminal a command asks for a server or an app it was not given, and `zekno deploy` sets up what a first deploy needs. In a script it asks nothing.",
  // feature 010
  "  zekno settings [--json]",
  "  zekno settings set <service>.<setting> <value> [--yes]",
  "  zekno settings unset <service>.<setting> [--yes]",
  "  zekno settings compose",
  "  zekno settings init",
  // feature 012
  "  zekno add [<template>] [--name <service>] [--for <service>] [--app <app>] [--server <name>] [--yes]",
]

describe("with no terminal, every command does what it did before feature 006 (FR-028)", () => {
  test("the help is the help of 5264e8a with only the new commands' lines added", () => {
    expect(
      HELP.split("\n").filter((line) => !ADDED_TO_HELP.includes(line))
    ).toEqual(HELP_AT_HEAD.split("\n"))
  })

  for (const [name, scene] of Object.entries(SCENES)) {
    test(`${name}: the same calls, lines and exit status, command by command`, async () => {
      const done = await scene()
      expect(
        done.map((record): [string, number, string[]] => [
          record.argv.join(" "),
          record.code,
          record.calls,
        ])
      ).toEqual(AT_HEAD[name]!)
    }, 60_000)
  }
})

describe("an option only zekno add reads, given to another command (specs/012-templates, research R9)", () => {
  /** What parsing the arguments said before feature 012 for an option it did not know, with the help line. */
  const unknown = (option: string) =>
    `Unknown option '${option}'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "${option}"\nRun \`zekno --help\` for the list of commands.`

  test("zekno deploy --for web and zekno status --for web: today's sentence, status 2, nothing else done", async () => {
    for (const argv of [
      ["deploy", "--for", "web"],
      ["status", "--for", "web"],
      ["deploy", "--for=web"],
      ["deploy", "--for"],
      ["--help", "--for", "web"],
      ["secret", "ls", "--app", "demo", "--for", "web"],
    ]) {
      const m = machine()
      const code = await m.zekno(...argv)
      expect({ argv, code, out: m.out, err: m.err }).toEqual({
        argv,
        code: 2,
        out: [],
        err: [unknown("--for")],
      })
    }
  })
})
