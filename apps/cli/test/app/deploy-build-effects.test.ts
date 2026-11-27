/**
 * The full-screen app's logic for a deploy that builds
 * (specs/016-build-from-source, design/lines.md part J; choice J-a (a);
 * tasks T137), through the app's effects and reducer as app.tsx makes them,
 * against a scripted stand-in runner (test/support/build-events.ts) that
 * answers `builder`, `builds` and `deploy` with a runner of protocol 6's
 * events; `version`, `status` and `records` are this repository's runner's,
 * with the stand-in Docker. Lines are checked by their row id, never their
 * words (FR-092). A temporary `ZEKNO_HOME` and `memoryKeyStore()`.
 */
import { afterEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { waitFor } from "../../../runner/test/support/helpers"
import { createStore } from "../../src/app/app"
import { createEffects, type Effects } from "../../src/app/effects/effects"
import { loadStart } from "../../src/app/effects/profile"
import type { AppEvent } from "../../src/app/state/events"
import { NOT_DEPLOYED, onQuestion } from "../../src/app/state/questions"
import { initialState } from "../../src/app/state/state"
import { openTeam } from "../../src/cli/context"
import { MADE_AT_DEPLOY } from "../../src/ops/settings-build"
import { AGREED_FILE } from "../../src/profile/agreed"
import { readBuildOutput } from "../../src/profile/build-output"
import { type Frames, scriptedRunner, signedOf } from "../support/build-events"
import { builderAnswer, standInSessions } from "../support/build-session"
import { ready } from "../support/helpers"

type Machine = Awaited<ReturnType<typeof ready>>

const SIZE = { columns: 100, rows: 30 }
const DOCKERFILE = "FROM alpine:3.20\nCOPY . /app\n"
const WHERE = ["--app", "shop", "--server", "dev"]

/** The effects of every app a test opened: closed after each test, so no runner it reached is left running. */
const opened: Effects[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((effects) => effects.close()))
})

/** A ready machine whose folder holds a Dockerfile and the settings of one built service `web`, linked to shop on dev. */
async function builtFolder(): Promise<Machine> {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  writeFileSync(join(m.project, "Dockerfile"), DOCKERFILE)
  writeFileSync(
    join(m.project, "zekno.app.json"),
    `${JSON.stringify(
      { zekno: 1, services: { web: { build: { builder: "dockerfile" } } } },
      null,
      2
    )}\n`
  )
  expect(await m.zekno("link", ...WHERE)).toBe(0)
  return m
}

/**
 * The stand-in: `builder` can build; `builds` says shop runs `running`;
 * `deploy` answers `frames` for the deploy signed. `status` reports
 * `number()` for shop.
 */
function server(
  m: Machine,
  frames: (signed: ReturnType<typeof signedOf>, count: number) => Frames,
  options: { running?: number | null; number?: () => number } = {}
) {
  if (options.number !== undefined) {
    const number = options.number
    standInSessions(m.deps, {
      rewrite: {
        status: (result) => {
          const status = result as { lastSequence: Record<string, number> }
          return {
            ...status,
            lastSequence: { ...status.lastSequence, shop: number() },
          }
        },
      },
    })
  }
  return scriptedRunner(m.deps, {
    builder: () => [{ result: builderAnswer() }],
    builds: () => [
      {
        result: {
          apps: {
            shop: {
              running: options.running ?? null,
              deploys: [],
              fresh: [],
              records: [],
              last: null,
              building: null,
            },
          },
        },
      },
    ],
    deploy: (input, count) => frames(signedOf(input), count),
  })
}

const answer = (
  signed: ReturnType<typeof signedOf>,
  outcome: Record<string, unknown>
) => ({ result: { app: signed.app, sequence: signed.sequence, ...outcome } })

/** The app on `m`, made as app.tsx makes it: every event its effects send is kept, in order, and goes to its reducer. */
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
  const of = <Type extends AppEvent["type"]>(type: Type) =>
    events.filter(
      (event): event is Extract<AppEvent, { type: Type }> => event.type === type
    )
  return {
    events,
    failures,
    of,
    get state() {
      return store.get()
    },
    key: (text: string) =>
      store.dispatch({ type: "key", key: { kind: "text", text } }),
    d: () => effects!.run({ kind: "deploy", server: "dev", app: "shop" }),
    asked: () =>
      waitFor(() => store.get().question !== undefined, "the question"),
    ended: () =>
      waitFor(
        () =>
          store.get().deploy !== undefined &&
          store.get().deploy!.running === false,
        "the deploy to end"
      ),
  }
}

/** Says yes to B24, the first deploy that builds from this folder on this machine, and waits for the deploy to end. */
async function yesAndEnd(app: Awaited<ReturnType<typeof appOn>>) {
  await app.asked()
  expect(app.state.question).toMatchObject({
    kind: "build-yes",
    line: { id: "B24", server: "dev" },
  })
  app.key("y")
  await app.ended()
}

describe("the question in the panel of Remember this folder? (J12)", () => {
  test("B24 at the first deploy that builds from the folder: no deploys nothing and keeps nothing; yes keeps the folder in agreed.json and deploys; a second d asks nothing", async () => {
    const m = await builtFolder()
    const stand = server(m, (signed) => [
      { event: "build", key: signed.keys[0]!, state: "built" },
      answer(signed, { outcome: "started" }),
    ])
    const app = await appOn(m)
    await app.d()
    await app.asked()
    expect(app.of("ask-build-yes")).toEqual([
      {
        type: "ask-build-yes",
        server: "dev",
        app: "shop",
        line: { id: "B24", server: "dev" },
      },
    ])
    // No: nothing signed, nothing kept, and the run's folder of sealed pieces is gone.
    app.key("n")
    expect(app.state.question).toBeUndefined()
    expect(app.state.notice).toEqual({ tone: "info", text: NOT_DEPLOYED })
    expect(stand.commands()).not.toContain("deploy")
    expect(existsSync(join(m.home, AGREED_FILE))).toBe(false)
    expect(readdirSync(join(m.home, "tmp"))).toEqual([])

    // Yes: the folder is kept as at a terminal, and the deploy goes on.
    await app.d()
    await yesAndEnd(app)
    expect(app.state.deploy?.outcome).toBe("started")
    const agreed = JSON.parse(readFileSync(join(m.home, AGREED_FILE), "utf8"))
    expect(agreed.folders).toHaveLength(1)
    expect(agreed.folders[0].folder).toBe(realpathSync(m.project))
    expect(stand.commands().filter((command) => command === "deploy")).toEqual([
      "deploy",
    ])

    // A second `d` asks nothing.
    const asked = app.of("ask-build-yes").length
    await app.d()
    await waitFor(
      () => stand.commands().filter((c) => c === "deploy").length === 2,
      "the second deploy"
    )
    expect(app.of("ask-build-yes")).toHaveLength(asked)
    expect(app.failures).toEqual([])
  }, 60_000)

  test("the reducer: y agrees and goes on, n and esc do not", () => {
    const question = {
      kind: "build-yes" as const,
      server: "dev",
      app: "shop",
      line: { id: "B24" as const, server: "dev" },
    }
    const state = { question } as unknown as Parameters<typeof onQuestion>[0]
    expect(
      onQuestion(state, question, { kind: "text", text: "y" }).effects
    ).toEqual([
      {
        kind: "deploy-continue",
        server: "dev",
        app: "shop",
        answer: "build-yes",
      },
    ])
    for (const key of [
      { kind: "text", text: "n" },
      { kind: "escape" },
    ] as const) {
      const step = onQuestion(state, question, key)
      expect(step.effects).toEqual([])
      expect(step.state.question).toBeUndefined()
    }
  })
})

describe("the events of a deploy that builds become the screen's state", () => {
  test("building, then built: the stage, the live line with its service, the builder's lines in the output o shows and in the saved output", async () => {
    const m = await builtFolder()
    server(m, (signed) => [
      { event: "build", key: signed.keys[0]!, state: "building" },
      { event: "build_line", key: signed.keys[0]!, line: "#1 FROM alpine" },
      { event: "build_line", key: signed.keys[0]!, line: "#2 COPY . /app" },
      { event: "build", key: signed.keys[0]!, state: "built" },
      { event: "progress", line: "Container shop-web-1 Started" },
      answer(signed, { outcome: "started" }),
    ])
    const app = await appOn(m)
    await app.d()
    await yesAndEnd(app)
    expect(app.of("deploy-stage").map((event) => event.stage)).toEqual([
      "checked",
      "signed",
      "sent",
      "building",
      "built",
      "starting",
      "started",
    ])
    const deploy = app.state.deploy!
    expect(deploy.outcome).toBe("started")
    expect(deploy.build).toEqual({
      reused: [],
      building: { service: "web", line: "#2 COPY . /app" },
    })
    expect(deploy.lines).toEqual([
      "#1 FROM alpine",
      "#2 COPY . /app",
      "Container shop-web-1 Started",
    ])
    const team = await openTeam(m.deps)
    const serverId = team.profile.servers[0]!.serverId
    expect(readBuildOutput(m.home, serverId, "shop")?.lines).toEqual([
      "#1 FROM alpine",
      "#2 COPY . /app",
    ])
  }, 60_000)

  test("every build reused: the stage reused, and the build reused with the deploy that built it (D6)", async () => {
    const m = await builtFolder()
    let number = 0
    server(
      m,
      (signed, count) =>
        count === 0
          ? [
              { event: "build", key: signed.keys[0]!, state: "built" },
              answer(signed, { outcome: "started" }),
            ]
          : [
              { event: "build", key: signed.keys[0]!, state: "reused" },
              answer(signed, { outcome: "started" }),
            ],
      { number: () => number }
    )
    const app = await appOn(m)
    await app.d()
    await yesAndEnd(app)
    number = 1
    const before = app.of("deploy-ended").length
    await app.d()
    await waitFor(
      () => app.of("deploy-ended").length === before + 1,
      "the second deploy to end"
    )
    expect(app.state.deploy?.stage).toBe("started")
    expect(app.of("deploy-stage").map((event) => event.stage)).toContain(
      "reused"
    )
    expect(app.state.deploy?.build?.reused).toEqual([
      { service: "web", deploy: 1 },
    ])
  }, 60_000)

  test("a failed build: build_failed, the lead as the result line in the error colour (J6), the failure for its panel (J7)", async () => {
    const m = await builtFolder()
    server(
      m,
      (signed) => [
        { event: "build", key: signed.keys[0]!, state: "building" },
        { event: "build_line", key: signed.keys[0]!, line: "npm ERR!" },
        {
          event: "build_error",
          key: signed.keys[0]!,
          step: "[2/2] RUN npm ci",
          error: "exit code: 1",
        },
        { event: "build", key: signed.keys[0]!, state: "failed" },
        answer(signed, {
          outcome: "build_failed",
          build: { key: signed.keys[0]!, reason: "step_failed" },
        }),
      ],
      { running: 4 }
    )
    const app = await appOn(m)
    await app.d()
    await yesAndEnd(app)
    const deploy = app.state.deploy!
    expect(deploy.outcome).toBe("build_failed")
    expect(deploy.stage).toBe("build_failed")
    expect(deploy.result).toEqual({ tone: "error", text: "E1" })
    expect(deploy.build?.failure).toMatchObject({
      reason: "step_failed",
      lead: { id: "E1", service: "web", running: 4 },
      step: "[2/2] RUN npm ci",
      error: "exit code: 1",
      lines: ["npm ERR!"],
      total: 1,
    })
  }, 60_000)
})

describe("J10: d in a folder with a Dockerfile and no settings file", () => {
  test("says J10, and nothing is read, asked or sent: the single command sets the folder up", async () => {
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(join(m.project, "Dockerfile"), DOCKERFILE)
    const stand = server(m, () => [])
    const app = await appOn(m)
    await app.d()
    await waitFor(() => app.state.notice !== undefined, "the notice")
    expect(app.state.notice).toEqual({ tone: "error", text: "J10" })
    expect(app.state.question).toBeUndefined()
    expect(stand.commands()).toEqual([])
  }, 60_000)
})

describe("the settings screen of a built service", () => {
  test("its Compose text names the placeholder of a key made at deploy", async () => {
    const m = await builtFolder()
    const app = await appOn(m)
    await opened.at(-1)!.run({
      kind: "read-settings",
      server: "dev",
      app: "shop",
      deployed: false,
    })
    const read = app.of("settings-read").at(-1)!
    expect(read.outcome.kind).toBe("read")
    if (read.outcome.kind !== "read") return
    expect(read.outcome.compose).toContain(
      `    image: "zekno.invalid/shop:${MADE_AT_DEPLOY}"\n    pull_policy: "never"\n`
    )
  }, 60_000)
})
