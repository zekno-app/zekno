/**
 * Every line of feature 015, domains and HTTPS (specs/015-domains-https,
 * design/lines.md, parts A to E; contracts/cli.md), each with its id. The
 * maintainer approved them on 2026-11-19 and they are used word for word;
 * test/domains/words.test.ts pins each one. A command is in backticks where
 * lines.md puts it there: a terminal drops backticks and draws the first
 * sentence bold, plain output prints the text as it is. Where a line has a
 * mark or a dim part, the words come apart (`text` and `detail`) and whoever
 * draws them adds the mark.
 *
 * A sentence is given only names that passed their rule (a domain lowered and
 * held to the domain rule, a service, an app, a server), an address, a
 * number or a date: never a piece of a file. The two refusals that name what
 * a person typed (A10, A11) are given it cleaned (domains/rule.ts).
 *
 * This file imports nothing of zekno's: settings/ and cli/ build on it.
 */

/** The last sentence of every stop before signing. */
const NOTHING_SIGNED = "Nothing was signed."

/** Two sentences of a refusal, as one text: a terminal draws the first bold and the rest dim below it. */
const two = (first: string, second: string): string => `${first} ${second}`

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

/** A certificate's last day as B5 and D1 write it, `17 Feb 2027`, by the UTC calendar a certificate's time is in. */
export const dayShown = (day: Date): string =>
  `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]!} ${day.getUTCFullYear()}`

/** The same without the year, as D2 writes it: `21 Nov`. */
export const dayMonthShown = (day: Date): string =>
  `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]!}`

// A. `zekno domain add` and `zekno domain rm`.

/** The label of the domains in the change line (A1, A2, A8) and of their rows (E1, E6). */
export const DOMAINS_LABEL = "domains"

/** A list of domains as the change line and a row read it: `shop.example.com, www.example.com`, or `none` (A1, A8, E1). */
export const domainsShown = (domains: readonly string[]): string =>
  domains.length === 0 ? "none" : domains.join(", ")

/** A1, A2, A8: the change line, `web · domains  none → shop.example.com`, as plain output prints it. */
export const changeLine = (
  svc: string,
  now: readonly string[],
  next: readonly string[]
): string =>
  `${svc} · ${DOMAINS_LABEL}  ${domainsShown(now)} → ${domainsShown(next)}`

/** A3, today's question (settings/words.ts, CS9): the file is the settings file written. */
export const A3 = (file: string): string =>
  `Write this to ${file}? Nothing is deployed until you deploy.`

/** A4, today's result (CS11): its text and its dim detail. */
export const A4 = { text: "Written", detail: "Run zekno deploy to use it." }

/** A5: the record to create, after A4. `first` is a line of its own; `record` the next line, its type `A` or `AAAA`. */
export const A5 = {
  first: "Before you deploy, create this DNS record at your DNS provider:",
  record: (type: RecordType, domain: string, address: string): string =>
    `${type}  ${domain}  ${address}`,
}

/** A DNS record's type: `A` for an IPv4 address, `AAAA` for an IPv6 one. */
export type RecordType = "A" | "AAAA"

/** A5 with no terminal (contracts/cli.md, CL2): `record<TAB>A<TAB>shop.example.com<TAB>203.0.113.7`. */
export const recordPlain = (
  type: RecordType,
  domain: string,
  address: string
): string => ["record", type, domain, address].join("\t")

/** A6: the server's public address is not known. `server` undefined: the folder is not linked, so `your server`. */
export const A6 = (domain: string, server?: string): string =>
  `Before you deploy, point ${domain} at the public address of ${server ?? "your server"} at your DNS provider.`

/** A7: the question, when several services have a port; the list under it is those services. */
export const A7 = (domain: string): string =>
  `Which service answers for ${domain}?`

/** A7's word for the line left behind once a service is chosen. */
export const A7_COLLAPSED = "Service"

/** A9: written, after a removal: its text and its dim detail. */
export const A9 = { text: "Written", detail: "Run zekno deploy to release it." }

/** A10: not a name zekno routes (a wildcard, an address, `localhost`, a port, a path, a special-use name). */
export const A10 = (domain: string): string =>
  two(`${domain} is not a domain zekno can route.`, A10_RULE)

/** A10's second sentence, alone: also the rule of a domain refused where the settings file is read. */
export const A10_RULE =
  "Use a full name such as shop.example.com: no wildcard, no address, no port."

/** A11: letters outside ASCII, in either spelling (decided, point 8). */
export const A11 = (domain: string): string =>
  two(`${domain} is not a domain zekno can route yet.`, A11_RULE)

/** A11's second sentence, alone. */
export const A11_RULE =
  "Names with letters other than a to z, digits and the hyphen are not in this version of zekno."

/** A12: the service has no port. */
export const A12 = (svc: string): string =>
  two(
    `${svc} has no port, so a domain cannot reach it.`,
    `Set the port it listens on first: zekno settings set ${svc}.port <port>.`
  )

/** A13: the domain is in the file already, under `svc`. */
export const A13 = (domain: string, svc: string): string =>
  two(
    `${domain} is already a domain of ${svc}.`,
    `A domain reaches one service. Remove it there first: zekno domain rm ${domain}.`
  )

/** A13's first sentence, alone: also the rule of a domain under two services where the settings file is read. */
export const A13_FIRST = (domain: string, svc: string): string =>
  `${domain} is already a domain of ${svc}.`

/** A14: a Compose file written by hand (decided, point 1). */
export const A14 = two(
  "This folder deploys a Compose file written by hand.",
  "Domains need a settings file. Run zekno settings init to start one."
)

/** A15: `rm` of a domain the file does not have. */
export const A15 = (domain: string): string =>
  two(
    `${domain} is not a domain of this app.`,
    "Run zekno domain to see its domains."
  )

/**
 * Said when `zekno domain add` or `rm` is given no domain, with the help
 * line: not on a board, in the pattern of `zekno settings set`'s CS1.
 */
export const SAY_WHICH_DOMAIN = (verb: "add" | "rm"): string =>
  `Say which domain: \`zekno domain ${verb} <domain>\`.`

/** A16: no terminal, several services, no `--service`. */
export const A16 = two(
  "There is no terminal to ask on.",
  "Say which service with --service <name>."
)

// B. `zekno deploy` with a domain.

/** B1: a new domain points to the server, before the panel; the address dim after it. */
export const B1 = (
  domain: string,
  server: string,
  address: string
): { text: string; detail: string } => ({
  text: `${domain} points to ${server}`,
  detail: address,
})

/** B1 with no terminal (contracts/cli.md, CL3): `dns<TAB>shop.example.com<TAB>203.0.113.7`. */
export const dnsPlain = (domain: string, address: string): string =>
  ["dns", domain, address].join("\t")

/** B2: the panel's row, one domain a row; this is its label. */
export const B2_LABEL = DOMAINS_LABEL

/** How many domains the panel shows before B3. */
export const PANEL_DOMAINS = 3

/** B3: after the first three domains, dim. */
export const B3 = (more: number): string => `and ${more} more`

/** B4: while the deploy waits for HTTPS; the seconds dim after it. */
export const B4 = (domain: string): string =>
  `Waiting for the certificate of ${domain}`

/** B5: HTTPS answers with a valid certificate; the detail dim after it. */
export const B5 = (
  domain: string,
  until: Date
): { text: string; detail: string } => ({
  text: `https://${domain} is live`,
  detail: `certificate until ${dayShown(until)}`,
})

/** B5 with no terminal: `https<TAB>shop.example.com<TAB>live<TAB>2027-02-17`. */
export const httpsLivePlain = (domain: string, until: Date): string =>
  ["https", domain, "live", until.toISOString().slice(0, 10)].join("\t")

/** B6: a warning; the deploy started. */
export const B6 = (domain: string): string =>
  `The certificate for ${domain} is not ready yet. Run \`zekno domain\` to see when it is.`

/** B6 with no terminal: `https<TAB>shop.example.com<TAB>waiting`. */
export const httpsWaitingPlain = (domain: string): string =>
  ["https", domain, "waiting"].join("\t")

/** B7: the domain has no record. */
export const B7 = (domain: string, type: RecordType, address: string): string =>
  `${domain} has no DNS record yet. Create an ${type} record for ${domain} with the value ${address}, then run \`zekno deploy\` again. ${NOTHING_SIGNED}`

/** B8: it points elsewhere, to `found` first. */
export const B8 = (
  domain: string,
  found: string,
  server: string,
  type: RecordType,
  address: string
): string =>
  `${domain} points to ${found}, not to ${server}. Change its ${type} record to ${address}, then run \`zekno deploy\` again. If something of yours stands in front of ${server}, deploy with \`--skip-dns-check\`. ${NOTHING_SIGNED}`

/** B9: another app on the server holds it. */
export const B9 = (domain: string, app: string, server: string): string =>
  `${domain} belongs to ${app} on ${server}. Release it there first: run \`zekno domain rm ${domain}\` in ${app}'s folder and deploy ${app}. ${NOTHING_SIGNED}`

/**
 * B10: the runner does not carry out routes. `version` undefined: a runner
 * run one request at a time, which reports none; the sentence then leaves
 * the version out and is otherwise B10's.
 */
export const B10 = (server: string, version?: string): string =>
  `The runner on ${server} is ${version === undefined ? "" : `version ${version}, `}too old for domains and health checks. Run \`zekno server update ${server}\`, then run \`zekno deploy\` again. ${NOTHING_SIGNED}`

/** B11: a service with a domain has no port. */
export const B11 = (svc: string): string =>
  `${svc} has a domain and no port. Set the port it listens on with \`zekno settings set ${svc}.port <port>\`. ${NOTHING_SIGNED}`

/** B12: a rollback whose old text, that of deploy `n`, lacks `svc`, which `domain` reaches. */
export const B12 = (n: number, svc: string, domain: string): string =>
  `What deploy ${n} ran has no service named ${svc}, which ${domain} reaches. Remove the domain first, or roll back to a deploy that has ${svc}. ${NOTHING_SIGNED}`

/** B13: a warning; the server's public address is not known. `address` undefined: the domain has no record. */
export const B13 = (domain: string, server: string, address?: string): string =>
  `zekno cannot tell whether ${domain} points to ${server}, because this machine reaches ${server} at an address that is not public. ${address === undefined ? "It has no DNS record yet." : `It points to ${address}.`}`

/** B14: a warning, with `--skip-dns-check`. */
export const B14 = (domain: string): string =>
  `DNS was not checked for ${domain}.`

/** B15: a warning; a domain the app holds already has moved away, to `found` first. */
export const B15 = (
  domain: string,
  found: string,
  server: string,
  app: string
): string =>
  `${domain} points to ${found}, no longer to ${server}. Visitors are not reaching ${app} there, and its certificate cannot be renewed.`

/** A warning in B13's pattern (contracts/cli.md, CL3): a lookup that failed for another reason than "no record". */
export const LOOKUP_FAILED = (domain: string): string =>
  `zekno could not look up ${domain} from this machine. The deploy goes on.`

/** B16: the proxy cannot start, `port` is taken. */
export const B16 = (app: string, server: string, port: number): string =>
  `${app} is running, but ${server} cannot answer for its domains: port ${port} is in use by another program. Free ports 80 and 443 on ${server}, then run \`zekno deploy\` again.`

/** B17: a routed service has no container. */
export const B17 = (domain: string, svc: string): string =>
  `${domain} cannot reach ${svc}: no container of ${svc} is running. Run \`zekno logs\` to see why.`

/** B18: a routed service uses the host's network. */
export const B18 = (domain: string, svc: string): string =>
  `${domain} cannot reach ${svc}: ${svc} uses the host's network, which zekno cannot route to. Give ${svc} a network of its own, then run \`zekno deploy\` again.`

/** B19: the proxy did not take the new configuration. */
export const B19 = (app: string, server: string): string =>
  `${app} is running, but ${server} did not take its new domains, so it answers for the ones it had. Run \`zekno doctor\` to see why.`

/** R9: the runner refused `domain_taken`. It answers one fixed word, so the domain is not named. */
export const R9 =
  "A domain of this deploy belongs to another app on that server. Nothing of it ran. Run zekno domain to see which."

/** R10: the runner refused `too_large`, for domains. */
export const R10 =
  "That server would hold more domains than a runner keeps. Nothing of this deploy ran. Remove a domain from an app there first."

// C. A health check.

/** C1: the fifth stage of a deploy with a health check. */
export const C1_STAGE = "Healthy"

/** C2: while the deploy waits, under the stage row; the seconds dim after it. */
export const C2 = (svc: string, path: string): string =>
  `waiting for ${svc} to answer GET ${path}`

/** The end of C3 and C4: the app is left as it is. */
const AS_DEPLOYED = (app: string): string =>
  `${app} is running as deployed, and nothing was rolled back. Run \`zekno logs\` to see why, or \`zekno rollback\` to go back.`

/** C3: not healthy in time, with a path. */
export const C3 = (
  svc: string,
  path: string,
  seconds: number,
  app: string
): string =>
  `${svc} did not answer GET ${path} with success within ${seconds} seconds. ${AS_DEPLOYED(app)}`

/** C4: not healthy in time, without a path. */
export const C4 = (svc: string, seconds: number, app: string): string =>
  `${svc} did not stay up within ${seconds} seconds. ${AS_DEPLOYED(app)}`

/** The label of the health check's row in `zekno settings` (C5, C6). */
export const HEALTH_LABEL = "health"

/** The time limit of a health check when the file leaves it out (contracts/cli.md, CL1). */
export const HEALTH_SECONDS = 60

/** C5 and C6: a health check as its row reads it; `path` undefined: no path. */
export const healthShown = (
  path: string | undefined,
  seconds: number
): string =>
  path === undefined
    ? `stays up, within ${seconds}s`
    : `GET ${path}, within ${seconds}s`

/** C5: the row of a service with no health check. */
export const HEALTH_NOT_SET = "not set"

// D. `zekno domain`.

/** The state of a domain as `zekno domain` shows it (contracts/cli.md, CL4), in the order the first that holds is taken. */
export type DomainState =
  | "taken"
  | "not-deployed"
  | "releasing"
  | "no-dns"
  | "dns-elsewhere"
  | "down"
  | "waiting"
  | "renewing"
  | "live"

/** Each state's mark and its tone at a terminal: never colour alone. */
export const STATE_MARKS: Record<
  DomainState,
  { mark: string; tone: "success" | "warning" | "danger" | "quiet" }
> = {
  live: { mark: "●", tone: "success" },
  renewing: { mark: "●", tone: "warning" },
  waiting: { mark: "●", tone: "warning" },
  "no-dns": { mark: "●", tone: "danger" },
  "dns-elsewhere": { mark: "●", tone: "danger" },
  down: { mark: "●", tone: "danger" },
  "not-deployed": { mark: "○", tone: "quiet" },
  releasing: { mark: "○", tone: "quiet" },
  taken: { mark: "✖", tone: "danger" },
}

/** D1: `live`, `certificate until 17 Feb 2027`. */
export const D1 = (until: Date) => ({
  state: "live",
  detail: `certificate until ${dayShown(until)}`,
})
/** D2: `live`, its last day within 14 days. */
export const D2 = (until: Date) => ({
  state: "live",
  detail: `certificate ends ${dayMonthShown(until)}, renewal is failing`,
})
/** D3 */
export const D3 = (server: string) => ({
  state: "no certificate yet",
  detail: `${server} is asking for one`,
})
/** D4 */
export const D4 = (type: RecordType, address: string) => ({
  state: "no DNS record",
  detail: `create an ${type} record with the value ${address}`,
})
/** D5: `found` is the first address the domain points to. */
export const D5 = (found: string, server: string) => ({
  state: "DNS points elsewhere",
  detail: `${found}, not ${server}`,
})
/** D6 */
export const D6 = (server: string) => ({
  state: "not answering",
  detail: `nothing answers on port 443 of ${server}`,
})
/** D7 */
export const D7 = { state: "not deployed", detail: "run zekno deploy" }
/** D8 */
export const D8 = {
  state: "to be released",
  detail: "removed from the file, run zekno deploy",
}
/** D9: another app on the server holds it. */
export const D9 = (app: string) => ({
  state: `belongs to ${app}`,
  detail: "release it there first",
})
/** D10: no domain at all. */
export const D10 = (app: string): string =>
  `${app} has no domain. Add one with zekno domain add <domain>.`

// E. Where else domains show.

/** E2: `zekno status`, after the app's line. */
export const E2 = (app: string, domain: string): string =>
  `${app}  https://${domain}`

/** E2 with no terminal (contracts/cli.md, CL6): `domain<TAB>app<TAB>domain`. */
export const domainPlain = (app: string, domain: string): string =>
  ["domain", app, domain].join("\t")

/** The label of `zekno doctor`'s check of the proxy (E3, E4, E5). */
export const PROXY_LABEL = "Proxy"

/** E3: the proxy answers for `count` domains. */
export const E3 = (count: number): string =>
  `answers for ${count} ${count === 1 ? "domain" : "domains"}`

/** E4: the proxy is not running, and what to do. */
export const E4 = {
  detail: "not running",
  next: "Deploy an app with a domain to start it again",
}

/** E5: a port is taken, and what to do. */
export const E5 = (server: string) => ({
  detail: "port 80 is in use by another program",
  next: `Free ports 80 and 443 on ${server}`,
})

/** The proxy runs from another image than the one this runner pins: a warning in E4's pattern (contracts/cli.md, CL6). */
export const OTHER_IMAGE = (server: string) => ({
  detail: "an older version",
  next: `Run zekno server update ${server} to replace it`,
})

/** E7: the title of the box under `Secrets` on an app's screen. */
export const E7_TITLE = "Domains"

/**
 * E7: the box's last lines, dim, each a line of its own, as the board
 * `DomainsApp` draws them under the domains: the states are what this
 * machine found, and the settings screen (`e`) is where domains change.
 */
export const E7_NOTE = [
  "Checked from this machine.",
  "e settings to change them.",
] as const
