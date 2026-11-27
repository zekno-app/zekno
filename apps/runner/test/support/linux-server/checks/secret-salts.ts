/**
 * What check L15 (specs/016-build-from-source, T017; FR-037d, plan item 12
 * and "Risks", the row on `--add-host`) builds, and how it reads which step
 * each build used. One Dockerfile whose step mounts the secret `NPM_TOKEN`
 * and writes into the image a word made when it ran (a new UUID) and
 * whether a secret was there. Five builds in order, each with its own salt
 * for `--add-host zekno-<salt>:127.0.0.1`. A build whose image holds the
 * word of an earlier build reused that build's step; when that build had
 * another salt (or none), two salts shared the step and item 12 goes back
 * to the maintainer. Pure.
 */

/** The secret's name every build of the check reads. */
export const SECRET_NAME = "NPM_TOKEN"
/** Where the step writes its word in the image. */
export const RAN_FILE = "/zekno-check-ran"
/** The end of the record line when two salts shared the step. */
export const GOES_BACK = "item 12 goes back to the maintainer"

export type SaltBuild = {
  readonly app: "a" | "b"
  /** The secret's value, by its number; none when the build reads no secret. */
  readonly value?: 1 | 2
  /** The salt, by its letter; none for a build with no secret. */
  readonly salt?: "A" | "B" | "C"
  /** What the record calls the build. */
  readonly words: string
}

/** The five builds of the task, in their order. */
export const SALT_BUILDS: readonly SaltBuild[] = [
  { app: "a", value: 1, salt: "A", words: "app a, value 1, salt A" },
  { app: "a", value: 2, salt: "B", words: "app a, value 2, salt B" },
  { app: "a", words: "app a, no secret, no salt" },
  {
    app: "b",
    value: 1,
    salt: "C",
    words: "app b, the same secret name, salt C",
  },
  { app: "a", value: 1, salt: "A", words: "app a, value 1, salt A again" },
]

const IMAGE_BY_DIGEST =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[0-9a-f]{64}$/
const TOKEN = /^[0-9a-f]{32}$/

/**
 * The Dockerfile: from `base` (by digest), one step that mounts the secret
 * and writes `<uuid> with|without` to RAN_FILE. The run's token, a no-op,
 * keeps it from an earlier run's cache.
 */
export function saltDockerfile(base: string, token: string): string {
  if (!IMAGE_BY_DIGEST.test(base))
    throw new Error(`${JSON.stringify(base)} is not an image by digest`)
  if (!TOKEN.test(token)) throw new Error("the run's token is 32 hex")
  return [
    `FROM ${base}`,
    `RUN --mount=type=secret,id=${SECRET_NAME} : ${token} && if [ -s /run/secrets/${SECRET_NAME} ]; then s=with; else s=without; fi && echo "$(cat /proc/sys/kernel/random/uuid) $s" > ${RAN_FILE}`,
    "",
  ].join("\n")
}

/** The word a step wrote: its UUID, and whether a secret was mounted. */
export type RanWord = { readonly id: string; readonly secret: boolean }

/** RAN_FILE's text, read; undefined when it is not what the step writes. */
export function ranWordOf(text: string): RanWord | undefined {
  const found = /^([0-9a-f-]{36}) (with|without)$/.exec(text.trim())
  return found ? { id: found[1]!, secret: found[2] === "with" } : undefined
}

/** What one build gave: not built, built with its word unread, or its word. */
export type SaltSeen =
  | { readonly built: false; readonly why: string }
  | { readonly built: true; readonly word?: RanWord; readonly why?: string }

/**
 * For each build, the build whose step its image holds: itself when its
 * step ran, an earlier one when it reused that one's step, undefined when
 * there is no word to compare.
 */
export function stepOrigins(seen: readonly SaltSeen[]): (number | undefined)[] {
  return seen.map((item) => {
    if (!item.built || item.word === undefined) return undefined
    const id = item.word.id
    return seen.findIndex((other) => other.built && other.word?.id === id)
  })
}

const saltOf = (build: SaltBuild) => build.salt ?? "none"

/** Whether any build reused the step of a build with another salt, or with none. */
export function saltsShared(
  builds: readonly SaltBuild[],
  seen: readonly SaltSeen[]
): boolean {
  return stepOrigins(seen).some(
    (origin, at) =>
      origin !== undefined &&
      origin !== at &&
      saltOf(builds[origin]!) !== saltOf(builds[at]!)
  )
}

const secretWords = (word: RanWord) =>
  word.secret ? "the secret mounted" : "no secret mounted"

/** For the record line: each build, ran or cached, and the end of item 12 when two salts shared the step. */
export function saltWords(
  builds: readonly SaltBuild[],
  seen: readonly SaltSeen[]
): string {
  if (builds.length !== seen.length)
    throw new Error("a result is given for each build")
  const origins = stepOrigins(seen)
  const parts = builds.map((build, at) => {
    const item = seen[at]!
    const head = `${at + 1}. ${build.words}: `
    if (!item.built) return `${head}not built: ${item.why}`
    if (item.word === undefined)
      return `${head}built, its word not read: ${item.why ?? "no word"}`
    const origin = origins[at]!
    const from = (seen[origin] as { word: RanWord }).word
    return origin === at
      ? `${head}ran (${secretWords(from)})`
      : `${head}cached, the step of build ${origin + 1} (${secretWords(from)})`
  })
  return [...parts, ...(saltsShared(builds, seen) ? [GOES_BACK] : [])].join(
    "; "
  )
}
