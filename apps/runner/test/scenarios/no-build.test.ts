/**
 * Never building from Compose text (specs/016-build-from-source, T088;
 * contracts/runner.md RB13, RB3 U; FR-076, SC-009), against the real runner
 * program and the stand-in for Docker: `up` runs with `--no-build` for every
 * app, built or not, so a service with `build:` is never built by Compose.
 * Its image is there and it starts, or it is not and the start fails (E08);
 * an image from a registry starts as before.
 *
 * The Compose text that asks to build is signed in a deploy of version 1
 * here: a version-2 deploy may name `zekno.invalid/` only for a build it
 * lists (CO2), which the runner builds or finds kept before U. Check L1
 * runs runner 0.1.1 itself with such text on Linux (job `released`), and
 * this runner with the same text (SC-009).
 */
import { describe, expect, test } from "bun:test"
import {
  builtImageName,
  buildKey,
  readRunnerState,
  withAppBuilds,
} from "@workspace/core"
import { join } from "node:path"

import { readState, writeState } from "../../src/home/home"
import {
  buildDeployV2,
  deployV2,
  olderState,
  type BuildRecipeInput,
} from "../support/deploy-v2"
import {
  buildDeploy,
  deployed,
  runner,
  world,
  type FakeDocker,
} from "../support/helpers"

/** The `up` calls the stand-in saw, each argument list as one line. */
const ups = (docker: FakeDocker) =>
  docker
    .calls()
    .map((call) => call.args)
    .filter((args) => args.startsWith("compose ") && args.includes(" up "))

/**
 * Every call that would build: `docker build` or `docker buildx build`, or
 * `compose build`. Step R asks `buildx build --help` for Docker's facts
 * (RB5, RB14), which builds nothing.
 */
const builds = (docker: FakeDocker) =>
  docker
    .calls()
    .map((call) => call.args)
    .filter(
      (args) =>
        /(^|\s)build(\s|$)/.test(args) &&
        !args.includes(" up ") &&
        !args.endsWith(" --help")
    )

const upOf = (home: string, app = "web") =>
  `compose -p zekno-${app} -f ${join(home, "apps", app, "compose.yaml")} up -d --remove-orphans --no-build`

/** A Dockerfile build, kept by the runner from an earlier deploy. */
const recipe: BuildRecipeInput = {
  pack: { hash: "a".repeat(64), size: 1, chunks: ["b".repeat(64)] },
  builder: { name: "dockerfile", dockerfile: "Dockerfile", target: null },
  args: [],
  secrets: [],
  network: "default",
  timeout: 1800,
  fresh: null,
}
const KEY = buildKey(recipe, [])

describe("never building from Compose text (RB13)", () => {
  test("a signed Compose text that asks to build, whose image is not there, ends start_failed and nothing is built (E08)", async () => {
    const w = await world()
    olderState(w.home, { web: 1 })
    const image = builtImageName("web", KEY)
    const deploy = await buildDeploy({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      sequence: 2,
      compose: `services:\n  web:\n    build: .\n    image: ${image}\n    environment:\n      - GREETING\n`,
    })
    const answer = await runner(w.home, w.docker.path, "apply", {
      rosters: w.rosters,
      deploy,
    })
    expect(answer.json).toEqual({
      outcome: "start_failed",
      app: "web",
      sequence: 2,
    })
    expect(ups(w.docker)).toEqual([upOf(w.home)])
    expect(builds(w.docker)).toEqual([])
    expect(w.docker.model().builds).toEqual([])
    expect(w.docker.model().images).toEqual([])
    expect(w.docker.upFinished()).toBe(false)
  }, 30_000)

  test("a built app runs its kept image: up with --no-build, nothing built", async () => {
    const w = await deployed(["web"])
    // Deploy 1 built KEY: its image is tagged, and the state keeps it (CO13).
    const made = w.docker.image(builtImageName("web", KEY))
    const state = readRunnerState(readState(w.home))
    writeState(
      w.home,
      withAppBuilds(state, "web", {
        running: 1,
        images: [{ key: KEY, manifest: made.manifest, config: made.config }],
        deploys: [{ sequence: 1, keys: [KEY] }],
        drop: [],
        fresh: [],
        last: {
          sequence: 1,
          outcome: "built",
          reason: null,
          at: "2026-11-28T10:00:00.000Z",
        },
      })
    )
    const before = w.docker.calls().length
    const built = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 1,
      builds: [recipe],
    })
    const { result } = await deployV2(w, { rosters: w.rosters, ...built })
    expect(result).toEqual({ outcome: "started", app: "web", sequence: 2 })
    const calls = w.docker.calls().slice(before)
    expect(ups(w.docker).slice(-1)).toEqual([upOf(w.home)])
    expect(
      calls.find((call) => call.args.startsWith("compose "))?.env.GREETING
    ).toBe("hello from the test")
    expect(builds(w.docker)).toEqual([])
    expect(w.docker.model().builds).toEqual([])
    // The kept image is the one that runs, untouched.
    expect(w.docker.model().images).toEqual([made])
  }, 30_000)

  test("an image from a registry starts as before, even beside `build:`", async () => {
    const w = await world()
    const built = await buildDeployV2({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      previous: 0,
      compose:
        "services:\n  web:\n    build: .\n    image: example/web:1\n    environment:\n      - GREETING\n",
    })
    const { result } = await deployV2(w, { rosters: w.rosters, ...built })
    expect(result).toEqual({ outcome: "started", app: "web", sequence: 1 })
    expect(ups(w.docker)).toEqual([upOf(w.home)])
    expect(w.docker.upFinished()).toBe(true)
    expect(builds(w.docker)).toEqual([])
  }, 30_000)
})
