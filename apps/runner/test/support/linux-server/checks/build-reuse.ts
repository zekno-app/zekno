/**
 * The packs of checks L3, L4 and L4b, and the reading of what their builds
 * saw (specs/016-build-from-source, T012; FR-035, FR-061, plan item 14).
 * Pure; `test/linux-checks/cache-and-identity.test.ts` builds them in the
 * stand-in with RB7's list. Every pack holds the check's token, so no build
 * of an earlier run, or of another check, can stand in for its first build.
 *
 * L3: one Dockerfile for every build. Its one step lists the files of its
 * cache mount that this run wrote, prints them on a line tagged `CACHE_TAG`,
 * and writes its own file, named by the build argument
 * `ZEKNO_CHECK_BUILD`; the argument makes each build run the step, since the
 * cache mount's namespace is not in a step's key (map-runner E05).
 */
import type { PackFile } from "../build-runs/pack-tar"

/** The line L3's step prints: `zekno-check-cache saw: <token>-a1 ...`. */
export const CACHE_TAG = "zekno-check-cache saw:"
/** The build argument that names an L3 build. */
export const BUILD_ARG = "ZEKNO_CHECK_BUILD"

const TOKEN = /^[a-z0-9]{8,32}$/
const IMAGE =
  /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9_.-]+)?(?:@sha256:[0-9a-f]{64})?$/
/** 2026-11-27, pack-tar.ts's time when none is given. */
export const FIRST_TIME = Date.UTC(2026, 10, 27) / 1000
/** One day later. */
export const SECOND_TIME = FIRST_TIME + 86_400

function checked(base: string, token: string): void {
  if (!IMAGE.test(base))
    throw new Error(`${JSON.stringify(base)} is not an image`)
  if (!TOKEN.test(token))
    throw new Error(`${JSON.stringify(token)} is not a check's token`)
}

/** L3's Dockerfile, the same for each app and each build. */
export function cacheMountDockerfile(base: string, token: string): string {
  checked(base, token)
  return [
    `FROM ${base}`,
    `ARG ${BUILD_ARG}`,
    `RUN --mount=type=cache,target=/cache echo "${CACHE_TAG} $(ls -1 /cache | grep '^${token}-' | tr '\\n' ' ')" && touch "/cache/${token}-$${BUILD_ARG}"`,
    "",
  ].join("\n")
}

/** The builds an L3 step saw in its cache mount (`a1`, `b1`), from its tagged line; undefined when it printed none. */
export function sawOf(
  line: string | undefined,
  token: string
): string[] | undefined {
  if (line === undefined) return undefined
  return line
    .split(/\s+/)
    .filter((word) => word.startsWith(`${token}-`))
    .map((word) => word.slice(token.length + 1))
}

/** `saw a1, b1`, `saw nothing`, or `the step printed no list`. */
export function seenList(saw: readonly string[] | undefined): string {
  if (saw === undefined) return "the step printed no list"
  return saw.length === 0 ? "saw nothing" : `saw ${saw.join(", ")}`
}

/** `saw a1's file: yes (saw a1, b1)`, or `no (saw nothing)`; `the step printed no list` when it did not. */
export function sawWords(
  saw: readonly string[] | undefined,
  build: string
): string {
  if (saw === undefined) return seenList(saw)
  return `saw ${build}'s file: ${saw.includes(build) ? "yes" : "no"} (${seenList(saw)})`
}

/** L4's pack: a base, a file of the run, a step that reads it. */
export function identityPack(base: string, token: string): PackFile[] {
  checked(base, token)
  return [
    {
      path: "Dockerfile",
      data: `FROM ${base}\nCOPY hello.txt /hello.txt\nRUN cat /hello.txt > /seen.txt\n`,
    },
    { path: "hello.txt", data: `zekno check L4 ${token}\n` },
  ]
}

/** L4b's two packs: the same content, every header time one day apart. */
export function timesPacks(
  base: string,
  token: string
): [first: PackFile[], second: PackFile[]] {
  checked(base, token)
  const pack = (mtime: number): PackFile[] => [
    { path: "Dockerfile", data: `FROM ${base}\nCOPY a.txt /a.txt\n`, mtime },
    { path: "a.txt", data: `zekno check L4b ${token}\n`, mtime },
  ]
  return [pack(FIRST_TIME), pack(SECOND_TIME)]
}
