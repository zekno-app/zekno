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
error.

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

`state` and `logs` exist only inside a session.

- Requests are handled one at a time, in order. Each is answered by zero or more events, then
  exactly one result.
- Every request goes through the same code as its one-shot command: the same lock, the same
  checks, the same order of work. A session is a way of carrying requests, not a second way in.
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
  environment. No secret.
- A line that is not a request is answered with the refusal `invalid_request`. After three in a
  row, the session ends.
- A client that gets more than 1,024 requests or 32 MiB ahead of the answers has its session
  ended. Requests still waiting are not run.
- After each result the runner waits until the frame has been read, the reader has gone or the
  input has closed, so a client that does not read cannot make it hold answers in memory.
  Progress frames do not wait: once 8 MiB of them wait to leave, further ones are dropped. A
  result is never dropped.
- When the input closes during `apply`, the deploy carries on to its end: it was accepted and its
  number is used. When the input closes during `logs`, or nobody reads any more, the runner stops
  Docker's log command and exits.

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
| `state.json` | The team list it trusts, the last deploy number per app and the latest version of each secret. |
| `apps/<app>/compose.yaml` | The Compose file of the last accepted deploy. |
| `lock` | Present while a `setup`, `sync` or `apply` is at work, so two runs never overlap. |

Decrypted secrets are never written here. They are handed to Docker Compose through its
environment. Docker itself keeps a container's environment in its own configuration. App state
and logs are read from Docker when asked and never stored.

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
- **Too much**: a deploy that would make it hold more than 1,024 apps or 8,192 secret versions is
  refused with `too_large`, before anything is opened.
- **A request it cannot read**: one that does not match its message, is larger than 32 MiB, or
  asks for the logs of an app it never accepted a deploy of, is refused with `invalid_request`.
  The app name is checked against the app-name pattern before Docker sees it.

## Install on a server

The server needs Docker with Compose, and Linux on x86-64 (a processor with SSE4.2: Intel
Nehalem, AMD Bulldozer or newer) or on ARM64, with the GNU C library (glibc) 2.17 or newer. Alpine
and other systems with musl are not supported yet. The rest of what a server needs, and what was
tried, is in the [CLI's README](../cli/README.md#supported-servers). `ZEKNO_DOCKER` names the
Docker command if it is not `docker`.

### With `zekno server add`

`zekno server add <name> --ssh <user@host>` installs the runner by itself: the server downloads
the runner release that build of zekno carries, checks its SHA-256 against the value zekno holds,
checks that it starts, and only then puts it in place. A zekno built from `main` installs a prod
release, such as `0.1.0`; one built from `dev` installs a development release, such as
`0.1.0-dev.1`. The steps and their limits are in the
[CLI's README](../cli/README.md#installing-the-runner).

| Who the CLI logs in as | Runner | Its folder |
|------------------------|--------|------------|
| root | `/usr/local/bin/zekno-runner` | `/var/lib/zekno` |
| any other user | `~/.local/bin/zekno-runner` | `~/.local/state/zekno` |

**The first runner release is not recorded yet.** `apps/cli/src/runner-release.json` on this
branch holds no checksums, so a zekno built from it has no published runner to install. Install
the runner by hand, or use `--runner-file` for development.

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
| Approval | none | waits for the maintainer in the GitHub Environment `prod` before anything is built |
| Installed by | a zekno built from `dev` | a zekno built from `main` |

`.github/workflows/runner-release.yml` runs on such a tag. Its first job, `check`, runs
`scripts/release.ts check`, which stops the release when the tag is not a version, when the
tagged commit is not on the branch for its kind, when `package.json` here says another version,
when the root `package.json` pins no Bun version, or, for prod, when
`apps/cli/src/runner-release.json` names a development version. Then `release-dev` or
`release-prod` builds the runner for Linux on x86-64 and ARM64 with the pinned Bun, checks that the
x86-64 runner answers with the tag's version, and publishes four files:

- `zekno-runner-linux-x64.gz` and `zekno-runner-linux-arm64.gz`: the two runners, compressed with
  gzip;
- `SHA256SUMS`: the SHA-256 of each unpacked runner;
- `RELEASE-NOTES.md`, which is also the release's text: the commit, the Bun version, what the
  runner is built for, the checksums, and the second build's record once it is made.

A tag that already has a release gets no second one. The actions are pinned to full commits. Every
install skips the packages' own install scripts, and each release job checks the tag itself before
it checks out or installs anything. The workflow uses no secret beyond the token GitHub gives every
workflow, and that token can write only in the release jobs: `actions/checkout` uses it there to
read the repository and keeps none of it, and the step that publishes uses it to publish. Code that
runs earlier in a release job, during the build, could still reach that step. Splitting each
release job in two, so that the job that can write runs nothing of the repository, is an open
finding (RV1 in
[`specs/005-runner-release/security-review.md`](../../specs/005-runner-release/security-review.md))
that waits for the maintainer. Another workflow, `.github/workflows/main-versions.yml`, fails on a
push to `main`, or a pull request into it, that carries a development version. It reports; it holds
a push back only where `main`'s branch rule makes it a required check.

The workflow does not record checksums in zekno. Only the maintainer's second build does, once a
build of the same commit on their own machine gave the same files
([CLI's README](../cli/README.md#how-a-release-is-trusted)).

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
  for the maintainer's decision.
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
bun run compile     # dist/zekno-runner, for the machine you are on
```

`scripts/` holds the release scripts: `release.ts`, which the release workflow runs, and
`second-build.ts`, which the maintainer runs. [RELEASING.md](./RELEASING.md) says how each is used.
