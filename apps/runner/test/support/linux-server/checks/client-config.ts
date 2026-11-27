/**
 * What check L8 (specs/016-build-from-source, T015; FR-036, plan items 3 (a)
 * and 13) does to the Docker client of the stand-in, and what it reads of
 * the step: the htpasswd line of a user and password made in the run,
 * `proxies.default` in `~/.docker/config.json` set to marker values and
 * taken out again, and which marker, or which of RB7's ten proxy names with
 * a value, reached the step's environment. Pure, but for `htpasswdLine`,
 * which hashes with Bun's own bcrypt.
 */
import { PROXY_NAMES } from "../build-runs/rb7"

/** The client's configuration in the stand-in: root's, as `docker exec` runs. */
export const CLIENT_CONFIG = "/root/.docker/config.json"

/** The keys of `proxies.default` that the Docker client reads. */
export const PROXY_KEYS = [
  "httpProxy",
  "httpsProxy",
  "ftpProxy",
  "noProxy",
  "allProxy",
] as const
export type ProxyKey = (typeof PROXY_KEYS)[number]
export type ProxyMarkers = Readonly<Record<ProxyKey, string>>

const TOKEN = /^[0-9a-f]{8,64}$/
const USER = /^[A-Za-z0-9._-]+$/

/** A marker for each key, made from the run's token, each its own. */
export function proxyMarkers(token: string): ProxyMarkers {
  if (!TOKEN.test(token)) throw new Error("a marker's token is lower-case hex")
  const host = (key: ProxyKey) =>
    `zekno-l8-${token}-${key.toLowerCase()}.invalid`
  return {
    httpProxy: `http://${host("httpProxy")}:3128`,
    httpsProxy: `http://${host("httpsProxy")}:3128`,
    ftpProxy: `http://${host("ftpProxy")}:3128`,
    noProxy: host("noProxy"),
    allProxy: `socks5://${host("allProxy")}:1080`,
  }
}

type Config = Record<string, unknown>

function parse(text: string): Config {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${CLIENT_CONFIG} is not JSON; the check leaves it alone`)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(
      `${CLIENT_CONFIG} is not an object; the check leaves it alone`
    )
  return parsed as Config
}

const written = (config: Config) => `${JSON.stringify(config, null, "\t")}\n`

/**
 * `config.json` with `proxies.default` set to the markers. One that already
 * has `proxies` is refused: the check never changes what it did not make.
 */
export function withProxies(
  text: string | undefined,
  markers: ProxyMarkers
): string {
  const config = text === undefined ? {} : parse(text)
  if ("proxies" in config)
    throw new Error(
      `${CLIENT_CONFIG} already has proxies; the check changes nothing it did not make`
    )
  return written({ ...config, proxies: { default: { ...markers } } })
}

/**
 * `config.json` with the proxies taken out; undefined, for the file to be
 * removed, when the check made the file and nothing but an empty `auths`
 * is left (what `docker logout` leaves).
 */
export function withoutProxies(
  text: string,
  madeByCheck: boolean
): string | undefined {
  const { proxies: _proxies, ...rest } = parse(text)
  const auths = rest.auths
  const emptyAuths =
    auths === undefined ||
    (typeof auths === "object" &&
      auths !== null &&
      !Array.isArray(auths) &&
      Object.keys(auths).length === 0)
  const others = Object.keys(rest).filter((key) => key !== "auths")
  if (madeByCheck && emptyAuths && others.length === 0) return undefined
  return written(rest)
}

/** `<user>:<bcrypt hash>`, by Bun's own bcrypt, as the registry's htpasswd reads it. */
export async function htpasswdLine(
  user: string,
  password: string
): Promise<string> {
  if (!USER.test(user)) throw new Error("a user is letters, digits, . _ and -")
  if (password.length < 16 || new TextEncoder().encode(password).length > 72)
    throw new Error("a password is 16 to 72 bytes, as bcrypt takes it whole")
  const hash = await Bun.password.hash(password, {
    algorithm: "bcrypt",
    cost: 10,
  })
  return `${user}:${hash}`
}

/** `docker login` of the stand-in's client, the password on standard input. */
export function loginArgs(user: string, registry: string): string[] {
  if (!USER.test(user)) throw new Error("a user is letters, digits, . _ and -")
  return ["docker", "login", "--username", user, "--password-stdin", registry]
}

/** The lines the step prints around its environment. */
export const ENV_BEGIN = "zekno-check-env-begin"
export const ENV_END = "zekno-check-env-end"

const PRIVATE_BASE =
  /^127\.0\.0\.1:5000\/[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[0-9a-f]{64}$/
const RUN_TOKEN = /^[0-9a-f]{32}$/

/**
 * L8's Dockerfile: the private base, by digest, and a step that prints its
 * environment between two lines of its own. The run's token, a no-op in
 * the step, keeps it from being reused from an earlier run's cache.
 */
export function proxyDockerfile(base: string, token: string): string {
  if (!PRIVATE_BASE.test(base))
    throw new Error(
      `${JSON.stringify(base)} is not a base in the check's registry, by digest`
    )
  if (!RUN_TOKEN.test(token)) throw new Error("the run's token is 32 hex")
  return `FROM ${base}\nRUN : ${token} && echo ${ENV_BEGIN} && env && echo ${ENV_END}\n`
}

export type ProxyFindings = {
  /** The keys whose marker the step's output holds. */
  readonly markers: readonly ProxyKey[]
  /** Those of the ten names the step's environment held with a value. */
  readonly valued: readonly string[]
  /** How many of the ten it held, empty. */
  readonly empty: number
}

/** What reached the step: from all it printed, and the `env` lines it printed. */
export function proxyFindings(
  output: string,
  env: readonly string[],
  markers: ProxyMarkers
): ProxyFindings {
  const values = new Map<string, string>()
  for (const line of env) {
    const at = line.indexOf("=")
    if (at > 0) values.set(line.slice(0, at), line.slice(at + 1))
  }
  return {
    markers: PROXY_KEYS.filter((key) => output.includes(markers[key])),
    valued: PROXY_NAMES.filter((name) => (values.get(name) ?? "") !== ""),
    empty: PROXY_NAMES.filter((name) => values.get(name) === "").length,
  }
}

/** For the record line; never a marker's value. */
export function proxyWords(findings: ProxyFindings | undefined): string {
  if (findings === undefined) return "the step's environment was not seen"
  const markers =
    findings.markers.length === 0
      ? "no marker of config.json reached the step"
      : `the markers of ${findings.markers.join(", ")} reached the step`
  const valued =
    findings.valued.length === 0
      ? "none of the ten names had a value"
      : `with a value: ${findings.valued.join(", ")}`
  return `${markers}, ${valued} (${findings.empty} of the ten set empty)`
}
