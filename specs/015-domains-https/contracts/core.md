# Contract: the core library (`packages/core`)

For FR-016, FR-020 to FR-022, FR-027 to FR-029, FR-036. Decisions: [research.md](../research.md) R15 to R21. A snapshot of the code as it was: [research/map-core-runner.md](../research/map-core-runner.md). Rule numbers continue feature 014's ([message.md](../../014-deploy-v2/contracts/message.md), [runner-checks.md](../../014-deploy-v2/contracts/runner-checks.md), [state.md](../../014-deploy-v2/contracts/state.md), [protocol.md](../../014-deploy-v2/contracts/protocol.md)); those files stay as the record of 014 and are not edited, except where this contract says a rule changes.

## The domain rule (changes F40)

`isRoutableDomain(text)` is true only when `text`:

1. is 1 to 253 characters of lowercase ASCII letters, digits, hyphens and dots;
2. has at least two labels, each 1 to 63 characters, none starting or ending with a hyphen;
3. has **no label that starts `xn--`** (new; the code that decoded such labels and the `node:url` import go);
4. has a last label that is not all digits;
5. has no trailing dot, is not `localhost`, and is under none of the special-use names feature 014 lists.

New export `domainFault(text): "not_ascii" | "not_routable" | undefined`: `not_ascii` when `text`, lowercased, has a character outside printable ASCII or a label that starts `xn--`; `not_routable` for anything else the rule refuses; `undefined` when `isRoutableDomain(text.toLowerCase())`. `isRoutableDomain` itself does not lower its input: a signed route with an upper-case letter is refused, as today.

Exported from the package: `isRoutableDomain`, `domainFault`, `RouteSchema`, `HealthSchema`, and `isHealthPath(text)` (the path rule of F38, unchanged).

Tests that pin the old rule move: the three `xn--` names that pass today are refused, and the review's probes `xn--ls8h.la` and `xn--fa-hia.de` are added as refused.

## Carried out (changes F7)

`routes` and `health` are no longer later fields. A version-2 deploy with `builds` not `[]` or `predeploy` not `null` is still refused `unsupported_version`. No option is added to the verifier.

`createDeployV2` takes `routes?: readonly Route[]` (default `[]`) and `health?: Health | null` (default `null`) as inputs of their own. It sorts routes by domain and health services by service, and throws `CoreError("invalid_argument")` for a domain or a service given twice. `later` keeps `builds` and `predeploy`, for tests only.

## Who holds a domain (new check K10b)

In `verifyDeployV2`, after the expiry check (K10) and before the secrets (K11): for each route of the deploy, if `state.routes` holds that domain for **another** app, the result is refused `domain_taken`. Nothing is written and no number is used. `domain_taken` joins `DEPLOY_V2_REFUSALS`.

The state `verifyDeployV2` gives back carries `routes` over **unchanged**. The routes in force change later, when the runner has put them in force ([runner.md](./runner.md), RN9).

## The state (changes ST1 to ST3)

```ts
type AppRoutes = {
  /** The routes in force, sorted by domain. */
  routes: Route[]
  /** The health check of the deploy whose routes these are, or null when it had none. */
  health: Health | null
  /** For each routed or checked service: the containers found and the name given to each, sorted by container. */
  names: Record<string /* SERVICE_NAME */, { container: string /* 64 hex */; name: string /* z + 32 hex */ }[]>
}
type StoredRunnerState = RunnerState & {
  v: 3
  formats: Record<string, 1 | 2>
  routes: Record<string /* APP_NAME */, AppRoutes>
}
```

Read strictly. A state marked `3` must also satisfy:

- every app in `routes` is in `formats` at format 2 (so a version-1 deploy can never be taken for an app that holds a domain: FR-036);
- within an app, routes are sorted by domain and each domain appears once; across apps, no domain appears twice;
- the domains of all apps together are at most `LIMITS.domainsPerServer` (new, 1,024);
- every name is `^z[0-9a-f]{32}$` and appears once in the whole state; every container id is 64 hex;
- at most `LIMITS.routesPerDeploy` routes an app, at most 16 containers a service;
- each `health` is `null` or a health check by the rules of a signed deploy's (`HealthInForceSchema`: `HealthSchema`, its services sorted and each once, F6);
- the health checks of all apps together, as `status` with routes writes them (`{ [app]: Health }`), are at most `LIMITS.healthBytesPerServer` bytes (new, 256 KiB).

An entry's `routes` and `health` are written together, from one signed deploy ([runner.md](./runner.md), RN9), so they never come from two deploys. An app may be in `routes` with `routes: []`, a health check and names (a health check with no domain). An app with neither a route nor a health check is not in `routes`. An entry without `health` is refused: no released runner wrote mark 3, so no state is read forward from one that lacked it.

Reading: a state marked `2` is read as it was and given `routes: {}` in memory, so no health check in force either; a state with no mark is read as feature 014 reads it and then the same. A state marked anything else is refused. `newRunnerState` writes mark 3 with `routes: {}`. The runner writes mark 3 from its first write on.

New module `deploy/routes.ts`:

- `domainHolders(state): Map<domain, app>`
- `domainsAfter(state, app, routes): number`: how many domains the server would hold with this app's routes replaced.
- `healthInForce(state): Record<app, Health>`: the health check of each app that has one, in order of the apps' names; what `status` with routes answers as `health`.
- `healthBytesAfter(state, app, health): number`: how many bytes the health checks in force would take, as written, with this app's replaced.
- `withAppRoutes(state, app, appRoutes | null): StoredRunnerState`: the state with this app's entry replaced or removed, read back through the strict schema.

`deploy/routes-and-checks.ts` also exports `HealthInForceSchema` and `healthBytes(record)`, the bytes of a record of health checks by app written out as JSON.

## The protocol (changes P1)

`RUNNER_PROTOCOL = 4`: the runner carries out `routes` and `health`, answers `status` with routes when asked, and answers `proxy`.

`RUNNER_PROTOCOL = 5` (2026-11-20; security review, lead A10): the runner stops waiting for `docker compose up` at a time limit ([runner.md](./runner.md), RN3), and the report of a version-2 `deploy` may carry `startLimit` (below). Nothing else changes: a runner of protocol 4 still carries out routes and health checks, so a zekno of protocol 5 deploys to it with or without them (`ROUTES_PROTOCOL` stays 4) and only says it is older, and a zekno of protocol 4 is told by a runner of protocol 5 to update before it signs anything (C7), since it would not read `startLimit`.

**Outcomes.** `RUNNER_OUTCOMES` gains `routes_failed` and `unhealthy`. `RunnerReportSchema` gains three optional fields:

| Field | Shape | Allowed when |
|---|---|---|
| `routes` | `{ failure: "port_taken" \| "no_container" \| "host_network" \| "not_loaded", service?: SERVICE_NAME, port?: 80 \| 443 }` strict | exactly when the outcome is `routes_failed`. `service` exactly with `no_container` and `host_network`; `port` exactly with `port_taken`. |
| `health` | `{ service: SERVICE_NAME, http: boolean }` strict | exactly when the outcome is `unhealthy`. `http` says whether the check had a path. |
| `startLimit` (protocol 5) | an integer from 1 to 86,400: the time limit, in whole seconds, at which the runner stopped waiting for `up` | only with `start_failed`, and exactly when the runner stopped waiting at its limit. A `start_failed` without it is a start that failed for another reason, as before. Only the report of a version-2 `deploy` carries it: the report of `apply` (version 1, in a session or one-shot) stays as every older zekno reads it. |

Still no free text in a report.

**Event.** `SessionEventSchema` gains `{ event: "health", service: SERVICE_NAME }`, sent by `deploy` when the wait for that service begins. The `deploy` request may send `progress` and `health` events.

**`status` with routes.** The request may carry the input `{ "routes": true }` (strict; any other input is refused `invalid_request` by a runner of protocol 4, and ignored by older runners, which never read it). The answer is then `RunnerStatusWithRoutesSchema`: today's fields and

- `routes`: `Record<APP_NAME, Route[]>`, the routes in force of each app that has any, within the limits above;
- `health`: `Record<APP_NAME, Health>`, the health check in force of each app that has one (the `health` of its entry in the state), each by `HealthInForceSchema`, at most `LIMITS.appsPerServer` apps and `LIMITS.healthBytesPerServer` bytes as written. Required: protocol 4 was never released without it;
- `proxy`: `"none"` (no app has a route and none runs), `"running"`, `"stopped"`, `"missing"` (an app has a route and the container is not there), or `"other_image"` (it runs from an image that is not the pinned one).

A rollback signs the routes and the health check this answer gives for its app ([cli.md](./cli.md), CL3 step 4). Without the input the answer is today's `RunnerStatusSchema`, unchanged, so every older zekno reads it.

**`proxy`.** A new session command with no input. The answer: `{ "proxy": "none" | "running" }` on success, or a report with outcome `routes_failed` and `routes.failure` of `port_taken` or `not_loaded`. Frame bound: 4 KiB.

## Limits

`LIMITS.domainsPerServer = 1024`. `LIMITS.healthBytesPerServer = 256 * 1024`: without it, 1,024 apps each with the largest health check a deploy may carry (16 services, paths of 1,024 characters) would make the answer to `status` with routes about 20 MiB, past its frame of 4 MiB; with it, the largest answer is about 2.6 MiB and fits with room to spare, as the frame's test checks. The others are feature 014's.

## What stays

The payload's format and its one-spelling rule; every other check and its order; the kinds and hash domains; version 1.
