/**
 * The runner acts only in a folder nobody else can write (specs/014-deploy-v2,
 * security review S3, probe 3). The folder, `server.key` and `state.json` must
 * belong to this user with no group or other permission; the commands that
 * take the lock (`sync`, `apply`, `deploy`) check it before they take it, as
 * the reads do, and the runner never changes the mode of a folder it did not
 * create, so an open folder is refused, and stays as open as it was, rather
 * than made private and then trusted. `setup` takes a folder that is not set
 * up yet and makes it private, as before.
 */
import { describe, expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import {
  buildDeployV2,
  deployV2,
  leftAsItWas,
  recordsOf,
} from "../support/deploy-v2"
import {
  buildDeploy,
  deployed,
  fakeDocker,
  runner,
  tempDir,
  world,
} from "../support/helpers"

const mode = (path: string) => statSync(path).mode & 0o777

const INVALID = { outcome: "refused", reason: "invalid_state" }

type World = Awaited<ReturnType<typeof world>>

/** `sync`, `apply` and `deploy` each answer `invalid_state`, and nothing changes, the modes included. */
async function lockedRefused(w: World) {
  const before = leftAsItWas(w)
  const modes = [mode(w.home), mode(join(w.home, "state.json"))]
  expect(
    (await runner(w.home, w.docker.path, "sync", { rosters: w.rosters })).json
  ).toEqual(INVALID)
  const v1 = await buildDeploy({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    sequence: 2,
  })
  expect(
    (
      await runner(w.home, w.docker.path, "apply", {
        rosters: w.rosters,
        deploy: v1,
      })
    ).json
  ).toEqual(INVALID)
  const v2 = await buildDeployV2({
    trust: w.trust,
    serverId: w.serverId,
    signer: w.signer,
    previous: 1,
  })
  expect((await deployV2(w, { rosters: w.rosters, ...v2 })).result).toEqual(
    INVALID
  )
  expect(leftAsItWas(w)).toEqual(before)
  expect([mode(w.home), mode(join(w.home, "state.json"))]).toEqual(modes)
}

describe("a folder others could write (security review S3, probe 3)", () => {
  test("a folder of mode 0777: every command refuses it, and its mode stays 0777", async () => {
    const w = await deployed(["web"])
    chmodSync(w.home, 0o777)
    expect((await runner(w.home, w.docker.path, "status")).json).toEqual(
      INVALID
    )
    expect(await recordsOf(w, "web")).toEqual(INVALID)
    await lockedRefused(w)
    expect(mode(w.home)).toBe(0o777)
  })

  test("a folder open to its group, 0770, is refused too", async () => {
    const w = await deployed(["web"])
    chmodSync(w.home, 0o770)
    await lockedRefused(w)
  })

  test("a state.json others can read or write is refused, by the reads and the locked commands, and its mode stays", async () => {
    const w = await deployed(["web"])
    const state = join(w.home, "state.json")
    for (const open of [0o666, 0o644, 0o640]) {
      chmodSync(state, open)
      expect((await runner(w.home, w.docker.path, "status")).json).toEqual(
        INVALID
      )
      await lockedRefused(w)
      expect(mode(state)).toBe(open)
    }
    // Made private again by hand, the runner acts again.
    chmodSync(state, 0o600)
    expect(
      (await runner(w.home, w.docker.path, "sync", { rosters: w.rosters })).json
    ).toEqual({ outcome: "ok" })
  })

  test("formats set back by hand in an open state.json: the version-1 deploy that probe 3 got taken is refused", async () => {
    const w = await deployed(["web"])
    chmodSync(w.home, 0o777)
    const path = join(w.home, "state.json")
    chmodSync(path, 0o666)
    const stored = JSON.parse(readFileSync(path, "utf8"))
    writeFileSync(
      path,
      JSON.stringify({ ...stored, formats: { ...stored.formats, web: 1 } })
    )
    const v1 = await buildDeploy({
      trust: w.trust,
      serverId: w.serverId,
      signer: w.signer,
      sequence: 2,
    })
    const before = leftAsItWas(w)
    expect(
      (
        await runner(w.home, w.docker.path, "apply", {
          rosters: w.rosters,
          deploy: v1,
        })
      ).json
    ).toEqual(INVALID)
    expect(leftAsItWas(w)).toEqual(before)
    expect([mode(w.home), mode(path)]).toEqual([0o777, 0o666])
  })
})

describe("setup still takes a folder that is not set up, and makes it private", () => {
  test("a folder that does not exist yet is made with mode 0700", async () => {
    const home = join(tempDir("parent"), "runner")
    const w = await setUpIn(home)
    expect(w.json?.serverId).toStartWith("srv_")
    expect(mode(home)).toBe(0o700)
  })

  test("an empty folder made with ordinary permissions, 0755, is made 0700, and the runner then acts in it", async () => {
    const home = join(tempDir("parent"), "runner")
    mkdirSync(home)
    chmodSync(home, 0o755)
    const w = await setUpIn(home)
    expect(w.json?.serverId).toStartWith("srv_")
    expect(mode(home)).toBe(0o700)
    expect(mode(join(home, "state.json"))).toBe(0o600)
    expect((await runner(home, w.docker, "status")).json?.serverId).toBe(
      w.json?.serverId
    )
  })
})

/** Sets a runner up in `home` for a new team, as `world()` does, and gives its answer. */
async function setUpIn(home: string) {
  const w = await world()
  const docker = fakeDocker().path
  const { json } = await runner(home, docker, "setup", {
    founding: w.team.envelope,
    teamCode: w.team.confirmationCode,
  })
  return { json, docker }
}
