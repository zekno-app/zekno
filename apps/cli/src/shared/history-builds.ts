/**
 * What this machine's history says of an app's builds
 * (specs/016-build-from-source, data-model.md, "The history"; FR-065;
 * tasks T107), for the tasks that use it: "changed, not deployed" and
 * "builds again because" (contracts/cli.md CL5), the fresh generation a
 * deploy signs (CL7 step 9), and a rollback's build secrets (step 1b, G45
 * and G46).
 *
 * Every deploy is read as `verifiedDeploys` reads it: signed by a current
 * team member for this team, server and app, its builds read from under
 * that signature (`readDeployEntry`). Only the outcome is the file's word.
 * A history that cannot be read holds nothing here. Only the profile's files
 * and the team list are needed, never the keychain or the server.
 */
import { baseKey, type Build, type ListedSecret } from "@workspace/core"

import type { Team } from "../cli/context"
import type { Server } from "../profile/profile"
import type { HistoryBuild, HistoryDeploy } from "./history"
import { verifiedDeploys } from "./views"

type Reader = Pick<Team, "store" | "trust">

/**
 * The builds of the latest deploy of an app this machine sent that its
 * runner answered, as "changed, not deployed" counts one (views.ts
 * `lastDeployedSettings`): `build_failed` among them, as a deploy that did
 * not start (CL7, "The answer"). Empty when that deploy built nothing;
 * undefined with none, so a reason drawn from it is left out (CL5).
 */
export function latestAcceptedBuilds(
  team: Reader,
  server: Server,
  app: string
): readonly HistoryBuild[] | undefined {
  const latest = verifiedDeploys(team, server, app)
    .filter((entry) => entry.outcome !== "sent")
    .at(-1)
  return latest === undefined ? undefined : (latest.deploy.builds ?? [])
}

/**
 * The newest fresh generation this machine's history holds for `base`, a
 * base key (core.md CO4), of `app` on `server`, or null with none (CL7 step
 * 9). Every deploy this machine signed counts, whatever its outcome: one
 * whose answer was not recorded may have built, and a generation newer than
 * the server's only makes the runner build again under a newer key, never
 * reuse an image built before the fresh one (SC-019).
 */
export function newestFresh(
  team: Reader,
  server: Server,
  app: string,
  base: string
): number | null {
  let newest: number | null = null
  for (const { deploy } of verifiedDeploys(team, server, app)) {
    for (const { build } of deploy.builds ?? []) {
      if (build.fresh === null || (newest !== null && build.fresh <= newest))
        continue
      if (baseKey(build, deploy.secrets) === base) newest = build.fresh
    }
  }
  return newest
}

/**
 * The fingerprint each secret `build` reads was listed with in `deploy`,
 * in the build's order (step 1b; FR-037e): what a rollback compares with
 * the listing now, G45 for one set again and G46 for one removed. A name
 * the deploy did not list is left out; a signed deploy lists every one
 * (core.md CO2).
 */
export function listedFingerprints(
  deploy: Pick<HistoryDeploy, "secrets">,
  build: Pick<Build, "secrets">
): ListedSecret[] {
  return build.secrets.flatMap((name) => {
    const listed = deploy.secrets.find((secret) => secret.name === name)
    return listed === undefined ? [] : [{ name, hash: listed.hash }]
  })
}
