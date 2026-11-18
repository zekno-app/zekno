/**
 * The lines of deploy version 2 at a terminal and in plain output
 * (specs/014-deploy-v2, contracts/cli.md, "How each is shown"; design/lines.md;
 * the boards `Deploy2Overtaken`, `Deploy2Versions` and `Deploy2Refusals`;
 * tasks T033, T034, T056, T058 and T060). A refusal the runner gives after the
 * deploy was sent, and C1 and C2, are said under the deploy's block, whose
 * stage row ends `✖ Starting`; C7 stops before anything is drawn, so it is the
 * sentence alone (research R17); C6 is a warning above the panel, and the
 * deploy goes on. The secrets that stop a deploy before signing (C4, C5, C5b)
 * are in deploy-v2-secrets.test.tsx.
 *
 * These cases were not added to single-commands.test.tsx, which is over 500
 * lines already (plan.md, "Files over 500 lines are not made longer").
 */
import { describe, expect, test } from "bun:test"
import { RUNNER_PROTOCOL } from "@workspace/core"

import { runner } from "../../../../runner/test/support/helpers"
import { explainDeploy } from "../../../src/cli/errors"
import type { DeployStart } from "../../../src/shared/deploy"
import { C1, C2, C6, C7 } from "../../../src/shared/deploy-words"
import { liveDeploy } from "../../../src/ui/ink/deploy-live"
import { createStore } from "../../../src/ui/ink/store"
import { historyFile, setNumber } from "../../support/deploys"
import { ready } from "../../support/helpers"
import { asReleased, reportingAs } from "../../support/older-runner"
import { wire } from "../../support/wire"
import {
  atTerminal,
  carrying,
  drawnError,
  firstAndRest,
  onScreen,
  piped,
  shownAfter,
  type Machine,
} from "./deploy-v2-terminal"

const where = ["--app", "web", "--server", "dev"]

/** The stage row of a deploy that was refused once it was sent. */
const REFUSED_ROW = "✔ Checked  ✔ Signed  ✔ Sent  ✖ Starting"

/**
 * A machine with two secrets whose runner holds deploy 42 of web, made after
 * 41 as the board's deploy was: one deploy from here, the number as 40 more
 * from elsewhere would leave it, then 42.
 */
async function atFortyTwo(): Promise<Machine> {
  const m = await ready()
  for (const [name, value] of [
    ["DATABASE_URL", "postgres://db"],
    ["SESSION_KEY", "session-key"],
  ] as const) {
    m.typing(value)
    expect(await m.zekno("secret", "set", name, ...where)).toBe(0)
  }
  expect(await m.zekno("deploy", ...where)).toBe(0)
  setNumber(m, "web", 41)
  expect(await m.zekno("deploy", ...where)).toBe(0)
  return m
}

/**
 * The runner's next answer to `status` says 41 for web, as a runner read a
 * moment before another deploy reached it: the deploy is made after 41,
 * refused `replayed`, and the runner read again says 42. Later answers are
 * the runner's own.
 */
function overtaken(m: Machine) {
  const w = wire(m.deps)
  let first = true
  w.rewrite("status", (status) => {
    if (!first) return status
    first = false
    return {
      ...status,
      lastSequence: { ...(status.lastSequence as object), web: 41 },
    }
  })
  return w
}

describe("C1 and C2 at a terminal (board Deploy2Overtaken)", () => {
  test("C1: the panel, ✖ Starting, then ✖ and C1's first sentence, the rest under it; no number is said to be used (C8)", async () => {
    const m = await atFortyTwo()
    const w = overtaken(m)
    const { code, lines } = await atTerminal(m, 100, "deploy", ...where)
    w.restore()
    expect(code).toBe(1)
    expect(lines).toContainEqual(expect.stringMatching(/^╭─ Deploy 42 ─+╮$/))
    expect(lines).toContainEqual(expect.stringMatching(/^│ secrets +2 +│$/))
    expect(shownAfter(lines, REFUSED_ROW)).toEqual([
      "✖ Another deploy of web reached dev first, as deploy 42.",
      "  Nothing of this one ran. Run zekno deploy again to deploy on top of it.",
    ])
    expect(lines.join("\n")).not.toContain("is used")
  }, 30_000)

  test("C1 with no terminal and with --json: the sentence alone on standard error, and nothing on standard output", async () => {
    const m = await atFortyTwo()
    for (const json of [[], ["--json"]]) {
      const w = overtaken(m)
      const plain = piped(m)
      expect(await m.zekno("deploy", ...where, ...json)).toBe(1)
      w.restore()
      expect(plain.written).toEqual([
        { to: "err", line: C1("web", "dev", 42, false) },
      ])
    }
  }, 30_000)

  test("C2: the same block, then ✖ and C2's first sentence, the rest under it", async () => {
    const m = await atFortyTwo()
    // Deploy 42's answer never came, as far as this machine knows.
    m.tamper(historyFile(m, "web"), (history: { outcome: string }[]) =>
      history.map((entry, at) =>
        at === history.length - 1 ? { ...entry, outcome: "sent" } : entry
      )
    )
    const w = overtaken(m)
    const { code, lines } = await atTerminal(m, 100, "deploy", ...where)
    w.restore()
    expect(code).toBe(1)
    expect(lines).toContainEqual(expect.stringMatching(/^╭─ Deploy 42 ─+╮$/))
    expect(shownAfter(lines, REFUSED_ROW)).toEqual([
      "✖ dev holds deploy 42 of web, and this machine signed a deploy 42 whose answer never came.",
      "  zekno cannot tell which of the two ran. Run zekno deploy again to settle it.",
    ])
    expect(lines.join("\n")).not.toContain("is used")
    const again = overtaken(m)
    const plain = piped(m)
    expect(await m.zekno("deploy", ...where)).toBe(1)
    again.restore()
    expect(plain.written).toEqual([{ to: "err", line: C2("web", "dev", 42) }])
  }, 30_000)

  test("the first sentence is bold and the rest dim, as the boards draw them, for C1, C2 and every R-line", () => {
    const reasons = [
      "replayed",
      "sequence_jump",
      "secrets_mismatch",
      "secret_missing",
      "untrusted_secret",
      "expired",
      "unsupported_version",
      "malformed",
    ]
    for (const text of [
      C1("shop", "prod-1", 42, false),
      C1("shop", "prod-1", 42, true),
      C2("shop", "prod-1", 42),
      ...reasons.map((reason) => explainDeploy(reason, 2)),
    ]) {
      const [first, ...rest] = drawnError(text)
      expect(first).toEqual([
        { text: "✖", bold: false, dim: false, color: "red" },
        { text: firstAndRest(text).first, bold: true, dim: false },
      ])
      expect(rest.flat().map((run) => run.dim)).not.toContain(false)
      expect(
        rest
          .flat()
          .map((run) => run.text)
          .join(" ")
      ).toBe(firstAndRest(text).rest)
    }
  })
})

describe("a refusal after the deploy was sent, from a stand-in runner (board Deploy2Refusals)", () => {
  /**
   * Makes `m`'s local runner a stand-in that answers each request of its
   * session in turn, framed as the runner of this repository frames them,
   * then waits for the session to end: `version` as a runner that carries out
   * version 2, `status` as `m`'s own runner answers it, no record held, and
   * the deploy refused for `reason`. After `replayed` the CLI reads the
   * runner again (contracts/cli.md, "C1, C2 and R1"): it is told the same
   * number, so it says R1.
   */
  async function refusing(m: Machine, reason: string): Promise<void> {
    const status = (await runner(m.runnerHome, m.docker.path, "status")).json
    const answers: unknown[] = [
      { version: "0.1.0", protocol: RUNNER_PROTOCOL },
      status,
      { statements: [] },
      { outcome: "refused", reason },
      ...(reason === "replayed" ? [status] : []),
    ]
    const steps = answers.map(
      (answer) =>
        `read -r l; printf '%s\\n' '${JSON.stringify({ result: answer })}'`
    )
    m.deps.localRunner = ["sh", "-c", [...steps, "read -r l"].join("; ")]
  }

  const cases: [string, string][] = [
    ["R1", "replayed"],
    ["R2", "sequence_jump"],
    ["R3", "secrets_mismatch"],
    ["R4", "secret_missing"],
    ["R5", "untrusted_secret"],
    ["R6", "expired"],
    ["R7", "unsupported_version"],
    ["R8", "malformed"],
    ["R8", "wrong_payload_type"],
  ]
  for (const [id, reason] of cases) {
    test(`${id} (${reason}) at ✖ Starting: the panel, the stage row, then ✖ and its first sentence, the rest under it; no number is said to be used`, async () => {
      const m = await ready()
      expect(await m.zekno("deploy", ...where)).toBe(0)
      const sentence = explainDeploy(reason, 2)
      await refusing(m, reason)
      const { code, lines } = await atTerminal(m, 100, "deploy", ...where)
      expect(code).toBe(1)
      expect(lines).toContainEqual(expect.stringMatching(/^╭─ Deploy 2 ─+╮$/))
      const [lead, ...under] = shownAfter(lines, REFUSED_ROW)
      const { first, rest } = firstAndRest(sentence)
      expect(lead).toBe(`✖ ${first}`)
      expect(under.length).toBeGreaterThan(0)
      expect(under.every((line) => line.startsWith("  "))).toBe(true)
      expect(under.map((line) => line.trim()).join(" ")).toBe(rest)
      expect(lines.join("\n")).not.toContain("is used")

      // With no terminal: the sentence on standard error, and nothing else.
      await refusing(m, reason)
      const plain = piped(m)
      expect(await m.zekno("deploy", ...where)).toBe(1)
      expect(plain.written).toEqual([{ to: "err", line: sentence }])
    }, 30_000)
  }

  test("R5 as the board's fourth panel draws it: two lines at 100 columns", async () => {
    const m = await ready()
    expect(await m.zekno("deploy", ...where)).toBe(0)
    await refusing(m, "untrusted_secret")
    const { lines } = await atTerminal(m, 100, "deploy", ...where)
    expect(shownAfter(lines, REFUSED_ROW)).toEqual([
      "✖ A secret of this app was set by someone who is no longer in the team.",
      "  Nothing of this deploy ran. Set it again with zekno secret set, or remove it with zekno secret rm.",
    ])
  }, 30_000)
})

describe("C6 and C7 at a terminal (board Deploy2Versions)", () => {
  test("C6: ! and the sentence above the deploy's panel, then the deploy ✔ Started", async () => {
    const m = await ready()
    asReleased(m, { web: 1 })
    carrying(m, "0.1.1")
    const { code, lines } = await atTerminal(m, 100, "deploy", ...where)
    expect(code).toBe(0)
    const warned = lines.indexOf(
      "! The runner on dev is version 0.1.0, older than this zekno's 0.1.1, so this deploy was signed in"
    )
    expect(warned).toBeGreaterThanOrEqual(0)
    expect(lines[warned + 1]).toBe(
      "  the older format. Run `zekno server update dev` to bring it to 0.1.1."
    )
    const panel = lines.findIndex((line) => /^╭─ Deploy 2 ─+╮$/.test(line))
    expect(panel).toBeGreaterThan(warned + 1)
    expect(lines).toContain("✔ Checked  ✔ Signed  ✔ Sent  ✔ Started")
    expect(lines).toContainEqual(
      expect.stringMatching(/^✔ web is live on dev in \d+\.\ds$/)
    )
    // Said once.
    expect(lines.filter((line) => line.startsWith("! "))).toHaveLength(1)

    // On a terminal that redraws the live block in place, the screen reads the same: the warning, then the panel.
    const redrawn = await onScreen(m, 100, "deploy", ...where)
    expect(redrawn.code).toBe(0)
    const screen = redrawn.lines.filter(Boolean)
    const top = screen.findIndex((line) => line.startsWith("! The runner"))
    expect(top).toBeGreaterThanOrEqual(0)
    expect(screen[top + 2]).toMatch(/^╭─ Deploy 3 ─+╮$/)
    expect(screen).toContain("✔ Checked  ✔ Signed  ✔ Sent  ✔ Started")
    expect(screen.filter((line) => line.startsWith("! "))).toHaveLength(1)
  }, 30_000)

  test("C6 with no terminal is a line on standard error before the result; with --json it is not in the object", async () => {
    const m = await ready()
    asReleased(m, { web: 1 })
    carrying(m, "0.1.1")
    const c6 = C6("dev", "0.1.0", "0.1.1")
    const plain = piped(m)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(plain.written).toEqual([
      { to: "err", line: c6 },
      { to: "out", line: "Deploy 2 of web is running on dev with no secrets." },
    ])
    plain.clear()
    expect(await m.zekno("deploy", ...where, "--json")).toBe(0)
    expect(plain.written).toEqual([
      { to: "err", line: c6 },
      {
        to: "out",
        line: '{"outcome":"started","app":"web","sequence":3,"server":"dev"}',
      },
    ])
  }, 30_000)

  test("C7: the sentence alone, ✖ and its first sentence, nothing drawn before it; with no terminal one line on standard error", async () => {
    const m = await ready()
    reportingAs(m, "0.2.0", RUNNER_PROTOCOL + 1)
    carrying(m, "0.1.1")
    const { code, lines } = await atTerminal(m, 100, "deploy", ...where)
    expect(code).toBe(1)
    expect(lines.filter(Boolean)).toEqual([
      "✖ The runner on dev is version 0.2.0, newer than this zekno's 0.1.1, and speaks a newer protocol.",
      "  Update zekno to deploy to dev. Nothing was signed.",
    ])
    const plain = piped(m)
    expect(await m.zekno("deploy", ...where)).toBe(1)
    expect(plain.written).toEqual([
      { to: "err", line: C7("dev", "0.2.0", "0.1.1") },
    ])
  }, 30_000)
})

describe("the deploy as the terminal keeps it (research R19)", () => {
  const START: DeployStart = { app: "web", server: "dev", flags: "" }
  const info = (format: 1 | 2) => ({
    app: "web",
    server: "dev",
    sequence: 7,
    secrets: 1,
    secretNames: ["API_KEY"],
    format,
  })

  test("the format each stage gives is kept, through a refusal, so the number is not said to be used on version 2", async () => {
    for (const format of [1, 2] as const) {
      const store = createStore()
      const added: Record<string, unknown>[] = []
      const view = liveDeploy(START, store, (item) => void added.push(item), {
        waitUntilRenderFlush: async () => {},
      })
      view.stage("checked", info(format))
      expect(store.get().deploy?.deploy.format).toBe(format)
      view.stage("signed", info(format))
      view.stage("sent", info(format))
      await view.end({ outcome: "error" })
      const ended = added[0] as {
        shown: { deploy: { format?: number; stage?: string } }
      }
      expect(ended.shown.deploy).toMatchObject({ format, stage: "sent" })
    }
  })
})
