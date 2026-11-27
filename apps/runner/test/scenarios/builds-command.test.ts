/**
 * `builds` (specs/016-build-from-source, T092; contracts/runner.md RB17
 * first bullet; core.md CO12, CO13, CO14; FR-045, FR-064, FR-066, FR-080),
 * against the real runner program in a session and the stand-in for Docker.
 * With no input, the apps that have builds; with `apps`, what the runner
 * keeps of each, from the state and `kept/`; with `check`, whether each
 * named image is still the one recorded. No lock for its own work.
 */
import { describe, expect, test } from "bun:test"
import {
  parseMessage,
  RunnerBuildsSchema,
  SESSION_FRAME_BYTES,
} from "@workspace/core"
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { deployed, session, world } from "../support/helpers"
import {
  addApp,
  AT,
  changeState,
  digest,
  hex,
  image,
  record,
  stateFile,
  tagOf,
  writeKept,
  type State,
} from "../support/kept-builds"

type World = Awaited<ReturnType<typeof world>>

const refused = (reason: string) => ({ outcome: "refused", reason })
/** A lock held by a live process other than the runner's: this test's own. */
const LIVE = `${process.pid}:held`

/**
 * `web` at number 5: deploy 4 runs with keys a and b, deploy 3's c is kept,
 * e waits to be removed, one base was built fresh, the last deploy that
 * built is 4; `api` at number 2 with one deploy that built and none running.
 */
function twoApps(state: State) {
  addApp(state, "web", 5)
  addApp(state, "api", 2)
  state.builds.web = {
    running: 4,
    images: [
      image(hex("a"), "1", "2"),
      image(hex("b"), "3", "4"),
      image(hex("c"), "5", "6"),
    ],
    deploys: [
      { sequence: 4, keys: [hex("a"), hex("b")] },
      { sequence: 3, keys: [hex("c")] },
    ],
    drop: [image(hex("e"), "7", "8")],
    fresh: [{ base: hex("d"), sequence: 3 }],
    last: { sequence: 4, outcome: "built", reason: null, at: AT },
  }
  state.builds.api = {
    running: null,
    images: [image(hex("f"), "1", "2")],
    deploys: [{ sequence: 2, keys: [hex("f")] }],
    drop: [],
    fresh: [],
    last: {
      sequence: 2,
      outcome: "build_failed",
      reason: "runner_restarted",
      at: AT,
    },
  }
}

async function ask(w: World, input?: unknown) {
  const s = session(w.home, w.docker.path)
  const { events, result } = await s.request(
    input === undefined ? { command: "builds" } : { command: "builds", input }
  )
  expect(events).toEqual([])
  await s.close()
  // Every answer is within its frame bound, and reads as `builds`' answer or a report.
  for (const line of s.output().split("\n").filter(Boolean))
    expect(Buffer.byteLength(line)).toBeLessThan(SESSION_FRAME_BYTES.builds)
  return result
}

const NONE = {
  running: null,
  deploys: [],
  fresh: [],
  records: [],
  last: null,
  building: null,
}

describe("builds with no input", () => {
  test("names the apps that have builds, sorted; none when no app has", async () => {
    const w = await deployed(["web"])
    const calls = w.docker.calls().length
    expect(await ask(w)).toEqual({ built: [] })
    expect(await ask(w, {})).toEqual({ built: [] })
    changeState(w.home, twoApps)
    for (const input of [undefined, {}]) {
      const answer = await ask(w, input)
      expect(answer).toEqual({ built: ["api", "web"] })
      expect(parseMessage(RunnerBuildsSchema, answer).ok).toBe(true)
    }
    expect(w.docker.calls()).toHaveLength(calls)
  })
})

describe("builds with apps", () => {
  test("what the runner keeps of each, from the state and kept/: the records of the deploy that runs only", async () => {
    const w = await world()
    changeState(w.home, twoApps)
    for (const key of ["a", "b", "c"])
      writeKept(
        w.home,
        "web",
        `${hex(key)}.json`,
        JSON.stringify(record(hex(key)))
      )
    writeKept(
      w.home,
      "api",
      `${hex("f")}.json`,
      JSON.stringify(record(hex("f")))
    )
    const before = readFileSync(stateFile(w.home))
    const calls = w.docker.calls().length

    const answer = await ask(w, { apps: ["api", "nothing", "web"] })
    expect(answer).toEqual({
      apps: {
        api: {
          running: null,
          deploys: [{ sequence: 2, keys: [hex("f")] }],
          fresh: [],
          records: [],
          last: {
            sequence: 2,
            outcome: "build_failed",
            reason: "runner_restarted",
            at: AT,
          },
          building: null,
        },
        nothing: NONE,
        web: {
          running: 4,
          deploys: [
            { sequence: 4, keys: [hex("a"), hex("b")] },
            { sequence: 3, keys: [hex("c")] },
          ],
          fresh: [{ base: hex("d"), sequence: 3 }],
          records: [record(hex("a")), record(hex("b"))],
          last: { sequence: 4, outcome: "built", reason: null, at: AT },
          building: null,
        },
      },
    })
    expect(parseMessage(RunnerBuildsSchema, answer).ok).toBe(true)
    // Read only: nothing written, Docker never asked.
    expect(readFileSync(stateFile(w.home))).toEqual(before)
    expect(w.docker.calls()).toHaveLength(calls)
  })

  test("a record file that is damaged, names another key, breaks the schema or is a link is left out", async () => {
    const w = await world()
    changeState(w.home, twoApps)
    writeKept(w.home, "web", `${hex("a")}.json`, "{ not json")
    writeKept(
      w.home,
      "web",
      `${hex("b")}.json`,
      JSON.stringify(record(hex("c")))
    )
    const answer = (await ask(w, { apps: ["web"] })) as {
      apps: Record<string, { records: unknown[] }>
    }
    expect(answer.apps.web!.records).toEqual([])

    // A line the builder printed in a record's field breaks CO14's schema.
    writeKept(
      w.home,
      "web",
      `${hex("a")}.json`,
      JSON.stringify({ ...record(hex("a")), bases: ["#9 RUN npm ci"] })
    )
    writeKept(
      w.home,
      "web",
      `${hex("b")}.json`,
      JSON.stringify(record(hex("b")))
    )
    const broken = (await ask(w, { apps: ["web"] })) as {
      apps: Record<string, { records: unknown[] }>
    }
    expect(broken.apps.web!.records).toEqual([record(hex("b"))])

    // A link in kept/ is never followed, even to a record that reads.
    const elsewhere = join(w.home, "elsewhere.json")
    writeFileSync(elsewhere, JSON.stringify(record(hex("b"))), { mode: 0o600 })
    rmSync(join(w.home, "kept", "web", `${hex("b")}.json`))
    symlinkSync(elsewhere, join(w.home, "kept", "web", `${hex("b")}.json`))
    const linked = (await ask(w, { apps: ["web"] })) as {
      apps: Record<string, { records: unknown[] }>
    }
    expect(linked.apps.web!.records).toEqual([])
  })

  test("the build under way for an app: its number, seconds from since, limit and phase", async () => {
    const w = await world()
    changeState(w.home, (state) => {
      twoApps(state)
      state.building = {
        app: "web",
        sequence: 5,
        keys: [hex("a")],
        since: new Date(Date.now() - 90_000).toISOString(),
        limit: 1800,
        phase: "stopping",
        run: "cd".repeat(16),
        stopped: new Date().toISOString(),
      }
    })
    // The deploy that builds holds the deploy lock, so RB15's bounded part leaves its build alone (RB1).
    writeFileSync(join(w.home, "lock"), LIVE)
    const answer = (await ask(w, { apps: ["api", "web"] })) as {
      apps: Record<string, { building: Record<string, unknown> | null }>
    }
    expect(answer.apps.api!.building).toBeNull()
    expect(answer.apps.web!.building).toEqual({
      sequence: 5,
      seconds: expect.any(Number),
      limit: 1800,
      phase: "stopping",
    })
    const seconds = answer.apps.web!.building!.seconds as number
    expect(Number.isInteger(seconds)).toBe(true)
    expect(seconds).toBeGreaterThanOrEqual(90)
    expect(seconds).toBeLessThan(100)

    // The first deploy of an app that builds: no entry in `builds` yet, its build under way.
    changeState(w.home, (state) => {
      addApp(state, "new", 1)
      state.building = {
        app: "new",
        sequence: 1,
        keys: [hex("a")],
        since: new Date(Date.now() + 60_000).toISOString(),
        limit: 600,
        phase: "building",
        run: "cd".repeat(16),
        stopped: null,
      }
    })
    expect(await ask(w, { apps: ["new"] })).toEqual({
      apps: {
        new: {
          ...NONE,
          building: { sequence: 1, seconds: 0, limit: 600, phase: "building" },
        },
      },
    })
  })

  test("answers while another request holds both locks: it takes none", async () => {
    const w = await world()
    changeState(w.home, twoApps)
    writeFileSync(join(w.home, "lock"), LIVE)
    writeFileSync(join(w.home, "state.lock"), LIVE)
    const started = Date.now()
    expect(await ask(w)).toEqual({ built: ["api", "web"] })
    expect(
      ((await ask(w, { apps: ["web"] })) as { apps: object }).apps
    ).toHaveProperty("web")
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(readFileSync(join(w.home, "lock"), "utf8")).toBe(LIVE)
    expect(readFileSync(join(w.home, "state.lock"), "utf8")).toBe(LIVE)
  })
})

describe("builds with check", () => {
  test("kept, gone or changed for each key, by docker image inspect of its tag", async () => {
    const w = await world()
    changeState(w.home, (state) => {
      twoApps(state)
      ;(state.builds.web as { drop: unknown[] }).drop = [
        image(hex("0"), "9", "0"),
        image(hex("e"), "7", "8"),
      ]
    })
    const docker = w.docker
    // a: the manifest's digest, as the containerd store gives; b: the config's, as the classic store does.
    docker.image(tagOf("web", hex("a")), {
      id: digest("1"),
      manifest: digest("1"),
      config: digest("2"),
    })
    docker.image(tagOf("web", hex("b")), {
      id: digest("4"),
      manifest: digest("3"),
      config: digest("4"),
    })
    // c: the tag now leads to another image; e: waiting to be removed, still the one recorded.
    docker.image(tagOf("web", hex("c")))
    docker.image(tagOf("web", hex("e")), {
      id: digest("7"),
      manifest: digest("7"),
      config: digest("8"),
    })
    // 8: a key the state does not record, under a tag that exists.
    docker.image(tagOf("web", hex("8")))
    // 0 (recorded, in drop) and 9 (not recorded) have no image.
    const keys = ["c", "a", "9", "b", "e", "0", "8"].map(hex)
    const calls = docker.calls().length

    const answer = (await ask(w, { apps: ["web"], check: keys })) as {
      apps: Record<string, Record<string, unknown>>
    }
    expect(answer.apps.web!.check).toEqual({
      [hex("c")]: "changed",
      [hex("a")]: "kept",
      [hex("9")]: "gone",
      [hex("b")]: "kept",
      [hex("e")]: "kept",
      [hex("0")]: "gone",
      [hex("8")]: "changed",
    })
    expect(Object.keys(answer.apps.web!.check as object)).toEqual(keys)
    expect(parseMessage(RunnerBuildsSchema, answer).ok).toBe(true)

    // One inspect of each tag, in the order asked, never holding the state lock.
    const made = docker.calls().slice(calls)
    expect(made.map((call) => call.args)).toEqual(
      keys.map((key) => `image inspect --format {{.Id}} ${tagOf("web", key)}`)
    )
    expect(made.every((call) => !call.stateLock)).toBe(true)
  })

  test("a Docker that does not answer shows no image: gone", async () => {
    const w = await world()
    changeState(w.home, twoApps)
    const s = session(w.home, join(w.home, "no-such-docker"))
    const { result } = await s.request({
      command: "builds",
      input: { apps: ["web"], check: [hex("a")] },
    })
    await s.close()
    expect(
      (result as { apps: Record<string, { check: unknown }> }).apps.web!.check
    ).toEqual({ [hex("a")]: "gone" })
  })
})

describe("builds refuses", () => {
  test("an input that is not its own: invalid_request, Docker never asked", async () => {
    const w = await world()
    changeState(w.home, twoApps)
    const calls = w.docker.calls().length
    const nine = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map(
      (c) => `app-${c}`
    )
    for (const input of [
      "garbage",
      [],
      null,
      { extra: 1 },
      { apps: [] },
      { apps: nine },
      { apps: ["web", "api"] },
      { apps: ["web", "web"] },
      { apps: ["Web"] },
      { apps: ["web"], extra: 1 },
      { check: [hex("a")] },
      { apps: ["api", "web"], check: [hex("a")] },
      { apps: ["web"], check: [] },
      { apps: ["web"], check: [hex("a"), hex("a")] },
      { apps: ["web"], check: "abcdef012".split("").map(hex) },
      { apps: ["web"], check: ["A".repeat(64)] },
    ])
      expect(await ask(w, input)).toEqual(refused("invalid_request"))
    // Eight apps, the most one request asks: answered.
    expect(
      Object.keys(
        ((await ask(w, { apps: nine.slice(0, 8) })) as { apps: object }).apps
      )
    ).toEqual(nine.slice(0, 8))
    expect(w.docker.calls()).toHaveLength(calls)
  }, 30_000)

  test("a runner that is not set up", async () => {
    const w = await world()
    const s = session(join(w.home, "missing"), w.docker.path)
    expect((await s.request({ command: "builds" })).result).toEqual(
      refused("not_set_up")
    )
    await s.close()
  })
})

describe("the largest answer of builds", () => {
  test("eight apps, each at every bound of CO12 and CO13, stay within the 1 MiB frame", async () => {
    const w = await world()
    const apps = Array.from({ length: 8 }, (_, i) => `app-${i}`)
    /** The ith of `count` 64-hex keys, sorted as numbers are. */
    const nth = (i: number) => i.toString(16).padStart(64, "0")
    // 255 characters, the longest base a record holds, sorted.
    const base = (i: number) =>
      `registry.example.com/${"a".repeat(160)}${String(i).padStart(2, "0")}@sha256:${hex("9")}`
    expect(base(0)).toHaveLength(255)
    const longVersion = `9999.9999.999999-${"x".repeat(64)}`
    changeState(w.home, (state) => {
      for (const [a, app] of apps.entries()) {
        addApp(state, app, 100)
        const keys = Array.from({ length: 24 }, (_, i) => nth(a * 100 + i))
        state.builds[app] = {
          running: 100,
          images: keys.map((key) => ({
            key,
            manifest: digest("1"),
            config: digest("2"),
          })),
          deploys: [0, 1, 2].map((d) => ({
            sequence: 100 - d,
            keys: keys.slice(d * 8, d * 8 + 8),
          })),
          drop: Array.from({ length: 24 }, (_, i) => ({
            key: nth(a * 100 + 50 + i),
            manifest: digest("3"),
            config: digest("4"),
          })),
          fresh: Array.from({ length: 24 }, (_, i) => ({
            base: nth(a * 100 + i),
            sequence: 100,
          })),
          last: {
            sequence: 100,
            outcome: "build_failed",
            reason: "runner_restarted",
            at: AT,
          },
        }
        for (const key of keys.slice(0, 8))
          writeKept(
            w.home,
            app,
            `${key}.json`,
            JSON.stringify({
              ...record(
                key,
                Array.from({ length: 16 }, (_, i) => base(i))
              ),
              docker: {
                engine: longVersion,
                buildx: longVersion,
                buildkit: longVersion,
              },
              reader: { kind: "dockerfile", version: longVersion },
            })
          )
      }
      state.building = {
        app: "app-0",
        sequence: 100,
        keys: [nth(0)],
        since: AT,
        limit: 57_600,
        phase: "starting",
        run: "cd".repeat(16),
        stopped: null,
      }
    })

    const s = session(w.home, w.docker.path)
    const { result } = await s.request({ command: "builds", input: { apps } })
    await s.close()
    expect(parseMessage(RunnerBuildsSchema, result).ok).toBe(true)
    const answers = (result as { apps: Record<string, { records: unknown[] }> })
      .apps
    for (const app of apps) expect(answers[app]!.records).toHaveLength(8)
    const frame = Buffer.byteLength(s.output().trim())
    // About 0.34 MB; 1.5 times it stays under the bound too (CO12, CO19).
    expect(frame).toBeGreaterThan(300_000)
    expect(frame * 1.5).toBeLessThan(SESSION_FRAME_BYTES.builds)
  }, 30_000)
})
