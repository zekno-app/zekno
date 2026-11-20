# Contract: the runner (`apps/runner`)

For FR-021 to FR-029, FR-038, FR-042. Decisions: [research.md](../research.md) R1 to R13, R21 to R25. The facts about Caddy and Docker behind every rule: [research/caddy-on-docker.md](../research/caddy-on-docker.md). The code as it was: [research/map-core-runner.md](../research/map-core-runner.md).

## Names the runner uses

| Thing | Name |
|---|---|
| The proxy's container | `zekno-proxy`, labelled `app.zekno.server=<server id>` and `app.zekno.role=proxy` |
| The proxy's own network | `zekno-proxy` |
| An app's route network | `zekno-route-<app>`, labelled `app.zekno.server=<server id>` and `app.zekno.app=<app>` |
| The proxy's volumes | `zekno-proxy-data` on `/data`, `zekno-proxy-config` on `/config` |
| The configuration | `<home>/proxy/etc/caddy.json`; the folder is mounted read-only at `/etc/zekno-proxy` |
| A container's name on a route network | `z` and 32 hex characters from the system's random source |
| The image | `caddy@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0`, a constant in `proxy/image.ts` and nowhere else |

Nothing in this table is taken from a deploy.

## RN1. Docker calls

Every new call goes through `docker/run.ts`: it runs `ZEKNO_DOCKER || "docker"` with the environment the existing calls use, a time limit, and returns `{ code, stdout, stderr }` with each output capped. No shell is involved: arguments are passed as a list. The existing `composeUp`, `appStates` and `followLogs` stay as they are, except that `composeUp` has a time limit since 2026-11-20 (RN3).

## RN2. Before the number is used

In `deploy`, with the other limits (K15): `domainsAfter(state, app, routes) > LIMITS.domainsPerServer` is refused `too_large` (the count holds the domains in force with this deploy's in place of the app's, and the state's `released` as it would be after this deploy, so the state the deploy would write always fits; [core.md](./core.md), "The state"), and so is `healthBytesAfter(state, app, health) > LIMITS.healthBytesPerServer` (the health checks in force, as `status` with routes writes them, with this deploy's in place of the app's). `domain_taken` is the core library's (K10b). Neither uses a number or touches Docker.

## RN3. When the steps run

After the state with the new number is written and `docker compose up` has returned, under the same lock. Let *wanted* be the deploy's routes and health, and *held* the app's entry in `state.routes`.

- **Nothing to do**: no wanted route, no wanted health, nothing held. With the state's `released` empty, no Docker call is made beyond today's. With domains on it, RN10's step 1 is tried for them after `up`, whether `up` worked or not: the proxy found (`docker inspect zekno-proxy`), the deletions, the state saved with those known gone taken off. The outcome is today's either way: a deletion that fails is not reported.
- Otherwise RN4 to RN10, then RN11 when the deploy has a health check.

If `up` failed (exit status not 0), the outcome is `start_failed` as today, and RN4 to RN10 are still carried out as far as they go, so that a domain released by this deploy is released; their own failure is not reported over `start_failed`. RN11 is skipped.

**The time limit on `up`** (2026-11-20; security review, lead A10; protocol 5). `docker compose up` gets 30 minutes (`START_LIMIT_MS` in `docker/compose.ts`, defined there once, with no setting to change it). An `up` that has not returned by then, such as one waiting on a `depends_on` container that never exits, is stopped as every other Docker call is (`stopChild`: asked, then killed after 2 seconds), and its outputs get at most `OUTPUT_GRACE_MS` (1 second, `docker/run.ts`) more to close, since a process Docker left behind could keep them open. No line Docker prints after that is sent. Nothing else is done to the app: what Docker made stays as it is, exactly as after any failed start. The start counts as failed (`start_failed`), with all that follows above, and the lock is released when the command ends, as always. This holds for every start: the version-2 `deploy` and version 1's `apply`, in a session and one-shot. Only the report of `deploy` says the limit was hit, with `startLimit`, the limit in whole seconds ([core.md](./core.md), "Outcomes"); the report of `apply` is `start_failed` with nothing more, as every older zekno reads it.

## RN4. The containers of a service

For each service named by a wanted route or a wanted health entry: `docker compose -p zekno-<app> ps -q <service>` in the runner's folder, then `docker inspect` of each id. A container counts only when its labels say Compose project `zekno-<app>`, that service, and not a one-off container. A service with no such container: `no_container` with the service. A container whose network mode is `host`: `host_network` with the service. At most 16 containers a service; more is `no_container` (the deploy is outside what this version routes).

## RN5. The route network and the names

`docker network inspect zekno-route-<app>`; if it is not there, `docker network create` with the labels. A network of that name without the runner's labels for this server and app is not used: `not_loaded`.

For each container of RN4: if the held names have this container id and `docker inspect` shows that name among its aliases on the route network, the name is kept. Otherwise a new name is made and `docker network connect --alias <name> zekno-route-<app> <container>` is run, then `docker inspect` must show the alias; if not, once more, then `no_container`.

## RN6. The proxy's container

Needed when any app would have a route after this deploy.

- Not there: `docker run -d` with the name, labels, `--restart unless-stopped`, `--network zekno-proxy` (created if missing), `-p 80:80 -p 443:443`, the two volumes, the folder mount read-only, `--cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges`, a bounded log (`--log-driver local --log-opt max-size=10m --log-opt max-file=3`), no search domains (`--dns-search .`), packet forwarding off (`--sysctl net.ipv4.ip_forward=0`: the proxy is on every routed app's network at once), the pinned image, `caddy run --config /etc/zekno-proxy/caddy.json`. Before the first run, and before a stopped proxy is started, the configuration of RN7 is validated in a short-lived container of the pinned image (no network, no capability, the folder read-only) and put in place, so the proxy never starts on an old file or on one Caddy has not validated.
- Exit 125 with `port is already allocated` or `address already in use` in standard error: remove the container left behind, outcome `routes_failed` with `port_taken` and the port named in the text (80 when neither can be told).
- There, not running: `docker start`.
- There with another image, or with labels of another server id: with another image it is removed and run again; with another server's label nothing is done and the outcome is `routes_failed` with `not_loaded` (one runner a Docker daemon).
- Started when the log shows `serving initial configuration` within 15 seconds.

With `ZEKNO_PROXY_TEST=<http>:<https>` in the runner's environment (two port numbers above 1023), the ports are published as `127.0.0.1:<http>:80` and `127.0.0.1:<https>:443` and the configuration uses Caddy's internal issuer. Read from the environment only.

## RN7. The configuration

Built by `proxy/config.ts` from the state with this app's wanted routes and new names in place of what it held, and from nothing else: every app's routes, each domain to the names of its service's containers and the route's port. The shape is the one in research R2, exactly: admin disabled; one server on `:443`, `h1` and `h2`; a route a domain with `terminal: true`; a last route answering 404; the `acme` issuer with Let's Encrypt's directory and its staging directory as `test_ca` (the internal issuer under the test switch); `grace_period` of 10 seconds; JSON logs to standard error, without the request loggers `http.log.error` and `http.log.access` (a visitor must not be able to write to the log: security review S1); the request headers `X-Real-Ip` and `Forwarded` deleted before a request reaches the app (S8); a new nonce `@id`.

Every domain, name and port written into it is checked against its pattern in that module again, whatever checked it before: a value that does not match makes the build throw, and the outcome is `not_loaded`. The text is `JSON.stringify` of an object; no string is put together by hand.

Routes are written in the order of their domains, so the same state gives the same text apart from the nonce. The configuration is loaded only when it differs, nonce apart, from the file in place.

## RN8. Loading it

1. Connect the proxy to each route network it needs and is not on (`docker network connect`). Joining comes before loading.
2. Write the text to a second file, `caddy.next.json`, with the runner's atomic write.
3. `docker exec zekno-proxy caddy validate --config /etc/zekno-proxy/caddy.next.json` must exit 0. Only then is the file renamed over `caddy.json`; a refused file is removed, and `caddy.json` is as it was (security review S7).
4. Note the time; `docker exec zekno-proxy kill -USR1 1`. Never `docker kill`.
5. `docker exec zekno-proxy grep -q -F` for the nonce in `/config/caddy/autosave.json`, every 200 ms for at most 15 seconds, until it succeeds. The nonce decides: Caddy writes that file only when a load worked. Between tries `docker logs --since <time> zekno-proxy` is read only to stop early, on a line with `"signal":"SIGUSR1"` that says `failed to reload config from file` (S1).

Any step failing is "not loaded". A proxy that was just started on this file (RN6) needs step 5 only: the file was validated before the start.

## RN9. Saving, or going back

- **Loaded**: write the state with `withAppRoutes(state, app, { routes: wanted, health: wanted health, names })`, or with the app's entry removed when it has no wanted route and no wanted health. The routes and the health check are written at this one moment, from this one signed deploy, so an entry never holds one deploy's routes with another's health check. The same write puts each domain the app held and no longer has on the state's `released`, and takes off it each domain the app now holds. The state is read again under the state lock first, as every write does.
- **Not loaded**: build the configuration from the state as it is, and load it by RN8 (if that fails too, nothing more is tried). When the new file was refused by the validate, nothing was replaced, and nothing is loaded back. The state is not written: the app keeps the routes and the health check of the deploy that put its entry in force, or no entry. The outcome is `routes_failed` with `not_loaded`.

Any other `routes_failed` (RN4 to RN6) stops before the state is written too, with the same result. An `unhealthy` deploy was saved here before its wait (RN11): its entry holds its own routes and health check. A `start_failed` deploy holds whatever RN4 to RN9 reached, by the same two rules.

## RN10. What was released

After a load that worked, in this order:

1. For each domain on the state's `released`, as RN9 saved it (the domains this deploy released, and any an earlier deletion left), in order: `docker exec zekno-proxy sh -c 'rm -rf "/data/caddy/certificates/"*"/<domain>"'`, the domain having matched the domain rule in this module. When the runner's proxy is stopped or gone and the volume `zekno-proxy-data` is there, the same deletion runs in a short-lived container of the pinned image that mounts the volume, with no network and no capability (security review S2). No OCSP staple is deleted: the glob reached another domain's, and Let's Encrypt has none any more (S5). Then the state is read again and, when any certificate is known to be gone, saved with those domains taken off `released` (`withoutReleased`). A certificate is known to be gone when its deletion exited 0, inside the proxy or in the short-lived container, or when the proxy is this runner's and stopped or gone and Docker says the volume does not exist (there is nothing to delete). It is not when Docker did not answer (about the proxy or about the volume), when the proxy is another server's, or when the deletion failed or timed out: the domain stays on `released`. A call Docker did not finish in its time, or could not start, ends the round; the domains not tried stay too.
2. Disconnect the proxy from the route network of an app that has no route any more. Leaving comes after loading.
3. Remove the route network of an app with no route and no health check, once its containers are disconnected from it.
4. When no app has a route: `docker rm -f zekno-proxy`. The volumes and the proxy's own network stay.

A failure here is not reported in the outcome. A certificate not known to be gone stays on `released`, and step 1 is tried again for it at every later deploy of version 2, with routes (here) or without (RN3), and at every `proxy` request (RN13), until a deletion works (a deploy of version 1, of an app runner 0.1.0 held, tries none). The next deploy with routes or the `proxy` request puts the rest right. Where a load did not work (RN9, not loaded, and any other `routes_failed`), no deletion runs and `released` is as it was.

## RN11. The health wait

Before the first check with a path, the pinned image is looked for once (`docker image inspect`) and pulled only when it is missing, for at most 5 minutes, which do not count against the limit; a pull that fails makes the first service with a path `unhealthy`. For each service of the signed `health`, in order, send the event `health` with the service, then:

- **With `http`**: for each container's name, `docker run --rm --network zekno-route-<app> --read-only --cap-drop ALL --security-opt no-new-privileges --user 65534:65534 --memory 32m --pids-limit 16 --dns-search . <image> curl -sS -o /dev/null --max-time 5 --max-filesize 1024 --proto =http -w '%{http_code}|%{exitcode}' http://<name>:<port><path>`. Healthy: curl's exit is 0 or 63 and the status is 200 to 399. The path has matched the path rule; the URL is one argument.
- **Without**: `docker inspect` of each container: running and, if it has a health check, `healthy`; if it has none, running with the same restart count 10 seconds later.

One round every 2 seconds until every container of every listed service is healthy, or `timeout` seconds have passed since the wait began (not since `up` returned: the time RN4 to RN10 took, which can hold a first fetch of the proxy's image, is not the app's). The limit is looked at before each container, and a check is given the time left, at most 30 seconds (security review S3). Not in time: the outcome is `unhealthy` with the service that was not healthy and whether its check had a path. Nothing is stopped, rolled back or released.

## RN12. The outcome

In this order: `start_failed` (as today, with `startLimit` when `up` was stopped at its time limit, RN3); `routes_failed` (RN4 to RN9); `unhealthy` (RN11); `started`.

## RN13. `status` with routes, and `proxy`

`status` with the input `{ "routes": true }`: today's answer, `routes` and `health` from the state (`healthInForce`: the `health` of each entry that has one), and `proxy` from `docker inspect zekno-proxy`: `none`, `running`, `stopped`, `missing`, `other_image` ([core.md](./core.md)). It changes nothing. An app's routes and health check in the answer are those of its one entry, written together by RN9: what a rollback signs again, from whichever machine.

`proxy`: under the deploy lock, makes the proxy what the state needs by RN6 to RN8 and RN10's last step, from the state alone. It carries out no route a signed deploy did not put in force. Once the proxy serves the routes in force, or was removed because no app has a route, RN10's step 1 is tried for each domain on the state's `released` (the proxy found again, the deletions, the state saved); when the proxy was removed, the deletions run in the short-lived container. A `proxy` request that answers `routes_failed` tries none. The answer is the same whether a deletion worked or not, and neither answer reports `released`.

## Tests

- The stand-in for Docker (`test/support`) is extended first, so that each of `network`, `run`, `exec`, `logs`, `inspect`, `rm`, `start` and `compose ps` can be scripted and is recorded; a call it is not told about still behaves as today.
- Every rule above has a scenario against the real runner program with the stand-in: the calls made and their order (joining before loading, loading before leaving, `exec kill` and never `kill -s`), the file written, the state before and after, the outcome.
- A deploy without a route or a health check makes exactly today's calls when the state's `released` is empty.
- The time limit on `up` (RN3; `test/docker/compose.test.ts`, `test/scenarios/start-limit.test.ts`): the stand-in's `up` can be made never to end, to print without pause for ever, or to leave a process behind that keeps its outputs open. With a limit of two seconds passed in, the deploy answers `start_failed` with `startLimit`, the stand-in is gone, the lock is free (the next deploy is not `busy`) and the number is used; with a route, the routes are still carried out; `apply`, in a session and one-shot, answers `start_failed` with no `startLimit`; no line is sent once the answer is given; an `up` that ends in time is unchanged.
- The released domains (`test/scenarios/routes-certificates.test.ts` and `routes-released-state.test.ts`), with the stand-in keeping a certificate on the proxy's volume for each domain Caddy loaded and able to make a deletion fail: a deletion that fails keeps the domain on `released`; the next deploy of any app, with routes or without, and the next `proxy` request try again, after the proxy serves or after it was removed (through the short-lived container); once it works `released` is empty; a domain released and routed again, by the same app or another, keeps its certificate and is never deleted; a state whose `released` names a domain in force answers `invalid_state`; Docker not answering, a proxy of another server's and a volume known not to be there; K15's refusal past `LIMITS.domainsPerServer` with the list counted; a mark-3 state of runner 0.1.1-dev.1 read and saved as mark 4, which 0.1.1-dev.1 then refuses.
- The health check in force (`test/scenarios/health-in-force.test.ts`): what the entry holds and `status` with routes answers after a deploy with a health check and no route, with both, with a route and none, after a later deploy without one, after `routes_failed` and after `unhealthy`; `status` without the input unchanged; K15's refusal past `LIMITS.healthBytesPerServer`; an entry without `health` answered `invalid_state`.
- A gated set with real Docker and the pinned image (it never pulls; skipped with a line that says why): a deploy with a domain answers over HTTPS through the proxy with a certificate for that domain; HTTP is redirected; a second app cannot take the domain; a release stops the answer and deletes the certificate's folder; a container restarted behind its name is followed; a broken configuration leaves the earlier one serving; the health check passes, fails on 500 and on no answer, and follows no redirect; everything named `zekno-*` that the test made is removed.
