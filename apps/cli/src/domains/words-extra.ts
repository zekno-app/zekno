/**
 * The words of feature 015 that design/lines.md does not hold
 * (specs/015-domains-https), kept apart from words.ts, which holds the
 * approved lines word for word. Each follows the pattern of the line it is
 * named after, and says where it is used; none is on a board yet, so each is
 * the maintainer's to approve. test/domains/words-extra.test.ts pins them.
 *
 * Like words.ts, this file imports nothing of zekno's, and a sentence is
 * given only names that passed their rule, an address, a number or a date.
 */

/** The first line of `zekno domain` at a terminal, dim: the app and the server (board `DomainsList`, `shop on prod-1`). */
export const listTitle = (app: string, server: string): string =>
  `${app} on ${server}`

/** The detail of a row of `zekno domain` whose server was not asked (contracts/cli.md, CL4, `prod-1 was not asked`). */
export const notAsked = (server: string): string => `${server} was not asked`

/** D4's detail when the server's public address is not known: A6's words, as a detail. */
export const pointAt = (server: string): string =>
  `point it at the public address of ${server}`

/** `zekno domain` in a folder that is not linked to an app: CL4 needs the folder's linked server. */
export const NOT_LINKED_HERE =
  "This folder is not linked to an app. Run `zekno link` here, then `zekno domain` again."

/** B17's pattern, for a service the deploy checks the health of and routes no domain to. */
export const noContainerChecked = (svc: string): string =>
  `${svc} cannot be checked: no container of ${svc} is running. Run \`zekno logs\` to see why.`

/** B18's pattern, for a service the deploy checks the health of and routes no domain to. */
export const hostNetworkChecked = (svc: string): string =>
  `${svc} cannot be checked: ${svc} uses the host's network, which zekno cannot route to. Give ${svc} a network of its own, then run \`zekno deploy\` again.`

/** B16's words for the server, after `zekno server update` sent `proxy` (contracts/cli.md, CL6). */
export const proxyPortTaken = (server: string, port: number): string =>
  `${server} cannot answer for its domains: port ${port} is in use by another program. Free ports 80 and 443 on ${server}, then run \`zekno deploy\` again.`

/** B19's words for the server, after `zekno server update` sent `proxy` (CL6). */
export const proxyNotLoaded = (server: string): string =>
  `${server} did not take the configuration of its domains, so it answers for the ones it had. Run \`zekno doctor\` to see why.`
