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
import type { OpDeps } from "../cli/context"
import { CliError, UsageError, WrongInput } from "../cli/errors"
import { recordOf, serverAddresses } from "../domains/address"
import { domainRefusal, lowered } from "../domains/rule"
import { A12, A13, A14, A15, SAY_WHICH_DOMAIN } from "../domains/words"
import type { RecordType } from "../domains/words"
import { findServer, profileStore } from "../profile/profile"
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
