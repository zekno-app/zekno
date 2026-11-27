/**
 * `server.ts down --id <id>` (specs/016-build-from-source, T008; LC8). On
 * the engine the run's `run.json` names, whatever the shell says, it
 * removes by exact name what the run `id` made, also after a failed test or
 * a failed or half-finished `up`: the client and the server, then the
 * network, then the volume, each only when it is there and carries the
 * run's label `zekno-check=<id>`; one of those names without it was not
 * made by `up`, and it is left and named. Then, by digest, each host image
 * that run pulled, never one that was there before `up`. Without a
 * readable `run.json` it works on the engine of this shell's context, a
 * socket of this machine, and removes no image.
 * Then it compares the zekno-check-* names, the host's images and the count
 * of the host's build records with the lists `up` took before it made
 * anything, and says in one line that nothing is left, no image was added or
 * removed but its own, and no host record was added or lost, or what differs.
 * The run's folder, with the client's key, goes once nothing of the run is
 * left; while something is, it stays, so `down` can be run again.
 */
import { HOST_IMAGES, type HostDocker } from "../host/host-docker"
import {
  buildRecords,
  differences,
  firstLine,
  hostImages,
  labelled,
  leftovers,
  namesIn,
  runLabel,
  type Leftovers,
} from "../host/host-lists"
import { namesOf, type Names } from "./plan"
import { readState, removeRunFolder, type RunState } from "./run-folder"

export type DownDeps = {
  /** The helper for the engine at `endpoint`; with `id`, it may make and remove that run's names. */
  readonly docker: (endpoint: string, id?: string) => HostDocker
  /** The engine of this shell's Docker context, a socket of this machine, or a throw of one line. */
  readonly endpoint: () => Promise<string>
  /** Where the run folders are, the system's temporary folder. */
  readonly root: string
  readonly say: (line: string) => void
}

/** By exact name: the containers, then the network and the volume, as `plan.ts`'s `remove` lists them. */
export function removals(
  names: Names
): { name: string; kind: keyof Leftovers; args: string[] }[] {
  return [
    {
      name: names.client,
      kind: "containers",
      args: ["docker", "rm", "--force", names.client],
    },
    {
      name: names.server,
      kind: "containers",
      args: ["docker", "rm", "--force", names.server],
    },
    {
      name: names.net,
      kind: "networks",
      args: ["docker", "network", "rm", names.net],
    },
    {
      name: names.data,
      kind: "volumes",
      args: ["docker", "volume", "rm", names.data],
    },
  ]
}

const INSPECT = (image: string) => [
  "docker",
  "image",
  "inspect",
  "--format",
  "{{.Id}}",
  image,
]
const NO_SUCH_IMAGE = /no such image/i

/**
 * The images the run pulled: absent before `up` by its own check, absent
 * from the list taken before, and one the host may hold for the stand-in.
 */
function pulledBy(state: RunState): string[] {
  return state.images
    .filter(({ image, present }) => {
      const digest = image.slice(image.indexOf("@") + 1)
      return (
        !present &&
        HOST_IMAGES.includes(image) &&
        !state.before.images.some((line) => line.includes(digest))
      )
    })
    .map(({ image }) => image)
}

/** One line from the parts that differ, a name at its start left as it is. */
function sentence(parts: readonly string[]): string {
  const line = parts.join("; ")
  return `${line.startsWith("zekno-check-") ? line : line[0]!.toUpperCase() + line.slice(1)}.`
}

export async function down(id: string, deps: DownDeps): Promise<number> {
  const names = namesOf(id)
  const state = readState(deps.root, id)
  let endpoint: string
  if ("reason" in state)
    try {
      endpoint = await deps.endpoint()
    } catch (error) {
      deps.say(
        `${(error as Error).message}. The run.json of ${id} ${state.reason}, so down removed nothing.`
      )
      return 1
    }
  else endpoint = state.endpoint
  const docker = deps.docker(endpoint, id)
  const problems: string[] = []

  const present = await leftovers(docker)
  const marked = await labelled(docker, id)
  for (const { name, kind, args } of removals(names)) {
    if (!present[kind].includes(name)) continue
    if (!marked[kind].includes(name)) {
      problems.push(
        `${name} does not carry the label ${runLabel(id)}, so up did not make it and down left it`
      )
      continue
    }
    const answer = await docker.run(args)
    if (answer.code !== 0)
      problems.push(`${name} could not be removed: ${firstLine(answer)}`)
  }

  let ownImageLeft = false
  if (!("reason" in state))
    for (const image of pulledBy(state)) {
      const inspect = await docker.run(INSPECT(image))
      if (inspect.code !== 0 && NO_SUCH_IMAGE.test(inspect.stderr)) continue
      const removed =
        inspect.code === 0
          ? await docker.run(["docker", "image", "rm", image])
          : inspect
      if (removed.code !== 0) {
        ownImageLeft = true
        problems.push(`${image} could not be removed: ${firstLine(removed)}`)
      }
    }

  const after = await leftovers(docker)
  const ownLeft = namesIn(after).filter((name) =>
    name.startsWith(`zekno-check-${id}-`)
  )
  if (ownLeft.length === 0 && !ownImageLeft) removeRunFolder(deps.root, id)

  if ("reason" in state) {
    deps.say(
      ownLeft.length === 0 && problems.length === 0
        ? `Nothing named zekno-check-${id}-* is left on ${endpoint}, this shell's engine; its run.json ${state.reason}, so no image was removed and the host's images and build records were not compared.`
        : sentence([
            ...problems,
            `left named zekno-check-${id}-*: ${ownLeft.join(", ")}`,
          ])
    )
    return ownLeft.length === 0 && problems.length === 0 ? 0 : 1
  }

  const before = state.before
  const left = namesIn(after).filter(
    (name) =>
      ![...before.containers, ...before.volumes, ...before.networks].includes(
        name
      )
  )
  if (left.length > 0)
    problems.push(`left named zekno-check-*: ${left.join(", ")}`)
  const images = differences(before.images, await hostImages(docker))
  if (images.added.length > 0)
    problems.push(`images added: ${images.added.join(", ")}`)
  if (images.removed.length > 0)
    problems.push(`images removed: ${images.removed.join(", ")}`)
  const records = await buildRecords(docker)
  if (typeof records === "string")
    problems.push(`the host's build records could not be counted: ${records}`)
  else if (before.buildRecords === null)
    problems.push("the host's build records were not counted before up")
  else if (records !== before.buildRecords)
    problems.push(
      `host build records: ${before.buildRecords} before up, ${records} now`
    )

  if (problems.length > 0) {
    deps.say(sentence(problems))
    return 1
  }
  deps.say(
    `Nothing named zekno-check-* is left, no image was added or removed but its own, and no host build record was added or lost (${records} before and after).`
  )
  return 0
}
