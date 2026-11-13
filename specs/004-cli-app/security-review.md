# Security Review: The Zekno Terminal App

Each section covers one part of feature 004, reviewed once that part was finished. Everything in
[`specs/003-cli-runner/security-review.md`](../003-cli-runner/security-review.md) still applies.

## Runner: session, state, logs, version, default folder (reviewed 2026-11-14)

**Scope**: `apps/runner/src/session.ts`, `inspect.ts`, `home.ts`, `compose.ts`, `commands.ts` and
`main.ts` at commit `7b639f7`, against [`contracts/session.md`](./contracts/session.md) · **Kind**:
internal, focused review

This is not an external audit. One independent reviewer read the finished source without access
to the author's reasoning, and ran its own measurements against the runner. The fixes were made
afterwards, from the findings, by an assistant other than the reviewer. An external audit is
still required before production use.

**Who was considered**

| Attacker | Can do |
|----------|--------|
| A | Start the runner on the server and send it any input, for example through SSH access that was meant for something else. Read its output slowly, or never. Holds no team key. |
| Someone else on the server | Create `/var/lib/zekno`, or leave files in the folder the runner happens to be started from. |
| Docker that misbehaves | Hang, or print more than expected. Not an attacker, but a failure the runner must survive. |

Attacker B (the developer's profile folder) and a runner that lies, from the feature 003 review,
concern the CLI and are not part of this section.

**Outcome**: no finding rated high or critical. Two medium and two low findings and three
informational notes were fixed. One finding is open and needs the maintainer's decision.

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| S1 | Medium | **The session's queue counted only the bytes of each waiting line.** Empty or one-byte lines grew the queue without limit while a long request such as `logs` ran. Measured by the reviewer: 64 MiB of line feeds took the runner from 54 MB to 6.9 GB. | Each waiting line counts 1 KiB on top of its bytes, and at most 1,024 lines (and 32 MiB) may wait. A client further ahead than that is not waiting for its answers: the session ends with exit status 1, the runner stops reading, and the request in progress is finished (`apply`) or stopped (`logs`). In the test (up to 16 MiB of line feeds during `logs`) the runner peaked at 53 MiB; the runner at `7b639f7` passed the test's bound of 200 MiB, where the test stops sending. |
| S2 | Low | **A client that far ahead parked the reader**, which then never saw the input close: `logs` and its `docker compose logs --follow` outlived the client, and requests still waiting were run after the client had gone. | Fixed by the same change: the session ends instead of parking the reader, Docker's log command is stopped, and the requests still waiting are dropped, never run. |
| S3 | Medium | **Result frames ignored back-pressure.** A client that never read made the runner hold every answer in memory (`x\nx\n{"command":"status"}\n` in a loop). | After each result frame the runner waits until the frame has left, the reader has gone, or the input has closed. No lock is held at that point. A client that keeps sending meanwhile reaches the limit of S1 and its session ends. Progress frames during `apply` still never wait, by design, so a slow reader can never hold the lock. In the test (output into a pipe nobody reads) the runner peaked at 54 MiB and exited as soon as the reader went; the runner at `7b639f7` passed the bound of 200 MiB, and in a longer run reached 960 MB within 4 seconds. |
| S4 | Medium | **`logs` and `state` are available to anyone who can start the runner** (attacker A). They name no secret, but logs can contain anything an app prints. | **Open: needs the maintainer's decision.** Either accept it and document that starting the runner means reading every app's logs and state, or require a short-lived logs request signed by a current team member and bound to the server. |
| S5 | Low | **The default folder was chosen on every start from whether `/var/lib/zekno` exists**, not from who owns it or where this runner was set up. (a) A user who is not root, on a server where root has its own `/var/lib/zekno`, picked a folder it cannot use. (b) A runner set up in `~/.local/state/zekno` silently switched to an empty `/var/lib/zekno` created later, answered `not_set_up`, and opened "first setup wins" again. | Root always uses `/var/lib/zekno`. Anyone else keeps `~/.local/state/zekno` once it is set up; before that, `/var/lib/zekno` is used only when it exists, is a folder and belongs to that user (a server set up by feature 003); otherwise `~/.local/state/zekno`. `ZEKNO_RUNNER_HOME` still wins when set. The choice is a pure function with a test for each case. |
| S6 | Informational | **Input nested 100,000 levels deep ended the session** instead of being refused, because writing it out again overflowed the stack outside the error handling. | That step is handled: such input is answered with one `invalid_request` and the session goes on. |
| S7 | Informational | **`state` had no time limit and ignored the input closing**, so a hung `docker compose ps` kept the session process alive. | `ps` is stopped after 30 seconds, and as soon as the input closes. Its app is then left out of the answer, which the contract already reads as "state not known", never as stopped. A `state` request handled after the input closed does not ask Docker. |
| S8 | Informational | **`ps` and `logs` ran in whatever folder the runner was started from.** Docker Compose reads files from the folder it runs in. | Both are started in the runner's own private folder. |

**Where each fix is tested**

| Finding | Test |
|---------|------|
| S1, S2, S3, S6, S7, S8 | `apps/runner/test/hardening.test.ts`, each against a real runner process and the stand-in Docker. Each test was also run against the runner at `7b639f7` and fails there. |
| S5 | `apps/runner/test/runner.test.ts`, "the runner's folder" |

**Checked and found sound**

- A session sends `setup`, `sync`, `apply` and `status` to the same functions as the one-shot
  commands, with the same lock, the same checks and the same order of work.
- The lock is never held while waiting on a reader: it is released before a result is written,
  and progress lines during a deploy never wait.
- A request's input survives the round trip through the session unchanged, so signature checks
  see exactly what was sent.
- There is no new way to make an accepted deploy acceptable again. State is written only by
  `setup`, `sync` and `apply` under the lock; `state`, `logs` and `version` write nothing.
- Nothing the runner writes itself carries a decrypted value. Reports have no free text, and
  every error path maps to a fixed reason.
- No argument can be injected into the `docker` command: app names are checked against the
  app-name pattern and must be a deployed app, the `zekno-` prefix makes a flag impossible,
  `tail` is a whole number from 0 to 1000, and no shell is involved.
- Only Zekno's own Compose projects are reached.
- The environment given to `docker` for `ps` and `logs` holds no secret.
- Output from a lying Docker is reduced to four checked fields per service and capped in size;
  log lines are capped and cannot forge a frame.
- When the input closes during `apply`, the deploy finishes, state is saved and the lock is
  released.
- Two sessions, or a session and a one-shot command, take turns on the lock.
- Only root can create `/var/lib/zekno`, and the folder privacy check still applies, so the
  runner cannot adopt a system folder an attacker prepared.
- Errors and exit statuses reveal no path or internal detail.
- An oversized line is never held in memory, and three unreadable lines in a row end the session.
- The message schemas are strict.

**Noticed while fixing, not part of the review**

- A single request line at the size limit (32 MiB) made only of nested arrays costs the runner
  about 1.5 GB of memory for a moment while it is parsed, measured on macOS. The runner then
  refuses it and carries on. The same parsing serves the one-shot commands, and it lives in
  `packages/core` (`parseMessage`), outside what was fixed here.
