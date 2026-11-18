/**
 * What a runner holds always fits the answers that report it (L3 of the
 * review of the runner, specs/004-cli-app/security-review.md): a deploy of
 * one app or one secret past the limits is refused, and an answer about what
 * is running is never cut short. The states written here are marked, each
 * app with its format, as a runner of version 2 keeps them (contracts/
 * state.md).
 */
import { describe, expect, test } from "bun:test"
import { LIMITS, parseMessage, RunnerAppStatesSchema } from "@workspace/core"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { appStates } from "../../src/docker/inspect"
import { buildDeployV2, deployV2 } from "../support/deploy-v2"
import { deployed } from "../support/helpers"

describe("what a runner holds always fits the answers that report it (L3)", () => {
  const state = (home: string) =>
    JSON.parse(readFileSync(join(home, "state.json"), "utf8"))
  const keep = (home: string, value: unknown) =>
    writeFileSync(join(home, "state.json"), JSON.stringify(value))

  test("a deploy of one app or one secret past the limits is refused as too large; a deploy within them still goes", async () => {
    const w = await deployed(["web"])
    const held = state(w.home)
    // As many apps as a runner holds, `web` among them, each with its format (contracts/state.md).
    for (let n = 1; n < LIMITS.appsPerServer; n++) {
      held.lastSequence[`app-${n}`] = 1
      held.formats[`app-${n}`] = 1
    }
    // As many secrets as it remembers, `web/GREETING` among them.
    for (
      let n = Object.keys(held.secrets).length;
      n < LIMITS.secretsPerServer;
      n++
    )
      held.secrets[`app-1/S${n}`] = { version: 1, hash: "0".repeat(64) }
    keep(w.home, held)
    const send = async (deploy: Awaited<ReturnType<typeof buildDeployV2>>) =>
      (await deployV2(w, { rosters: w.rosters, ...deploy })).result
    const next = (app: string, values?: Record<string, string>) =>
      buildDeployV2({
        trust: w.trust,
        serverId: w.serverId,
        signer: w.signer,
        previous: app === "web" ? 1 : 0,
        app,
        values,
      })
    expect(await send(await next("one-more"))).toEqual({
      outcome: "refused",
      reason: "too_large",
    })
    expect(
      await send(await next("web", { GREETING: "hello", ONE_MORE: "x" }))
    ).toEqual({ outcome: "refused", reason: "too_large" })
    expect(state(w.home).lastSequence.web).toBe(1)
    expect(await send(await next("web"))).toEqual({
      outcome: "started",
      app: "web",
      sequence: 2,
    })
    expect(Object.keys(state(w.home).lastSequence)).toHaveLength(
      LIMITS.appsPerServer
    )
  })

  test("an answer about what is running holds at most 4096 services: an app past them is left out, never cut short", async () => {
    const w = await deployed(["web"])
    const held = state(w.home)
    const apps = [
      "web",
      ...Array.from(
        { length: LIMITS.servicesPerServer / LIMITS.servicesPerApp },
        (_, n) => `app-${n}`
      ),
    ]
    for (const app of apps) {
      held.lastSequence[app] = 1
      held.formats[app] ??= 1
      w.docker.ps(
        app,
        Array.from({ length: LIMITS.servicesPerApp }, (_, n) =>
          JSON.stringify({
            Service: `s${n}`,
            State: "running",
            ExitCode: 0,
            Health: "",
          })
        ).join("\n")
      )
    }
    keep(w.home, held)
    const saved = process.env.ZEKNO_DOCKER
    process.env.ZEKNO_DOCKER = w.docker.path
    try {
      const answer = (await appStates(
        w.home,
        new AbortController().signal
      )) as { apps: Record<string, { services: unknown[] }> }
      expect(Object.keys(answer.apps)).toEqual(apps.slice(0, -1))
      for (const app of apps.slice(0, -1))
        expect(answer.apps[app]!.services).toHaveLength(LIMITS.servicesPerApp)
      expect(parseMessage(RunnerAppStatesSchema, answer).ok).toBe(true)
    } finally {
      if (saved === undefined) delete process.env.ZEKNO_DOCKER
      else process.env.ZEKNO_DOCKER = saved
    }
  })
})
