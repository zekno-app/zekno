/**
 * Protocol 5 end to end (specs/015-domains-https, contracts/core.md, "The
 * protocol"; security review, lead A10), against the runner of this
 * repository with the stand-in Docker. `zekno deploy` in plain output says
 * B20 when the runner reports that it stopped waiting for the start at its
 * time limit (`startLimit`), and `--json` carries the report as it came. A
 * runner of protocol 4, released before the limit, still takes every deploy,
 * with a domain or without, and is only said to be older.
 */
import { describe, expect, test } from "bun:test"
import { RUNNER_PROTOCOL } from "@workspace/core"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { chooseFormat, ROUTES_PROTOCOL } from "../../src/ops/deploy-format"
import { runnerRelation, runnerWarning } from "../../src/ops/server"
import { C7 } from "../../src/shared/deploy-words"
import { stoppedWaitingPlain } from "../../src/shared/start-limit"
import { entriesOf } from "../support/deploys"
import { ready } from "../support/helpers"
import { reportingAs } from "../support/older-runner"
import { wire } from "../support/wire"

const WHERE = ["--app", "web", "--server", "dev"]
/** A Compose file that expects no value, so a deploy asks nothing. */
const PLAIN = "services:\n  web:\n    image: example/web:1\n"

/** The runner's answer to `deploy` when `up` did not end within its limit of 30 minutes. */
const stopped = (result: Record<string, unknown>) => ({
  ...result,
  outcome: "start_failed",
  startLimit: 1800,
})

describe("zekno deploy when the runner stopped waiting for the start (B20)", () => {
  test("plain: B20 on standard error in place of today's line, exit 1, the history keeps start_failed", async () => {
    const m = await ready()
    m.compose(PLAIN)
    const w = wire(m.deps)
    w.rewrite("deploy", stopped)
    m.out.length = 0
    m.err.length = 0
    expect(await m.zekno("deploy", ...WHERE)).toBe(1)
    w.restore()
    expect({ out: m.out, err: m.err }).toEqual({
      out: [],
      err: [stoppedWaitingPlain("dev", 1, "web", 1800)],
    })
    const [entry] = await entriesOf(m, "web")
    expect(entry?.outcome).toBe("start_failed")
    // The number is used: the next deploy is made after it.
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect((await entriesOf(m, "web")).at(-1)?.deploy.previous).toBe(1)
  }, 60_000)

  test("--json: the report as the runner gave it, with startLimit, and the server", async () => {
    const m = await ready()
    m.compose(PLAIN)
    const w = wire(m.deps)
    w.rewrite("deploy", stopped)
    m.out.length = 0
    expect(await m.zekno("deploy", ...WHERE, "--json")).toBe(1)
    w.restore()
    expect(m.out.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        outcome: "start_failed",
        app: "web",
        sequence: 1,
        startLimit: 1800,
        server: "dev",
      },
    ])
  }, 60_000)
})

/** The protocol of a runner released before the start limit (specs/015-domains-https): routes and health, no limit. */
const BEFORE_THE_LIMIT = 4

describe("this zekno and a runner of protocol 4 (released before the limit)", () => {
  test("deploys with a domain and without, saying nothing of the protocol; it is only said to be older", async () => {
    // Protocol 6 (specs/016-build-from-source, contracts/core.md CO17): the runner of this repository is two above it.
    expect(RUNNER_PROTOCOL).toBe(6)
    expect(BEFORE_THE_LIMIT).toBe(ROUTES_PROTOCOL)
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(
      join(m.project, "zekno.app.json"),
      JSON.stringify({
        zekno: 1,
        services: {
          web: {
            source: { image: "ghcr.io/acme/shop-web:1.0.0" },
            networking: { port: 3000 },
          },
        },
      })
    )
    expect(await m.zekno("link", "--app", "shop", "--server", "dev")).toBe(0)
    m.docker.app("shop", { web: 1 })
    expect(await m.zekno("domain", "add", "shop.example.com", "--yes")).toBe(0)
    // This zekno, as one built to carry runner 0.1.1, and a runner of 0.1.0 of protocol 4.
    m.deps.release = {
      version: "0.1.1",
      files: { "linux-x64": { sha256: null }, "linux-arm64": { sha256: null } },
    }
    const back = reportingAs(m, "0.1.0", BEFORE_THE_LIMIT)

    m.err.length = 0
    expect(await m.zekno("deploy")).toBe(0)
    expect(await m.zekno("domain", "rm", "shop.example.com", "--yes")).toBe(0)
    expect(await m.zekno("deploy")).toBe(0)
    const entries = await entriesOf(m, "shop")
    expect(entries.map((entry) => [entry?.format, entry?.outcome])).toEqual([
      [2, "started"],
      [2, "started"],
    ])
    expect(entries.map((entry) => entry?.deploy.routes)).toEqual([
      [{ domain: "shop.example.com", service: "web", port: 3000 }],
      [],
    ])
    expect(m.err.filter((line) => line.includes("protocol"))).toEqual([])

    back()

    // What `server add`, `status` and the app say of such a runner on a server reached over SSH: W3, older.
    const relation = runnerRelation(
      "session",
      { version: "0.1.0", protocol: BEFORE_THE_LIMIT },
      "0.1.1"
    )
    expect(relation).toEqual({
      relation: "older",
      missing: "some",
      newerProtocol: false,
    })
    expect(runnerWarning("prod-1", "0.1.0", relation, "0.1.1")).toBe(
      "The runner on prod-1 is version 0.1.0, older than this zekno's 0.1.1. Deploys still work. Some of what this zekno does needs the newer runner: run `zekno server update prod-1`."
    )
  }, 60_000)

  test("the other way round: a zekno of protocol 5 is told to update by this runner, before anything is signed (C7)", () => {
    // A zekno sees a runner one protocol above its own exactly as a zekno of 5 sees this runner of 6.
    const relation = runnerRelation(
      "session",
      { version: "0.1.2", protocol: RUNNER_PROTOCOL + 1 },
      "0.1.1"
    )
    expect(relation).toEqual({
      relation: "newer",
      missing: "nothing",
      newerProtocol: true,
    })
    expect(() =>
      chooseFormat({
        server: "prod-1",
        mode: "session",
        runner: { version: "0.1.2", protocol: RUNNER_PROTOCOL + 1 },
        carried: "0.1.1",
      })
    ).toThrow(C7("prod-1", "0.1.2", "0.1.1"))
  })
})
