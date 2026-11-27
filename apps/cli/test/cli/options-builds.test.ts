/**
 * The three options of feature 016 (specs/016-build-from-source,
 * contracts/cli.md CL12; tasks T135): `--fresh` is taken by `zekno deploy`
 * only, `--build` by `zekno logs` only and `--builds` by `zekno doctor`
 * only. On any other command each is an unknown option, refused exactly as
 * an option no command takes is, exit status 2. The help lines come later
 * (T155): none is checked here. Each run has a profile folder of its own.
 */
import { describe, expect, test } from "bun:test"
import { parseArgs } from "node:util"

import { parsed } from "../../src/cli/options"
import { machine } from "../support/helpers"

/** What parsing says of `option` given to a command that does not take it: the first line of the refusal. */
function unknown(option: string): string {
  try {
    parseArgs({ args: [option], strict: true, options: {} })
  } catch (error) {
    return (error as Error).message
  }
  throw new Error(`${option} was taken`)
}

const OWNERS = {
  "--fresh": ["deploy"],
  "--build": ["logs"],
  "--builds": ["doctor"],
} as const

/** Each command a person types, as its words, with what it needs to get past its own checks of the words. */
const COMMANDS: string[][] = [
  ["deploy"],
  ["rollback"],
  ["logs"],
  ["doctor"],
  ["status"],
  ["init"],
  ["link"],
  ["version"],
  ["server", "ls"],
  ["server", "add", "prod"],
  ["secret", "ls"],
  ["settings"],
  ["settings", "compose"],
  ["domain"],
  ["add", "postgres"],
]

describe("parsed", () => {
  test("each option on its command", () => {
    expect(parsed(["deploy", "--fresh"]).values.fresh).toBe(true)
    expect(parsed(["logs", "--build"]).values.build).toBe(true)
    expect(parsed(["doctor", "--builds"]).values.builds).toBe(true)
    // Beside the options its command took before.
    expect(
      parsed(["logs", "--build", "--app", "shop", "--server", "prod"]).values
    ).toMatchObject({ build: true, app: "shop", server: "prod" })
    expect(
      parsed(["deploy", "--fresh", "--skip-dns-check"]).values
    ).toMatchObject({ fresh: true, "skip-dns-check": true })
  })

  test("each option on every other command: refused as an unknown option", () => {
    for (const [option, owners] of Object.entries(OWNERS))
      for (const words of COMMANDS) {
        if ((owners as readonly string[]).includes(words[0]!)) continue
        expect(() => parsed([...words, option])).toThrow(unknown(option))
      }
  })

  test("none takes a value", () => {
    expect(() => parsed(["deploy", "--fresh=yes"])).toThrow()
    expect(() => parsed(["logs", "--build=web"])).toThrow()
    expect(() => parsed(["doctor", "--builds=all"])).toThrow()
  })
})

describe("run", () => {
  test("on another command: exit status 2, the refusal of an unknown option, nothing written in the profile folder", async () => {
    for (const [option, owners] of Object.entries(OWNERS))
      for (const words of COMMANDS) {
        if ((owners as readonly string[]).includes(words[0]!)) continue
        const m = machine()
        expect(await m.zekno(...words, option)).toBe(2)
        expect(m.err[0]).toStartWith(unknown(option))
        expect(m.out).toEqual([])
      }
  })

  test("on its own command it is not refused as an option", async () => {
    for (const [option, owners] of Object.entries(OWNERS))
      for (const command of owners) {
        const m = machine()
        await m.zekno(command, option)
        expect(m.err.some((line) => line.startsWith(unknown(option)))).toBe(
          false
        )
      }
  })
})
