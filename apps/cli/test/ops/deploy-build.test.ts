/**
 * Before the session, a deploy that builds (specs/016-build-from-source,
 * contracts/cli.md CL7 steps 1 to 4; tasks T126). Each stop is said by its
 * line's id, with exit status 1, before any connection is opened: the
 * stand-in server records no request, and nothing is left in this run's
 * folder. Two services of one folder make one pack and one build. Every
 * fixture is written at run time in a temporary folder, with a temporary
 * `ZEKNO_HOME` and `memoryKeyStore()`; no test reaches the real keychain or
 * `~/.zekno`.
 */
import { describe, expect, test } from "bun:test"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

import { prepareDeploy } from "../../src/ops/deploy"
import { exitStatusOf, type BuildLineId } from "../../src/shared/build-lines"
import { standInSessions } from "../support/build-session"
import { answering, ready } from "../support/helpers"

type Machine = Awaited<ReturnType<typeof ready>>

const DOCKERFILE = "FROM alpine:3.20\nCOPY . /app\n"

/** Writes `files` under `folder`, making the folders on the way. */
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

const built = (build: Record<string, unknown> = {}, more = {}) => ({
  build: { builder: "dockerfile", ...build },
  ...more,
})

/** This run's own folders left under the profile folder. */
const runFolders = (m: Machine): string[] =>
  existsSync(join(m.home, "tmp")) ? readdirSync(join(m.home, "tmp")) : []

/** Runs `zekno deploy` with no terminal and expects the stop `id`: exit status 1, no connection, no run folder kept. */
async function stops(
  m: Machine,
  id: BuildLineId,
  args: string[] = ["--app", "shop", "--server", "dev"]
): Promise<void> {
  const session = standInSessions(m.deps, {})
  m.err.length = 0
  expect(await m.zekno("deploy", ...args)).toBe(1)
  expect(m.err).toEqual([id])
  expect(exitStatusOf(id)).toBe(1)
  expect(session.asked).toEqual([])
  expect(session.connections()).toBe(0)
  expect(runFolders(m)).toEqual([])
}

describe("each stop before the session, by its id, exit status 1, nothing asked of the server", () => {
  test("C21: --fresh on a deploy of a Compose file, and of a settings file that builds nothing", async () => {
    const m = await ready()
    await stops(m, "C21", ["--app", "shop", "--server", "dev", "--fresh"])
    const n = await folderWith({}, { web: { source: { image: "nginx:1" } } })
    await stops(n, "C21", ["--app", "shop", "--server", "dev", "--fresh"])
  }, 60_000)

  test("C21 at a terminal too: --fresh reaches the deploy that asks what is missing (CL12)", async () => {
    const m = await ready()
    writeFileSync(
      join(m.project, "compose.yaml"),
      "services:\n  web:\n    image: example/web:1\n"
    )
    const session = standInSessions(m.deps, {})
    // Nothing is missing, so nothing is asked: the test gives no answer.
    answering(m, [])
    m.err.length = 0
    expect(
      await m.zekno("deploy", "--app", "shop", "--server", "dev", "--fresh")
    ).toBe(1)
    expect(m.err).toEqual(["C21"])
    expect(session.connections()).toBe(0)
    expect(runFolders(m)).toEqual([])
  }, 60_000)

  test("C21c: an app whose name ends with a hyphen has no built service", async () => {
    const m = await folderWith({ Dockerfile: DOCKERFILE }, { web: built() })
    await stops(m, "C21c", ["--app", "shop-", "--server", "dev"])
  }, 60_000)

  test("C21b: a folder sent that holds zekno's own folder is refused before it is walked", async () => {
    const m = await folderWith({ Dockerfile: DOCKERFILE }, { web: built() })
    const inside = join(m.project, "zekno-home")
    cpSync(m.home, inside, { recursive: true })
    m.deps.home = inside
    await stops(m, "C21b")
  }, 60_000)

  test("C20: a file `dockerfile` does not stand for the setting `Dockerfile`", async () => {
    const m = await folderWith({ dockerfile: DOCKERFILE }, { web: built() })
    await stops(m, "C20")
  }, 60_000)

  test("C21a: build.dockerfile left out beside Dockerfile.prod, or beside a sent api/Dockerfile", async () => {
    const beside = await folderWith(
      { Dockerfile: DOCKERFILE, "Dockerfile.prod": DOCKERFILE },
      { web: built() }
    )
    await stops(beside, "C21a")
    const nested = await folderWith(
      { Dockerfile: DOCKERFILE, "api/Dockerfile": DOCKERFILE },
      { web: built() }
    )
    await stops(nested, "C21a")
  }, 60_000)

  test("C21a counts only what is sent, and not with build.dockerfile set", async () => {
    const ignored = await folderWith(
      {
        Dockerfile: DOCKERFILE,
        "api/Dockerfile": DOCKERFILE,
        ".dockerignore": "api\n",
      },
      { web: built() }
    )
    const plan = await prepareDeploy(ignored.deps, {
      app: "shop",
      server: "dev",
    })
    expect(plan.build?.builds.length).toBe(1)
    plan.build?.run.remove()
    const named = await folderWith(
      { Dockerfile: DOCKERFILE, "Dockerfile.prod": DOCKERFILE },
      { web: built({ dockerfile: "Dockerfile.prod" }) }
    )
    const chosen = await prepareDeploy(named.deps, {
      app: "shop",
      server: "dev",
    })
    expect(chosen.build?.builds[0]?.dockerfile).toBe("Dockerfile.prod")
    chosen.build?.run.remove()
  }, 60_000)

  test("CL3: C10 for an image under zekno.invalid, C12 for a remote ADD with no checksum, C18 for a stage the file does not name", async () => {
    await stops(
      await folderWith(
        { Dockerfile: "FROM zekno.invalid/blog:1\n" },
        { web: built() }
      ),
      "C10"
    )
    await stops(
      await folderWith(
        { Dockerfile: "FROM alpine:3.20\nADD https://example.com/a.tgz /a\n" },
        { web: built() }
      ),
      "C12"
    )
    await stops(
      await folderWith(
        { Dockerfile: "FROM alpine:3.20 AS base\n" },
        { web: built({ stage: "release" }) }
      ),
      "C18"
    )
  }, 60_000)

  test("C17: more than 8 builds", async () => {
    const files: Record<string, string> = {}
    const services: Record<string, unknown> = {}
    for (let at = 1; at <= 9; at++) {
      files[`Dockerfile.${at}`] = `FROM alpine:3.20\nRUN echo ${at}\n`
      services[`s${at}`] = built({ dockerfile: `Dockerfile.${at}` })
    }
    await stops(await folderWith(files, services), "C17")
  }, 60_000)

  test("C1: pass 1 past 512 MiB, a sparse file, before anything is read or sealed", async () => {
    const m = await folderWith({ Dockerfile: DOCKERFILE }, { web: built() })
    writeFileSync(join(m.project, "big.bin"), "")
    truncateSync(join(m.project, "big.bin"), 513 * 1024 * 1024)
    await stops(m, "C1")
  }, 60_000)
})

describe("services grouped into builds", () => {
  test("two services of one folder make one pack and one build, whose pieces are sealed in this run's folder", async () => {
    const m = await folderWith(
      { Dockerfile: DOCKERFILE, "app.js": "console.log(1)\n" },
      { web: built(), worker: built() }
    )
    const plan = await prepareDeploy(m.deps, { app: "shop", server: "dev" })
    const builds = plan.build!.builds
    expect(builds.length).toBe(1)
    expect(builds[0]!.services).toEqual(["web", "worker"])
    expect(builds[0]!.dockerfile).toBe("Dockerfile")
    expect(builds[0]!.target).toBeNull()
    expect(builds[0]!.network).toBe("default")
    expect(builds[0]!.timeout).toBe(1800)
    expect(builds[0]!.base).toMatch(/^[0-9a-f]{64}$/)
    const pieces = builds[0]!.pack.pieces.map((piece) => piece.fingerprint)
    expect(pieces.length).toBe(1)
    expect(readdirSync(plan.build!.run.path)).toEqual(pieces)
    plan.build!.run.remove()
    expect(runFolders(m)).toEqual([])
  }, 60_000)

  test("two recipes of one folder: two builds, one pack, the code sealed once", async () => {
    const m = await folderWith(
      {
        Dockerfile: DOCKERFILE,
        "Dockerfile.worker": "FROM alpine:3.20\nCOPY . /worker\n",
      },
      {
        web: built({ dockerfile: "Dockerfile" }),
        worker: built({ dockerfile: "Dockerfile.worker", network: "none" }),
      }
    )
    const plan = await prepareDeploy(m.deps, { app: "shop", server: "dev" })
    const [web, worker] = plan.build!.builds
    expect(web!.services).toEqual(["web"])
    expect(worker!.services).toEqual(["worker"])
    expect(worker!.network).toBe("none")
    expect(web!.pack.hash).toBe(worker!.pack.hash)
    expect(web!.base).not.toBe(worker!.base)
    expect(readdirSync(plan.build!.run.path).length).toBe(1)
    plan.build!.run.remove()
  }, 60_000)

  test("a deploy with no built service takes none of these steps: no run folder, the Compose text as today", async () => {
    const m = await folderWith({}, { web: { source: { image: "nginx:1" } } })
    const plan = await prepareDeploy(m.deps, { app: "shop", server: "dev" })
    expect(plan.build).toBeUndefined()
    expect(plan.compose).toBe('services:\n  "web":\n    image: "nginx:1"\n')
    expect(existsSync(join(m.home, "tmp"))).toBe(false)
  }, 60_000)
})
