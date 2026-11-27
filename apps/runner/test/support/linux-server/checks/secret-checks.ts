/**
 * The Dockerfiles of checks L12, L13, L14 and L16
 * (specs/016-build-from-source, T018; FR-037, FR-037b, FR-037c, FR-037g,
 * FR-089), and the words their steps print. A step that checks a secret
 * compares its SHA-256 with the one the check gives, and prints only
 * whether it matched: no Dockerfile holds a value, and no step prints one.
 * Pure.
 */

const IMAGE_BY_DIGEST =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[0-9a-f]{64}$/
const TOKEN = /^[0-9a-f]{32}$/
const SHA = /^[0-9a-f]{64}$/
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const FRONTEND =
  /^127\.0\.0\.1:5000\/[a-z0-9]+(?:[._/-][a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/
const GIT_URL = /^http:\/\/127\.0\.0\.1:[0-9]{2,5}\/[a-z0-9-]+\.git$/

function check(value: string, pattern: RegExp, what: string): string {
  if (!pattern.test(value))
    throw new Error(`${what} ${JSON.stringify(value)} does not fit the check`)
  return value
}

const from = (base: string) =>
  `FROM ${check(base, IMAGE_BY_DIGEST, "the base")}`

/** What the step prints when the mounted secret's hash is the one given, and when it is not. */
export const MATCHED = "zekno-check-secret-matched"
export const DIFFERED = "zekno-check-secret-differed"

/**
 * L12 and L14: a step that mounts the secret `name` and prints MATCHED when
 * its SHA-256 is `sha`, else DIFFERED; the value never printed.
 */
export function readingDockerfile(
  base: string,
  name: string,
  sha: string,
  token: string
): string {
  check(name, NAME, "the secret")
  check(sha, SHA, "the hash")
  check(token, TOKEN, "the run's token")
  return [
    from(base),
    `RUN --mount=type=secret,id=${name} : ${token} && if [ "$(sha256sum /run/secrets/${name} 2> /dev/null | cut -c1-64)" = "${sha}" ]; then echo ${MATCHED}; else echo ${DIFFERED}; fi`,
    "",
  ].join("\n")
}

/** What a record says of what the reading step printed. */
export function readWords(output: string): string {
  const lines = output.split("\n").map((line) => line.trim())
  if (lines.includes(MATCHED))
    return "a step read the secret, its value as given"
  if (lines.includes(DIFFERED))
    return "a step ran and did not read the value given"
  return "the step's output was not seen"
}

/** L13: a `# syntax=` line naming the check registry's frontend, in a build whose step mounts the secret. */
export function syntaxDockerfile(
  frontend: string,
  base: string,
  name: string,
  token: string
): string {
  check(frontend, FRONTEND, "the frontend")
  check(name, NAME, "the secret")
  check(token, TOKEN, "the run's token")
  return [
    `# syntax=${frontend}`,
    from(base),
    `RUN --mount=type=secret,id=${name} : ${token}`,
    "",
  ].join("\n")
}

/** L14: an `ADD` of a git address the stand-in's listener answers. */
export function gitAddDockerfile(base: string, url: string): string {
  check(url, GIT_URL, "the git address")
  return [from(base), `ADD ${url} /zekno-check-git`, ""].join("\n")
}

/** L16's cache folder: its id (under the app's BUILDKIT_CACHE_MOUNT_NS), where it is mounted, the file written. */
export const CACHE_ID = "zekno-check-l16"
export const CACHE_TARGET = "/zekno-cache"
export const CACHE_FILE = `${CACHE_TARGET}/earlier`

const cacheMount = `--mount=type=cache,target=${CACHE_TARGET},id=${CACHE_ID}`

/** L16, first build: a step that copies the mounted secret into the cache folder (what FR-037g warns of). */
export function cacheWriteDockerfile(
  base: string,
  name: string,
  token: string
): string {
  check(name, NAME, "the secret")
  check(token, TOKEN, "the run's token")
  return [
    from(base),
    `RUN --mount=type=secret,id=${name} ${cacheMount} : ${token} && cp /run/secrets/${name} ${CACHE_FILE}`,
    "",
  ].join("\n")
}

/** What L16's second step prints: the earlier contents, other contents, or an empty folder. */
export const EARLIER = "zekno-check-cache-earlier"
export const OTHER = "zekno-check-cache-other"
export const EMPTY = "zekno-check-cache-empty"

/** L16, second build (no secret, no cached step): a step that compares what the cache folder holds with `sha`. */
export function cacheReadDockerfile(
  base: string,
  sha: string,
  token: string
): string {
  check(sha, SHA, "the hash")
  check(token, TOKEN, "the run's token")
  return [
    from(base),
    `RUN ${cacheMount} : ${token} && if [ -s ${CACHE_FILE} ]; then if [ "$(sha256sum ${CACHE_FILE} | cut -c1-64)" = "${sha}" ]; then echo ${EARLIER}; else echo ${OTHER}; fi; else echo ${EMPTY}; fi`,
    "",
  ].join("\n")
}

/** What a record says of what L16's second step printed. */
export function cacheReadWords(output: string): string {
  const lines = output.split("\n").map((line) => line.trim())
  if (lines.includes(EARLIER)) return "it read the earlier contents"
  if (lines.includes(OTHER)) return "the cache folder held other contents"
  if (lines.includes(EMPTY)) return "the cache folder was empty"
  return "the step's output was not seen"
}
