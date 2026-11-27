/**
 * In the session, a deploy that builds, up to its signature
 * (specs/016-build-from-source, contracts/cli.md CL7 steps 8 to 11; FR-021a,
 * FR-034a, SC-019). `sendDeploy` (`ops/deploy.ts`) calls it only when the
 * deploy builds, after `version`, C7 and F1 (step 6) and `status`, the
 * server's identity, the app and its domains as in 015 (step 7):
 *
 * 8. `builder` (core.md CO12): `docker_too_old` stops before signing with F4,
 *    naming the engine. F4a, for a build plugin below its floor, waits for
 *    check L2 (tasks T139). `no_build_plugin` and `low_disk` are left to the
 *    runner (R13, R14), with no number used.
 * 9. `builds` with `apps: [app]`. Each build signs, for its base key, the
 *    newer fresh generation of the one `builds` reports and the newest this
 *    machine's history holds for that server, app and base key, or null when
 *    neither has one: the runner's answer is not signed, and a generation is
 *    never taken from its word alone when this machine knows a newer one, so
 *    zekno never signs the key of an image built before a fresh one (SC-019).
 *    When the history's is signed, B30 says so. `--fresh` signs the deploy's
 *    own number instead (D12, D13).
 * 10. Once the listing is made (`deploy-send.ts`), each build's key with
 *    core's `buildKey` and the listed fingerprints, its entry with the data
 *    model's value where the settings leave one out (`dockerfile`
 *    `Dockerfile`, `target` null for the last stage, `network` `default`,
 *    `timeout` 1,800, set before the session in `deploy-build.ts`), and the
 *    Compose text with each built service's image.
 * 11. The pieces were sealed into this run's folder by pass 2; the entry is
 *    signed with the builds and recorded `sent` as every deploy is
 *    (`deploy-send.ts`).
 */
import {
  type Build,
  buildKey,
  builtImageName,
  type Envelope,
  type ListedSecret,
  RunnerBuilderSchema,
  RunnerBuildsSchema,
  verifySecretStatement,
} from "@workspace/core"

import type { Team } from "../cli/context"
import { CliError } from "../cli/errors"
import type { Server } from "../profile/profile"
import { type Session, UNEXPECTED } from "../server/session"
import { composeText } from "../settings/compose"
import { BuildStop, type LineOf } from "../shared/build-lines"
import { newestFresh } from "../shared/history-builds"
import type { BuildPlan } from "./deploy-build"

/** What the session found for a deploy that builds, and how it is signed. */
export type SessionBuilds = {
  /** B30, for each build whose fresh generation is the one this machine's history holds (CL7 step 9). */
  readonly older: readonly LineOf<"B30">[]
  /** The fresh generation each build signs, in the plan's order, before `--fresh`; null for none. */
  readonly generations: readonly (number | null)[]
  /**
   * Step 10: the builds signed, and the Compose text that runs their images,
   * for a deploy numbered `sequence` that lists `statements`.
   */
  sign(
    statements: readonly Envelope[],
    sequence: number
  ): { compose: string; builds: Build[] }
}

/** The fingerprint each statement the deploy lists gives its secret, as core reads it (FR-037e). */
function listedOf(
  team: Pick<Team, "trust">,
  server: Server,
  app: string,
  statements: readonly Envelope[]
): ListedSecret[] {
  return statements.flatMap((envelope) => {
    const checked = verifySecretStatement({
      envelope,
      trust: team.trust,
      serverId: server.serverId,
      app,
    })
    return checked.ok
      ? [{ name: checked.value.name, hash: checked.value.hash }]
      : []
  })
}

/** Steps 8 and 9 of a deploy that builds, on its own session; step 10 is `sign`. */
export async function buildsInSession(input: {
  session: Pick<Session, "request">
  team: Pick<Team, "trust" | "store">
  server: Server
  app: string
  build: BuildPlan
  /** `--fresh`: each build signs the deploy's own number. */
  fresh: boolean
}): Promise<SessionBuilds> {
  const { session, team, server, app, build } = input
  // Step 8 (FR-034a). F4a, the build plugin's own floor, waits for check L2 (T139): the runner of step 1 says
  // `docker_too_old` for the engine alone.
  const builder = await session.request("builder", RunnerBuilderSchema, {
    input: {},
  })
  if (builder.can === "docker_too_old")
    throw new BuildStop({
      id: "F4",
      server: server.name,
      engine: builder.docker.engine ?? "",
    })

  // Step 9: what the runner keeps of this app, the server's word, never signed.
  const answer = await session.request("builds", RunnerBuildsSchema, {
    input: { apps: [app] },
  })
  const named = "apps" in answer ? Object.keys(answer.apps) : []
  if (!("apps" in answer) || named.length !== 1 || named[0] !== app)
    throw new CliError(UNEXPECTED)
  const kept = answer.apps[app]!
  const older: LineOf<"B30">[] = []
  const generations = build.builds.map((each) => {
    const reported =
      kept.fresh.find((entry) => entry.base === each.base)?.sequence ?? null
    const held = newestFresh(team, server, app, each.base)
    if (held === null) return reported
    if (!input.fresh && (reported === null || reported < held))
      older.push({
        id: "B30",
        server: server.name,
        service: each.services[0]!,
        reported,
        signed: held,
      })
    return reported === null ? held : Math.max(reported, held)
  })

  return {
    older,
    generations,
    sign(statements, sequence) {
      const listed = listedOf(team, server, app, statements)
      const builds = build.builds.map((each, at): Build => {
        const fresh = input.fresh ? sequence : generations[at]!
        const builder = {
          name: "dockerfile" as const,
          dockerfile: each.dockerfile,
          target: each.target,
        }
        const args = each.args.map(({ name, value }) => ({ name, value }))
        // No build secret in step 1: `secrets` stays empty until step 1b.
        const recipe = { builder, args, secrets: [], network: each.network }
        return {
          key: buildKey(
            { pack: { hash: each.pack.hash }, ...recipe, fresh },
            listed
          ),
          pack: {
            hash: each.pack.hash,
            size: each.pack.size,
            chunks: each.pack.pieces.map((piece) => piece.fingerprint),
          },
          ...recipe,
          timeout: each.timeout,
          fresh,
        }
      })
      const images = new Map(
        build.builds.flatMap((each, at) =>
          each.services.map(
            (service) =>
              [service, builtImageName(app, builds[at]!.key)] as const
          )
        )
      )
      return { compose: composeText(build.settings, images), builds }
    },
  }
}
