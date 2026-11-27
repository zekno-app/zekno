/**
 * The summary's facts before signing, from one pure function
 * (specs/016-build-from-source, contracts/cli.md CL5, "Facts" and "Builds
 * again because"; data-model.md, "The summary"; FR-017, FR-072 to FR-072c).
 * Each fact is a line of design/lines.md by its id with its values; no
 * sentence is written here (FR-092).
 *
 * - The block's rows, every time: B1, or B2 when the folder sent is above
 *   the settings file; B3; B4; B5, one rule a line; B6 for the agreed files
 *   sent; B9, one row a build, two services with one recipe sharing it; B10.
 * - The warnings, every time: B12, B13, B14, B16, B17, B18, and B30 once
 *   step 9 has answered (CL7).
 * - The notes: B7 for each `.env` or `.env.*` left out, B11, B22 and B23
 *   every time they apply; B8, B20 and B21 at the first deploy from the
 *   folder on this machine, and again when what they say differs from the
 *   app's last deploy from this machine (choice B-a (b)); D13 for `--fresh`.
 * - The panel's two rows: B28, and D12 for `--fresh`, whose builds row
 *   stands for B28's.
 *
 * Its inputs are what pass 1 and pass 2 found, the Dockerfile's reading and
 * the settings as the builds hold them (`ops/build-reads.ts`, T121), the
 * uncommitted-changes fact (`git/changes.ts`, T122), and this machine's
 * history and earlier notes. Nothing is read from disk or a server.
 */
import type {
  BuildGroup,
  BuildLine,
  LeftOutRule,
  LineOf,
  SecretKind,
} from "../shared/build-lines"
import type { HistoryBuild } from "../shared/history"
import type { PackLimits } from "./limits"
import { sizeWarning } from "./limits"
import type { Walk } from "./walk"

/** A name the Dockerfile declares with `ARG` that the build is not given, and why: the builder's own (B16), zekno's (B17), a secret of the app (B18). */
export type NotGiven = {
  readonly name: string
  readonly why: "builder" | "reserved" | "secret"
}

/** One build of the deploy: the services it serves, sharing it since they have one recipe (FR-012). */
export type FactsBuild = {
  /** In the settings' order; the first names the build in a line. */
  readonly services: readonly string[]
  /** `build.dockerfile`, as the deploy signs it. */
  readonly dockerfile: string
  /** `build.network`. */
  readonly network: "internet" | "none"
  /** The plain variables the build is given, by name and value (FR-036a). */
  readonly args: readonly { readonly name: string; readonly value: string }[]
  readonly notGiven: readonly NotGiven[]
  /** For each service, the names of its plain variables and secrets that reach only the running app (B20; FR-072). */
  readonly onlyApp: readonly {
    readonly service: string
    readonly names: readonly string[]
  }[]
  /** The base images named without a digest (B14; FR-042a). */
  readonly unpinned: readonly string[]
}

/**
 * What the notes of choice B-a said at the app's last deploy from this
 * folder on this machine. A part this machine did not keep is undefined,
 * and its notes are said again.
 */
export type EarlierNotes = {
  /** B8's files. */
  readonly leftOutSecrets?: readonly {
    readonly path: string
    readonly kind: SecretKind
  }[]
  /** B20's names, by service. */
  readonly onlyApp?: readonly {
    readonly service: string
    readonly names: readonly string[]
  }[]
  /** Whether that deploy built from a Dockerfile, which B21 speaks of. */
  readonly dockerfile: boolean
}

export type FactsInput = {
  readonly server: string
  readonly app: string
  /** The settings file, as zekno shows it (B6). */
  readonly file: string
  /** The folder sent when it is above the settings file's folder: as shown from there, and whether it is the top of its git repository (B2); null for B1. */
  readonly above: { readonly root: string; readonly top: boolean } | null
  /** Pass 1. */
  readonly walk: Pick<Walk, "leftOut" | "secretsSent" | "ignoreFile">
  /** Pass 1's limits; pass 2's pack has exactly this size. */
  readonly limits: PackLimits
  /** The deploy's builds, in the settings' order. */
  readonly builds: readonly FactsBuild[]
  /** The built services zekno gives `PORT` to match their port (B11; FR-072a). */
  readonly port: readonly { readonly service: string; readonly port: number }[]
  /** B13: the uncommitted-changes reader found a difference; false when it found none or gave up (CL4). */
  readonly uncommitted: boolean
  /** `--fresh` (D12, D13). */
  readonly fresh: boolean
  /** The builds of the app's latest accepted deploy from this machine (`shared/history-builds.ts` `latestAcceptedBuilds`); undefined with none, and B23 is left out. */
  readonly history: readonly HistoryBuild[] | undefined
  /** What the notes of choice B-a said at the last deploy from this folder on this machine; null at the first. */
  readonly earlier: EarlierNotes | null
  /** B30's builds, once step 9 has answered (CL7): the fresh generation signed from this machine's history. */
  readonly older?: readonly Omit<LineOf<"B30">, "id" | "server">[]
}

export type Facts = {
  /** The block's title and rows, in order. */
  readonly rows: readonly BuildLine[]
  /** Marked `!`, after the block. */
  readonly warnings: readonly BuildLine[]
  /** After the warnings. */
  readonly notes: readonly BuildLine[]
  /** The deploy panel's rows (B28; D12 for `--fresh`). */
  readonly panel: readonly BuildLine[]
  /** What the notes of choice B-a say now, to be compared at the next deploy. */
  readonly said: EarlierNotes
}

/** B5's rules, in the order its lines are drawn. */
const RULES: readonly LeftOutRule[] = [
  "ignore_file",
  "zekno",
  "secret_looking",
  "link",
  "not_a_file",
]

/** A `.env` or `.env.*` file: B7 says how to give its values to the app. */
const isEnvFile = (path: string): boolean => {
  const name = path.split("/").at(-1)!
  return name === ".env" || name.startsWith(".env.")
}

const groupOf = (build: FactsBuild): BuildGroup => ({
  services: [...build.services],
  dockerfile: build.dockerfile,
})

/** Two lists of names say the same, in any order. */
const sameNames = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0")

/** The service that names a build in a line. */
const leadOf = (build: FactsBuild): string => build.services[0]!

/** The facts of a deploy that builds (CL5). */
export function factsOf(input: FactsInput): Facts {
  const { walk, limits, builds, earlier } = input
  const groups = builds.map(groupOf)
  const first = earlier === null

  // The secret-looking files left out that no entry of `source.include` names: B26 asks of the named ones.
  const unnamed = walk.leftOut.flatMap((entry) =>
    entry.rule === "secret_looking" &&
    entry.named === null &&
    entry.kind !== "git"
      ? [{ path: entry.path, kind: entry.kind }]
      : []
  )
  const envFiles = unnamed.filter(({ path }) => isEnvFile(path))
  const otherSecrets = unnamed.filter(({ path }) => !isEnvFile(path))
  const onlyApp = builds.flatMap((build) =>
    build.onlyApp.filter(({ names }) => names.length > 0)
  )

  const rows: BuildLine[] = [
    input.above === null
      ? { id: "B1", server: input.server }
      : {
          id: "B2",
          server: input.server,
          root: input.above.root,
          top: input.above.top,
        },
    { id: "B3", files: limits.files, bytes: limits.bytes },
  ]
  if (limits.largest.length > 0)
    rows.push({ id: "B4", largest: [...limits.largest] })
  const leftOutGroups = RULES.flatMap((rule) => {
    const paths = walk.leftOut
      .filter((entry) => entry.rule === rule)
      .map((entry) => entry.path)
    return paths.length === 0 ? [] : [{ rule, paths }]
  })
  if (leftOutGroups.length > 0)
    rows.push({ id: "B5", groups: leftOutGroups, ignoreFile: walk.ignoreFile })
  if (walk.secretsSent.length > 0)
    rows.push({
      id: "B6",
      file: input.file,
      paths: walk.secretsSent.map(({ path }) => path),
    })
  rows.push({ id: "B9", builds: groups })
  const reads = builds
    .filter((build) => build.args.length > 0)
    .map((build) => ({
      service: leadOf(build),
      names: build.args.map(({ name }) => name),
    }))
  if (reads.length > 0) rows.push({ id: "B10", reads })

  const warnings: BuildLine[] = []
  const large = sizeWarning(limits)
  if (large !== undefined) warnings.push(large)
  if (input.uncommitted) warnings.push({ id: "B13" })
  for (const build of builds)
    for (const image of build.unpinned)
      warnings.push({ id: "B14", service: leadOf(build), image })
  for (const build of builds)
    for (const { name, why } of build.notGiven)
      warnings.push(
        why === "builder"
          ? { id: "B16", service: leadOf(build), name }
          : why === "reserved"
            ? { id: "B17", service: leadOf(build), name }
            : { id: "B18", service: leadOf(build), name, app: input.app }
      )
  for (const older of input.older ?? [])
    warnings.push({ id: "B30", server: input.server, ...older })

  const notes: BuildLine[] = envFiles.map(({ path }) => ({ id: "B7", path }))
  const service = builds[0]?.services[0]
  if (service !== undefined)
    for (const { path, kind } of otherSecrets) {
      const before = earlier?.leftOutSecrets
      const said =
        first ||
        before === undefined ||
        !before.some((each) => each.path === path && each.kind === kind)
      if (said) notes.push({ id: "B8", path, service, kind })
    }
  for (const { service: name, port } of input.port)
    notes.push({ id: "B11", service: name, port })
  for (const { service: name, names } of onlyApp) {
    const before = earlier?.onlyApp
    const was = before?.find((each) => each.service === name)
    const said =
      first ||
      before === undefined ||
      was === undefined ||
      !sameNames(was.names, names)
    if (said) notes.push({ id: "B20", service: name, names: [...names] })
  }
  if (builds.length > 0 && (first || !earlier.dockerfile))
    notes.push({ id: "B21" })
  for (const build of builds)
    if (build.network === "none")
      notes.push({ id: "B22", service: leadOf(build) })
  for (const build of builds)
    for (const name of changedReads(build, input.history))
      notes.push({ id: "B23", service: leadOf(build), name })
  if (input.fresh)
    for (const build of builds)
      notes.push({ id: "D13", service: leadOf(build) })

  const panel: BuildLine[] = []
  if (input.fresh) panel.push({ id: "D12", builds: groups })
  panel.push({
    id: "B28",
    builds: groups,
    files: limits.files,
    bytes: limits.bytes,
  })

  return {
    rows,
    warnings,
    notes,
    panel,
    said: {
      leftOutSecrets: otherSecrets,
      onlyApp: onlyApp.map(({ service: name, names }) => ({
        service: name,
        names: [...names],
      })),
      dockerfile: builds.length > 0,
    },
  }
}

/**
 * The plain variables a build is given whose value differs from what the
 * build of the same service was given at the app's latest accepted deploy
 * from this machine (B23; FR-072c). Without that history, or with no build
 * there for these services, there is no reason. A name that build was not
 * given gives none either: the variable may be new, or the Dockerfile may
 * declare it anew, and zekno does not guess which.
 */
function changedReads(
  build: FactsBuild,
  history: readonly HistoryBuild[] | undefined
): string[] {
  if (history === undefined) return []
  const before = history.find((each) =>
    build.services.some((service) => each.services.includes(service))
  )
  if (before === undefined) return []
  return build.args.flatMap(({ name, value }) => {
    const was = before.build.args.find((arg) => arg.name === name)
    return was !== undefined && was.value !== value ? [name] : []
  })
}
