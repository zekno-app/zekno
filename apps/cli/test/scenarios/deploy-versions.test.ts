/**
 * Old and new programs say plainly what to do (specs/014-deploy-v2, User
 * Story 4; contracts/cli.md, "The format", CL1 and CL8; research R16, R18;
 * tasks T053, T054), with stand-ins that run in every clone: the runner of
 * this repository answering `version` as runner 0.1.0 of protocol 2, over a
 * state as runner 0.1.0 writes it, reached over a stand-in SSH, and this
 * zekno carrying runner 0.1.1 (`deps.release`). Against it a deploy is signed
 * in version 1 and says C6; against a runner of a newer protocol it stops
 * before signing with C7.
 */
import { describe, expect, test } from "bun:test"
import { RUNNER_PROTOCOL } from "@workspace/core"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { olderState } from "../../../runner/test/support/deploy-v2"
import { explainDeploy } from "../../src/cli/errors"
import { plainUi } from "../../src/ui/plain/plain"
import { C6, C7 } from "../../src/shared/deploy-words"
import { historyOf } from "../support/deploys"
import { COMPOSE_V1, COMPOSE_V2, machine } from "../support/helpers"
import {
  reportingRunner,
  sshStandIn,
  standInServer,
  withSsh,
} from "../support/stand-in-server"

type Machine = ReturnType<typeof machine>

const where = ["--app", "web", "--server", "prod"]

/** W3 (specs/005-runner-release, contracts/versions.md), as `zekno status` and `zekno server add` say it for runner 0.1.0. */
const W3 = (carried: string) =>
  `The runner on prod is version 0.1.0, older than this zekno's ${carried}. Deploys still work. Some of what this zekno does needs the newer runner: run \`zekno server update prod\`.`
/** W5, for a runner of a newer protocol. */
const W5 =
  "The runner on prod is version 0.2.0, newer than this zekno's 0.1.1, and speaks a newer protocol. Update zekno before you deploy to prod."

/** This zekno, as one built to carry runner `version`. */
const carrying = (m: Machine, version: string) =>
  (m.deps.release = {
    version,
    files: { "linux-x64": { sha256: null }, "linux-arm64": { sha256: null } },
  })

/**
 * Every line the machine says, in order, marked `out` or `err`: whether C6
 * comes before the result. `history` notes, at each C6, what the history
 * held then: the deploy was signed and saved before C6 was said.
 */
function inOrder(m: Machine) {
  const lines: string[] = []
  const atC6: ReturnType<typeof historyOf>[] = []
  const askSecret = m.deps.ui.askSecret
  m.deps.ui = {
    ...plainUi(
      (line) => {
        lines.push(`out ${line}`)
        m.out.push(line)
      },
      (line) => {
        lines.push(`err ${line}`)
        m.err.push(line)
        if (line.includes("so this deploy was signed in the older format"))
          atC6.push(historyOf(m, "web"))
      }
    ),
    askSecret,
  }
  return { lines, atC6 }
}

/**
 * A server over a stand-in SSH whose runner answers as runner 0.1.0, added
 * by this zekno carrying `carried`, and whose state is as runner 0.1.0 left
 * it holding web at 1.
 */
async function onRunnerZeroOneZero(carried = "0.1.1") {
  const m = machine()
  expect(await m.zekno("init", "--name", "Ada")).toBe(0)
  const server = standInServer()
  server.installed(reportingRunner(m.docker.path, "0.1.0", 2))
  carrying(m, carried)
  const ssh = sshStandIn(server)
  const order = inOrder(m)
  const run = <T>(work: () => Promise<T>) => withSsh(ssh, work)
  const from = m.err.length
  await run(async () =>
    expect(
      await m.zekno("server", "add", "prod", "--ssh", "deploy@example.test")
    ).toBe(0)
  )
  const added = m.err.slice(from)
  olderState(server.folder, { web: 1 })
  m.compose(COMPOSE_V1)
  return { m, server, run, added, ...order }
}

describe("US4 scenario 1: this zekno against runner 0.1.0", () => {
  test("`zekno deploy` signs version 1, says C6 after signing and before the result, and starts", async () => {
    const { m, run, lines, atC6 } = await onRunnerZeroOneZero()
    const from = lines.length
    expect(await run(() => m.zekno("deploy", ...where))).toBe(0)
    const c6 = C6("prod", "0.1.0", "0.1.1")
    expect(lines.slice(from)).toEqual([
      `err ${c6}`,
      "out Deploy 2 of web is running on prod with no secrets.",
    ])
    // Said once the deploy was signed and saved, before its answer came.
    expect(atC6).toHaveLength(1)
    expect(atC6[0]!.map((entry) => entry.outcome)).toEqual(["sent"])
    expect(atC6[0]![0]!.envelope.payloadType).toBe("zekno.deploy.v1")
    expect(historyOf(m, "web").map((entry) => entry.outcome)).toEqual([
      "started",
    ])
  })

  test("`zekno rollback` the same", async () => {
    const { m, run, lines } = await onRunnerZeroOneZero()
    await run(() => m.zekno("deploy", ...where))
    m.compose(COMPOSE_V2)
    await run(() => m.zekno("deploy", ...where))
    const from = lines.length
    expect(await run(() => m.zekno("rollback", ...where))).toBe(0)
    expect(lines.slice(from)).toEqual([
      "out Rolling back web to what deploy 2 ran.",
      `err ${C6("prod", "0.1.0", "0.1.1")}`,
      "out Deploy 4 of web is running on prod with no secrets.",
    ])
    expect(historyOf(m, "web").at(-1)!.envelope.payloadType).toBe(
      "zekno.deploy.v1"
    )
  })

  test("carrying 0.1.0, the runner's own version: version 1, and no C6 (research R18)", async () => {
    const { m, run, lines } = await onRunnerZeroOneZero("0.1.0")
    const from = lines.length
    expect(await run(() => m.zekno("deploy", ...where))).toBe(0)
    expect(lines.slice(from)).toEqual([
      "out Deploy 2 of web is running on prod with no secrets.",
    ])
    expect(historyOf(m, "web")[0]!.envelope.payloadType).toBe("zekno.deploy.v1")
  })

  test("`zekno status` and `zekno server add` say W3; `zekno doctor`'s Runner line says it is older", async () => {
    const { m, server, run, added } = await onRunnerZeroOneZero()
    expect(added).toEqual([W3("0.1.1")])
    const from = m.err.length
    expect(await run(() => m.zekno("status", "--server", "prod"))).toBe(0)
    expect(m.err.slice(from)).toEqual([W3("0.1.1")])

    server.df(64 * 1024 * 1024)
    const out = m.out.length
    await run(() => m.zekno("doctor", "--server", "prod"))
    expect(m.out.slice(out)).toContainEqual(
      "prod\trunner\twarning\t0.1.0, older than this zekno's 0.1.1\tRun zekno server update prod"
    )
  })

  test("a new app through the version-1 path is refused, and said with R7", async () => {
    const { m, server, run } = await onRunnerZeroOneZero()
    const state = () => readFileSync(join(server.folder, "state.json"), "utf8")
    const before = state()
    expect(
      await run(() => m.zekno("deploy", "--app", "other", "--server", "prod"))
    ).toBe(1)
    expect(m.lastErr()).toBe(explainDeploy("unsupported_version", 1))
    expect(state()).toBe(before)
  })
})

describe("US4 scenario 4: this zekno against a runner of a newer protocol", () => {
  test("`zekno deploy` and `zekno rollback` say C7, exit 1, and sign nothing; `zekno status` still says W5", async () => {
    const { m, server, run } = await onRunnerZeroOneZero()
    await run(() => m.zekno("deploy", ...where))
    await run(() => m.zekno("deploy", ...where))
    writeFileSync(
      server.runnerPath,
      reportingRunner(m.docker.path, "0.2.0", RUNNER_PROTOCOL + 1)
    )
    const history = historyOf(m, "web")
    const ups = m.docker.calls().length
    const c7 = C7("prod", "0.2.0", "0.1.1")

    expect(await run(() => m.zekno("deploy", ...where))).toBe(1)
    expect(m.lastErr()).toBe(c7)
    expect(await run(() => m.zekno("rollback", ...where))).toBe(1)
    expect(m.lastErr()).toBe(c7)
    expect(historyOf(m, "web")).toEqual(history)
    expect(m.docker.calls().length).toBe(ups)

    const from = m.err.length
    expect(await run(() => m.zekno("status", "--server", "prod"))).toBe(0)
    expect(m.err.slice(from)).toEqual([W5])
  })
})
