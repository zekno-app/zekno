/**
 * A secret that stops a deploy before anything is signed, at a terminal and
 * in plain output (specs/014-deploy-v2, contracts/cli.md, "How each is shown"
 * and "Several blocked names"; the board `Deploy2Secrets`; tasks T042 and
 * T048): C4 for a secret set by someone no longer in the team, C5 for one the
 * server holds that this machine cannot check, C5b for one the server holds
 * newer than the one set here. Nothing is drawn before Checked at a terminal
 * (research R17), so each is the sentence alone: ✖ and its first sentence in
 * bold, the rest dim under it, commands without their backticks. Plain output
 * keeps the backticks. Several names give one line each, in name order, and
 * `Nothing was signed.` once.
 */
import { describe, expect, test } from "bun:test"
import type { SecretRecord } from "@workspace/core"

import {
  blockedLines,
  C4,
  C5,
  C5b,
  type BlockedName,
} from "../../../src/shared/deploy-words"
import { COMPOSE_V1, ready, twin } from "../../support/helpers"
import { asReleased } from "../../support/older-runner"
import { teamOfTwo } from "../../support/team-of-two"
import {
  atTerminal,
  drawnError,
  firstAndRest,
  piped,
  type Machine,
} from "./deploy-v2-terminal"

const where = ["--app", "web", "--server", "dev"]

/** Sets `name` to `value` for web on dev on `m`, as a person would. */
async function set(m: Machine, name: string, value: string): Promise<void> {
  m.typing(value)
  expect(await m.zekno("secret", "set", name, ...where)).toBe(0)
}

/**
 * Bea sets `names` for web, deploy 1 carries them to the runner while she is
 * a member, then Ada takes her out of the team list (test/support/team-of-two.ts).
 */
async function afterBeaLeft(names: string[]): Promise<Machine> {
  const m = await ready()
  const t = await teamOfTwo(m)
  const hers: SecretRecord[] = []
  for (const name of names)
    hers.push(await t.sets("web", name, `set-by-bea-${name}`, 1))
  t.keep("web", ...hers)
  expect(await m.zekno("deploy", ...where)).toBe(0)
  await t.remove({ sync: false })
  return m
}

/**
 * `names` set on this machine and deployed in version 1 only, then the runner
 * updated: a second machine without their records cannot check who set them.
 */
async function cannotCheck(names: string[]): Promise<Machine> {
  const m = await ready()
  for (const name of names) await set(m, name, `value-of-${name}`)
  const today = asReleased(m, { web: 1 })
  expect(await m.zekno("deploy", ...where)).toBe(0)
  today()
  const other = await twin(m)
  other.compose(COMPOSE_V1)
  return other
}

/**
 * `names` set and deployed here at version 2; a second machine deploys from
 * the server's records, sets each again (version 3) and deploys. This
 * machine still holds version 2 of each.
 */
async function newerOnServer(names: string[]): Promise<Machine> {
  const m = await ready()
  for (const name of names) {
    await set(m, name, "first")
    await set(m, name, "second")
  }
  expect(await m.zekno("deploy", ...where)).toBe(0)
  const other = await twin(m)
  other.compose(COMPOSE_V1)
  expect(await other.zekno("deploy", ...where)).toBe(0)
  for (const name of names) await set(other, name, "third")
  expect(await other.zekno("deploy", ...where)).toBe(0)
  return m
}

/**
 * Deploys at a terminal and with no terminal, and checks both: the sentence
 * alone at a terminal, nothing drawn before it, ✖ and its first sentence,
 * the rest under it; one line on standard error with no terminal, `said` as
 * it is.
 */
async function stopsWith(m: Machine, said: string): Promise<string[]> {
  const { code, lines } = await atTerminal(m, 100, "deploy", ...where)
  expect(code).toBe(1)
  const drawn = lines.filter(Boolean)
  const [lead, ...under] = drawn
  const { first, rest } = firstAndRest(said)
  expect(lead).toBe(`✖ ${first}`)
  expect(under.every((line) => line.startsWith("  "))).toBe(true)
  expect(under.map((line) => line.trim()).join(" ")).toBe(rest)
  expect(drawn.join("\n")).not.toContain("`")
  const plain = piped(m)
  expect(await m.zekno("deploy", ...where)).toBe(1)
  expect(plain.written).toEqual([{ to: "err", line: said }])
  return drawn
}

describe("C4 (board Deploy2Secrets, 'A secret set by someone no longer in the team')", () => {
  test("at a terminal: the sentence alone, as the board's three lines; with no terminal, one line with its backticks", async () => {
    const m = await afterBeaLeft(["DATABASE_URL"])
    const drawn = await stopsWith(m, C4("DATABASE_URL", "web"))
    expect(drawn).toEqual([
      "✖ DATABASE_URL was set by someone who is no longer in the team, so web cannot be deployed with it.",
      "  Set it again with zekno secret set DATABASE_URL, or remove it with zekno secret rm DATABASE_URL.",
      "  Nothing was signed.",
    ])
  }, 30_000)

  test("two names: one line each, in name order, then `Nothing was signed.` once", async () => {
    const m = await afterBeaLeft(["DATABASE_URL", "API_KEY"])
    const said = `${C4("API_KEY", "web").replace(" Nothing was signed.", "")}\n${C4("DATABASE_URL", "web")}`
    const drawn = await stopsWith(m, said)
    expect(drawn).toEqual([
      "✖ API_KEY was set by someone who is no longer in the team, so web cannot be deployed with it.",
      "  Set it again with zekno secret set API_KEY, or remove it with zekno secret rm API_KEY.",
      "  DATABASE_URL was set by someone who is no longer in the team, so web cannot be deployed with it.",
      "  Set it again with zekno secret set DATABASE_URL, or remove it with zekno secret rm DATABASE_URL.",
      "  Nothing was signed.",
    ])
    expect(said.split("Nothing was signed.")).toHaveLength(2)
  }, 30_000)

  test("its first sentence is bold, and the two commands and `Nothing was signed.` dim, without backticks", () => {
    const [first, ...rest] = drawnError(C4("DATABASE_URL", "shop"))
    expect(first).toEqual([
      { text: "✖", bold: false, dim: false, color: "red" },
      {
        text: "DATABASE_URL was set by someone who is no longer in the team, so shop cannot be deployed with it.",
        bold: true,
        dim: false,
      },
    ])
    expect(rest).toEqual([
      [
        {
          text: "Set it again with zekno secret set DATABASE_URL, or remove it with zekno secret rm DATABASE_URL.",
          bold: false,
          dim: true,
        },
      ],
      [{ text: "Nothing was signed.", bold: false, dim: true }],
    ])
  })
})

describe("C5 (board Deploy2Secrets, 'A secret this machine cannot check')", () => {
  test("at a terminal: the sentence alone, nothing drawn before Checked; with no terminal, one line on standard error", async () => {
    const other = await cannotCheck(["DATABASE_URL"])
    const drawn = await stopsWith(other, C5("DATABASE_URL", "web", "dev"))
    expect(drawn).toEqual([
      "✖ dev holds DATABASE_URL for web, and this machine cannot check who set it.",
      "  Set it again with zekno secret set DATABASE_URL, or remove it with zekno secret rm DATABASE_URL.",
      "  Nothing was signed.",
    ])
  }, 30_000)

  test("two names: two lines, and `Nothing was signed.` once", async () => {
    const other = await cannotCheck(["GREETING", "DATABASE_URL"])
    const drawn = await stopsWith(
      other,
      `${C5("DATABASE_URL", "web", "dev").replace(" Nothing was signed.", "")}\n${C5("GREETING", "web", "dev")}`
    )
    expect(drawn).toEqual([
      "✖ dev holds DATABASE_URL for web, and this machine cannot check who set it.",
      "  Set it again with zekno secret set DATABASE_URL, or remove it with zekno secret rm DATABASE_URL.",
      "  dev holds GREETING for web, and this machine cannot check who set it. Set it again with zekno",
      "  secret set GREETING, or remove it with zekno secret rm GREETING. Nothing was signed.",
    ])
  }, 30_000)
})

describe("C5b, drawn as C5 is", () => {
  test("at a terminal: the sentence alone; with no terminal, one line on standard error", async () => {
    const m = await newerOnServer(["GREETING"])
    const drawn = await stopsWith(m, C5b("GREETING", "web", "dev"))
    expect(drawn[0]).toBe(
      "✖ dev holds a newer GREETING for web than the one set on this machine."
    )
  }, 30_000)

  test("two names: one line each, then `Nothing was signed.` once", async () => {
    const m = await newerOnServer(["GREETING", "API_KEY"])
    const drawn = await stopsWith(
      m,
      `${C5b("API_KEY", "web", "dev").replace(" Nothing was signed.", "")}\n${C5b("GREETING", "web", "dev")}`
    )
    expect(drawn).toEqual([
      "✖ dev holds a newer API_KEY for web than the one set on this machine.",
      "  Set it again with zekno secret set API_KEY to replace it, or remove it with zekno secret rm",
      "  API_KEY.",
      "  dev holds a newer GREETING for web than the one set on this machine. Set it again with zekno",
      "  secret set GREETING to replace it, or remove it with zekno secret rm GREETING. Nothing was signed.",
    ])
  }, 30_000)

  test("C4 and C5b for two names, one of each: each its own line, in name order, the first sentence bold", () => {
    const blocked: BlockedName[] = [
      { name: "GREETING", why: "newer_on_server" },
      { name: "DATABASE_URL", why: "former_member" },
    ]
    const text = blockedLines(blocked, { app: "web", server: "dev" })
    const lines = drawnError(text)
    expect(lines[0]).toEqual([
      { text: "✖", bold: false, dim: false, color: "red" },
      {
        text: "DATABASE_URL was set by someone who is no longer in the team, so web cannot be deployed with it.",
        bold: true,
        dim: false,
      },
    ])
    const rest = lines
      .slice(1)
      .map((runs) => runs.map((run) => run.text).join(" "))
    expect(rest[1]).toBe(
      "dev holds a newer GREETING for web than the one set on this machine. Set it again with zekno"
    )
    expect(rest.at(-1)).toMatch(/Nothing was signed\.$/)
    expect(
      lines
        .slice(1)
        .flat()
        .every((run) => run.dim)
    ).toBe(true)
  })
})
