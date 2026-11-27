/**
 * Which host Docker calls get through `host-docker.ts`
 * (specs/016-build-from-source, T008; tasks.md, "Rules every task keeps";
 * LC8). Pure: `checkCall(args, id)` throws one line unless `args` is a call
 * the stand-in needs. The reads take only the flags `server.ts` gives them.
 * A call that makes, starts, enters, removes or reads the state of
 * something needs the run's id and may name only that run's four names
 * (`plan.ts`'s `namesOf`). The one image run, pulled or removed on the host
 * is pins.json's `ubuntu:24.04`, by digest, and a removal is never forced.
 * Nothing builds, prunes, logs in, tags, pushes, copies a folder or chooses
 * a builder or a context, and no global flag is taken: a global flag could
 * change which Docker answers.
 */
import { loadPins } from "../pins"
import { namesOf, type Names } from "../stand-in/plan"
import { checkPort } from "../stand-in/sshd"

const DIGEST_REF =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[0-9a-f]{64}$/

/** The images the host holds for the stand-in: `ubuntu:24.04` by digest, for the server and T165's client. */
export const HOST_IMAGES: readonly string[] = [loadPins().images.ubuntu.image]

class Refused extends Error {}

function refuse(args: readonly string[], why: string): never {
  const shown = args.map((arg) =>
    arg.length > 40 || arg.includes("\n")
      ? `${arg.slice(0, 20).split("\n")[0]}…`
      : arg
  )
  const call = shown.slice(0, 8).join(" ") + (shown.length > 8 ? " …" : "")
  throw new Refused(`host-docker refuses \`${call}\`: ${why}`)
}

/** A read: its words after `docker`, the flags it takes (true: with a value), its positional count. */
type Read = {
  readonly words: readonly string[]
  readonly flags: Readonly<Record<string, boolean>>
  readonly positional: number
}

const READS: readonly Read[] = [
  { words: ["version"], flags: { "--format": true }, positional: 0 },
  // The current context's engine: read once, by `resolveEndpoint`.
  {
    words: ["context", "inspect"],
    flags: { "--format": true },
    positional: 0,
  },
  {
    words: ["ps"],
    flags: {
      "--all": false,
      "--no-trunc": false,
      "--filter": true,
      "--format": true,
    },
    positional: 0,
  },
  {
    words: ["volume", "ls"],
    flags: { "--filter": true, "--format": true },
    positional: 0,
  },
  {
    words: ["network", "ls"],
    flags: { "--filter": true, "--format": true },
    positional: 0,
  },
  {
    words: ["image", "ls"],
    flags: {
      "--all": false,
      "--no-trunc": false,
      "--digests": false,
      "--format": true,
    },
    positional: 0,
  },
  { words: ["image", "inspect"], flags: { "--format": true }, positional: 1 },
  {
    words: ["buildx", "history", "ls"],
    flags: { "--format": true },
    positional: 0,
  },
]

/** Checks a read's flags and positional arguments; false when `args` is not this read. */
function isRead(args: readonly string[], read: Read): boolean {
  if (read.words.some((word, at) => args[1 + at] !== word)) return false
  const rest = args.slice(1 + read.words.length)
  let positional = 0
  for (let at = 0; at < rest.length; at++) {
    const arg = rest[at]!
    if (arg.startsWith("-")) {
      if (!(arg in read.flags))
        refuse(args, `${arg} is not a flag this read takes`)
      if (read.flags[arg]) {
        if (rest[at + 1] === undefined) refuse(args, `${arg} has no value`)
        at++
      }
    } else positional++
  }
  if (positional !== read.positional)
    refuse(
      args,
      `it takes ${read.positional || "no"} name${read.positional === 1 ? "" : "s"}`
    )
  return true
}

const exactly = (
  args: readonly string[],
  rest: readonly string[],
  ...want: string[]
) => {
  if (rest.length !== want.length || rest.some((arg, at) => arg !== want[at]))
    refuse(args, `it takes only ${want.join(" ")}`)
}

const hostImage = (args: readonly string[], ref: string | undefined) => {
  if (ref === undefined || !DIGEST_REF.test(ref))
    refuse(args, "an image is named by digest only, name@sha256:<64 hex>")
  if (!HOST_IMAGES.includes(ref))
    refuse(args, `the only image on the host is ${HOST_IMAGES.join(", ")}`)
}

const RUN_SWITCHES = new Set([
  "--detach",
  "--init",
  "--privileged",
  "--cgroupns=private",
])
const RUN_VALUES = new Set([
  "--name",
  "--hostname",
  "--label",
  "--volume",
  "--network",
  "--memory",
  "--memory-swap",
  "--publish",
  "--cap-add",
])

/** `docker run` of the run's server or client, as `plan.ts` gives them, and nothing wider. */
function checkRun(
  args: readonly string[],
  rest: readonly string[],
  names: Names,
  id: string
) {
  const given = new Map<string, string[]>()
  let at = 0
  for (; at < rest.length && rest[at]!.startsWith("-"); at++) {
    const flag = rest[at]!
    let value = ""
    if (RUN_VALUES.has(flag)) {
      if (rest[at + 1] === undefined) refuse(args, `${flag} has no value`)
      value = rest[++at]!
    } else if (!RUN_SWITCHES.has(flag))
      refuse(args, `${flag} is not a flag the stand-in's containers use`)
    given.set(flag, [...(given.get(flag) ?? []), value])
  }
  hostImage(args, rest[at])
  const one = (flag: string) => {
    const values = given.get(flag) ?? []
    if (values.length > 1) refuse(args, `${flag} is given twice`)
    return values[0]
  }
  const name = one("--name")
  if (name !== names.server && name !== names.client)
    refuse(args, `a container is named ${names.server} or ${names.client}`)
  const server = name === names.server
  if (!given.has("--detach")) refuse(args, "a container runs detached")
  if (one("--label") !== `zekno-check=${id}`)
    refuse(args, `the label is zekno-check=${id}`)
  const hostname = one("--hostname")
  if (hostname !== undefined && hostname !== name)
    refuse(args, "the hostname is the name")
  const network = one("--network")
  if (network !== undefined && network !== names.net)
    refuse(args, `the network is ${names.net}`)
  for (const volume of given.get("--volume") ?? [])
    if (!server || volume !== `${names.data}:/var/lib/docker`)
      refuse(
        args,
        `the only volume is ${names.data} on the server's /var/lib/docker`
      )
  for (const port of given.get("--publish") ?? []) {
    const found = /^127\.0\.0\.1:([0-9]+):22$/.exec(port)
    if (!server || !found)
      refuse(args, "only the server's sshd is published, on 127.0.0.1")
    try {
      checkPort(Number(found[1]))
    } catch (error) {
      refuse(args, (error as Error).message)
    }
  }
  for (const flag of ["--privileged", "--cgroupns=private"])
    if (given.has(flag) && !server)
      refuse(args, `only the server takes ${flag}`)
  for (const capability of given.get("--cap-add") ?? [])
    if (server || capability !== "NET_ADMIN")
      refuse(args, "only the client takes a capability, NET_ADMIN")
  for (const flag of ["--memory", "--memory-swap"])
    if ((given.get(flag) ?? []).some((value) => value !== "1g"))
      refuse(args, `${flag} takes 1g`)
}

/** `docker exec [-i] <server or client> <command...>`. */
function checkExec(
  args: readonly string[],
  rest: readonly string[],
  names: Names
) {
  const inner = rest[0] === "-i" ? rest.slice(1) : rest
  const container = inner[0]
  if (container !== names.server && container !== names.client)
    refuse(args, `a command runs in ${names.server} or ${names.client} only`)
  if (inner.length < 2) refuse(args, "it names no command")
}

/** The calls that make, start, enter, remove or read the state of this run's names only. */
const CHANGES: Readonly<
  Record<
    string,
    (
      args: readonly string[],
      rest: readonly string[],
      names: Names,
      id: string
    ) => void
  >
> = {
  "volume create": (args, rest, names, id) =>
    exactly(args, rest, "--label", `zekno-check=${id}`, names.data),
  "network create": (args, rest, names, id) =>
    exactly(args, rest, "--label", `zekno-check=${id}`, names.net),
  "volume rm": (args, rest, names) => exactly(args, rest, names.data),
  "network rm": (args, rest, names) => exactly(args, rest, names.net),
  "image rm": (args, rest) => {
    if (rest.length !== 1)
      refuse(args, "it takes one image, by digest, and no flag")
    hostImage(args, rest[0])
  },
  pull: (args, rest) => {
    if (rest.length !== 2 || rest[0] !== "--quiet")
      refuse(args, "it takes --quiet and one image")
    hostImage(args, rest[1])
  },
  rm: (args, rest, names) => {
    if (
      rest.length !== 2 ||
      rest[0] !== "--force" ||
      (rest[1] !== names.server && rest[1] !== names.client)
    )
      refuse(args, `it takes --force and ${names.server} or ${names.client}`)
  },
  run: (args, rest, names, id) => checkRun(args, rest, names, id),
  exec: (args, rest, names) => checkExec(args, rest, names),
  // Check L6 records whether the machine's Docker killed the stand-in for memory.
  "container inspect": (args, rest, names) =>
    exactly(args, rest, "--format", "{{.State.OOMKilled}}", names.server),
}

/**
 * Throws one line unless `args` is a call the stand-in needs: a read, or,
 * with this run's `id`, a change that names only what that run makes.
 */
export function checkCall(
  args: readonly string[],
  id: string | undefined
): void {
  if (args[0] !== "docker") refuse(args, "it is not a docker call")
  if (args[1] === undefined) refuse(args, "it names no command")
  if (args[1].startsWith("-"))
    refuse(args, "a global flag could change which Docker answers")
  for (const read of READS) if (isRead(args, read)) return
  const two = `${args[1]} ${args[2] ?? ""}`
  const key = two in CHANGES ? two : args[1] in CHANGES ? args[1] : undefined
  if (key === undefined) refuse(args, "it is not a call the stand-in needs")
  if (id === undefined)
    refuse(
      args,
      "a call that makes, enters, removes or reads something of a run needs this run's id"
    )
  CHANGES[key]!(args, args.slice(1 + key.split(" ").length), namesOf(id), id)
}
