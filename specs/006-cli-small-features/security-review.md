# Security Review: Small CLI Features

Everything in [`specs/005-runner-release/security-review.md`](../005-runner-release/security-review.md),
[`specs/004-cli-app/security-review.md`](../004-cli-app/security-review.md) and
[`specs/003-cli-runner/security-review.md`](../003-cli-runner/security-review.md) still applies, except
where part 5 below says otherwise.

This is not an external audit. One independent reviewer (a separate agent that did not write the
code) read the source and ran its own probes. Nothing was fixed as part of this review. An external
audit is still required before production use.

## 1. Scope and method

**Commit.** `faefc6e` on `006-cli-small-features`, against the branch point `16f2aa3`. Only
`apps/cli/src` changed: 24 files, 3,084 lines added and 106 removed. No file under `apps/cli/src/app`
(the full-screen app) changed.

**Attackers considered**, as in the earlier reviews:

| Attacker | Can do |
|----------|--------|
| A runner or server that lies | Answer anything over SSH or as a local runner, slowly or never. Holds no team key. |
| Attacker B | Change files in the profile folder (`~/.zekno`). Cannot read the keychain. |
| A project folder's author | Own a cloned repository: its `zekno.json`, Compose file, folder name, `.env` and links. |
| Whoever answers for `api.github.com` | GitHub, a proxy, or a certificate this machine was made to trust. |
| Typed-ahead keys | Keys pressed before a question is on the screen. Not an attacker, a condition. |

**Read in full**: `asking/asking.ts`, `asking/first-deploy.ts`, `secrets/import-file.ts`,
`ops/doctor.ts`, `commands/doctor.ts`, `server/check-script.ts`, `version/newest.ts`,
`version/version.ts`, `ui/questions.tsx`. **Read as diffs, with the code around them**: `cli.ts`,
`context.ts`, `project.ts`, `ops/secret.ts`, `commands/secret.ts`, `commands/server.ts`,
`commands/deploy.ts`, `ops/deploy.ts`, `ui/ink.tsx`, `ui/plain.ts`, `ui/types.ts`, `errors.ts`,
`profile.ts`, `install.ts`, `main.ts`. **Read because the new code leans on it**: `session.ts`
(`openSession`, `oneShot`), `transport.ts` (the `ssh` argument list, script words, batch mode),
`ops/link.ts`, `ops/status.ts` (`readOver`, `checkIdentity`), `app/hand-over.ts` (`batchOnly`),
`ui/type-ahead.ts`, `ui/secret-input.ts`, `ui/text-input.tsx`, `ui/select.tsx`,
`compose-file.ts` (`expectedValues`), `accepted.ts`, `profileStore`, and the runner's
`commands.ts` and `home.ts` (to see that `status` and `version` write nothing).

**Specs read**: `spec.md`, `research.md`, the five contracts named in the brief, and the three
earlier reviews.

**Run**:

- The feature's own tests: `test/asking`, `test/secrets`, `test/server/check-script.test.ts`,
  `test/version/newest.test.ts`, `test/plain`, `test/ops/doctor.test.ts`,
  `test/ui/questions.test.tsx`. 188 tests, all pass.
- Five throwaway probes, in a scratch folder outside the repository, using the repository's test
  helpers (in-memory key store, local runner with the stand-in Docker): the import of a wrapped
  value (S1), a runner that stalls after answering as a runner from before sessions (S2), a "new"
  app whose name the server already has (S3), an import file that is a link (S4), and the
  newer-release request through Bun's own `fetch` to an HTTP server on 127.0.0.1 (loopback only).
- Not used: the system keychain, `ssh` to any host, the network, a real terminal, real Docker.

## 2. Findings

| Id | Severity | Finding | Confirmed |
|----|----------|---------|-----------|
| S1 | Low | `zekno secret import` reads the last line of a wrapped value as a `NAME=value` entry, shows that piece of the value, and stores it as a secret's name | Yes, by a probe |
| S2 | Low | `zekno doctor` and the asking step have no time limit when a runner answers its session as a runner from before sessions | Yes, by a probe |
| S3 | Low | When the server's apps cannot be read, a "new" app name in `zekno deploy` can be an app already on the server, which the deploy then replaces | Yes, by a probe |
| S4 | Informational | The import follows a link, and the summary names the path as typed, not the file the values came from | Yes, by a probe |

No finding is rated medium, high or critical.

### S1. A piece of a value becomes a secret's name (Low)

**Why low**: it needs a file with a value spread over two lines, and it leaks a fragment, not a
whole secret; but it breaks FR-016 ("No value is ever shown") and FR-021 directly.

**Where**: `apps/cli/src/secrets/import-file.ts:140-147` (`keyAt`: a key is any run of
`[A-Za-z0-9_.-]` followed by `=`) and `:201-215` (an unquoted value may begin with `=`);
`apps/cli/src/ops/secret.ts:152-159` (`leftOut` shows the key itself for an empty value or a name
that does not fit); `apps/cli/src/commands/secret.ts:69-78` (`importGroups` puts each key in the
summary).

**Who**: nobody needs to act. It happens to a developer whose `.env` holds a value wrapped onto a
second line, as `base64` and copied web pages wrap it. Base64 without `+` or `/`, and every
base64url value, is made only of key characters.

**Steps**:

```text
GOOGLE_CREDENTIALS=c2VydmljZS1hY2NvdW50LWtleS1hYmNkZWYxMjM0NTY3ODkw
QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo1Ng==
API_TOKEN=x
dG9wc2VjcmV0dG9rZW4xMjM0NTY3ODkwYWJj=
```

then `zekno secret import .env --app web --server dev --yes`.

**Result** (probe, plain output):

```text
new	GOOGLE_CREDENTIALS, QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo1Ng, API_TOKEN
left out	dG9wc2VjcmV0dG9rZW4xMjM0NTY3ODkwYWJj (empty)
Stored 3 values for web on dev. They take effect on the next deploy.
```

- Line 2 is read as the name `QUJD…Ng` with the value `=`. It fits `SECRET_NAME`, so it is stored
  as a new secret. `zekno secret ls` and `zekno status` list it. After a deploy the runner's
  `state.json` holds it. Names are not protected anywhere: they travel in the signed deploy and
  are printed by `status`.
- Line 4 (one `=` of padding) is read as a name with an empty value, and is printed in "left out"
  as the key itself.
- In plain output both go to standard output, which in a script is often a CI log.
- `GOOGLE_CREDENTIALS` is stored with its first line only, without a word.
- At a terminal the summary draws the same pieces before the question. With `--yes` there is no
  question.

The contract's claim that a shown key "cannot hold most values" (research R8) is true for most
values, not for these.

**Smallest fix**: in `readLine`, an unquoted value that begins with `=` stops the import (a new
case of I2); and in `leftOut`, an entry left out because its value is empty or its name does not
fit is named by its line number only, as a name longer than 128 characters already is.

### S2. No time limit after a runner answers as one from before sessions (Low)

**Why low**: the effect is a command that waits for ever, not a disclosure or a change; but
`zekno doctor` promises 20 seconds per connection, is meant for scripts, and a server can stop it.

**Where**: `apps/cli/src/session.ts:381-383` returns `oneShot(transport)` without the signal, and
`:345-357` runs each request with `ask(transport, …)`, which waits for the process to exit with no
deadline (`transport.ts:187-205`). Callers that rely on the signal: `apps/cli/src/ops/doctor.ts:352-356`
(`runnerCheck`) and `apps/cli/src/asking/asking.ts:90-92` (`readApps`, the list of apps).

**Who**: a server or runner that lies, or a broken one. It answers the session's first request with
a line that is not a session frame, so the CLI takes it for a runner from before sessions, then
never answers the one-shot `status`.

**Steps**: a runner that prints `hello` for `session` and sleeps for `status`; then `runDoctor`
with a 1-second limit, and `appRows` with a 1-second limit.

**Result** (probe): neither had returned after 6 seconds. The stalled runner processes were still
running and were killed by hand. Over SSH the same code path applies: the `ssh` process is left
waiting. At a terminal, Ctrl-C ends the asking step. In a script, `zekno doctor --json` waits until
something else kills it.

**Smallest fix**: hand the signal to the one-shot path (`oneShot(transport, signal)`), and have the
one-shot `run` kill its process when the signal fires. Feature 004 decided that a lying server may
keep other commands waiting (its "Not new, noted"); this fix only makes the two places that promise
a limit keep it.

### S3. A "new" app can replace an app already on the server (Low)

**Why low**: the person is the one deploying, and a deploy is already equal to root on the server;
but the question calls the name new and checks it only against a list that, after a failed read,
does not hold the server's apps.

**Where**: `apps/cli/src/asking/asking.ts:112` (when the read fails, the rows are this machine's
history only); `:155-166` (the typed name is checked against those rows, and against nothing when
there are none); `:165` and `:176` return `fresh: true`, which `apps/cli/src/asking/first-deploy.ts:290`
never uses.

**Who**: a developer running `zekno deploy` at a terminal when the batch-mode read of the server
fails: a key with a passphrase and no agent, password login, a slow server, or a server that
refuses the read. The folder's own name is filled in, so a folder named like an app (a teammate's
repository, or a repository named to match) needs one Enter.

**Steps** (probe): machine A deploys `api` to `dev`. Machine B has the same team and server and no
history of `api`. In a folder named `api` with another Compose file, B runs `zekno deploy`; the
batch-mode read fails as SSH does where it would ask; the deploy's own connection works.

**Result**: B is asked `Name for this app` with `api` filled in, accepts it with no warning, and
sends deploy 2 of `api`. The runner's `apps/api/compose.yaml` is now B's file. The runner starts
it as Compose project `zekno-api` (`apps/runner/src/compose.ts:84`), so named volumes of the old
app go to the new file (reasoned from Compose's naming, not run against real Docker).

**Smallest fix**: before signing, when the app was typed as new (`fresh`), compare it with the
runner's `status` that the deploy already reads on its own connection, and stop with A12 when
`lastSequence[app]` is 1 or more. Or, at least, when the read failed, do not fill in the folder's
name and say that the list comes from this machine only.

### S4. The import names the link, not the file it reads (Informational)

**Why informational**: links are followed by design, as with `-f`, and the person still confirms
the names; but a cloned repository's `.env` can be a link to a file outside it, and nothing says so.

**Where**: `apps/cli/src/secrets/import-file.ts:72` opens the typed path, following a link;
`apps/cli/src/commands/secret.ts:62` shows the typed path in I1 and I18.

**Steps** (probe): `.env` is a link to `<elsewhere>/other.env`, which holds
`OTHER_PROJECT_TOKEN=…`. `zekno secret import .env --app web --server dev --yes`.

**Result**: `.env, for web on dev`, `new OTHER_PROJECT_TOKEN`, stored. Nothing names `other.env`.

**Smallest fix**: when the opened path is a link, say where it leads in I1. Whether to refuse links
inside the current folder is the maintainer's choice.

### Needs validation

- **`docker compose version` on a real server.** The check script runs it, as the installer does.
  The stand-in Docker writes only its log, so whether a real Docker CLI creates anything under
  `~/.docker` on a fresh account was not seen. Missing: one run against a real Docker CLI with an
  empty home folder.
- **SSH's own files during `zekno doctor`.** zekno writes nothing locally. `ssh` itself may: with
  OpenSSH's default `UpdateHostKeys`, or a user's `StrictHostKeyChecking accept-new` or
  `ControlMaster`, it can write `~/.ssh/known_hosts` or a control socket; on the server, `sshd`
  logs the login. SC-005 ("this machine and every server byte for byte") holds for zekno's files and
  actions only. Missing: a run with real OpenSSH and a stated scope for SC-005.
- **Echo between the first deploy's hidden prompts.** `asking` turns raw mode off in its `finally`
  after each prompt (`ui/ink.tsx:655`). The next prompt turns it on only after `setSecret` and
  `prepareSecretSet` have run (`asking/first-deploy.ts:307-313`). A value typed or pasted in that
  gap is echoed by the terminal and then thrown away. This is the accepted limit of feature 003
  ("What is typed before the question appears is echoed"), now with several prompts in a row.
  Missing: a pseudo-terminal run to measure the gap. If it matters, raw mode can stay on across
  the loop of step 7.

## 3. Properties checked and found to hold

| Property | Enforced at | Test |
|----------|-------------|------|
| With no terminal, `--json`, piped input or `TERM=dumb`, nothing is asked and every existing command takes its old path | `ui/plain.ts:56` (`wantsPlain`), `:115` (`asks: false`); `cli.ts:158`, `:179`, `:253`, `:232` (`server update`), `:264` (`link`) | `test/plain/plain-unchanged.test.ts` (every scene against the calls, lines and statuses recorded at `5264e8a`); `asking.test.ts`, "with no terminal nothing is asked"; `first-deploy.test.ts`, "piped: zekno deploy never asks" |
| A key typed before any question is drawn never answers it; a hidden prompt turns raw mode on first | `ui/ink.tsx:634-656` (`asking`: raw mode, then `discardTypedAhead`, then draw), used by `confirm`, `choose`, `ask`, `askValue`, `askSecret` | `test/ui/questions.test.tsx`, "keys typed before a question is on the screen never answer it" (list, typed answer, yes or no, both hidden prompts) |
| A `zekno.json` not signed by the team is never used; at a terminal it is named and left aside | `project.ts:566-574`; `cli.ts:167`; `asking/first-deploy.ts:217-221` (no profile: named, never used); `:292` (no "Remember this folder?" over it) | `asking.test.ts`, "a zekno.json not signed by the team: A14 …"; `first-deploy.test.ts`, "a zekno.json not signed by the team: named (A14) …" and "no profile and a zekno.json: F7 before the first question" |
| The first-use question for a team-signed file not used here comes before any other question, connection or signature | `project.ts:575-580`; `asking/first-deploy.ts:210-216` runs `withProject` before anything else | `asking.test.ts`, "… the first-use question comes first, before any question and any read"; `first-deploy.test.ts`, "… the first-use question first, and no ends with Nothing was done., nothing connected" |
| `reopenTeam` accepts exactly what `openTeam` accepts, and does not read the keychain again | `context.ts:199-203`, which calls the same `verifiedProfile` (`:170-188`) as `openTeam` (`:147-162`) with the team code read with the key, and refuses another `keyName` | `first-deploy.test.ts`, "reopenTeam reads the profile again and proves it again, without the keychain; a changed profile is refused" (an added unsigned server only; see part 4) |
| From nothing, each thing is made only after its question, and the Compose file is read before the first question | `asking/first-deploy.ts:224-231` (read), `:247-256` (name, then `createTeam`), `:264-276` (destination and name, then `connectServer`), `:293-296` (F5, then `linkFolder`), `:308-313` (hidden prompt, then `setSecret`), `:322-324` (deploy last) | `first-deploy.test.ts`, "six answers …", "leaving a question, then running again" (every question), "the installer fails …", "SSH cannot connect …", "no Compose file …" |
| The text deployed is the text read in step 1 | `asking/first-deploy.ts:322` passes `read`; `ops/deploy.ts:110-119` uses `input.read` before reading anything | No test swaps the file during a first deploy (part 4) |
| A value typed in the first deploy goes only to its sealed record | `asking/first-deploy.ts:310-312`; `ui/ink.tsx`, `ValuePrompt` keeps it in a ref, never in state, and leaves behind only the question | `first-deploy.test.ts`, "six answers …" searches every file and line for the value |
| Names the first deploy asks values for are never reserved and fit the name rule | `compose-file.ts:167-168` (`usable`); `ops/secret.ts:90-98` | Existing `compose-file.test.ts`; `first-deploy.test.ts` |
| The import file is opened once, checked on the descriptor, never waited on as a pipe, bounded while read, strict UTF-8 | `secrets/import-file.ts:68-109` | `import-file.test.ts`, "reading the file" |
| A line that does not fit is named by number and reason only; no import error carries a value | `secrets/import-file.ts:55-58`, `:225-251`; `ops/secret.ts:63-73` (`asCliError`, fixed sentences) | `import.test.ts`, "no value in any error …" and "twenty values … no value anywhere but sealed" (S1 is a piece of a value taken as a name, not an error) |
| The import stores every value or none | `ops/secret.ts:199-214`: all sealed inside one `withSigner`, then one `saveSecrets` | `import.test.ts`, "all or nothing: a signer that fails on the third record …" and "… a store folder that cannot be written …" |
| The import's limits apply before anything is sealed | `ops/secret.ts:175-180` | `import.test.ts`, "the limits stop the import before anything is sealed" |
| `zekno doctor` writes nothing on this machine: no `links.json`, no profile, no keychain | `ops/doctor.ts:219-236` (a key store that refuses writes), `:308-328` (`standingOf`, never `withProject`); it calls no `save`, `accept` or `withSigner` | `doctor.test.ts`, `unchanged()` around every run: snapshots of the profile folder, the project folder and each stand-in server, and `links.json` |
| `zekno doctor` and the asking step reach servers in SSH's batch mode only and never hand the terminal to SSH | `ops/doctor.ts:355`, `:402`; `asking/asking.ts:90`; `app/hand-over.ts:73-76`; `transport.ts:272-276` (`-o BatchMode=yes` before `--`) | `doctor.test.ts`, "Reachable …" and the broken setups; `asking.test.ts`, "a runner that cannot be reached …" |
| The check script is fixed text, only reads, takes one checked word, and its output is held to patterns in order | `server/check-script.ts:35-90`, `:100-103` (`isInstallPath`), `:146-228`; `transport.ts:268`, `:308-313` | `check-script.test.ts` (its text, its words, `runCheck` line by line, under each shell) |
| Everything `zekno doctor` shows from a server or a file is cleaned | `ops/doctor.ts:206-208` (`line()` cleans every detail and next step), `:460` | No test feeds escape sequences into a doctor line (part 4) |
| App names a runner offers are held to the app-name pattern, cleaned, and read only after the server proved its identity | `asking/asking.ts:77-83`, `:116`; `ops/status.ts:25-29`, `:106-108` | `asking.test.ts`, "names a runner sends that are not app names are never drawn …" |
| Installer lines in the first deploy are cleaned and marked as the server's | `install.ts:816`; `asking/first-deploy.ts:352`, `:358` (`remoteThroughUi`, `ui.remote`) | Covered for `server add` by the existing tests; no first-deploy test feeds hostile lines |
| The newer-release check is one fixed GET with fixed headers, follows redirects only to `https://api.github.com`, ends within 3 seconds and 256 KiB, reads only `tag_name`, never throws, never changes an exit status, and causes no download | `version/newest.ts:29-184`; `cli.ts:140-156`; `ops/doctor.ts:242`, `:447`, `:468`; `commands/doctor.ts:60` | `newest.test.ts`; `version.test.ts`, "no other command asks GitHub (FR-036)". Also run here through Bun's own `fetch` on loopback: Bun did not follow a 302 itself; it added only `accept-encoding`, `connection` and `host`; a 64 MiB gzip body and a stalled body both ended as not checked |
| `zekno --version` never uses the network and reads nothing but the two built-in versions | `cli.ts:140-142` | `version.test.ts`, "zekno --version never uses the network" |
| At a terminal, a secret's name, `--to` and `--tail` are checked before any question | `cli.ts:211-215` | `asking.test.ts`, "what needs no answer is checked before any question" |
| Words after the new commands are refused | `cli.ts:55`, `:63-64`, `:134-136` | `version.test.ts`, "… nothing may follow `zekno version`"; `import.test.ts`, "with no terminal: wrong usage …" |
| The member name and the SSH destination are checked where they are typed | `asking/first-deploy.ts:249`, `:266`, `:273`; `profile.ts:49` (`isMemberName`) | `first-deploy.test.ts`, "the name refused: A6 …"; `asking.test.ts`, "isMemberName …" |

## 4. Tests that are missing

For properties that hold:

- `reopenTeam` with the latest team list dropped from the profile, and with another `keyName`
  (only an added unsigned server is tested).
- A first deploy whose Compose file is changed between step 1 and the deploy: the text signed must
  be the text read.
- A `zekno doctor` line from a server whose session error, refusal or SSH line holds escape
  sequences: the drawn report, the plain lines and `--json` must hold no control character.
- A first deploy whose installer writes escape sequences on standard error: each line marked and
  cleaned.

For the findings, once fixed: a wrapped value in an import file (S1); a runner that falls back to
one-shot and stalls, for `runDoctor` and `appRows` (S2); a "new" app name the runner holds while
the batch read fails (S3).

## 5. Carried over from earlier reviews

**Feature 003**

- C1, trust rebuilt from the signed lists on every run: still true. `reopenTeam` uses the same
  checks.
- C2, a local runner's command decided by the CLI: still true. `zekno doctor` and the asking step
  reach a local server through `reach` and `connect`.
- C4, deploy numbers: still true. The first deploy ends in the existing `prepareDeploy` and `send`.
- C5, the hidden prompt: still true, and stronger. `askSecret` now throws away typed-ahead keys
  before it is drawn. `askValue` follows the same rules; Esc skips by design.
- C6, runner names cleaned and identity checked: still true for the new lists and for `doctor`
  (`ops/doctor.ts:358`).
- Hardening (words after a command, reserved names): still true for `secret import`, `doctor` and
  `version`. The import and the first deploy leave reserved names out.
- Limit "What is typed before the question appears is echoed": still true. See "Needs validation".
- Limit "Attacker B can change where the CLI connects": still true. `zekno doctor` now also starts
  whatever the profile's runner path names, with `session`, as `zekno status` already did.

**Feature 004**

- C7 and C8, a server's standard error bounded and marked: still true. The first deploy passes
  installer lines through `remoteThroughUi` and `ui.remote`, as `server add` does. `doctor` and
  the asking read keep SSH's lines in `batchOnly`'s record and draw none of them.
- L3, answer sizes: still true. The new reads use the session's frame limits and
  `RunnerStatusSchema`.
- L4, a signal stops a session: true for sessions; not for the one-shot fallback (S2).
- L7, reads without a person in batch mode only: still true for the asking read and `doctor`.
- L8, a time limit on reads: see S2.
- U4, the hand-over decided on SSH's own closing line: `doctor` uses the same `wouldHaveAsked`.
- P1, S1 and S2 of the project file: still true. At a terminal an unsigned file is left aside and
  never used. The first-use question is unchanged and comes first.
- P2, P6 and P7: still true in the first deploy (`readCompose`, the text passed on as `read`) and
  in `doctor` (reads only).
- K1, `zekno link` asks before it records: still true. `linkDetails` passes a team-signed file
  through to `link` unchanged.
- K10, one keychain read per command: still true with `peek`. A first deploy from nothing writes
  the key, then reads it once.
- K12, typed-ahead keys: now applied to every question and to `secret set`'s hidden prompt.
- F3, the secret's name checked before the prompt: still true; at a terminal before any question.
- N1, a token taken as a secret's name: widened by S1 for files.
- "Left", the hidden prompt of `secret set` did not throw away typed-ahead keys: fixed by this
  feature (`ui/ink.tsx:750-768`).
- S4, anyone who can start the runner reads `state` and `logs`: unchanged. The asking read uses
  `status` and `state`, as the app does.

**Feature 005**

- RV8, the C locale first: the check script sets `LC_ALL=C` before anything else.
- "A server's claimed version never goes into the script": still true. The check script takes only
  the profile's runner path.
- U1 to U3 of `server update`: unchanged. At a terminal it now asks which server, then runs the
  same update, with its own question.

**Not checked by this review**: a real terminal or pseudo-terminal; real SSH, Docker or Linux; a
real answer from GitHub; the full-screen app, beyond seeing that none of its files changed.

## 6. After the review: what was fixed

**Written by the implementer who fixed the findings, not by the reviewer.** Parts 1 to 5 above are
the reviewer's and are unchanged. Everything below was run on `006-cli-small-features` after
`724130a`, with the in-memory key store, local runners, the stand-in `ssh` and the stand-in Docker;
no keychain, no real SSH host, no network.

| Finding | Status | Commit |
|---------|--------|--------|
| S1 | fixed | `9f26e59` |
| S2 | fixed | `9445411` |
| S3 | fixed | `fbb5a99`, follow-up `b260fe6` |
| S4 | answered by the maintainer's decision on 2026-11-15, built in specs/008-cli-decisions | `bddaef6` |
| Echo between the first deploy's hidden prompts ("Needs validation") | fixed | `45f57d1` |

**S1, a piece of a value becomes a secret's name.** The review's smallest fix, as written:

- `secrets/import-file.ts`, `readLine`: an unquoted value that begins with `=` (after the spaces
  that follow the key's `=`) stops the import with I2, `<file>, line <n>: this is not a NAME=value
  line. Nothing was stored.`, naming the line's number only. `NAME=a=b` still reads `a=b`.
- `ops/secret.ts`, `leftOut`: an entry left out because its value is empty, its key does not fit
  `SECRET_NAME`, or its value is larger than 64 KiB is shown as `line <n> (empty)`, `line <n> (not
  a valid name)`, `line <n> (larger than 64 KiB)`, as a key longer than 128 characters already was.
  A reserved name is still shown as written (`PATH (zekno keeps this name)`). The import has no
  `--json` output, so there was nothing to change there.
- With the review's file, the import now stops at line 2 and stores nothing; without line 2, line
  4 is `line 4 (empty)`.
- Tests: `test/secrets/import-file.test.ts` (the grammar cases `QUJD…Ng==`, `NAME==`, `NAME==x`,
  `NAME = =x`, `NAME==$x`, and the order case `<sentinel>==`), `test/secrets/import.test.ts`, "a
  value wrapped onto lines of its own (security review S1): no piece of it is shown, stored as a
  name, or in any error" (the review's file, plain and at a stand-in terminal; every output, error,
  drawn byte, stored name and file of the profile folder searched for each piece). Existing
  expectations in `import.test.ts` changed from the key to `line <n>`: the left-out group of the
  storing test, of mock-up 4 (plain, at a terminal and through the stand-in terminal) and of the
  case where every name is left out.
- Still true after the fix: the first line of a wrapped value is stored as the whole value without a
  word (the review's `GOOGLE_CREDENTIALS` point); a wrapped line that itself reads as `NAME=value`
  with a valid name would be stored under that name, shown under `new` before the question (no
  base64 or base64url piece does: `=` comes only at its end). The reserved-name rule matches
  prefixes and suffixes case-insensitively (`LD_…`, `…_proxy`), so a base64url piece that happens
  to match it would still be shown as written; the brief for this fix decided reserved names stay
  shown.

**S2, no time limit after a runner answers as one from before sessions.** As the review proposed:
`openSession` hands its signal to the one-shot path (`oneShot(transport, signal)`); a one-shot
request passes it through `ask` to `Transport.run`, which kills the process (or the SSH connection)
as soon as the signal fires and rejects without waiting for the process any further; the request
then rejects with `ENDED`. Without a signal, a one-shot request runs exactly as before. Tests: a
stand-in runner (`stallingRunner` in `test/stand-in-server.ts`) that prints `hello` for `session`
and writes its process id and then sleeps for `status`: `test/ops/doctor.test.ts`, "a runner that
answers as one from before sessions, then never answers status (security review S2) …" (on this
machine with a 1-second limit, and over the stand-in `ssh` with a 3-second limit: the Runner line
says `did not answer within 20 seconds`), and `test/asking/asking.test.ts`, the same title, for
`appRows` with a 1-second limit (this machine's history is offered); both return within their
limit and check that no runner process is left running. Both tests fail before the fix (a 20 s and
a 30 s timeout). Every other caller that already passed a signal to `openSession` (the app's
background reads, `zekno logs`, `server add` and `server update` through `ops/server.ts`) now has
its one-shot requests stopped by that signal too, as its session requests already were.

**S3, a "new" app can replace an app already on the server.** The review's first fix, on the
deploy's own connection: `DeployPlan` carries `fresh` (the app's name was typed as new in
`whichApp`); `sendDeploy` compares it with `status.lastSequence`, which it already reads on its
session before anything is signed, and throws `AppTaken` (A12, `<server> already has an app named
<app>. Choose it from the list, or give another name.`) when the runner holds the app. Nothing is
signed, recorded in the history, or sent; no new connection is made. In the first deploy, the key,
a server and the values made earlier in the run stay, and A12 is followed by F9 when any of them
was made, as the flow's leaving rule says. Tests:
`test/asking/first-deploy.test.ts`, "a second machine with no history of the app, its apps not
read: A12 from the deploy's own connection, before anything is signed, stored or sent": machine A
deploys `api`; machine B (same team and server, no history) in a folder named `api`, the batch-mode
read failing as SSH does where it would ask, the deploy's own connection working; with "Remember
this folder?" answered no and yes: status 1, A12 (and F9 after zekno.json was written), no history
entry on B, the stand-in server byte for byte as it was, nothing started. It fails before the fix
(the deploy went through).

A follow-up closed the case where "Remember this folder?" was answered yes in that same run
(the follow-up commit in the table above): zekno.json then named the taken app, so the
next `zekno deploy` there would have deployed onto it without asking, as F9 told the person to do.
Now, when the deploy stops with `AppTaken`, a zekno.json this run wrote is removed, only while its
bytes are still exactly those written (`unlinkWritten` in `ops/link.ts`), and its record of first
use is taken back from `links.json` (`forget` in `accepted.ts`; a record it replaced for the same
path is put back). F9 is said only when the key, a server or a value made in this run is kept and
no zekno.json of this run is left; a zekno.json that changed after it was written is left as it is,
and A12 is said alone. A run cannot replace an older zekno.json: step 6 asks only where none applies
to the folder (here or above) and writes without `--force`, which refuses an existing file.
Tests, in the same describe: with "Remember this folder?" answered yes, A12 alone, zekno.json gone,
`links.json`'s records as before, the server unchanged; the next run asks `Name for this app` again,
and sends nothing for `api` (Esc ends it; naming `api` again stops with A12 again); with a value
stored in the run, A12 and F9, zekno.json gone, the value's sealed record kept; a zekno.json changed
after it was written stays, with A12 alone. Both fail before the follow-up. The review's second fix
(no folder name filled in, and saying the list comes from this machine only, when the read failed)
was not built.

**S4, the import names the link.** Not changed: waiting for the maintainer, as the brief for these
fixes says. Answered later the same day: see "After the review, feature 008" at the end.

**Echo between the first deploy's hidden prompts.** Fixed, in `ui/ink.tsx` only. After a value is
given or skipped at `askValue`, the prompt is replaced in the same update by a component that reads
keys (`HeldInput`), so Ink keeps raw mode on across the swap and `asking` does not turn it off; it
stays on until the next question opens in its place, anything else is drawn, a step or a deploy
starts, the interface closes, or 2 seconds pass. What is typed meanwhile is thrown away, as the next
prompt would throw it away. Ctrl-C in that time turns raw mode off and sends the process the SIGINT
the terminal would have sent with raw mode off. The plain path is unchanged; no `Ui` method was
added; only `askValue` holds raw mode. Tests: `test/ui/questions.test.tsx`, "between two hidden
values of one flow" (raw mode never goes off between two prompts and keys typed between them reach
neither; it goes off on its own and on close; Ctrl-C between them sends SIGINT with raw mode off;
a list and a yes-or-no question still turn it off at once). In a real pseudo-terminal (a driver
outside the repository: two hidden prompts with 1.5 s of work between them, `typed-between` typed
in the gap): before the change the terminal echoed `typed-between`; after it nothing was echoed and
both values arrived as typed; Ctrl-C in the gap ended the program by SIGINT, with echo and line
mode off in the gap until then. The walkthrough's `m3-value` scene (a value skipped, then the next
one typed) ran through it at both sizes. The existing type-ahead helper in `questions.test.tsx` now reads
raw mode after the flow draws its next line. Still true: what is typed before the first prompt
appears, while raw mode is off, is echoed (feature 003's accepted limit); during the hold, Ctrl-Z
and Ctrl-\ do nothing (for 2 seconds at most).

### After the review, feature 008: S4 answered, and the newer-release check's host

**Written by the implementer of [specs/008-cli-decisions](../008-cli-decisions/spec.md), not by the
reviewer.** On `008-cli-decisions`, from `dev` after feature 007, with the in-memory key store, the
stand-in runners and a stand-in `fetch`; no keychain, no real SSH host, no network. The maintainer
approved the three decisions on 2026-11-15.

**S4, the import names the link: answered** (`bddaef6`). The review's smallest fix, as the
maintainer chose it; links inside the current folder are still followed, not refused. When the
path typed for `zekno secret import` is a symbolic link, I1 reads `<file> (a link to <real path>),
for <app> on <server>`, at a terminal and in plain output; I18 still names the path as typed. The
real path is the one of the file that was opened: `readImportFileAndLink` in
`secrets/import-file.ts`, right after `fstat` of the open descriptor, takes `lstat` of the path;
for a link it takes `realpath` and uses that name only when `stat` of it gives the same device and
inode as the descriptor's `fstat` (`whereLinkLeads`); for a path that is not a link, `lstat` must
give them. Node cannot ask a descriptor for its path on macOS, so this is a second lookup, checked
against the descriptor. What a race can still do: someone who can change the link or a folder on
its way between the open and the check makes the import stop with I20 (`<file> could not be
read.`), before anything is read; they cannot make it name one file and read another. After the
check the path may be changed to name something else, but the values were read from the file the
shown name named at the check. A file with several hard links is the same file under each name,
so the name shown may be any of them. A link in a folder of the path, with a last part that is not
a link (`config/.env` where `config` is a link), is not named: the decision names the path typed
being a link. The real path is cleaned with `sanitize`, as every shown path is. Tests:
`test/secrets/import-file.test.ts` (a link, a link to a link, a relative link, a regular file with
no name; a link to a folder, a pipe or nothing refused as before; `whereLinkLeads` refusing a link
or a path that names another file than the one opened; a second process renaming the link between
two files over and over while it is read: every read names the file whose text it gave, or stops
as unreadable, and the test fails within milliseconds when the device and inode check is taken
out), `test/secrets/import.test.ts`, "an import file that is a link" (plain and at a stand-in
terminal; a real path holding escape sequences shown cleaned; no value anywhere but sealed).

**The newer-release check's host changed** (`d10a89f`). It reads
`https://raw.githubusercontent.com/zekno-app/zekno/main/apps/cli/src/version/runner-release.json`
instead of the REST API, because the API's 60 unauthenticated requests an hour per address run out
on a shared address (research R14, "Change of decision"). The attacker of part 1 is now whoever
answers for `raw.githubusercontent.com`. Kept, each with its test in `test/version/newest.test.ts`
unless named: one GET with Bun's own `fetch` handed in by `main.ts` only (`version.test.ts`, "main.ts
hands Bun's fetch to run"); no `deps.fetch`, no request; no credentials, no cookie, no query, no
body; a fixed generic `User-Agent: zekno`, now the only header (the API-only `Accept` and
`X-GitHub-Api-Version` went); `redirect: "manual"`, and a redirect followed only to `https:` on
`raw.githubusercontent.com`, with no port and no user name or password, at most three; one 3-second
limit over connecting, every redirect and the body; status 200 only; the body read from its
stream up to a smaller limit, 16 KiB (the file is under 300 bytes), the reading cancelled past it;
strict UTF-8; `JSON.parse` inside the bound; the version held to `RUNNER_VERSION_PATTERN`, a
development version not taken, compared with `compareRunnerVersions`; any failure "Could not check
for a newer release." with the exit status unchanged; never a download, nothing written; only
`zekno version` and `zekno doctor` ask, and `zekno --version` never does (`version.test.ts`, "no
other command asks GitHub" and "zekno --version never uses the network"). The answer is now held to
the release file's whole form by the CLI's own strict reader of that file (`RunnerReleaseSchema`,
`version/runner-release.ts`, exported for this and used with `safeParse`): no field the form does
not have at any level, a `__proto__` key included, each checksum 64 lowercase hex characters or
null. A higher version is announced only when both checksums are there; without them it is "This
is the newest release.", since it cannot be installed yet. The checksums are only looked at,
never kept or shown. Known and accepted: if the file moves again, older builds say they could not
check; anything this machine trusts to answer for the host can still name a false version, and
the effect is one sentence, as before.

**Two looks** (`1ddf9d4`). No security effect: the board for "Nothing more was done." now draws the
program's error style; A9 and A10 of the first deploy's hidden prompt are drawn as a typed answer's
reason. Nothing of a value is drawn, as before (`test/ui/ink/questions.test.tsx`,
`test/asking/first-deploy.test.ts`).

## 7. Second review: the decisions of feature 008

**Written by the same independent reviewer as parts 1 to 5**, not by the implementer. Parts 1 to 6
are unchanged.

### Scope and method

**Commits.** `d10a89f`, `bddaef6`, `1ddf9d4` and `3b6c63e` on `008-cli-decisions`: everything in
`git log dev..HEAD`. In `apps/cli/src` that is six files: `version/newest.ts`,
`version/runner-release.ts`, `secrets/import-file.ts`, `commands/secret.ts`,
`ui/ink/hidden-prompts.tsx` and `ui/ink/questions.tsx`. The moves of feature 007 were not reviewed.

**Read**: the diff of those six files and each file in full; `specs/008-cli-decisions/spec.md`; the
amended `contracts/version.md`, `contracts/import.md` and `contracts/questions.md`; part 6 above;
and, to see that they did not change, `ui/ink/raw-mode.tsx`, `ui/ink/ink.tsx` (`askValue`) and
`ui/ink/left-behind.ts`.

**Run**:

- The five test files feature 008 touched or relies on: `test/secrets/import-file.test.ts`,
  `test/secrets/import.test.ts`, `test/version/newest.test.ts`, `test/version/version.test.ts`,
  `test/ui/ink/questions.test.tsx`. 111 tests, all pass.
- Four throwaway probes in a scratch folder outside the repository:
  - the redirect rule, with 17 `Location` values, and the strict reader, with 23 hostile files,
    through `checkNewest` and a stand-in `fetch` (nothing left the process);
  - Bun's own `fetch` with `checkNewest`'s request, against an HTTP server on 127.0.0.1 (loopback
    only, ephemeral port): what is sent, a redirect, a compressed body, a 64 MiB compressed body,
    a stalled body;
  - `readImport` on a link in a folder of the path, a link to a link, a hard link, a target whose
    folder name holds control characters, and a real path of 934 characters;
  - the plain output of a whole import through a folder link.
- Not used: the system keychain, `ssh`, the network, a real terminal.

### Findings

| Id | Severity | Finding | Confirmed |
|----|----------|---------|-----------|
| S5 | Informational | A link in a folder of the import path is not named, so S4's case is still reachable that way | Yes, by a probe |

No finding is rated low, medium, high or critical.

#### S5. A link in a folder of the path is not named (Informational)

**Why informational**: it is S4 again, by another route; links are followed by design and the
person still confirms the names.

**Where**: `apps/cli/src/secrets/import-file.ts:78-87` (`whereLinkLeads`). `lstat` of the path
follows every folder of it and looks only at the last part. When that part is not a link, nothing
is named.

**Who**: the author of a cloned repository. Git keeps a link to a folder as it keeps a link to a
file.

**Steps** (probe): `config` is a link to a folder outside the project that holds `.env`. Then
`zekno secret import config/.env --app web --server dev --yes`.

**Result**: `config/.env, for web on dev`, then `new OTHER_TOKEN`, stored. Nothing names the
folder the value came from. The same file, reached by a link as the last part, is named:
`chain.env (a link to /private/var/…/other.env)`. Part 6 and `contracts/import.md` say this case
is not named, but not what a person sees then. It is what S4 described.

**Smallest fix**: name the real path when any part of the path as typed is a link: check each
prefix of the typed path with `lstat`, relative to the current folder when the path is relative.
Then compare `realpath` of the whole path with the descriptor, as `whereLinkLeads` already does.
An absolute path through a system link, such as `/tmp` on macOS, would then be named too, which
says nothing false.

### Needs validation

- **A tag named `main`.** The address is `…/zekno-app/zekno/main/…`. It was not checked which ref
  `raw.githubusercontent.com` serves when the repository has both a branch and a tag named `main`.
  Git itself prefers the tag. If GitHub does too, whoever can push a tag named `main` decides what
  the check reads. That bypasses `main`'s rules (no force push, `check-main` required) and any tag
  rule written only for `runner-v*`. The effect is the one sentence below. Missing: one request
  against a test repository with both refs. Hardening that needs no answer:
  `…/zekno-app/zekno/refs/heads/main/apps/cli/src/version/runner-release.json`, which names the
  branch only. That form was also not run here.
- **"Older builds never say something false" after a move.** This holds only if the old path is
  removed from `main`. A stale copy left at the old path would be read, and builds would say "This
  is the newest release." when it is not. The effect is one sentence; it is a step for the
  procedure, not code.
- **Device and inode on unusual file systems.** The import's check relies on `dev` and `ino`
  naming one file. While the file is open its inode cannot be reused, so on a local file system a
  match is the same file. A FUSE or network file system that reports the same or made-up inode
  numbers for different files was not tried. On such a mount, someone who can swap a link there
  could have one file named and another read.

### What holds

**1. The newer-release check reads the release file** (`version/newest.ts`):

| Property | Holds at | Checked |
|----------|----------|---------|
| One GET of a fixed address, with no credentials, cookie, query or body, and one header, `User-Agent: zekno` | `:43`, `:49`, `:152` | Loopback probe: Bun sent `accept: */*`, `accept-encoding`, `connection`, `host` and `user-agent: zekno`, nothing else; `newest.test.ts` |
| Only `zekno version` and `zekno doctor` ask, and `zekno --version` never does | unchanged (`cli.ts`, `ops/doctor.ts`) | `version.test.ts`, "no other command asks GitHub", "zekno --version never uses the network" |
| Bun does not follow a redirect itself | `:152`, `redirect: "manual"` | Loopback probe: one request, then not checked |
| A redirect is followed only to `https:` on `raw.githubusercontent.com` exactly, with no port and no user name or password, at most three times | `:96-106`, `:153-158` | Stand-in probe. Not followed: `api.github.com`, `github.com`, `gist.githubusercontent.com`, a trailing dot, port 8443, a user name, `…@evil.example`, backslashes, `http:`, a `#@` trick, `%2e`, a look-alike `xn--` host. Followed: another account's path on the same host, written absolute, relative or protocol-relative, in capitals, or with `:443` |
| Only whoever answers the first request can redirect, and they could answer the file directly, so a redirect gives them nothing more | `:153-158` | Read. The same was true of the API, where `/repos/<other>/<repo>/releases/latest` is another account's data on the same host |
| One 3-second limit over connecting, redirects and the body | `:183-187`, `:117` | Loopback probe: a stalled body ended at 1.5 s with a 1.5 s limit |
| Status 200 only | `:160-163` | `newest.test.ts` |
| The body is read up to 16 KiB, after Bun has unpacked it | `:55`, `:109-133` | Loopback probe: a small compressed file was read, a 64 MiB compressed body ended as not checked, about 1 MiB of growth. Stand-in probe: 16,384 bytes read, 16,385 not |
| Strict UTF-8, then `JSON.parse`, inside the `try` | `:166`, `:182-190` | Stand-in probe: a byte order mark is dropped by the decoder; an array 8,000 deep and a deep value inside `files` end as not checked |
| The reader of untrusted text is safe | `runner-release.ts:17-23` | Stand-in probe. Its patterns are anchored and bounded (`RUNNER_VERSION_PATTERN`, `{64}`); `__proto__` and `constructor` keys and extra fields are refused at every level; `safeParse` never threw; the issues it returns did not include the input, and `releaseIn` discards them anyway (`:141-142`). A duplicate `version` key is read as JSON reads it: the last one |
| Only the version leaves the reader; the checksums are only looked at | `:140-146` | Read |
| A higher version without both checksums is not announced; a development version is not checked | `:144-145`, `:168-170` | Stand-in probe: one checksum or none gives `newest`; `0.2.0-dev.1` gives `not_checked`; `newest.test.ts` |
| What reaches the terminal or `--json` is one sentence and `latest`, the version digits and dots of at most 29 characters | `:166-170` | Stand-in probe: an escape sequence, a newline, a leading zero, upper-case hex and a ten-digit number are all refused; `999999999.999999999.999999999` is the largest that passes |

**What whoever answers for the address can do.** That is whoever can change the file on `main`, or
answer for `raw.githubusercontent.com`: GitHub, its CDN, a proxy, or a certificate this machine
was made to trust. They choose which of three things `zekno version` says: V1, V2 with any version
of the grammar, or V3. They choose `latest` in `zekno version --json` and `zekno doctor --json`. In
`zekno doctor` a `newer` state also changes the `zekno` line from good to a warning, gives it D50
as its next step (and so hides D2 when both apply), and adds one to the warnings count. That is
in the contract and unchanged from part 1. They cannot change an exit status, cause a download,
name a URL, or reach anything that installs: installs use the checksums built into the program
(`runner-release.ts:30-34`), never the fetched file. They can also hide a real newer release by
answering V1 or V3. Before, the same power belonged to whoever could publish a GitHub release; now
it belongs to whoever can change `main` (see "Needs validation" for a tag named `main`).

**2. The import names where a link leads** (`secrets/import-file.ts`, `commands/secret.ts`):

| Property | Holds at | Checked |
|----------|----------|---------|
| The name shown is a name of the file read: `realpath`, used only when `stat` of it gives the descriptor's device and inode; reading is from the descriptor after the check | `import-file.ts:78-87`, `:114-118` | `import-file.test.ts`, "a link changed over and over while it is read …" (a second process swaps the link; every read names the file whose text it gave, or stops) |
| A swap between the open and the check, a link removed, or a dangling link after a swap stops the import with I20 or I19, before anything is read | `:82`, `:86`, `:136-137` | `import-file.test.ts`, "a path that no longer names the file opened gives no name …"; probe (a missing link: I19) |
| A link to a link names the file at the end | `:85` (`realpath` resolves the whole chain) | Probe; `import-file.test.ts` |
| Inode reuse cannot pass the check on a local file system: the open descriptor keeps the inode in use | `:80`, `:86`, `:114` (`bigint` stats, so large inode numbers compare exactly) | Read (see "Needs validation" for other file systems) |
| A hard link is the same file under another name; no link is named | `:80-83` | Probe: `hard.env`, no name |
| The real path is cleaned before it is shown, at a terminal and in plain output | `commands/secret.ts:71` (`sanitize`) | Probe: a folder named with ESC, `[2J`, a newline and U+202E is shown as `abcd`; `import.test.ts`, "an import file that is a link" |
| The real path is bounded | the system's path limit: `stat` of it must succeed (1,024 bytes on macOS, 4,096 on Linux) | Probe: 934 characters, shown whole |
| No value can reach the first line | I1 is built from the typed path, the real path, the app and the server only (`commands/secret.ts:31-32`, `:96`); the name is taken before any byte is read, and `whereLinkLeads`'s errors become I20 (`import-file.ts:136-137`) | Read; `import.test.ts` searches every output for each value |

**3. A refused hidden value is drawn without `!`** (`ui/ink/hidden-prompts.tsx`, `questions.tsx`):

| Property | Holds at | Checked |
|----------|----------|---------|
| The `Reason` line draws only A9 (a constant) or A10, built from the secret's name, cleaned and held to the name rule; `withoutBackticks` removes backticks only, with a bounded pattern | `hidden-prompts.tsx:68-75`, `questions.tsx:25-26`, `:121-127`, `marks.tsx:15` | Read; `questions.test.tsx` |
| A refusal empties the value: nothing typed or pasted stays | `hidden-prompts.tsx:68` | Read |
| Leaving after a refusal leaves the question line only: the reason goes with the prompt, and the line left behind holds no answer | `ink.tsx:167-170`, `left-behind.ts` (`left(question, "hidden")`) | Read |
| Raw mode, the discard of typed-ahead keys and the hold between two hidden values are as before | `raw-mode.tsx`, unchanged by feature 008 (not in `git diff dev HEAD`) | `questions.test.tsx`, "keys typed before a question …" and "between two hidden values of one flow" |
| The hidden prompt of `zekno secret set` draws no reason of its own | `hidden-prompts.tsx:30-41` | Read |

