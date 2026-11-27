/**
 * Free disk for a build (specs/016-build-from-source, contracts/runner.md
 * RB6, RB2 step 5; FR-040). A build writes to Docker's root, to
 * containerd's folder when the engine keeps its images there, to the
 * runner's folder (`<home>`) and to the work folders; the floor
 * (`LIMITS.diskFloorBytes`, 2 GiB, which check L7 confirms) holds for the
 * least free of them, so no build or staged piece fills the disk under the
 * running apps.
 *
 * A place that cannot be read counts as no free space at all: with a remote
 * `DOCKER_HOST`, Docker's root is on another machine, and the runner cannot
 * know what a build would leave there (RB6, second bullet).
 *
 * The `statfs` function comes in from the caller, so a deploy's options can
 * pass a stand-in figure in tests, as they pass `up`'s limit.
 */
import { LIMITS } from "@workspace/core"
import { existsSync, statfsSync } from "node:fs"

import { runDocker } from "../docker/run"
import { unpackedDir } from "../home/home"

/** What the runner reads of a filesystem: the blocks free to a user who is not root, and their size. */
export type StatFs = (path: string) => {
  bavail: number | bigint
  bsize: number | bigint
}

/** Where containerd keeps images, when the engine uses its image store and the folder exists (RB6). */
const CONTAINERD = "/var/lib/containerd"

/** The longest answer read as Docker's root: a path the system could hold. */
const ROOT_CHARACTERS = 4096

/**
 * The bytes free to the runner on the filesystem that holds `path`: the
 * blocks free to a user who is not root times their size. Undefined when the
 * path cannot be read, or gives no sensible figure.
 */
export function freeBytes(
  path: string,
  statfs: StatFs = statfsSync
): number | undefined {
  try {
    const info = statfs(path)
    const free = Number(info.bavail) * Number(info.bsize)
    return Number.isFinite(free) && free >= 0 ? free : undefined
  } catch {
    return undefined
  }
}

/**
 * The places a build writes to, in the order RB6 names them: Docker's root,
 * `/var/lib/containerd` when it exists, `<home>` and the parent of the work
 * folders (`unpackedDir`, which makes it, mode 700, and throws when it is not
 * private). A root Docker did not give (`dockerRoot` failed) stays in the
 * list as `undefined`, a place that cannot be read. `unpacked` and `exists`
 * (the look at containerd's folder) are given only by tests.
 */
export function buildPlaces(
  dir: string,
  dockerRoot: string | undefined,
  options: { unpacked?: string; exists?: (path: string) => boolean } = {}
): (string | undefined)[] {
  const exists = options.exists ?? existsSync
  return [
    dockerRoot,
    ...(exists(CONTAINERD) ? [CONTAINERD] : []),
    dir,
    options.unpacked ?? unpackedDir(),
  ]
}

/**
 * The least free space of `places`, or 0 when one of them cannot be read
 * (RB6: a remote `DOCKER_HOST` is `low_disk` with `free` 0).
 */
export function leastFree(
  places: readonly (string | undefined)[],
  statfs: StatFs = statfsSync
): number {
  let least = Number.POSITIVE_INFINITY
  for (const place of places) {
    const free = place === undefined ? undefined : freeBytes(place, statfs)
    if (free === undefined) return 0
    least = Math.min(least, free)
  }
  return Number.isFinite(least) ? least : 0
}

/**
 * True when `free`, less what is about to be written (`needed`, a piece for
 * RB2 step 5), falls below the floor. Exactly at the floor is not below it.
 */
export function belowFloor(free: number, needed = 0): boolean {
  return free - needed < LIMITS.diskFloorBytes
}

/**
 * Docker's root folder, from `docker info --format '{{.DockerRootDir}}'`
 * through `runDocker` and its 60-second limit, run in the runner's folder
 * `dir`. Asked once per deploy, while the runner holds the deploy lock and
 * never the state lock (RB1: no Docker call under the state lock).
 * Undefined when Docker fails, or answers anything but one absolute path,
 * so the place then counts as one that cannot be read.
 */
export async function dockerRoot(dir: string): Promise<string | undefined> {
  const result = await runDocker(dir, [
    "info",
    "--format",
    "{{.DockerRootDir}}",
  ])
  if (result.code !== 0) return undefined
  const root = result.stdout.replace(/\n$/, "")
  if (
    root.length === 0 ||
    root.length > ROOT_CHARACTERS ||
    !root.startsWith("/") ||
    /[\0\r\n]/.test(root)
  )
    return undefined
  return root
}
