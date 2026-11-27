/**
 * In the session, a deploy that builds, up to its signature
 * (specs/016-build-from-source, contracts/cli.md CL7 steps 6 to 11; tasks
 * T129), against a stand-in server: this repository's runner with the
 * stand-in Docker for `version`, `status` and `records`, and `builder`,
 * `builds` and `deploy` answered as contracts/core.md CO12 gives them
 * (test/support/build-session.ts), since the upload, the build and its
 * events are later tasks' (T130 to T132). A temporary `ZEKNO_HOME` and
 * `memoryKeyStore()`, never the real keychain or `~/.zekno`.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { builtImageName, type Envelope } from "@workspace/core"

import { openTeam } from "../../src/cli/context"
import { prepareDeploy, sendDeploy } from "../../src/ops/deploy"
import type { BuildLine } from "../../src/shared/build-lines"
import { readDeployEntry } from "../../src/shared/history"
import {
  builderAnswer,
  buildsAnswer,
  payloadOf,
  type Script,
  standInSessions,
  started,
} from "../support/build-session"
import { ready } from "../support/helpers"

type Machine = Awaited<ReturnType<typeof ready>>

const WHERE = ["--app", "shop", "--server", "dev"]
const DOCKERFILE = "FROM alpine:3.20\nCOPY . /app\n"

function write(folder: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, name)), { recursive: true })
    writeFileSync(join(folder, name), text)
  }
}

/** A ready machine whose folder holds `files` and a settings file of `services`, with no compose.yaml. */
async function folderWith(
  files: Record<string, string>,
  services: Record<string, unknown>
): Promise<Machine> {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  write(m.project, {
    ...files,
    "zekno.app.json": `${JSON.stringify({ zekno: 1, services }, null, 2)}\n`,
  })
  return m
}

const built = (build: Record<string, unknown> = {}) => ({
  build: { builder: "dockerfile", ...build },
})

/** The stand-in: `builder` can build, `builds` reports `fresh`, `deploy` starts, and `status` reports `number()` for shop. */
function server(
  m: Machine,
  options: {
    fresh?: () => { base: string; sequence: number }[]
    number?: () => number
    builder?: Script["answer"]
  } = {}
) {
  return standInSessions(m.deps, {
    answer: {
      builder: () => builderAnswer(),
      builds: () => buildsAnswer("shop", options.fresh?.() ?? []),
      deploy: started,
      ...options.builder,
    },
    rewrite:
      options.number === undefined
        ? {}
        : {
            status: (result) => {
              const status = result as { lastSequence: Record<string, number> }
              return {
                ...status,
                lastSequence: {
                  ...status.lastSequence,
                  shop: options.number!(),
                },
              }
            },
          },
  })
}

/** The envelope of the last `deploy` the stand-in was handed, and its payload. */
function lastSigned(stand: ReturnType<typeof server>) {
  const input = stand.inputs("deploy").at(-1) as { envelope: Envelope }
  return { envelope: input.envelope, payload: payloadOf(input.envelope) }
}

/** One deploy through the operations, with the lines said while it goes on. */
async function deployOnce(m: Machine, fresh = false) {
  const lines: BuildLine[] = []
  const plan = await prepareDeploy(m.deps, {
    app: "shop",
    server: "dev",
    fresh,
  })
  const result = await sendDeploy(
    m.deps,
    { ...plan, fresh },
    { line: (line) => lines.push(line) }
  )
  return { plan, result, lines }
}

describe("step 8: builder", () => {
  test("docker_too_old stops before signing with F4, naming the engine; nothing signed or recorded", async () => {
    const m = await folderWith({ Dockerfile: DOCKERFILE }, { web: built() })
    const stand = server(m, {
      builder: {
        builder: () =>
          builderAnswer({
            can: "docker_too_old",
            docker: {
              engine: "28.5.1",
              buildx: "0.29.1",
              buildkit: "0.25.1",
              driver: "docker",
            },
          }),
      },
    })
    m.err.length = 0
    expect(await m.zekno("deploy", ...WHERE)).toBe(1)
    expect(m.err).toEqual(["F4"])
    expect(stand.commands()).toEqual(["version", "status", "builder"])
    const team = await openTeam(m.deps)
    expect(
      team.store.history(team.profile.servers[0]!.serverId, "shop")
    ).toEqual([])
    const stop = await prepareDeploy(m.deps, { app: "shop", server: "dev" })
      .then((plan) => sendDeploy(m.deps, plan))
      .catch((error: unknown) => error)
    expect(stop).toMatchObject({
      line: { id: "F4", server: "dev", engine: "28.5.1" },
    })
  }, 60_000)
})

describe("step 9: the fresh generation signed", () => {
  test("a runner that reports none, or an older one, while the history holds a newer: the history's is signed and B30 said", async () => {
    const m = await folderWith({ Dockerfile: DOCKERFILE }, { web: built() })
    let number = 1
    let reported: { base: string; sequence: number }[] = []
    const stand = server(m, { number: () => number, fresh: () => reported })

    // `--fresh` signs the deploy's own number: 2, after the runner's 1.
    const first = await deployOnce(m, true)
    expect(first.result.outcome).toBe("started")
    expect(lastSigned(stand).payload.builds[0]!.fresh).toBe(2)
    expect(first.lines).toEqual([])
    const base = first.plan.build!.builds[0]!.base

    // The runner reports no generation: the history's 2 is signed, B30 says so.
    number = 2
    const second = await deployOnce(m)
    expect(lastSigned(stand).payload.builds[0]!.fresh).toBe(2)
    expect(second.lines).toEqual([
      { id: "B30", server: "dev", service: "web", reported: null, signed: 2 },
    ])

    // The runner reports an older one: the history's again.
    number = 3
    reported = [{ base, sequence: 1 }]
    const third = await deployOnce(m)
    expect(lastSigned(stand).payload.builds[0]!.fresh).toBe(2)
    expect(third.lines).toEqual([
      { id: "B30", server: "dev", service: "web", reported: 1, signed: 2 },
    ])

    // A newer one from the runner wins, with nothing said.
    number = 4
    reported = [{ base, sequence: 4 }]
    const fourth = await deployOnce(m)
    expect(lastSigned(stand).payload.builds[0]!.fresh).toBe(4)
    expect(fourth.lines).toEqual([])
  }, 60_000)

  test("with no history, the server's word is signed; with neither, null", async () => {
    const m = await folderWith({ Dockerfile: DOCKERFILE }, { web: built() })
    let reported: { base: string; sequence: number }[] = []
    const stand = server(m, { number: () => 1, fresh: () => reported })
    const plan = await prepareDeploy(m.deps, { app: "shop", server: "dev" })
    reported = [{ base: plan.build!.builds[0]!.base, sequence: 1 }]
    const lines: BuildLine[] = []
    await sendDeploy(m.deps, plan, { line: (line) => lines.push(line) })
    expect(lastSigned(stand).payload.builds[0]!.fresh).toBe(1)
    expect(lines).toEqual([])
    expect(stand.inputs("builds")).toEqual([{ apps: ["shop"] }])

    const other = await folderWith({ Dockerfile: DOCKERFILE }, { web: built() })
    const quiet = server(other)
    expect(await other.zekno("deploy", ...WHERE)).toBe(0)
    expect(lastSigned(quiet).payload.builds[0]!.fresh).toBeNull()
  }, 60_000)
})

describe("step 10 and 11: what is signed and recorded", () => {
  test("the builds sorted by key, one entry for two services of one folder, each service running its build's image; recorded `sent` then answered, with its builds", async () => {
    const m = await folderWith(
      {
        Dockerfile: DOCKERFILE,
        "Dockerfile.api": "FROM alpine:3.20\nCOPY . /api\n",
      },
      {
        web: built({ dockerfile: "Dockerfile" }),
        worker: built({ dockerfile: "Dockerfile" }),
        api: built({ dockerfile: "Dockerfile.api" }),
      }
    )
    const stand = server(m)
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    const { envelope, payload } = lastSigned(stand)
    const keys = payload.builds.map((build) => build.key)
    expect(keys.length).toBe(2)
    expect([...keys].sort()).toEqual(keys)
    const byDockerfile = (name: string) =>
      payload.builds.find(
        (build) =>
          build.builder.name === "dockerfile" &&
          build.builder.dockerfile === name
      )!
    const shared = byDockerfile("Dockerfile")
    const api = byDockerfile("Dockerfile.api")
    expect(shared.pack).toEqual(api.pack)
    const image = (key: string) => `"${builtImageName("shop", key)}"`
    expect(payload.compose).toContain(
      `  "web":\n    image: ${image(shared.key)}\n    pull_policy: "never"\n`
    )
    expect(payload.compose).toContain(
      `  "worker":\n    image: ${image(shared.key)}\n    pull_policy: "never"\n`
    )
    expect(payload.compose).toContain(
      `  "api":\n    image: ${image(api.key)}\n    pull_policy: "never"\n`
    )

    const team = await openTeam(m.deps)
    const history = team.store.history(
      team.profile.servers[0]!.serverId,
      "shop"
    )
    expect(history.length).toBe(1)
    expect(history[0]!.envelope).toEqual(envelope)
    expect(history[0]!.outcome).toBe("started")
    const entry = readDeployEntry(history[0]!.envelope, team.trust)!
    expect(
      entry.deploy.builds?.map(({ build, services }) => [build.key, services])
    ).toEqual(
      [
        [shared.key, ["web", "worker"]],
        [api.key, ["api"]],
      ].sort((a, b) => (a[0]! < b[0]! ? -1 : 1))
    )
  }, 60_000)

  test("a service with no Build values but its builder signs the data model's values", async () => {
    const m = await folderWith({ Dockerfile: DOCKERFILE }, { web: built() })
    const stand = server(m)
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    const [build] = lastSigned(stand).payload.builds
    expect(build).toMatchObject({
      builder: { name: "dockerfile", dockerfile: "Dockerfile", target: null },
      args: [],
      secrets: [],
      network: "default",
      timeout: 1800,
      fresh: null,
    })
    expect(build!.pack.chunks.length).toBe(1)
  }, 60_000)

  test("the Compose text signed runs the build's image with `pull_policy`, and gives PORT to match the port", async () => {
    const m = await folderWith(
      { Dockerfile: "FROM alpine:3.20\nEXPOSE 3000\n" },
      { web: { ...built(), networking: { port: 3000 } } }
    )
    const stand = server(m)
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    const { payload } = lastSigned(stand)
    const image = builtImageName("shop", payload.builds[0]!.key)
    expect(payload.compose).toBe(
      `services:\n  "web":\n    image: "${image}"\n    pull_policy: "never"\n    expose: ["3000"]\n    environment:\n      "PORT": "3000"\n`
    )
  }, 60_000)

  test("the Compose text signed equals what `zekno settings compose` prints for the same folder, byte for byte (T124)", async () => {
    const m = await folderWith(
      { Dockerfile: "FROM alpine:3.20\nEXPOSE 3000\n" },
      { web: { ...built(), networking: { port: 3000 } } }
    )
    // A zekno.json names the app, so both take it from there: `zekno settings compose` takes no `--app` (CL1).
    expect(await m.zekno("link", ...WHERE)).toBe(0)
    const stand = server(m)
    expect(await m.zekno("deploy")).toBe(0)
    const signed = lastSigned(stand).payload.compose
    expect(signed).toContain("zekno.invalid/shop:")
    m.out.length = 0
    expect(await m.zekno("settings", "compose")).toBe(0)
    expect(`${m.out.join("\n")}\n`).toBe(signed)
  }, 60_000)
})

describe("a deploy that does not build", () => {
  test("makes exactly today's requests: no builder, no builds", async () => {
    const m = await folderWith({}, { web: { source: { image: "nginx:1" } } })
    const stand = standInSessions(m.deps, {})
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect(stand.commands()).toEqual(["version", "status", "records", "deploy"])
  }, 60_000)
})
