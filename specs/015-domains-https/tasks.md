# Tasks: Domains and HTTPS (feature 015)

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [design/lines.md](./design/lines.md) and the boards.

Tests are part of each task: a test that fails first wherever a contract fixes the behaviour. `[P]` marks a task that touches other files than its neighbours. Stories: US1 a domain and HTTPS, US2 the DNS check, US3 seeing domains, US4 removing and moving, US5 health checks, US6 rollback, US7 old and new programs.

## Phase 1: Core (blocks everything)

- [x] T001 Tighten the domain rule, remove the A-label code, add `domainFault`, in `packages/core/src/deploy/later-fields.ts`; move the pinned `xn--` cases and add the review's probes in `packages/core/test/deploy/routes-and-checks.test.ts` (core.md, "The domain rule")
- [x] T002 [P] Export `isRoutableDomain`, `domainFault`, `isHealthPath`, `RouteSchema`, `HealthSchema` from `packages/core/src/index.ts`
- [x] T003 `carriedOut` refuses only `builds` and `predeploy`, in `packages/core/src/deploy/message.ts`; update the tests that pin the refusal of `routes` and `health` (`packages/core/test/deploy/message.test.ts`, `deploy-v2.test.ts`)
- [x] T004 `createDeployV2` takes `routes` and `health`, sorted, refusing a repeat, in `packages/core/src/deploy/deploy-v2.ts` and the test supports that pass `later`
- [x] T005 `LIMITS.domainsPerServer = 1024` in `packages/core/src/protocol/limits.ts`
- [x] T006 The state marked 3 with `routes`, its strict rules, and reading marks 2 and none, in `packages/core/src/deploy/state.ts`; `packages/core/test/deploy/state.test.ts` (core.md, "The state")
- [x] T007 New `packages/core/src/deploy/routes.ts`: `domainHolders`, `domainsAfter`, `withAppRoutes`, with `packages/core/test/deploy/routes.test.ts`
- [x] T008 Check K10b `domain_taken` in `verifyDeployV2`, routes carried over unchanged in the state it gives back; `domain_taken` in `packages/core/src/protocol/result.ts`
- [x] T009 `RUNNER_PROTOCOL = 4`; outcomes `routes_failed` and `unhealthy` with the report's `routes` and `health` fields and their rules, in `packages/core/src/protocol/protocol.ts`
- [x] T010 The session event `health`; the request `status` with `{ routes: true }` and `RunnerStatusWithRoutesSchema`; the command `proxy` with its answer and frame bound
- [x] T011 Core tests for T008 to T010 (`packages/core/test/protocol/`, `test/deploy/`), including: a version-1 deploy can never be taken for an app in `routes`
- [x] T012 Core: type check, lint, format, all tests; the runner and the CLI still compile against it (their own tests may fail on protocol 4 until their phases)

## Phase 2: Runner

- [x] T013 `apps/runner/src/docker/run.ts`: one helper for Docker calls (RN1), with tests
- [x] T014 Extend the stand-in for Docker in `apps/runner/test/support` to script and record `network`, `run`, `exec`, `logs`, `inspect`, `rm`, `start`, `compose ps` (runner.md, "Tests"); existing scenarios pass unchanged
- [x] T015 The runner reads and writes the state marked 3; `setup`; the scenarios of feature 014 pass with protocol 4 (`apps/runner/src/commands/commands.ts`, `home/home.ts`, `test/support/older-programs.ts` gains the 014 tip as an older program)
- [x] T016 [P] `apps/runner/src/proxy/image.ts`: the pinned digest, and a test that it is named nowhere else
- [x] T017 [P] [US1] `apps/runner/src/proxy/config.ts`: the configuration from the state (RN7), patterns checked again, with `test/proxy/config.test.ts` (the exact JSON for one, two and no routes; a value that does not match throws; same state, same text)
- [x] T018 [US1] `apps/runner/src/routes/containers.ts`: the containers of a service (RN4), `no_container`, `host_network`
- [x] T019 [US1] `apps/runner/src/routes/network.ts`: the route network and the names (RN5)
- [x] T020 [US1] `apps/runner/src/proxy/container.ts`: start, start again, make again, remove, `port_taken`, the test switch (RN6)
- [x] T021 [US1] `apps/runner/src/proxy/load.ts`: join, write, validate, signal by `exec`, read the log, confirm the nonce (RN8)
- [x] T022 [US4] `apps/runner/src/proxy/certificates.ts`: deleting a released domain's folders (RN10)
- [x] T023 [US1] `apps/runner/src/routes/apply.ts`: RN3 to RN10 in order, saving or going back (RN9)
- [x] T024 [US1] `apps/runner/src/commands/deploy.ts`: `too_large` for domains (RN2), the steps after `up`, the outcome (RN12); `startApp` split so `apply` keeps today's behaviour
- [x] T025 [US1] Scenarios with the stand-in: a first route (calls and their order, file, state), a second app's route, an unchanged redeploy loads nothing, a container made again gets a new name and one kept keeps its own (`apps/runner/test/scenarios/routes.test.ts`)
- [x] T026 [US4] Scenarios: `domain_taken` uses no number; a release (load, then delete, then disconnect, then remove the network, as runner.md RN10 orders it); the last release removes the proxy (`test/scenarios/routes-release.test.ts`)
- [x] T027 [US1] Scenarios: every `routes_failed` (`port_taken` with the leftover removed, `no_container`, `host_network`, `not_loaded` with the state unchanged and the earlier configuration loaded again); `up` failed and routes still released (`test/scenarios/routes-failures.test.ts`)
- [x] T028 [US1] Scenario: an app with no route and no health check makes exactly today's calls (SC-005)
- [x] T029 [P] [US5] `apps/runner/src/health/check.ts` and `wait.ts`: one check with curl, Docker's own status, the rounds, the limit, the event (RN11)
- [x] T030 [US5] Scenarios: healthy, not healthy in time with a path and without, the app left as it is, a health check with no route gets a route network (`test/scenarios/health.test.ts`)
- [x] T031 [US3] `status` with routes and the proxy's state; `apps/runner/src/commands/proxy.ts` and its registration; scenarios (RN13)
- [x] T032 [US7] Scenarios: a version-1 deploy for an app with a route is refused; a state marked 2 is read and written as 3 (`test/scenarios/versions-routes.test.ts`)
- [x] T033 [US1] [US4] [US5] The gated set with real Docker, the pinned image and the internal issuer on high ports: every point of runner.md's last list (`apps/runner/test/scenarios/real-proxy.test.ts`), cleaning up what it made
- [x] T034 Runner: type check, lint, format, all tests, the compiled runner answers protocol 4

## Phase 3: CLI, settings and commands

- [x] T035 The CLI builds and its tests pass against protocol 4 with no route in use: `VERSION_TWO_PROTOCOL`, C7's cases, fixtures that pin protocol 3
- [x] T036 [P] `apps/cli/src/domains/rule.ts` and `words.ts`: lowering, A10 and A11 over the core's rule; every sentence of lines.md parts A, B, C, D and E as functions, with `test/domains/words.test.ts` pinning each word for word
- [x] T037 [US1] `domains` and the health check in `settings/shape.ts`, `types.ts`, `schema.ts` (the cross-service rules), `values.ts` (CL1)
- [x] T038 [US1] The two refusal sentences go from `settings/words.ts`; `CS5`, `settingWords`, `NOT_SET`; templates keep refusing both (`templates/*`)
- [x] T039 [US1] `settings/change.ts`: `domains`, `health`, `health-timeout` for `set` and `unset`
- [x] T040 [US1] `settings/text.ts`, `write.ts` (`FIELDS`), `piped.ts`: written, read back, printed
- [x] T041 [US3] `settings/rows.ts`: the `health` row and the `domains` rows, one a row, for `zekno settings` and the settings screen
- [x] T042 [US3] The history keeps `routes` and `health` of a version-2 deploy (`shared/history.ts`, `profile/profile.ts`); `lastDeployedSettings` feeds the "changed, not deployed" mark in `ops/settings.ts` and `app/effects/settings.ts`
- [x] T043 Update the settings tests and supports that pin the old sentences (`test/settings/*`, `test/support/settings-files.ts`, `test/scenarios/settings-deploy.test.ts`, `test/templates/read.test.ts`, `test/app/settings-effects.test.ts`)
- [x] T044 Split `apps/cli/src/cli/cli.ts`: `cli/help.ts` and `cli/options.ts`, `HELP` still exported from `cli/cli`; the layers test's lists
- [x] T045 [US1] [US4] `apps/cli/src/ops/domain.ts`: prepare `add` and `rm` (CL2), with `test/ops/domain.test.ts`
- [x] T046 [US1] [US4] `apps/cli/src/commands/domain.ts` for `add` and `rm`; the help lines; `WITHOUT_TEAM`; `--service`; the list of added help lines in `test/plain/plain-unchanged.test.ts` and `NEVER_FETCHES` (plan, "Needs the maintainer", 1)
- [x] T047 [US1] `apps/cli/src/domains/routes.ts`: routes and health from settings (R14), the checks against a Compose text; `settings/source.ts` and `DeployPlan` carry them
- [x] T048 [US1] `deployVersionTwo` signs them; `deliver` accepts the new outcomes far enough to record them (their lines come in phase 4)
- [x] T049 [US7] B10 in `ops/deploy-format.ts` (`ROUTES_PROTOCOL = 4`), with the cases: protocol 3 with and without a route, a runner run one request at a time
- [x] T050 Scenario: `zekno domain add`, then `zekno deploy` against the test runner signs the route and the runner holds it (`apps/cli/test/scenarios/domains.test.ts`, stand-in Docker); type check, lint, format, tests

## Phase 4: CLI, the checks and what is told

- [x] T051 [US2] The three effects in `cli/context.ts` and `main.ts`; `test/support/domain-stand-ins.ts`; a test of who may use them (CL5)
- [x] T052 [P] [US2] `apps/cli/src/domains/server-address.ts`: `ssh -G` read, the ranges, "not known"
- [x] T053 [P] [US2] `apps/cli/src/domains/dns.ts`: the lookup and the comparison
- [x] T054 [P] [US1] `apps/cli/src/domains/https.ts`: the TLS probe and the wait
- [x] T055 [US2] `apps/cli/src/ops/deploy-domains.ts`: the stops and warnings before signing, in CL3's order, called from `sendDeploy`; `--skip-dns-check`
- [x] T056 [US2] Tests for B1, B7 to B15 and the new "could not look up" warning: nothing signed on a stop, nothing sent, the exit status, the lines with no terminal
- [x] T057 [US1] The wait for HTTPS after a start with new domains: B4, B5, B6 (`commands/deploy.ts`, `app/effects/deploys.ts`)
- [x] T058 [US1] [US5] The outcomes: `routes_failed` (B16 to B19), `unhealthy` (C3, C4), R9, R10 in `cli/errors.ts`, `shared/deploy.ts`, `shared/views.ts`, `profile/profile.ts`; exit statuses
- [x] T059 [US5] The `health` event reaches the deploy view (`server/session.ts`, `ops/deploy-send.ts`)
- [x] T060 [US6] Rollback: the server's routes, this machine's health check, B12 (`ops/deploy.ts`), with tests for a domain added after the deploy rolled back to
- [x] T061 [US3] `apps/cli/src/domains/state.ts`: the nine states from the three sources (CL4), with a table test
- [x] T062 [US3] `zekno domain`: `ops/domain.ts` (list), `commands/domain.ts`, terminal, plain and `--json`
- [x] T063 [US3] `zekno status`: asked with routes, the lines E2, plain and JSON (`ops/status.ts`, `commands/status.ts`)
- [x] T064 [US3] `apps/cli/src/ops/doctor-proxy.ts`: the `Proxy` check (E3, E4, the other-image warning), wired into doctor without making `doctor.ts` longer
- [x] T065 [US7] `zekno server update` sends `proxy` when needed (`ops/server.ts` is over 500 lines: the new code goes in a file of its own)
- [x] T066 Scenarios against the test runner with stand-in Docker and the stand-in effects: US1 to US7's acceptance scenarios that the CLI can show (`test/scenarios/domains-*.test.ts`)
- [x] T067 A deploy of an app with no route and no health check: no lookup, no `ssh -G`, no TLS connection, the same requests; the frozen plain scenes pass (CL7)
- [x] T068 CLI: type check, lint, format, all tests

## Phase 5: CLI, the screens

- [ ] T069 [US1] The panel's `domains` row, three and "and N more" (`ui/parts/deploy-summary.tsx`, `shared/deploy.ts`, `ui/ink/deploy-live.ts`)
- [ ] T070 [US5] The fifth stage and its live line at a terminal (`ui/parts/deploy-summary.tsx`, `ui/ink/deploy-view.tsx`)
- [ ] T071 [US1] B1 before the panel, B4 to B6 and the outcomes' lines at a terminal, as the boards `DomainsDeploy`, `DomainsDns`, `DomainsHealth`
- [ ] T072 [US1] [US5] The app's deploy screen: the row, the stage, the wait, the outcomes (`app/state/deploy.ts`, `app/effects/deploys.ts`, `app/screens/deploy.tsx`)
- [ ] T073 [US3] The settings screen: the two rows, changed as other settings are (`app/state/settings*.ts`, `app/screens/settings*.tsx`)
- [ ] T074 [US3] `app/screens/app-domains.tsx`: the `Domains` box under `Secrets`, shown only for an app with a domain; its data through the app's effects; `app.tsx` not made longer than 500 lines
- [ ] T075 Tests of each screen in colour against the boards: marks, bold and dim, the rows' order (`test/app/domains-*.test.tsx`, `test/ui/ink/domains-terminal.test.ts`)
- [ ] T076 The screens and `ui/` still load neither the profile nor the core library (`test/layers`)
- [ ] T077 The app at 80 columns and in a window too small: nothing new overflows
- [ ] T078 CLI: type check, lint, format, all tests, `screens --check` (differences expected only where a stored screen gained a row)

## Phase 6: Docs

Waits for the maintainer's answer on the first group's name (M8) before `meta.json` and its test are touched.

- [x] T079 [P] `apps/web/content/docs/domains.mdx`: giving an app a domain, the record, the check, what `zekno domain` shows, moving and removing, what the server holds, what is not in this version
- [x] T080 [P] `apps/web/content/docs/health-checks.mdx`
- [x] T081 The pages that change: `settings.mdx`, `changing-settings.mdx`, `cli.mdx`, `deploying.mdx`, `doctor.mdx`, `security.mdx`, `index.mdx`, `output.mdx`, `runner.mdx`; `meta.json` and the pages contract in `apps/web/modules/docs/lib/pages.test.ts`
- [ ] T082 Stored screens: recapture those that changed, add recipes for `zekno domain`, `zekno domain add` and a deploy with a domain (`apps/cli/test/screens/recipes`), each shown by a page
- [x] T083 `README.md`: "What works today", the security model (the server holds the TLS keys of routed domains; what a hosted service would learn), the roadmap; `apps/cli/README.md`, `apps/runner/README.md`. The desktop app stays unnamed.
- [x] T084 The docs test of the CLI: every command and flag of the help is named by a page
- [ ] T085 Every sentence a page quotes is checked against the built program
- [x] T086 Web: tests, type check, lint, format

## Phase 7: Review and proof on this machine

- [ ] T087 An independent security review by an agent that wrote none of the code: the proxy's configuration and how it is built, the route networks and names, the health check's container, the test switch, the `proxy` and `status` requests, the DNS and HTTPS checks, `ssh -G`, the new commands; findings in `security-review.md`
- [ ] T088 Fix what the review finds, each with a test that fails first
- [ ] T089 A walkthrough: every board's scene drawn by the real program and compared (`design/walkthrough.md`)
- [ ] T090 The as-built boards on the canvas, from real captures
- [ ] T091 `quickstart.md`, "Results"; `plan.md`, "As built"
- [ ] T092 The final checks from the root and each package, with no cache; the compiled runner; protected files unchanged
- [ ] T093 The road map and the feature map
- [ ] T094 Merge into `dev` on this machine

## Maintainer steps

M1 to M8 in [quickstart.md](./quickstart.md). The runner's version (`apps/runner/package.json`), `runner-release.json` and the release itself change only there.

## Dependencies

Phase 1 blocks all. Phase 2 and phase 3 can run side by side after it (different packages); phase 4 needs both; phase 5 needs phase 4; phase 6 needs phase 5 and M8; phase 7 needs all.
