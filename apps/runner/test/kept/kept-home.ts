/**
 * A runner's folder for the tests of kept images (specs/016-build-from-
 * source, T089, T090): set up in this process, with a server key and a state
 * marked 5 whose app `web` is at format 2, and the deploys and images a
 * test lays down, each as B3 and U would leave them (contracts/runner.md
 * RB3; core.md CO13). Docker is the stand-in.
 */
import {
  builtImageName,
  createSigner,
  createTeam,
  generateMemberKeyPair,
  generateServerKeyPair,
  keepAfter,
  newRunnerState,
  readRunnerState,
  withAppBuilds,
  type AppBuilds,
  type BuildRecord,
  type StoredRunnerState,
} from "@workspace/core"
import { realpathSync } from "node:fs"

import { readState, writeKeys, writeState } from "../../src/home/home"
import { writeRecord } from "../../src/kept/records"
import { tempDir, type FakeDocker } from "../support/helpers"

/** The state of the runner's folder, as it is on disk. */
export const stateIn = (home: string): StoredRunnerState =>
  readRunnerState(readState(home))

/** The app's builds in the state, or undefined. */
export const buildsOf = (home: string, app = "web"): AppBuilds | undefined =>
  stateIn(home).builds[app]

/** A set-up runner's folder whose apps (by default `web`) are at format 2 with `last` as their last number. */
export async function keptHome(
  apps: Record<string, number> = { web: 20 }
): Promise<string> {
  const signer = createSigner(generateMemberKeyPair().secretKey)
  const team = await createTeam({ founderName: "Ada", signer })
  const keys = generateServerKeyPair()
  const home = realpathSync(tempDir("kept-home"))
  writeKeys(home, keys)
  const state = newRunnerState({ serverId: keys.serverId, team: team.trust })
  writeState(home, {
    ...state,
    lastSequence: { ...apps },
    formats: Object.fromEntries(Object.keys(apps).map((app) => [app, 2])),
  })
  return home
}

/** The record B3 writes for a build of `key` with these digests. */
export const recordFor = (
  key: string,
  digests: { manifest: string; config: string }
): BuildRecord => ({
  key,
  manifest: digests.manifest,
  config: digests.config,
  builder: "dockerfile",
  railpack: null,
  docker: { engine: "29.6.1", buildx: "0.34.1", buildkit: "0.31.1" },
  reader: { kind: "dockerfile", version: "1.20.1" },
  cache: false,
  bases: [],
  arch: "amd64",
  built: "2026-11-28T10:00:00.000Z",
})

/**
 * What B3 leaves for a deploy of `web` that built `built` (keys not yet
 * kept) and reuses the rest of `keys`: the stand-in tags each new image, its
 * record is written, and the state takes the deploy through `keepAfter`
 * with the `running` before it. Gives the deploy as `retain` takes it.
 */
export function laidDown(
  home: string,
  docker: FakeDocker,
  deploy: { sequence: number; keys: string[]; built?: string[] }
): { sequence: number; keys: string[]; outcome: "built" | "reused" } {
  const keys = [...deploy.keys].sort()
  const built = deploy.built ?? []
  const images = built.map((key) => {
    const image = docker.image(builtImageName("web", key))
    writeRecord(home, "web", recordFor(key, image))
    return { key, manifest: image.manifest, config: image.config }
  })
  const outcome = built.length > 0 ? "built" : "reused"
  const state = stateIn(home)
  const before = state.builds.web
  const next = keepAfter(
    before,
    { sequence: deploy.sequence, keys, outcome, images },
    before?.running ?? null
  )
  writeState(home, withAppBuilds(state, "web", next))
  return { sequence: deploy.sequence, keys, outcome }
}
