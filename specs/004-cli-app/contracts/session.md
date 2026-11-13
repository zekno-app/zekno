# Runner Session Contract

`zekno-runner session` lets the CLI make several requests over one connection.

## Framing

- The CLI writes one `SessionRequest` per line. The runner writes one `SessionFrame` per line.
- Every line is UTF-8 JSON with no line break inside it, and at most `LIMITS.messageBytes` long.
- Requests are handled strictly one at a time, in the order received.
- Each request is answered by zero or more event frames, then exactly one result frame.
- The session ends when the runner's input closes. A request in progress is finished or
  abandoned as described below; the runner then exits.

```text
CLI    → {"command":"status"}
runner ← {"result":{ …RunnerStatus… }}
CLI    → {"command":"apply","input":{ …RunnerApplyRequest… }}
runner ← {"event":"progress","line":" Container zekno-demo-web-1  Recreate"}
runner ← {"event":"progress","line":" Container zekno-demo-web-1  Started"}
runner ← {"result":{"outcome":"started","app":"demo","sequence":5}}
CLI    closes its side
```

## Requests

| `command` | `input` | Events | `result` |
|-----------|---------|--------|----------|
| `version` | none | none | `RunnerVersion` |
| `status` | none | none | `RunnerStatus`, or a refusal |
| `setup` | `RunnerSetupRequest` | none | `RunnerSetupResponse`, or a refusal |
| `sync` | `RunnerSyncRequest` | none | `RunnerReport` |
| `apply` | `RunnerApplyRequest` | `progress` | `RunnerReport` |
| `state` | none | none | `RunnerAppStates`, or a refusal |
| `logs` | `RunnerLogsRequest` | `log` | Only when Docker's log command ends: `{"outcome":"ok"}`. With `follow: false` Docker is not asked to follow, so it ends once it has sent the lines it has |

A refusal is a `RunnerReport` with `outcome: "refused"` and a `reason`, exactly as the one-shot
commands answer.

## Rules the runner keeps

- Every request goes through the same code as its one-shot command: the same lock, the same
  checks, the same order of work. A session is a transport, not a second way in.
- `state` and `logs` read from Docker and change nothing. They need the runner to be set up and
  its folder to be private, like `status`. They take no lock.
- `logs` is given only for an app the runner has accepted a deploy for. The app name is checked
  against the app-name pattern before it is used.
- A line that is not a valid `SessionRequest` is answered with a refusal (`invalid_request`).
  After three in a row the runner ends the session with exit status 1.
- A client that gets more than 1,024 requests or 32 MiB ahead of the answers has its session
  ended with exit status 1. The request in progress finishes or stops as described below;
  requests still waiting are not run.
- After each result the runner waits until the frame has been read, the reader has gone or the
  input has closed, so a client that does not read cannot make the runner hold frames in memory.
- `state` gives up on Docker after 30 seconds, and at once when the input closes. A `state`
  handled after the input has closed answers with no apps. The CLI keeps the input open until
  it has the result.
- When the input closes during `apply`, the deploy carries on to its end: it was accepted and
  its number is used. The result is recorded in the runner's state as always; nobody is left to
  read the frame.
- When the input closes during `logs`, the runner stops Docker's log command and exits.
- A write that fails because nobody reads any more (the reader closed its end) counts as the
  client gone, even while the input is still open: the request in progress is finished
  (`apply`) or stopped (`logs`, and Docker's answer for `state`), requests still waiting are not
  run, and the runner exits with status 0. While it reads Docker's output it lets other work
  run every few milliseconds, so a closed input or a failed write is noticed however fast Docker
  prints.
- Progress frames do not wait for the reader. Once 8 MiB of frames wait to leave, further
  progress frames are dropped until the reader catches up. A result is never dropped.
- A runner holds at most 1,024 apps (`LIMITS.appsPerServer`) and 8,192 secret versions
  (`LIMITS.secretsPerServer`): a deploy that would make it hold more is refused with
  `too_large`, before anything is opened. A `state` answer holds at most 1,024 apps and 4,096
  services in all (`LIMITS.servicesPerServer`); an app past that is left out, which reads as
  "not known". So every `status` and `state` answer fits the limits the CLI reads them with.
- Nothing decrypted is ever put in a frame. Progress lines are Docker's own output.

## Rules the CLI keeps

- A frame that does not match the schema ends the session with "the runner did not answer as
  expected". Each frame is read up to the longest the request in progress can bring
  (`SESSION_FRAME_BYTES`: 64 KiB for `version`, `setup`, `sync` and `apply`'s progress, 192 KiB
  for a log event, 1 MiB for `state`, 4 MiB for `status`) and no further: past it the session
  ends with "the runner sent more than an answer can hold". `status` holds at most 1,024 apps
  and 8,192 secrets, `state` at most 1,024 apps and 4,096 services; an answer with more does
  not match.
- While a request's events are read, other work in the CLI runs every few milliseconds (keys,
  the screen, timers, a signal), however fast the runner sends. While whoever takes the events
  is busy (a full pipe, a screen that has not drawn the last batch), nothing more is read, so
  the runner, and Docker behind it, are held back in the connection.
- Opening a session can be stopped at any moment, before the runner has answered or while SSH
  connects or asks: its process is stopped at once.
- A `result` is believed only as far as feature 003 allows: the server and team are checked
  from `status`, and a deploy's result must name the app and number that were sent.
- Text in `progress` and `log` events is cleaned of terminal control sequences before it is
  drawn (research R8).
- A runner that exits with status 2 for `session` is a feature 003 runner. The CLI uses the
  one-shot commands for it and reports that state and logs need a runner update.
