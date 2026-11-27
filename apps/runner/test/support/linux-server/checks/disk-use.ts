/**
 * The parts of check L7 that need no Docker (specs/016-build-from-source,
 * T014; FR-040; contracts/core.md CO16, `diskFloorBytes`; contracts/runner.md
 * RB6): the 512 MiB context of random bytes made in the stand-in, the one
 * script that builds it while it samples the disk each second, and the
 * reading of those samples into each place's peak against the floor. Pure.
 *
 * The script takes its files and places as arguments, then `--` and the
 * build client's whole command:
 *
 *   ["env", "ZEKNO_CHECK_DISK=<token>", "sh", "-c", DISK_SCRIPT, "sh",
 *    <samples>, <out>, <context>, <place>..., "--", <client>...]
 *
 * It samples `df -B1` of each place once before the build, each second
 * during it and once after, pipes the context to the client as a tar of its
 * files, and prints `<client's status> <start> <end>`. The entry in its
 * environment lets the check's removal stop it and its sampler.
 */
import { LIMITS } from "@workspace/core"

import { checkFolder } from "../build-runs/rb7-args"
import { q } from "../stand-in/shell"

const GIB = 1024 ** 3
const MIB = 1024 ** 2

/** The floor of FR-040: core's `LIMITS.diskFloorBytes` (CO16), which L7 is to confirm. */
export const DISK_FLOOR_BYTES: number = LIMITS.diskFloorBytes

/** The context: eight files of 64 MiB of random bytes, and the Dockerfile. */
export const CONTEXT_FILES = 8
export const FILE_BYTES = 64 * MIB
export const DISK_DOCKERFILE = "FROM scratch\nCOPY . /data\n"

/** Makes the context in `folder` of the stand-in, from `/dev/urandom`. */
export function contextArgs(folder: string): string[] {
  return [
    "sh",
    "-c",
    [
      "set -eu",
      'mkdir -p "$1"',
      `printf ${q(DISK_DOCKERFILE.replaceAll("\n", "\\n"))} > "$1/Dockerfile"`,
      "i=1",
      `while [ "$i" -le ${CONTEXT_FILES} ]; do head -c ${FILE_BYTES} /dev/urandom > "$1/blob-$i"; i=$((i + 1)); done`,
    ].join("\n"),
    "sh",
    checkFolder(folder, "the context"),
  ]
}

export const DISK_SCRIPT = [
  "samples=$1 out=$2 context=$3",
  "shift 3",
  "places=",
  'while [ "$#" -gt 0 ] && [ "$1" != -- ]; do places="$places $1"; shift; done',
  "shift",
  "sample() {",
  "  t=$(date +%s.%N)",
  "  for p in $places; do",
  '    if [ -e "$p" ]; then',
  '      df -B1 --output=source,used,avail "$p" | sed -n "2s|^|$t $p |p"',
  "    else",
  '      echo "$t $p absent"',
  "    fi",
  '  done >> "$samples"',
  "}",
  "sample",
  "( while :; do sleep 1; sample; done ) < /dev/null > /dev/null 2>&1 &",
  "sampler=$!",
  "start=$(date +%s.%N)",
  '(cd "$context" && exec tar --format=ustar -cf - -- *) | "$@" > "$out" 2>&1',
  "code=$?",
  "end=$(date +%s.%N)",
  'kill "$sampler" 2> /dev/null || :',
  'wait "$sampler" 2> /dev/null || :',
  "sample",
  'echo "$code $start $end"',
].join("\n")

export type Place = { readonly label: string; readonly path: string }

/** A path the script can take as a word: absolute, no space, no `--`. */
const PATH = /^\/[A-Za-z0-9._/-]*$/

export function diskArgs(input: {
  readonly entry: string
  readonly samples: string
  readonly out: string
  readonly context: string
  readonly places: readonly Place[]
  readonly client: readonly string[]
}): string[] {
  if (!/^ZEKNO_CHECK_DISK=[a-z0-9]{8,32}$/.test(input.entry))
    throw new Error(`${JSON.stringify(input.entry)} is not the check's entry`)
  for (const place of input.places)
    if (!PATH.test(place.path))
      throw new Error(`${JSON.stringify(place.path)} is not a place to sample`)
  if (input.client.length === 0)
    throw new Error("the script builds with a client")
  return [
    ...["env", input.entry, "sh", "-c", DISK_SCRIPT, "sh"],
    checkFolder(input.samples, "the samples"),
    checkFolder(input.out, "the output"),
    checkFolder(input.context, "the context"),
    ...input.places.map((place) => place.path),
    "--",
    ...input.client,
  ]
}

/** The script's last line: the client's status, and when it started and ended, in seconds. */
export function endOf(
  stdout: string
): { code: number; seconds: number } | undefined {
  const last = stdout.trim().split("\n").at(-1) ?? ""
  const found = /^(-?[0-9]+) ([0-9]+(?:\.[0-9]+)?) ([0-9]+(?:\.[0-9]+)?)$/.exec(
    last
  )
  if (!found) return undefined
  return {
    code: Number(found[1]),
    seconds: Math.round((Number(found[3]) - Number(found[2])) * 10) / 10,
  }
}

export type Peak = {
  readonly place: Place
  /** The filesystem `df` named first; undefined when never sampled. */
  readonly source?: string
  /** Used bytes at the first sample. */
  readonly start?: number
  /** The most used bytes of any sample. */
  readonly most?: number
  /** The least free bytes of any sample. */
  readonly leastFree?: number
  readonly samples: number
}

/** Each place's peak, from the sample lines `<time> <path> <source> <used> <free>` or `<time> <path> absent`. */
export function peaksOf(samples: string, places: readonly Place[]): Peak[] {
  return places.map((place) => {
    let source: string | undefined
    let start: number | undefined
    let most: number | undefined
    let leastFree: number | undefined
    let count = 0
    for (const line of samples.split("\n")) {
      const words = line.trim().split(/\s+/)
      if (words[1] !== place.path || words.length !== 5) continue
      const used = Number(words[3])
      const free = Number(words[4])
      if (!Number.isSafeInteger(used) || !Number.isSafeInteger(free)) continue
      count++
      source ??= words[2]
      start ??= used
      most = Math.max(most ?? used, used)
      leastFree = Math.min(leastFree ?? free, free)
    }
    return {
      place,
      samples: count,
      ...(source === undefined ? {} : { source }),
      ...(start === undefined ? {} : { start }),
      ...(most === undefined ? {} : { most }),
      ...(leastFree === undefined ? {} : { leastFree }),
    }
  })
}

/** `1.07 GiB`, `512 MiB`, `40 KiB`, `12 B`. */
export function bytesWords(bytes: number): string {
  const size = Math.abs(bytes)
  const sign = bytes < 0 ? "-" : ""
  if (size >= GIB) return `${sign}${(size / GIB).toFixed(2)} GiB`
  if (size >= MIB) return `${sign}${Math.round(size / MIB)} MiB`
  if (size >= 1024) return `${sign}${Math.round(size / 1024)} KiB`
  return `${sign}${size} B`
}

/** `Docker's root /var/lib/docker (on /dev/root): at most +1.07 GiB over its start, 54% of the 2.00 GiB floor; least free 20.10 GiB`. */
export function peakWords(
  peak: Peak,
  floor: number = DISK_FLOOR_BYTES
): string {
  const name = `${peak.place.label} ${peak.place.path}`
  if (peak.samples === 0 || peak.start === undefined || peak.most === undefined)
    return `${name}: absent`
  const grown = peak.most - peak.start
  const share = Math.round((grown / floor) * 100)
  return `${name} (on ${peak.source}): at most +${bytesWords(grown)} over its start, ${share}% of the ${bytesWords(floor)} floor; least free ${bytesWords(peak.leastFree ?? 0)}`
}
