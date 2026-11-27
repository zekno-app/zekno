/**
 * The run's folder (specs/016-build-from-source, T008): `zekno-check-<id>`
 * in the system's temporary folder, mode 0700. It holds the client's key and
 * known_hosts that `up` made (T157 reaches sshd with them) and `run.json`,
 * written before anything is made and again before each pull: the engine
 * the run is on (a socket of this machine, `endpoint.ts`), what was named
 * zekno-check-* before `up`, the host's images and its count of build
 * records then, and each host image the run needed with whether it was
 * already there. `down`, `engine` and the gate read it, `down` also after a
 * failed or half-finished `up`.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { isLocalSocket } from "../host/endpoint"
import { ENGINE_NAMES, type EngineName } from "../pins"
import { namesOf, STORES, type Store } from "./plan"

export type Before = {
  readonly containers: readonly string[]
  readonly volumes: readonly string[]
  readonly networks: readonly string[]
  /** `docker image ls` lines, sorted. */
  readonly images: readonly string[]
  /** Null when buildx could not count them. */
  readonly buildRecords: number | null
}

export type RunState = {
  readonly id: string
  /** The engine every call of the run names: `unix:///...`, read once by `up`. */
  readonly endpoint: string
  readonly engine: EngineName
  readonly store: Store
  readonly memory: boolean
  readonly port: number
  readonly before: Before
  /** Each host image the run needed; `present` when it was there before `up`. */
  readonly images: readonly {
    readonly image: string
    readonly present: boolean
  }[]
}

const DIGEST_REF = /^[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$/
const FOLDER = /^zekno-check-([a-z0-9]{8})$/

/** `<root>/zekno-check-<id>`; an id of another form throws. */
export function runFolder(root: string, id: string): string {
  namesOf(id)
  return join(root, `zekno-check-${id}`)
}

/** Makes the run's folder, mode 0700; throws when it exists. */
export function makeRunFolder(root: string, id: string): string {
  const folder = runFolder(root, id)
  mkdirSync(folder, { mode: 0o700 })
  return folder
}

/** Writes run.json whole, mode 0600, through a file beside it. */
export function writeState(folder: string, state: RunState): void {
  const file = join(folder, "run.json")
  writeFileSync(`${file}.part`, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  })
  renameSync(`${file}.part`, file)
}

const isTextList = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** The first key of `state` that is wrong, or undefined. */
function wrongKey(state: Record<string, unknown>): string | undefined {
  const known = [
    "id",
    "endpoint",
    "engine",
    "store",
    "memory",
    "port",
    "before",
    "images",
  ]
  const unknown = Object.keys(state).find((key) => !known.includes(key))
  if (unknown !== undefined) return `has ${unknown}, which it does not know`
  if (typeof state.endpoint !== "string" || !isLocalSocket(state.endpoint))
    return "has endpoint wrong"
  if (!ENGINE_NAMES.includes(state.engine as EngineName))
    return "has engine wrong"
  if (!STORES.includes(state.store as Store)) return "has store wrong"
  if (typeof state.memory !== "boolean") return "has memory wrong"
  if (!Number.isInteger(state.port)) return "has port wrong"
  const before = state.before
  if (!isRecord(before)) return "has before wrong"
  for (const key of ["containers", "volumes", "networks", "images"])
    if (!isTextList(before[key])) return `has before.${key} wrong`
  const records = before.buildRecords
  if (
    records !== null &&
    !(Number.isInteger(records) && (records as number) >= 0)
  )
    return "has before.buildRecords wrong"
  const images = state.images
  if (
    !Array.isArray(images) ||
    !images.every(
      (item) =>
        isRecord(item) &&
        Object.keys(item).length === 2 &&
        typeof item.image === "string" &&
        DIGEST_REF.test(item.image) &&
        typeof item.present === "boolean"
    )
  )
    return "has images wrong"
  return undefined
}

/** run.json of the run `id`, read strictly, or why it cannot be read. */
export function readState(
  root: string,
  id: string
): RunState | { reason: string } {
  let text: string
  try {
    text = readFileSync(join(runFolder(root, id), "run.json"), "utf8")
  } catch {
    return { reason: "is not there" }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { reason: "is not JSON" }
  }
  if (!isRecord(parsed)) return { reason: "is not JSON" }
  if (parsed.id !== id) return { reason: "is of another run" }
  const wrong = wrongKey(parsed)
  return wrong === undefined ? (parsed as RunState) : { reason: wrong }
}

/** Removes the run's folder, its keys with it; nothing else. */
export function removeRunFolder(root: string, id: string): void {
  rmSync(runFolder(root, id), { recursive: true, force: true })
}

/** The ids of the run folders in `root`. */
export function runIds(root: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  return entries
    .filter(
      (name) => FOLDER.test(name) && statSync(join(root, name)).isDirectory()
    )
    .map((name) => FOLDER.exec(name)![1]!)
    .sort()
}
