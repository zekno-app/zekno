# Contract: the CLI (`apps/cli`)

For FR-001 to FR-020 and FR-030 to FR-038. The words of every line are [design/lines.md](../design/lines.md)'s and the boards'; this file says when each is said. Decisions: [research.md](../research.md) R14, R26 to R32. The code as it was, with file and line: [research/map-cli.md](../research/map-cli.md).

## CL1. The two settings

In the settings file, per service:

```json
"deploy": { "healthcheck": { "path": "/health", "timeout": 60 } },
"networking": { "port": 3000, "domains": ["shop.example.com"] }
```

- `domains`: a list of 1 to 64 strings, each lowercase and passing the core library's domain rule, none twice in the file. Under a service with no port: refused. An empty list is written as no `domains` key.
- `healthcheck`: a strict object. `path` optional, passing the core library's path rule, and then the service needs a port. `timeout` optional, a whole number from 1 to 1,800; 60 when left out. An object with neither is "stays up, within 60s".
- The two refusal sentences "… are not in this version of zekno yet." for domains and health checks go. Replicas, builds and pre-deploy commands keep theirs. A template file still may not name a domain or a health check: the template reader refuses them with its existing sentence for a setting a template cannot carry.
- Reading back what was written (`write.ts`) covers both fields.

Keys for `zekno settings set` and `unset`: `<service>.domains` (the whole list, comma-separated, lowered; shown one a row), `<service>.health` (a path, or `up` for no path), `<service>.health-timeout` (seconds). `unset <service>.health` removes the health check with its limit. `<service>.health-timeout` on a service with no health check is refused with the existing sentence for a value that cannot be set yet, naming `health`.

Rows: `health` under Deploy after `cpus` (lines C5, C6: `GET /health, within 60s`, `stays up, within 60s`, `not set`), `domains` under Networking after the port rows (E1: one a row, `none`). `--json` and plain output of `zekno settings` gain the two settings for services that set them, and nothing for services that do not.

"Changed, not deployed": the history keeps the `routes` and `health` of each version-2 deploy this machine signed; the mark compares the file with the latest accepted one's (R30).

## CL2. `zekno domain add <domain> [--service <name>] [--yes]`, `zekno domain rm <domain> [--yes]`

Need no team and no connection. They follow `zekno settings set` step for step: read the folder's settings (a hand-written Compose folder: A14; no file: the existing sentence), work out the new list, show the change line (A1, A2, A8), ask the existing question (A3) unless `--yes`, write, say A4 or A9.

- The domain is lowered first; a domain that differed is said once in the change line as written. Refusals before anything is shown, exit status 2: A10 (`not_routable`), A11 (`not_ascii`), A12 (no port), A13 (already in the file; names the service), A15 (`rm` of one the file lacks).
- The service: the only one with a port; else `--service`; else asked (A7) among the services with a port; with no terminal, A16, exit status 2.
- After A4 on `add`: the record to create. The server is the folder's linked server, if the folder is linked and this machine knows it; its address by CL5. Known and public: A5 with `A` for an IPv4 address and `AAAA` for an IPv6 one. Otherwise A6, with the server's name, or "your server" when the folder is not linked.
- Plain output: the change line and the result as `zekno settings set` prints them, then A5 as `record<TAB>A<TAB>shop.example.com<TAB>203.0.113.7`, or nothing for A6. `--json`: the change, and the record when known.

## CL3. `zekno deploy` and `zekno rollback` with a route or a health check

The plan carries the routes (from the settings: a route a domain, to its service and that service's port, sorted by domain) and the health check (R14). A folder with a hand-written Compose file has neither.

**Before signing**, in this order, each a stop with nothing signed unless marked a warning:

1. B10: the deploy has a route or a health check and the runner's protocol is below 4, or the runner is run one request at a time. A deploy with neither is not affected.
2. `status` is asked with routes (protocol 4 only). B9: a domain of the deploy is in another app's routes there.
3. B11: a route's service has no port (the schema refuses it already; kept as a guard). FR-017: every route's service is in the Compose text to be signed.
4. For a rollback: the routes are the server's for this app (R29); B12 when the old text lacks a routed service. No DNS check.
5. For each domain of the deploy that the server does not hold for this app yet, in domain order, unless `--skip-dns-check` (then B14 once a domain, a warning):
   - the server's address is not known (CL5): B13, a warning, with the address the domain points to, or "It has no DNS record yet." in place of the last sentence when it has none;
   - the domain has no A and no AAAA record: B7;
   - none of its addresses is one of the server's: B8, naming the first address found;
   - otherwise B1, a line before the panel.
6. For each domain the server already holds for this app: the same lookup; a mismatch is B15, a warning. Nothing is said when it matches or when the server's address is not known.

A lookup that fails for another reason than "no record" (no network, a resolver that does not answer within 3 seconds, twice) is treated as "cannot tell": `zekno could not look up shop.example.com from this machine. The deploy goes on.`, a warning. This sentence is new and follows B13's pattern.

`--skip-dns-check` is accepted by `zekno deploy` only; on another command it is an unknown option.

**Signing**: `createDeployV2` with the routes and the health check. The panel shows the `domains` row (B2, B3) from the first stage on.

**The answer**:

| Outcome | Stage row | Lines | Exit status |
|---|---|---|---|
| `started`, no new domain | as today | as today | 0 |
| `started`, with domains new to the app | as today | for each new domain, in order: B4 while waiting, then B5; domains still not answering when 60 seconds have passed since the start: B6 each | 0 |
| `routes_failed` | `✔ Started` | B16 (`port_taken`), B17 (`no_container`), B18 (`host_network`), B19 (`not_loaded`) | 1 |
| `unhealthy` | `✖ Healthy` | C3 with a path, C4 without | 1 |
| `start_failed` | as today | as today | 1 |
| refused `domain_taken`, `too_large` | as a refusal today | R9, R10 | 1 |

With a health check the stage row has a fifth stage, `Healthy` (C1): in progress from the first `health` event, with the live line C2 under it; done when the outcome is `started`. B17 and B18 name the first domain that reaches the service the report names. "Number N is used" is not said after `routes_failed` or `unhealthy`: the deploy is the app's current one.

The history records the outcomes `routes_failed` and `unhealthy` as themselves. `zekno status`, the app's list of deploys and a rollback treat both as a deploy that was accepted and is the app's current one.

With no terminal: every stop is its sentence on standard error; warnings on standard error; B1 and B5 on standard output as `dns<TAB>shop.example.com<TAB>203.0.113.7` and `https<TAB>shop.example.com<TAB>live<TAB>2027-02-17`; B6 as `https<TAB>shop.example.com<TAB>waiting`. A deploy without a route or a health check prints exactly what it prints today.

## CL4. `zekno domain [--json]`

Needs the folder's settings and its linked server. One row a domain of the file and of the server's routes for this app, in domain order: the name, `service:port`, the state, the detail (lines D1 to D10). The state is the first of these that holds:

| State | When |
|---|---|
| `belongs to <app>` (D9) | the server holds the domain for another app |
| `not deployed` (D7) | in the file, not in the server's routes for this app |
| `to be released` (D8) | in the server's routes for this app, not in the file |
| `no DNS record` (D4) | held; no A or AAAA record |
| `DNS points elsewhere` (D5) | held; the server's address is known and none of the domain's addresses is the server's |
| `not answering` (D6) | held; nothing answers on port 443 of the domain within 5 seconds |
| `no certificate yet` (D3) | held; something answers and the certificate is not valid for the domain |
| `live`, a warning (D2) | held; valid, and its last day is within 14 days |
| `live` (D1) | held; valid |

The server cannot be reached, or its runner is older than protocol 4: the rows of the file are shown as `not deployed` is shown, with the detail `prod-1 was not asked` and the existing warning about the server above them. The lookups run at most 8 at a time.

Plain: `domain<TAB>service<TAB>port<TAB>state word<TAB>last day or empty`; the words are `live`, `renewing`, `waiting`, `no-dns`, `dns-elsewhere`, `down`, `not-deployed`, `releasing`, `taken`. `--json`: a list of the same facts. No domain: D10 at a terminal, nothing in plain output, `[]` in JSON. Exit status 0 whatever the states.

## CL5. The three effects

Optional dependencies, set in `main.ts` only; undefined in tests unless a test sets a stand-in. Undefined means "cannot tell" for the first two and "not looked up" for the third, with no call made.

- `sshHost(destination)`: runs `ssh -G -T -- <destination>` and reads the lines `hostname`, `proxyjump` and `proxycommand` only. Not known when: the target is local; a jump host or a proxy command other than `none` is set; ssh fails; or the host name, resolved by `resolveDomain` when it is not an address, gives no address or only addresses that are private, loopback, link-local, carrier-grade NAT or unique-local. The documentation ranges (203.0.113.0/24 and the like) count as public: the examples and the tests use them. Otherwise the server's addresses are those.
- `resolveDomain(name)`: `{ v4, v6 }` by `resolve4` and `resolve6`, 3 seconds, two tries; "no record" is both empty.
- `probeHttps(domain)`: a TLS connection to port 443 with the domain as the server name; `{ state: "valid", until }` when `authorized` and `checkServerIdentity` both pass, `{ state: "invalid" }` when something answered TLS without that, `{ state: "none" }` when nothing answered within 5 seconds. Sends no request and reads no body.

A test lists the files that may use each, as `never-fetches` does for `fetch`.

## CL6. Where else it shows

- `zekno status`: after an app's line, a line a domain the server holds for it (E2). Asked with routes when the runner speaks protocol 4. Plain: `domain<TAB>app<TAB>domain`. JSON: the runner's `routes`.
- `zekno doctor`: for each server whose runner speaks protocol 4 and holds a route: a `Proxy` check. `running`: E3 with the number of domains. `stopped` or `missing`: E4, a problem. `other_image`: a warning, `Proxy  an older version` with `Run zekno server update prod-1 to replace it` under it (new, in E4's pattern).
- `zekno server update`: after an update, when the runner speaks protocol 4 and holds a route, sends `proxy`; its failure is said with B16 or B19's words for the server.
- The app: the settings screen's rows (E6), changed as other settings are; an app's screen with the `Domains` box under `Secrets` (E7), filled as CL4 fills its rows, shown only when the app has a domain in the file or on the server; the deploy screen (E8).
- The help: `zekno domain`, `zekno domain add <domain> [--service <name>] [--yes]`, `zekno domain rm <domain> [--yes]`, and a line of its own for `zekno deploy --skip-dns-check`. The existing lines are not edited.

## CL7. What must hold

- A command on an app with no route and no health check makes no lookup, no `ssh -G`, no TLS connection, and asks `status` as today.
- The frozen plain scenes pass unchanged; the list of added help lines gains this feature's lines (plan, "Needs the maintainer", 1).
- Screens and `ui/` load neither the profile nor the core library; `domains/` loads no screen and is listed in the layers test.
- No file over 500 lines is made longer; `cli.ts` is split before it grows.
