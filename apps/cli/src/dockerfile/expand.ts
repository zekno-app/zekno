/**
 * The scopes a Dockerfile's variables live in, and its words expanded in
 * them (specs/016-build-from-source, contracts/cli.md CL3, "Expansion";
 * FR-036a, FR-042), as BuildKit's Dockerfile frontend expands them, through
 * BuildKit's shell lexer (`dockerfile/shell.ts`):
 *
 * - `FROM` is resolved twice, for `linux/amd64` and `linux/arm64`, with the
 *   platform names, the global `ARG`s in order, and the plain variables given
 *   to the build, which replace the default of an `ARG` that declares them;
 * - in a stage, an `ENV` of the file wins over an `ARG` of the same name,
 *   before or after it, and a stage built from another stage inherits its
 *   `ENV`; its `ARG`s it does not;
 * - a variable a base image might define is unknown: an image's own `ENV`
 *   wins over an `ARG`, so in a stage whose chain starts at an image only an
 *   `ENV` of the file is known. From `scratch`, nothing is set but
 *   BuildKit's default `PATH`, which is unknown too.
 *
 * Whatever zekno cannot know is unknown, never guessed: a result that uses it
 * is unresolvable (CL3).
 */
import { isNeverGivenArg } from "@workspace/core"

import type { DockerfileReading, Stage } from "./instructions"
import { type Env, type Lookup, shellProcess, type Unresolved } from "./shell"

/** The two platforms a name is resolved for (CL3). */
export type Platform = "linux/amd64" | "linux/arm64"
export const PLATFORMS: readonly Platform[] = ["linux/amd64", "linux/arm64"]

/** The plain variables given to the build, by name: each reaches an `ARG` that declares it. */
export type BuildArgs = ReadonlyMap<string, string>

/** A word expanded, or why it cannot be. */
export type Resolved =
  | { readonly ok: true; readonly value: string }
  | ({ readonly ok: false } & Unresolved)

const UNKNOWN: Lookup = { kind: "unknown" }
const UNSET: Lookup = { kind: "unset" }
const set = (value: string): Lookup => ({ kind: "set", value })

/** One word expanded as BuildKit's `ProcessWord` expands it, with the file's escape character, only the forms CL3 lists. */
export function expandWord(word: string, env: Env, escape: string): Resolved {
  const found = shellProcess(word, env, { escape, forms: "listed" })
  return found.ok ? { ok: true, value: found.result } : found
}

/** A word's value as a variable's: set, or unknown when it cannot be resolved. */
function lookupOf(word: string, env: Env, escape: string): Lookup {
  const found = expandWord(word, env, escape)
  return found.ok ? set(found.value) : UNKNOWN
}

/**
 * The names BuildKit gives every build for a platform, as its `defaultArgs`:
 * the build runs on the server itself, so the build platform is the target.
 */
function platformArgs(platform: Platform): Map<string, Lookup> {
  const arch = platform.slice("linux/".length)
  const names = new Map<string, Lookup>()
  for (const side of ["BUILD", "TARGET"]) {
    names.set(`${side}PLATFORM`, set(platform))
    names.set(`${side}OS`, set("linux"))
    names.set(`${side}OSVERSION`, set(""))
    names.set(`${side}ARCH`, set(arch))
    names.set(`${side}VARIANT`, set(""))
  }
  return names
}

/** A name BuildKit may give every build that zekno does not list (`TARGETSTAGE`, a later one): all capitals after `TARGET` or `BUILD`. */
const automatic = (name: string): boolean =>
  /^(?:TARGET|BUILD)[A-Z]*$/.test(name)

/**
 * Whether the server's side may give a declared `ARG` a value zekno does not
 * know: a name a build is never given by zekno (core's `isNeverGivenArg`, CO6:
 * proxies and `SOURCE_DATE_EPOCH` among them, which buildx or the runner may
 * pass), a `BUILDKIT_` name, or one of BuildKit's own.
 */
const serverMayGive = (name: string): boolean =>
  isNeverGivenArg(name, "dockerfile") ||
  /^BUILDKIT_/i.test(name) ||
  automatic(name)

/**
 * The global scope for a platform: the platform names, then each global
 * `ARG` in order, each default expanded with those before it, a plain
 * variable given to the build in place of its default. A global `ARG` with no
 * default and no plain variable is set and empty, as BuildKit keeps it. One
 * the server's side may give (`serverMayGive`), a platform name declared
 * again among them, is unknown, as is a name of BuildKit's own zekno does not
 * list.
 */
export function globalScope(
  reading: Pick<DockerfileReading, "globalArgs" | "directives">,
  platform: Platform,
  given: BuildArgs
): Env {
  const names = platformArgs(platform)
  const env: Env = (name) =>
    names.get(name) ?? (automatic(name) ? UNKNOWN : UNSET)
  for (const { key, value } of reading.globalArgs) {
    const passed = given.get(key)
    if (passed !== undefined) names.set(key, set(passed))
    else if (serverMayGive(key)) names.set(key, UNKNOWN)
    else if (value !== null)
      names.set(key, lookupOf(value, env, reading.directives.escape))
    else names.set(key, set(""))
  }
  return env
}

/** A stage's `FROM`, resolved for a platform: its base name (blank is refused, as BuildKit refuses it) and its `--platform`. */
export function resolveFrom(
  reading: DockerfileReading,
  stage: number,
  platform: Platform,
  given: BuildArgs
): { base: Resolved; platform: Resolved | null } {
  const { base, platform: written } = reading.stages[stage]!
  const env = globalScope(reading, platform, given)
  const escape = reading.directives.escape
  const name = expandWord(base, env, escape)
  return {
    base: name.ok && name.value === "" ? { ok: false, why: "error" } : name,
    platform: written === null ? null : expandWord(written, env, escape),
  }
}

/** The variables a stage holds at one point: its `ENV`s, which later stages inherit, and its `ARG`s, which they do not. */
type Scope = {
  /** Every name is unknown: an `ENV` or `ARG` whose name could not be resolved. */
  poisoned: boolean
  /** The chain starts at an image, whose own `ENV` zekno cannot see. */
  fromImage: boolean
  env: Map<string, Lookup>
  args: Map<string, Lookup>
}

/** A scope's variables as the expansion sees them. */
function envOf(scope: Scope): Env {
  return (name) => {
    if (scope.poisoned) return UNKNOWN
    const fromEnv = scope.env.get(name)
    if (fromEnv !== undefined) return fromEnv
    if (scope.fromImage) return UNKNOWN
    const fromArg = scope.args.get(name)
    if (fromArg !== undefined) return fromArg
    return name === "PATH" ? UNKNOWN : UNSET
  }
}

/** The earlier stage a resolved base name names, by its name in any case. */
function earlierStage(
  stages: readonly Stage[],
  stage: number,
  name: string
): number | undefined {
  const lower = name.toLowerCase()
  const found = stages.findIndex(
    (each, at) => at < stage && each.name === lower
  )
  return found < 0 ? undefined : found
}

/** The scope of a stage before its command `before`: its start from its `FROM`, then its `ARG`s and `ENV`s, `ONBUILD` ones left out. */
function scopeOf(
  reading: DockerfileReading,
  stage: number,
  before: number,
  platform: Platform,
  given: BuildArgs
): Scope {
  const escape = reading.directives.escape
  const base = resolveFrom(reading, stage, platform, given).base
  let scope: Scope
  const parent = base.ok
    ? earlierStage(reading.stages, stage, base.value)
    : undefined
  if (!base.ok)
    scope = { poisoned: true, fromImage: true, env: new Map(), args: new Map() }
  else if (parent !== undefined) {
    const from = scopeOf(reading, parent, Infinity, platform, given)
    scope = { ...from, env: new Map(from.env), args: new Map() }
  } else
    scope = {
      poisoned: false,
      fromImage: base.value !== "scratch",
      env: new Map(),
      args: new Map(),
    }
  const global = globalScope(reading, platform, given)
  const declared = new Set(reading.globalArgs.map(({ key }) => key))
  for (const command of reading.stages[stage]!.commands.slice(0, before)) {
    if (command.onbuild) continue
    if (command.kind !== "arg" && command.kind !== "env") continue
    // Every pair of one line is expanded with the variables from before that line.
    const env = envOf(scope)
    const pairs = command.pairs.map(({ key, value }) => {
      const name = expandWord(key, env, escape)
      if (!name.ok) return undefined
      if (command.kind === "env")
        return [name.value, lookupOf(value ?? "", env, escape)] as const
      const passed = given.get(name.value)
      if (passed !== undefined) return [name.value, set(passed)] as const
      // A platform name declared again with no default takes its value, as BuildKit documents.
      const platformName = platformArgs(platform).has(name.value)
      if (platformName && value === null)
        return [name.value, global(name.value)] as const
      if (serverMayGive(name.value)) return [name.value, UNKNOWN] as const
      if (value !== null)
        return [name.value, lookupOf(value, env, escape)] as const
      return [
        name.value,
        declared.has(name.value) ? global(name.value) : UNSET,
      ] as const
    })
    for (const pair of pairs) {
      if (pair === undefined) scope.poisoned = true
      else (command.kind === "env" ? scope.env : scope.args).set(...pair)
    }
  }
  return scope
}

/**
 * The variables in scope just before a stage's command at `before` (its
 * index in `commands`), as BuildKit expands that command's words, for a
 * platform and the plain variables given to the build.
 */
export function stageScope(
  reading: DockerfileReading,
  stage: number,
  before: number,
  platform: Platform,
  given: BuildArgs
): Env {
  return envOf(scopeOf(reading, stage, before, platform, given))
}
