# zekno-runner

The program that runs on your server. It is an ordinary command-line program, not a service: it
opens no network port, never asks a question, and runs only when it is started. Each run reads
its standard input, answers on standard output, and exits.

The [CLI](../cli) starts it over SSH. The runner checks, with
[`@workspace/core`](../../packages/core), that a deploy was signed by your team, is addressed to
this server and is newer than the last one. Only then does it decrypt the secrets and start
Docker Compose. Having SSH access is not enough to make it run something: the signature is.

> **Pre-alpha and unaudited.** The runner, the CLI and the core library have had internal reviews
> only. Do not use it for anything you could not afford to lose, and do not rely on it in
> production before an external audit.

## Commands

| Command | Reads | Prints |
|---------|-------|--------|
| `zekno-runner setup` | the founding team list and the team code | this server's public key, its id and its code |
| `zekno-runner sync` | newer team lists | `ok` or a refusal |
| `zekno-runner apply` | newer team lists and one deploy | `started`, `start_failed` or a refusal |
| `zekno-runner status` | nothing | versions and deploy numbers, never values |
| `zekno-runner version` | nothing | its version and protocol, such as `{"version":"0.1.0","protocol":2}` |
| `zekno-runner session` | one request per line, until its input closes | one frame per line |

Each command but `session` prints one JSON line on standard output. `setup`, `sync` and `apply`
read one JSON message from standard input, of at most 32 MiB. During a one-shot `apply`, Docker's
own output goes to standard error. Any other word, or more than one, prints the usage on standard
error. `deploy` and `records`, like `state` and `logs`, are requests of a session only:
`zekno-runner deploy` and `zekno-runner records` print the usage, with exit status 2.

### Protocol 3

Runner 0.1.0 speaks protocol 2. A runner built from this repository speaks protocol 3, and answers
`version` with `{"version":"0.1.0","protocol":3}`. No runner release speaks protocol 3 yet.

Protocol 3 means the runner carries out deploy format 2, `zekno.deploy.v2`: each deploy names the
deploy of the app it was made after (`previous`), may carry an expiry (`expiresAt`), and lists each
secret by its version. The runner keeps each secret's latest record, so a deploy sends only the
records it lacks. It answers two more requests in a session, `deploy` and `records`. It still opens
no network port and makes no connection of its own.

Deploy format 2 already has fields for builds from source, a command to run before a deploy, a
health check and routes. This runner carries out none of them, and refuses a deploy that uses one.
It takes a deploy in deploy format 1, through `apply`, only for the apps it held before it was
updated that have had no deploy in format 2 since (see [What it refuses](#what-it-refuses)). The
checks of format 2, in their order, are
[`specs/014-deploy-v2/contracts/runner-checks.md`](../../specs/014-deploy-v2/contracts/runner-checks.md).

### `session`

`zekno-runner session` lets the CLI make several requests over one connection, so one SSH login
serves a whole command. The CLI writes one request per line; the runner writes one frame per
line. Each line is JSON, at most 32 MiB.

```text
CLI    → {"command":"status"}
runner ← {"result":{ …status… }}
CLI    → {"command":"apply","input":{ …deploy… }}
runner ← {"event":"progress","line":" Container zekno-demo-web-1  Recreate"}
runner ← {"event":"progress","line":" Container zekno-demo-web-1  Started"}
runner ← {"result":{"outcome":"started","app":"demo","sequence":5}}
CLI    closes its side
```

| Request | Events | Result |
|---------|--------|--------|
| `version` | none | its version and protocol |
| `status` | none | as the `status` command, or a refusal |
| `setup` | none | as the `setup` command, or a refusal |
| `sync` | none | as the `sync` command |
| `apply` | `progress`: Docker's output, one line each | as the `apply` command |
| `state` | none | what is running for each app, or a refusal |
| `logs` | `log`: one line of an app's logs | `{"outcome":"ok"}` once Docker's log command ends |
| `deploy` | `progress`: Docker's output, one line each | `started`, `start_failed` or a refusal, as `apply` |
| `records` | none | the statements of the secret records it keeps for an app, or a refusal |

`state`, `logs`, `deploy` and `records` exist only inside a session. `deploy` and `records` need
protocol 3: a runner from before it answers either with `invalid_request` before it runs anything.

- Requests are handled one at a time, in order. Each is answered by zero or more events, then
  exactly one result.
- Every request goes through the same code as its one-shot command: the same lock, the same
  checks, the same order of work. A session is a way of carrying requests, not a second way in.
- `deploy` takes `{ "rosters", "envelope", "records" }`: newer team lists, one deploy in deploy
  format 2 and the records of the listed secrets the runner lacks. It takes the same lock as
  `apply`, checks the deploy in a fixed order, and only then uses its number and starts Docker
  Compose.
- `records` takes `{ "app" }` and answers `{ "statements": […] }`: for each secret of the app it
  keeps a record of, the record's signed statement, sorted by name. A statement says the secret's
  name, its version, the hash of its sealed value and who set it, never a value, sealed or not. An
  app it does not hold, or one it takes format 1 for, answers `{"statements":[]}`. Like `status`,
  it needs the runner to be set up and its folder to be private, takes no lock and changes nothing.
- `state` and `logs` read from Docker and change nothing. They need the runner to be set up and
  its folder to be private, like `status`, and take no lock.
- `state` runs `docker compose -p zekno-<app> ps --all --format json` for each app the runner
  has accepted a deploy of, and keeps only each service's name, state, exit code and health.
  Labels, commands, container names and host paths are dropped on the server. Docker gets 30
  seconds per app; an app it could not be asked about is left out, which means "not known", not
  "stopped". An answer holds at most 1,024 apps and 4,096 services.
- `logs` takes `{ "app", "tail", "follow" }`: an app the runner has accepted a deploy of, `tail`
  from 0 to 1000, and `follow`, true unless it is `false`. It runs `docker compose -p
  zekno-<app> logs --follow --timestamps --no-color --tail <n>` (without `--follow` when `follow`
  is false) and sends each line as a service, a time and its text, at most 16384 characters.
- Docker's commands for `state` and `logs` run in the runner's own folder, and get only `PATH`,
  `HOME`, `DOCKER_HOST`, `DOCKER_CONFIG`, `DOCKER_CONTEXT` and `XDG_RUNTIME_DIR` from its
  environment. No secret. `docker compose up`, for `apply` and `deploy`, runs in that folder too,
  with the same variables and the app's secrets.
- A line that is not a request is answered with the refusal `invalid_request`. After three in a
  row, the session ends.
- A client that gets more than 1,024 requests or 32 MiB ahead of the answers has its session
  ended. Requests still waiting are not run.
- After each result the runner waits until the frame has been read, the reader has gone or the
  input has closed, so a client that does not read cannot make it hold answers in memory.
  Progress frames do not wait: once 8 MiB of them wait to leave, further ones are dropped. A
  result is never dropped.
- When the input closes during `apply` or `deploy`, once the deploy has been accepted, it carries
  on to its end: its number is used. When the input closes during `logs`, or nobody reads any
  more, the runner stops Docker's log command and exits.

## Exit status

| Command | `0` | `1` | `2` |
|---------|-----|-----|-----|
| `setup`, `sync`, `apply`, `status`, `version` | done | refused, or the app did not start | wrong usage |
| `session` | its input closed, or its reader went away | three unreadable lines in a row, a client far ahead, or an unexpected error | wrong usage |

A CLI that gets status 2 for `session` knows it reached a runner from before sessions, one that
does not report its version, and uses the one-shot commands instead.

## Its folder

`ZEKNO_RUNNER_HOME` when it is set. Otherwise root always uses `/var/lib/zekno`. Any other user
uses `~/.local/state/zekno` if a runner is already set up there; else `/var/lib/zekno` only if
that folder exists and belongs to them (a server set up by an earlier version); else
`~/.local/state/zekno`. Mode `0700`.

| File | What |
|------|------|
| `server.key` | This server's secret key. Mode `0600`. It never leaves the server. |
| `server.pub` | This server's public key. |
| `state.json` | The team list it trusts, the last deploy number per app, the latest version of each secret, and a version mark: `"v": 2`, and each app's deploy format under `formats`. |
| `records/<app>/<hash>.json` | The latest record of each secret of an app deployed in format 2, named by the hash of its sealed value. Mode `0600`. |
| `apps/<app>/compose.yaml` | The Compose file of the last accepted deploy. |
| `lock` | Present while a `setup`, `sync`, `apply` or `deploy` is at work, so two runs never overlap. |

Decrypted secrets are never written here. They are handed to Docker Compose through its
environment. Docker itself keeps a container's environment in its own configuration. App state
and logs are read from Docker when asked and never stored.

A record is the secret's signed statement and its value sealed for this server's key, as it
arrived. The runner keeps one for each live secret of an app in format 2, and deletes the one it
replaces, and the one of a removed secret, once the state that no longer names it is saved. It
opens a record only after every check of a deploy that lists it, and checks the record's signature
again at each deploy. A server keeps at most 8,192 records, and at most 64 MiB of them. Deploys in
format 1 leave no record.

Runner 0.1.0 writes `state.json` without the mark. A runner that speaks protocol 3 reads such a
state and writes nothing until its first change (`sync`, `apply` or `deploy`), which writes it
whole with the mark; `setup` writes the mark from the start. Each app it held when it first read
the state is at format 1 until its first deploy in format 2, and stays at format 2 from then on. An
app it never held is at format 2 from its first deploy. Once the state has the mark, runner 0.1.0
cannot read it (see [What to know before you rely on it](#what-to-know-before-you-rely-on-it)).
The rules of the stored state are
[`specs/014-deploy-v2/contracts/state.md`](../../specs/014-deploy-v2/contracts/state.md).

## What it refuses

A refusal is one JSON line, `{"outcome":"refused","reason":"<word>"}`, with exit status 1, or a
result frame in a session. The reason is one of a fixed list of words; no answer carries a path
or other detail of the server.

- **Not set up**: `status`, `sync`, `apply`, `state` and `logs` refuse with `not_set_up`.
- **Already set up**: `setup` on a server that has a key refuses with `already_set_up`. The key
  is never overwritten.
- **A folder it cannot trust**: a `state.json` that is damaged or incomplete, or a folder or key
  file that belongs to another user or that anyone else can read or write, is refused with
  `invalid_state`. A broken file is never treated as "nothing accepted yet".
- **Another run at work**: `busy`.
- **A deploy it cannot verify**: a deploy not signed by a current member of the team, one meant
  for another server, one whose number is not newer than the last it accepted, or one whose
  secrets do not match its list, is refused before anything is decrypted. The reason says which.
- **A deploy out of order**: a deploy in format 2 names the app's last deploy it was made after.
  When that is not the runner's last number for the app, it is refused: `replayed` when it is
  lower, because another deploy got there first, and `sequence_jump` when it is higher.
- **A secret not accounted for**: a deploy in format 2 must list every secret of the app the
  runner holds a live version of, as current or as removed, and may carry records only for secrets
  it lists; otherwise `secrets_mismatch`. A listed secret the runner keeps no matching record of,
  and that was not sent with the deploy, is `secret_missing`. A secret whose record was set by
  someone the team list it holds no longer includes, sent or kept, is `untrusted_secret`.
- **An expired deploy**: `expired`, when the deploy's expiry has passed by the server's clock, or
  is more than 7 days after it. zekno signs no expiry over SSH. The order of deploys never depends
  on the clock.
- **What it does not carry out yet**: a deploy in format 2 that asks for a build, a command before
  the deploy, a health check or a route is refused with `unsupported_version`, once its format has
  been checked. One whose field breaks its own rule, with a field the format does not have, or
  with a `v` other than 2, is `malformed`.
- **Format 1, for an app that has moved on**: a deploy in format 1 (`apply`) is taken only for an
  app the runner held when it first read a state without the mark, and that has had no deploy in
  format 2 since. Any other is refused with `unsupported_version`, a word every older zekno can
  read.
- **Too much**: a deploy that would make it hold more than 1,024 apps or 8,192 secret versions, or
  keep more than 8,192 records or 64 MiB of them, is refused with `too_large`, before anything is
  opened.
- **A request it cannot read**: one that does not match its message, is larger than 32 MiB, or
  asks for the logs of an app it never accepted a deploy of, is refused with `invalid_request`.
  The app name is checked against the app-name pattern before Docker sees it.

Every refusal of a deploy in format 2 comes before its number is used, and changes nothing but the
team lists sent with it: `state.json`, `records/`, the Compose file and Docker are as they were.

## Install on a server

The server needs Docker with Compose, and Linux on x86-64 (a processor with SSE4.2: Intel
Nehalem, AMD Bulldozer or newer) or on ARM64, with the GNU C library (glibc) 2.17 or newer. Alpine
and other systems with musl are not supported yet. The rest of what a server needs, and what was
tried, is in the [docs](https://zekno.app/docs/servers#supported-servers). `ZEKNO_DOCKER` names the
Docker command if it is not `docker`.

### With `zekno server add`

`zekno server add <name> --ssh <user@host>` installs the runner by itself: the server downloads
the runner release that build of zekno carries, checks its SHA-256 against the value zekno holds,
checks that it starts, and only then puts it in place. A zekno built from `main` installs a prod
release, such as `0.1.0`; one built from `dev` installs a development release, such as
`0.1.0-dev.1`. The steps and their limits are in the
[docs](https://zekno.app/docs/servers#installing-the-runner).

| Who the CLI logs in as | Runner | Its folder |
|------------------------|--------|------------|
| root | `/usr/local/bin/zekno-runner` | `/var/lib/zekno` |
| any other user | `~/.local/bin/zekno-runner` | `~/.local/state/zekno` |

**The first runner release is 0.1.0.** `apps/cli/src/version/runner-release.json` holds its checksums, so
a zekno built from this branch installs it by itself. Installing by hand, below, and
`--runner-file` remain for development and for servers that cannot reach GitHub.

### By hand

```bash
# Here, in apps/runner. Build for the server's system, not your own
# (check with `ssh you@server uname -m`: x86_64 → compile:linux-x64, aarch64 → compile:linux-arm64).
bun run compile:linux-x64     # dist/zekno-runner-linux-x64

# As root, at the place the installer uses:
xz -T0 -c dist/zekno-runner-linux-x64 | ssh root@server 'xz -d > /usr/local/bin/zekno-runner && chmod 755 /usr/local/bin/zekno-runner'

# As any other user, at the place the installer uses:
xz -T0 -c dist/zekno-runner-linux-x64 | ssh deploy@server 'mkdir -p ~/.local/bin && xz -d > ~/.local/bin/zekno-runner && chmod 755 ~/.local/bin/zekno-runner'
ssh deploy@server '~/.local/bin/zekno-runner status'
```

`compile:linux-x64` and `compile:linux-arm64` are the scripts a release is built with. The file
is about 110 MB; compressed with `xz` it is about 40 MB. The last command prints
`{"outcome":"refused","reason":"not_set_up"}` on a fresh install. Then run `zekno server add` from
your machine: a runner at the place the installer uses, or on the `PATH`, is found and used as it
is. A runner anywhere else is added with `--runner-path <path>`. The folder must belong to the
user that runs the runner.

`bun run compile` builds `dist/zekno-runner` for the machine you are on, which is only what you
want when that machine is the server.

### For development: `--runner-file`

`zekno server add <name> --ssh <user@host> --runner-file dist/zekno-runner-linux-x64` sends a
runner you built over SSH. Its SHA-256 is computed on your machine and checked on the server when
it arrives; it must answer with the version the CLI carries; then it is put in place as the
installer would. A runner already on the server is used as it is.

### Releases

A runner release is a GitHub Release of this repository, started by pushing a tag
`runner-v<version>`. There are two kinds, called environments:

| | dev | prod |
|---|---|---|
| Tag | `runner-v<x.y.z>-dev.<n>`, such as `runner-v0.1.0-dev.1` | `runner-v<x.y.z>`, such as `runner-v0.1.0` |
| Cut from | a commit on `dev` | a commit on `main` |
| On GitHub | a pre-release, never shown as the latest | a release |
| Approval | none | waits for the maintainer in the GitHub Environment `prod` before anything is published |
| Installed by | a zekno built from `dev` | a zekno built from `main` |

`.github/workflows/runner-release.yml` runs on such a tag. Its first job, `check`, runs
`scripts/release.ts check`, which stops the release when the tag is not a version, when the
tagged commit is not on the branch for its kind, when `package.json` here says another version,
when the root `package.json` pins no Bun version, or, for prod, when
`apps/cli/src/version/runner-release.json` names a development version. Then `build-dev` or `build-prod`
builds the runner for Linux on x86-64 and ARM64 with the pinned Bun, checks that the x86-64 runner
answers with the tag's version, and hands four files on to `publish-dev` or `publish-prod`, which
publishes them:

- `zekno-runner-linux-x64.gz` and `zekno-runner-linux-arm64.gz`: the two runners, compressed with
  gzip;
- `SHA256SUMS`: the SHA-256 of each unpacked runner;
- `RELEASE-NOTES.md`, which is also the release's text: the commit, the Bun version, what the
  runner is built for, the checksums, and the second build's record once it is made.

A tag that already has a release gets no second one. The actions are pinned to full commits. Every
install skips the packages' own install scripts, and each job after `check` checks the tag itself
before it does anything else. The workflow uses no secret beyond the token GitHub gives every
workflow, and that token can write only in the two publish jobs. They check out nothing, install
nothing and run nothing of the repository, of its packages or of what the build handed on: they
check that exactly the four files are there, within their sizes, and that the two runners unpack to
what `SHA256SUMS` says, then publish them with `gh`. The packages and the built runner run only in
the build jobs, which can read and not write (RV1 in
[`specs/005-runner-release/security-review.md`](../../specs/005-runner-release/security-review.md)).
For a prod release, the build runs at once and the publish job waits for the maintainer's approval,
so the approval guards the token that can publish. A build can still hand on files other than its
source makes: that is what the second build catches, and no zekno installs a release before it.

Another workflow, `.github/workflows/main-versions.yml`, fails on a push to `main`, or a pull
request into it, that carries a development version. It reports; it holds a push back only where
`main`'s branch rule makes it a required check.

The workflow does not record checksums in zekno. Only the maintainer's second build does, once a
build of the same commit on their own machine gave the same files
([docs](https://zekno.app/docs/servers#how-a-release-is-trusted)).

How to cut a release, from start to end, and how to withdraw one: [RELEASING.md](./RELEASING.md).

## What to know before you rely on it

- **The first setup wins.** Until `zekno server add` has run, whoever can start the runner
  decides which team the server obeys. Install it and add the server in one sitting. If someone
  got there first, `server add` says the runner already belongs to a team.
- **Starting the runner means reading every app's state and logs.** `state` and `logs` need no
  signature. Anyone who can start the runner on the server, for example through SSH access meant
  for something else, can read what is running and every app's logs. They name no secret, but
  logs can hold anything an app prints. This is an open finding (S4 in
  [`specs/004-cli-app/security-review.md`](../../specs/004-cli-app/security-review.md)) that waits
  for the maintainer's decision. `records` needs no signature either: it gives the statements of
  each app's secrets, their names, versions and who set them, never a value. The design accepts
  that (T17 in [`specs/010-app-settings/deploy-v2.md`](../../specs/010-app-settings/deploy-v2.md)).
- **Updating it is one way.** Once a runner that speaks protocol 3 has written its state, runner
  0.1.0 cannot read it. Put back by hand, it refuses `status`, `sync`, `apply`, `state` and `logs`
  with `invalid_state`, and `setup` with `already_set_up`, and never reads the state as empty. A
  zekno from before deploy format 2 can then deploy only the apps that have had no deploy in
  format 2 ([docs](https://zekno.app/docs/servers#updating-is-one-way)).
- **Restoring its folder from a backup is not supported.** A folder put back from a backup holds
  lower deploy numbers and the team list of that time, so deploys the runner accepted since could
  be delivered to it again, in order, and run again. Set the server up again instead: its new key
  gives it a new server id, and no earlier deploy is addressed to it (T34 in
  [`specs/010-app-settings/deploy-v2.md`](../../specs/010-app-settings/deploy-v2.md)).
- **The runner believes its environment.** `ZEKNO_RUNNER_HOME`, `ZEKNO_DOCKER` and `PATH` decide
  where its state lives and which program receives the secrets. Do not let a less-trusted user
  start it with their own environment: no `PermitUserEnvironment`, no `AcceptEnv ZEKNO_*`, no
  sudo rule that keeps those variables. The compiled runner does not load `.env` or `bunfig.toml`
  from the folder it is started in, which over SSH is the login user's home folder: it is built
  with both turned off. Like any program built with Bun, it still obeys three of Bun's own
  variables: `BUN_OPTIONS` (for example `--preload <file>`, which runs that file first),
  `BUN_BE_BUN=1` (it then acts as Bun itself) and `BUN_INSPECT` (it opens a debugger). Whoever can
  set them already controls that account. The server's SSH must not accept `BUN_*` from clients:
  no `AcceptEnv BUN_*`.
- **Signing a deploy is equal to root on the server.** A Compose file can mount anything Docker
  can reach. The signature decides who may do that; the runner does not limit what they deploy.
- **Docker's messages are passed back as they are.** An error from Docker can repeat a value
  that was filled in from a secret, such as a malformed port.
- **A release is trusted through its checksums, not a signature.** zekno installs a runner only
  when its SHA-256 equals the value zekno holds, and that value is written only by the
  maintainer's second build, once a build of the same commit on their own machine gave the same
  files as the release. That proves the published files are what this source and this build tool
  produce. It does not prove that Bun or the npm packages are good: both builds use the same ones.
  Releases are not signed, and no build provenance is published yet.
- **Who may start a release.** Whoever can push a `runner-v*` tag starts a release, and chooses
  the workflow that runs for it. The release procedure sets a tag ruleset on GitHub before the
  first release, so that only the repository's admins can push such tags
  ([RELEASING.md](./RELEASING.md), part 1). A release started by anyone else is still installed by
  no zekno until the second build records its checksums.

The reviews these come from are
[`specs/003-cli-runner/security-review.md`](../../specs/003-cli-runner/security-review.md) and
[`specs/004-cli-app/security-review.md`](../../specs/004-cli-app/security-review.md).

## Develop

```bash
bun test            # runs the runner as a real process against a stand-in docker
bun run typecheck
bun run lint        # ESLint with typescript-eslint; any finding fails
bun run format      # Prettier, the repository's settings
bun run compile     # dist/zekno-runner, for the machine you are on
```

`scripts/` holds the release scripts: `release.ts`, which the release workflow runs, and
`second-build.ts`, which the maintainer runs. [RELEASING.md](./RELEASING.md) says how each is used.

`src` holds `main.ts`, the entry point, and one folder per subject: `commands/` (what each
command does), `session/` (several requests over one connection), `docker/` (starting apps with
Docker Compose and reading what runs) and `home/` (the runner's folder on the server). Tests sit
in folders of the same names under `test/`.
