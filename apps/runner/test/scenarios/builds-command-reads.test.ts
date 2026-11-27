/**
 * `builds` at its edges (specs/016-build-from-source, T092, T085;
 * contracts/runner.md RB17 first bullet; core.md CO12, CO14), against the
 * real runner program in a session and the stand-in for Docker: its
 * records are read by `kept/records.ts`'s reader, the one RB14's cleaning
 * goes by, so both say the same of every file in `kept/`; and `check` for an
 * app the request's schema reads but no built image can be named for
 * answers, never refusing as if the server's state were damaged.
 */
import { describe, expect, test } from "bun:test"
import { parseMessage, RunnerBuildsSchema } from "@workspace/core"

import { readRecords } from "../../src/kept/records"
import { session, world } from "../support/helpers"
import {
  addApp,
  AT,
  changeState,
  hex,
  image,
  record,
  writeKept,
  type State,
} from "../support/kept-builds"

type World = Awaited<ReturnType<typeof world>>

/** `web` at number 4, its deploy 4 running with keys a and b. */
function webRuns(state: State) {
  addApp(state, "web", 4)
  state.builds.web = {
    running: 4,
    images: [image(hex("a"), "1", "2"), image(hex("b"), "3", "4")],
    deploys: [{ sequence: 4, keys: [hex("a"), hex("b")] }],
    drop: [],
    fresh: [],
    last: { sequence: 4, outcome: "built", reason: null, at: AT },
  }
}

async function ask(w: World, input: unknown) {
  const s = session(w.home, w.docker.path)
  const { events, result } = await s.request({ command: "builds", input })
  await s.close()
  expect(events).toEqual([])
  return result
}

describe("builds reads kept/ as RB14 does", () => {
  test("a record file past the reader's bound is left out, as readRecords leaves it out", async () => {
    const w = await world()
    changeState(w.home, webRuns)
    // A record that reads by the schema, padded past 16 KiB: never one the runner wrote.
    writeKept(
      w.home,
      "web",
      `${hex("a")}.json`,
      `${JSON.stringify(record(hex("a")))}${" ".repeat(20 * 1024)}`
    )
    writeKept(
      w.home,
      "web",
      `${hex("b")}.json`,
      JSON.stringify(record(hex("b")))
    )
    const answer = (await ask(w, { apps: ["web"] })) as {
      apps: Record<string, { records: unknown[] }>
    }
    expect(answer.apps.web!.records).toEqual([record(hex("b"))])
    expect(answer.apps.web!.records).toEqual(
      readRecords(w.home, "web", [hex("a"), hex("b")])
    )
  })
})

describe("builds with check for an app no image can be named for", () => {
  test("an app ending with a hyphen: each key gone, Docker never asked", async () => {
    const w = await world()
    const calls = w.docker.calls().length
    const answer = await ask(w, {
      apps: ["web-"],
      check: [hex("a"), hex("b")],
    })
    expect(answer).toEqual({
      apps: {
        "web-": {
          running: null,
          deploys: [],
          fresh: [],
          records: [],
          last: null,
          building: null,
          check: { [hex("a")]: "gone", [hex("b")]: "gone" },
        },
      },
    })
    expect(parseMessage(RunnerBuildsSchema, answer).ok).toBe(true)
    expect(w.docker.calls()).toHaveLength(calls)
  })
})
