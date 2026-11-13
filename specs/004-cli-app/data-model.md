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

Strict: an unknown field is an error. No secret and no key ever goes in this file (FR-028). It is
not signed and not trusted: the server it names is looked up in the verified profile, and the
Compose file it names is read and signed like any other.

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
| `RunnerLogsRequest` | CLI → runner | `{ app, tail }`. `tail` is 0 to 1000. |

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
| Server view | Reachable or not, runner version, team list version, last deploy numbers | Refreshed on open and on request |
| App state | Per app: running, stopped or partly running, from `RunnerAppStates` | Refreshed every few seconds while visible |
| Deploy in progress | Stage, the last progress line, up to 500 lines of Docker output | Until the app closes |
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
