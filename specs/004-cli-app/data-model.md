# Data Model: The Zekno Terminal App

Everything from feature 003's data model still holds. This lists what is added or changed.

## In the project folder: `zekno.json`

```json
{ "app": "demo", "server": "prod", "compose": "compose.yaml" }
```

| Field | Rule |
|-------|------|
| `app` | `^[a-z0-9][a-z0-9-]{0,62}$` |
| `server` | A server name: same pattern. Must be a server in the verified profile when used. |
| `compose` | A relative path inside the folder that holds `zekno.json`. No `..`, not absolute. Default `compose.yaml`. |

Strict: an unknown field is an error, and so is a field written twice. No secret and no key ever
goes in this file (FR-028). It is not signed and not trusted: the server it names is looked up in
the verified profile, and the Compose file it names is read and signed like any other.

It is looked for in the current folder, then each folder above it, stopping at the home folder
or the filesystem root; a folder above home is never read. Only a regular file named exactly
`zekno.json` (on a file system that ignores case, `ZEKNO.JSON` is not one), of at most 4096 bytes,
that belongs to the user is used: a symbolic link, a pipe or another user's file is an error that
names it. It is written only by `zekno link` or a "yes" in the app, never over an existing one
without `--force`, as a whole file with mode 644.

### When a project file is used

Only once this machine accepted it, byte for byte (`links.json`, below). It is accepted when
`zekno link` writes it, when "remember this folder?" in the app is answered yes, and when
`zekno link` is run with no names in a folder where a valid one already applies (it is then
checked as one being written would be, recorded as it is and not rewritten). Any change to its
bytes, an edit or a `git pull`, makes it not accepted again.

A zekno.json that is not accepted is never used:

- A command that would take the app or the server from it stops before anything is read from
  the keychain, signed or sent, with exit status 2: "zekno.json in &lt;folder&gt; names &lt;app&gt;
  on &lt;server&gt;. It was not made or accepted on this machine. To use it, run `zekno link` in
  that folder. To leave it aside, give --app and --server." Given both `--app` and `--server`,
  it is left aside, its Compose file too.
- The app does not select what it names, and `d` deploys nothing in its folder: Home says
  "zekno.json here names &lt;app&gt; on &lt;server&gt;. It was not made or accepted on this
  machine. Run `zekno link` to accept it."

The Compose file it names goes with the app it names: a command whose app is another (`--app`)
deploys `-f`, or compose.yaml in the current folder, as without a project file.

### The Compose file a deploy signs

Read once, and the text read is the text signed and, in the app, the text whose expected values
are listed. The one an accepted zekno.json names, and compose.yaml where nothing names another,
must stay inside their folder: found by real path, opened without following a link or waiting
on a pipe, a regular file of this user's with one name on the disk (no hard link), at most
256 KiB, and still the same file inside the folder once read. A file named with `-f` may be
anywhere and is followed through links, but is read the same way otherwise.

## In the profile folder: `links.json`

```json
[{ "path": "/home/ada/code/shop/zekno.json", "sha256": "<64 hex>" }]
```

The project files this machine accepted: the real path of each and the SHA-256 of its exact
bytes, newest last, at most 500 (the oldest dropped first) and at most 1 MiB. Strict schema; a
file that is missing, too large, a link, another user's or does not match counts as empty, so
nothing is accepted, and the next write replaces it. Written as a whole file (a temporary file,
then a rename that replaces a link instead of writing through it), mode 600. It holds no key and
no secret.

It is not signed, on purpose. Someone who can write the profile folder and also plant a project
folder gains nothing from forging an entry that they do not have already: whoever controls a
project folder the developer deploys from controls the Compose file that is deployed. The list
protects against the other case: a folder the developer did not make, such as a cloned
repository, on a machine nobody else can write to.

## In the CLI: the runner it installs (`apps/cli/src/runner-release.json`)

```json
{ "version": "0.2.0", "files": { "linux-x64": { "sha256": "…" }, "linux-arm64": { "sha256": "…" } } }
```

`version` matches `^[0-9]+\.[0-9]+\.[0-9]+$`; each `sha256` is 64 lowercase hex characters, or
`null` before the first release. The download address is built from the version and the file
name; nothing else is variable.

## In the profile (`~/.zekno/profile.json`)

`servers[].target` for SSH keeps `{ kind: "ssh", destination, runnerPath }`. `runnerPath` may now
be the absolute path the installer chose (for example `/home/deploy/.local/bin/zekno-runner`); it
still has to match `^[A-Za-z0-9._/~-]+$`.

Nothing else is added to the profile. App state and logs are never stored.

## On the server

| Who runs it | Runner program | Runner folder |
|-------------|----------------|---------------|
| root | `/usr/local/bin/zekno-runner` | `/var/lib/zekno` |
| another user | `~/.local/bin/zekno-runner` | `~/.local/state/zekno` |

The folder's content and permissions are unchanged from feature 003. The runner's default folder:
`ZEKNO_RUNNER_HOME` if set. Otherwise root always uses `/var/lib/zekno`. Any other user uses `~/.local/state/zekno` if a runner is already set up there, else `/var/lib/zekno` only if that folder exists and belongs to them, else `~/.local/state/zekno`.

## Messages added to `packages/core/src/protocol.ts`

| Message | From → to | Content |
|---------|-----------|---------|
| `RunnerVersion` | runner → CLI | `{ version, protocol }`. `protocol` is `2` for this feature. |
| `SessionRequest` | CLI → runner | `{ command, input? }`. `command` is `setup`, `sync`, `apply`, `status`, `state`, `logs` or `version`. `input` is that command's existing request message. |
| `SessionFrame` | runner → CLI | Either `{ event, … }` or `{ result }`. One `result` ends a request. |
| `ProgressEvent` | runner → CLI | `{ event: "progress", line }`. Sent during `apply`. `line` is at most 4096 characters. |
| `LogEvent` | runner → CLI | `{ event: "log", service, time, line }`. Sent during `logs`. |
| `RunnerStateRequest` | CLI → runner | none (all apps) |
| `RunnerAppStates` | runner → CLI | `{ apps: { "<app>": { services: [{ service, state, exitCode, health }] } } }` |
| `RunnerLogsRequest` | CLI → runner | `{ app, tail, follow? }`. `tail` is 0 to 1000. `follow` is a boolean, true when absent; with `false` the runner sends the lines Docker has and ends the request (`zekno logs --no-follow`). |

Rules: all schemas are strict. `service` matches `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$`. `state` is
one of `running`, `exited`, `created`, `restarting`, `paused`, `dead`, `removing`, with anything
else reported as `unknown`. `health` is `healthy`, `unhealthy`, `starting` or empty. `time` is an
RFC 3339 timestamp. `line` in a log event is at most 16384 characters and is text as Docker gave
it: the CLI cleans it before drawing it (research R8).

`RunnerReport`, `RunnerStatus` and the request messages of feature 003 are unchanged. A request
whose input does not match is answered with `{ result: { outcome: "refused", reason:
"invalid_request" } }`, as before.

## In the app's memory only

| Thing | Content | Kept |
|-------|---------|------|
| Screen stack | Which screen is showing and what is selected on each | While the app is open |
| Server view | Reachable or not, runner version, team list version, last deploy numbers (the runner's last accepted deploy of each app once it answered) | Read when a screen opens and every 5 seconds while Home or App shows, over one session per server kept while the app runs (contracts/app.md, "Refresh") |
| App state | Per app: running, stopped or partly running, from `RunnerAppStates`; only apps this machine has a history for | As the server view |
| Kept session | One runner session per server: its process, and when a lost one may be connected to again in the background | Until the app closes |
| Deploy in progress | Stage, the last progress line, up to 500 lines of Docker output | Until the app closes |
| Deploy waiting on a question | The server, the app, and the Compose file's text as read when `d` was pressed, which is the text signed | Until the question is answered |
| Log view | Up to 2000 lines, the filter text, the chosen service, following or paused | Until the logs screen is left |

An app is **running** when every service's state is `running`, **stopped** when none is, and
**partly running** otherwise. A server whose connection fails is **unreachable** and its apps'
states are unknown.

## Stages of a deploy

`checked → signed → sent → starting → started | failed`

| Stage | Reached when |
|-------|--------------|
| Checked | The runner's status was read and it is the right server and team |
| Signed | The deploy was signed and recorded in the history as `sent` |
| Sent | The request was written to the session |
| Starting | The first progress event arrived, or the runner accepted the deploy |
| Started / failed | The runner's report is `started` or `start_failed` |

A refusal ends the deploy at whatever stage it had reached, with the runner's reason.
