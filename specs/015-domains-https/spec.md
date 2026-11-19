# Feature Specification: Domains and HTTPS

**Feature Branch**: `015-domains-https`

**Created**: 2026-11-19

**Status**: Draft. The direction was settled with the maintainer on 2026-11-18 (see Clarifications). The points under "Open, for the maintainer" and every new screen and line are not decided: the boards in [`design/`](./design/) show them with a recommendation, and nothing is built until they are approved.

**Input**: The second of the two features the maintainer split "domains and HTTPS" into on 2026-11-18. Feature 014 built the signed deploy, version 2, whose format already carries `routes` and `health`; its runner refuses a deploy that uses them (`unsupported_version`). This feature carries them out: an app gets a domain, the server answers for it over HTTPS with a certificate it obtains by itself, and a deploy can wait for the app to be healthy. It follows the design written and reviewed during feature 010 ([`deploy-v2.md`](../010-app-settings/deploy-v2.md), parts 4.2 and 4.3, "the design" below), closes its finding V23 and the note S7 of feature 014's security review, uses the reverse proxy chosen in [`research-proxy.md`](./research-proxy.md), and ends with runner release 0.1.1 and a proof on a real server.

## Clarifications

### Session 2026-11-18 (before this spec)

- Q: Which reverse proxy? → A: Caddy. Its whole configuration is one generated file that can be checked before it is loaded. kamal-proxy and Traefik were read and set aside ([`research-proxy.md`](./research-proxy.md)).
- Q: Deploys with no dropped requests? → A: Not in the first version. A deploy replaces the app's containers as it does today; requests during the replacement can fail.
- Q: Does Zekno change DNS? → A: Never. It says which record to create and checks it before asking for a certificate.
- Q: Which release? → A: Runner 0.1.1, with development releases `0.1.1-dev.N` before it. Releases stay in the 0.1 line.
- Q: Where is the proof? → A: On a real server at the end, each use with the maintainer's go-ahead.

## Why

Today an app deployed with Zekno is reachable only by publishing a port of the server, over plain HTTP, at an address. A person coming from a managed platform expects to give the app a domain and have HTTPS work. Without it Zekno cannot run a real website, which is what most people deploy.

It also has to be done without weakening what Zekno promises. Which domain reaches which app decides who receives visitors' traffic, so it is part of the signed deploy: a hosted service, when one exists, can carry a deploy but can never add, change or move a domain.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Give an app a domain and get HTTPS (Priority: P1)

A developer has an app that deploys with Zekno from a settings file. In the project folder they run `zekno domain add shop.example.com`. Zekno shows the change before it writes it, writes the domain to the settings file under the service that answers for it, and says which DNS record to create. They create the record and run `zekno deploy`. The deploy is signed with the domain in it. On the server the reverse proxy starts if it is not running, obtains a certificate, and sends requests for `https://shop.example.com` to the app's service. The deploy ends by saying the address is live.

**Why this priority**: It is the feature. Everything else supports or protects it.

**Independent Test**: With a test runner, real Docker and a test certificate authority on this machine, deploy an app with a domain and request `https://<domain>` through the proxy: the app's answer comes back over TLS with a certificate for that domain. On a real server at the end: a browser opens the address with no warning.

**Acceptance Scenarios**:

1. **Given** a folder with a settings file whose one service has a port, **When** the developer runs `zekno domain add shop.example.com`, **Then** the change is shown, the file is rewritten exactly with the domain under that service, the DNS record to create is named with the server's address, and nothing is deployed.
2. **Given** a settings file with a domain and DNS that points to the server, **When** the developer runs `zekno deploy`, **Then** the deploy is signed with a route for that domain to that service and port, the summary shows the domain, and the app starts as today.
3. **Given** that deploy has started, **When** the proxy has a certificate, **Then** `https://shop.example.com` reaches the app, `http://shop.example.com` is redirected to it, and the deploy's last lines say the address is live.
4. **Given** the certificate is not there within the time the deploy waits, **When** the deploy ends, **Then** it says the app is running, that the certificate is not ready yet, and which command shows the state later. The exit status is that of a deploy that started.
5. **Given** a service with a domain, **When** the Compose text is made from the settings, **Then** the service's port is not published on the server because of the domain: the proxy reaches it on a network of its own.
6. **Given** a server that runs no app with a domain, **When** apps are deployed without domains, **Then** no proxy runs, no port 80 or 443 is opened, and every deploy behaves as before this feature.

---

### User Story 2 - DNS is checked before anything is signed (Priority: P1)

A developer adds a domain and deploys before the DNS record exists, or with a typo in it. Zekno looks the domain up from the developer's machine before it signs. If the domain does not lead to the server, the deploy stops: nothing is signed, nothing is sent, and one sentence names the record to create. A certificate is therefore never asked for a domain that cannot get one, which would otherwise fail on the server out of sight and run into the certificate authority's limits.

**Why this priority**: Without it the commonest first experience is a deploy that "works" and an address that does not, with the reason hidden on the server.

**Independent Test**: With a stand-in resolver in tests: a domain that resolves to the server's address passes; one that resolves elsewhere, or to nothing, stops the deploy before signing with the sentence; `--skip-dns-check` goes on with a warning.

**Acceptance Scenarios**:

1. **Given** a new domain that resolves to an address of the server, **When** the developer deploys, **Then** a line says the domain points to the server and the deploy goes on.
2. **Given** a new domain that does not resolve, or resolves to another address, **When** the developer deploys, **Then** nothing is signed and one sentence says so and names the record: its type, its name and the server's address.
3. **Given** a domain behind a service that answers DNS with its own addresses (a CDN in front of the server), **When** the developer deploys with `--skip-dns-check`, **Then** the check is said to be skipped and the deploy goes on.
4. **Given** a server reached over SSH by a name or address that is not public (a private network, a jump host), **When** the developer deploys, **Then** Zekno says it cannot tell whether the domain points to the server, names what it found, and goes on.
5. **Given** a domain the server already holds for this app, **When** the developer deploys again, **Then** it is checked the same way, and a domain that has stopped pointing to the server is a warning, not a stop: the route exists already.
6. **Given** no terminal, **When** a deploy stops for DNS, **Then** the sentence goes to standard error, nothing to standard output, and the exit status is that of a deploy that was not attempted.

---

### User Story 3 - See an app's domains and whether they work (Priority: P2)

A developer wants to know which domains an app has and whether each one works right now. `zekno domain` lists the domains of the folder's app: for each, the service it reaches, whether the server holds it, where its DNS points, and what a visitor gets over HTTPS (a valid certificate and until when, or what is wrong). The same facts appear where apps are shown: `zekno status`, `zekno settings` under Networking, and the app's screens in the full-screen app.

**Why this priority**: After the first deploy this is how a person finds out why an address does not work.

**Independent Test**: With a test runner and stand-ins for the resolver and for the HTTPS request: each state is listed with its words; with no terminal the list is one line per domain, tab-separated, and `--json` gives the same facts.

**Acceptance Scenarios**:

1. **Given** an app with two domains, one live and one whose DNS points elsewhere, **When** the developer runs `zekno domain`, **Then** both are listed with their state, and the second names the record to create.
2. **Given** a domain in the settings file that has not been deployed, **When** listed, **Then** it is marked as not deployed yet, as other settings are.
3. **Given** a domain whose certificate ends within 14 days, **When** listed, **Then** the date is shown as a warning: the proxy renews by itself, so a date that close means renewal is failing.
4. **Given** `zekno status`, **When** an app has domains, **Then** they are shown with the app.
5. **Given** the full-screen app, **When** an app with domains is selected, **Then** its domains are on its screen and in its settings screen under Networking, and a domain can be added or removed there as other settings are changed.

---

### User Story 4 - Remove a domain, or move it to another app (Priority: P2)

`zekno domain rm shop.example.com` takes the domain out of the settings file, shown before it is written. The next deploy leaves it out, and the server releases it: the proxy stops answering for it and its certificate and key are deleted. A domain belongs to one app on a server at a time. A deploy of another app that names a domain the server holds for a different app is refused, with no number used, and says which app holds it. Moving a domain is two deploys: release it from one app, then claim it with the other.

**Why this priority**: Needed for a correct product, but a person meets it after the first success.

**Independent Test**: With a test runner: deploy app A with a domain, deploy app B naming it: refused (`domain_taken`), A still answers. Deploy A without it, then B with it: B answers.

**Acceptance Scenarios**:

1. **Given** an app with a domain, **When** a deploy leaves it out, **Then** the server stops answering for it, deletes its certificate and key, and other apps' domains are untouched.
2. **Given** a domain held by app A, **When** a deploy of app B names it, **Then** it is refused before anything runs, no number is used, and the sentence names the domain, the app that holds it, and what to do.
3. **Given** the same domain under two services of one settings file, **When** the developer deploys or adds it, **Then** it is refused before signing: a domain reaches one service.
4. **Given** the last domain on a server is released, **When** the deploy ends, **Then** the proxy is stopped and removed, and ports 80 and 443 are closed again.

---

### User Story 5 - A deploy can wait until the app is healthy (Priority: P2)

A developer sets a health check on a service: a path and a time limit. The deploy then counts as done only when the service answers that path with success within the limit. If it does not, the deploy ends as "not healthy": the new version keeps running, its domains stay in force, and Zekno goes back to nothing by itself. The developer is told what was checked, what came back, and that `zekno rollback` goes back.

**Why this priority**: The design builds routes and health together (its question Q16), and a domain makes "started" matter less than "answers". It is separate from the first success.

**Independent Test**: With a test runner and real Docker: a service that answers passes; one that answers with an error, or not in time, ends `unhealthy` with the app still running; the check never follows a redirect and never reaches another app's container.

**Acceptance Scenarios**:

1. **Given** a service with a health check, **When** it answers with a status from 200 to 399 within the limit, **Then** the deploy ends as started, and a line says it is healthy.
2. **Given** it does not, **When** the limit passes, **Then** the outcome is "not healthy", the app is left running, the exit status is the one of a deploy whose app did not start, and the lines say what was checked and how to go back.
3. **Given** a health check without a path, **When** the deploy runs, **Then** the service counts as healthy when Docker reports it healthy, or, when it has no health check of its own, when it has stayed up without a restart for ten seconds.
4. **Given** a deploy that is waiting for health, **When** the developer watches it, **Then** the stage row shows that it is waiting, and for how long.

---

### User Story 6 - A rollback keeps the domains (Priority: P3)

`zekno rollback` signs a new deploy with the Compose text of an earlier one. It keeps the routes and the health check in force now, not those of the old deploy: going back because of a code problem must never take the site off its domain or free a domain for another app. If the old Compose text has no service a current route names, the developer is told before anything is signed.

**Acceptance Scenarios**:

1. **Given** an app at deploy 42 with a domain added in 42, **When** the developer rolls back to what 41 ran, **Then** the new deploy carries today's routes and the domain keeps working.
2. **Given** the old text lacks the routed service, **When** the developer rolls back, **Then** it stops before signing and says which domain would be left without a service.

---

### User Story 7 - Old and new programs say what to do (Priority: P2)

Domains need a runner that carries out routes. A zekno that meets an older runner with a deploy that has a domain or a health check stops before signing and says to update the runner. A deploy without either works as in feature 014. An older zekno that meets the new runner stops before signing, as feature 014 decided.

**Acceptance Scenarios**:

1. **Given** a runner that does not carry out routes, **When** a deploy has a domain, **Then** nothing is signed and one sentence says to run `zekno server update <server>`.
2. **Given** the new runner, **When** a deploy has no domain and no health check, **Then** nothing is different from feature 014, and no proxy is started.
3. **Given** the new runner and a zekno from before this feature, **When** it deploys any app, **Then** it stops before signing and says to update zekno, with the sentence feature 014 built for a runner that speaks a newer protocol. A program that does not know domains therefore never signs a deploy that would release one.

---

### Edge Cases

- **Ports 80 or 443 are in use on the server** by another program: the proxy cannot start. The deploy ends as not started, says which port, and the app's earlier routes stay as they were.
- **Docker without root**: binding ports below 1024 needs a host setting. `zekno doctor` and the failing deploy say so.
- **An app whose own Compose text publishes port 80 or 443**: it clashes with the proxy. The deploy that would start the proxy says which app holds the port.
- **A routed service with no container**, or one that uses the host's network: the route cannot be applied; the outcome is "not started" and the sentence names the service.
- **A service with a domain and no port**: refused before signing; the sentence says to set the port.
- **A name that is not a domain Zekno routes**: an address, `localhost`, a wildcard, a special-use name (`.test`, `.local`, `.internal` and the like), a trailing dot, upper case (lowered, said once), a name over 253 characters. Each is refused when it is added, with a sentence.
- **Names with letters outside ASCII** (and their `xn--` forms): see Open, point 8.
- **A domain that points to the server by IPv6 only**, or to several addresses of which one is the server's.
- **The certificate authority refuses** (too many requests, a CAA record that forbids it): the proxy keeps trying with growing waits; `zekno domain` shows that no valid certificate is served, and since when.
- **The proxy's container dies or the server restarts**: Docker brings the proxy back; routes and certificates are kept on the server.
- **The runner is updated to a release with another proxy version**: the proxy is replaced at the next deploy that has routes, and at `zekno server update` if any app has a route.
- **A reload of the proxy fails**: the proxy keeps the configuration it had; the deploy ends as not started for its routes; no other app's domain is affected.
- **More than 64 domains in one deploy or 1,024 on one server**: refused.
- **The runner's folder restored from a backup**: as the design says, not supported; domains can move back.
- **Two deploys of two apps claim one free domain at once**: one deploy runs at a time on a server, so the first holds it and the second is refused.
- **An older zekno deploys an app that holds a domain**: it stops before signing (User Story 7, scenario 3).

## Requirements *(mandatory)*

### Functional Requirements

**The settings file and its commands**

- **FR-001**: A service in the settings file MUST be able to list domains, in the place the format has kept for them since feature 010 (Networking). The sentence "Domains are not in this version of zekno yet." MUST go.
- **FR-002**: A domain MUST be checked against the domain rule (FR-020) when it is added and when the file is read. A service with a domain MUST have a port. One domain MUST appear under one service only.
- **FR-003**: `zekno domain add <domain>` MUST add the domain to the folder's settings file, showing the change before writing it, rewriting the file exactly, and deploying nothing. With several services it MUST ask which one at a terminal, and need `--service` with no terminal.
- **FR-004**: `zekno domain add` MUST then name the DNS record to create: type, name and value, the value being the server's address when it is known.
- **FR-005**: `zekno domain rm <domain>` MUST remove it the same way, and say that the next deploy releases it.
- **FR-006**: `zekno domain` MUST list the app's domains with, for each: the service, whether the server holds it for this app, where DNS points, and what HTTPS answers (FR-030 to FR-033).
- **FR-007**: `zekno settings`, `zekno settings set` and `unset`, and the settings screen MUST show and change domains as they do other settings, under Networking.
- **FR-008**: A health check MUST be settable on a service: a path (optional), and a time limit in seconds (a default when left out). The sentence "Health checks are not in this version of zekno yet." MUST go.
- **FR-009**: A folder with a hand-written Compose file and no settings file: see Open, point 1.

**The DNS check**

- **FR-010**: Before signing a deploy that names a domain the server does not hold for this app yet, the CLI MUST look the domain up from this machine and compare it with the server's addresses.
- **FR-011**: When the domain does not lead to the server, the deploy MUST stop before signing with one sentence that names the record to create. `--skip-dns-check` MUST go on, with a warning.
- **FR-012**: When the server's public address cannot be known, the CLI MUST say it cannot tell, and go on.
- **FR-013**: For a domain the server already holds for this app, a failing check MUST be a warning only.
- **FR-014**: The check MUST use the machine's own resolver. It MUST NOT send the domain to any service of Zekno's or of a third party chosen by Zekno.
- **FR-015**: Zekno MUST NOT create, change or delete a DNS record anywhere.

**What is signed**

- **FR-016**: A deploy made from settings with domains MUST carry them in the signed `routes` of the version-2 message: the whole set for the app, each a domain, a service and a port. A deploy with a health check MUST carry it in `health`. The format does not change.
- **FR-017**: The CLI MUST check before signing that each route's service exists in the Compose text it signs and has that port.
- **FR-018**: The deploy summary MUST show the domains, before anything is sent.
- **FR-019**: A rollback MUST carry the routes and the health check in force now (User Story 6).
- **FR-020**: The domain rule MUST be the design's (lowercase ASCII, at most 253 characters, at least two labels, no wildcard, no address, no special-use name, no trailing dot), tightened as Open, point 8 decides, in the core library, so the CLI and the runner apply one rule.

**The runner**

- **FR-021**: The runner MUST carry out `routes` and `health` of a version-2 deploy and stop refusing them. `builds` and `predeploy` stay refused. The protocol number MUST go up by one, so a CLI knows before signing whether a runner carries routes out.
- **FR-022**: One app MUST hold a domain on a server. A deploy naming a domain another app holds MUST be refused before anything runs, with no number used (`domain_taken`). A deploy that leaves a domain out MUST release it.
- **FR-023**: The proxy MUST run from an image the runner release pins by digest, never one a deploy names. The runner MUST start it at the first deploy with routes, and stop and remove it when no app has a route.
- **FR-024**: The proxy's configuration MUST be generated whole from the routes in force of every app and from names the runner made, checked as valid before it is loaded, written atomically, and never contain text from a deploy that did not pass the patterns. If the proxy will not take it, the earlier configuration MUST stay in force and the earlier routes in the runner's state.
- **FR-025**: The proxy MUST reach an app's containers only by a random name the runner gave them on a network the runner made for that app, resolved when it connects (closing the design's V23). It MUST NOT be given the Docker socket. Its admin interface MUST be off or out of reach of every app's network.
- **FR-026**: The proxy MUST ask for certificates only for domains in routes in force, redirect HTTP to HTTPS, and keep certificates and keys on the server. A released domain's certificate and key MUST be deleted (Open, point 7).
- **FR-027**: The runner MUST carry out the health check as the design says: by a short-lived container from a pinned image on the app's route network, to the runner's own names, following no redirect, reading at most 1 KiB, giving up on a try after 5 seconds; or, without a path, by Docker's health status. A failed check MUST give the outcome `unhealthy`, leave the app and its routes as they are, and roll nothing back.
- **FR-028**: Routes MUST change only when a deploy reaches its start, under the lock that serves one deploy at a time. A deploy that stops earlier MUST leave the app's routes and domains as they were.
- **FR-029**: The runner's answer to `status` MUST say which domains each app holds, so the CLI can show them and check a claim before signing.

**What a person is told about a domain**

- **FR-030**: Whether the server holds the domain for this app comes from the runner. Where DNS points and what HTTPS answers MUST be found out from the developer's machine, not taken from the server's word: it is what a visitor would get.
- **FR-031**: After a deploy that started with a domain the app did not have, the CLI MUST wait a bounded time for HTTPS to answer with a valid certificate, and say either that the address is live or that the certificate is not ready and how to look again (Open, point 3).
- **FR-032**: The HTTPS check MUST verify the certificate as a browser would, show until when it is valid, and warn when that is within 14 days.
- **FR-033**: With no terminal, `zekno domain` MUST print one tab-separated line per domain, and `--json` the same facts.

**Errors and versions**

- **FR-034**: Every new refusal and failure MUST have one sentence in the house pattern: what happened, what it means, what to do. Their words are on the boards and in `design/lines.md`.
- **FR-035**: A deploy with a route or a health check for a runner that does not carry them out MUST stop before signing and say to update the runner.
- **FR-036**: A zekno from before this feature MUST NOT be able to release a domain by deploying: it stops before signing against the new runner (feature 014's rule for a newer protocol), and the runner MUST refuse a version-1 deploy for an app that holds a domain.
- **FR-037**: With no terminal, every existing command MUST behave as before for apps without domains. The frozen transcripts of plain output do not change.
- **FR-038**: `zekno doctor` MUST check, for a server with routed apps or on request, that the proxy runs and that ports 80 and 443 are its own.

**Docs, review, release**

- **FR-039**: The docs MUST gain a page for domains and one for health checks, the README's "What works today" and security model MUST say what is new (the server holds the TLS keys of routed domains; a hosted service would learn every domain), and the roadmap MUST move. The desktop app stays unnamed.
- **FR-040**: An independent security review MUST cover the new surface before release: the proxy and its configuration, the route networks, the health check container, the DNS and HTTPS checks, the new commands.
- **FR-041**: The feature MUST end with runner release 0.1.1 (development releases before it), and a proof on a real server: a domain, a certificate from a real authority, a browser with no warning. Each use of the maintainer's server needs a go-ahead.
- **FR-042**: The first step of the plan MUST be a test on Docker on Linux that the proxy follows a container that restarted behind its name (the research's open point).

### Key Entities

- **Route**: a domain, the service it reaches, and the port. Signed, per app, as a whole set.
- **Domain holding**: which app holds a domain on a server. Kept by the runner, computed from the routes in force.
- **Route network and names**: a network per routed app that the runner makes, and a random name per container on it. Never chosen by a deploy.
- **Proxy configuration**: one generated file for the whole server. Never edited, never pasted.
- **Certificate storage**: the proxy's own, on the server. Zekno's developer machine never holds a TLS key.
- **Health check**: a time limit and, per service, a path and port or Docker's own status. Signed.
- **Domain state**: what `zekno domain` shows. Held by the server (from the runner), DNS and HTTPS (from this machine).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person with an app that already deploys, a domain they own and DNS set, gets the app answering over HTTPS at that domain with two commands (`zekno domain add`, `zekno deploy`) and no file edited by hand, in under five minutes, most of it the certificate.
- **SC-002**: In the tests, with a test certificate authority: every acceptance scenario of User Stories 1, 4, 5 and 6 passes against the real runner program and real Docker.
- **SC-003**: A deploy with a domain whose DNS does not point to the server signs nothing and sends nothing, every time, and names the exact record.
- **SC-004**: No sequence of deploys, by any member, makes the proxy answer for a domain with another app's service while the first app holds it; no deploy's text reaches the proxy's configuration unchecked. The security review tries both.
- **SC-005**: A server with no routed app has no proxy, no open port 80 or 443 and no new container, before and after this feature.
- **SC-006**: Every approved sentence comes out of the real program word for word, at a terminal, in the app and with no terminal.
- **SC-007**: On a real server: a browser opens the proof's address with a valid certificate; after a rollback it still does; after the domain is released the server no longer answers for it.
- **SC-008**: Every earlier test passes; the frozen plain transcripts are unchanged.

## Open, for the maintainer

Each has a recommendation. The boards show what each looks like.

1. **Where domains are written.** Recommended: in the settings file only, in this version. A folder with a hand-written Compose file is told to start a settings file. The other way (domains for hand-written Compose too) needs a second place to write them, the folder's `zekno.json`, and a second set of screens.
2. **A domain that does not point to the server.** Recommended: stop before signing, with `--skip-dns-check` to go on. The other way: warn and deploy; the certificate then fails on the server and comes later, at a time nobody can predict.
3. **Waiting for HTTPS after a deploy.** Recommended: up to 60 seconds, then say how to look again. The other way: do not wait, and only `zekno domain` tells.
4. **Health checks in this feature.** Recommended: yes, as the design planned, after domains work (it is User Story 5 and can ship in the same release). The other way: a feature of its own, and this one ships sooner.
5. **HTTP/3.** Recommended: off in this version. On would open a third port (UDP 443). HTTP is always redirected to HTTPS.
6. **The certificate authority's contact address.** Recommended: none. Let's Encrypt then issues without an account email, and no other authority is used. The other way: ask for an email at the first domain; it allows a second authority as a fallback.
7. **A released domain's certificate and key.** Recommended: deleted with the release.
8. **Names with letters outside ASCII.** Recommended: refused in this version, with a sentence, in both their spellings. It closes the review's note S7 (two texts a browser shows as one name) in the simplest way. The other way: accept them under the stricter of the two standards, which is more code in the part that decides who gets traffic.
9. **The commands' names.** Recommended: `zekno domain` (list), `zekno domain add <domain>`, `zekno domain rm <domain>`, beside `zekno settings set`.
10. **The proof.** It needs a domain of yours and a server whose ports 80 and 443 are free. To settle before the release, not now.

## Assumptions

- The deploy format of feature 014 is used as it is. Only the domain rule may be tightened (point 8), which no released program applies yet.
- Certificates come from Let's Encrypt over the HTTP-01 or TLS-ALPN-01 challenge. DNS challenges, wildcard domains, certificates a team brings, routes by path, and TCP or UDP routes are out of scope, as the design says.
- One runner per Docker daemon, as the design assumes.
- A deploy still replaces containers as today; requests can fail during it.
- Removing an app altogether is not in this feature: a deploy that leaves its domains out releases them.
- The hosted service does not exist. Nothing here goes through it; what it would learn is written down.
- Still pre-alpha and unaudited, and that stays visible.
