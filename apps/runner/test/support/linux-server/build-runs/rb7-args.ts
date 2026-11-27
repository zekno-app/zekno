/**
 * RB7's argument list and environment, exactly as contracts/runner.md,
 * "RB7. The build command, a Dockerfile", writes them, for the Linux checks
 * (specs/016-build-from-source, T011). Written once here until
 * `apps/runner/src/builder/args.ts` exists; T158 then makes `rb7Args`
 * return what args.ts builds. Pure: `rb7.ts` re-exports all of it and runs
 * the build in the stand-in; a check imports from `rb7.ts`.
 *
 *   rb7Args({ app, key, dockerfile, network, work, ...})   // ["docker", "buildx", "build", ..., "-"]
 *   rb7Env({ home, run })                                  // the whole environment but the secrets
 *   rb7Command(list, env, { work, timeoutSeconds })        // ["timeout", ..., "env", "-i", ..., ...list]
 *   rb7Command(list, env, { ..., secretFiles })            // ["sh", "-c", <reads the files, then the same>, "sh", ...files]
 *
 * Every list is held to RB7's "Never passed" (`neverPassedIn`); a flag a
 * check adds goes before the final `-` with `withExtra`. A secret's value
 * is never in an argument: `ZEKNO_BUILD_SECRET_<i>` is read in the stand-in
 * from the i-th of `secretFiles`, which is removed before buildx starts.
 */
import { PACK_PATH } from "./pack-tar"
import { q } from "../stand-in/shell"

export type Network = "default" | "none"

/** Item 13 (a): both cases of each name, passed empty. */
export const PROXY_NAMES = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "FTP_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "ftp_proxy",
  "no_proxy",
  "all_proxy",
] as const

export type Rb7Options = {
  /** `--builder`: the current context's name, `default` in the stand-in. */
  readonly builder?: string
  /** `--file`: the Dockerfile's path inside the pack. */
  readonly dockerfile: string
  readonly target?: string
  /** `--network`, as signed: `default` or `none`, never `host` (FR-038). */
  readonly network: Network
  /** `BUILDKIT_CACHE_MOUNT_NS=zekno-<app>` and the tag's name. */
  readonly app: string
  /** `--build-arg BUILDKIT_SYNTAX=dockerfile.v0` (item 11 (c)); never with secrets. */
  readonly syntax?: boolean
  /** The signed plain variables, in their order (FR-036a). */
  readonly args?: readonly (readonly [name: string, value: string])[]
  /** Step 1b's secret names; the i-th is read from `ZEKNO_BUILD_SECRET_<i>`. */
  readonly secrets?: readonly string[]
  /** 32 hex: `--add-host zekno-<salt>:127.0.0.1` (step 1b, item 12 (a)). */
  readonly salt?: string
  /** `--no-cache --pull`, a fresh build (FR-021a). */
  readonly fresh?: boolean
  /** `--policy reset=true`, where the stand-in's buildx lists it (`policyListed`). */
  readonly policyReset?: boolean
  /** Item 17 (c)'s source policy, the arguments check L9 settles. */
  readonly sourcePolicy?: readonly string[]
  /** The build key: `--tag zekno.invalid/<app>:<key>`. */
  readonly key: string
  /** The build's own work folder in the stand-in; it receives `meta.json`. */
  readonly work: string
}

/** The runner's app names (core's `APP_NAME`). */
const APP_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/
/** An environment variable's name (core's `SECRET_NAME`). */
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/
const WORD = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/
const HEX32 = /^[0-9a-f]{32}$/
/** A folder of the stand-in that a check may make and remove. */
const CHECK_FOLDER =
  /^\/tmp\/zekno-check-[a-z0-9-]+(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/

function checked(value: string, pattern: RegExp, what: string): string {
  if (!pattern.test(value))
    throw new Error(`${what} ${JSON.stringify(value)} does not fit RB7's list`)
  return value
}

/** A folder of the stand-in under `/tmp/zekno-check-*`, with no `.` or `..` part. */
export function checkFolder(path: string, what = "the folder"): string {
  if (!CHECK_FOLDER.test(path))
    throw new Error(
      `${what} ${JSON.stringify(path)} is not a folder under /tmp/zekno-check-* in the stand-in`
    )
  return path
}

const NEVER_FLAGS = [
  "--allow",
  "--ssh",
  "--build-context",
  "--output",
  "-o",
  "--load",
  "--push",
  "--attest",
  "--cgroup-parent",
  "--security-opt",
]

/** What RB7's "Never passed" names, as found in `args`; empty when none. */
export function neverPassedIn(args: readonly string[]): string[] {
  const found: string[] = []
  for (let at = 0; at < args.length; at++) {
    const arg = args[at]!
    const equals = arg.startsWith("--") ? arg.indexOf("=") : -1
    const flag = equals > 0 ? arg.slice(0, equals) : arg
    const value = equals > 0 ? arg.slice(equals + 1) : args[at + 1]
    if (NEVER_FLAGS.includes(flag) || /^-o./.test(arg)) found.push(arg)
    else if (flag === "--network" && value === "host")
      found.push("--network host")
    else if (
      flag === "--secret" &&
      value?.split(",").some((part) => part.startsWith("src="))
    )
      found.push(`--secret ${value}`)
    else if (
      flag === "--file" &&
      (value === undefined ||
        value.startsWith("/") ||
        value.split("/").includes(".."))
    )
      found.push(`--file ${value ?? ""}`)
    else if (
      flag === "--build-arg" &&
      value?.startsWith("BUILDKIT_SYNTAX=") &&
      value !== "BUILDKIT_SYNTAX=dockerfile.v0"
    )
      found.push(`--build-arg ${value}`)
  }
  if (args.at(-1) !== "-") found.push("a context other than -")
  return found
}

/** The name RB7 tags a build with: `zekno.invalid/<app>:<key>`. */
export function builtName(options: Pick<Rb7Options, "app" | "key">): string {
  return `zekno.invalid/${checked(options.app, APP_NAME, "the app")}:${checked(options.key, TAG, "the key")}`
}

function held(list: string[]): string[] {
  const never = neverPassedIn(list)
  if (never.length > 0) throw new Error(`RB7 never passes ${never.join(", ")}`)
  return list
}

/** RB7's argument list, in the contract's order; anything it does not allow throws. */
export function rb7Args(options: Rb7Options): string[] {
  const builder = checked(options.builder ?? "default", WORD, "the builder")
  checked(options.dockerfile, PACK_PATH, "the Dockerfile's path")
  if (options.target !== undefined) checked(options.target, WORD, "the target")
  if (options.network !== "default" && options.network !== "none")
    throw new Error(
      `the network is default or none, never ${JSON.stringify(options.network)}`
    )
  const secrets = options.secrets ?? []
  if (options.syntax && secrets.length > 0)
    throw new Error("BUILDKIT_SYNTAX is never passed with secrets")
  for (const name of secrets) checked(name, VARIABLE, "the secret")
  if (new Set(secrets).size !== secrets.length)
    throw new Error("a secret is named twice")
  for (const [name, value] of options.args ?? []) {
    checked(name, VARIABLE, "the variable")
    if (
      /^BUILDKIT_/i.test(name) ||
      PROXY_NAMES.some((proxy) => proxy.toLowerCase() === name.toLowerCase())
    )
      throw new Error(`${name} is not a variable a deploy signs`)
    if (value.includes("\0")) throw new Error(`${name}'s value holds a NUL`)
  }
  if (options.salt !== undefined) checked(options.salt, HEX32, "the salt")
  checkFolder(options.work, "the work folder")
  return held([
    ...["docker", "buildx", "build"],
    ...["--builder", builder],
    ...["--file", options.dockerfile],
    ...(options.target === undefined ? [] : ["--target", options.target]),
    ...["--network", options.network],
    ...["--build-arg", `BUILDKIT_CACHE_MOUNT_NS=zekno-${options.app}`],
    ...(options.syntax ? ["--build-arg", "BUILDKIT_SYNTAX=dockerfile.v0"] : []),
    ...PROXY_NAMES.flatMap((name) => ["--build-arg", `${name}=`]),
    ...(options.args ?? []).flatMap(([name, value]) => [
      "--build-arg",
      `${name}=${value}`,
    ]),
    ...secrets.flatMap((name, at) => [
      "--secret",
      `id=${name},env=ZEKNO_BUILD_SECRET_${at}`,
    ]),
    ...(options.salt === undefined
      ? []
      : ["--add-host", `zekno-${options.salt}:127.0.0.1`]),
    ...(options.fresh ? ["--no-cache", "--pull"] : []),
    ...(options.policyReset ? ["--policy", "reset=true"] : []),
    ...(options.sourcePolicy ?? []),
    ...["--provenance=false", "--sbom=false"],
    ...["--tag", builtName(options)],
    ...["--metadata-file", `${options.work}/meta.json`],
    "--progress=rawjson",
    "-",
  ])
}

/** `list` with `extra` before its final `-`, held to RB7's "Never passed". */
export function withExtra(
  list: readonly string[],
  extra: readonly string[]
): string[] {
  if (list.at(-1) !== "-") throw new Error("the list does not end with -")
  return held([...list.slice(0, -1), ...extra, "-"])
}

/** `dockerEnv()`'s names (src/docker/compose.ts): what Docker needs of the runner's environment. */
export const DOCKER_ENV_NAMES = [
  "PATH",
  "HOME",
  "DOCKER_HOST",
  "DOCKER_CONFIG",
  "DOCKER_CONTEXT",
  "XDG_RUNTIME_DIR",
] as const

/** Those the stand-in's root has under `docker exec`. */
export const STAND_IN_DOCKER_ENV: Readonly<Record<string, string>> = {
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  HOME: "/root",
}

/** A run token: 32 random hex, as `building.run` holds one. */
export function newRunToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

/** The variable the i-th secret's value is read from (`--secret id=<NAME>,env=...`). */
const SECRET_VARIABLE = /^ZEKNO_BUILD_SECRET_[0-9]+$/

/**
 * RB7's whole environment (FR-033a) but the secrets: dockerEnv's names,
 * buildx's own folder and switches, the run token. The secrets are added by
 * `rb7Command`'s `secretFiles`, in the stand-in.
 */
export function rb7Env(input: {
  /** The runner's home: `BUILDX_CONFIG` is `<home>/buildx`. */
  readonly home: string
  /** The run token, 32 hex. */
  readonly run: string
  readonly docker?: Readonly<Record<string, string>>
}): Record<string, string> {
  checkFolder(input.home, "the home folder")
  checked(input.run, HEX32, "the run token")
  const docker = input.docker ?? STAND_IN_DOCKER_ENV
  for (const name of Object.keys(docker))
    if (!(DOCKER_ENV_NAMES as readonly string[]).includes(name))
      throw new Error(`${name} is not one of dockerEnv()'s names`)
  return {
    ...docker,
    BUILDX_CONFIG: `${input.home}/buildx`,
    BUILDX_GIT_INFO: "0",
    BUILDX_GIT_LABELS: "0",
    ZEKNO_BUILD_RUN: input.run,
  }
}

/**
 * The `sh` script that reads each secret's file (`"${1}"` ...) whole,
 * removes it, and runs `head`, the secrets as `ZEKNO_BUILD_SECRET_<i>`, and
 * `command`: every fixed word quoted, the values only ever in variables.
 */
function secretScript(
  head: readonly string[],
  command: readonly string[],
  count: number
): string {
  const at = Array.from({ length: count }, (_, index) => index)
  return [
    "set -eu",
    ...at.map(
      (i) =>
        `s${i}=$(cat -- "\${${i + 1}}" && printf x); s${i}=\${s${i}%x}; rm -f -- "\${${i + 1}}"`
    ),
    `exec ${[
      ...head.map(q),
      ...at.map((i) => `"ZEKNO_BUILD_SECRET_${i}=$s${i}"`),
      ...command.map(q),
    ].join(" ")}`,
  ].join("\n")
}

/**
 * `command` with exactly `env` (`env -i`), in `work` when given, stopped in
 * the stand-in after `timeoutSeconds` when given (status 124). With
 * `secretFiles`, files of the stand-in under `/tmp/zekno-check-*`, the i-th
 * file's text is `ZEKNO_BUILD_SECRET_<i>`: read and removed there by `sh`
 * before the command starts, so no value is in an argument of the call.
 */
export function rb7Command(
  command: readonly string[],
  env: Readonly<Record<string, string>>,
  options: {
    readonly work?: string
    readonly timeoutSeconds?: number
    readonly secretFiles?: readonly string[]
  } = {}
): string[] {
  if (command.length === 0) throw new Error("rb7Command needs a command")
  for (const [name, value] of Object.entries(env)) {
    checked(name, VARIABLE, "the variable")
    if (SECRET_VARIABLE.test(name))
      throw new Error(
        `${name} is a secret's value: it travels in a file of the stand-in (secretFiles), never in an argument`
      )
    if (value.includes("\0")) throw new Error(`${name}'s value holds a NUL`)
  }
  const seconds = options.timeoutSeconds
  if (seconds !== undefined && !(Number.isInteger(seconds) && seconds > 0))
    throw new Error("the time limit is a whole number of seconds")
  const head = [
    ...(seconds === undefined ? [] : ["timeout", "-k", "5", String(seconds)]),
    ...["env", "-i"],
    ...(options.work === undefined
      ? []
      : [`--chdir=${checkFolder(options.work, "the work folder")}`]),
    ...Object.entries(env).map(([name, value]) => `${name}=${value}`),
  ]
  const files = options.secretFiles ?? []
  if (files.length === 0) return [...head, ...command]
  for (const file of files) checkFolder(file, "a secret's file")
  return ["sh", "-c", secretScript(head, command, files.length), "sh", ...files]
}
