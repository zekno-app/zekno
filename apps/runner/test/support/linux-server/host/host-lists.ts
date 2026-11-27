/**
 * What `server.ts` reads of the host, all through `host-docker.ts` and all
 * read only (specs/016-build-from-source, T008; LC8): the containers,
 * volumes and networks named zekno-check-*, those of them that carry a
 * run's label `zekno-check=<id>`, the host's images, and the count of its
 * build records (`docker buildx history ls`, with BUILDX_CONFIG of its own,
 * so the default builder of the run's engine is counted, and no builder
 * state of the host's is read or written; a builder of another name, such
 * as one `docker buildx create` made, is not counted). `down` compares them
 * with the lists taken before `up`.
 */
import type { Answer, HostDocker } from "./host-docker"

export const SERVER_SCRIPT =
  "bun --no-env-file apps/runner/test/support/linux-server/server.ts"

export type Leftovers = {
  readonly containers: readonly string[]
  readonly volumes: readonly string[]
  readonly networks: readonly string[]
}

const PREFIX = "zekno-check-"
const RUN_NAME = /^zekno-check-([a-z0-9]{8})-(?:server|data|net|client)$/

export const LIST_CONTAINERS = [
  "docker",
  "ps",
  "--all",
  "--no-trunc",
  "--filter",
  `name=${PREFIX}`,
  "--format",
  "{{.Names}}",
]
export const LIST_VOLUMES = [
  "docker",
  "volume",
  "ls",
  "--filter",
  `name=${PREFIX}`,
  "--format",
  "{{.Name}}",
]
export const LIST_NETWORKS = [
  "docker",
  "network",
  "ls",
  "--filter",
  `name=${PREFIX}`,
  "--format",
  "{{.Name}}",
]
export const LIST_IMAGES = [
  "docker",
  "image",
  "ls",
  "--all",
  "--no-trunc",
  "--digests",
  "--format",
  "{{.ID}} {{.Repository}}:{{.Tag}}@{{.Digest}}",
]
export const LIST_RECORDS = [
  "docker",
  "buildx",
  "history",
  "ls",
  "--format",
  "json",
]

/** The first line of what a call printed on standard error, or else on standard output. */
export function firstLine(answer: Answer): string {
  const text = answer.stderr.trim() || answer.stdout.trim()
  return text.split("\n")[0]?.trim() ?? ""
}

/** The call's standard output, or a throw of one line when it failed. */
export async function read(
  docker: HostDocker,
  args: readonly string[]
): Promise<string> {
  const answer = await docker.run(args)
  if (answer.code !== 0) {
    const words = args.slice(0, args[1] === "ps" ? 2 : 3).join(" ")
    throw new Error(
      `${words} failed (exit ${answer.code}): ${firstLine(answer)}`
    )
  }
  return answer.stdout
}

const linesOf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")

/** The names a listing gives that start zekno-check-: Docker's filter matches anywhere in a name. */
async function named(
  docker: HostDocker,
  args: readonly string[]
): Promise<string[]> {
  return linesOf(await read(docker, args))
    .flatMap((line) => line.split(","))
    .filter((name) => name.startsWith(PREFIX))
}

/** The label every container, volume and network of the run `id` carries (`plan.ts`). */
export const runLabel = (id: string): string => `zekno-check=${id}`

/** The three listings of what carries the run's label, in the order of `Leftovers`. */
export function labelledLists(id: string): {
  readonly [kind in keyof Leftovers]: readonly string[]
} {
  const filter = ["--filter", `label=${runLabel(id)}`]
  return {
    containers: [
      "docker",
      "ps",
      "--all",
      "--no-trunc",
      ...filter,
      "--format",
      "{{.Names}}",
    ],
    volumes: ["docker", "volume", "ls", ...filter, "--format", "{{.Name}}"],
    networks: ["docker", "network", "ls", ...filter, "--format", "{{.Name}}"],
  }
}

/** The containers named zekno-check-* that carry the label of the run `id`. */
export const containersLabelled = (docker: HostDocker, id: string) =>
  named(docker, labelledLists(id).containers)

/** What is named zekno-check-* and carries the label of the run `id`. */
export async function labelled(
  docker: HostDocker,
  id: string
): Promise<Leftovers> {
  const lists = labelledLists(id)
  return {
    containers: await containersLabelled(docker, id),
    volumes: await named(docker, lists.volumes),
    networks: await named(docker, lists.networks),
  }
}

/** What is named zekno-check-* now. */
export async function leftovers(docker: HostDocker): Promise<Leftovers> {
  return {
    containers: await named(docker, LIST_CONTAINERS),
    volumes: await named(docker, LIST_VOLUMES),
    networks: await named(docker, LIST_NETWORKS),
  }
}

export const namesIn = (left: Leftovers): string[] => [
  ...left.containers,
  ...left.volumes,
  ...left.networks,
]

/** The host's images as sorted lines, one per name and digest. */
export async function hostImages(docker: HostDocker): Promise<string[]> {
  return [...new Set(linesOf(await read(docker, LIST_IMAGES)))].sort()
}

/** How many records `buildx history ls --format json` printed: one JSON object a line, or one array. */
export function countRecords(stdout: string): number {
  const text = stdout.trim()
  if (text === "") return 0
  try {
    if (text.startsWith("[")) return (JSON.parse(text) as unknown[]).length
    return linesOf(text).filter((line) => typeof JSON.parse(line) === "object")
      .length
  } catch {
    throw new Error("buildx history ls printed what is not JSON")
  }
}

/** The count of the host's build records, or why it could not be read. */
export async function buildRecords(
  docker: HostDocker
): Promise<number | string> {
  const answer = await docker.run(LIST_RECORDS)
  if (answer.code !== 0) return firstLine(answer)
  try {
    return countRecords(answer.stdout)
  } catch (error) {
    return (error as Error).message
  }
}

/** The run id of one of the four names a run makes, or undefined. */
export function runIdOf(name: string): string | undefined {
  return RUN_NAME.exec(name)?.[1]
}

/** The one line on how to remove what an earlier run left. */
export function removeHint(left: Leftovers): string {
  const ids = new Set<string>()
  const others: string[] = []
  const kinds: [readonly string[], string][] = [
    [left.containers, "docker rm --force"],
    [left.volumes, "docker volume rm"],
    [left.networks, "docker network rm"],
  ]
  for (const [names, remove] of kinds)
    for (const name of names) {
      const id = runIdOf(name)
      if (id === undefined) others.push(`${remove} ${name}`)
      else ids.add(id)
    }
  const ways = [
    ...[...ids].sort().map((id) => `${SERVER_SCRIPT} down --id ${id}`),
    ...others,
  ]
  return `Something named zekno-check-* is left from an earlier run: ${namesIn(left).join(", ")}. Remove it with: ${ways.join("; ")}`
}

/** The lines of `after` not in `before`, and those of `before` not in `after`. */
export function differences(
  before: readonly string[],
  after: readonly string[]
): { added: string[]; removed: string[] } {
  return {
    added: after.filter((line) => !before.includes(line)),
    removed: before.filter((line) => !after.includes(line)),
  }
}
