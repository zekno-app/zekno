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

## CLI plumbing: sessions, transport, text cleaning, operations (reviewed 2026-11-14)

**Scope**: `apps/cli/src/session.ts`, `transport.ts`, `sanitize.ts`, `ops/*.ts`, `context.ts`,
`profile.ts` and the commands that call them, at commit `6fa2eaa`, against
[`contracts/session.md`](./contracts/session.md) and [`contracts/commands.md`](./contracts/commands.md)
· **Kind**: internal, focused review

This is not an external audit. One independent reviewer read the finished source without access
to the author's reasoning, and ran its own measurements against the CLI: `sanitize` with 200,000
fuzzed inputs, and the CLI's memory with its standard error going into a pipe nobody reads. The
fixes were made afterwards, from the findings, by an assistant other than the reviewer, on the
source as it stood at `fc9a9ea`. An external audit is still required before production use.

**Who was considered**

| Attacker | Can do |
|----------|--------|
| A runner or server that lies | Answer anything, write anything on standard error or as Docker's output, as fast as it likes, and keep a command waiting. Holds no team key. |
| B | Change files in the developer's profile folder (`~/.zekno`). Cannot read the keychain. |
| A slow reader | Read the CLI's standard error slowly, or never: a pipe into a program that stopped, a FIFO. Not an attacker, but a condition the CLI must survive. |

**Outcome**: no finding rated medium, high or critical. Three low findings and one
informational note were fixed.

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| C7 | Low | **Server output could grow the CLI's memory without limit when its standard error is a slow pipe.** Two paths: what a runner or SSH writes on standard error, passed on without waiting (at feature 003 standard error was inherited, so SSH itself had to wait), and Docker's progress lines during a deploy, written from the session's event callback. Bun's `process.stderr.write` returns `false` but keeps the text, and `writableLength` stays 0, so a size check cannot see it. Measured by the reviewer with standard error going into a FIFO nobody reads: 2 GB and rising. | A runner's standard error is passed on one line at a time, and the next is read only once standard error has taken the last one (`drain`). The pipe then fills and the runner, or SSH, has to wait, as at feature 003. Docker's lines during a deploy go through a hold of at most 500 lines (research R5): while standard error is backed up, the oldest held line is dropped and counted, and the count is reported ("Left out N lines of Docker's output ...") before the next line drawn. Once the deploy has its answer, its last lines get at most one second. The interface at a terminal lets go of lines it has drawn, where it used to keep every one. In the tests (up to 400 MB sent, standard error into a FIFO nobody reads) the CLI peaked at about 62 MiB with the runner held back, and at about 67 MiB for a deploy's lines, which finished on its own. With the fixes taken out, each passed the tests' bound of 200 MiB within half a second. |
| C8 | Low | **Server text reached the terminal unmarked.** A lying server could print lines that look exactly like zekno's own, such as a fake "Server code: ..." line or an instruction to run a command. | In single commands, every line from a runner's, Docker's or SSH's standard error, and every progress line of a deploy, is drawn through the interface's new `remote` method after a fixed mark, `remote:`, as git marks what the other side said. Plain output writes `remote: <line>` on standard error. None of zekno's own messages on standard error start with the mark, and it stays the same for scripts. At a terminal the line is dim after the same mark, and a line wider than the terminal goes on under its own text, never at the left edge where zekno's own lines start. The full-screen app already keeps these lines off the terminal and is unchanged. Later change: the terminal deploy view of `zekno deploy` and `zekno rollback` shows Docker's lines without the mark, as its approved board does. See F1 in the final review below. |
| C9 | Low | **`profile.json` accepted any string as an SSH destination, runner path and member name** (older than this feature). The first two were checked only on connect, so attacker B could put escape sequences there and `zekno server ls` printed them raw. | The profile's schema holds the destination and the runner path to the patterns `server add` checks (`SSH_DESTINATION`, `RUNNER_PATH`), and the member name to the core library's rule for a name in a team list: no control, format, unassigned or private-use character, no line or paragraph separator, no space at either end, at most 64 characters. A changed value makes the profile damaged when it is read. |
| C10 | Informational | **Text cleaning kept characters that are drawn as nothing or as blanks**: Hangul fillers, the combining grapheme joiner, Mongolian and other variation selectors, and unassigned default-ignorable code points. | `sanitize` also removes every `Default_Ignorable_Code_Point`, except U+FE0E and U+FE0F, which choose between an emoji's text and emoji form, so emoji keep their form. |

**Where each fix is tested**

| Finding | Test |
|---------|------|
| C7, C8, C9, C10 | `apps/cli/test/plumbing.test.tsx`. The C7 measurements run `apps/cli/test/flood.ts` as a process of its own and leave nothing running. Each test was also run with its fix taken out, and fails then. |

**Checked and found sound**

- The output of `sanitize` never contains a control or invisible character: 200,000 fuzzed
  inputs, and OSC 52, OSC 8, the 8-bit C1 forms, unterminated and split sequences, bracketed
  paste, bidirectional and tag characters checked one by one. (Since C10 the only characters it
  keeps that draw as nothing on their own are U+FE0E and U+FE0F.)
- Every path where server text is drawn is either cleaned or held to a pattern.
- Session results get the same checks as one-shot answers, including the server's identity and
  the checks of the deploy number and of the answer.
- No deploy can be sent twice: the switch to the one-shot commands is decided before anything but
  `version` is sent, and nothing is retried.
- The `ssh` argument list is built only from values checked again on every use and a command word
  from a fixed list. There is no shell on the CLI's side.
- The operations make the same checks, in the same order, as the commands they replaced (C1 to C6
  of feature 003).
- A secret value goes only from the prompt to the core library. It is in no plan, result,
  callback, argument, error or file.
- Closing a session cannot leave a process behind.

**Not new, noted**

- A lying server can keep a command waiting for as long as it likes. Over SSH there is no
  deadline, by design, because SSH may be waiting for a password. Ctrl-C works.

**Noticed while fixing, not part of the review**

- `connect` without its `errorLines` option still writes a runner's lines to standard error
  without the mark (now waiting for `drain`). No command uses it that way any more. Two existing
  tests hold that output as it is: "a single command still writes it to standard error, cleaned,
  as before" (`app-effects.test.ts`) and "what the runner writes on standard error is passed on
  cleaned" (`session.test.ts`).
- In plain output a line wider than the terminal is wrapped by the terminal itself, and the part
  after the wrap has no mark. Plain output is meant for pipes and scripts; at a terminal the Ink
  interface indents it.
- SSH's own messages, such as "Permission denied" or a host key warning, come on the same
  standard error as the runner's and carry the mark too.
- `zekno status` prints `<server>: team list version <v>` on standard output, so for a server
  named `remote` that line starts with the mark. The developer chooses that name and it is signed
  in the team list; a server cannot choose it.
- zekno's own warnings and errors in plain output go through `console.error`. In Bun it drops
  what a backed-up standard error cannot take at once instead of waiting. They are few and short,
  so nothing piles up, but into a pipe nobody reads they can be lost.
- A local target's folder (`home`) is still any non-empty string. No command prints it; it is
  passed to the runner as `ZEKNO_RUNNER_HOME`.

## Installing and updating the runner, the SSH hand-over, the release workflow (reviewed 2026-11-14)

An independent reviewer (a separate agent that did not write the code) read commits `6f2686c`
and `949e2f4` and ran the install script under `sh` and `dash` against stand-ins. Nothing was
rated high or critical. One medium and four low findings.

| Id | Rating | Finding | State |
|----|--------|---------|-------|
| U1 | Medium | `server update` replaced whatever file the profile's runner path named. That path is in the profile file, which is not signed, so someone who can edit the profile could point an update at `sshd` or `docker` on the server and have it overwritten once the developer ran the update. Reproduced. | Fixed in `420f934`: only a file named `zekno-runner` is replaced. Checked before anything is asked or sent, and again by the script. |
| U2 | Low | `server update` from an older CLI replaced a newer runner. Reproduced. | Fixed in `420f934`: the script stops with "newer" and changes nothing. |
| U3 | Low | The new runner was moved into place before it was checked. One that could not run on the server (an older C library, a processor without AVX2) left no working runner. Reproduced. | Fixed in `420f934`: it has to answer `version` from the temporary folder first. |
| U4 | Low | The hand-over decided on text. Exit 255 with "Permission denied" anywhere in the first lines of standard error counted as "SSH could not log in", and a server's own output can contain those words. For a runner from before 0.2.0 the same request, a deploy included, was then sent a second time; the runner refuses the repeated deploy number, so the deploy ran once but was reported as refused. A lying server could also force a hand-over on every connection. Reproduced. | Fixed: the decision is now made on the last line of standard error only, and only when it is SSH's own closing line, whole (`<user@host>: Permission denied (<methods>).` or `Host key verification failed.`). The words inside what a remote command wrote no longer count, so its request is not sent again. A lying server can still print SSH's line itself and force one hand-over where SSH asks nothing; it gains nothing by it. What the app reads in the background never hands the terminal over. |
| U5 | Low | The workflow used `actions/checkout@v4` and `oven-sh/setup-bun@v2`, tags that can be moved, in a job that may write releases. | Pinned to full commits in `0d9d1f3`. Two parts stay with the maintainer: see "Left for the maintainer". |

**Notes, not fixed**

- N1. The `wget` route has no size limit on the download, and `curl --max-filesize` does not
  stop a download of unknown length before curl 8.4. The packed file can fill the disk before
  the checksum is taken. Only whoever serves the release address over TLS could do that.
- N2. "Installed the runner … It matched the checksum" repeats what the server printed. A lying
  server can print it without doing it. What a server is trusted for is decided by the session
  that follows, where every answer is checked. `zekno server update` from the command line does
  not read the status afterwards; the app does.
- N3. A terminal that answers the background colour question more than a second late, in pieces
  split across reads, could have the tail of its answer (hex digits and `/`) taken as typing.
  It needs a very slow link between the terminal and zekno. Not reproduced.
- N4. On Linux, a line typed but not finished while SSH had the terminal may arrive as key
  presses when the app takes the terminal back. Checked on macOS only, where it did not.
- N5. Before the first `server add`, someone who can write to a folder on root's `PATH` could
  put a `zekno-runner` there, and the installer would use it. Those folders belong to root on a
  normal system.
- N6. `--runner-file` checks the file, then reads it. A file swapped in between is read without
  the size limit. Development option only.
- N7. In the app, what a server writes on standard error is shown without slowing the server
  down. Memory is bounded at 200 lines; a server can keep the screen busy.

**Checked and found to hold**

- The script's text is fixed. Its words are checked three times (the CLI's patterns, the
  transport, the script). A hostile `IFS`, `ENV`, `BASH_ENV`, `CDPATH` or a home folder with
  spaces and `*` changes nothing.
- Bytes sent after the script (the runner file, the session's requests) are never run as
  commands, on a failing path either: every path ends in `exit` or `exec`.
- A missing checksum never counts as a match. The comparison is exact, and an empty or odd
  answer from the checksum tool fails.
- The file is checked in a private folder (mode 700) in the folder it will live in, and put in
  place by a rename. A symbolic link at the destination is replaced, not followed.
- Downloads are HTTPS only, redirects included, with `curl` and with `wget`.
- The CLI never stores a path a server chose, and a server cannot make it run anything locally.
- An update never happens unasked.

**Tests the reviewer found missing, still missing**

- Installing as root (`/usr/local/bin`, `/var/lib/zekno`): the stand-in server is always a
  normal user. The real-server run covers it.
- The hand-over in a real terminal has no automated test; it is walked through in a
  pseudo-terminal (quickstart, "Results").
- Real `curl`, GNU `wget` and BusyBox `wget` are stand-ins in the tests.

**Left for the maintainer**

- Restrict who can push `runner-v*` tags (a tag ruleset on the repository). Any such tag on any
  commit starts a release.
- The checksums in `SHA256SUMS` come from the same job that builds the files. Before recording
  them in `runner-release.json`, build the runner again somewhere else and compare.

## State, logs and the logs command (reviewed 2026-11-14)

An independent reviewer (a separate agent that did not write the code) read commit `e51baf1`, with
a runner or server that lies as the main attacker, and reproduced each finding against a lying
stand-in runner and the stand-in Docker. Nothing was rated high or critical. One medium and seven
low findings. The fixes were made afterwards, on the code as it stood at `abcf8f4`, by an
assistant other than the reviewer, who reproduced each finding there first.

| Id | Rating | Finding | State |
|----|--------|---------|-------|
| L1 | Medium | A runner that sends `log` events as fast as it can froze the app and `zekno logs`: the session's read loop only waited on promises that were already settled, so no key, timer or signal handler ran (Esc not taken 25 seconds after it was pressed; a SIGINT handler not run 6 seconds after the signal). Docker's progress lines during a deploy took the same path. | Fixed: while it reads events the session client lets everything else run every 10 ms (`session.ts`). The app's log batches and its batches of Docker's progress push back: once 2,000 log lines or 500 progress lines wait to be drawn, nothing more is read until they are, so the runner is held back in the connection. Measured against a runner whose Docker prints without pause: a timer every 10 ms fired at most 12 to 26 ms apart, Esc taken within 0.12 s in a pseudo-terminal, a SIGINT handler run 70 ms after the signal, the app at 225 to 263 MB. An honest runner is not slowed: 270,000 lines of 100 characters a second (40 MB/s) and 2,800 lines of 16 KB a second (45 MB/s), the same before and after. |
| L2 | Low | `zekno logs \| head -1` never ended: Bun's `console.log` ignores a closed pipe, so the SSH session and Docker's log command went on. | Fixed: log lines are written with `process.stdout.write` and wait for `drain`; a closed standard output stops the reading on the server and ends the command quietly, with status 0 (contracts/commands.md). |
| L3 | Low | Nothing bounded the apps in a `state` or `status` answer, and any answer could be 32 MiB: a lying runner made each read take 1.5 seconds and grew the CLI to 2.4 GB. | Fixed: each line is read up to the longest its request can bring (`SESSION_FRAME_BYTES`: 64 KiB for `version` and progress, 192 KiB for a log event, 1 MiB for `state`, 4 MiB for `status`, about twice the largest each message allows), past which the session ends with the existing "more than an answer can hold" sentence. `status` holds at most 1,024 apps and 8,192 secrets, `state` at most 1,024 apps and 4,096 services. So that an honest runner never goes past them, it refuses a deploy that would make it hold more apps or secrets (`too_large`), and leaves out of `state` the apps past the services limit, which reads as "not known". A runner whose state was made outside zekno with more apps than that answers `status` in a way the CLI refuses ("did not answer as expected"). The app keeps only the apps this machine has a history for. |
| L4 | Low | Leaving the logs screen before the runner had answered `status` left the session, and its SSH process, running: one more for each `esc`, `l`. | Fixed: opening a session takes a signal that stops its process at once, while SSH connects or asks, or before the runner answers. Once the logs are being read, leaving closes the session, so the runner stops Docker's log command. |
| L5 | Low | "● running now" and the deploy number in the app's header were the latest deploy in this machine's history, also when it had not started. | Fixed: both come from the runner's last accepted deploy, read with the state. A deploy is "running now" only while every service runs, when its number is the runner's last accepted one and it started. A latest deploy that did not start shows "✖ did not start", and then nothing is marked. Home's deploy column shows the runner's number too, and this machine's again once the server cannot be reached. |
| L6 | Low | With Docker printing without pause and the client gone, the runner never noticed the closed input or the failed writes: it and Docker's log command ran on, the runner growing to 6 GB. | Fixed: the runner lets other work run every 10 ms while it reads Docker's output; a write that fails (EPIPE) counts as the client gone, even while its input is open; at most 8 MiB of progress frames wait for a slow reader, and the rest are dropped. The runner and Docker's log command now end within about 50 ms of the client going (the tests allow 3 seconds). Every existing runner test passes unchanged. |
| L7 | Low | Each background read opened a new SSH connection, every 5 seconds per server: about 720 logins an hour in the server's auth log, firewall limits such as `ufw limit` could shut the developer out, and SSH agents or keys that confirm each use would ask every 5 seconds. | Fixed: one session per server, opened when the app starts (where SSH may ask), checked once to be the server that was connected on this team, and kept; each read sends `status` and `state` over it. A lost session is opened again in the background in batch mode only, at most once every 30 seconds, never where SSH would ask. Deploys, rollbacks, secrets and logs keep their own connections. All kept sessions are closed, and their processes gone, when the app closes, on an error and on a signal (research R16, contracts/app.md). |
| L8 | Low | A background read had no time limit: once the network dropped, Home kept the server's last state, looking current, until TCP gave up. | Fixed: a read with no answer within 20 seconds closes the session and shows the server as not reached, its apps' state unknown. |

**Notes**

- N1. The line for a server where SSH would ask said zekno asks "only when you deploy or open
  logs". It also asks when the app starts and when a server is added or updated. Corrected: "zekno
  asks only when it starts and when you add or update a server, deploy or open logs, never in the
  background."
- N3. `sanitize` keeps combining marks (50 × U+0301 pass), the braille blank, noncharacters and
  U+3000. They cannot change the text, but can draw over the rows next to it in some terminals.
  Not fixed.

**Checked and found to hold**

From the review: while the logs poured in, the CLI's memory stayed bounded (290 to 355 MB); what
went wrong was the event loop, not memory. Checked again while fixing:

- Text in log and progress events is still cleaned before it is drawn, and a log event that does
  not match its definition still ends the reading with a sentence (the existing tests, unchanged).
- Reads in the background never hand the terminal over: a lost session is opened again with
  `BatchMode=yes` only, and not at all where SSH would ask (tested with a stand-in `ssh`).
- Ticks do not open the keychain: they use the team list verified when the app started or last
  verified it (read in the code).
- A kept session is checked against the profile's server and team when it opens, and each later
  `status` over it is checked the same way (read in the code; tested through the app).
- `zekno deploy`, `status` and `rollback` still start one runner process each, and the app's
  deploys and logs still open their own (the existing tests, unchanged).
- The runner's session limits suit a session held open: three unreadable lines in a row (the
  count starts again with every request), 1,024 requests or 32 MiB sent ahead of their answers,
  and no limit on how long a session stays open (read in the code; two requests every 5 seconds
  for 22 seconds in a pseudo-terminal, not for hours).

**Where each fix is tested**

| Finding | Test |
|---------|------|
| L1, L3, L4 (session client) | `apps/cli/test/session.test.ts`, "a runner that sends too much, too fast, or nothing" |
| L1, L2, L4, L5, L7, L8, L3 (app) | `apps/cli/test/state-logs.test.tsx`; `zekno logs` runs as a process of its own (`apps/cli/test/logs-driver.ts`) |
| L3 (bounds) | `packages/core/test/scenarios/messages.test.ts`; the runner's side in `apps/runner/test/hardening.test.ts` |
| L6 | `apps/runner/test/hardening.test.ts`, "a container that prints without pause". Both tests fail against the runner at `abcf8f4`. |

Also walked through in a pseudo-terminal (100 by 30, a driver that reads the terminal the whole
time, an in-memory key store, two runners on this machine, a Docker whose logs never pause), in
three runs, 10 of 10 checks each: Home showed the state; over 22 seconds of ticks each runner was
started once; `esc` and `q` worked on a flooded logs screen; the app exited with status 0 and left
no runner or Docker process.

**Tests the reviewer found missing**: a flood, a closed standard output, leaving before `status`,
answer sizes, a latest deploy that did not start and Ctrl-C in `zekno logs` are now tested. "Lines
of a session that was let go never reach the screen" now checks that no batch of lines is handed
on after `esc`. The interval in `app.tsx` itself is covered by the pseudo-terminal walk, not by a
test.

**Noticed while fixing, not part of the review**

- Passing a runner's standard error on (`transport.ts`) used the same kind of loop as L1: a runner
  writing on standard error without pause froze the CLI (a one-second timer had not fired after 6
  seconds). A kept session makes that stream last as long as the app, so it now gives way every
  10 ms as well, and is tested.
- The installer's output during "add a server" (`install.ts`, `scriptLines`) is read with that kind
  of loop too. Not changed here.
- The runner records a deploy's number before it starts it, so after a failed start it holds the
  failed deploy, and nothing is marked "running now". Which deploy's containers run then (the
  earlier one's, or some of the new one's) cannot be told from what the runner reports.
- A runner from before sessions has nothing to keep open: it is read when the app starts and
  after `u`, never in the background.
- A one-shot `status` answer from a runner before sessions is still read up to 32 MiB.

## The project file (reviewed 2026-11-14)

An independent reviewer (a separate agent that did not write the code) read commit `abcf8f4`, with
someone who controls a folder the developer runs zekno in as the main attacker: a repository the
developer cloned without fully trusting it, whose `zekno.json`, Compose file and links are all the
attacker's. The reviewer reproduced each finding against the stand-in runner and Docker. One
finding was rated high, four medium and three low. The fixes were made afterwards, on the code as
it stood at `6fc818f`, by an assistant other than the reviewer, who reproduced each finding there
first.

| Id | Rating | Finding | State |
|----|--------|---------|-------|
| P1 | High | A `zekno.json` chose an existing app and server, and commands acted on it unasked. In a cloned folder holding `{"app":"api","server":"dev"}` and a Compose file that lists `DB_PASSWORD`, `zekno deploy` with no flags replaced `api` and handed its secret to the folder's container. `rollback`, `secret set` and `secret rm` took the same defaults, and `secret set` named the app only after the value was stored. In the app, Home opened on that app and one `d` replaced it. Reproduced. | Fixed: a `zekno.json` is used only once this machine accepted it, byte for byte. `links.json` in the profile folder holds the real path and the SHA-256 of each accepted file (data-model.md). `zekno link` and a "yes" in the app record what they write; `zekno link` with no names accepts a valid file as it is, after checking its server and its Compose file. A command that would take the app or server from a file that is not accepted stops with status 2 and says why, before the keychain is read, and before anything is signed, sent or started. The app does not select what such a file names, says why on Home, and `d` there deploys nothing and offers nothing. Any change to the file's bytes needs `zekno link` again. `zekno secret set` names the app and server before the value is typed. |
| P2 | Medium | A `zekno.json` in a folder above supplied the Compose file even with `--app` and `--server` typed: `zekno deploy --app billing --server dev` in `services/billing` deployed the root's file as `billing`, and no output named it. Reproduced. | Fixed: its Compose file goes only with the app it names. With another app the Compose file is `-f`, or `compose.yaml` in the current folder, as without a project file. Given both `--app` and `--server`, a file that is not accepted is not used at all. |
| P3 | Medium | In the app, `d` deployed the linked folder to whichever app and server were selected: with the folder linked to `web`, `billing` selected and `d`, billing ran web's definition. Reproduced. | Fixed: a linked folder deploys only to its own app on its own server, and on a server with no apps only when that server is its own. Otherwise `d` says so, names the command for deploying elsewhere, and deploys nothing. |
| P4 | Medium | Before a deploy, the hidden prompt's hint bar said "esc cancel", but esc signed and sent the deploy. The only way out without deploying was Ctrl-C, then `q`, which quit the app. Reproduced. | Fixed: esc at the prompt closes it and returns to the list, and signs nothing. Esc on the list asks "Deploy <app> to <server> without ...?"; only `y` deploys. `n`, or esc on the question, ends the deploy with "Nothing was deployed.". Every hint now says what its key does. |
| P5 | Low | `Bun.YAML.parse` copies what each alias stands for. A Compose file within the 256 KiB limit, one string of 172 KB and 30,000 aliases to it, took 5.2 GB before any bound applied: in the missing-values check, and in the app screen's history, for every deploy each time it was read. Reproduced (stopped at a 1.5 GB cap). | Fixed: a file with more than 200 aliases is not parsed, in `compose-file.ts` and in `views.ts`. It gives no names and no services, never an error. The count errs high, never low: every `*` followed by a character an anchor's name can start with counts, in quotes and comments too. The reviewer's file now costs 50 MiB at most and 1 ms. The runner parses no YAML (checked). |
| P6 | Low | The Compose file was checked first and read later, through calls that follow links, with the keychain read in between: a link swapped in during that gap sent a file from outside the folder. Hard links were not checked. Reproduced. | Fixed: one reader (`compose-read.ts`) finds the file's real path, which must be inside the folder; opens it without following a link or waiting on a pipe; requires a regular file of this user's with one name on the disk and at most 256 KiB; reads it from that open file; then finds its real path again, which must still be inside the folder and be the same file. Its text is what is signed. In the app, the text read when `d` was pressed is kept through both questions and is not read again. |
| P7 | Medium | With no `zekno.json`, `zekno deploy --app web --server dev` followed a `compose.yaml` that was a link to a file outside the folder and sent that file. The app refused the same file. Reproduced. | Fixed: the default `compose.yaml` goes through the same reader and must stay inside the current folder. `-f` still names any file, since the person typed it, and is read from one open file, a regular file within the limit, never a pipe. |
| P8 | Low | The missing-values list had no bound. At 80 by 24, from 4 names the line saying how many were missing was drawn over, and from about 20 the marked name was not drawn. A 256 KiB file gave 20,263 names: 1.35 s and 1.7 GB for each frame. Measured by the reviewer. | Fixed: at most 64 names are taken from a file. The screen draws as many as fit around the marked name, and "and <n> more" for the rest. |

**Notes**

- A field written twice, `{"app":"good",…,"app":"evil"}`, was read as `evil`. Now it is an error
  that names the file.
- On a file system that ignores case, `ZEKNO.JSON` was used and called `zekno.json`. Now only a
  file listed in its folder as exactly `zekno.json` counts.
- Raw filesystem errors in `project.ts` (a race, a deleted folder) could escape with a path that
  was not cleaned. They are now sentences with cleaned paths.
- After either question in the app, the plan read `zekno.json` and the Compose file again, so the
  text signed could differ from the text whose names were listed. Fixed with P6.
- `expectedValuesIn` was not used, and its tests proved nothing about the path the app uses. It
  was removed with its tests. Without a `zekno.json`, the CLI waited for ever on a named pipe at
  `compose.yaml`; it now says it is not a file.
- User Story 4, scenario 5 says an unknown app in `zekno.json` stops the command. Not changed:
  the code checks the server against the verified profile and holds the app to the app-name
  pattern, and an app this machine has not deployed is a first deploy. With P1 such a file is
  used only after `zekno link` accepted it. Left for the maintainer to decide.
- A `zekno.json` naming a server that is not connected still supplied its app for `d` on a server
  with no apps. Now it supplies nothing, and `d` says the server is not connected.

**Checked and found to hold**

Run again while fixing, on the fixed code:

- Hostile contents of `zekno.json` are refused with a sentence that names the file: `__proto__`
  and `constructor` fields, NUL in a name, nesting 1,500 deep, `1e999999`, bidirectional and lone
  surrogate characters in the Compose path, text after the object, an array (the reviewer's
  `e11`). Compose paths the schema allows, such as `.`, `./compose.yaml`, `...`, full-width dots,
  look-alike letters and 255 characters, either name a file inside the folder or are refused.
- Writing `zekno.json` (the reviewer's `e15`) never replaces a file, folder, pipe or link without
  `--force`; with `--force` it replaces a link or pipe itself, never through it, and does not
  replace a folder; no temporary file is left; mode 644 also with umask 077.
- Other YAML within the limit (the reviewer's `e5`): Bun refuses the billion-laughs file; flow
  nesting 100,000 deep stops Bun's parser with an error that is caught; merge keys, 120,000
  unclosed `${`, 60,000 nested `${` and a cyclic alias each finish in under 50 ms and 62 MiB.
- When a command stops on a file that is not accepted, the keychain is not read, no runner
  process is started, and Docker never runs `up` (counted in the tests).

**Where each fix is tested**

| Finding | Test |
|---------|------|
| P1 | `apps/cli/test/project-flow.test.tsx`, "a folder nobody on this machine linked (the reviewer's scenario)": `deploy`, `rollback`, `secret set`, `secret rm`, `secret ls`, `status` and `logs` each stop with status 2 and the sentence, with no keychain read, no runner started and no `up`; accepting with `zekno link`; a changed file; the app. `apps/cli/test/project.test.ts`: `withProject`, `zekno link` accepting, and `links.json` damaged, a link, a pipe, too large, more than 500 entries. |
| P2 | `project-flow.test.tsx`, "flags win over the file, one detail at a time, and its Compose file goes only with its own app" and "a zekno.json in a folder above does not hand its Compose file to another app below it"; `project.test.ts`, "its Compose file goes with its app". |
| P3 | `project-flow.test.tsx`, "a linked folder deploys only to its own app" and "on a server with no apps yet". |
| P4 | `apps/cli/test/app-state.test.ts`, the two "before a deploy" tests; `project-flow.test.tsx`, "esc at the prompt returns to the list and signs nothing". |
| P5 | `apps/cli/test/compose-file.test.ts`, "aliases are counted before anything is parsed". The memory test passes the 3 GB cap and is killed when the count is taken out. |
| P6, P7 | `project.test.ts`, "the Compose file it names, read once"; `project-flow.test.tsx`, the swapped Compose file, "with no zekno.json, a compose.yaml that is a link out of the folder is not sent", and "what is signed is the text whose names were listed". |
| P8 | `compose-file.test.ts`, "at most 64 names"; `project-flow.test.tsx`, "the list of missing names fits the window" (80 by 24 and 100 by 30, 3, 4, 20 and 64 names, the marked name first, in the middle and last, with the prompt, the list and a line above the hints). It fails when the window is taken out. |

Also walked through in a pseudo-terminal (100 by 30, a driver that reads the terminal the whole
time, an in-memory key store, a runner on this machine, the stand-in Docker), three runs of 24
checks, all passed each time: in a folder with a `zekno.json` nobody accepted, Home showed the
problem line, the first row was selected and `d` deployed nothing; in a linked folder whose
Compose file expects two values, esc at the prompt returned to the list, esc there asked, `n`
said "Nothing was deployed." and Docker never ran `up`, then `d`, esc, esc, `y` deployed; with
another app selected, `d` showed the notice and deployed nothing; the app exited with status 0
each time and left no process.

**Left**

- Someone who can write the profile folder (attacker B) can add an entry to `links.json`. By
  design: they gain nothing they do not have already (data-model.md).
- Two zekno processes accepting at the same moment: the last write wins, and the other file has to
  be accepted again.
- The alias count also counts `*name` inside quotes and comments. A Compose file with more than
  200 of them gets no missing-values list before a deploy; the deploy itself is unaffected.
- At 80 columns, the set-a-secret header cuts "set a secret" short once the count has two digits
  ("33 of 64"). Seen while checking P8; not changed.
- User Story 4, scenario 5 (see the notes).

## Final review of the whole feature (reviewed 2026-11-14, T058)

An independent reviewer read the feature at `eb6a65e`, with the most care on what no one but
its author had read: the fixes for the earlier reviews (`6fc818f`, `2f79ede`) and the last
phase (`6482285`). Nothing was rated high or critical. Four low findings and five notes.

| Id | Rating | Finding | State |
|----|--------|---------|-------|
| F1 | Low | At a terminal, `zekno deploy` and `zekno rollback` draw Docker's lines with no `remote:` mark: the latest line, dim, under the stage row, and on a failed start the lines in the "Docker said" panel. A lying server can print a line that reads like zekno's own result. C8 above, the README and the docs said every such line carries the mark. | Not changed. The approved board ("zekno deploy: success and failure") shows these lines without a mark, and the result line that follows is zekno's own. The record, the README and the docs now say what the screen does. Whether to add the mark is the maintainer's decision. Plain output is as C8 says. |
| F2 | Low | `zekno link --app <name>` in a sub-folder took the server from a `zekno.json` above that this machine never accepted, wrote a new file with it and accepted that. The same with `--server` and the app. Reproduced. | Fixed in `ccffd32`: a missing name is filled only from an accepted file. Otherwise the command stops with exit status 2 before writing anything. |
| F3 | Low | `zekno secret set` asked for the value before it checked the name. `zekno secret set DB_PASSWORD=hunter2` at a terminal repeated what was typed in the prompt. Reproduced. | Fixed in `ccffd32`: the name is checked before any prompt, and the refusal states the rule without repeating what was typed. |
| F4 | Low | The read made when the app starts, and after `u`, had no time limit, so a server that stalled just then stayed "not asked" and was never retried. Reproduced. | Fixed in `ccffd32`: the 20-second limit starts as soon as the session is open. Only connecting, where SSH may be asking for a password, has none. |

One more from the walkthrough of every screen, the same day:

| Id | Rating | Finding | State |
|----|--------|---------|-------|
| W1 | Low | At a terminal, a `remote:` line holding a word longer than the room left (a path) was wrapped by the terminal, so its rest started at the left edge, where zekno's own lines start. C8 said that could not happen. `zekno logs` at a terminal had the same flaw. | Fixed in `ccffd32`: zekno breaks such a line itself, and every continuation stays under the text after the mark. |

**Notes, not fixed unless it says so**

- N1. What a mistyped `secret set` can show. `secret set NAME VALUE` is refused and prints the
  name only. With the two swapped, the value is printed as if it were the name, when it fits the
  name pattern. `secret set <token>` with no name stores the token as a secret's *name* when it
  fits the pattern (`sk_live_…` does): it is signed, sent to the runner and listed by `status`.
  No pattern can tell such a token from a name.
- N2. A `zekno.json` above that could not be read (a link, another user's file, bad JSON)
  stopped `deploy --app X --server Y`. Fixed in `ccffd32`: given both names, such a file counts
  as none.
- N3. The runner drops progress frames past 8 MiB waiting to be sent, and does not say so. On a
  failed start with very long Docker output, the last lines can be missing. The result is never
  dropped. Reasoned, not reproduced.
- N4. A line a server writes on standard error is not cut at the documented length when it
  arrives whole in one read. It is bounded at about 64 KiB.
- N5. What accepting a `zekno.json` covers: its path and its bytes, nothing else. The Compose
  file beside it can change afterwards (an edit, a `git pull`, a checked-out branch) and is
  deployed as it is. That is "the developer deploys what is in their folder", but a pull request
  branch of one's own repository carries the same accepted `zekno.json` with another Compose
  file. `zekno link` with no names, in a sub-folder, accepts the file above and prints its app
  and server after accepting. Nothing warns that the app it names already exists on that server.

**Earlier findings tested again at `eb6a65e`, all still fixed**

P1, P2, P5, P6 (a second process swapped a folder on the way to the Compose file through
230,000 reads: content from outside was read 0 times), P7, L1, L3, L4, the file-name case note,
and the runner's and the plumbing's own tests (S1 to S3, S6 to S8, L6, C7 to C10).

**Checked and found to hold**

- Nothing read over a kept session decides an action. The deploy number comes from `status` on
  the deploy's own connection; the rollback target and the secrets come from this machine.
  Deploys, rollbacks and logs open their own connection and check identity on it.
- Identity is checked on every `status` over a kept session.
- An answer to one request is never taken as the answer to another: a read that times out
  closes the session, only the kind of event the request allows is accepted, and anything else
  ends the session. A lying server gains nothing from a session that lasts for hours.
- Frame limits hold for a line split across reads and for a last line with no line feed.
- Processes are reaped: sixteen runs across eight states of a kept session and of logs, closed
  normally and at once, left no SSH, runner or Docker process.
- A deploy that ran cannot be reported as "could not be reached": that is said only when
  nothing but `version` had been sent.
- The alias guard before the YAML parser: no text under 256 KiB with 200 aliases or fewer was
  found that costs more than 406 MB or 0.3 seconds.
- Plain output of every command, with hostile Docker and runner text: no escape or control byte
  on either stream, zekno's own lines plain ASCII, the typed secret value nowhere.
- The missing-values question: only `y` deploys.

**Not checked by any review of this feature**

- Real SSH, real Docker and Linux by a reviewer. One real server was used in the run recorded in
  quickstart.md: Linux x86-64, root, key in the agent.
- A session held for hours.
- A server reached with a password, as a user who is not root, or on ARM64.
- Installing from a published release: none exists yet.

**Open, for the maintainer**

- S4: anyone who can start the runner on the server can read `state` and `logs` of every app,
  with no team signature. Accept it, or require signed requests.
- F1: mark Docker's lines in the terminal deploy view, or keep the board as it is.
- N1 and N5 above.
- From the installer review: restrict who can push `runner-v*` tags, and compare the release's
  checksums with a build made elsewhere before recording them.
- An external audit is still required before anything here is relied on.
