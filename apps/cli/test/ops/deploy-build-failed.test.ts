/**
 * A deploy whose build failed (specs/016-build-from-source, contracts/cli.md
 * CL7, "The answer"; lines.md part E; tasks T132): the lead of each reason
 * by its id (E1, E2, E7 to E13), the panel's lines (E3, E4, E6), exit
 * status 1, the history entry `build_failed`, and `--json` with the report
 * as it came (E19). A scripted stand-in runner answers the deploy
 * (test/support/build-events.ts). Lines are checked by their row id, never
 * their words (FR-092).
 */
import { describe, expect, test } from "bun:test"

import { failureLines } from "../../src/shared/deploy-build"
import { numberUsed } from "../../src/ui/parts/deploy-summary"
import {
  answer,
  built,
  building,
  deployOnce,
  folderWith,
  historyOf,
  type Machine,
  server,
  WHERE,
} from "../support/build-events"

describe("a build that failed (CL7, The answer)", () => {
  /** A deploy whose build fails for `reason`, with `extra` in the report's build and the step that failed. */
  function failing(
    m: Machine,
    reason: string,
    options: {
      extra?: Record<string, unknown>
      step?: string
      lines?: number
      running?: number | null
    } = {}
  ) {
    return server(
      m,
      (signed) => {
        const key = signed.keys[0]!
        return [
          ...building(
            key,
            Array.from(
              { length: options.lines ?? 3 },
              (_, at) => `line ${at + 1}`
            ),
            "failed"
          ),
          ...(options.step === undefined
            ? []
            : [
                {
                  event: "build_error",
                  key,
                  step: options.step,
                  error: "exit code: 1",
                },
              ]),
          answer(signed, {
            outcome: "build_failed",
            build: { key, reason, ...options.extra },
          }),
        ]
      },
      { running: "running" in options ? options.running : 6 }
    )
  }

  test("step_failed with a deploy running: E1, its panel E3 with the last 40 lines and E4, E6; exit status 1; the history records build_failed", async () => {
    const m = await folderWith({ web: built() })
    failing(m, "step_failed", { step: "[2/2] RUN npm ci", lines: 45 })
    const { result, stages } = await deployOnce(m, {
      savedOutput: { home: m.home },
    })
    const failure = (
      result as { build: { failure: Parameters<typeof failureLines>[0] } }
    ).build.failure
    expect(result).toMatchObject({ outcome: "build_failed", sequence: 1 })
    expect(stages.at(-1)).toBe("build_failed")
    expect(stages).not.toContain("starting")
    expect(failure.lead).toEqual({
      id: "E1",
      service: "web",
      server: "dev",
      app: "shop",
      running: 6,
    })
    expect(failure.lines).toHaveLength(40)
    expect(failure.lines[0]).toBe("line 6")
    expect(failure.total).toBe(45)
    expect(failureLines(failure).map((line) => line.id)).toEqual([
      "E1",
      "E3",
      "E4",
      "E6",
    ])
    expect(failureLines(failure)[1]).toMatchObject({
      id: "E3",
      step: "[2/2] RUN npm ci",
      error: "exit code: 1",
    })
    const { entries } = await historyOf(m)
    expect(entries.at(-1)!.outcome).toBe("build_failed")
    // Its number is used (E5): the stage row's rule says so for build_failed.
    expect(
      numberUsed({
        server: "dev",
        app: "shop",
        sequence: 1,
        format: 2,
        stage: "build_failed",
        outcome: "build_failed",
        lines: [],
        running: false,
        since: 0,
      })
    ).toBe(true)
    m.err.length = 0
    expect(await m.zekno("deploy", ...WHERE)).toBe(1)
  }, 60_000)

  test("step_failed with nothing running yet: E2", async () => {
    const m = await folderWith({ web: built() })
    failing(m, "step_failed", { step: "[2/2] RUN npm ci", running: null })
    const { result } = await deployOnce(m)
    expect(result).toMatchObject({
      build: {
        failure: {
          lead: { id: "E2", service: "web", server: "dev", app: "shop" },
        },
      },
    })
  }, 60_000)

  test("a failed `COPY .env .` with .env left out as secret-looking: E7, naming the file and its kind; a source left out by .dockerignore: E1", async () => {
    const m = await folderWith(
      { web: built() },
      { Dockerfile: "FROM alpine:3.20\nCOPY .env .\n", ".env": "KEY=1\n" }
    )
    failing(m, "step_failed", { step: "[2/2] COPY .env ." })
    const secret = await deployOnce(m)
    expect(secret.result).toMatchObject({
      build: {
        failure: {
          lead: {
            id: "E7",
            service: "web",
            server: "dev",
            app: "shop",
            running: 6,
            path: ".env",
            kind: "secrets",
          },
        },
      },
    })

    const ignored = await folderWith(
      { web: built() },
      {
        Dockerfile: "FROM alpine:3.20\nCOPY notes.txt .\n",
        "notes.txt": "kept here\n",
        ".dockerignore": "notes.txt\n",
      }
    )
    failing(ignored, "step_failed", { step: "[2/2] COPY notes.txt ." })
    const left = await deployOnce(ignored)
    expect(left.result).toMatchObject({
      build: { failure: { lead: { id: "E1", running: 6 } } },
    })
  }, 60_000)

  test("two folders sent: E7 looks at what the failed build's own folder left out, not the first build's", async () => {
    const m = await folderWith(
      {
        web: built({ dockerfile: "Dockerfile" }),
        api: { ...built(), source: { root: "api" } },
      },
      {
        Dockerfile: "FROM alpine:3.20\nCOPY . /app\n",
        "api/Dockerfile": "FROM alpine:3.20\nCOPY .env .\n",
        "api/.env": "KEY=1\n",
      }
    )
    server(
      m,
      (signed) => {
        const key = signed.keyOf("api")!
        return [
          ...building(key, ["line 1"], "failed"),
          {
            event: "build_error",
            key,
            step: "[2/2] COPY .env .",
            error: "exit code: 1",
          },
          answer(signed, {
            outcome: "build_failed",
            build: { key, reason: "step_failed" },
          }),
        ]
      },
      { running: 6 }
    )
    const { result } = await deployOnce(m)
    expect(result).toMatchObject({
      build: {
        failure: {
          lead: { id: "E7", service: "api", path: ".env", kind: "secrets" },
        },
      },
    })
  }, 60_000)

  test("each other reason by its lead: E8, E9 with the limit, E10, E11 with both processors, E12, E13 with the team list, the signer and the deploy", async () => {
    const cases: [
      string,
      Record<string, unknown> | undefined,
      Record<string, unknown>,
    ][] = [
      ["out_of_memory", undefined, { id: "E8" }],
      ["time_limit", undefined, { id: "E9", limit: 1800 }],
      ["out_of_disk", undefined, { id: "E10" }],
      [
        "wrong_processor",
        { arch: { image: "arm64", server: "amd64" } },
        { id: "E11", image: "arm64", host: "amd64" },
      ],
      ["cache_used", undefined, { id: "E12" }],
      [
        "team_changed",
        { team: { version: 3 } },
        { id: "E13", team: 3, signer: "Ada", deploy: 1 },
      ],
    ]
    for (const [reason, extra, lead] of cases) {
      const m = await folderWith({ web: built() })
      failing(m, reason, extra === undefined ? {} : { extra })
      const { result } = await deployOnce(m)
      expect({ reason, result }).toMatchObject({
        reason,
        result: {
          outcome: "build_failed",
          build: {
            failure: {
              reason,
              lead: { ...lead, service: "web", server: "dev", app: "shop" },
            },
          },
        },
      })
      const failure = (
        result as { build: { failure: Parameters<typeof failureLines>[0] } }
      ).build.failure
      // E7 to E13 carry their own line of what to do: no E6.
      expect(failureLines(failure).map((line) => line.id)).not.toContain("E6")
    }
  }, 120_000)

  test("--json: the one object, with the report as it came, build.key and build.reason included (E19)", async () => {
    const m = await folderWith({ web: built() })
    let key = ""
    server(m, (signed) => {
      key = signed.keys[0]!
      return [
        { event: "build", key, state: "failed" },
        answer(signed, {
          outcome: "build_failed",
          build: { key, reason: "out_of_memory" },
        }),
      ]
    })
    m.out.length = 0
    expect(await m.zekno("deploy", ...WHERE, "--json")).toBe(1)
    expect(m.out).toHaveLength(1)
    expect(JSON.parse(m.out[0]!)).toMatchObject({
      outcome: "build_failed",
      app: "shop",
      sequence: 1,
      build: { key, reason: "out_of_memory" },
      server: "dev",
    })
  }, 60_000)

  test("a build_failed for a key the deploy did not sign is not an answer: today's sentence, and the entry stays sent", async () => {
    const m = await folderWith({ web: built() })
    server(m, (signed) => [
      answer(signed, {
        outcome: "build_failed",
        build: { key: "0".repeat(64), reason: "out_of_memory" },
      }),
    ])
    const { result } = await deployOnce(m)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain("did not answer as expected")
    const { entries } = await historyOf(m)
    expect(entries.at(-1)!.outcome).toBe("sent")
  }, 60_000)
})
