/**
 * Markers a Linux check makes in its run, and the search for one over the
 * stand-in's disk (specs/016-build-from-source, T016 and T018; FR-031b,
 * FR-037): `grep -r -a -l` over Docker's root, `/var/lib/containerd` and
 * the check's own folder, which stands in for the runner's. A marker is a
 * value the check looks for: it goes to the stand-in on standard input,
 * into a file of mode 0600 under `/run` that `grep -f` reads and the search
 * removes, never into an argument of a host call, a record line or an
 * error. The record names the files found, by place.
 *
 *   const marker = newMarker("zekno-l10")
 *   const places = await searchPlaces(open.inStandIn, ROOT)
 *   const found = await searchStandIn(open.inStandIn, marker, places)
 *   foundWords(found, places)   // "found nowhere in Docker's root (/var/lib/docker), ..."
 */
import { createHash } from "node:crypto"

import type { Answer } from "../host/host-docker"
import { firstLine } from "../host/host-lists"
import type { InStandIn } from "./rb7"

const PREFIX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 32 random hex. */
export function randomHex(bytes = 16): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

/** A marker made in the run: `<prefix>-<32 random hex>`. */
export function newMarker(prefix: string): string {
  if (!PREFIX.test(prefix))
    throw new Error(`${JSON.stringify(prefix)} is not a marker's prefix`)
  return `${prefix}-${randomHex()}`
}

/** The SHA-256 of `text`, 64 hex: what a step compares a value with, never the value. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

const IMAGE_BY_DIGEST =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[0-9a-f]{64}$/
const MARKER = /^([a-z0-9]+(?:-[a-z0-9]+)*-)([0-9a-f]{16})([0-9a-f]{16})$/

/**
 * A Dockerfile from `base` (by digest) whose one step prints `marker` (of
 * `newMarker`) on a line of its own, while the Dockerfile never holds it:
 * `printf` joins its prefix and the two halves of its hex. So only what the
 * step printed holds the marker, never the recipe or the image's history.
 */
export function printingDockerfile(base: string, marker: string): string {
  if (!IMAGE_BY_DIGEST.test(base))
    throw new Error(`${JSON.stringify(base)} is not an image by digest`)
  const parts = MARKER.exec(marker)
  if (!parts) throw new Error("the marker is not one newMarker made")
  return `FROM ${base}\nRUN printf '%s%s%s\\n' ${parts[1]} ${parts[2]} ${parts[3]}\n`
}

/** A place searched: its path in the stand-in, and what a record calls it. */
export type Place = { readonly path: string; readonly name: string }

/** The containerd's own data folder, beside Docker's root on both stores. */
export const CONTAINERD_ROOT = "/var/lib/containerd"
/** dockerd's log in the stand-in (`plan.ts`'s DOCKERD_LOG). */
export const DOCKERD_LOG = "/var/log/zekno-check-dockerd.log"
/** How long a search may take: it reads the whole data folder. */
export const SEARCH_SECONDS = 600

const ABSOLUTE = /^\/[A-Za-z0-9._/-]*$/

/** Whether `file` is `path` or inside it. */
export const isUnder = (file: string, path: string): boolean =>
  file === path || file.startsWith(path.endsWith("/") ? path : `${path}/`)

/** Where a search keeps the value while grep reads it: never under a place it searches. */
export const PATTERN_FILE = "/run/zekno-check-search.XXXXXXXX"

/**
 * Keeps the value from standard input in a file of mode 0600 (`mktemp`),
 * runs `grep` with it, removes it, and ends with grep's status: `$1` is the
 * time limit, the rest the places.
 */
export const SEARCH_SCRIPT = [
  "set -u",
  `f=$(mktemp ${PATTERN_FILE}) || exit 125`,
  'cat > "$f" || { rm -f -- "$f"; exit 125; }',
  "seconds=$1",
  "shift",
  'timeout -k 5 "$seconds" grep -r -a -l -F -s -D skip -f "$f" -- "$@"',
  "status=$?",
  'rm -f -- "$f"',
  'exit "$status"',
].join("\n")

/** `value` when it is one line of at least 16 characters; it is never named in the error. */
function checkedValue(value: string): string {
  if (value.length < 16 || /[\0\n\r]/.test(value))
    throw new Error("a marker is one line of at least 16 characters")
  return value
}

/**
 * `grep` for the value on standard input, as fixed text, over `paths`,
 * recursively, binary files as text, devices and sockets skipped, the names
 * of the files found only; stopped in the stand-in after `seconds`. The
 * value is in no argument.
 */
export function searchArgs(
  paths: readonly string[],
  seconds: number = SEARCH_SECONDS
): string[] {
  if (paths.length === 0) throw new Error("a search names its places")
  for (const path of paths) {
    if (!ABSOLUTE.test(path) || path.split("/").includes(".."))
      throw new Error(`${JSON.stringify(path)} is not a plain absolute path`)
    if (isUnder(PATTERN_FILE, path))
      throw new Error(
        `${JSON.stringify(path)} holds the search's own file of the value`
      )
  }
  if (!Number.isInteger(seconds) || seconds <= 0)
    throw new Error("the time limit is a whole number of seconds")
  return ["sh", "-c", SEARCH_SCRIPT, "sh", String(seconds), ...paths]
}

export type Found = {
  /** The files that hold the marker. */
  readonly files: readonly string[]
  /** Set when grep could not read everything, or stopped at its time limit. */
  readonly note?: string
}

/** Reads grep's answer: 0 found, 1 none, 2 some files unread, 124 stopped. */
export function searchResult(
  answer: Answer,
  seconds: number = SEARCH_SECONDS
): Found {
  const files = answer.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/"))
  if (answer.code === 0 || answer.code === 1) return { files }
  if (answer.code === 2)
    return { files, note: "grep could not read some files" }
  if (answer.code === 124 || answer.code === -1)
    return {
      files,
      note: `the search stopped at its time limit of ${seconds} s`,
    }
  throw new Error(
    `the search failed (exit ${answer.code}): ${firstLine(answer)}`
  )
}

const SHOWN = 4

/** For a record: the files found, by place, or that it was found nowhere. */
export function foundWords(found: Found, places: readonly Place[]): string {
  const note = found.note === undefined ? "" : ` (${found.note})`
  if (found.files.length === 0)
    return `found nowhere in ${listWords(places.map((place) => `${place.name} (${place.path})`))}${note}`
  const parts = places.map((place) => {
    const files = found.files.filter((file) => isUnder(file, place.path))
    if (files.length === 0) return `${place.name}: none`
    const more = files.length > SHOWN ? ` and ${files.length - SHOWN} more` : ""
    return `${place.name}: ${files.length} (${files.slice(0, SHOWN).join(", ")}${more})`
  })
  const elsewhere = found.files.filter(
    (file) => !places.some((place) => isUnder(file, place.path))
  )
  if (elsewhere.length > 0) parts.push(`elsewhere: ${elsewhere.length}`)
  return `found in ${parts.join(", ")}${note}`
}

/** `a`, `a and b`, `a, b and c`. */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}

/** Docker's root in the stand-in, as `docker info` gives it. */
export async function dockerRoot(run: InStandIn): Promise<string> {
  const answer = await run(["docker", "info", "--format", "{{.DockerRootDir}}"])
  const root = answer.stdout.trim()
  if (answer.code !== 0 || !ABSOLUTE.test(root) || root === "/")
    throw new Error(
      `docker info gave no root folder (exit ${answer.code}): ${firstLine(answer)}`
    )
  return root
}

/** Docker's root, the containerd's data folder and the check's folder, in that order. */
export async function searchPlaces(
  run: InStandIn,
  folder: string
): Promise<Place[]> {
  return [
    { path: await dockerRoot(run), name: "Docker's root" },
    { path: CONTAINERD_ROOT, name: "the containerd's data" },
    { path: folder, name: "the check's runner folder" },
  ]
}

/** Searches the places for `value` in the stand-in, the value on standard input; an error never names it. */
export async function searchStandIn(
  run: InStandIn,
  value: string,
  places: readonly Place[],
  seconds: number = SEARCH_SECONDS
): Promise<Found> {
  const answer = await run(
    searchArgs(
      places.map((place) => place.path),
      seconds
    ),
    { stdin: { text: checkedValue(value) }, timeoutMs: (seconds + 60) * 1000 }
  )
  return searchResult(answer, seconds)
}
