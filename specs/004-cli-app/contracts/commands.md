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
| `zekno secret set|rm|ls` | Unchanged. `--app` and `--server` may come from a `zekno.json` signed by the team and in use here. `secret set` names both before the value is asked for: `Value for NAME (api on dev): `. |
| `zekno deploy [-f <file>]` | As before. `--app`, `--server` and the file may come from a `zekno.json` signed by the team and in use here; the file only when the app is the one it names. |
| `zekno rollback [--to <number>]` | As before, with the same defaults from `zekno.json`. |
| `zekno status [--server <name>]` | As before, plus running or stopped for each app when the runner is new enough. |
| `zekno logs [--app <app>] [--server <name>] [--tail <n>] [--no-follow]` | Prints an app's logs, following until interrupted. Ctrl-C, or a reader that closes the pipe (`zekno logs \| head -1`), stops the reading on the server and ends the command quietly with status 0. |
| `zekno link [--app <app>] [--server <name>] [-f <file>] [--force] [--yes]` | Writes `zekno.json` in the current folder, signed with this member's key, and records it as used here (`links.json`). Refuses to overwrite one without `--force`; with `--force` and names it replaces any file with one signed here. An app or server not given is taken from a `zekno.json` that already applies to the folder, only when it is signed by the team and in use here; from any other, nothing is taken and the command stops with exit status 2 and S1 or S2 below; `-f` defaults to `compose.yaml` and must be a file inside the folder. With no `--app`, `--server` or `-f`, a `zekno.json` signed by the team that already applies (in this folder or one above) is checked as one being written would be (its server connected, its Compose file a file inside its folder). One not in use here is asked about with the question below, as any command asks it (security review of the signed link, K1): only `y` records it as it is, not rewritten, `Accepted zekno.json: <app> on <server>, file <compose>.` (the file's path in place of `zekno.json` when it is in a folder above); no stops with "Nothing was done." and exit status 1; with no terminal it stops with exit status 2 and "There is no terminal to ask on. &lt;member&gt; linked &lt;folder&gt; to &lt;app&gt; on &lt;server&gt;. Add `--yes` to use it here.", unless `--yes` is given, which records it. One already in use here is left as it is: `Already in use: zekno.json, <app> on <server>, file <compose>.` A file not signed by the team is refused with S1. Names given that are exactly those of a `zekno.json` signed by the team in this folder are asked about and recorded the same way, with no `--force`. |

Flags win over `zekno.json`. A command that still lacks a detail fails with a message naming the
flag and the project file. A command never asks a question when there is no terminal (FR-033).

A `zekno.json` is used only when it is signed by the team, and without a question only once it
was used in its folder on this machine (data-model.md, "Signed by the team" and "When a project
file is used"; decided by the maintainer on 2026-11-14, research R17):

| The file | Command at a terminal | Command with no terminal |
|----------|-----------------------|--------------------------|
| Signed by the team, and in `links.json` | Used | Used |
| Signed by the team, not in `links.json` | Asks once (`Ui.confirm`). Yes records it and goes on. No, or anything but `y`, stops with "Nothing was done." and exit status 1 | Stops, exit status 2, S2. `zekno link --yes` records it |
| Not signed by the team (no signature, another team, a removed member, changed after signing, a server this team does not have) | Stops, exit status 2, S1 | The same |

- The question: "&lt;member&gt; linked this folder to &lt;app&gt; on &lt;server&gt;. Use it here?"
  When the file is in a folder above the current one: "&lt;member&gt; linked &lt;folder&gt; to
  &lt;app&gt; on &lt;server&gt;, with &lt;folder&gt;/&lt;compose&gt;. Use it here?", naming the
  Compose file a yes deploys. When `--app` or `--server` sends the command to another app or server
  than the file names: "&lt;member&gt; linked this folder to &lt;app&gt; on &lt;server&gt;. This
  command uses &lt;app2&gt; on &lt;server2&gt;. Use it here?" A flag for a detail the command does
  not take changes nothing. What was typed before the question is drawn, such as a `y` typed while
  the keychain asked, is thrown away (`discardTypedAhead`): only a key pressed at the question
  answers it.
- S1: "zekno.json in &lt;folder&gt; is not signed by your team, so zekno does not use it. It names
  &lt;app&gt; on &lt;server&gt;. To link this folder yourself, run `zekno link --app <name>
  --server <name> --force`. To leave the file aside, give --app and --server."
- S2: "&lt;member&gt; linked &lt;folder&gt; to &lt;app&gt; on &lt;server&gt;, and it has not been
  used in this folder on this machine. To use it, run `zekno link` there once and answer its
  question, or `zekno link --yes` from a script. To leave it aside, give --app and --server."

S1 and S2 carry the usage hint every exit status 2 has. `<member>` is the signer's name from the
signed team list, cleaned. Judging a file reads the verified team list, so the keychain is read
first; every refusal and the question come before any connection is opened, any signer made or
anything signed or sent. The keychain is read once per command: the team verified to judge the file
is the one the command then works with (`teamOnce` in context.ts). Given both `--app` and `--server`, the file is left aside unless it is
in use here, and is never asked about; one that cannot be read (a link, another user's file, not
valid JSON) counts as no `zekno.json`.

Its Compose file goes with its app. With `--app` naming another app, the Compose file is `-f`, or
`compose.yaml` in the current folder, as without a project file.

Where nothing names another file, `compose.yaml` in the current folder must stay inside it: one
that is a link leading out of the folder is refused ("compose.yaml leads outside this folder
through a symbolic link, so zekno does not read it. To deploy that file, name it with `-f
<file>`."). A file named with `-f` may be anywhere. Every Compose file is read once, from one open
file, and must be a regular file of at most 256 KiB; a named pipe is refused, not waited on.

Exit status: `0` success; `1` refused or failed; `2` wrong usage. Unchanged.

### Output at a terminal

The symbols, wording and panels of the app. `deploy` and `rollback` show the summary panel, the
stage row and a result line with what to run next; a failed start shows what Docker reported.
The canvas boards "zekno deploy: success and failure" and "Status, lists, errors and piped
output" are the reference.

### Output when piped, in a script, or with `--json`

Plain lines, tab-separated cells, no colour, symbols or panels. One JSON object with `--json`.
This is the output whenever standard output or standard input is not a terminal (so
`zekno deploy < /dev/null` at a terminal prints the plain line), with `--json`, and with
`TERM=dumb`.

| Command | Plain output | Changed from feature 003? |
|---------|--------------|---------------------------|
| `deploy`, `rollback` | `Deploy <n> of <app> is running on <server> with <k> secrets.` | Yes: "`<k> secret(s)`" becomes "`<k> secrets`", or "`1 secret`", or "`no secrets`" |
| `deploy --json` | `{"outcome","app","sequence","server"}` | No |
| `status` | `<server>: team list version <v>`, then `<app>\tdeploy <n>\t<state>`, then `<app>/<NAME>\tversion <v>` | Yes: a third cell, `running`, `stopped`, `partly running` or `unknown`; the apps in Home's order, the latest deploy from this machine first |
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

Exit status of `session`: `0` when its input closed normally or its reader went away, `1` when it
stopped because a line was not a request it could read or the client sent requests far faster than
they could be answered.

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
`https://github.com/zekno-app/zekno/releases/download/runner-v<version>/zekno-runner-linux-<arch>.gz`.

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
