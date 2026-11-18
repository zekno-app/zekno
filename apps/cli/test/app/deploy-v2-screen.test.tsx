/**
 * The app's deploy screen with deploy version 2, drawn from the reducer's
 * events (specs/014-deploy-v2, contracts/cli.md, "How each is shown", the
 * app's part; design/lines.md, parts A and C8; research R19 and R20; tasks
 * T033, T034, T042, T048 and T056). A refusal and the C-lines are the result
 * line in the error colour, under the panel and the stage row; a stop before
 * signing (C4, C5, C5b, C7) leaves the panel and
 * `✖ Checked ○ Signed ○ Sent ○ Starting`, as the boards draw it; C6 is a
 * warning notice while the deploy runs; `Number <N> is used` is left out after
 * a version-2 deploy that ended in error, and kept when the app did not start
 * and for version 1; from Checked on the panel names the secrets the deploy
 * lists, a secret only the server holds among them. The same against a runner,
 * through the app's effects, is deploy-v2-effects.test.tsx.
 *
 * These cases were not added to app-operate.test.tsx and app-state.test.ts,
 * which are over 500 lines already (plan.md, "Files over 500 lines are not
 * made longer").
 */
import { describe, expect, test } from "bun:test"
import { renderToString } from "ink"
import { join } from "node:path"

import { AppView } from "../../src/app/app"
import { explainDeploy } from "../../src/cli/errors"
import type { AppEvent } from "../../src/app/state/events"
import { initialState, update } from "../../src/app/state/state"
import type { State, TeamView } from "../../src/app/state/types"
import type { DeployProgress } from "../../src/shared/deploy"
import {
  blockedLines,
  C1,
  C4,
  C5,
  C5b,
  C6,
  C7,
} from "../../src/shared/deploy-words"
import { numberUsed } from "../../src/ui/parts/deploy-summary"
import { drawnInColour, plainOf, runsOf } from "../support/colour"

const SIZE = { columns: 100, rows: 30 }

const TEAM: TeamView = {
  member: "ada",
  version: 2,
  servers: [
    {
      name: "prod-1",
      destination: "deploy@203.0.113.7",
      reachable: true,
      apps: [{ name: "shop", deploy: 41, state: "unknown" }],
    },
  ],
}

const play = (state: State, ...events: AppEvent[]): State =>
  events.reduce((current, event) => update(current, event).state, state)

/** The window as the app draws it. */
const draw = (state: State) =>
  renderToString(
    <AppView state={state} columns={SIZE.columns} rows={SIZE.rows} />,
    { columns: SIZE.columns }
  )
/** All the text, with the box lines and runs of spaces taken out, for wording that may wrap. */
const words = (screen: string) =>
  screen.replace(/[│╭╮╰╯─]/g, " ").replace(/\s+/g, " ")

/** The window's lines as a terminal that shows colours receives them, each as runs in one look. */
const inColour = (state: State) =>
  drawnInColour(join(import.meta.dir, "../../src/app/app.tsx"), "AppView", {
    state,
    columns: SIZE.columns,
    rows: SIZE.rows,
  }).split("\n")

/** A deploy of shop on prod-1 started from the app, this machine holding two of its secrets. */
const started = (names = ["DATABASE_URL", "SESSION_KEY"]): AppEvent => ({
  type: "deploy-started",
  server: "prod-1",
  app: "shop",
  at: Date.now() - 4200,
  from: "~/code/shop/compose.yaml",
  replaces: 41,
  secretNames: names,
})

/** A stage of deploy 42, signed in `format`, listing two secrets. */
const stage = (
  reached: "checked" | "signed" | "sent" | "failed",
  format: 1 | 2 = 2
): AppEvent => ({
  type: "deploy-stage",
  stage: reached,
  sequence: 42,
  secrets: 2,
  secretNames: ["DATABASE_URL", "SESSION_KEY"],
  format,
})

/** How the deploy ended, with its result line in the error colour. */
const ended = (
  text: string,
  outcome: "error" | "start_failed" = "error"
): AppEvent => ({
  type: "deploy-ended",
  outcome,
  notice: { tone: "error", text },
  at: Date.now(),
})

const onHome = () => initialState({ kind: "team", team: TEAM }, SIZE)

/** A deploy of version `format` refused once it was sent, with `text` as its result line. */
const refusedAfterSent = (text: string, format: 1 | 2 = 2) =>
  play(
    onHome(),
    started(),
    stage("checked", format),
    stage("signed", format),
    stage("sent", format),
    ended(text)
  )

describe("the deploy screen: what the deploy lists, from Checked on (research R20)", () => {
  test("deploy-stage carries the format and the names; the panel names them from Checked on, a secret only the server holds among them", () => {
    const before = play(onHome(), started(["DATABASE_URL"]))
    expect(words(draw(before))).toContain("secrets 1 (DATABASE_URL)")
    const checked = play(before, {
      type: "deploy-stage",
      stage: "checked",
      sequence: 42,
      secrets: 3,
      secretNames: ["API_KEY", "DATABASE_URL", "SESSION_KEY"],
      format: 2,
    })
    expect(checked.deploy).toMatchObject({
      format: 2,
      secrets: 3,
      secretNames: ["API_KEY", "DATABASE_URL", "SESSION_KEY"],
    })
    expect(words(draw(checked))).toContain(
      "secrets 3 (API_KEY, DATABASE_URL, SESSION_KEY)"
    )
    // A stage that does not say them keeps what the deploy had.
    const signed = play(checked, {
      type: "deploy-stage",
      stage: "signed",
      sequence: 42,
      secrets: 3,
    })
    expect(signed.deploy).toMatchObject({
      stage: "signed",
      format: 2,
      secretNames: ["API_KEY", "DATABASE_URL", "SESSION_KEY"],
    })
  })
})

describe("the deploy screen after a refusal (board Deploy2Refusals, 'One line of the app's deploy screen changes')", () => {
  test("C1 is the result line in the error colour, under ✖ Starting, and `Number 42 is used` is left out (C8)", () => {
    const text = C1("shop", "prod-1", 42, false)
    const state = refusedAfterSent(text)
    const screen = draw(state)
    expect(screen).toMatch(/✔ Checked +✔ Signed +✔ Sent +✖ Starting/)
    expect(words(screen)).toContain(`✖ ${text}`)
    expect(screen).not.toContain("is used")
    // The ✖ before it is drawn in the error colour, and the line comes after the stage row.
    const lines = inColour(state)
    const row = lines.findIndex((line) => plainOf(line).includes("✖ Starting"))
    const result = lines.findIndex((line) =>
      plainOf(line).includes("✖ Another deploy of shop")
    )
    expect(result).toBeGreaterThan(row)
    expect(runsOf(lines[result]!).find((run) => run.text === "✖")).toEqual({
      text: "✖",
      bold: false,
      dim: false,
      color: "red",
    })
  })

  test("the number is still said to be used when the app did not start, and after a refusal of a version-1 deploy", () => {
    const failed = play(
      onHome(),
      started(),
      stage("checked"),
      stage("signed"),
      stage("sent"),
      stage("failed"),
      ended(
        "prod-1 accepted deploy 42, but the app did not start.",
        "start_failed"
      )
    )
    expect(draw(failed)).toContain(
      "Number 42 is used, so the next deploy will be 43."
    )
    const versionOne = refusedAfterSent(
      "The runner is in the middle of another deploy. Try again in a moment.",
      1
    )
    expect(draw(versionOne)).toContain(
      "Number 42 is used, so the next deploy will be 43."
    )
  })

  test("numberUsed: false once a version-2 deploy ended in error; as before otherwise", () => {
    const base: DeployProgress = {
      server: "prod-1",
      app: "shop",
      sequence: 42,
      stage: "sent",
      lines: [],
      running: false,
      outcome: "error",
      since: 0,
    }
    expect(numberUsed({ ...base, format: 2 })).toBe(false)
    expect(numberUsed({ ...base, format: 2, stage: "starting" })).toBe(false)
    expect(numberUsed({ ...base, format: 1 })).toBe(true)
    // A deploy whose format is not known, as kept before this feature: as before.
    expect(numberUsed(base)).toBe(true)
    expect(
      numberUsed({
        ...base,
        format: 2,
        stage: "failed",
        outcome: "start_failed",
      })
    ).toBe(true)
  })

  test("each R-line is the result line under ✖ Starting, and no number is said to be used", () => {
    for (const reason of [
      "replayed",
      "sequence_jump",
      "secrets_mismatch",
      "secret_missing",
      "untrusted_secret",
      "expired",
      "unsupported_version",
      "malformed",
      "wrong_payload_type",
    ]) {
      const text = explainDeploy(reason, 2)
      const screen = draw(refusedAfterSent(text))
      expect(screen).toMatch(/✔ Checked +✔ Signed +✔ Sent +✖ Starting/)
      expect(words(screen)).toContain(`✖ ${text}`)
      expect(screen).not.toContain("is used")
    }
  })

  test("a stop before signing (C4, C5, C5b, C7): the panel, ✖ Checked ○ Signed ○ Sent ○ Starting, and the sentence under them", () => {
    for (const text of [
      C4("DATABASE_URL", "shop"),
      C5("API_KEY", "shop", "prod-1"),
      C5b("API_KEY", "shop", "prod-1"),
      C7("prod-1", "0.1.2", "0.1.1"),
    ]) {
      const state = play(onHome(), started(), ended(text))
      const screen = draw(state)
      expect(screen).toMatch(/╭─ Deploy ─+╮/)
      expect(screen).toMatch(/✖ Checked +○ Signed +○ Sent +○ Starting/)
      expect(words(screen)).toContain(`✖ ${text}`)
      expect(screen).not.toContain("is used")
      const lines = screen.split("\n")
      expect(
        lines.findIndex((line) => line.includes(`✖ ${text.slice(0, 20)}`))
      ).toBeGreaterThan(lines.findIndex((line) => line.includes("✖ Checked")))
    }
  })

  test("two blocked names: one line each, and `Nothing was signed.` once", () => {
    const text = blockedLines(
      [
        { name: "DATABASE_URL", why: "former_member" },
        { name: "API_KEY", why: "newer_on_server" },
      ],
      { app: "shop", server: "prod-1" }
    )
    const screen = draw(play(onHome(), started(), ended(text)))
    const said = words(screen)
    expect(said).toContain(
      "prod-1 holds a newer API_KEY for shop than the one set on this machine."
    )
    expect(said).toContain(
      "DATABASE_URL was set by someone who is no longer in the team, so shop cannot be deployed with it."
    )
    expect(said.split("Nothing was signed.")).toHaveLength(2)
    // The second name starts a line of its own.
    expect(screen.split("\n")).toContainEqual(
      expect.stringMatching(/^ +DATABASE_URL was set by someone/)
    )
  })

  test("C6 is a warning notice while the deploy runs, in the warning colour", () => {
    const text = C6("prod-1", "0.1.0", "0.1.1")
    const state = play(
      onHome(),
      started(),
      stage("checked", 1),
      stage("signed", 1),
      { type: "notice", notice: { tone: "warning", text } }
    )
    expect(words(draw(state))).toContain(`! ${text}`)
    const lines = inColour(state)
    const warned = lines.find((line) => plainOf(line).includes("! The runner"))
    expect(runsOf(warned!).find((run) => run.text.startsWith("!"))).toEqual({
      text: "!",
      bold: false,
      dim: false,
      color: "yellow",
    })
  })
})
