/**
 * What each build reads (specs/016-build-from-source, contracts/cli.md CL3,
 * "The build's plain variables"; data-model.md, "Build variables"; FR-036a to
 * FR-036e, FR-072, FR-072b). A Dockerfile build of a service is given the
 * service's plain variables whose names any `ARG` declares
 * (`dockerfile/args.ts`), `PORT` set by zekno among them as a plain variable
 * like any other, and no other:
 *
 * - never a name core keeps from every build (CO6): said with B16 when the
 *   builder reads it as its own, B17 when zekno reserves it, for a plain
 *   variable of the service the file declares;
 * - never a secret of the app, which never reaches a build through `ARG`
 *   (B18, for any name the file declares that is one).
 *
 * The deploy goes on after each of those. The limits stop it before signing,
 * exit status 1 (CL11): more than 32 given to a build (C14), a value past
 * 4 KiB in bytes (C15), more than 64 KiB of values across the deploy's builds
 * (C16). The summary names, without values, what each build reads (B10) and
 * what reaches only the running app (B20).
 */
import { LIMITS } from "@workspace/core"

import { declaredArgs, neverGiven } from "../dockerfile/args"
import type { DockerfileReading } from "../dockerfile/instructions"
import type { ServiceSettings } from "../settings/types"
import { BuildStop, type LineOf } from "../shared/build-lines"

/** A plain variable given to a build, as the build entry holds it (core.md CO1, `args`). */
export type BuildArg = { readonly name: string; readonly value: string }

/** What the reads of one service's build are worked out from. */
export type BuildReadsInput = {
  readonly app: string
  readonly service: string
  readonly settings: Pick<
    ServiceSettings,
    "build" | "port" | "plain" | "secrets"
  >
  readonly reading: DockerfileReading
  /** The names of the app's secrets. */
  readonly appSecrets: readonly string[]
}

/** What one service's build reads, and what the summary says of it. */
export type BuildReads = {
  readonly service: string
  /** The plain variables given, sorted by name, each once: the build entry's `args`. */
  readonly args: readonly BuildArg[]
  /** The same by name, for reading the Dockerfile's image places and `ADD` lines with them. */
  readonly given: ReadonlyMap<string, string>
  /** B16, B17 and B18, in the order the file declares the names. */
  readonly notGiven: readonly LineOf<"B16" | "B17" | "B18">[]
  /** B20: the plain variables and secrets only the running app sees; null when there are none. */
  readonly onlyApp: LineOf<"B20"> | null
}

/**
 * A built service's plain variables in the order its Compose text gives
 * them: the file's, then `PORT` when zekno sets it, which it does for a
 * service with a port that sets no `PORT` itself (FR-072a; `settings/compose.ts`).
 */
function plainOf(settings: BuildReadsInput["settings"]): [string, string][] {
  const plain = (settings.plain ?? []).map(
    ([name, value]): [string, string] => [name, value]
  )
  const sets = (name: string) =>
    plain.some(([each]) => each === name) ||
    (settings.secrets ?? []).includes(name)
  if (
    settings.build !== undefined &&
    settings.port !== undefined &&
    !sets("PORT")
  )
    plain.push(["PORT", String(settings.port)])
  return plain
}

/**
 * What one service's build reads, with what is not given and why. C14 and
 * C15 are thrown before anything is signed.
 */
export function buildReads(input: BuildReadsInput): BuildReads {
  const { app, service, settings } = input
  const plain = plainOf(settings)
  const values = new Map(plain)
  const secrets = new Set([...input.appSecrets, ...(settings.secrets ?? [])])
  const chosen = new Map<string, string>()
  const notGiven: LineOf<"B16" | "B17" | "B18">[] = []
  for (const name of declaredArgs(input.reading)) {
    if (secrets.has(name)) {
      notGiven.push({ id: "B18", service, name, app })
      continue
    }
    const value = values.get(name)
    const kind = neverGiven(name)
    if (kind !== undefined) {
      if (value !== undefined) notGiven.push({ id: kind, service, name })
      continue
    }
    if (value !== undefined) chosen.set(name, value)
  }
  const args = [...chosen]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
  if (args.length > LIMITS.argsPerBuild)
    throw new BuildStop({ id: "C14", service, count: args.length })
  for (const { name, value } of args) {
    const bytes = Buffer.byteLength(value, "utf8")
    if (bytes > LIMITS.argValueBytes)
      throw new BuildStop({ id: "C15", service, name, bytes })
  }
  const onlyApp = [
    ...plain.map(([name]) => name).filter((name) => !chosen.has(name)),
    ...(settings.secrets ?? []),
  ]
  return {
    service,
    args,
    given: new Map(args.map(({ name, value }) => [name, value])),
    notGiven,
    onlyApp:
      onlyApp.length === 0 ? null : { id: "B20", service, names: onlyApp },
  }
}

/** B10: the names each build reads, a row for each service whose build reads any; null when none reads any. */
export function readsFact(reads: readonly BuildReads[]): LineOf<"B10"> | null {
  const rows = reads
    .filter(({ args }) => args.length > 0)
    .map(({ service, args }) => ({
      service,
      names: args.map(({ name }) => name),
    }))
  return rows.length === 0 ? null : { id: "B10", reads: rows }
}

/**
 * C16, before anything is signed: the values given across the deploy's
 * builds, one entry for each build entry the deploy signs (a build two
 * services share counted once, as core counts it), past 64 KiB in bytes.
 */
export function checkDeployArgs(
  app: string,
  builds: readonly (readonly BuildArg[])[]
): void {
  let bytes = 0
  for (const args of builds)
    for (const { value } of args) bytes += Buffer.byteLength(value, "utf8")
  if (bytes > LIMITS.argBytesPerDeploy)
    throw new BuildStop({ id: "C16", app, bytes })
}
