/**
 * Kept images and the drop list (specs/016-build-from-source,
 * contracts/runner.md RB14 steps 1 and 2; core.md CO13; FR-063, FR-067).
 * Step R of RB3 runs this under the deploy lock, after U or after a failed
 * build, before the answer: zekno closes the session once it has the answer,
 * so nothing here may wait for after it.
 *
 * 1. `keepAfter` with the `running` U left: the running deploy's images and
 *    those of the two newest other deploys whose builds succeeded or were
 *    reused, deploys with the same keys counted once. The images it no
 *    longer keeps move from `images` to `drop`, in one state write under
 *    the state lock, before anything is removed.
 * 2. For each `drop` entry: `docker image inspect` its tag; while `.Id` is
 *    one of its digests, `docker image rm zekno.invalid/<app>:<key>`,
 *    never with `-f`. Once the removal succeeded, or the tag is gone or
 *    leads elsewhere, the entry leaves `drop` (`withDropped`) under the
 *    state lock, and then its record file `kept/<app>/<key>.json` goes.
 *    A removal Docker refuses (a container still uses the image), or a
 *    Docker that does not answer, keeps the entry for the next deploy.
 *
 * Each step leaves the state so that a cut anywhere is taken up by the next
 * deploy of the app: an entry in `drop` is tried again, and a record file of
 * a key the state no longer names (cut between the state write and the
 * file's deletion, or between B3's record and its state) is deleted at the
 * end. No Docker call is made while the state lock is held (RB1).
 */
import {
  builtImageName,
  keepAfter,
  withAppBuilds,
  withDropped,
  type AppBuilds,
} from "@workspace/core"

import { isReport, withState, type StateWait } from "../commands/commands"
import { writeState } from "../home/home"
import { imageIdOf, removeTag, type DockerLimit } from "./leftovers"
import { recordedKeys, removeRecord } from "./records"

/** How a deploy's builds ended, as `last` records it (CO13). */
type Outcome = NonNullable<AppBuilds["last"]>["outcome"]

/**
 * The deploy R runs after, as `keepAfter` takes it again: its number, its
 * build keys (sorted; none for a deploy that built nothing, given as
 * `reused`), and how its builds ended. Its images were recorded at B3, or
 * found kept at K14a, so none is given here.
 */
export type RetainDeploy = {
  readonly sequence: number
  readonly keys: readonly string[]
  readonly outcome: Outcome
}

/** What R did with the drop list: the keys that left it, and those still waiting for their removal. */
export type Retained = {
  readonly dropped: string[]
  readonly waiting: string[]
}

/** The keys of the images an app's entry still names, in `images` or in `drop`. */
const namedKeys = (entry: AppBuilds | undefined) =>
  new Set([...(entry?.images ?? []), ...(entry?.drop ?? [])].map((i) => i.key))

/**
 * Step 1: the app's entry after `keepAfter` with `running`, written under
 * the state lock when it changed. Gives the `drop` list then in the state,
 * or undefined when the state could not be read or written (busy, invalid):
 * the next deploy does this again.
 */
async function moveToDrop(
  dir: string,
  app: string,
  running: number | null,
  deploy: RetainDeploy,
  wait: StateWait
): Promise<AppBuilds["drop"] | undefined> {
  const moved = await withState(
    dir,
    (loaded) => {
      const entry = loaded.state.builds[app]
      // An app whose builds were never recorded keeps nothing, so drops nothing.
      if (entry === undefined) return { drop: [] as AppBuilds["drop"] }
      const next = keepAfter(entry, { ...deploy, images: [] }, running)
      if (!Bun.deepEquals(next, entry))
        writeState(dir, withAppBuilds(loaded.state, app, next))
      return { drop: next.drop }
    },
    wait
  )
  return isReport(moved) ? undefined : moved.drop
}

/**
 * Whether the image of one `drop` entry has left Docker as far as the
 * runner is concerned: removed now, or its tag is gone or leads elsewhere.
 * False when Docker refused the removal or did not answer.
 */
async function imageLeft(
  dir: string,
  app: string,
  image: AppBuilds["drop"][number],
  limit: DockerLimit
): Promise<boolean> {
  const tag = builtImageName(app, image.key)
  const found = await imageIdOf(dir, tag, limit)
  if (found === undefined) return false
  if (found === "gone") return true
  if (found.id !== image.manifest && found.id !== image.config) return true
  return removeTag(dir, tag, limit)
}

/**
 * Step 2's state change for one key whose image has left: the entry leaves
 * `drop`, then its record file is deleted, both under the state lock. False
 * when the state could not be read or written.
 */
async function leaveDrop(
  dir: string,
  app: string,
  key: string,
  wait: StateWait
): Promise<boolean> {
  const left = await withState(
    dir,
    (loaded) => {
      const entry = loaded.state.builds[app]
      const after = entry?.drop.some((image) => image.key === key)
        ? withDropped(entry, key)
        : entry
      if (after !== entry)
        writeState(dir, withAppBuilds(loaded.state, app, after!))
      // Judged by the entry as written: a key a later deploy kept again keeps its record.
      if (!namedKeys(after).has(key)) removeRecord(dir, app, key)
      return { left: true }
    },
    wait
  )
  return !isReport(left)
}

/**
 * The end of step 2: under the state lock, every record file of the app
 * whose key the state names neither in `images` nor in `drop` is deleted.
 * Only a cut leaves one.
 */
async function deleteStrayRecords(
  dir: string,
  app: string,
  wait: StateWait
): Promise<void> {
  await withState(
    dir,
    (loaded) => {
      const named = namedKeys(loaded.state.builds[app])
      for (const key of recordedKeys(dir, app))
        if (!named.has(key)) removeRecord(dir, app, key)
      return { cleaned: true }
    },
    wait
  )
}

/**
 * RB14 steps 1 and 2 for `app`, under the deploy lock, before the answer.
 * `running` is the deploy whose Compose text is in force once U ran (or the
 * one before, after a failed build or a failed start); `deploy` is the
 * deploy R runs after. Gives the keys that left `drop` and those still in
 * it. Never throws: whatever stopped it (a state lock held past its wait, a
 * state that does not read, a write that failed) is a cut, taken up by the
 * next deploy of the app. `wait` and `limit` are for tests.
 */
export async function retain(
  dir: string,
  app: string,
  running: number | null,
  deploy: RetainDeploy,
  options: { wait?: StateWait; limit?: DockerLimit } = {}
): Promise<Retained> {
  const wait = options.wait ?? {}
  const limit = options.limit ?? {}
  const dropped: string[] = []
  const waiting: string[] = []
  try {
    const drop = await moveToDrop(dir, app, running, deploy, wait)
    if (drop === undefined) return { dropped, waiting }
    for (const image of drop) {
      if (
        (await imageLeft(dir, app, image, limit)) &&
        (await leaveDrop(dir, app, image.key, wait))
      )
        dropped.push(image.key)
      else waiting.push(image.key)
    }
    await deleteStrayRecords(dir, app, wait)
  } catch {
    // A cut: the state as written so far is taken up by the next deploy.
  }
  return { dropped, waiting }
}
