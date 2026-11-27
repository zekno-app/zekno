/**
 * Before the session, a deploy that builds (specs/016-build-from-source,
 * contracts/cli.md CL7 steps 1 to 4, and the rule of CL5's questions; FR-001,
 * FR-004, FR-009, FR-012, FR-015a, FR-015b, FR-021a). Each step is a stop
 * with nothing signed, exit status 1 (CL11):
 *
 * 1. The source chosen and read once (`readDeploySource`): a settings file
 *    checked whole by its reader, the reach of each `source.root` with it; a
 *    Compose file written by hand under CL6's rule (`project/compose-read.ts`).
 * 2. `--fresh` on a deploy that builds nothing: C21 (`ops/deploy.ts`).
 * 3. An app whose name ends with a hyphen: C21c (plan item 15 (a)). Then each
 *    built service in the file's order, read as `ops/deploy-build-read.ts`
 *    says (C21b, pass 1, C20, C21a, CL3), and the services grouped into
 *    builds (C17, C16).
 * 4. Pass 1's limits for each pack (C1 to C4), the uncommitted-changes fact
 *    (CL4) and pass 2 (`pack/chunks.ts`), whose pieces are sealed into this
 *    run's own folder for the server's key from the signed team list (CL7 step
 *    11 reads them from there); then each build's base key, core's `baseKey`.
 *
 * A deploy with no built service takes none of these steps. The summary's
 * facts are made with them (`ops/deploy-build-facts.ts`) for the screens of
 * phase 4 to draw (T141). Its questions are asked at a terminal (`asking/build-yes.ts`);
 * with none, `checkAgreed` keeps the rule (C19). The session's part is
 * `ops/deploy-build-session.ts`.
 *
 * The folder sent is the person's, maybe a cloned repository's: it is read
 * with bounds, a link is never followed out of it, and nothing found there is
 * run.
 */
import { realpathSync } from "node:fs"

import { baseKey, type ServerPublicKey } from "@workspace/core"

import type { OpDeps, Team } from "../cli/context"
import { healthOf, routesOf } from "../domains/routes"
import { checkChanges, type ChangesCheck } from "../git/changes"
import { createPacks, type Pack } from "../pack/chunks"
import type { Facts } from "../pack/facts"
import { checkLimits, limitsOf } from "../pack/limits"
import type { NamedSecret, Walk } from "../pack/walk"
import { type AgreedEntry, isAgreed } from "../profile/agreed"
import type { Server } from "../profile/profile"
import { openRunFolder, type RunFolder } from "../profile/run-folder"
import { composeText } from "../settings/compose"
import { readSettingsFile } from "../settings/file"
import { readSource } from "../settings/source"
import type {
  DeploySource,
  DeployText,
  Settings,
  SettingsRead,
} from "../settings/types"
import { BuildStop, type SecretKind } from "../shared/build-lines"
import type { BuildArg } from "./build-reads"
import { buildFacts } from "./deploy-build-facts"
import { type Group, packKeyOf, readBuilds } from "./deploy-build-read"
import { notSigned } from "./deploy-send"

/**
 * What a deploy read (CL7 step 1). `built`: a settings file with a built
 * service, kept whole, since its Compose text is made in the session from
 * the build keys (CL7 step 10). Until then `text` holds each built service's
 * image empty: it is never signed, and serves only what reads the services
 * before the session (the values the first deploy asks for).
 */
export type SourceRead = DeployText & { built?: SettingsRead }

/** One build of the deploy, everything of its entry but the key and `fresh`, which the session gives (CL7 steps 9 and 10). */
export type PreparedBuild = {
  /** The services it serves, in the file's order: the first names it in a line. */
  readonly services: readonly string[]
  readonly dockerfile: string
  /** `build.stage`, null for the last stage. */
  readonly target: string | null
  /** The plain variables given, sorted by name (core.md CO1, `args`). */
  readonly args: readonly BuildArg[]
  readonly network: "default" | "none"
  /** In seconds; `LIMITS.buildDefaultSeconds` when the settings name none (FR-010). */
  readonly timeout: number
  /** Pass 2's pack: its fingerprint, size and the pieces sealed in this run's folder. */
  readonly pack: Pack
  /** Core's `baseKey`: the key with `fresh` null (CO4). */
  readonly base: string
  /** What zekno's own secret-looking rule left out of its folder sent, `.git` aside, for E7 when its build fails (CL7, "The answer"). */
  readonly leftOutSecrets: readonly {
    readonly path: string
    readonly kind: SecretKind
  }[]
}

/** What a deploy that builds prepared before its session. */
export type BuildPlan = {
  /** The settings read, from which the session makes the Compose text signed. */
  readonly settings: Settings
  /** The settings file as zekno shows it. */
  readonly file: string
  /** In the order of each build's first service in the file. */
  readonly builds: readonly PreparedBuild[]
  /** The summary's facts (CL5); B30 is added once the session's step 9 answered. */
  readonly facts: Facts
  /** B24: the folders sent no one agreed to on this machine yet (FR-015b). */
  readonly folders: readonly AgreedEntry<"folders">[]
  /** B26, or C19 with no terminal: the secret-looking entries `source.include` names that no one agreed to (FR-015a). */
  readonly unagreed: readonly { folder: string; entry: NamedSecret }[]
  /** This run's own folder, which holds the sealed pieces; removed when the deploy ends. */
  readonly run: RunFolder
}

/**
 * The text before the session of settings with a built service: each built
 * service's image empty, as `SourceRead` says. Never signed.
 */
const unsignedText = (settings: Settings): string =>
  composeText(
    settings,
    new Map(
      settings.services.flatMap(([name, service]) =>
        service.build === undefined ? [] : [[name, ""] as const]
      )
    )
  )

/**
 * Reads the chosen file once (CL7 step 1): a Compose file as
 * `settings/source.ts` reads it; a settings file read and checked whole, with
 * the reach of each root, and kept whole when it builds. A settings file that
 * builds nothing gives what `readSource` gives, from the same single read.
 */
export function readDeploySource(
  source: DeploySource & { kind: "compose" | "settings" },
  cwd: string
): SourceRead {
  if (source.kind === "compose") return readSource(source, cwd)
  const read = readSettingsFile(source.source, cwd)
  const builds = read.settings.services.some(([, each]) => each.build)
  return {
    text: builds ? unsignedText(read.settings) : composeText(read.settings),
    path: read.path,
    settings: {
      services: read.settings.services.map(([name]) => name),
      sha256: read.sha256,
      routes: routesOf(read.settings),
      health: healthOf(read.settings),
    },
    ...(builds ? { built: read } : {}),
  }
}

/** The server's key from the signed team list, which pieces are sealed for (FR-026). */
function serverKeyOf(
  team: Pick<Team, "trust">,
  server: Server
): ServerPublicKey {
  const key = team.trust.servers.find(
    (each) => each.serverId === server.serverId
  )?.publicKey
  if (key === undefined) throw notSigned("unknown_server")
  return key
}

/** Pieces of the deploy's packs, sealed in this run's folder, with the uncommitted-changes fact, as CL7 step 4 makes them. */
async function packGroups(
  team: Pick<Team, "trust">,
  server: Server,
  run: RunFolder,
  groups: readonly Group[]
): Promise<{ packs: Pack[]; uncommitted: boolean }> {
  const packs = createPacks({
    serverKey: serverKeyOf(team, server),
    folder: run.path,
  })
  const checks = new Map<string, ChangesCheck>()
  const made: Pack[] = []
  for (const { first } of groups) {
    const { walk } = first
    let check = checks.get(walk.root)
    if (check === undefined) {
      check = checkChanges(walk.root)
      checks.set(walk.root, check)
    }
    made.push(await packs.pack(walk, check.hook))
  }
  const uncommitted = [...checks.values()]
    .map((check) => check.finish())
    .some((fact) => fact !== null)
  return { packs: made, uncommitted }
}

/**
 * CL7 steps 3 and 4 for a settings file with a built service: every stop
 * before the session, then the packs sealed in this run's own folder, each
 * build's base key and the summary's facts. The run's folder is removed when
 * anything stops it here; else when the deploy ends (`sendDeploy`).
 */
export async function prepareBuild(
  deps: Pick<OpDeps, "home">,
  input: {
    team: Pick<Team, "trust" | "store">
    server: Server
    app: string
    read: SettingsRead
    fresh: boolean
  }
): Promise<BuildPlan> {
  const { team, server, app, read } = input
  if (app.endsWith("-")) throw new BuildStop({ id: "C21c", app })
  const { groups, walks } = readBuilds({ home: deps.home, ...input })
  // CL7 step 4: pass 1's limits for each pack, before anything is read, sealed or written.
  const packed = [
    ...new Map(
      groups.map(({ first }) => [packKeyOf(first.walk), first.walk])
    ).values(),
  ]
  for (const walk of packed) checkLimits(walk, limitsOf(walk))

  const run = openRunFolder(deps.home)
  try {
    const { packs, uncommitted } = await packGroups(team, server, run, groups)
    const settings = realpathSync(read.path)
    const roots = [...new Set(walks.map((walk) => walk.root))]
    return {
      settings: read.settings,
      file: read.shown,
      builds: groups.map((group, at) => preparedOf(group, packs[at]!)),
      facts: buildFacts({ ...input, groups, uncommitted }),
      folders: roots
        .map((folder) => ({ folder, settings }))
        .filter((entry) => !isAgreed(deps.home, "folders", entry)),
      unagreed: unagreedOf(walks),
      run,
    }
  } catch (error) {
    run.remove()
    throw error
  }
}

/** One build as the session signs it, but its key and `fresh`: its pack, and its base key, core's `baseKey` (CO4). */
function preparedOf(group: Group, pack: Pack): PreparedBuild {
  const { first } = group
  const builder = {
    name: "dockerfile" as const,
    dockerfile: first.dockerfile,
    target: first.target,
  }
  const recipe = {
    builder,
    args: first.reads.args,
    // Step 1 has no build secret, so no listed fingerprint goes in (FR-037e comes with step 1b).
    secrets: [],
    network: first.network,
  }
  return {
    services: group.members.map(({ service }) => service),
    dockerfile: first.dockerfile,
    target: first.target,
    args: first.reads.args,
    network: first.network,
    timeout: group.timeout,
    pack,
    base: baseKey({ pack: { hash: pack.hash }, ...recipe, fresh: null }, []),
    leftOutSecrets: first.walk.leftOut.flatMap((entry) =>
      entry.rule === "secret_looking" && entry.kind !== "git"
        ? [{ path: entry.path, kind: entry.kind }]
        : []
    ),
  }
}

/** The secret-looking entries no one agreed to, each once by its folder and path, in the walks' order. */
function unagreedOf(walks: readonly Walk[]): BuildPlan["unagreed"] {
  const found: { folder: string; entry: NamedSecret }[] = []
  for (const walk of walks)
    for (const entry of walk.unagreed)
      if (
        !found.some(
          (each) => each.folder === walk.root && each.entry.path === entry.path
        )
      )
        found.push({ folder: walk.root, entry })
  return found
}

/** The path `agreed.json` keeps for an entry B26 asks of: a file by its own path, `.git` or a path under it by its entry of `source.include`. */
export const agreedPath = (entry: NamedSecret): string =>
  entry.kind === "git" ? entry.named : entry.path

/**
 * CL5's rule with no terminal, before anything is signed (FR-015a): a
 * secret-looking entry `source.include` names is sent only once this machine
 * agreed to it; else C19, naming it. At a terminal the questions asked it
 * first (`asking/build-yes.ts`), so nothing is left here.
 */
export function checkAgreed(build: BuildPlan): void {
  const left = build.unagreed[0]
  if (left !== undefined)
    throw new BuildStop({
      id: "C19",
      file: build.file,
      path: agreedPath(left.entry),
    })
}
