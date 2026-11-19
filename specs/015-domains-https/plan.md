# Implementation Plan: Domains and HTTPS

**Branch**: `015-domains-https` | **Date**: 2026-11-19 | **Spec**: [spec.md](./spec.md)

**Input**: [spec.md](./spec.md) (approved), the approved words in [design/lines.md](./design/lines.md) and the six boards, the design of feature 010 ([deploy-v2.md](../010-app-settings/deploy-v2.md), parts 4.2 and 4.3), and [research.md](./research.md) (R1 to R34).

## Summary

An app gets a domain; the server answers for it over HTTPS with a certificate it obtains by itself; a deploy can wait until the app is healthy. The signed deploy of feature 014 already carries `routes` and `health`. This feature makes the runner carry them out, with Caddy as the reverse proxy, and gives the CLI the commands, the checks and the screens.

- **Core library**: stop refusing `routes` and `health`; refuse `xn--` names; the runner's state gains the routes in force and the names it handed out; `domain_taken`; protocol 4 with two new outcomes and one new event.
- **Runner**: a network per routed app that only the runner makes, a random name per container, a proxy from a pinned image with a generated configuration that is checked, loaded and confirmed, a health check from a container of the same image, and two requests the CLI needs (`status` with routes, `proxy`).
- **CLI**: `domains` and a health check as real settings; `zekno domain`, `add`, `rm`; before signing, the DNS check and the other stops; after a start, the wait for HTTPS; a fifth stage; the rows in `zekno settings`, `zekno status`, `zekno doctor` and three screens of the app.
- **Then**: docs, an independent security review, the walkthrough of the real screens, runner release 0.1.1 and a proof on a real server.

## Needs the maintainer

1. **The help in the frozen test** (R32). Adding the lines of `zekno domain` to the list of added help lines in `plain-unchanged.test.ts`, as features 010 and 012 did. Nothing else in that file changes. Assumed accepted unless the maintainer says otherwise; raised on 2026-11-19.
2. **`health-timeout`** (R14): a settings key the boards do not show. It appears only inside the approved `health` row.
3. **No doctor line for a taken port** (R34), which a board's note mentions.
4. **The release and the proof**: pushing the tags, approving the release, a domain and a server with ports 80 and 443 free. Each a maintainer step with its own go-ahead ([quickstart.md](./quickstart.md), "Maintainer steps").
5. **The docs' first group**, renamed to "Get Started" in an uncommitted change that is the maintainer's. The docs part of this feature changes the same file and its test; it is done after the maintainer says whether the rename stays.

## Technical Context

**Language/Version**: TypeScript on Bun 1.4.4, as the repository is.

**Primary Dependencies**: none new in any `package.json`. One new program on the server: the image `caddy:2.11.9-alpine`, pinned by digest in the runner (the maintainer's choice of 2026-11-18). The CLI uses `node:dns/promises`, `node:tls`, `node:net` and the system's `ssh`, all present today.

**Storage**: the runner's folder (`state.json`, now with routes; `proxy/etc/caddy.json`), two Docker volumes for the proxy (`zekno-proxy-data`, `zekno-proxy-config`), the settings file in the project, and this machine's history.

**Testing**: `bun test` in each package. The runner's scenarios run the real runner program against the stand-in for Docker, extended; a gated set runs real Docker with the pinned image, Caddy's internal issuer and high ports (R25). The CLI's scenarios use stand-ins for the resolver, the HTTPS request and the ssh host (R28).

**Target Platform**: the CLI on macOS and Linux; the runner on Linux x86-64 and ARM64 with Docker and Compose.

**Project Type**: a CLI, a server program and a library in one repository.

**Performance Goals**: a deploy of an app without a domain or a health check makes no new call and takes no longer (R23). A proxy load only when the configuration changed (R6).

**Constraints**: no text from a deploy reaches the proxy's configuration unchecked; the proxy never gets the Docker socket and has no admin interface; nothing new reaches any service of Zekno's; the frozen plain transcripts hold; files under 500 lines, each module in a folder named for its subject.

**Scale/Scope**: at most 64 routes a deploy and 1,024 domains a server.

## Constitution Check

*GATE: checked before research and again after the contracts. All pass.*

| Principle | How this plan complies | Status |
|---|---|---|
| I. Security Promise First | Which domain reaches which app is signed. The proxy's configuration is generated from checked fields and the runner's own names only. One app holds a domain. No key of the team is held anywhere new; the server holds TLS keys of routed domains, and the README says so. | Pass |
| II. Honest Surface | Every new line is an approved line. What Zekno cannot know (the server's public address, whether a certificate will come) is said as not known. "Runner" everywhere. Pre-alpha and unaudited stays visible. | Pass |
| III. Read the Installed Docs First | Caddy's behaviour was run, not remembered ([research/caddy-on-docker.md](./research/caddy-on-docker.md)). Bun's DNS and TLS were probed before they were chosen. No framework code changes. | Pass |
| IV. One Design System | New lines are drawn by the parts that exist: the marked lines, the deploy panel, the stage row, the settings rows, the app's panes. | Pass |
| V. Motion With Purpose | Only the spinner that exists, while a deploy waits. | Pass |
| VI. Accessible and Fast by Default | Every state of a domain has a mark and words. Plain output is one tab-separated line a domain. | Pass |
| VII. Verified Before Done | Tests first where a contract fixes behaviour; every refusal and outcome has a test; real Docker with a real proxy in the gated set; at the end type check, lint, tests without cache, format, `screens --check`, the compiled runner, an independent security review, and a walkthrough of the real screens against the boards. | Pass |

## Project Structure

### Documentation (this feature)

```text
specs/015-domains-https/
├── spec.md, checklists/
├── design/                 # lines.md and the six approved boards (binding)
├── research-proxy.md       # why Caddy (2026-11-18)
├── research.md             # R1 to R34
├── research/               # the three records behind it
├── plan.md                 # this file
├── data-model.md
├── contracts/
│   ├── core.md             # the rule, the message inputs, the state, the protocol
│   ├── runner.md           # the steps, the networks, the proxy, the health check
│   └── cli.md              # settings, commands, checks, probes, outcomes
├── quickstart.md           # how it is proven, and the maintainer steps
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/src/
├── deploy/later-fields.ts      # the domain rule tightened, exported with a reason
├── deploy/message.ts           # F7 keeps refusing builds and predeploy only
├── deploy/deploy-v2.ts         # routes and health as inputs; domain_taken
├── deploy/routes.ts            # new: who holds a domain, the state with an app's routes
├── deploy/state.ts             # mark 3, routes
└── protocol/{protocol,result,limits}.ts   # protocol 4, outcomes, the health event, status with routes

apps/runner/src/
├── docker/run.ts               # new: one helper for Docker calls (status, both outputs)
├── routes/                     # new: containers.ts, network.ts, apply.ts
├── proxy/                      # new: image.ts (the digest), config.ts, container.ts, load.ts, certificates.ts
├── health/                     # new: check.ts, wait.ts
├── commands/deploy.ts          # the steps after `up`
├── commands/proxy.ts           # new: the `proxy` request
└── commands/commands.ts, session/session.ts, home/home.ts

apps/cli/src/
├── domains/                    # new: rule.ts, words.ts, routes.ts, server-address.ts, dns.ts, https.ts, state.ts
├── settings/*                  # domains and the health check as real settings
├── ops/domain.ts, ops/deploy-domains.ts, ops/doctor-proxy.ts      # new
├── commands/domain.ts          # new
├── cli/help.ts, cli/options.ts # split from cli.ts, which is at its limit
├── ops/deploy*.ts, shared/{deploy,history,deploy-words,views}.ts, cli/errors.ts
├── ui/parts/deploy-summary.tsx, ui/ink/deploy-view.tsx, ui/ink/deploy-live.ts
└── app/screens/{app-domains.tsx (new), app.tsx, deploy.tsx, settings*.tsx}, app/state, app/effects

apps/web/content/docs/          # domains.mdx, health-checks.mdx (new); pages that name what changed
apps/web/content/screens/       # recaptured and new stored screens
README.md, apps/cli/README.md, apps/runner/README.md
```

**Structure Decision**: the existing three packages. Each new subject gets a folder (`routes`, `proxy`, `health` in the runner; `domains` in the CLI), with tests mirrored under `test/`. The CLI's `domains/` folder is added to the layers test, as features 010 and 012 added theirs. Imports point as today: screens and `ui/` load neither the profile nor the core library; `domains/` loads no screen.

## What does not change

- The format of the signed deploy, and version 1. Only the domain rule is tightened, which no released program applies.
- A deploy of an app with no domain and no health check: its calls, its lines, its exit status, the frozen plain transcripts.
- The stage row of a deploy without a health check.
- `apps/cli/e2e.config.ts`, `apps/cli/tests/`, the key file, `bun.lock`, every `package.json` dependency list.
- The landing page.
- No runner release until the maintainer's steps at the end: until then `runner-release.json` names 0.1.0.

## Phases

Built in parts, each by an Opus agent with a written brief, verified here (the diff read, type check, lint, tests, the failing case tried) and committed before the next.

1. **Core** (tasks T001 to T012): the rule, the inputs, the state, `domain_taken`, protocol 4, outcomes, the event, `status` with routes.
2. **Runner** (T013 to T034): Docker helper and stand-in; containers, networks and names; the proxy's configuration, container, load and certificates; the steps in `deploy`; the health check; `status` with routes and `proxy`; the real-Docker set.
3. **CLI, settings and commands** (T035 to T050): the two settings end to end, the history and the mark, `zekno domain add` and `rm`, routes and health into the signed deploy, the runner too old (B10).
4. **CLI, the checks and what is told** (T051 to T068): the three effects and their stand-ins, the stops and warnings before signing, the wait for HTTPS, the outcomes, rollback, `zekno domain`, `zekno status`, `zekno doctor`, `zekno server update`.
5. **CLI, the screens** (T069 to T078): the panel's row and the fifth stage at a terminal and in the app, the settings screen's rows, the Domains box.
6. **Docs** (T079 to T086): the two pages, the pages that change, the stored screens, the READMEs.
7. **Review and proof on this machine** (T087 to T094): the independent security review and its fixes, the walkthrough of the real screens, the as-built boards, the final checks.
8. **Release and proof on a server** (maintainer steps M1 to M8).

## Risks

| Risk | What is done about it |
|---|---|
| Docker on Linux differs from Docker Desktop where it matters (R33) | The gated tests state what they ran on; the proof runs them again on a Linux server before the release. |
| A reload drops a few connections | Load only on change (R6); said in the docs. |
| A certificate cannot be had (limits, CAA, a firewall) | The deploy says the certificate is not ready and `zekno domain` shows it; the DNS check prevents the commonest cause. |
| One lock, and a health wait of up to 30 minutes, makes other requests to the server answer busy | As the design accepted (V11); the default limit is 60 seconds; said in the docs. |
| The test switch `ZEKNO_PROXY_TEST` | Read from the environment only, never from a deploy or the state; reviewed. |
| A member's VPN or a company proxy makes the DNS or HTTPS answer wrong from their machine | `--skip-dns-check`; the HTTPS wait only warns. |
| The frozen help | Needs the maintainer, point 1. |
| Files near 500 lines (`cli.ts`, `doctor.ts`, `app.tsx`) | Split as the structure above says, before they grow. |

## Complexity Tracking

No violation of the constitution to justify.

## As built

Written on 2026-11-19, when the tasks up to T093 were done. The numbers are in `quickstart.md` ("Results"), the review in `security-review.md` (part 7), the screens in `design/walkthrough.md` and the six `Built…` boards beside the approved ones.

**Done**: the core library carries out routes and health checks and refuses `xn--` names; the runner serves a domain through a pinned Caddy with a generated configuration, one network and one random name per routed container, and waits for a health check; the CLI has the two settings, `zekno domain`, `add` and `rm`, the DNS check before signing, the wait for HTTPS, the new outcomes, a rollback that keeps the domains, and the rows in `zekno settings`, `zekno status`, `zekno doctor` and three screens of the app; two docs pages and four stored screens; an independent security review with every finding answered.

**No release, as decided.** A zekno built from this branch still installs runner 0.1.0, which speaks protocol 2: against a released server a deploy with a domain stops before signing (B10). Domains work with a runner that says protocol 4: the tests' runner, `--runner-file`, and runner 0.1.1 once the maintainer publishes it (quickstart, M1 to M7).

**Proven on this machine only.** The gated set ran real Docker with the pinned Caddy, its internal issuer and high ports on Docker Desktop: HTTPS through the proxy, the redirect, `domain_taken`, a restarted container followed, a failed load leaving the earlier configuration, a release with the certificate's folder gone, the health check. Not proven: a certificate from Let's Encrypt, ports 80 and 443, Docker on Linux (search domains, labels a Compose text sets), a real `ssh -G`. Those are the proof on a server (M4, M5).

**What differs from the approved boards and words** (the `Built…` boards show the real program; `design/walkthrough.md` names each row):

- Every deploy panel at a terminal has one row more, `from`, which a deploy from a settings file has shown since feature 010.
- `zekno domain` lists the domains in the order of their names, as contracts/cli.md CL4 says; the board drew the file's order.
- Once the service question of `zekno domain add` is answered it is drawn as every list question of zekno is, `✔ Service  web`; the board kept the question with its answer after it. Kept as built, and approved by the maintainer on 2026-11-19.
- `zekno settings` at a terminal does not draw `health  not set` or `domains  none` (lines C5 and E1): the command prints only the settings that are set. The settings screen draws both. Kept as built, and approved by the maintainer on 2026-11-19.
- `--skip-dns-check` and a held domain that moved away (B14, B15): the board drew the warning alone; the program draws the deploy after it.
- B6 has no backticks at a terminal. The app's spinner on the `Healthy` stage is bold, as at a terminal.
- `zekno doctor` has no line for a taken port (E5): the runner cannot know it without starting the proxy, and the deploy that tried says it (B16; research R34).
- B11 is never said: the settings file's own rule refuses a domain on a service with no port first.
- A deploy whose own Compose text publishes port 80 or 443 gets B16, which says "another program", not which app (the spec's edge case asked for the app's name).

**Sentences that are on no board** (each pinned by a test, for the maintainer to approve or change; gathered on 2026-11-19 in one board, `design/BuiltDomainsWords.dc.html`, which is on the canvas at the end of the as-built row): `Service` as the answered question's label; `zekno could not look up shop.example.com from this machine. The deploy goes on.`; B13 ending `It has no DNS record yet.`; A6 with `your server`; `Say which domain: zekno domain add <domain>.`; `web cannot be checked: no container of web is running. Run zekno logs to see why.` and its host-network form; `prod-1 was not asked`; `point it at the public address of prod-1`; `This folder is not linked to an app. Run zekno link here, then zekno domain again.`; doctor's `an older version` with `Deploy an app with a domain to replace it`; B10 without a version, for a runner run one request at a time; B16's and B19's forms for the server after `zekno server update`; the settings rules' sentences for `domains` and `health` (SV34 to SV45). The app's Domains box foot is the board's own words.

**Readings chosen where the contracts were silent**:

- A rollback takes its routes from the server and its health check from this machine's history, because the server does not hold a health check's path or limit. A rollback from a machine that did not sign the deploy in force keeps the domains and signs no health check.
- A rollback asks `status` again with routes unless this machine signed the deploy in force with no route. `zekno status` and `zekno doctor` always ask with routes on protocol 4.
- With `--json`, `zekno deploy` prints none of the DNS or HTTPS lines and does not wait for HTTPS. `--skip-dns-check` also skips the domains the app already holds, saying nothing of them.
- The wait for HTTPS is 60 seconds in all for a deploy's new domains, from when the wait begins.
- `zekno server update` sends `proxy` only after it replaced the runner; its failure is a warning.
- `zekno domain` takes the app and the server from the folder's link only. The app's Domains box is shown when the folder's settings file or this machine's last deploy of the app has a domain, and asks the server in batch mode only.
- The settings screen changes `domains` as one comma-separated list and `health` as a path or `up`; the limit is changed with `zekno settings set <service>.health-timeout`, a key the boards do not show.
- In the runner: a load is confirmed by the nonce in what Caddy saved, the log only stops a wait early; a file refused by `caddy validate` is not followed by a load back; the health limit counts from when the wait begins, so the time of the route steps (a first fetch of the proxy's image) is not the app's; more than 16 containers of a service is `no_container`; an invalid `ZEKNO_PROXY_TEST` is `not_loaded`.

**Changed after the review** (security-review.md, part 7): requests are not written to the proxy's log, which is bounded; a released key is deleted also when the proxy is stopped or gone; the health wait keeps its limit; the configuration is validated as a second file before it is in place; `X-Real-Ip` and `Forwarded` are removed from a request; `--dns-search .`; a rollback is not signed on a runner's word that it holds no routes; tighter public-address rules.

**Files that moved from the plan's structure**: the route and health rules of the core are in `deploy/routes-and-checks.ts`; the session's schemas in `protocol/session.ts`; the CLI has `domains/{ip,outcome,words-extra}.ts`, `ops/{deploy-https,server-proxy}.ts`, `shared/at-most.ts`, `app/effects/domains.ts`, `app/screens/deploy-domains.tsx`; the runner has `proxy/{file,log,serve}.ts` and `health/image.ts`.

**Left for later**: the proof on a server and release 0.1.1 (maintainer steps); feature 014's deferred bound in the runner on a claimed secret version; a line in `zekno doctor` for rootless Docker; naming the app that holds port 80 or 443.
