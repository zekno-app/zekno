/**
 * Deploys and rollbacks from the app: where the service definition comes
 * from, the questions asked before anything is signed, and the deploy
 * itself, with its stages and Docker's lines as events.
 */
import type { TeamTrust } from "@workspace/core"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

import { openTeam } from "../../cli/context"
import { prepareDeploy, prepareRollback, sendDeploy, type DeployPlan } from "../../ops/deploy"
import { writeLink } from "../../ops/link"
import { profileStore, type Server } from "../../profile/profile"
import { expectedValues } from "../../project/compose-file"
import { readCompose, type ComposeText } from "../../project/compose-read"
import { DEFAULT_COMPOSE, findProject, notSignedHere, shownPath, standingOf, type Standing } from "../../project/project"
import { sanitize } from "../../server/sanitize"
import { seconds } from "../../shared/time"
import { appNames, latestAccepted, secretNamesOf } from "../../shared/views"
import type { Effect } from "../state/events"
import { DEPLOY_LINES } from "../state/types"
import { batcher } from "./batcher"
import { reasonOf, type Context } from "./context"
import { linkedElsewhere, notConnected, NOT_IN_USE } from "./links"

/** The Compose file a deploy from the app uses when no zekno.json names another, in the folder the app was started from. */
export const COMPOSE_FILE = DEFAULT_COMPOSE

/**
 * The Compose file a deploy from the app signs, read when `d` was pressed:
 * its text and path, how the missing-values list names it, the app it
 * deploys, and whether it comes from an accepted zekno.json (then "remember
 * this folder?" is never asked). `elsewhere`: that zekno.json names another
 * app or server than the one it would deploy to, so it is asked first.
 */
type Source = { read: ComposeText; named: string; app: string; linked: boolean; elsewhere?: { server: string; app: string } }

/** Deploys and rollbacks, one at a time, and the deploy that waits on a question. */
export function createDeploys(context: Context) {
  const { deps, dispatch, fail, ops, trustKnown, notice, refresh } = context

  /**
   * One deploy at a time. The reducer already ignores `d` and `r` while a
   * deploy runs; this also covers the moment before it has started, so two
   * deploys are never signed side by side from the same history.
   */
  let deploying = false

  /**
   * The deploy from the app that waits on a question: "remember this
   * folder?" (`link`), the values the Compose file expects (`values`), or
   * whether to deploy a linked folder to the app selected instead of its own
   * (`elsewhere`). Its answer comes back as `deploy-continue` for the same
   * server and app. Only names and the Compose file's text are kept while the
   * question is open, never the team or its key: the text that was read when
   * `d` was pressed is the text whose names were listed and the text that is
   * signed, and the file is not read again.
   */
  let waiting: { server: string; app: string; on: "link" | "values" | "elsewhere"; source: Source } | undefined
  /** "n" to "remember this folder?": it is not asked again while the app is open. */
  let linkSkipped = false

  /**
   * The servers of the profile: as last verified in this run, or, before
   * that, as the profile stands. Only used to tell a first deploy from a
   * later one and whether a zekno.json names a connected server: the deploy
   * itself verifies everything before it signs.
   */
  function serversOnRecord(): readonly Server[] {
    if (context.known) return context.known.servers
    try {
      return profileStore(deps.home).load().servers
    } catch {
      return []
    }
  }

  /** The apps this machine has a deploy on record for, on the server of that name. */
  function appsDeployedTo(server: string): string[] {
    const entry = serversOnRecord().find((item) => item.name === server)
    return entry ? appNames(deps.home, entry) : []
  }

  /**
   * Where a deploy from the app takes its service definition, read once
   * (compose-read.ts): the Compose file the zekno.json that applies here
   * names, or compose.yaml in the folder the app was started in. Either must
   * stay inside its folder. Undefined, with a line saying why, when `d`
   * deploys nothing:
   *
   * - the zekno.json is not signed by the team: it is never used, and no
   *   other is offered in its place;
   * - it is signed by the team and was not used here: the answer when the
   *   app opened was not "yes", and it is not used until the app opens here
   *   again and asks;
   * - it names a server that is not connected: it supplies nothing;
   * - it names another server, and the selected server has no apps: there
   *   is no app to deploy it to;
   * - there is no Compose file, or no app is selected in a folder that is
   *   not linked.
   *
   * A linked folder deploys to its own app on its own server at once, and on
   * its own server with no apps too. On its own server, an app the folder is
   * linked to that has never been deployed there cannot be selected, so `d`
   * deploys it whichever row is marked: a first deploy, no other app is
   * replaced. With any other app selected, its own server's or another's,
   * the source says so (`elsewhere`), and `plan` asks before anything is
   * signed (the question the maintainer approved on 2026-11-14).
   */
  function composeOf(server: string, selected: string | undefined, trust: TeamTrust | undefined): Source | undefined {
    const link = findProject(ops.cwd)
    if (link) {
      // Judged again as it is now: the file may have changed since the app opened. Without a team list to judge it by, it is not the team's.
      const standing: Standing = trust ? standingOf(link, trust, deps.home) : { kind: "unsigned" }
      if (standing.kind === "unsigned") {
        notice("error", notSignedHere(link, ops.cwd))
        return undefined
      }
      if (standing.kind === "new") {
        notice("info", NOT_IN_USE)
        return undefined
      }
      const named = sanitize(link.compose)
      const own = link.server === server
      const first = own && !appsDeployedTo(server).includes(link.app)
      if (own && (selected === undefined || selected === link.app || first)) {
        return { read: readCompose({ kind: "project", link }), named, app: link.app, linked: true }
      }
      if (!serversOnRecord().some((entry) => entry.name === link.server)) {
        notice("error", notConnected(link))
        return undefined
      }
      if (selected === undefined) {
        notice("info", linkedElsewhere(link))
        return undefined
      }
      return { read: readCompose({ kind: "project", link }), named, app: selected, linked: true, elsewhere: { server: link.server, app: link.app } }
    }
    if (!existsSync(resolve(ops.cwd, COMPOSE_FILE))) {
      notice("error", `There is no ${COMPOSE_FILE} in ${shownPath(ops.cwd)}, and no zekno.json names another. Run zekno link -f <file> here to name one.`)
      return undefined
    }
    if (selected === undefined) {
      notice("info", `Choose an app first. To deploy a new app, run zekno link --app <name> --server ${server} in its folder.`)
      return undefined
    }
    return { read: readCompose({ kind: "default", folder: ops.cwd }), named: COMPOSE_FILE, app: selected, linked: false }
  }

  /**
   * Checks a deploy or rollback on this machine, or says why it cannot go
   * ahead. A deploy of a folder that is not linked first asks whether to
   * remember it (board "Two questions the app asks"); one of a linked folder
   * to another app than its own first asks whether to deploy it there all
   * the same; then the values its Compose file expects that have no secret
   * are listed (board "Set a secret"). Each question ends this plan, before
   * the keychain is read (this folder's zekno.json is judged against the
   * team list verified when the app opened); its answer starts the next part
   * (`after`), with everything checked again.
   */
  async function plan(
    effect: Extract<Effect, { kind: "deploy" | "rollback" }>,
    after?: NonNullable<typeof waiting>
  ): Promise<(DeployPlan & { from: string }) | undefined> {
    if (effect.kind === "rollback") {
      const to = effect.to === undefined ? undefined : String(effect.to)
      const rollback = await prepareRollback(ops, { app: effect.app, server: effect.server, to }, { warning: (text) => notice("warning", text) })
      return { ...rollback, from: `what deploy ${rollback.from} ran` }
    }
    // After a question, the Compose file read when `d` was pressed: not read again. A team list already
    // verified is used without awaiting anything; otherwise it is verified now, only when a zekno.json applies.
    let source = after?.source
    if (!source) {
      const trust = trustKnown() ?? (findProject(ops.cwd) === undefined ? undefined : (await openTeam(ops)).trust)
      source = composeOf(effect.server, effect.app, trust)
    }
    if (!source) return undefined
    // On a server with no apps yet, `d` deploys the app the folder is linked to, when that server is the folder's.
    const app = source.app
    if (!source.linked && after === undefined && !linkSkipped) {
      waiting = { server: effect.server, app, on: "link", source }
      dispatch({ type: "ask-remember-folder", server: effect.server, app, compose: COMPOSE_FILE })
      return undefined
    }
    // Only `y` deploys a linked folder to another app; zekno.json itself is left as it is.
    if (source.elsewhere && after === undefined) {
      waiting = { server: effect.server, app, on: "elsewhere", source }
      dispatch({ type: "ask-deploy-elsewhere", server: effect.server, app, linked: source.elsewhere })
      return undefined
    }
    const planned = await prepareDeploy(ops, { app, server: effect.server, read: source.read })
    if (after?.on !== "values") {
      // Names only: the secrets' values are never opened here.
      const set = new Set(secretNamesOf(planned.team, planned.server, app))
      const missing = expectedValues(planned.compose).filter((name) => !set.has(name))
      if (missing.length > 0) {
        waiting = { server: planned.server.name, app, on: "values", source }
        dispatch({ type: "missing-values", server: planned.server.name, app, names: missing, file: source.named })
        return undefined
      }
    }
    return { ...planned, from: shownPath(source.read.path) }
  }

  /**
   * Goes on with the deploy that waited on a question, with its answer: for
   * "remember this folder?", zekno.json is written (never over an existing
   * one) or not; for the missing values, they were set or skipped; for a
   * linked folder and another app, it is deployed there. An answer nothing
   * waits for is ignored.
   */
  async function goOn(effect: Extract<Effect, { kind: "deploy-continue" }>): Promise<void> {
    const asked = waiting
    if (!asked || asked.server !== effect.server || asked.app !== effect.app) return
    const about =
      effect.answer === "write-link" || effect.answer === "skip-link" ? "link" : effect.answer === "deploy-elsewhere" ? "elsewhere" : "values"
    if (asked.on !== about) return
    waiting = undefined
    if (effect.answer === "write-link") {
      // Written by a "yes" here: signed with this member's key, and recorded as used here (accepted.ts).
      await writeLink(deps.home, await openTeam(ops), ops.cwd, { app: effect.app, server: effect.server, compose: COMPOSE_FILE })
      dispatch({ type: "linked", linked: { server: effect.server, app: effect.app, compose: COMPOSE_FILE } })
    }
    if (effect.answer === "skip-link") linkSkipped = true
    await deploy({ kind: "deploy", server: effect.server, app: effect.app }, asked)
  }

  /** Signs and sends a deploy, with its stages and Docker's lines as events, and its result as a line wherever the person is. */
  async function deploy(effect: Extract<Effect, { kind: "deploy" | "rollback" }>, after?: NonNullable<typeof waiting>): Promise<void> {
    if (deploying) return notice("info", "A deploy is already in progress.")
    deploying = true
    try {
      const planned = await plan(effect, after)
      if (!planned) return
      const { team, server, app } = planned
      const started = Date.now()
      dispatch({
        type: "deploy-started",
        server: server.name,
        app,
        at: started,
        from: planned.from,
        replaces: latestAccepted(team, server, app),
        secretNames: secretNamesOf(team, server, app),
      })
      // Docker's lines are drawn in batches, and past `DEPLOY_LINES` waiting the runner is read no further until they are.
      const lines = batcher<string>(DEPLOY_LINES, (taken) => dispatch({ type: "deploy-progress", lines: taken }))
      let result
      try {
        result = await sendDeploy(ops, planned, {
          stage: (stage, info) => dispatch({ type: "deploy-stage", stage, sequence: info.sequence, secrets: info.secrets }),
          progress: (line) => lines.add(line),
          warning: (text) => notice("warning", text),
        })
      } catch (error) {
        lines.flush()
        const reason = reasonOf(error)
        if (reason === undefined) return fail(error)
        dispatch({ type: "deploy-ended", outcome: "error", notice: { tone: "error", text: reason }, at: Date.now() })
        return refresh(team, server, app)
      }
      lines.flush()
      const ended = Date.now()
      const text =
        result.outcome === "started"
          ? `${app} is live on ${server.name} in ${seconds(ended - started)}`
          : `${server.name} accepted deploy ${result.sequence}, but the app did not start.`
      dispatch({ type: "deploy-ended", outcome: result.outcome, notice: { tone: result.outcome === "started" ? "success" : "error", text }, at: ended })
      dispatch({ type: "server-reached", server: server.name, reachable: true })
      refresh(team, server, app)
    } finally {
      deploying = false
    }
  }

  return { deploy, goOn }
}
