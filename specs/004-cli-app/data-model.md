# Data Model: The Zekno Terminal App

Everything from feature 003's data model still holds. This lists what is added or changed.

## In the project folder: `zekno.json`

```json
{
  "app": "demo",
  "server": "prod",
  "compose": "compose.yaml",
  "signed": { "payloadType": "zekno.link.v1", "payload": "<base64url>", "signature": { "keyId": "<32 hex>", "sig": "<base64url>" } }
}
```

| Field | Rule |
|-------|------|
| `app` | `^[a-z0-9][a-z0-9-]{0,62}$` |
| `server` | A server name: same pattern. Must be a server in the verified profile when used. |
| `compose` | A relative path inside the folder that holds `zekno.json`. No `..`, not absolute. Default `compose.yaml`. |
| `signed` | Optional. A signed envelope of the kind `zekno.link.v1` (packages/core, `createLink`): a member's signature over the team id, the server's id, the app and the Compose path. The core refuses, when signing and when verifying, a Compose path that is absolute, holds a backslash, is empty, or has a `.` or `..` part. |

Strict: an unknown field is an error, and so is a field written twice, also inside `signed`. No
secret and no key ever goes in this file (FR-028): the signature and the key id are public, so
committing it gives nothing away. Its signature vouches for the names (which app, which server,
which Compose path), not for what the Compose file says: whatever is checked out in a linked
folder, a pull request's branch included, is what `zekno deploy` deploys there, so a branch is read
before it is deployed. The three plain fields are for people; the signature is what makes the file
count.

It is looked for in the current folder, then each folder above it, stopping at the home folder
or the filesystem root; a folder above home is never read. Only a regular file named exactly
`zekno.json` (on a file system that ignores case, `ZEKNO.JSON` is not one), of at most 4096 bytes,
that belongs to the user is used: a symbolic link, a pipe or another user's file is an error that
names it. It is written only by `zekno link` or a "yes" in the app, signed with this member's
key, never over an existing one without `--force`, as a whole file with mode 644.

### Signed by the team

Decided by the maintainer on 2026-11-14 (research.md, R17). A file is **signed by the team** only
when `verifyLink` accepts `signed` against the verified team list, as that list is now (a link
signed by a current member whose role may deploy, for this team, naming one of its servers), and
the signed content equals the plain fields: the same `app`, the same `compose`, and `server` is the
name the team list gives the signed server id. Any other file is not signed by the team: one with
no `signed`, one signed by another team, by a member since removed, one edited after signing, one
signed for a server of another name, one whose `signed` is another kind of message (a deploy, a
secret, a removal, a team list). Verifying needs the verified team list, so the keychain is read
first; that is a read only, and every refusal comes before a signer is made, a connection opened
or anything signed or sent.

### When a project file is used

A signature proves who wrote a file, not where it sits: anyone who can read a repository can copy
its signed zekno.json into another folder beside another Compose file. So a file signed by the team
is used without a question only once it was used in its folder on this machine, byte for byte
(`links.json`, below, the record of first use).

| The file | Command at a terminal | Command with no terminal | The app |
|----------|-----------------------|--------------------------|---------|
| Signed by the team, and in `links.json` | Used | Used | Used: focus, `d` |
| Signed by the team, not in `links.json` | Asks once. Yes records it and goes on. No stops: nothing is done | Stops, exit status 2, sentence S2. `zekno link --yes` records it | Asks once when the app opens |
| Not signed by the team | Stops, exit status 2, sentence S1 | The same | Not used. Home shows S1's app form; `d` repeats it |

- S1, commands: "zekno.json in &lt;folder&gt; is not signed by your team, so zekno does not use
  it. It names &lt;app&gt; on &lt;server&gt;. To link this folder yourself, run `zekno link --app
  <name> --server <name> --force`. To leave the file aside, give --app and --server."
- S1, app (Home's problem line): "zekno.json here is not signed by your team, so zekno does not use
  it. It names &lt;app&gt; on &lt;server&gt;." (from a folder below, the file's path in place of
  "zekno.json here").
- S2: "&lt;member&gt; linked &lt;folder&gt; to &lt;app&gt; on &lt;server&gt;, and it has not been
  used in this folder on this machine. To use it, run `zekno link` there once and answer its
  question, or `zekno link --yes` from a script. To leave it aside, give --app and --server."
- The question at a terminal: "&lt;member&gt; linked this folder to &lt;app&gt; on &lt;server&gt;.
  Use it here?" Only `y` is yes; anything else stops with "Nothing was done." and exit status 1.
  - When the file is in a folder above the current one, it names that folder and the Compose file
    a yes deploys: "&lt;member&gt; linked &lt;folder&gt; to &lt;app&gt; on &lt;server&gt;, with
    &lt;folder&gt;/&lt;compose&gt;. Use it here?"
  - When `--app` or `--server` sends the command to another app or server than the file names, it
    says both: "&lt;member&gt; linked this folder to &lt;app&gt; on &lt;server&gt;. This command
    uses &lt;app2&gt; on &lt;server2&gt;. Use it here?" A flag for a detail the command does not
    take (`--app` with `status`) changes nothing.
  - What was typed before the question is drawn (a `y` typed while the keychain asked) is thrown
    away, at a terminal and when the app opens: only a key pressed at the question answers it.
- `zekno link` asks the same question before it records a file signed by the team that is not in
  use here: with no names, or with names exactly the file's own. With no terminal it stops with
  exit status 2 unless `--yes` is given: "There is no terminal to ask on. &lt;member&gt; linked
  &lt;folder&gt; to &lt;app&gt; on &lt;server&gt;. Add `--yes` to use it here." A file already in
  use here is left as it is: "Already in use: zekno.json, &lt;app&gt; on &lt;server&gt;, file
  &lt;compose&gt;."
- `<member>` is the signer's name from the signed team list, cleaned.

It is recorded in `links.json` when `zekno link` writes and signs it, when "remember this folder?"
in the app is answered yes, when the question above is answered yes (by a command, the app or
`zekno link`), and when `zekno link --yes` is run with no names where a file signed by the team
applies (it is then checked as one being written would be, recorded as it is and not rewritten). Any change to its bytes, an edit or a `git pull`,
makes it unused here again: still signed, it is asked about once more; edited by hand, it is not
signed. A command given both `--app` and `--server` leaves the file aside unless it is in use here,
and never asks about it; a file that cannot be read then counts as none.

The Compose file it names goes with the app it names: a command whose app is another (`--app`)
deploys `-f`, or compose.yaml in the current folder, as without a project file.

### The Compose file a deploy signs

Read once, and the text read is the text signed and, in the app, the text whose expected values
are listed. The one a zekno.json in use names, and compose.yaml where nothing names another,
must stay inside their folder: found by real path, opened without following a link or waiting
on a pipe, a regular file of this user's with one name on the disk (no hard link), at most
256 KiB, and still the same file inside the folder once read. A file named with `-f` may be
anywhere and is followed through links, but is read the same way otherwise.

## In the profile folder: `links.json`

```json
[{ "path": "/home/ada/code/shop/zekno.json", "sha256": "<64 hex>" }]
```

The record of first use: the project files used in their folder on this machine (written or
signed here, or met signed by the team and answered yes), the real path of each and the SHA-256 of
its exact bytes, newest last, at most 500 (the oldest dropped first) and at most 1 MiB. Strict schema; a
file that is missing, too large, a link, another user's or does not match counts as empty, so
nothing is recorded, and the next write replaces it. Written as a whole file (a temporary file,
then a rename that replaces a link instead of writing through it), mode 600. It holds no key and
no secret.

It is not signed, on purpose. Someone who can write the profile folder and also plant a project
folder gains nothing from forging an entry that they do not have already: whoever controls a
project folder the developer deploys from controls the Compose file that is deployed. An entry
alone never makes a file count either: a file must also be signed by the team. The list protects
against the other case: a teammate's signed file copied into a folder the developer did not make,
such as a cloned repository, on a machine nobody else can write to.

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
