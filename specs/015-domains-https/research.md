# Research: domains and HTTPS (feature 015)

What was found out before planning, and what was decided from it. The records behind it are in [`research/`](./research/): [Caddy on Docker](./research/caddy-on-docker.md) (every experiment run for real), [the core library and the runner](./research/map-core-runner.md) and [the CLI](./research/map-cli.md) (maps of the code, with probes of DNS and TLS in Bun). The earlier choice of the proxy is in [`research-proxy.md`](./research-proxy.md).

Everything about Docker was run on Docker Desktop for macOS (engine 29.6.1), not on Linux on bare metal. What that leaves open is listed under R33 and is tried on a real Linux server in the proof.

## The proxy

**R1. The image.** `caddy:2.11.9-alpine`, pinned in the runner's code by its multi-arch index digest `sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0` (amd64 `sha256:fc9cbc10…6424`, arm64 `sha256:9ee99810…0120`), about 24 MiB compressed. It runs as root, declares no volume, and holds `curl` 8.23.0. *Decision*: one pinned image serves as the proxy and as the health check's container, so the runner pulls nothing else. `/data` and `/config` are named Docker volumes: without one on `/data`, every certificate is lost when the container is made again.

**R2. The configuration.** One JSON file, generated whole. *Decision*, each point verified by running it:

- `admin.disabled: true`. No admin interface exists.
- One server that listens on `:443` only, `protocols: ["h1", "h2"]`. Caddy then adds its own server on `:80` that answers every request with a 308 to HTTPS. A server that listens on both ports serves the app over plain HTTP with no redirect, so that form is never generated. No UDP socket is opened.
- One route per domain: a `host` match, a `reverse_proxy` to the app's names, `terminal: true`; then a last route with no match that answers 404, so a valid name with another `Host` header gets 404 and not an empty 200.
- Certificates are asked for exactly the hosts in routes. An explicit `acme` issuer with Let's Encrypt's directory (and its staging directory as `test_ca`), so no change of Caddy's defaults can bring in another authority. No email.
- `apps.http.grace_period: "10s"`. With the default (no limit), one stuck request kept a stopping proxy alive and serving nothing, and Docker's restart policy could not help.
- A nonce `"@id": "gen-<16 hex>"` on the server, new for every file (R4).

**R3. `caddy validate` is not a check of meaning.** It refuses broken JSON, unknown fields and modules, and an empty file; it accepts `{}`, an upstream with no port, and a host with spaces. *Decision*: the runner's own patterns stay the only gate on what enters the file (FR-024); `validate` runs before every load to catch a file the runner wrote wrongly.

**R4. Loading a configuration.** With the admin interface off, `SIGUSR1` makes Caddy read its file again; a file it cannot load leaves the earlier configuration serving. Two traps, both verified:

- `docker kill -s USR1` switches off the container's restart policy (Docker counts any `docker kill` as a stop by hand). *Decision*: the signal is sent with `docker exec <proxy> kill -USR1 1`, which does not.
- An empty file "reloads successfully" and takes every site down. *Decision*: after the signal the runner reads the proxy's log since that moment for `successfully reloaded config from file` or `failed to reload config from file`, and then confirms that the file's nonce is in `/config/caddy/autosave.json`, which Caddy writes only after a load that worked. No answer within 15 seconds counts as not loaded.

The admin interface on a unix socket gives a simpler answer but brings the interface back, and one bad file locks the runner out of it. Not used.

**R5. The file is in a folder that is mounted, never mounted by itself.** A single-file mount lost the file after an atomic rename. *Decision*: `<home>/proxy/etc/` is mounted read-only at `/etc/zekno-proxy`; the runner writes `caddy.json` there with its atomic write.

**R6. Each load drops a few new connections** (about 5 HTTP/1.1 requests at 1,100 a second), and requests already running are not cut. *Decision*: a configuration is loaded only when its text differs from the one in force.

**R7. Names, not addresses (the design's V23, closed for Caddy).** Caddy looks an upstream's name up each time it opens a connection. In the experiment another container took a restarted container's address and received none of 394 requests; the app came back on another address and was served with no reload. While a container is down its name resolves to nothing and requests get 502. *Decision*: as the design says, a random name per container on a network the runner makes; the name is `z` and 32 hex characters, because a name of digits can be read as an address by the tools in the check container.

**R8. The order of joining and leaving a network.** Taking the proxy off a network that the loaded configuration still uses left a request hanging for over eleven minutes. *Decision*: to add, connect the proxy to the network, then load the configuration; to remove, load the configuration without the route, then disconnect. Never the other way.

**R9. A port that is taken.** `docker run` exits 125 and its error text holds `port is already allocated` (another container) or `address already in use` (another program); with `-d` a container is left in state `Created`. *Decision*: the runner matches those two texts, removes the leftover, and reports `port_taken` with the port. The wording on Linux is from memory and is checked in the proof (R33).

**R10. A released domain's certificate.** Under `/data/caddy/certificates/<issuer>/<domain>/`. Deleted while the domain is still in the configuration, Caddy serves from memory and asks for a new certificate at its next start. *Decision*: load the configuration without the domain first, then `docker exec <proxy> rm -rf` its folders; the domain has passed the domain rule, so the path is safe.

**R11. The proxy's container.** Named `zekno-proxy`, labelled with the server's id, `--restart unless-stopped`, ports 80 and 443 published, on a network of its own (`zekno-proxy`) and on each routed app's route network. Started at the first deploy that leaves the server with a route; removed when no app has one (the volumes stay). Made again when its image is not the pinned one. It never gets the Docker socket.

## Health checks

**R12. How the request is made.** `curl` from a short-lived container of the pinned image on the app's route network: `--max-time 5 --max-filesize 1024 --proto '=http'`, no `-L`, run as a user without rights, read-only, no capabilities, 32 MB. Healthy means curl's exit is 0 or 63 and the status is 200 to 399; a status line followed by silence gives 200 with exit 28 and is not healthy. busybox `wget` always follows redirects and cannot be used. Each run costs about 0.3 seconds.

**R13. The wait.** One try every 2 seconds until every listed service is healthy or the time limit passes. Without a path: Docker's health status when the container has a health check, else running with an unchanged restart count for 10 seconds, as the design says. An app with a health check and no domain still gets a route network, since the check runs there.

**R14. The settings and the signed field.** The file holds a health check per service (`deploy.healthcheck`: an optional `path`, an optional `timeout` in seconds, 60 when left out). The signed `health` has one time limit for the deploy. *Decision*: the deploy's limit is the largest of its services' limits; a service with a path is checked on its own `networking.port`; a path needs a port. Set with `zekno settings set web.health /health`, `web.health up` (no path), `web.health-timeout 120`; removed with `unset web.health`. The key `health-timeout` is not on a board: it shows inside the approved `health` row (`GET /health, within 120s`).

## The core library

**R15. Carrying the fields out.** The check that refuses later fields (`carriedOut`, F7) stops refusing `routes` and `health`; `builds` and `predeploy` stay refused. No option is added: the core library ships inside the runner, as the protocol number does. `createDeployV2` takes `routes` and `health` as inputs of their own.

**R16. The domain rule.** Every label that starts `xn--` is refused, and with it the code that decoded such labels. Input with a character outside ASCII was refused already. The rule and the path rule are exported, with a reason, so the CLI can tell "not a domain zekno can route" from "not yet". Closes the note S7 of feature 014's review.

**R17. What the runner keeps.** The state gains `routes`: for each app, its routes in force and, for each routed or checked service, the containers it found and the name given to each. The mark becomes `"v": 3`; a state marked 2 or not marked is read as having no routes. No released runner writes mark 2, so nothing in the field is affected. A new limit: 1,024 domains on a server.

**R18. Who holds a domain.** Checked in the core library's verification, after the expiry check and before the secrets: a deploy that names a domain another app holds is refused with `domain_taken`, no number used. The server-wide limit is checked with the other limits (`too_large`).

**R19. The protocol.** Number 4. New outcomes: `routes_failed` (the app started, its routes could not be put in force; with one of `port_taken`, `no_container`, `host_network`, `not_loaded`, and the service or the port where it applies) and `unhealthy` (with the service). A new session event, `health`, says which service is being waited for. `start_failed` stays what it is: Docker Compose did not bring the app up.

**R20. Telling the CLI what is held.** The answer to `status` is a strict object in every zekno, so a new field would make older ones fail on it. *Decision*: `status` answers the routes in force (`routes`, per app: domain, service, port) and the proxy's state only when the request asks (`{"routes": true}`); older runners ignore the input and answer the old shape. Whole routes, not only names, so a rollback can keep them (R29).

**R21. A command that puts the proxy right.** `proxy`: makes the proxy match the state the runner already holds (start it, make it again from the pinned image, or remove it) and answers its state. It applies only routes a signed deploy put in force, so it needs no signature, as a restart by Docker needs none. `zekno server update` sends it after an update when the server has a routed app.

## The runner

**R22. Where the steps go.** Under the one deploy lock, after the number is used and `docker compose up` has returned: find the routed and checked services' containers (by `docker compose ps -q` and their Compose labels), give each a name on the app's route network (a container that was not made again keeps the one it has), bring the proxy up and onto the network, write, validate and load the configuration, and only then save the routes to the state. If the configuration is not loaded, the configuration built from the state as it is, is loaded again, the state is left alone, and the outcome is `routes_failed`. Then what was released: certificates, the route network of an app with no route and no check, the proxy when no app has a route. Then the health wait.

**R23. Nothing for an app without either.** A deploy of an app that has no route now, had none before and has no health check makes no Docker call it does not make today (SC-005), and the existing tests hold as they are.

**R24. Docker calls.** A shared helper that returns the exit status, standard output and standard error (the text of a taken port is on standard error), used by every new call. The tests' stand-in for Docker treats any call it does not know as `up`; it is extended first to script `network`, `run`, `exec`, `logs`, `inspect`, `rm` and `compose ps -q`.

**R25. Tests against a real proxy.** Gated as the CLI's real-Docker tests are: Docker answers and the pinned image is on the machine; they never pull. They need the internal certificate authority and high ports. *Decision*: an environment variable read by the runner, `ZEKNO_PROXY_TEST=<http port>:<https port>`, makes the proxy use Caddy's internal issuer and publish those ports on 127.0.0.1. It is the same kind of switch as `ZEKNO_DOCKER`, which already replaces Docker in tests; a deploy cannot set it, and SSH does not carry it. The security review looks at it.

## The CLI

**R26. Looking a domain up.** `resolve4` and `resolve6` of `node:dns/promises`, tried in Bun 1.4.4. `lookup` dropped IPv6 answers on this machine and reads the hosts file, so it is not used. A name with no record gives `ENOTFOUND` for both kinds. A VPN or a company proxy can make a right domain look wrong from this machine: `--skip-dns-check` is the way past.

**R27. The server's address.** Nothing in the CLI reads it today. `ssh -G -T -- <destination>` answers, without connecting, the host name ssh would use and whether a jump host or a proxy command is set. *Decision*: read only its `hostname`, `proxyjump` and `proxycommand` lines; a jump host, a proxy command, a local target, or an address in a private or reserved range means "not known" (the warning B13, the line A6).

**R28. Asking the address over HTTPS.** `node:tls`: connect with the domain as the server name, judge the certificate by `authorized` and by an explicit `checkServerIdentity`, read its last day, with a timer of its own (an address where nothing answers sends no event). `fetch` is not used: a test allows it in two files only. The three effects (`resolveDomain`, `probeHttps`, `sshHost`) are optional dependencies set in `main.ts` only, as `fetch` is; tests set stand-ins, and a test checks who may use them.

**R29. A rollback's routes.** A rollback signs the routes the server says are in force (R20), shown in the panel before signing, and the health check of the deploy this machine signed with that number, if it has it. The server's word decides only what its own proxy does.

2026-11-19: the health check is the server's word too. A rollback from a machine that did not sign the deploy in force signed no health check, and after `routes_failed` this machine's record named a check the server did not hold. The runner's entry for an app now keeps the health check beside its routes, written together from the deploy that put them in force (runner.md, RN9), and `status` with routes answers it as `health` (core.md); a rollback signs that one, whichever machine runs it. It asks for both unless this machine signed the deploy in force, it was put in force, and it had neither. A runner that does not tell them stops a rollback of an app this machine signed either for (B10, security review S4 and part 8). The answer's new field needed a limit for it to fit its frame: 256 KiB of health checks on a server (`LIMITS.healthBytesPerServer`). The server's word still decides only what its own runner does (security review, part 8).

**R30. "Changed, not deployed" for the two settings.** Domains and health checks are not in the Compose text. The history on this machine keeps the routes and the health check of each version-2 deploy it signed, and the mark compares the file with those.

**R31. Lists.** `domains` is typed like `secrets` (`zekno settings set web.domains "a.example.com, b.example.com"` replaces the list) and shown one a row. `zekno domain add` and `rm` work out the new list and go through the same change, question and write as `zekno settings set`.

**R32. The frozen transcripts.** `plain-unchanged.test.ts` compares the help with the help of an earlier commit, less a list of lines added since. Features 010 and 012 added their lines to that list; this feature adds the lines of `zekno domain`. The line of `zekno deploy` is not edited: `--skip-dns-check` is said on a line of its own. A deploy of an app without domains makes no new call of any kind, so the frozen scenes hold.

## Open after research

**R33. To try on Linux, in the proof.** The wording of a taken port on Docker Engine; names across restarts and the order of R8 on Linux; rootless Docker and ports below 1024; search domains in a container's resolver configuration (a name that resolves to nothing could be asked of an outside resolver with a search domain appended).

**R34. Not built.** A doctor line for "port 80 is in use" (the board `DomainsList` names it in a note): the runner cannot know that without trying to start the proxy, and the deploy that tried says it (B16). `zekno doctor` says whether the proxy runs.
