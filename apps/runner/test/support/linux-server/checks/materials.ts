/**
 * What check L9 (specs/016-build-from-source, T016; FR-031a, plan item 17;
 * contracts/runner.md RB11) reads and hands a build: the materials of
 * `buildx.build.provenance` in a build's metadata, and item 17 (c)'s policy
 * that denies every `docker-image://zekno.invalid/*` source, by buildx's
 * policy option (`--policy`, a Rego file) where `docker buildx build
 * --help` lists one, else by BuildKit's source-policy file, which buildx
 * reads from `EXPERIMENTAL_BUILDKIT_SOURCE_POLICY`. Both files are written
 * by the check outside the pack. Pure, but for `committedImage`, which
 * makes an image in the stand-in through `gate.ts`.
 */
import { firstLine } from "../host/host-lists"
import type { InStandIn } from "../build-runs/rb7"

/** Where built images live: the name space item 17 keeps from every build. */
export const RESERVED = "zekno.invalid/"

export type Material = {
  readonly uri: string
  readonly digests: readonly string[]
}
export type Materials = {
  /** Whether the metadata has `buildx.build.provenance` at all. */
  readonly provenance: boolean
  readonly materials: readonly Material[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function materialOf(entry: unknown): Material | undefined {
  if (!isRecord(entry) || typeof entry.uri !== "string") return undefined
  const digests = isRecord(entry.digest)
    ? Object.entries(entry.digest)
        .filter(([, value]) => typeof value === "string")
        .map(([algorithm, value]) => `${algorithm}:${value as string}`)
    : []
  return { uri: entry.uri, digests }
}

/**
 * The materials of `buildx.build.provenance`: SLSA 0.2's `materials`, or
 * 1.0's `buildDefinition.resolvedDependencies`.
 */
export function materialsOf(
  metadata: Readonly<Record<string, unknown>> | undefined
): Materials {
  const provenance = metadata?.["buildx.build.provenance"]
  if (!isRecord(provenance)) return { provenance: false, materials: [] }
  const definition = provenance.buildDefinition
  const list = Array.isArray(provenance.materials)
    ? provenance.materials
    : isRecord(definition) && Array.isArray(definition.resolvedDependencies)
      ? definition.resolvedDependencies
      : []
  return {
    provenance: true,
    materials: list
      .map(materialOf)
      .filter((item): item is Material => item !== undefined),
  }
}

const SHOWN = 3

/** For a record: whether the materials exist, and whether they name `name` or hold one of `ids`. */
export function materialWords(
  read: Materials,
  name: string,
  ids: readonly string[] = []
): string {
  if (!read.provenance) return "no buildx.build.provenance in its metadata"
  if (read.materials.length === 0) return "provenance with no materials"
  const named = read.materials.filter((item) => item.uri.includes(name))
  const byDigest = read.materials.filter((item) =>
    item.digests.some((digest) => ids.includes(digest))
  )
  const shown = (items: readonly Material[]) =>
    items
      .slice(0, SHOWN)
      .map((item) => item.uri)
      .join(", ") +
    (items.length > SHOWN ? ` and ${items.length - SHOWN} more` : "")
  if (named.length > 0) return `materials name ${name} (${shown(named)})`
  if (byDigest.length > 0)
    return `materials hold ${name}'s digest under another name (${shown(byDigest)})`
  return `materials (${read.materials.length}) do not name ${name}: ${shown(read.materials)}`
}

/**
 * Item 17 (c) as a buildx policy: every source allowed but an image whose
 * reference holds `zekno.invalid/`; `decision` as L2's deny-all file gives it.
 */
export const DENY_RESERVED_REGO = [
  "package docker",
  "",
  "import rego.v1",
  "",
  "default allow := true",
  "",
  `allow := false if contains(json.marshal(input.image), ${JSON.stringify(RESERVED)})`,
  "",
  'decision := {"allow": allow}',
  "",
].join("\n")

/** The variable buildx reads BuildKit's source policy from. */
export const SOURCE_POLICY_VARIABLE = "EXPERIMENTAL_BUILDKIT_SOURCE_POLICY"

/**
 * Item 17 (c) as BuildKit's source policy: DENY (1) of every image under
 * `zekno.invalid/`, matched as a wildcard (the selector's default, 0). The
 * actions are numbers, which both of buildx's readers of the file take.
 */
export const SOURCE_POLICY = `${JSON.stringify(
  {
    rules: [
      {
        action: 1,
        selector: { identifier: `docker-image://${RESERVED}*` },
      },
    ],
  },
  null,
  2
)}\n`

/** The `--policy` line of `docker buildx build --help`, or undefined when it lists none. */
export function policyLine(help: string): string | undefined {
  return help
    .split("\n")
    .find((line) => /^\s+--policy\b/.test(line))
    ?.trim()
}

/**
 * The key `--policy` takes a file's path under: the one its help line
 * names before `=path` or `=file`, else `filename`.
 */
export function policyFileKey(help: string): string {
  const line = policyLine(help) ?? ""
  return /\b([a-z-]+)=<?(?:path|file)\b/i.exec(line)?.[1] ?? "filename"
}

/** `--policy <key>=<path>`: item 17 (c)'s policy by buildx's option. */
export function policyArgs(help: string, path: string): string[] {
  if (!/^\/[A-Za-z0-9._/-]+$/.test(path))
    throw new Error(`${JSON.stringify(path)} is not a plain absolute path`)
  return ["--policy", `${policyFileKey(help)}=${path}`]
}

/**
 * A call with `name=value` added to the environment `env -i` gives a
 * build, right after `-i`; any other call unchanged.
 */
export function withBuildEnv(
  args: readonly string[],
  name: string,
  value: string
): string[] {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name) || /[\0\n]/.test(value))
    throw new Error(`${name} is not a variable to hand a build`)
  const at = args.indexOf("env")
  const builds =
    at !== -1 &&
    args[at + 1] === "-i" &&
    args
      .slice(at + 2)
      .join(" ")
      .includes("docker buildx build")
  if (!builds) return [...args]
  return [...args.slice(0, at + 2), `${name}=${value}`, ...args.slice(at + 2)]
}

/** `run`, its builds handed `name=value` too (BuildKit's source-policy file). */
export function withBuildEnvRun(
  run: InStandIn,
  name: string,
  value: string
): InStandIn {
  return (args, options) => run(withBuildEnv(args, name, value), options)
}

export type Committed = { readonly name: string; remove(): Promise<void> }

/**
 * An image named `name` committed, with `changes` (`ONBUILD ...`), from a
 * container of `base` that never starts; the container removed by its name.
 */
export async function committedImage(
  run: InStandIn,
  input: {
    readonly name: string
    readonly base: string
    readonly container: string
    readonly changes: readonly string[]
  }
): Promise<Committed> {
  const { name, base, container } = input
  const must = async (args: readonly string[], what: string) => {
    const answer = await run(args)
    if (answer.code !== 0)
      throw new Error(
        `${what} failed (exit ${answer.code}): ${firstLine(answer)}`
      )
  }
  await run(["docker", "rm", "--force", container])
  try {
    await must(
      ["docker", "create", "--name", container, base],
      `docker create from ${base}`
    )
    await must(
      [
        "docker",
        "commit",
        ...input.changes.flatMap((change) => ["--change", change]),
        container,
        name,
      ],
      `docker commit as ${name}`
    )
  } finally {
    await run(["docker", "rm", "--force", container])
  }
  return {
    name,
    async remove() {
      const answer = await run(["docker", "image", "rm", name])
      if (answer.code !== 0 && !/no such image/i.test(answer.stderr))
        throw new Error(`the removal of ${name} failed: ${firstLine(answer)}`)
    },
  }
}
