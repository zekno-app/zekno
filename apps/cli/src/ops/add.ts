/**
 * What `zekno add` reads and checks before it asks (specs/012-templates,
 * contracts/commands.md, "The order of checks", steps 3 to 12; data-model.md,
 * "What `zekno add` prepares, and commits"; research R8): data only, nothing
 * drawn and nothing asked.
 *
 * Nothing here writes a file, makes a value or contacts anything: the
 * template comes from the CLI's own catalogue, the server from the profile,
 * the settings file is read once with every check of its reader (the one a
 * deploy here would sign, by `findPlace`), the team is opened as `zekno
 * secret set` opens it (the keychain read once, for the run), and the app's
 * secret store is read once and kept, to be compared before it is written
 * (research R7). Writing is ops/add-commit.ts.
 */
import { currentSecrets, LIMITS } from "@workspace/core"

import { teamOf, type OpDeps, type Team } from "../cli/context"
import { CliError, WrongInput } from "../cli/errors"
import {
  findServer,
  profileStore,
  type SecretStore,
  type Server,
} from "../profile/profile"
import { sanitize } from "../server/sanitize"
import { namedPath } from "../settings/source"
import type { SettingsRead } from "../settings/types"
import { checkServiceName } from "../settings/values"
import { SH2, SH3 } from "../settings/words"
import { planAddition } from "../templates/addition"
import {
  AD1,
  AD13,
  AD24,
  AD25,
  AD28,
  AD5,
  AL3,
  AL4,
  AU8,
  AU9,
} from "../templates/add-words"
import {
  askingTemplates,
  catalogue,
  findTemplate,
  TEMPLATE_TEXTS,
} from "../templates/catalogue"
import { TEMPLATE_NAME } from "../templates/shape"
import { additionReport } from "../templates/shown"
import type {
  AddDone,
  Addition,
  AdditionReport,
  Template,
} from "../templates/types"
import { checkApp, type Where } from "./deploy"
import { latestVersions } from "./secret"
import { aboveOf, findPlace } from "./settings"

export type { AddDone }

/** Where the template goes: the settings file a deploy here would sign, read whole (`named`: where its folder names it; `both`: compose.yaml beside it). */
export type AddTarget = {
  kind: "settings"
  read: SettingsRead
  named: string
  both: boolean
}

/** Everything read and checked up to the readers of the connection secrets. Holds no secret value. */
type Prepared = {
  target: AddTarget
  template: Template
  /** `--name`, held to the service-name rule. */
  name?: string
  team: Team
  server: Server
  app: string
  /** The app's secret store as read, compared again before it is written (research R7). */
  store: SecretStore
  /** The version each secret will get: the highest this machine has seen for its name, plus one. */
  versions: ReadonlyMap<string, number>
}

/** Everything read and checked up to the question (data-model.md, `AddPlan`). Holds no secret value. */
export type AddPlan = Prepared & { addition: Addition }

/** The connection secrets whose readers the person chooses (AD10), with all the rest read and checked. */
export type AddQuestion = Prepared & {
  ask: readonly { offer: string; services: readonly string[] }[]
}

/** What `prepareAdd` is given: the template, `--name`, `--for`, and the app and server, or how to find them once the file was read. */
export type AddInput = {
  template: Template
  name?: string
  for?: readonly string[]
  /** The flags and the folder's link, or, at a terminal, the questions that ask for what is missing, asked only after the file was read. */
  where: Where | (() => Promise<Where>)
}

/**
 * Step 3: the template a person named, from this zekno's own catalogue
 * (`texts` but in tests), and `--name`, checked before anything is read or
 * asked: AL4 for a name that is no template's name (not repeated); AD27 for
 * a catalogue that does not pass its own checks (status 1); AD28 for a
 * template that asks a question; AL3, pointing at the template whose other
 * names hold it, or at the list; then AU8 for a `--name` that is no service
 * name, AU9 for a `--name` given to a template of several services.
 */
export function checkTemplate(
  name: string,
  nameFlag: string | undefined,
  texts: readonly (readonly [file: string, text: string])[] = TEMPLATE_TEXTS
): Template {
  if (!TEMPLATE_NAME.test(name)) throw new WrongInput(AL4)
  const list = catalogue(texts)
  if (askingTemplates(texts).includes(name)) throw new WrongInput(AD28(name))
  const found = findTemplate(name, list)
  if (found === undefined) throw new WrongInput(AL3(name))
  // A template has `also` too: what is not one is the pointer to the template whose other names hold it.
  if (!("services" in found)) throw new WrongInput(AL3(name, found.also))
  checkName(found, nameFlag)
  return found
}

/** AU8 and AU9 for `--name` given to `template`: also for one picked from the list. */
export function checkName(
  template: Template,
  nameFlag: string | undefined
): void {
  if (nameFlag === undefined) return
  if (checkServiceName(nameFlag) !== undefined) throw new WrongInput(AU8)
  if (template.services.length > 1) throw new WrongInput(AU9(template.name))
}

/**
 * Step 4, AD1: a secret is sealed for a server, so with no profile, or one
 * with no server, there is nothing to seal for. Said before anything is
 * asked or read: the profile only, never the keychain.
 */
export function hasServer(deps: Pick<OpDeps, "home">): void {
  const store = profileStore(deps.home)
  if (!store.exists() || store.load().servers.length === 0)
    throw new WrongInput(AD1)
}

/**
 * Step 6: the file a deploy here would sign (research R8): a settings file,
 * read once and checked whole (the reader's sentences, status 1); none is
 * AD13. SH4 as the settings commands say it. A Compose file written by hand
 * is said as `zekno settings` says it until `zekno add` gives its lines
 * (specs/012-templates, tasks T048).
 */
function targetOf(deps: Pick<OpDeps, "cwd" | "home">): AddTarget {
  const found = findPlace(deps)
  if (found.kind === "none") throw new CliError(AD13)
  if (found.kind === "compose")
    throw new CliError(
      found.settingsHere
        ? SH3(found.file, aboveOf(deps.cwd, found.link))
        : SH2(found.file)
    )
  return {
    kind: "settings",
    read: found.read,
    named: namedPath(found.place.source),
    both: found.place.both,
  }
}

/** The names a template stores, in its order: the made secrets, then the connection secrets. */
export const storedNames = (template: Template): string[] => [
  ...template.makes.map((made) => made.name),
  ...template.offers.map((offer) => offer.name),
]

/**
 * Step 8: the app's secret store, read once. AD25 when it holds more
 * records than are ever read already; AD5 for the first of the template's
 * names that is a secret of the app now (the template is added once to an
 * app, D28); AD24 when the app would have more secrets than a deploy
 * carries; AD25 when its records would pass the limit. The next version of
 * each name.
 */
function checkStore(
  team: Team,
  server: Server,
  app: string,
  template: Template
): { store: SecretStore; versions: Map<string, number> } {
  const store = team.store.secrets(server.serverId, app)
  const names = storedNames(template)
  const records = store.records.length + store.removals.length
  // Past this limit `currentSecrets` would refuse the store whole.
  if (records > LIMITS.secretHistory) throw new CliError(AD25(app, server.name))
  const current = new Set(
    currentSecrets({
      trust: team.trust,
      serverId: server.serverId,
      app,
      ...store,
    }).secrets.map((record) => record.sealed.name)
  )
  const there = names.find((name) => current.has(name))
  if (there !== undefined) throw new WrongInput(AD5(app, there))
  if (current.size + names.length > LIMITS.secretsPerDeploy)
    throw new CliError(AD24(app, server.name))
  if (records + names.length > LIMITS.secretHistory)
    throw new CliError(AD25(app, server.name))
  const latest = latestVersions(team.trust, server.serverId, app, store)
  return {
    store,
    versions: new Map(names.map((name) => [name, (latest.get(name) ?? 0) + 1])),
  }
}

/** Steps 9 to 12 on what was prepared: the addition, or the question; a refusal is `WrongInput` (status 2). */
function planned(
  prepared: Prepared,
  readers?: readonly string[] | ReadonlyMap<string, readonly string[]>
): AddPlan | AddQuestion {
  const plan = planAddition({
    template: prepared.template,
    settings: prepared.target.read.settings,
    file: prepared.target.read.shown,
    ...(prepared.name === undefined ? {} : { name: prepared.name }),
    ...(readers === undefined ? {} : { readers }),
  })
  if ("sentence" in plan) throw new WrongInput(plan.sentence)
  if ("ask" in plan) return { ...prepared, ask: plan.ask }
  return { ...prepared, addition: plan }
}

/**
 * Steps 6 to 12 of contracts/commands.md, "The order of checks", once the
 * template, `--name` (`checkTemplate`) and a server (`hasServer`) were
 * checked: the file, the app and the server (asked for only now, at a
 * terminal), the store, then the addition. A plan to show and commit, or the
 * question of who reads the connection secrets (`withReaders` once it is
 * answered). Refusals of status 2 are `WrongInput`, of status 1 `CliError`;
 * a missing app or server is the sentence the other commands say.
 */
export async function prepareAdd(
  deps: OpDeps,
  input: AddInput
): Promise<AddPlan | AddQuestion> {
  const target = targetOf(deps)
  const where =
    typeof input.where === "function" ? await input.where() : input.where
  const team = await teamOf(deps)
  const server = findServer(team.profile, where.server, where.serverFrom)
  const app = checkApp(where.app)
  const { store, versions } = checkStore(team, server, app, input.template)
  return planned(
    {
      target,
      template: input.template,
      ...(input.name === undefined ? {} : { name: input.name }),
      team,
      server,
      app,
      store,
      versions,
    },
    input.for
  )
}

/** The plan once the question is answered: the services that read each connection secret. AD7 and AD15 as before it. */
export function withReaders(
  question: AddQuestion,
  readers: ReadonlyMap<string, readonly string[]>
): AddPlan {
  const { ask: _ask, ...prepared } = question
  const plan = planned(prepared, readers)
  if (!("addition" in plan))
    throw new Error("Every connection secret was given its readers.")
  return plan
}

/** Where a server is, as a person reads it: `deploy@203.0.113.7`, or `this machine`. */
export const serverWhere = (server: Server): string =>
  server.target.kind === "ssh"
    ? sanitize(server.target.destination)
    : "this machine"

/** The summary before the question (board `AddTemplate`): names and fixed words only. */
export const summaryOf = (plan: AddPlan): AdditionReport =>
  additionReport({
    addition: plan.addition,
    app: plan.app,
    server: { name: plan.server.name, where: serverWhere(plan.server) },
    file: plan.target.read.shown,
    services: plan.target.read.settings.services.map(([name]) => name),
  })
