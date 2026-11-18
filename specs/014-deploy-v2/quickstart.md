# Quickstart: checking deploy version 2

How to see that the feature does what the spec says, success criterion by success criterion, and
how to try what must fail. The exact lines are in [contracts/cli.md](./contracts/cli.md), the
runner's order in [contracts/runner-checks.md](./contracts/runner-checks.md). Results are added
below as tasks complete.

## Before you start

- At the repository root, `bun install` done. No server, no `ssh`, no network, no port 3000 or 3100.
- A profile folder of the session's own, always: `export ZEKNO_HOME="$(mktemp -d)"`. Never
  `~/.zekno`; the tests use `memoryKeyStore()`, never the keychain.
- A runner on this machine: `bun apps/cli/src/main.ts server add dev --local --home "$(mktemp -d)"`
  uses the runner of this repository (protocol 3 from T025 on; the CLI signs version 2 from T032).
- For the pairing steps: a full clone (`git cat-file -e runner-v0.1.0^{commit}` and
  `git cat-file -e e7b0146^{commit}` both succeed).
- Docker only where step 7 says, with images already on this machine.

## 1. The format and the order (US1, SC-001, SC-002)

```bash
cd packages/core && bun test test/deploy test/scenarios/order.test.ts
```

- `order.test.ts`: for every order of delivery of one, two and three deploys of one app (each made
  against a number the test chooses), no deploy is accepted after one accepted after it was made,
  and every refused deploy leaves the state as it was (SC-001).
- `deploy-v2.test.ts`, "kind and v": the six pairings; only `zekno.deploy.v1`/`1` and
  `zekno.deploy.v2`/`2` read (SC-002).

```bash
cd apps/cli && bun test test/scenarios/deploy-v2.test.ts
```

- A deploy after 41 is signed `previous` 41, `sequence` 42; the line is
  `Deploy 42 of demo is running on dev with 2 secrets.`
- Two deploys signed against the same number, the second's request held back until the first has
  finished: the second is refused, the plain error is C1 with `as deploy 42`, Docker's `up` ran
  once, `lastSequence` is 42. Sent while the first is still in `up`: `busy`.
- The same with the first deploy's answer cut off after it was sent: the second says C2.
- `zekno rollback`: `Rolling back demo to what deploy 41 ran.`, then a version-2 deploy 43 after 42.

**Try what must fail.** In the same scenario: a runner whose `status` says a lower number than the
truth (the test's stand-in answers 40 when the runner holds 41): R1's case, `replayed`, nothing ran;
higher (45): R2 (`sequence_jump`), nothing ran, `state.json`'s bytes unchanged.

## 2. Secrets by version (US2, SC-004, SC-008)

```bash
cd apps/runner && bun test test/scenarios/secrets-v2.test.ts
cd apps/cli && bun test test/scenarios/secrets-v2.test.ts
```

- Three secrets, two deploys with nothing changed: the second `deploy` request carries 0 records
  (the test reads the request line), and Docker's environment holds all three (SC-004).
- One secret set again: one record travels; `records/demo/` holds the new file only.
- `zekno secret rm API_KEY`, deploy: the entry's hash is `null` and its file is gone.
- A second machine of the same member (`twin`), with no secret store: its deploy lists all three
  from the runner's statements, its request carries 0 records, and its store stays empty (US2
  scenario 5, FR-022).
- The sentinel run: every printed line, error, history file, profile file and runner file is
  searched for each value, as text and as base64url; it is found only inside sealed records and in
  the stand-in Docker's own log of the environment it was given (SC-008).

**Try what must fail.** Sign, in the test, a deploy that lists two of three live secrets:
`secrets_mismatch`, R3, nothing changed. List a secret the runner holds no file of and send no
record: `secret_missing`, R4. Change one byte of a held file's statement: `untrusted_secret`.

## 3. A secret set by someone since removed (US3)

```bash
cd apps/cli && bun test test/scenarios/removed-member.test.ts test/ops/deploy-secrets.test.ts
```

- With `test/support/team-of-two.ts`: the second member sets `DATABASE_URL`, the admin removes them;
  `zekno deploy` stops with C4 for `DATABASE_URL`, exit 1, nothing signed, the history unchanged.
- The same with a runner of protocol 2 on an older state (the version-1 path, decision 8): C4.
- A deploy signed anyway (the test calls `createDeployV2` with the old statement): the runner
  refuses `untrusted_secret`, R5, no number used.
- `zekno secret set DATABASE_URL` then `zekno deploy`: starts. `zekno secret rm DATABASE_URL`
  instead: starts without it, and the deploy lists the removal. Neither command connects (the test
  makes `deps.connect` throw for them).

```bash
cd apps/cli && bun test test/scenarios/held.test.ts test/profile/held.test.ts test/ops/secret-versions.test.ts
```

- The chain of decision B: a deploy stops with C5 (a secret only the server holds; a version-1
  secret with no statement), and `held/<serverId>/<app>.json` now holds the server's statements and
  versions and no value; `zekno secret set NAME`, offline, signs a version above them, and the next
  deploy goes through; the same with `zekno secret rm NAME`, and the deploy lists the removal.
- C5b: a twin machine sets a new value (version 3) and deploys; this machine, holding version 2,
  deploys: it stops with C5b, nothing signed; `zekno secret set NAME` gives version 4 and the deploy
  goes through. The ordinary case (this machine set versions 1 and 2, the server holds 2) deploys
  without a word.
- The plain transcripts of `secret set` and `rm` (`bun test test/plain`) are unchanged.

**Try what must fail.** A `held/` file edited to say version `9007199254740991`: `zekno secret set`
says `That could not be done (invalid_argument).` and stores nothing.

## 4. Old and new programs (US4, SC-005, SC-006, SC-007)

```bash
cd apps/runner && bun test test/scenarios/versions.test.ts
cd apps/cli && bun test test/scenarios/deploy-versions.test.ts
```

- After a version-1 deploy on a marked state, `state.json` still has `"v": 2` and every app's
  format (SC-007).
- A runner that answers protocol 2 over an older state, this zekno carrying `0.1.1`: the deploy is
  version 1 and C6 is said after signing; `zekno status` says W3; `zekno doctor`'s Runner line
  says `0.1.0, older than this zekno's 0.1.1`.
- A runner that answers `RUNNER_PROTOCOL + 1`: C7, exit 1, nothing in the history.

**Try what must fail.** `apply` of a new app to a runner of this feature: `unsupported_version`,
`state.json`'s bytes unchanged.

## 5. Later fields and expiry (US5, US6, SC-003)

```bash
cd apps/runner && bun test test/scenarios/deploy-v2.test.ts
```

- One route, one build, a health check, a pre-deploy command, each alone: `unsupported_version`,
  no number used, Docker not called, records unchanged (4 of 4, SC-003).
- A route whose domain is `demo.invalid`: `malformed` (its rule breaks first).
- `expiresAt` a minute ago: `expired`; eight days ahead: `expired`; `null`: accepted.

## 6. Pairing with the released programs (US4, SC-005, SC-006; needs a full clone)

```bash
cd apps/runner && bun test test/scenarios/pairing.test.ts
cd apps/cli && bun test test/scenarios/pairing.test.ts
```

- This zekno, carrying `0.1.1`, against runner 0.1.0 from `runner-v0.1.0`: the flows of today's
  end-to-end deploy tests (a linked folder, one with a secret, a rollback to deploy 1, two apps)
  each pass and each say C6 (SC-005).
- The zekno of `e7b0146` against this runner: an app runner 0.1.0 held before the update deploys
  (US4 scenario 2); a new app, and the app after this zekno deployed it, are refused with
  `The runner refused the request (unsupported_version).`, and `state.json` is byte for byte as
  before each refusal (SC-006).
- Runner 0.1.0 put back on a state this runner wrote: every request is `invalid_state`; this zekno
  says `The runner's stored state is damaged or incomplete, so it refuses to act.`
- In a shallow clone each prints `Skipping the pairing tests: … is not in this clone's history.`
  The pull-request check fetches the whole history (`fetch-depth: 0`), so they run there.

## 7. Real Docker (where today's test runs)

```bash
cd apps/cli && bun test test/scenarios/real-docker.test.ts
```

With Docker running and `caddy:2.11.9` present: the container starts with the secret, and a second
deploy with nothing changed starts it again with the secret, from the runner's held record.

## 8. Lines and screens (FR-039, SC-011)

```bash
cd apps/cli && bun test test/cli/errors.test.ts test/shared/deploy-words.test.ts test/ui/ink/single-commands.test.tsx test/app
bun run screens --check
```

- Every reason a `deploy` check can give has its own sentence; none is
  `The runner refused the request (…)` (SC-011).
- The pseudo-terminal walkthrough (T075): each board of `design/` against the program at 100
  columns, the same words, marks and bold first sentence.

## 9. The end checks (SC-009, SC-010)

```bash
bun run typecheck && bun run lint && bun run test --force && bun run format && git diff --stat
cd apps/runner && bun test test/scenarios/no-network.test.ts
cd apps/cli && bun run compile
```

- No listening socket and no network call in the runner's source or while it deploys (SC-010).
- `specs/014-deploy-v2/security-review.md`: every finding answered, none high or medium open
  (SC-009).
- `bun run build` is not run: for `apps/web` it is `next build`, which the maintainer's rule keeps
  out of these sessions.

## Results

Added by the tasks: the base (T004), each scenario above, the walkthrough (T075), the end checks
(T073, T074, T076).

## Results so far (kept as the parts land)

- **T004, 2026-11-18**: both older programs are in this clone's history. Runner 0.1.0 (the tag `runner-v0.1.0`) answers `version` with `{"version":"0.1.0","protocol":2}`; the zekno from `e7b0146` prints its two version lines and exits 0.
- **T041, 2026-11-18, real Docker** (`caddy:2.11.9` already on this machine): one pass, eight assertions. The first deploy took 272 ms; the second deploy sent no record, and the container still had `GREETING`.
- **After the CLI was wired (T032 to T055)**: core 283 pass; runner 217 pass, 1 skip; cli 2,345 pass, 4 skip, 6 fail. The six are in `apps/cli/test/app/app-effects.test.ts`, whose helper still reads the history with the version-1 reader; it is fixed with the lines on screen (Part D).
- **After the lines on screen (T033 to T060), 2026-11-18**: cli 2,391 pass, 4 skip, 0 fail. `bun run screens --check`: all twelve stored screens in step; none shows a changed line, so none was redrawn (T035, T056).
- **T070, the independent review, 2026-11-18**: nothing critical or high; one medium (S1), four low, four notes. `security-review.md`.
- **After the review's fixes (T071), 2026-11-19**: typecheck and lint pass in every package; core 300 pass; runner 227 pass, 1 skip; web 54 pass; cli 2,404 pass, 4 skip, 0 fail; Prettier clean in core, runner and cli; `bun run screens --check` in step.
