/**
 * What `zekno domain add` and `zekno domain rm` do (specs/015-domains-https,
 * contracts/cli.md, CL2; research R31): data only, nothing drawn and nothing
 * asked. They follow `zekno settings set` step for step (ops/settings.ts):
 * the file a deploy here would sign, read once with the reader's every check;
 * the new list of the service's domains, changed and checked whole by
 * `applyChange` as `<service>.domains` is; written by `writeSettingChange`.
 * Neither needs a team nor contacts a server, and nothing is deployed.
 *
 * Every refusal comes before anything is shown, with status 2 (`WrongInput`):
 * A10 and A11 for a name the domain rule refuses, A12 for a service with no
 * port, A13 for a domain the file has already, A14 for a folder that deploys
 * a Compose file written by hand, A15 for `rm` of one it lacks. No settings
 * file is SH1, as for `zekno settings set` (status 1).
 *
 * After a domain is added, the record to create (A5) names the server's
 * public address: of the server this folder is linked to, when this machine
 * knows it (CL5). Not known, it is A6.
 */
import { reach, teamOf, type OpDeps, type Team } from "../cli/context"
import { CliError, UsageError, WrongInput } from "../cli/errors"
import { recordOf, serverAddresses } from "../domains/address"
import { lookUp } from "../domains/dns"
import type { HttpsAnswer } from "../domains/https"
import { domainRefusal, lowered } from "../domains/rule"
import { domainState, type DomainShown } from "../domains/state"
import { A12, A13, A14, A15, D7, SAY_WHICH_DOMAIN } from "../domains/words"
import type { RecordType } from "../domains/words"
import { NOT_LINKED_HERE, notAsked } from "../domains/words-extra"
import { findServer, profileStore, type Server } from "../profile/profile"
import { namedUnreachable, withSession } from "../server/session"
import { atMost } from "../shared/at-most"
import { RUNNER_RELEASE } from "../version/runner-release"
import type { Where } from "./deploy"
import { LOOKUPS_AT_ONCE } from "./deploy-domains"
import { runnerRelation, runnerWarning } from "./server"
import {
  askStatus,
  checkIdentity,
  routesOfApp,
  type HeldRoutes,
} from "./status"
import { applyChange } from "../settings/change"
import { namedPath } from "../settings/source"
import type { Settings } from "../settings/types"
import { checkServiceName } from "../settings/values"
import { CS4, SH1, SH3 } from "../settings/words"
import {
  aboveOf,
  findPlace,
  linkInUse,
  refuseLink,
  type SettingPlan,
} from "./settings"

/** `add` or `rm`, as the command is named. */
export type DomainVerb = "add" | "rm"

/** The domain typed, lowered and held to the domain rule (CL2): the usage line when none was typed, A10 or A11. */
export function typedDomain(
  typed: string | undefined,
  verb: DomainVerb
): string {
  if (typed === undefined || typed === "")
    throw new UsageError(SAY_WHICH_DOMAIN(verb))
  const refused = domainRefusal(typed)
  if (refused !== undefined) throw new WrongInput(refused)
  return lowered(typed)
}

/** The settings file a deploy here would sign, read once: SH1 with none, A14 for a Compose file written by hand, SH3 when one is used though zekno.app.json lies here. */
export function domainsFile(
  deps: Pick<OpDeps, "cwd" | "home">
): Pick<SettingPlan, "read" | "named" | "both"> {
  const found = findPlace(deps)
  if (found.kind === "none") throw new CliError(SH1)
  if (found.kind === "compose") {
    // A zekno.app.json lies here and the deploy uses another file: SH3, as `zekno settings set` says it, since
    // A14's `zekno settings init` would find the file there already.
    if (found.settingsHere)
      throw new CliError(SH3(found.file, aboveOf(deps.cwd, found.link)))
    throw new WrongInput(A14)
  }
  return {
    read: found.read,
    named: namedPath(found.place.source),
    both: found.place.both,
  }
}

/** The service of the file that names `domain` among its domains, or undefined. */
export const holderOf = (
  settings: Settings,
  domain: string
): string | undefined =>
  settings.services.find(([, service]) =>
    service.domains?.includes(domain)
  )?.[0]

/**
 * The service a domain is added to (CL2): `--service`, which must be one of
 * the file's (CS4) and have a port (A12); else the only service with a port;
 * else, with none, A12 for the file's first service. With several, the
 * services with a port to ask among (A7), in the file's order.
 */
export function serviceFor(
  settings: Settings,
  file: string,
  wanted: string | undefined
): { service: string } | { ask: string[] } {
  const services = settings.services
  if (wanted !== undefined) {
    const found = services.find(([name]) => name === wanted)
    // CS4, as `zekno settings set` says it: the name is repeated only when it passed the service-name rule.
    if (found === undefined)
      throw new WrongInput(
        CS4(
          file,
          checkServiceName(wanted) === undefined ? wanted : undefined,
          services.map(([name]) => name)
        )
      )
    if (found[1].port === undefined) throw new WrongInput(A12(wanted))
    return { service: wanted }
  }
  const ported = services
    .filter(([, service]) => service.port !== undefined)
    .map(([name]) => name)
  if (ported.length === 1) return { service: ported[0]! }
  if (ported.length === 0) throw new WrongInput(A12(services[0]![0]))
  return { ask: ported }
}

/** A change of one service's domains, checked and not yet written: the plan of `zekno settings set` and the lists before and after. */
export type DomainPlan = SettingPlan & {
  domain: string
  service: string
  now: readonly string[]
  next: readonly string[]
}

/**
 * The service's domains with `domain` added last, or taken out, checked
 * whole as `zekno settings set <service>.domains` checks them (CS17 for a
 * rule of the file, such as more than 64 domains). A file that is a symbolic
 * link is refused here (CS13), before anything is asked.
 */
export function domainChange(
  file: Pick<SettingPlan, "read" | "named" | "both">,
  service: string,
  domain: string,
  verb: DomainVerb
): DomainPlan {
  const { settings } = file.read
  const now =
    settings.services.find(([name]) => name === service)?.[1].domains ?? []
  const next =
    verb === "add" ? [...now, domain] : now.filter((each) => each !== domain)
  const change = applyChange(
    settings,
    { service, key: "domains" },
    next.length === 0 ? undefined : next.join(", "),
    file.read.shown
  )
  // A domain already in the file (A13) or not in it (A15) is refused before this, so every change here writes something;
  // what is left to refuse is a rule of the file, with status 2.
  if ("refused" in change) throw new WrongInput(change.refused)
  refuseLink(file.named, file.read)
  return { ...file, change, domain, service, now, next }
}

/** The checks of `add` up to the question of which service, in CL2's order: the domain, the file, A13. */
export function prepareAdd(
  deps: Pick<OpDeps, "cwd" | "home">,
  typed: string | undefined
): { domain: string; file: Pick<SettingPlan, "read" | "named" | "both"> } {
  const domain = typedDomain(typed, "add")
  const file = domainsFile(deps)
  const holder = holderOf(file.read.settings, domain)
  if (holder !== undefined) throw new WrongInput(A13(domain, holder))
  return { domain, file }
}

/** `rm` up to the question: the domain, the file, A15, and the change. */
export function prepareRemove(
  deps: Pick<OpDeps, "cwd" | "home">,
  typed: string | undefined
): DomainPlan {
  const domain = typedDomain(typed, "rm")
  const file = domainsFile(deps)
  const holder = holderOf(file.read.settings, domain)
  if (holder === undefined) throw new WrongInput(A15(domain))
  return domainChange(file, holder, domain, "rm")
}

/**
 * The record a domain needs (CL2, after A4): of the server this folder is
 * linked to, when the folder is linked and this machine knows the server,
 * the record of its public address (A5); else the server's name, or none
 * when the folder is not linked (A6, "your server"). Reads the profile's
 * list of servers, never the keychain.
 */
export async function recordFor(
  deps: Pick<OpDeps, "cwd" | "home" | "sshHost">
): Promise<
  { record: { type: RecordType; address: string } } | { server?: string }
> {
  let link
  try {
    link = linkInUse(deps)
  } catch {
    return {}
  }
  if (link === undefined) return {}
  let target
  try {
    target = findServer(profileStore(deps.home).load(), link.server).target
  } catch {
    return { server: link.server }
  }
  const record = recordOf(await serverAddresses(deps.sshHost, target))
  return record === undefined ? { server: link.server } : { record }
}

/** One row of `zekno domain` (CL4): the domain, the service and port it reaches, and its state. */
export type DomainRow = {
  domain: string
  service: string
  port: number
} & DomainShown

/** `zekno domain`'s list: the app, its server, a row a domain, and the warning about the server when it was not asked. */
export type DomainList = {
  app: string
  server: string
  rows: DomainRow[]
  warning?: string
}

/** What the server said of the routes, or, not asked, the warning about it (CL4). */
type Asked = { held: HeldRoutes } | { held?: undefined; warning?: string }

/**
 * Asks the server for its routes in force (`status` with routes), on a
 * session of its own, checking it is the server that was connected. Not
 * asked: it could not be reached, or its runner is older than protocol 4;
 * the warning is what `zekno status` says of it then.
 */
async function askRoutes(
  deps: OpDeps,
  team: Team,
  server: Server
): Promise<Asked> {
  try {
    return await withSession(reach(deps, server.target), async (session) => {
      const { status, held } = await askStatus(session, true)
      checkIdentity(team, server, status)
      if (held !== undefined) return { held }
      const carried = (deps.release ?? RUNNER_RELEASE).version
      const relation = runnerRelation(session.mode, session.runner, carried)
      const warning = runnerWarning(
        server.name,
        session.runner?.version,
        relation,
        carried
      )
      return warning === undefined ? {} : { warning }
    })
  } catch (error) {
    const named = namedUnreachable(error, server.name)
    if (named instanceof CliError) return { warning: named.message }
    throw error
  }
}

/**
 * `zekno domain` (CL4): one row a domain of the folder's settings file and
 * of the server's routes for its app, in domain order, each with the first
 * state that holds (domains/state.ts). The server is asked once; where DNS
 * points and what HTTPS answers are asked from this machine, at most eight
 * domains at a time, and only for a domain the server holds for the app and
 * the file still has. A server not asked shows the file's rows as not
 * deployed, `prod-1 was not asked`, with its warning.
 */
export async function listDomains(
  deps: OpDeps,
  where: Where,
  now: () => Date = () => new Date()
): Promise<DomainList> {
  const file = domainsFile(deps)
  if (where.app === undefined || where.server === undefined)
    throw new CliError(NOT_LINKED_HERE)
  const app = where.app
  const team = await teamOf(deps)
  const server = findServer(team.profile, where.server, where.serverFrom)
  const inFile = new Map<string, { service: string; port: number }>()
  for (const [service, each] of file.read.settings.services)
    for (const domain of each.domains ?? [])
      if (each.port !== undefined)
        inFile.set(domain, { service, port: each.port })

  const asked = await askRoutes(deps, team, server)
  if (asked.held === undefined) {
    const rows = [...inFile.entries()]
      .sort(([a], [b]) => byText(a, b))
      .map(([domain, goes]) => ({
        domain,
        ...goes,
        state: "not-deployed" as const,
        words: { state: D7.state, detail: notAsked(server.name) },
      }))
    return {
      app,
      server: server.name,
      rows,
      ...(asked.warning === undefined ? {} : { warning: asked.warning }),
    }
  }

  const ours = routesOfApp(asked.held, app)
  const holders = new Map<string, string>()
  for (const [holder, routes] of Object.entries(asked.held.routes))
    if (holder !== app)
      for (const route of routes) holders.set(route.domain, holder)
  const reaches = new Map(inFile)
  for (const route of ours)
    if (!reaches.has(route.domain))
      reaches.set(route.domain, { service: route.service, port: route.port })
  const held = new Set(ours.map((route) => route.domain))
  const domains = [...reaches.keys()].sort(byText)
  // Looked up only where a state needs it: a domain the server holds for this app that the file still has.
  const asking = domains.filter(
    (domain) => held.has(domain) && inFile.has(domain) && !holders.has(domain)
  )
  const addresses =
    asking.length === 0
      ? undefined
      : await serverAddresses(deps.sshHost, server.target)
  const found = await atMost(LOOKUPS_AT_ONCE, asking, async (domain) => {
    const [dns, https] = await Promise.all([
      lookUp(deps.resolveDomain, domain),
      deps.probeHttps === undefined
        ? undefined
        : deps.probeHttps(domain).catch((): HttpsAnswer => ({ state: "none" })),
    ])
    return [domain, { dns, https }] as const
  })
  const facts = new Map(found)
  const rows = domains.map((domain): DomainRow => {
    const seen = facts.get(domain)
    return {
      domain,
      ...reaches.get(domain)!,
      ...domainState(
        {
          inFile: inFile.has(domain),
          held: held.has(domain),
          takenBy: holders.get(domain),
          dns: seen?.dns,
          addresses,
          https: seen?.https,
        },
        server.name,
        now()
      ),
    }
  })
  return { app, server: server.name, rows }
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
