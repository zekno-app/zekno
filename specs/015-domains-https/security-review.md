# Security Review: Domains and HTTPS

Everything in [`specs/014-deploy-v2/security-review.md`](../014-deploy-v2/security-review.md) and the
reviews of features 003 to 012 still applies, except where part 5 below says otherwise.

This is not an external audit. One independent reviewer, who wrote none of this feature's code, read
the committed source and ran its own probes on 2026-11-19. Nothing was fixed as part of the review
(T087: record; T088 fixes, part 7). An external audit is still required before production use.

## 1. Scope and method

**Commits.** `c4f5e67` (core), `7e2ea25` (runner), `80c4514` and `7457ff5` (CLI) on
`015-domains-https`; base `9278825`. The working tree held uncommitted work on the CLI's screens and
on the docs; neither was reviewed.

**Method.** Source first: for each candidate, the party with less trust, the input it controls, the
control that should stop it, and the result, traced with file and line. Three probes, in a scratch
folder outside the repository: local TLS servers on 127.0.0.1 against the CLI's probe; the runner's
`loadConfig` against a stand-in for Docker; the certificate-deletion glob on a temporary tree. No
real Docker, SSH, keychain or network.

**Parties considered.** Those of feature 014's review, and one more: a visitor from the internet, who
can send any request to ports 80 and 443 of a server that routes a domain.

**Summary.** Nothing critical or high. No way was found for a party without the team's keys to change
a route, and none for a deploy of app B to take or keep a domain app A holds: not by ordering, a
failed load, `start_failed`, a rollback, the way back (RN9), a crash between steps, or a version-1
deploy. The worst finding is S1, of medium severity: a visitor can make a route change fail.

## 2. Findings

| # | Severity | Finding |
|---|---|---|
| S1 | Medium | Visitors write to the proxy's log, which has no bound, and the runner reads only its first 1 MiB to confirm a reload |
| S2 | Low | A released domain's certificate and key stay on disk when the proxy is not running |
| S3 | Low | The health wait can run a full round past its limit, each check allowed ten minutes, under the deploy lock |
| S4 | Note | A rollback signs routes taken from an answer nobody signed |
| S5 | Note | The glob that deletes OCSP staples matches another domain's |
| S6 | Note, open by design | A signed Compose text of any app can pose as the runner's own objects |
| S7 | Note | The configuration is written before it is validated |
| S8 | Note | Ranges counted as public; a zone in an address; headers a visitor can forge |

### S1. A visitor can make a route change fail (Medium)

**Who.** Any visitor from the internet, with no credentials, against the proxy and the runner.

**Path.** The generated configuration logs at INFO, Caddy's `http.log.error` included
(`apps/runner/src/proxy/config.ts`), and the proxy's container is started with no bound on its log
(`proxy/container.ts`). Each request that fails at the proxy becomes one log line carrying the
request and its headers; the feature's own research counted 394 such lines while a name was dead.
A reload is confirmed by reading `docker logs --since` (`proxy/log.ts`) through the Docker helper,
which keeps the first 1 MiB of an output (`docker/run.ts`). With more than 1 MiB of error lines
before Caddy's `successfully reloaded` line, the line is never seen, the load counts as failed after
15 seconds, and the nonce is never looked for.

**Result.** While a deploy replaces a routed container its old name is dead, so each request to the
domain is a logged 502. The failed load makes the outcome `routes_failed`, and the way back loads the
configuration of the state, whose names belong to the containers `up` just removed. The domain then
answers 502 until a deploy gets through, and the flood blocks each later route change on the server.
Not run: Docker's default log driver does not rotate, so the same lines can fill the disk.

**Probe.** The real `loadConfig` against a stand-in: 0.8 MB of error lines then the reload line gave
`loaded: true` in 617 ms; 1.2 MB gave `loaded: false` after 15 seconds and 60 reads of the log.

**Fix proposed.** Leave the request loggers out of the default log; bound the container's log;
make the nonce decisive and use the log only to stop early on a failed reload.

### S2. A released domain's key can stay on disk (Low)

`routes/apply.ts` deletes a released domain's certificate folder only when the proxy runs, and the
result is not looked at. When the last domain goes, a stopped proxy stays stopped and is then
removed; the volume keeps the key. Decided point 7 ("deleted with the release") then does not hold,
and neither `proxy` nor the next deploy knows what is still to delete. **Fix proposed:** when the
proxy does not run, delete through a short-lived container of the pinned image that mounts the
volume.

### S3. The health wait can overrun its limit (Low)

`health/wait.ts` checks the deadline only after each container of a service was tried, and
`health/check.ts` allows each `docker run` ten minutes so that a missing image can be pulled. A
stalled pull costs up to 16 times ten minutes for one round, with the deploy lock held. With Docker
behaving normally the overrun is about 16 times 5 seconds. **Fix proposed:** check the deadline
before each container; cap each check at the time left; pull once, with its own bound.

### S4. A rollback signs routes the server reports (Note)

`ops/deploy-domains.ts` takes a rollback's routes from `status` with routes, which no one signed. A
runner that claims protocol 3 gets a rollback with no routes; a runner of protocol 4 gets a rollback
with any routes it names, when the old Compose text has those services and ports. A lying server
gains nothing on its own proxy. A party that answers for a server it is not, and can hand the deploy
to the real runner, gets a deploy signed by a member that releases the app's domains or claims free
ones; K10b still keeps it from another app's domain. **Fix proposed:** stop a rollback before
signing when this machine's verified history holds routes for the app and the runner does not answer
routes.

### S5. The OCSP glob (Note)

`"/data/caddy/ocsp/<domain>-"*` also matches staples of a domain that begins with `<domain>-`:
releasing `a.example.co` deleted the staple of `a.example.co-op.example.com` in the probe. Its
certificate folder was untouched. No effect today: Let's Encrypt has no OCSP any more. **Fix
proposed:** drop that part.

### S6. A signed Compose text can pose as the runner's objects (Note, open by design)

The runner does not read the Compose text. A text a member signed for any app can therefore: name a
container `zekno-proxy` (without the runner's labels, each route change fails `not_loaded`; with
them and the pinned image, the runner would adopt it); declare or join `zekno-route-<app>`; mount
`zekno-proxy-data` and read each domain's TLS key. `com.docker.compose.*` labels are closed, as far
as the research shows: Compose overwrites them, so a text cannot make its container count as another
app's service. The random names are not secret from other users of the server: they are arguments of
`docker network connect` and of the health check's `docker run`.

All of it needs a member's signature, which the design of deploy version 2 (part 2.6) already makes
equal to root on the server. **Proposed:** say in the README and the security page that an app's
Compose text can read each domain's key.

### S7. Written before validated (Note)

`proxy/load.ts` writes `caddy.json` and then validates it. If validation fails and the way back
fails before it writes, the invalid file stays and Caddy cannot start at its next restart. **Fix
proposed:** validate a second file, then rename it.

### S8. Smaller notes

- `domains/ip.ts` counts as public: 0.0.0.0/8, `::`, 255.255.255.255, multicast, 198.18.0.0/15,
  and the NAT64 and 6to4 forms.
- `domains/server-address.ts` keeps the text after `%` of an IPv6 address and shows it. Only the
  person's own SSH configuration can supply it.
- Caddy passes a visitor's `X-Real-Ip` and `Forwarded` headers through; an app that trusts them is
  told a forged address.

## 3. Checked and found sound

- **The configuration.** Built by `JSON.stringify` of an object; each domain, name and port checked
  again in that module; admin off; one listener on `:443`; a fixed issuer; each domain's route
  terminal and a last 404. App and service names are never written into it. Nothing of a deploy, the
  state, Docker's output or the environment reaches it, but the test switch's yes or no.
- **The domain rule.** Refuses `xn--`, upper case, wildcards, braces, addresses, special-use names;
  the reader enforces routes sorted and once each.
- **Who holds a domain.** K10b runs before the secrets and before the number is used. The strict
  state refuses a domain held twice or an app not at format 2, and is applied again before any
  configuration is built. The way back uses the state as read under the lock. A crash between load
  and save leaves only the deploying app's own unsaved routes in the proxy.
- **Version 1 and the state's marks.** An app with routes is at format 2; a version-1 deploy keeps
  routes as they are; an older runner refuses mark 3.
- **Containers and names.** Only containers Compose labelled for the project and service count; host
  networking is refused; names come from 16 random bytes and are kept only when Docker shows them.
- **The proxy's container.** Pinned digest; label check; no Docker socket; all capabilities dropped
  but binding low ports; no new privileges; the folder mounted read-only.
- **The one shell.** The domain is matched again before it is put in double quotes; no quote, `$` or
  backtick can enter.
- **The reload.** Sent by `docker exec … kill`. A faked or stale "reloaded" line cannot make a load
  count: Caddy escapes request text in its JSON, only PID 1 writes the log, and the nonce is new each
  time.
- **The health check.** The host is the runner's name; the path rule fixes the authority and has no
  character curl expands; no redirects, HTTP only, 5 seconds, 1 KiB, read-only, no capabilities,
  bounded memory and processes; the output parsed strictly.
- **The test switch.** Read from the runner's own environment only; fails closed on a bad value. Set
  on a real server it costs availability (certificates browsers refuse), not confidentiality.
- **The session.** `status`'s input is strict, `proxy` takes none, frames are bounded. Without keys a
  session learns each app's domains and the proxy's state, and can make the runner start, reload or
  remove the proxy as the state says; it cannot make the proxy do what no signed deploy put in force.
- **The CLI's effects.** `ssh -G -T --` leaves no room for an option; three keys are read. DNS
  answers are kept only when they are addresses, at most 32. "Valid" needs both `authorized` and
  `checkServerIdentity`: self-signed, an untrusted CA and a wrong name were each `invalid` in the
  probe.
- **A hostile project folder.** `zekno domain` looks up only domains the server holds for the app
  and the file still has; `add` and `rm` look up only the linked server's host. Values of the file
  are checked against their rules before they are shown.
- **Text from the runner.** Domains, app and service names follow their rules; of a certificate only
  its last day is shown.

## 4. Could not be decided from source

1. **Search domains.** Neither the proxy nor the check's container is started with
   `--dns-search .`. If a routed container is down, Docker's resolver may pass its name upstream,
   and the host's search domains would then be tried. A search zone that answers each name would be
   sent visitors' requests. Decided on a Linux server: `docker exec zekno-proxy cat /etc/resolv.conf`.
2. What exactly Caddy 2.11.9 writes for a failed request, and how far HTTP/2 header compression
   multiplies it (behind S1).
3. What `docker logs --since` costs on a large log.
4. That Compose on the versions servers run overwrites `com.docker.compose.*` labels a text sets.
5. Whether `ssh -G` can print a host with a zone.

## 5. Carried over

Feature 014's S7 (which names with `xn--` labels may be routed) was left "open, for feature 015". It
is closed: a label that starts `xn--` is refused by the domain rule, in the core library and so by
the runner and the CLI (decided point 8), with the review's two probes as tests.

Feature 014's S1 left the runner's bound on a claimed version deferred; this feature does not touch
it, and it stays deferred.

## 6. Not reviewed

The CLI's screens and the full-screen app (being built), `apps/web`, the settings-to-Compose
generator beyond routes and health, the gated tests with real Docker, the installer and the release,
Caddy's own source, and anything only Docker on Linux shows.

## 7. Answers

Each fix has a test that failed against the code before it. The fixes in the runner were also run
against the real Caddy, in the gated set with real Docker on the development machine.

### S1. Fixed

Three changes in the runner. The generated configuration leaves the request loggers out of the
default log (`http.log.error`, `http.log.access`): with real Caddy, 20 requests answered 502 wrote no
line, where one line a request was written before. The proxy's container has a bounded log
(`--log-driver local`, 10 MB, three files). And the nonce decides a load: after the signal the
runner looks for it in `autosave.json` for up to 15 seconds, and reads the log only to stop early on
a failed reload. Checked by hand with real Caddy first: a load that worked writes the new nonce
there, a load that failed leaves the old one. The test that failed: 1.1 MiB of request errors before
the reload line ended `routes_failed`; it now ends `started`. A proxy made before this change keeps
its unbounded log until it is replaced; no released runner has made one.

### S2. Fixed

When the runner's proxy is stopped or gone and its volume is there, a released domain's folder is
deleted through a short-lived container of the pinned image with no network and no capability
(`proxy/certificates.ts`). With real Docker: the proxy stopped, the last domain released, the
folder gone.

### S3. Fixed

The limit is looked at before each container, a check is given the time left and at most 30
seconds, and the image is looked for once before the wait and pulled only when missing, with a
bound of its own (`health/wait.ts`, `check.ts`, `image.ts`). Three 5-second checks under a 1-second
limit took 15.8 seconds and ended `started`; they now end `unhealthy` in under 6.

### S4. Fixed

A runner that does not answer routes, for an app this machine signed a route for, stops a rollback
with B10 before anything is signed (`apps/cli/src/ops/deploy-domains.ts`). The scenario that failed:
the real runner made to answer protocol 3 after a deploy with a domain; the rollback was signed with
no routes and exited 0. It now exits 1, nothing is sent, and the domain stays in force. A runner of
protocol 4 that names other routes than it holds still decides what a rollback signs; it gains
nothing on its own proxy, and K10b keeps it from another app's domain. Accepted.

### S5. Fixed

The deletion names the certificate's folder only.

### S6. Accepted, and said

The README, the security page and the domains page say that apps on one server are not kept apart:
a deploy the team signed could read the TLS key of every domain there. No check of names in a
Compose text was added: it would not be a boundary.

### S7. Fixed

The text is written to `caddy.next.json`, validated, and only then renamed over `caddy.json`
(`proxy/file.ts`). Before a first start, and before a stopped proxy is started, the validate runs in
a short-lived container. A refused file leaves `caddy.json` byte for byte, and is not followed by a
load back.

### S8. Fixed

The CLI no longer counts 0.0.0.0/8, 192.0.0.0/24, 198.18.0.0/15, multicast and the reserved block,
`::`, ff00::/8, 64:ff9b::/96, 2002::/16 or an address with a zone as a server's public address, and
never shows the text after `%`. The generated route deletes `X-Real-Ip` and `Forwarded` from a
request: with real Caddy, a request sent with both reached the app without them, and with the
proxy's own `X-Forwarded-For`.

### Part 4, point 1. Search domains: closed on this machine, open for Linux

The proxy and the health check's container are started with `--dns-search .`. With real Docker the
proxy's `/etc/resolv.conf` has no `search` line and its names still resolve. The development
machine's Docker has no search domains of its own, so the case of a Linux host that has some is
part of the proof on a server (quickstart, maintainer steps).

Points 2 to 5 of part 4 stay as they are; point 2 no longer matters to S1, since no request is
logged.

## 8. A rollback's health check from the server's word (2026-11-19)

Since this change a rollback signs the health check that `status` with routes answers for its app,
no longer the one this machine's history kept (research R29, the note of 2026-11-19). Reasoned
from the code, not probed.

**What is checked.** The answer is read by `RunnerStatusWithRoutesSchema`: each check by
`HealthSchema` (strict, the path rule, at most 16 services and 1,800 seconds), its services sorted
and once each, at most 256 KiB of them, so the frame bound (4 MiB) still holds for an honest runner.
`createDeployV2` reads the deploy back by the format's own reader before it signs it, as for any
deploy.

**What a lying server gains.** The signed deploy names that server's id, the app and `previous`
(`createDeployV2`); any other runner refuses it `wrong_server`, and that runner takes it only for
that app and only while the app's number is still `previous` (`replayed` after). The check decides
only what that runner does with that app (RN11, `health/`): which of the app's own containers it
asks, on which port and path, from a container of the pinned image on the app's own route network;
how long it waits under its deploy lock, at most 30 minutes; and whether it answers `started` or
`unhealthy`. A runner can do all of that without any signature, and can answer any outcome it
likes. A check left out makes the deploy count as started without a wait; a check naming a service
the old text lacks ends `routes_failed` on that server. The check reaches no configuration of the
proxy (`proxy/config.ts` builds from routes and names only), no domain, no secret and no other app.
On this machine it is kept in the history like any signed deploy's, so the "changed, not deployed"
mark of that app on that server compares with it: a display only.

A party that answers for a server it is not and hands the deploy to the real runner (S4's case)
already gets routes of its choosing signed, a public door to the app's ports; a GET to the same
containers on the app's private network adds nothing to that. A runner that says it cannot tell
(below protocol 4, or one request at a time) stops a rollback of an app this machine signed a route
or a health check for with B10, as S4's fix does for routes.

**Conclusion.** A server that lies about the health check gains nothing beyond what its own runner
already decides for that app on that server. Accepted, as R29 accepts its word for its own routes.

## 9. A second audit, with the security-audit skill (2026-11-20)

Before the push to `main`, the maintainer asked for a run of the security-audit skill
(cloudflare/security-audit-skill). It ran as a scoped pass on its `quick` profile over this
feature's code, at `dev` 6eac6af: four agents mapped the code, four hunted in twelve coverage
units, one critic looked for gaps, and three verifiers each tried to refute one candidate. It read
source only: this machine has no sandbox with the controls the skill requires, so the skill ran
no code, and so it could confirm nothing. Its files are outside the repository, in
`~/security-audit-skill/zekno/run-1/` (`REPORT.md`, `NEEDS-VALIDATION.md`, `findings.json`,
`coverage-ledger.json`).

**Result.** Nothing confirmed, nothing critical or high raised. Nine units closed as covered.
Three leads survived their verifier and need a real test:

| Lead | State |
|---|---|
| A9. The proxy, on every routed app's network at once, has IPv4 forwarding on, so code in one app's container might send one-way packets into another app's network | **Fixed** the same day: the proxy runs with `--sysctl net.ipv4.ip_forward=0` (RN6), with a test that failed first. Observed on Docker Desktop's Linux: a container forwards IPv4 by default (`ip_forward` is 1, on each interface of a container on two networks), IPv6 not, and the setting is accepted with the proxy's capabilities. Whether a packet would have arrived on a Linux server was not tried. A proxy an earlier runner made keeps its options until it is made again; only 0.1.1-dev.1 made one, on a server since cleaned |
| A10. `docker compose up` has no time limit under the deploy lock, so a container that `up` waits for and that never exits keeps every deploy on that server answering `busy` | **Fixed** on 2026-11-20 (part 10): `up` is stopped after 30 minutes, the number the maintainer chose |
| A11. A released domain's certificate and key are deleted once, a failure is silent, and nothing tries again, though `apply.ts` and RN10 say a later deploy or `proxy` does | **Fixed** on 2026-11-20 (part 10): the state lists each released domain until its deletion is known to have worked, and every deploy and `proxy` request tries again |

**Not covered by that run**, so nothing is claimed of them: host ports an app publishes against the
proxy's 80 and 443; what a runner update does to a running proxy; the unsigned requests `state`,
`logs` and `records`; what the Compose text made from a settings file gives a container; and,
outside its scope, secrets, the installer and release workflow, the team list, the website and
templates. Its report also lists 18 hardening notes that are not findings.

## 10. The two open leads of part 9, fixed (2026-11-20)

The maintainer decided both the same day: a limit of 30 minutes on a start, and a released
domain's certificate deleted until it is gone. Each was built in its own branch with tests that
failed first, read through, and merged into `dev`.

### A10. A start has a time limit

- `docker compose up` is stopped once it has run for 30 minutes (`START_LIMIT_MS`,
  `apps/runner/src/docker/compose.ts`): the Docker process gets a signal to end, then one it cannot
  refuse, and its outputs are waited for one second more, never longer. The deploy lock is then
  free. What Docker made by then stays as it is, as after any start that failed.
- The outcome is `start_failed`. The report of a version-2 `deploy` carries `startLimit`, the
  limit in whole seconds, so the CLI can say what happened (line B20, proposed on 2026-11-20 and
  not approved yet). The report of the version-1 path is unchanged, since older zeknos read it
  strictly.
- A released runner's message changed, so the protocol number is 5. A zekno at 5 still deploys
  to a runner at 4, with and without domains; a zekno at 4 is told to update by a runner at 5.
- **What is left.** The limit is a fixed number. The runner stops the `docker` program it
  started; whether a helper process of Docker's can outlive it and carry on is not known from the
  stand-in and is looked at in the real-server proof. An `up` that exited while a process it left
  behind keeps its outputs open is reported as stopped at the limit; before, it never returned.
  With no session, Docker's output is still collected in memory with no cap, now for 30 minutes
  at most.

### A11. A released domain's certificate is deleted until it is gone

- The stored state, mark 4, has `released`: the domains released whose certificate is not yet
  known to be deleted. The write that releases a domain adds it; a domain routed again is taken
  off in the same write and keeps its certificate. The schema refuses a list that names a domain
  in force, so a routed domain's certificate can never be deleted from the list.
- `deleteCertificates` says which are known to be gone: the deletion exited 0, or Docker says the
  volume does not exist. A Docker that did not answer, a proxy of another server's, a failure or
  a timeout leave the domain on the list. A timeout ends the round, so a Docker that hangs costs
  one wait, not one per domain.
- The list is tried after a load that worked, at every `proxy` request, and after `up` at a
  deploy of an app with no route, which otherwise makes exactly the calls it made before.
- The list counts toward `LIMITS.domainsPerServer` at K15, so the state always fits.
- A mark-3 state of runner 0.1.1-dev.1 is read and given an empty list; runner 0.1.1-dev.1
  refuses mark 4, as every runner refuses a mark it does not know.
- **What is left.**
  - Nothing reports the list. `status` with routes could carry it, so that `zekno doctor` can
    say a released key is still on a server; that needs a sentence and the maintainer's word.
  - `zekno server update` sends `proxy` only to a server with a route, so after the last domain
    is released with a failed deletion, the next try is the next deploy.
  - A refusal `too_large` caused by the list is worded by the CLI as the general one, since the
    CLI cannot see the list. It takes 1,024 domains in force and waiting together.
  - When a load and the load back both fail, the proxy's file can hold a domain the state lists
    as released; if the proxy then starts again with it, a later deletion removes a certificate
    it holds in memory and it asks for a new one. The exposure is one more certificate request.
  - A version-1 deploy does not try the list.
