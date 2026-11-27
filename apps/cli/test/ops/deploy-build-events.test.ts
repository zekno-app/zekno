/**
 * Events, outcomes and refusals of a deploy that builds
 * (specs/016-build-from-source, contracts/cli.md CL7 step 13 and "The
 * answer"; CL14, "Every text from the server"; tasks T132). The upload is
 * T130's, so a scripted stand-in runner answers `builder`, `builds` and
 * `deploy` with the events and the answer a runner of protocol 6 sends
 * (test/support/build-events.ts); `version`, `status` and `records` are this
 * repository's runner's, with the stand-in Docker. Lines are checked by their
 * row id, never their words (FR-092). A temporary `ZEKNO_HOME` and
 * `memoryKeyStore()`, never the real keychain or `~/.zekno`. A build that
 * failed: deploy-build-failed.test.ts.
 */
import { describe, expect, test } from "bun:test"

import { RunnerRefused } from "../../src/cli/errors"
import { buildRefusal, copiedSources } from "../../src/ops/deploy-send-build"
import { readBuildOutput } from "../../src/profile/build-output"
import { BuildStop } from "../../src/shared/build-lines"
import {
  answer,
  built,
  building,
  CLIPBOARD,
  deployOnce,
  DOCKERFILE,
  ESC,
  folderWith,
  historyOf,
  server,
  type signedOf,
  WHERE,
} from "../support/build-events"
import { answering } from "../support/helpers"

describe("the session takes the build events of a deploy (CO11)", () => {
  test("a build that runs and is built: the stage moves to building then built, each line is the live line (D4), and the app starts as today", async () => {
    const m = await folderWith({ web: built() })
    server(m, (signed) => [
      ...building(signed.keys[0]!, ["#1 [1/2] FROM alpine", "#2 [2/2] COPY"]),
      { event: "progress", line: "Container shop-web-1 Started" },
      answer(signed, { outcome: "started" }),
    ])
    const { result, lines, stages } = await deployOnce(m, {
      savedOutput: { home: m.home },
    })
    expect(result).toMatchObject({ outcome: "started" })
    expect(stages).toEqual([
      "checked",
      "signed",
      "sent",
      "building",
      "built",
      "starting",
      "started",
    ])
    expect(lines).toEqual([
      { id: "D4", line: "#1 [1/2] FROM alpine" },
      { id: "D4", line: "#2 [2/2] COPY" },
    ])
    // At a terminal and in the app, the lines are the saved output.
    const { entries, serverId } = await historyOf(m)
    expect(readBuildOutput(m.home, serverId, "shop")?.lines).toEqual([
      "#1 [1/2] FROM alpine",
      "#2 [2/2] COPY",
    ])
    expect(entries.at(-1)!.outcome).toBe("started")
  }, 60_000)

  test("two builds: each line with its service (D5); with no terminal, each line is D17 and nothing is saved", async () => {
    const m = await folderWith(
      {
        web: built({ dockerfile: "Dockerfile" }),
        api: built({ dockerfile: "Dockerfile.api" }),
      },
      { Dockerfile: DOCKERFILE, "Dockerfile.api": "FROM alpine:3.20\n" }
    )
    let keys: string[] = []
    server(m, (signed) => {
      keys = signed.keys
      return [
        ...building(signed.keys[0]!, ["one"]),
        ...building(signed.keys[1]!, ["two"]),
        answer(signed, { outcome: "started" }),
      ]
    })
    const terminal = await deployOnce(m, { savedOutput: { home: m.home } })
    // The payload's builds are sorted by key; each line names the service of its own key.
    const builds = (
      terminal.result as {
        build: { builds: { key: string; services: string[] }[] }
      }
    ).build.builds
    const serviceOf = (key: string) =>
      builds.find((build) => build.key === key)!.services[0]!
    expect(terminal.lines).toEqual([
      { id: "D5", service: serviceOf(keys[0]!), line: "one" },
      { id: "D5", service: serviceOf(keys[1]!), line: "two" },
    ])
    expect(keys.map(serviceOf).sort()).toEqual(["api", "web"])

    const plain = await folderWith({ web: built() })
    server(plain, (signed) => [
      ...building(signed.keys[0]!, ["one", "two"]),
      answer(signed, { outcome: "started" }),
    ])
    const piped = await deployOnce(plain)
    expect(piped.lines).toEqual([
      { id: "D17", line: "one" },
      { id: "D17", line: "two" },
    ])
    const { serverId } = await historyOf(plain)
    expect(readBuildOutput(plain.home, serverId, "shop")).toBeUndefined()
  }, 60_000)

  test("every build reused: the stage is reused, D6 names the deploy that built it, and nothing is saved over the earlier output", async () => {
    const m = await folderWith({ web: built() })
    let number = 0
    server(
      m,
      (signed, count) =>
        count === 0
          ? [
              ...building(signed.keys[0]!, ["first"]),
              answer(signed, { outcome: "started" }),
            ]
          : [
              { event: "build", key: signed.keys[0]!, state: "reused" },
              answer(signed, { outcome: "started" }),
            ],
      { number: () => number }
    )
    const first = await deployOnce(m, { savedOutput: { home: m.home } })
    expect(first.result).toMatchObject({ outcome: "started", sequence: 1 })
    number = 1
    const second = await deployOnce(m, { savedOutput: { home: m.home } })
    expect(second.result).toMatchObject({ outcome: "started", sequence: 2 })
    expect(second.stages).toContain("reused")
    expect(second.stages).not.toContain("built")
    expect(second.lines).toEqual([{ id: "D6", service: "web", deploy: 1 }])
    const { serverId } = await historyOf(m)
    expect(readBuildOutput(m.home, serverId, "shop")).toMatchObject({
      head: { deploy: 1 },
      lines: ["first"],
    })
  }, 60_000)

  test("a step that prints an OSC 52 sequence reaches neither the screen, nor standard error, nor the saved output", async () => {
    const m = await folderWith({ web: built() })
    const hostile = `${CLIPBOARD}#3 RUN echo hi`
    server(m, (signed) => [
      ...building(signed.keys[0]!, [hostile], "failed"),
      {
        event: "build_error",
        key: signed.keys[0]!,
        step: `${CLIPBOARD}[2/2] RUN echo hi`,
        error: `${CLIPBOARD}exit code: 1`,
      },
      answer(signed, {
        outcome: "build_failed",
        build: { key: signed.keys[0]!, reason: "step_failed" },
      }),
    ])
    const terminal = await deployOnce(m, { savedOutput: { home: m.home } })
    const seen =
      JSON.stringify(terminal.lines) + JSON.stringify(terminal.result)
    expect(seen).not.toContain("\\u001b")
    expect(seen).not.toContain("52;c;")
    expect(seen).toContain("RUN echo hi")
    const { serverId } = await historyOf(m)
    const saved = readBuildOutput(m.home, serverId, "shop")!
    expect(saved.lines.join("\n")).not.toContain(ESC)

    m.err.length = 0
    m.out.length = 0
    expect(await m.zekno("deploy", ...WHERE)).toBe(1)
    expect([...m.err, ...m.out].join("\n")).not.toContain(ESC)
  }, 60_000)
})

describe("the runner's refusals of a deploy that builds", () => {
  const refusals: [string, Record<string, unknown>, string][] = [
    ["pack_mismatch", {}, "R11"],
    ["docker_too_old", { docker: { engine: "28.0.0", buildx: null } }, "R12"],
    ["no_build_plugin", {}, "R13"],
    [
      "low_disk",
      { disk: { free: 1_000_000_000, floor: 2_000_000_000 } },
      "R14",
    ],
  ]

  test("pack_mismatch R11, docker_too_old R12, no_build_plugin R13, low_disk R14: by id, exit status 1, no number used", async () => {
    for (const [reason, fields, id] of refusals) {
      const m = await folderWith({ web: built() })
      server(m, () => [{ result: { outcome: "refused", reason, ...fields } }])
      const { result } = await deployOnce(m)
      expect({ reason, message: (result as Error).message }).toEqual({
        reason,
        message: id,
      })
      expect((await historyOf(m)).entries).toEqual([])
      m.err.length = 0
      expect(await m.zekno("deploy", ...WHERE)).toBe(1)
      expect(m.err).toEqual([id])
    }
  }, 120_000)

  test("low_disk carries the free space and the floor the runner reported, R14's values", async () => {
    const m = await folderWith({ web: built() })
    const disk = { free: 1_000_000_000, floor: 2_000_000_000 }
    server(m, () => [
      { result: { outcome: "refused", reason: "low_disk", disk } },
    ])
    const { result } = await deployOnce(m)
    expect(result).toBeInstanceOf(BuildStop)
    expect((result as BuildStop).line).toEqual({
      id: "R14",
      server: "dev",
      ...disk,
    })
  }, 60_000)

  test("malformed from a runner below protocol 6, for a deploy with builds: F11; from a runner of 6: as today", () => {
    const refused = new RunnerRefused("malformed")
    expect(buildRefusal(refused, { protocol: 5 })).toMatchObject({
      line: { id: "F11" },
    })
    expect(buildRefusal(refused, undefined)).toMatchObject({
      line: { id: "F11" },
    })
    expect(buildRefusal(refused, { protocol: 6 })).toBe(refused)
    const other = new RunnerRefused("pack_mismatch")
    expect(buildRefusal(other, { protocol: 5 })).toBe(other)
  })
})

describe("copiedSources: what a failed COPY or ADD step names", () => {
  test("shell form, JSON form, flags, a stage prefix; none for --from, a heredoc or another step", () => {
    expect(copiedSources("[2/3] COPY .env .")).toEqual([".env"])
    expect(copiedSources("[build 4/7] COPY --chown=1:1 a b ./out/")).toEqual([
      "a",
      "b",
    ])
    expect(copiedSources('ADD ["./certs/key.pem", "/k"]')).toEqual([
      "./certs/key.pem",
    ])
    expect(copiedSources("[2/3] COPY --from=build /app /app")).toEqual([])
    expect(copiedSources("COPY <<EOF /x")).toEqual([])
    expect(copiedSources("[2/3] RUN cp .env x")).toEqual([])
  })
})

describe("zekno deploy says the builder's lines, and saves them at a terminal (CL7 step 13; CL9)", () => {
  const frames = (signed: ReturnType<typeof signedOf>) => [
    ...building(signed.keys[0]!, ["one", "two"]),
    answer(signed, { outcome: "started" }),
  ]

  test("with no terminal: each line is D17 on standard error as it comes, and nothing is saved", async () => {
    const m = await folderWith({ web: built() })
    server(m, frames)
    m.err.length = 0
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect(m.err.filter((line) => line === "D17")).toHaveLength(2)
    const { serverId } = await historyOf(m)
    expect(readBuildOutput(m.home, serverId, "shop")).toBeUndefined()
  }, 60_000)

  test("at a terminal: each line is the live line (D4), and they are the saved output `zekno logs --build` prints", async () => {
    const m = await folderWith({ web: built() })
    server(m, frames)
    // B24: the first deploy that builds from this folder on this machine.
    answering(m, [{ yes: true }])
    m.err.length = 0
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect(m.err.filter((line) => line === "D4")).toHaveLength(2)
    const { serverId } = await historyOf(m)
    expect(readBuildOutput(m.home, serverId, "shop")?.lines).toEqual([
      "one",
      "two",
    ])
    m.out.length = 0
    expect(await m.zekno("logs", "--build", ...WHERE)).toBe(0)
    expect(m.out).toEqual(["one", "two"])
  }, 60_000)
})

describe("a deploy that does not build", () => {
  test("says no build line and reaches no build stage", async () => {
    const m = await folderWith({ web: { source: { image: "nginx:1" } } })
    const { result, lines, stages } = await deployOnce(m)
    expect(result).toMatchObject({ outcome: "started" })
    expect(lines).toEqual([])
    expect(stages).toEqual(["checked", "signed", "sent", "starting", "started"])
  }, 60_000)
})
