# Research record: where the core library and the runner change (a snapshot at commit 2d00a64)

Written by an Opus agent on 2026-11-19 from reading the code; line numbers go stale. Proposals in it are the agent's; what was decided is in [research.md](../research.md) and the contracts.

## SUMMARY (≤500 words)

**Proposed API changes**
- F7: in `carriedOut()` (packages/core/src/deploy/message.ts:148-166), drop the `health` and `routes` conditions and keep `builds` and `predeploy`. Add no new parameter: core ships inside the runner, just as `RUNNER_PROTOCOL` does. If the plan wants it written down, add a constant next to `RUNNER_PROTOCOL` (proposed `LATER_FIELDS_CARRIED_OUT`).
- `createDeployV2` (deploy-v2.ts:81-98): add top-level `routes?: readonly Route[]` and `health?: Health | null`. `later` keeps only `builds` and `predeploy`. Sort both lists and refuse duplicates with `invalid_argument`, the way secrets are handled (:155-163).
- Domain rule (later-fields.ts:151-161): change the `xn--` check to `if (label.startsWith("xn--")) return false`, and delete `isALabel` (:138-141) and the `node:url` import (:10). Non-ASCII is already refused by `LABEL` (:131). The tests that pin today's behaviour are routes-and-checks.test.ts:199-201, which currently pass three `xn--` names.
- Export `isRoutableDomain` from index.ts; it is not exported today. Add a path predicate, plus a reason form so the CLI can tell A10 from A11.
- State: bump the mark to `v: 3` and add `routes: Record<app, {routes: Route[], aliases: Record<service, {container, alias}[]>}>`. A v2 or unmarked state is migrated in memory to `routes: {}`. state.test.ts:80 and :89 pin today's refusal of `v:3` and `routes`. `verifyDeployV2` must copy `routes: state.routes` into `nextState` (deploy-v2.ts:343-353), because that object lists its fields one by one.
- `status`: return `domains` only when the request input asks for it. Today the input is ignored (session.ts:170). `RunnerStatusSchema` is strict in every released zekno, and `zekno status`, `logs`, `doctor` and deploy all parse it.
- Protocol: `RUNNER_PROTOCOL` 3→4 (protocol.ts:260, pinned at messages-v2.test.ts:179). Add `domain_taken` to `DEPLOY_V2_REFUSALS` (result.ts:46). Add `unhealthy` to `RUNNER_OUTCOMES` (protocol.ts:179). `RunnerReportSchema` gains an optional `routes:{failure: port_taken|no_container|host_network|not_loaded, service?, port?: 80|443, app?}`, allowed only with `start_failed`, and `health:{service}`, present exactly when the outcome is `unhealthy`.

**Insertion points (runner)**
- `domain_taken` goes in core `verifyDeployV2`, after the K10 expiry check (:314-330) and before K11 (:332). Label it "K10b" to avoid renumbering.
- The 1,024-domain limit is K15 (deploy.ts:110-115): `too_large`.
- Steps 18 and 19 come after `up` in deploy.ts:128. Split `startApp`, which `apply` shares. All of this stays under the single deploy lock (`locked`).
- Route save order: config written atomically → validated → loaded → only then `writeState(withAppRoutes(...))`. If the load fails, reload from the state as it stands, leave the state alone, and report `start_failed` with `not_loaded`.
- Make no Docker call at all when an app has no routes now, had none before and has no health check (SC-005, and the existing tests).

**Risks**
1. Adding a field to `status` unconditionally breaks older zeknos everywhere.
2. Caddy's `SIGUSR1` reload gives no success answer. `docker exec caddy reload`, with the admin endpoint on the container's loopback, does.
3. Containers that `up` did not recreate are already connected, so `network connect` fails on them. Store container ids.
4. With one lock and no `up` limit, a health wait of up to 1,800 s makes `sync` answer `busy` (V11).
5. After a failed load, the app's old aliases may point at removed containers.
6. `fakeDocker` treats every unknown call as `up`. Extend it first.
7. The health-checker image is undecided: it needs no redirects, at most 1 KiB read and 5 s per try.
8. Doctor (FR-038) and the proxy replacement at server update need new runner commands.
9. Mount the `proxy/` folder, not the file: `writeAtomic` renames a new file into place. Root-owned certificate files under a non-root home cannot be deleted by the runner.
10. Raise protocol 4 only once health is also carried out.

## FULL MAP

### A1. routes/health in core
- Schemas: `HealthSchema` later-fields.ts:99-116 (path rule `PATH`, private, :96); `RouteSchema` :164-169; cross-field rules in `laterFieldsAreConsistent` :228-268 (health :262-266, routes :267). Payload fields `health`/`routes` at message.ts:69-70 inside `DeployV2Schema` :37-71. `readDeployV2Format` :92-116, `readDeployV2Bytes` (F41) :131-146, `carriedOut` (F7) :148-166, `readDeployV2Payload` and `readDeployV2PayloadBytes` :175-186 (the second is not exported). The gate applies F7 at deploy-v2.ts:272-275; `readSignedDeployV2` (:207-224) does not.
- LIMITS (limits.ts:72-81): healthServices 16, healthPathLength 1024, healthSeconds 1800, routesPerDeploy 64, domainLength 253. Missing: `domainsPerServer` (1,024, design part 8).
- Exports (index.ts:87-101): Route, Health, readDeployV2Payload, buildKey. Not exported: isRoutableDomain, RouteSchema, HealthSchema, the path rule.
- Tests that pin F7 for these fields: core message.test.ts:259-305; deploy-v2.test.ts:121-133, 194-197, 229-243; runner scenarios/deploy-v2.test.ts:191-247. Callers of `later`: apps/runner/test/support/deploy-v2.ts:129,164; packages/core/test/support/deploy-v2.ts:99. CLI signer: apps/cli/src/ops/deploy-send.ts:317.

### A2. Domain rule
The current code is quoted in the summary: `LABEL /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/`; `if (label.startsWith("xn--") && !isALabel(label)) return false`; last label not all digits; `SPECIAL_USE` :119-129.
- Change: refuse every `xn--` label. Optionally test `^[\x21-\x7e]*$` first, so the CLI can give the A11 reason.
- Also update the comments (:133-150), contract message.md F40, and deploy-v2.md:566-573.
- Tests: move :199-201 to the malformed list; reword the comment at :225-231; add S7's probes `xn--ls8h.la` and `xn--fa-hia.de`.

### A3. State and status
- Today: `StoredRunnerState` state.ts:90-94; strict schema :103-112; `readMarked` :115-120; `readRunnerState` :131-139; `newRunnerState` :145-150; `afterVersionOneDeploy` spreads `...marked` (:170-181), so `routes` would survive a version-1 deploy.
- Proposed v3 refines:
  - every routed app has format 2, which makes FR-036's runner half hold by construction;
  - routes are sorted and unique;
  - no domain is held by two apps;
  - total domains ≤ domainsPerServer;
  - aliases are unique;
  - the alias keys are exactly the routed services.
- Proposed helpers in a new packages/core/src/deploy/routes.ts: `domainHolders(state)`, `domainCountAfter(state, app, routes)`, `withAppRoutes(state, app, appRoutes|null)`.
- Status: `RunnerStatusSchema` is at protocol.ts:214-245 and is built in commands.ts:150-170. Proposed: `RunnerStatusRequestSchema = z.strictObject({domains: z.literal(true)})` and optional `domains: record(app, domain[] ≤64)` with a total ≤1,024. Runners 0.1.0 and 014 ignore the input, so an older runner just answers the old shape. Frame budget: 4 MiB; today's ~2.1 MiB plus ~0.3 MiB still passes the ×1.5 check in messages.test.ts:602-626.

### A4. Protocol
The CLI constant is `VERSION_TWO_PROTOCOL = 3` (apps/cli/src/ops/deploy-format.ts:24). Add a proposed `ROUTES_PROTOCOL = 4` there for B10. C7 (:47-49) already stops a protocol-3 zekno. The CLI's check of the report outcome (deploy-send.ts:153-161) and its history must learn `unhealthy`. `StatusReportSchema` stays unchanged.

### B1. deploy.ts order
- Before the new steps:
  - K1 :85-87.
  - K2 `locked` :89 (commands.ts:177-194).
  - K3 :93-96.
  - K4-K14 :98-108.
  - K15 :110-115 (`withinLimits` commands.ts:103-105, `recordsFit` deploy.ts:50-78).
  - K16 :117-119.
  - K17 :121-128: records, then `writeState(nextState)`, which uses the number, then `startApp` (commands.ts:215-235).
- Step 18, in order:
  1. Ensure the network `zekno-route-<app>`, labelled.
  2. Find the routed services' containers (`compose ps -q` or label filter), check their labels, exclude one-off containers. Report `no_container` or `host_network` where they apply.
  3. Connect each container with a new random alias, verify, retry (D14).
  4. Ensure the pinned proxy. Report `port_taken` if 80 or 443 is taken, and remove the `Created` leftover. Connect or disconnect the proxy from route networks.
  5. Write the config atomically, validate, load.
  6. Save the routes, or on failure revert the proxy to the old config.
  7. Release: delete the dropped domains' certs after the reload, remove unused networks, stop the proxy when no app routes.
- Step 19: health. HTTP checks run from a pinned container on the route network. Checks without a path use Docker health, or a stable restart count for 10 s. On failure: `unhealthy` with the service.
- Everything stays inside the one lock: R12 decided on one lock and no `up` limit.

### B2. Docker
- compose.ts:
  - `PASSED_THROUGH` and `dockerEnv` (:4-24).
  - `dockerCommand` = `ZEKNO_DOCKER || "docker"` (:26).
  - `readLines` (:46-70).
  - `composeUp` (:77-149): cwd=dir, env = secrets plus `dockerEnv`, progress lines cut to 4096, no timeout, returns 127 when Docker cannot start.
- inspect.ts: `stopChild` (:88-96: SIGTERM, then SIGKILL after 2 s); private `dockerOutput` (:103-152: timeout and abort, stdout capped, stderr dropped, undefined on a non-zero exit); `appStates` (:164-188); `followLogs` (:221-285).
- Proposal: a shared docker/run.ts returning `{code, stdout, stderr}`. Classifying a taken port needs stderr.
- Stand-in: helpers.ts:98-208 `fakeDocker`. It dispatches on `$4` (ps|logs → inspect.log, scripted by `ps-<project>`/`logs-<project>` files). Every other call goes to calls.log and behaves like `up` (up-stdout, up-hold/up-go, exit file). `leftAsItWas` (support/deploy-v2.ts:221-232) checks only `calls()`.
- The runner has no real-Docker tests; the only gated one is `ZEKNO_REAL_BUILD=1` (second-build.test.ts:816-822). Real-Docker tests live in the CLI: scenarios/real-docker.test.ts, templates-real-docker.test.ts, templates/docker.test.ts. They are gated on `docker info` plus the image being present locally (caddy:2.11.9); they never pull and clean up in `afterAll`.

### B3. Home
- `paths` home.ts:73-79; `ensureDir` :89-92; `takeDir` :99-102; `isPrivate` :110-121; `writeAtomic` :140-163; `writeState` :202-205; `writeCompose` :208-218; `acquireLock` :239-296; records at home/records.ts:40-47.
- Add `proxy/caddy.json`, but bind-mount the `proxy/` folder read-only. Use a labelled Docker volume for the certificate data.
- `setup` (commands.ts:112-147) only gains `routes: {}` through `newRunnerState`.

### B4. Sessions
- To register a command: add it to `SESSION_COMMANDS` (protocol.ts:269-280), give it a bound in `SESSION_FRAME_BYTES` (:339-356, deploy 64 KiB), add a case to `handle` (session.ts:151-208), and add it to main.ts `COMMANDS` (:20) only if it is one-shot.
- Limits: request lines up to 32 MiB; queue of 1,024 lines; 3 bad lines end the session; non-result frames are dropped beyond 8 MiB unsent.
- Progress: `sink.write({event:"progress", line})` (:181-185). Free-text lines already work, but the CLI accepts one event kind per command (cli server/session.ts:106-110, :339). For C1/C2 propose `HealthEventSchema {event:"health", service}`.

### B5. Release
- apps/runner/package.json 0.1.0. apps/cli/src/version/runner-release.json, read by runner-release.ts and written by second-build.ts after publishing.
- runner-release.yml with `release.ts check`: the tag must equal package.json (:159-163), Bun must be pinned, a prod tag must carry no dev JSON (:172-178), and the built runner must report the version (:257-270). main-versions.yml enforces the main-branch versions. Process in RELEASING.md.
- Pins:
  - messages-v2.test.ts:179 (protocol 3);
  - older-programs.ts:15-17 (runner-v0.1.0, e7b0146). Add the 014 tip as a third ref for US7 sc.3;
  - pull-request-checks.yml:39-42;
  - many CLI fixtures use "0.1.0", and cli test/version/version.test.ts:86-87 pins it;
  - docs pages in apps/web/content name runner 0.1.0.
- New pins: the proxy digest and the health-checker digest.

### C. Risks
The ten risks in the summary.
