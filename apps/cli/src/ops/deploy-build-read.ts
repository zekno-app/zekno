/**
 * Step 3 of a deploy that builds, for each built service in the file's order
 * (specs/016-build-from-source, contracts/cli.md CL7 step 3; FR-004, FR-009,
 * FR-012): a root that is, or holds, the home folder or zekno's own is C21b,
 * before anything under it is walked; pass 1 (`pack/walk.ts`); the
 * Dockerfile under exactly its name (C20); `build.dockerfile` left out while
 * the folder sent holds several Dockerfiles in FR-004's sense (C21a); the
 * Dockerfile read (CL3: the plain variables it is given, its images, its
 * `ADD` lines). Then the services grouped into builds: more than 8 is C17,
 * the values given across them past 64 KiB C16. `ops/deploy-build.ts` runs
 * these steps and the next.
 *
 * The folder is the person's: it is walked with `lstat`, a link never
 * followed, and the Dockerfile read once under what pass 1 saw of it.
 */
import { homedir } from "node:os"

import { currentSecrets, LIMITS, verifySecret } from "@workspace/core"

import type { Team } from "../cli/context"
import { checkAdds, serverAddresses } from "../dockerfile/add"
import { checkImages } from "../dockerfile/images"
import { readDockerfile } from "../dockerfile/instructions"
import { DOCKERFILE_BYTES, DockerfileStop } from "../dockerfile/lex"
import { readIgnoreFile } from "../pack/ignore"
import { readOnce } from "../pack/spool"
import {
  requireDockerfile,
  type SentFile,
  type Walk,
  walkFolder,
} from "../pack/walk"
import { isAgreed } from "../profile/agreed"
import type { Server } from "../profile/profile"
import { buildStop } from "../settings/build-faults"
import { rootReach, rootRefusal } from "../settings/build-reach"
import { DEFAULT_DOCKERFILE } from "../settings/build-shape"
import type { ServiceSettings, Settings, SettingsRead } from "../settings/types"
import { BuildStop } from "../shared/build-lines"
import { buildReads, checkDeployArgs } from "./build-reads"

/** What one built service's step 3 found. */
export type ServiceRead = {
  readonly service: string
  readonly settings: ServiceSettings
  readonly walk: Walk
  readonly dockerfile: string
  readonly target: string | null
  readonly reads: ReturnType<typeof buildReads>
  readonly unpinned: readonly string[]
  readonly network: "default" | "none"
  readonly timeout: number
}

/** Services that share one build (FR-012), as step 3 read them. */
export type Group = {
  readonly first: ServiceRead
  readonly members: ServiceRead[]
  timeout: number
}

/** Where step 3 reads from: the profile folder, the team, the server, the app and its settings file. */
export type ReadFrom = {
  readonly home: string
  readonly team: Pick<Team, "trust" | "store">
  readonly server: Server
  readonly app: string
  readonly read: SettingsRead
}

type Reading = ReadFrom & {
  readonly appSecrets: readonly string[]
  /** The walks made so far, by root, Dockerfile and `source.include`: two services of one folder walk it once. */
  readonly walks: Map<string, Walk>
}

/**
 * The names of the app's secrets this machine knows (B18): those the
 * settings name for its services, and those of its secret store verified
 * against the team list. A store that cannot be read adds none.
 */
function appSecretNames(from: ReadFrom, settings: Settings): string[] {
  const names = new Set(
    settings.services.flatMap(([, service]) => service.secrets ?? [])
  )
  const { team, server, app } = from
  try {
    const where = { trust: team.trust, serverId: server.serverId, app }
    const current = currentSecrets({
      ...where,
      ...team.store.secrets(server.serverId, app),
    })
    for (const record of current.secrets) {
      const checked = verifySecret({ ...where, record })
      if (checked.ok) names.add(checked.value.name)
    }
  } catch {
    // Nothing read from the store: the settings' names stand alone.
  }
  return [...names]
}

/**
 * The Dockerfiles of the folder sent in FR-004's sense, when there are
 * several: the one named `Dockerfile` at the top, beside a file at the top
 * whose name starts `Dockerfile.` (its own ignore file,
 * `Dockerfile.dockerignore`, is none), or beside a `Dockerfile` in a
 * sub-folder that is sent. Only what pass 1 sends counts. Empty when there is
 * one.
 */
function severalDockerfiles(walk: Walk): string[] {
  const others = walk.entries.flatMap((entry) => {
    if (entry.kind !== "file") return []
    const dotted =
      !entry.name.includes("/") &&
      entry.name.startsWith(`${DEFAULT_DOCKERFILE}.`) &&
      !entry.name.endsWith(".dockerignore")
    return dotted || entry.name.endsWith(`/${DEFAULT_DOCKERFILE}`)
      ? [entry.name]
      : []
  })
  return others.length === 0 ? [] : [DEFAULT_DOCKERFILE, ...others]
}

/**
 * The bytes of the Dockerfile pass 1 found, read once as pass 2 reads a file
 * (C5, C6): one past the lexer's bound is that bound's stop, never read.
 */
function dockerfileBytes(walk: Walk, dockerfile: string): Uint8Array {
  const entry = walk.entries.find(
    (each): each is SentFile => each.kind === "file" && each.name === dockerfile
  )!
  if (entry.size > DOCKERFILE_BYTES)
    throw new DockerfileStop({
      id: "dockerfile_size",
      why: "bytes",
      file: dockerfile,
    })
  const bytes = new Uint8Array(entry.size)
  let filled = 0
  readOnce(entry.path, entry.name, entry.seen, (part) => {
    bytes.set(part, filled)
    filled += part.length
  })
  return bytes
}

/** Pass 1 of a service's folder sent, made once for each root, Dockerfile and `source.include`. */
function walkOf(
  reading: Reading,
  folder: string,
  dockerfile: string,
  include: readonly string[]
): Walk {
  const key = JSON.stringify([folder, dockerfile, include])
  let walk = reading.walks.get(key)
  if (walk === undefined) {
    walk = walkFolder(folder, {
      dockerfile,
      ignore: readIgnoreFile(folder, { builder: "dockerfile", dockerfile }),
      include,
      // `folder` is a real path, as `agreed.json` keeps the folder sent.
      agreed: (path) => isAgreed(reading.home, "files", { folder, path }),
      zeknoHome: reading.home,
    })
    reading.walks.set(key, walk)
  }
  return walk
}

/** Step 3 for one built service: C21b, pass 1, C20, C21a, then CL3's reading and stops. */
function readService(
  reading: Reading,
  service: string,
  settings: ServiceSettings
): ServiceRead {
  const { read, app } = reading
  const build = settings.build!
  const root = settings.root ?? "."
  // The reader checked the reach; a folder changed since is said as it would be at the next read.
  const reach = rootReach(read.path, root)
  if ("id" in reach)
    throw buildStop(
      reach.id === "C22"
        ? { id: "C22", service, repository: reach.repository }
        : { id: "C23", service },
      read.shown
    )
  const refused = rootRefusal(reach.folder, homedir(), reading.home)
  if (refused !== undefined) throw new BuildStop({ ...refused, service })

  const dockerfile = build.dockerfile ?? DEFAULT_DOCKERFILE
  const walk = walkOf(reading, reach.folder, dockerfile, settings.include ?? [])
  requireDockerfile(walk, { file: read.shown, service, folder: root })
  if (build.dockerfile === undefined) {
    const dockerfiles = severalDockerfiles(walk)
    if (dockerfiles.length > 0)
      throw new BuildStop({
        id: "C21a",
        file: read.shown,
        service,
        dockerfiles,
      })
  }

  const parsed = readDockerfile(dockerfileBytes(walk, dockerfile), dockerfile)
  const reads = buildReads({
    app,
    service,
    settings,
    reading: parsed,
    appSecrets: reading.appSecrets,
  })
  const target = build.stage ?? null
  const { given } = reads
  const images = checkImages({ service, reading: parsed, given, stage: target })
  const server = serverAddresses(reading.server)
  checkAdds({ service, reading: parsed, given, server })
  return {
    service,
    settings,
    walk,
    dockerfile,
    target,
    reads,
    unpinned: images.unpinned.map((line) => line.image),
    network: build.network === "none" ? "none" : "default",
    timeout: build.timeout ?? LIMITS.buildDefaultSeconds,
  }
}

/** What one pack is told apart by, as `createPacks` tells them: the real root and the entries sent. */
export const packKeyOf = (walk: Walk): string =>
  `${walk.root}\n${walk.entries.map((entry) => entry.name).join("\n")}`

/**
 * The services grouped into builds (FR-012): one for each distinct pack,
 * recipe, plain variables and network, which is everything the key is made
 * of in step 1. The time limit is signed and not in the key (FR-022), so two
 * services whose builds differ only by it share one build, which takes the
 * longest. More than 8 builds is C17; the values given across them past 64
 * KiB C16.
 */
function groupBuilds(app: string, services: readonly ServiceRead[]): Group[] {
  const groups = new Map<string, Group>()
  for (const each of services) {
    const key = JSON.stringify([
      packKeyOf(each.walk),
      each.dockerfile,
      each.target,
      each.reads.args.map(({ name, value }) => [name, value]),
      each.network,
    ])
    const group = groups.get(key)
    if (group === undefined)
      groups.set(key, { first: each, members: [each], timeout: each.timeout })
    else {
      group.members.push(each)
      group.timeout = Math.max(group.timeout, each.timeout)
    }
  }
  const found = [...groups.values()]
  if (found.length > LIMITS.buildsPerDeploy)
    throw new BuildStop({ id: "C17", app, count: found.length })
  checkDeployArgs(
    app,
    found.map(({ first }) => first.reads.args)
  )
  return found
}

/**
 * Step 3 of every built service, in the file's order, then the builds they
 * make. `walks`: every distinct pass 1 made, a service's whose entries
 * another shares among them, for the questions each may need (B24, B26).
 */
export function readBuilds(from: ReadFrom): { groups: Group[]; walks: Walk[] } {
  const reading: Reading = {
    ...from,
    appSecrets: appSecretNames(from, from.read.settings),
    walks: new Map(),
  }
  const services = from.read.settings.services.flatMap(([service, settings]) =>
    settings.build === undefined
      ? []
      : [readService(reading, service, settings)]
  )
  return {
    groups: groupBuilds(from.app, services),
    walks: [...reading.walks.values()],
  }
}
