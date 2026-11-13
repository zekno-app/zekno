# Command Contract

Everything in feature 003's command contract still holds unless this page changes it.

## `zekno` (the CLI)

| Command | Does |
|---------|------|
| `zekno` | At a terminal, opens the app (see [app.md](./app.md)). Without a terminal, prints the help and exits with status 2, as before. |
| `zekno init --name <you>` | Unchanged. |
| `zekno server add <name> --ssh <destination>` | Connects, checks Docker with Compose, installs the runner if it is missing, sets it up and adds the server to the team list. `--runner-path <path>` uses a runner that is already installed there and installs nothing. |
| `zekno server add <name> --ssh <destination> --runner-file <path>` | Development only: sends a locally built runner instead of downloading a release. |
| `zekno server add <name> --local [--home <dir>]` | Unchanged. |
| `zekno server update <name>` | Replaces the runner on a server with the version this CLI carries, by the same verified route. Asks first at a terminal; needs `--yes` without one. |
| `zekno server ls` | Unchanged. |
| `zekno secret set|rm|ls` | Unchanged. `--app` and `--server` may come from `zekno.json`. |
| `zekno deploy [-f <file>]` | As before. `--app`, `--server` and the file may come from `zekno.json`. |
| `zekno rollback [--to <number>]` | As before, with the same defaults from `zekno.json`. |
| `zekno status [--server <name>]` | As before, plus running or stopped for each app when the runner is new enough. |
| `zekno logs [--app <app>] [--server <name>] [--tail <n>] [--no-follow]` | Prints an app's logs, following until interrupted. |
| `zekno link [--app <app>] [--server <name>] [-f <file>]` | Writes `zekno.json` in the current folder. Refuses to overwrite one without `--force`. |

Flags win over `zekno.json`. A command that still lacks a detail fails with a message naming the
flag and the project file. A command never asks a question when there is no terminal (FR-033).

Exit status: `0` success; `1` refused or failed; `2` wrong usage. Unchanged.

### Output at a terminal

The symbols, wording and panels of the app. `deploy` and `rollback` show the summary panel, the
stage row and a result line with what to run next; a failed start shows what Docker reported.
The canvas boards "zekno deploy: success and failure" and "Status, lists, errors and piped
output" are the reference.

### Output when piped, in a script, or with `--json`

Plain lines, tab-separated cells, no colour, symbols or panels. One JSON object with `--json`.

| Command | Plain output | Changed from feature 003? |
|---------|--------------|---------------------------|
| `deploy`, `rollback` | `Deploy <n> of <app> is running on <server> with <k> secrets.` | Yes: "`<k> secret(s)`" becomes "`<k> secrets`", or "`1 secret`", or "`no secrets`" |
| `deploy --json` | `{"outcome","app","sequence","server"}` | No |
| `status` | `<server>: team list version <v>`, then `<app>\tdeploy <n>\t<state>`, then `<app>/<NAME>\tversion <v>` | Yes: a third cell, `running`, `stopped`, `partly running` or `unknown` |
| `status --json` | As before, plus `"apps": { "<app>": { "state", "services": [...] } }` | Yes: one added field |
| `secret ls`, `server ls` | Unchanged | No |
| `logs` | `<time>\t<service>\t<text>`, one line per log line | New |

Docker's output is not printed during a deploy. On a failed start in plain mode, the lines Docker
reported are written to standard error after the failure sentence.

## `zekno-runner` (on the server)

| Command | Input | Output |
|---------|-------|--------|
| `setup`, `sync`, `apply`, `status` | As in feature 003 | As in feature 003 |
| `version` | none | `RunnerVersion` |
| `session` | `SessionRequest` lines until input closes | `SessionFrame` lines; see [session.md](./session.md) |

`state` and `logs` exist only inside a session. The runner still opens no network port, reads
only its standard input, and starts nothing that the team did not sign.

Exit status of `session`: `0` when its input closed normally, `1` when it stopped because a line
was not a request it could read or the client sent requests far faster than they could be answered.

The runner's folder: `ZEKNO_RUNNER_HOME` if set. Otherwise root always uses `/var/lib/zekno`. Any other user uses `~/.local/state/zekno` if a runner is already set up there, else `/var/lib/zekno` only if that folder exists and belongs to them, else `~/.local/state/zekno`.

## Installing the runner over SSH

`server add` and `server update` run these steps on the server, in this order, and stop at the
first that fails. Nothing is installed unless every check before it passed.

| Step | Stops with |
|------|------------|
| 1. Connect | "could not be reached over SSH" |
| 2. `docker compose version` | "Docker with Compose was not found" |
| 3. Is a runner already there (at `--runner-path`, on `PATH`, or where the installer puts it)? If its version is the one this CLI carries, skip to step 7. `server add` uses a runner it finds as it is, whatever its version, and says when it is out of date. `server update` goes on to replace it, unless it is newer than the one this CLI carries. | "is newer than the … this zekno carries, so it was left as it is" |
| 4. `uname -sm` is Linux on x86-64 or ARM64 | "this kind of server is not supported yet" |
| 5. Download the release file with `curl` or `wget` to a new private temporary folder and unpack it | "the server could not download the runner" |
| 6. SHA-256 of the unpacked file equals the value in the CLI. The file then has to answer `version` with the expected version from the temporary folder. Only then is it moved into place with mode 755, so a runner that cannot run on this server never replaces one that can | "the downloaded runner did not match", and the file is deleted; "the runner did not start" |
| 7. `zekno-runner version` answers with the expected version | "the runner did not start" |
| 8. Create the runner's folder with mode 700 if it is missing | |

The release address is
`https://github.com/zekno-app/zekno-monorepo/releases/download/runner-v<version>/zekno-runner-linux-<arch>.gz`.

`server update` replaces only a file named `zekno-runner`. The runner's path is kept in the
profile file, which is not signed, so any other path is refused before anything is asked or
sent ("zekno only replaces a runner whose file is named zekno-runner"), and the script on the
server refuses it again.

Setup and adding to the team list then proceed as in feature 003, in the same session.

## The release workflow

`.github/workflows/runner-release.yml` runs when a tag `runner-v<version>` is pushed. It builds
the runner for `bun-linux-x64` and `bun-linux-arm64`, compresses each with gzip, writes a
`SHA256SUMS` file for the unpacked binaries, and attaches all of them to a GitHub Release. It
has no secrets beyond the token GitHub gives every workflow. Recording the checksums in
`apps/cli/src/runner-release.json` is a separate commit made by a person.
