/**
 * The summary's facts of a deploy that builds, from what was prepared before
 * its session (specs/016-build-from-source, contracts/cli.md CL5, "Facts";
 * FR-017, FR-072 to FR-072c): the inputs of `pack/facts.ts`'s one pure
 * function, gathered from step 3's reading (`ops/deploy-build-read.ts`),
 * pass 1, the uncommitted-changes fact and this machine's history. No
 * sentence is made here: the screens of phase 4 draw each fact by its id
 * (T141).
 */
import { realpathSync } from "node:fs"
import { dirname, sep } from "node:path"

import type { Team } from "../cli/context"
import { factsOf, type Facts, type FactsBuild } from "../pack/facts"
import { limitsOf } from "../pack/limits"
import type { Server } from "../profile/profile"
import { gitTop } from "../settings/build-reach"
import type { Settings, SettingsRead } from "../settings/types"
import { latestAcceptedBuilds } from "../shared/history-builds"
import type { Group } from "./deploy-build-read"

/** The summary's row of one build (`pack/facts.ts`). */
function factsBuildOf(group: Group): FactsBuild {
  const { first } = group
  return {
    services: group.members.map(({ service }) => service),
    dockerfile: first.dockerfile,
    network: first.network === "none" ? "none" : "internet",
    args: first.reads.args,
    notGiven: first.reads.notGiven.map((line) => ({
      name: line.name,
      why:
        line.id === "B16"
          ? "builder"
          : line.id === "B17"
            ? "reserved"
            : "secret",
    })),
    onlyApp: group.members.flatMap(({ reads }) =>
      reads.onlyApp === null
        ? []
        : [{ service: reads.onlyApp.service, names: reads.onlyApp.names }]
    ),
    unpinned: first.unpinned,
  }
}

/**
 * B2's values when the folder sent is above the settings file's folder: the
 * root as the file writes it, and whether it is the top of its git
 * repository; null for B1.
 */
function aboveOf(
  read: SettingsRead,
  root: string,
  written: string
): { root: string; top: boolean } | null {
  const folder = realpathSync(dirname(read.path))
  if (folder === root || !folder.startsWith(`${root}${sep}`)) return null
  const top = gitTop(folder)
  return { root: written, top: top !== undefined && realpathSync(top) === root }
}

/** The built services zekno gives `PORT` to match their port (B11; FR-072a): with a port, and no `PORT` of their own. */
const portsGiven = (settings: Settings) =>
  settings.services.flatMap(([service, each]) =>
    each.build !== undefined &&
    each.port !== undefined &&
    !(each.plain ?? []).some(([name]) => name === "PORT") &&
    !(each.secrets ?? []).includes("PORT")
      ? [{ service, port: each.port }]
      : []
  )

/**
 * The facts of the deploy's builds (CL5). `pack/facts.ts` speaks of one
 * folder sent: the first build's, in the file's order; a second folder's
 * files, size, left-out rules and notes are not in the summary yet (how the
 * block shows several folders is the maintainer's to decide). No record of
 * what the notes said before is kept on this machine (data-model.md lists no
 * such file), so the history of the app stands for it: B21 follows choice
 * B-a (b) from it, while B8 and B20 are said at every deploy, more often than
 * B-a (b) asks, until such a record is decided.
 */
export function buildFacts(input: {
  team: Pick<Team, "trust" | "store">
  server: Server
  app: string
  read: SettingsRead
  groups: readonly Group[]
  uncommitted: boolean
  fresh: boolean
}): Facts {
  const { team, server, app, read } = input
  const { first } = input.groups[0]!
  const history = latestAcceptedBuilds(team, server, app)
  return factsOf({
    server: server.name,
    app,
    file: read.shown,
    above: aboveOf(read, first.walk.root, first.settings.root ?? "."),
    walk: first.walk,
    limits: limitsOf(first.walk),
    builds: input.groups.map(factsBuildOf),
    port: portsGiven(read.settings),
    uncommitted: input.uncommitted,
    fresh: input.fresh,
    history,
    earlier:
      history === undefined
        ? null
        : {
            dockerfile: history.some(
              ({ build }) => build.builder.name === "dockerfile"
            ),
          },
  })
}
