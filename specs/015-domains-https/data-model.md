# Data model: domains and HTTPS (feature 015)

Shapes and rules in full: [contracts/core.md](./contracts/core.md), [contracts/runner.md](./contracts/runner.md), [contracts/cli.md](./contracts/cli.md).

## In the project folder: the settings file

| Field | Where | Rule |
|---|---|---|
| `domains` | `services.<name>.networking.domains` | 1 to 64 lowercase names passing the domain rule; none twice in the file; the service has a port |
| `healthcheck.path` | `services.<name>.deploy.healthcheck.path` | optional; the path rule; the service has a port |
| `healthcheck.timeout` | `services.<name>.deploy.healthcheck.timeout` | optional; 1 to 1,800 seconds; 60 when left out |

Holds no address, no certificate and no key.

## Signed: the version-2 deploy (format unchanged)

| Field | From |
|---|---|
| `routes[]` `{ domain, service, port }`, sorted by domain | each domain of each service, with that service's port |
| `health` `{ timeout, services[] }` or `null` | the services with a health check, sorted; `timeout` the largest of theirs; `http: { port, path }` with a path, `null` without |

A rollback signs the routes and the health check the server holds for the app (its entry in the runner's state, as `status` with routes answers them), whichever machine signed the deploy in force.

## On the server: the runner's state (mark 3)

`routes[app] = { routes: Route[], health: Health | null, names: { [service]: { container, name }[] } }`. The routes and the health check **in force**: written together, from one signed deploy, only after the proxy loaded a configuration that has those routes. Who holds a domain is computed from it. Names are `z` and 32 hex characters, made by the runner, never by a deploy. The health checks of all apps take at most 256 KiB as `status` with routes writes them.

Transitions of an app's entry, each under the deploy lock:

| From | Event | To |
|---|---|---|
| none | a deploy with routes or a health check reaches its start, and the configuration loads | the wanted routes, the deploy's health check and the names given |
| any | the configuration does not load, or a container is not found (`routes_failed`) | unchanged: the routes and health check of the deploy that wrote it |
| any | a deploy with a route or a health check, loaded, then not healthy in time (`unhealthy`) | that deploy's routes and health check: saved before the wait |
| routes | a deploy that leaves a domain out, loaded | the entry without it, with that deploy's health check; its certificate deleted |
| any | a deploy with routes and no health check, loaded | its routes, health check `null` |
| any | a deploy with no route and no health check, loaded | none; its route network removed |
| any | a deploy that stops before its start (refused, a failed check) | unchanged |

## On the server: the proxy

| Thing | Lifetime |
|---|---|
| `<home>/proxy/etc/caddy.json` | rewritten whole whenever the routes in force or the names change; always computable from the state |
| container `zekno-proxy` | from the first route on the server to the last; made again when its image is not the pinned one |
| volume `zekno-proxy-data` | certificates, their keys and the Let's Encrypt account; kept when the container goes; a domain's folder deleted when it is released |
| volume `zekno-proxy-config` | Caddy's own copy of the last configuration it loaded; read to confirm a load |
| network `zekno-route-<app>` | while the app has a route or a health check |

## On the developer's machine

| Thing | What changes |
|---|---|
| The history of an app | an entry of a version-2 deploy keeps its `routes` and `health`; outcomes gain `routes_failed` and `unhealthy` |
| Nothing else | no certificate, no key, no address is stored; what `zekno domain` shows is asked each time |

## The state of a domain, as shown

Nine states, each from three sources: the settings file (is it there), the server (who holds it), and this machine's own lookups (where DNS points, what HTTPS answers). Order and words: [contracts/cli.md](./contracts/cli.md), CL4.

## Outcomes of a deploy

`refused` (no number used) → `start_failed` → `routes_failed` → `unhealthy` → `started`. The last four use the number, and the app's Compose project is whatever `docker compose up` left.
