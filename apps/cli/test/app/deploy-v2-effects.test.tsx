/**
 * The app's deploys with deploy version 2, against the runner of this
 * repository, through the app's effects as app.tsx makes them
 * (specs/014-deploy-v2, contracts/cli.md, "How each is shown", the app's part;
 * research R19 and R20; tasks T033, T034, T042 and T056): every stage carries
 * the format and the names the deploy lists, and the deploy screen shows C1
 * under `✖ Starting` without `Number <N> is used`, a refusal of version 1 with
 * it, C6 as a warning notice while the deploy runs, and C5 and C7 under the
 * panel and `✖ Checked`. Drawn from the reducer's events alone:
 * deploy-v2-screen.test.tsx.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { RUNNER_PROTOCOL } from "@workspace/core"
import { renderToString } from "ink"

import { waitFor } from "../../../runner/test/support/helpers"
import { AppView, createStore } from "../../src/app/app"
import { createEffects, type Effects } from "../../src/app/effects/effects"
import { loadStart } from "../../src/app/effects/profile"
import type { AppEvent } from "../../src/app/state/events"
import { initialState } from "../../src/app/state/state"
import type { State } from "../../src/app/state/types"
import { C1, C5, C6, C7 } from "../../src/shared/deploy-words"
import { stoppedWaiting } from "../../src/shared/start-limit"
import { withoutBackticks } from "../../src/ui/ink/marks"
import { setNumber } from "../support/deploys"
import { ready, twin, type machine } from "../support/helpers"
import { asReleased, reportingAs } from "../support/older-runner"
import { wire } from "../support/wire"

type Machine = ReturnType<typeof machine>

const SIZE = { columns: 100, rows: 30 }

/** The window as the app draws it. */
const draw = (state: State) =>
  renderToString(
    <AppView state={state} columns={SIZE.columns} rows={SIZE.rows} />,
    { columns: SIZE.columns }
  )
/** All the text, with the box lines and runs of spaces taken out, for wording that may wrap. */
const words = (screen: string) =>
  screen.replace(/[│╭╮╰╯─]/g, " ").replace(/\s+/g, " ")

/** The effects of every app a test opened: closed after each test, so no runner it reached is left running. */
const opened: Effects[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((effects) => effects.close()))
})

const where = ["--app", "web", "--server", "dev"]
/** A Compose file that expects no value, so `d` asks nothing before it deploys. */
const PLAIN = "services:\n  web:\n    image: example/web:1\n"

/** `m`'s folder holding PLAIN, linked to web on dev, so `d` deploys it at once. */
async function linked(m: Machine): Promise<void> {
  m.compose(PLAIN)
  expect(await m.zekno("link", ...where)).toBe(0)
}

/** Sets `name` for web on dev, as a person would. */
async function set(m: Machine, name: string, value: string): Promise<void> {
  m.typing(value)
  expect(await m.zekno("secret", "set", name, ...where)).toBe(0)
}

/** This zekno, as one built to carry runner `version`. */
const carrying = (m: Machine, version: string) =>
  (m.deps.release = {
    version,
    files: { "linux-x64": { sha256: null }, "linux-arm64": { sha256: null } },
  })

/**
 * The app on `m`, made as app.tsx makes it, with what it opened on: every
 * event its effects send is kept, in order, and goes to its reducer. `d` is a
 * deploy of web on dev, as `d` on the app's screen asks for it.
 */
async function appOn(m: Machine) {
  const events: AppEvent[] = []
  const failures: unknown[] = []
  const start = await loadStart(m.deps)
  let effects: Effects | undefined
  const store = createStore(initialState(start, SIZE), (effect) => {
    if (effect.kind !== "exit") effects!.run(effect)
  })
  effects = createEffects(
    m.deps,
    (event) => {
      events.push(event)
      store.dispatch(event)
    },
    (error) => failures.push(error),
    undefined,
    {},
    start
  )
  opened.push(effects)
  return {
    events,
    failures,
    get state() {
      return store.get()
    },
    d: () => effects!.run({ kind: "deploy", server: "dev", app: "web" }),
    ended: () =>
      waitFor(() => store.get().deploy?.running === false, "the deploy to end"),
    draw: () => draw(store.get()),
    stages: () =>
      events.filter(
        (event): event is Extract<AppEvent, { type: "deploy-stage" }> =>
          event.type === "deploy-stage"
      ),
  }
}

describe("the app's deploys against a runner", () => {
  test("each stage carries the format and the names the deploy lists; a machine with no record names the server's secrets from Checked on", async () => {
    const m = await ready()
    for (const name of ["API_KEY", "DATABASE_URL", "GREETING"])
      await set(m, name, `value-of-${name}`)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    const other = await twin(m)
    await linked(other)
    const app = await appOn(other)
    app.d()
    await app.ended()
    expect(app.failures).toEqual([])
    const startedWith = app.events.find(
      (event) => event.type === "deploy-started"
    )
    expect(startedWith).toMatchObject({ secretNames: [] })
    const stages = app.stages()
    expect(stages.map((event) => event.stage)).toEqual([
      "checked",
      "signed",
      "sent",
      "starting",
      "started",
    ])
    for (const event of stages)
      expect(event).toMatchObject({
        format: 2,
        secrets: 3,
        secretNames: ["API_KEY", "DATABASE_URL", "GREETING"],
      })
    expect(app.state.deploy).toMatchObject({ format: 2, outcome: "started" })
    expect(words(app.draw())).toContain(
      "secrets 3 (API_KEY, DATABASE_URL, GREETING)"
    )
    // Names only: no value is in the app's state, its events or on its screen.
    for (const held of [
      JSON.stringify(app.state),
      JSON.stringify(app.events),
      app.draw(),
    ])
      expect(held).not.toContain("value-of-")
  }, 30_000)

  test("C1: the result line under ✖ Starting, and no number said to be used", async () => {
    const m = await ready()
    await linked(m)
    await set(m, "DATABASE_URL", "postgres://db")
    expect(await m.zekno("deploy", ...where)).toBe(0)
    setNumber(m, "web", 41)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    const app = await appOn(m)
    // The runner's next `status` says 41, as one read a moment before another deploy reached it.
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
    app.d()
    await app.ended()
    w.restore()
    expect(app.state.deploy).toMatchObject({
      format: 2,
      sequence: 42,
      stage: "sent",
      outcome: "error",
      result: { tone: "error", text: C1("web", "dev", 42, false) },
    })
    const screen = app.draw()
    expect(screen).toMatch(/✔ Checked +✔ Signed +✔ Sent +✖ Starting/)
    expect(words(screen)).toContain(`✖ ${C1("web", "dev", 42, false)}`)
    expect(screen).not.toContain("is used")
  }, 30_000)

  test("a refusal of a version-1 deploy still says its number is used", async () => {
    const m = await ready()
    await linked(m)
    asReleased(m, { web: 1 })
    const app = await appOn(m)
    const w = wire(m.deps)
    w.rewrite("apply", () => ({ outcome: "refused", reason: "busy" }))
    app.d()
    await app.ended()
    w.restore()
    expect(app.state.deploy).toMatchObject({
      format: 1,
      sequence: 2,
      outcome: "error",
    })
    expect(app.draw()).toContain(
      "Number 2 is used, so the next deploy will be 3."
    )
  }, 30_000)

  test("C6: a warning notice on the deploy screen while the deploy runs; the deploy then starts", async () => {
    const m = await ready()
    await linked(m)
    asReleased(m, { web: 1 })
    carrying(m, "0.1.1")
    const app = await appOn(m)
    m.docker.holdUp()
    app.d()
    await waitFor(() => m.docker.upStarted(), "Docker's up")
    expect(app.state.notice).toEqual({
      tone: "warning",
      text: C6("dev", "0.1.0", "0.1.1"),
    })
    expect(words(app.draw())).toContain(`! ${C6("dev", "0.1.0", "0.1.1")}`)
    m.docker.releaseUp()
    await app.ended()
    expect(app.state.deploy).toMatchObject({ format: 1, outcome: "started" })
    expect(app.draw()).toMatch(/✔ Checked +✔ Signed +✔ Sent +✔ Started/)
  }, 30_000)

  test("C7: the panel, ✖ Checked, and the sentence under them; nothing signed", async () => {
    const m = await ready()
    await linked(m)
    reportingAs(m, "0.2.0", RUNNER_PROTOCOL + 1)
    carrying(m, "0.1.1")
    const app = await appOn(m)
    app.d()
    await app.ended()
    expect(app.stages()).toEqual([])
    const screen = app.draw()
    expect(screen).toMatch(/╭─ Deploy ─+╮/)
    expect(screen).toMatch(/✖ Checked +○ Signed +○ Sent +○ Starting/)
    expect(words(screen)).toContain(`✖ ${C7("dev", "0.2.0", "0.1.1")}`)
  }, 30_000)

  test("C5: the panel, ✖ Checked, and the sentence under them, as the board Deploy2Secrets", async () => {
    const m = await ready()
    await set(m, "API_KEY", "key-one")
    const today = asReleased(m, { web: 1 })
    expect(await m.zekno("deploy", ...where)).toBe(0)
    today()
    const other = await twin(m)
    await linked(other)
    const app = await appOn(other)
    app.d()
    await app.ended()
    expect(app.stages()).toEqual([])
    const screen = app.draw()
    expect(screen).toMatch(/╭─ Deploy ─+╮/)
    expect(screen).toMatch(/✖ Checked +○ Signed +○ Sent +○ Starting/)
    // Its commands are drawn without their backticks, as at a terminal (test/app/notice.test.tsx).
    expect(words(screen)).toContain(
      `✖ ${withoutBackticks(C5("API_KEY", "web", "dev"))}`
    )
  }, 30_000)
})

describe("B20: a start the runner stopped waiting for (lead A10)", () => {
  test("the result line says it in place of today's; the number used and Docker said stay", async () => {
    const m = await ready()
    await linked(m)
    m.docker.upPrints({ stderr: " Container web-db-1  Waiting\n" })
    const app = await appOn(m)
    // The runner's answer, as it gives it when `up` did not end within its limit.
    const w = wire(m.deps)
    w.rewrite("deploy", (result) => ({
      ...result,
      outcome: "start_failed",
      startLimit: 1800,
    }))
    app.d()
    await app.ended()
    w.restore()
    expect(app.failures).toEqual([])
    const said = stoppedWaiting("dev", 1, "web", 1800)
    expect(app.state.deploy).toMatchObject({
      sequence: 1,
      outcome: "start_failed",
      result: { tone: "error", text: said },
    })
    const screen = app.draw()
    expect(screen).toMatch(/✔ Checked +✔ Signed +✔ Sent +✖ Starting/)
    expect(words(screen)).toContain(`✖ ${said}`)
    expect(screen).toContain("Number 1 is used, so the next deploy will be 2.")
    expect(screen).toContain("╭─ Docker said ─")
    expect(screen).toContain("Container web-db-1  Waiting")
    expect(screen).not.toContain("the app did not start")
  }, 30_000)
})
