/**
 * Can Docker build (specs/016-build-from-source, contracts/runner.md RB5,
 * step K14b of RB3; FR-034a, FR-078). The runner asks Docker what it is
 * before a build that is not kept: the engine's version and processor, the
 * buildx plugin's version, the current context, that context's builder (its
 * driver must be `docker`, so a `docker buildx use` of the server's user, or
 * a container builder, never takes a build), and whether this buildx has
 * `--policy` and `--max-used-space`, which only its help texts say (the
 * contract names no other way to know). The same facts answer `builder`
 * (RB17).
 *
 * Each call goes through `runDocker` with its 60-second limit, while the
 * runner holds the deploy lock and never the state lock (RB1). A call that
 * hangs is stopped at its limit and counts as no answer.
 *
 * The engine's floor is 29.5.0 (item 11). The buildx floor waits for check
 * L2 (T074), and the newest versions covered for a build with secrets
 * (`docker_unchecked`, item 12 (i)) for its own check: neither is here.
 */
import { DOCKER_VERSION, type Arch } from "@workspace/core"

import { runDocker } from "../docker/run"

/** The oldest Docker Engine a build may run on (item 11). */
export const ENGINE_FLOOR = "29.5.0"

/** What Docker says of itself, each null (or false) when it did not say or its answer did not read. */
export type DockerFacts = {
  /** The engine's version, without a leading `v`, held to core's `DOCKER_VERSION`; null when no engine answered. */
  readonly engine: string | null
  /** The engine's processor: `aarch64` reads as `arm64`; any other, or none, as `other`. */
  readonly arch: Arch
  /** buildx's version, as `engine`; null when the plugin is missing or fails. */
  readonly buildx: string | null
  /** The current context's name, which is also its builder's. */
  readonly context: string | null
  /** That builder's driver, as `docker buildx inspect` names it. */
  readonly driver: string | null
  /** BuildKit's version in that builder, as `engine`. */
  readonly buildkit: string | null
  /** `docker buildx build --help` lists `--policy`. */
  readonly policy: boolean
  /** `docker buildx prune --help` lists `--max-used-space` (FR-068). */
  readonly maxUsedSpace: boolean
}

/** Whether a build can run here, and if not, the refusal a deploy gets (CO10). */
export type CanBuild =
  | { readonly can: "yes" }
  | { readonly can: "no_docker" }
  | {
      readonly can: "docker_too_old"
      readonly docker: {
        readonly engine: string
        readonly buildx: string | null
      }
    }
  | { readonly can: "no_build_plugin" }

/** A version as Docker prints it, and its three numbers. */
export type Version = {
  /** Without a leading `v`, held to `DOCKER_VERSION`. */
  readonly text: string
  readonly numbers: readonly [number, number, number]
}

/** A context's name, as Docker allows one; anything else is not passed on as an argument. */
const CONTEXT = /^[a-zA-Z0-9][a-zA-Z0-9_.+-]{0,127}$/
/** A buildx driver's name, as core holds it in `builder`'s answer. */
const DRIVER = /^[a-z][a-z0-9-]{0,31}$/

/**
 * `word` read as a version: a leading `v` dropped, then held to core's
 * `DOCKER_VERSION`. Its numbers are the first three parts, so
 * `v0.35.0-desktop.2` reads 0.35.0. Undefined for anything else.
 */
export function readVersion(word: string): Version | undefined {
  const text = word.startsWith("v") ? word.slice(1) : word
  if (!DOCKER_VERSION.test(text)) return undefined
  const [major, minor, patch] = text.split(/[-+]/, 1)[0]!.split(".").map(Number)
  return { text, numbers: [major!, minor!, patch!] }
}

/** True when `a` comes before `b`, part by part, as numbers. */
function before(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): boolean {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]!
  return false
}

const FLOOR = readVersion(ENGINE_FLOOR)!.numbers

/** The processor as core names it: Docker on Linux says `aarch64` where images say `arm64`. */
function archOf(value: unknown): Arch {
  if (value === "amd64") return "amd64"
  if (value === "arm64" || value === "aarch64") return "arm64"
  return "other"
}

/** The engine's version and processor from `docker version --format json`; nothing when no engine answered. */
function readEngine(stdout: string): { engine: string | null; arch: Arch } {
  let shown: unknown
  try {
    shown = JSON.parse(stdout)
  } catch {
    return { engine: null, arch: "other" }
  }
  const server =
    typeof shown === "object" && shown !== null
      ? (shown as { Server?: unknown }).Server
      : undefined
  if (typeof server !== "object" || server === null)
    return { engine: null, arch: "other" }
  const { Version, Arch } = server as { Version?: unknown; Arch?: unknown }
  const engine = typeof Version === "string" ? readVersion(Version) : undefined
  return { engine: engine?.text ?? null, arch: archOf(Arch) }
}

/** buildx's version from `docker buildx version`: `github.com/docker/buildx v0.34.1 <commit>`. */
function readBuildx(stdout: string): string | null {
  const words = stdout.trim().split(/\s+/)
  if (words.length < 2 || !/\/buildx$/.test(words[0]!)) return null
  return readVersion(words[1]!)?.text ?? null
}

/** The value of a `Name:   value` line of `docker buildx inspect`, its first one. */
function line(text: string, name: string): string | undefined {
  const prefix = `${name}:`
  for (const each of text.split("\n")) {
    const trimmed = each.trim()
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim()
  }
  return undefined
}

/** True when a help text lists `flag` as an option: at the start of a line, after its short form if any, and followed by a space. */
const lists = (help: string, flag: string) =>
  new RegExp(`^\\s*(-\\w, )?${flag}\\s`, "m").test(help)

/**
 * What Docker says of itself (RB5), from these calls in order, each in the
 * runner's folder `dir` through `runDocker`: `docker version --format json`,
 * `docker buildx version`, `docker context show`, `docker buildx inspect
 * --builder <that name>` (asked only when an engine answered and the name
 * reads), and `docker buildx build --help` and `docker buildx prune --help`
 * (asked only when buildx answered). `timeoutMs` is each call's limit, given
 * only by tests; else `runDocker`'s 60 seconds.
 */
export async function dockerFacts(
  dir: string,
  options: { timeoutMs?: number } = {}
): Promise<DockerFacts> {
  const limit =
    options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }
  const ask = (...args: string[]) => runDocker(dir, args, limit)

  const version = await ask("version", "--format", "json")
  // Without an engine Docker prints the client's half and exits 1.
  const { engine, arch } =
    version.code === 0
      ? readEngine(version.stdout)
      : { engine: null, arch: "other" as const }

  const plugin = await ask("buildx", "version")
  const buildx = plugin.code === 0 ? readBuildx(plugin.stdout) : null

  const current = await ask("context", "show")
  const name = current.stdout.trim()
  const context = current.code === 0 && CONTEXT.test(name) ? name : null

  let driver: string | null = null
  let buildkit: string | null = null
  if (engine !== null && buildx !== null && context !== null) {
    const builder = await ask("buildx", "inspect", "--builder", context)
    if (builder.code === 0) {
      const named = line(builder.stdout, "Driver")
      driver = named !== undefined && DRIVER.test(named) ? named : null
      const kit = line(builder.stdout, "BuildKit version")
      buildkit = kit === undefined ? null : (readVersion(kit)?.text ?? null)
    }
  }

  let policy = false
  let maxUsedSpace = false
  if (buildx !== null) {
    const build = await ask("buildx", "build", "--help")
    policy = build.code === 0 && lists(build.stdout, "--policy")
    const prune = await ask("buildx", "prune", "--help")
    maxUsedSpace = prune.code === 0 && lists(prune.stdout, "--max-used-space")
  }

  return {
    engine,
    arch,
    buildx,
    context,
    driver,
    buildkit,
    policy,
    maxUsedSpace,
  }
}

/**
 * Whether a build can run (RB5, in this order): no engine answer is
 * `no_docker`; an engine below `ENGINE_FLOOR` is `docker_too_old` with the
 * engine's and buildx's versions; buildx missing or failing, or a builder
 * whose driver is not `docker`, is `no_build_plugin`; else `yes`.
 */
export function canBuild(facts: DockerFacts): CanBuild {
  const engine = facts.engine === null ? undefined : readVersion(facts.engine)
  if (engine === undefined) return { can: "no_docker" }
  if (before(engine.numbers, FLOOR))
    return {
      can: "docker_too_old",
      docker: { engine: engine.text, buildx: facts.buildx },
    }
  if (facts.buildx === null || facts.driver !== "docker")
    return { can: "no_build_plugin" }
  return { can: "yes" }
}
