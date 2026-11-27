/**
 * `zekno settings compose` for settings with a built service
 * (specs/016-build-from-source, contracts/cli.md CL1, "zekno settings
 * compose"; plan item 18 (a); FR-011's exception; tasks T124). The text is
 * the one a deploy of this folder signs, made by the same `composeText`, with
 * each built service's image named as a deploy names it:
 *
 * - A Dockerfile build with no build secret: the folder is packed in pass 2's
 *   mode with no sealing (no network, no server, nothing written), and the
 *   name holds the build's key made with `fresh` null, as core's `buildKey`
 *   makes it. G22 says the name comes from the code (`from_code`).
 * - A build whose base key this machine's history shows with a fresh
 *   generation: the deploy signs that generation, so the key is made at
 *   deploy and the name holds the placeholder `MADE_AT_DEPLOY`. G22 says why
 *   (`fresh`). Steps 1b and 2 add their own placeholders.
 *
 * The stops of a deploy apply as they do there, before anything is packed:
 * C21c for the app's name, C21b, pass 1 and its limits (C1 to C4), C20,
 * C21a and CL3's stops (`ops/deploy-build-read.ts`, `pack/limits.ts`).
 *
 * The app and the server are the ones the zekno.json in use here names, as
 * the deploy takes them. The team is opened (the keychain read once) only
 * when the profile names that server, to read this machine's history
 * verified and the app's secret names, as `zekno settings` opens it to mark
 * what changed. Without them, the key is made from the folder and the
 * settings alone, and the name holds `UNNAMED_APP` for the app.
 *
 * The folder is the person's: it is read with pass 1's and pass 2's bounds,
 * a link never followed, and nothing found there is run.
 */
import { buildKey, builtImageName } from "@workspace/core"

import { teamOf, type OpDeps, type Team } from "../cli/context"
import { createPacks } from "../pack/chunks"
import { checkLimits, limitsOf } from "../pack/limits"
import { profileStore, type Server } from "../profile/profile"
import type { ProjectLink } from "../project/file"
import { standingOf } from "../project/signed"
import { composeText } from "../settings/compose"
import type { SettingsRead } from "../settings/types"
import { BuildStop, type LineOf } from "../shared/build-lines"
import { newestFresh } from "../shared/history-builds"
import { type Group, packKeyOf, readBuilds } from "./deploy-build-read"

/** The placeholder of a key made at deploy (contracts/cli.md CL1; G22): marked, so it is never taken for a key. */
export const MADE_AT_DEPLOY = "<made at deploy>"

/** The placeholder of the app when no zekno.json in use here names one: `zekno deploy` takes it then from `--app`. */
export const UNNAMED_APP = "<app>"

/** The registry of built images (core.md CO2): no registry answers for it. */
const BUILT_REGISTRY = "zekno.invalid"

type Reader = Pick<Team, "trust" | "store">

/**
 * Where a deploy of this file goes, as far as this machine knows it without
 * a server: the app and the server the zekno.json in use names, and the team
 * once opened, for the history and the app's secret names.
 */
type Where = {
  readonly app: string
  /** The server's name as the zekno.json names it, for G22; empty with none. */
  readonly serverName: string
  readonly server?: Server
  readonly team?: Reader
}

/**
 * No server is known: the ADD check is given one name of its own that C13
 * refuses anyway (a host with no dot), so it adds no address to C13's set.
 */
const NO_SERVER: Server = {
  name: "localhost",
  serverId: `srv_${"0".repeat(32)}`,
  target: { kind: "local", home: "/" },
}

/**
 * No team is opened: the app's secret names are those the settings name. The
 * reader reads the store inside a guard and keeps the settings' names when
 * it cannot be read (`ops/deploy-build-read.ts`, `appSecretNames`).
 */
const NO_TEAM: Reader = {
  get trust(): Reader["trust"] {
    throw new Error("No team is opened for `zekno settings compose`.")
  },
  get store(): Reader["store"] {
    throw new Error("No team is opened for `zekno settings compose`.")
  },
}

/**
 * The app and the server the zekno.json in use names (`link`), and the team
 * when the profile names that server and the team signed that zekno.json,
 * as `zekno settings` judges it before it reads the history.
 */
async function whereOf(
  deps: Pick<OpDeps, "home" | "keyStore" | "team">,
  link: ProjectLink | undefined
): Promise<Where> {
  if (link === undefined) return { app: UNNAMED_APP, serverName: "" }
  const named = { app: link.app, serverName: link.server }
  if (!profileStore(deps.home).exists()) return named
  const team = await teamOf(deps)
  if (standingOf(link, team.trust, deps.home).kind !== "used") return named
  const server = team.profile.servers.find((each) => each.name === link.server)
  return server === undefined ? named : { ...named, server, team }
}

/** The image name of one build: its key, or the placeholder when the history shows a fresh generation for it. */
function imageOf(
  where: Where,
  group: Group,
  hash: string
): { name: string; made: "from_code" | "fresh" } {
  const { first } = group
  const key = buildKey(
    {
      pack: { hash },
      builder: {
        name: "dockerfile",
        dockerfile: first.dockerfile,
        target: first.target,
      },
      args: first.reads.args.map(({ name, value }) => ({ name, value })),
      // Step 1 has no build secret (SV6): nothing listed goes in.
      secrets: [],
      network: first.network,
      fresh: null,
    },
    []
  )
  // The key made with `fresh` null is the build's base key (core.md CO4).
  const fresh =
    where.team === undefined || where.server === undefined
      ? null
      : newestFresh(where.team, where.server, where.app, key)
  if (fresh !== null)
    return {
      name: `${BUILT_REGISTRY}/${where.app}:${MADE_AT_DEPLOY}`,
      made: "fresh",
    }
  const name =
    where.app === UNNAMED_APP
      ? `${BUILT_REGISTRY}/${UNNAMED_APP}:${key}`
      : builtImageName(where.app, key)
  return { name, made: "from_code" }
}

/**
 * The Compose text of settings with a built service, as a deploy here signs
 * it but for the exceptions above, and G22 for each built service, in the
 * settings' order, to be said on standard error.
 */
export async function builtCompose(
  deps: Pick<OpDeps, "home" | "keyStore" | "team">,
  read: SettingsRead,
  link: ProjectLink | undefined
): Promise<{ text: string; lines: LineOf<"G22">[] }> {
  const where = await whereOf(deps, link)
  if (where.app.endsWith("-"))
    throw new BuildStop({ id: "C21c", app: where.app })
  const { groups } = readBuilds({
    home: deps.home,
    team: where.team ?? NO_TEAM,
    server: where.server ?? NO_SERVER,
    app: where.app,
    read,
  })
  // Pass 1's limits for each pack, before anything is read for pass 2 (CL7 step 4).
  const walks = new Map(
    groups.map(({ first }) => [packKeyOf(first.walk), first.walk])
  )
  for (const walk of walks.values()) checkLimits(walk, limitsOf(walk))

  const packs = createPacks(null)
  const images = new Map<string, string>()
  const made = new Map<string, "from_code" | "fresh">()
  for (const group of groups) {
    const pack = await packs.pack(group.first.walk)
    const image = imageOf(where, group, pack.hash)
    for (const { service } of group.members) {
      images.set(service, image.name)
      made.set(service, image.made)
    }
  }
  const lines = read.settings.services.flatMap(([service]) => {
    const how = made.get(service)
    return how === undefined
      ? []
      : [
          {
            id: "G22",
            service,
            server: where.serverName,
            made: how,
          } as const,
        ]
  })
  return { text: composeText(read.settings, images), lines }
}
