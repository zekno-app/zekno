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
| C8 | Low | **Server text reached the terminal unmarked.** A lying server could print lines that look exactly like zekno's own, such as a fake "Server code: ..." line or an instruction to run a command. | In single commands, every line from a runner's, Docker's or SSH's standard error, and every progress line of a deploy, is drawn through the interface's new `remote` method after a fixed mark, `remote:`, as git marks what the other side said. Plain output writes `remote: <line>` on standard error. None of zekno's own messages on standard error start with the mark, and it stays the same for scripts. At a terminal the line is dim after the same mark, and a line wider than the terminal goes on under its own text, never at the left edge where zekno's own lines start. The full-screen app already keeps these lines off the terminal and is unchanged. |
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
