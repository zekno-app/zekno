# Security Review: CLI and Runner

**Date**: 2026-11-13 · **Scope**: `apps/cli/src`, `apps/runner/src`, and the runner messages in
`packages/core/src/protocol.ts` · **Kind**: internal, focused review

This is not an external audit. One independent reviewer read the finished source of both programs
without access to the author's reasoning and without running anything. The fixes were then made
by the same assistant that wrote the programs. An external audit is still required before
production use.

**Who was considered**

| Attacker | Can do |
|----------|--------|
| A | Start the runner on the server and send it any input, for example through SSH access that was meant for something else. Holds no team key. |
| B | Change files in the developer's profile folder (`~/.zekno`): a synced or shared folder, a restored backup, another program running as the same user. Cannot read the keychain. |
| A runner that lies | Whatever answers at the stored SSH destination sends the CLI any answer it likes. |

The developer's machine and keychain, and each server once it is set up, are trusted.

**Outcome**: the reviewer found no finding rated high or critical (SC-006). Four medium and six
low findings were fixed, along with the hardening notes below. Nothing rated medium or above is
open. The limits that remain are listed at the end.

## Fixed

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| R1 | Medium | **The runner's lock did not guarantee one run at a time.** It could be seen empty, two runs could both take over a stale lock, and any run could delete another's lock. Two `apply` runs could then overwrite each other's state and make an accepted deploy acceptable again. | The lock is created complete by linking a finished file into place, holds the run's own random mark, and is removed only by the run whose mark is in it. A stale lock is moved aside by rename, which only one run can win. Unreadable content counts as held. |
| C1 | Medium | **The CLI trusted the copy of the team's trust stored in `profile.json`.** Changing a server's public key there leaked the next secret to the attacker's key; adding a member there let a self-signed secret into a deploy the developer signed. | No copy of trust is stored. On every run `openTeam` rebuilds it from the signed team lists: the founding list must match the team code kept in the keychain next to the signing key, each later list must be signed by an admin of the one before, and every server in the profile must be in the signed list under the same name. The core's trust schema also ties each server id to its key. |
| C2 | Medium | **A local server's start command was read from the profile and run as written**, so a changed profile ran any command on the next `deploy` or `status`. | A local target stores only the runner's folder. The command is decided by the CLI itself. A profile that still carries a command is rejected as damaged. |
| C3 | Medium | **`rollback` signed a service definition read from an unsigned history file.** A changed entry became a deploy signed by the developer. | The history stores the signed deploy itself. `rollback`, and the choice of the next deploy number, read the number, app, server and service definition from under that signature (`readSignedDeploy` in the core) and ignore, with a warning, any entry that is not a deploy a current team member signed for that app and server. `--app` and `--to` are validated before any file is read. |
| R2 | Low | **`setup` took no lock and wrote the state before the key**, so two setups or a crash could leave a runner that refuses everything, with no way to recover. A `server add` that stopped after setup could not be finished. | `setup` takes the lock and writes the key first, with exclusive create. `server add` carries on when the runner is already set up for this team at a team list this machine holds, and still refuses a runner that belongs to another team. |
| R3 | Low | **A failure after the state was saved was reported as "state damaged"** although the deploy number had been used. | Any failure after the save is reported as `start_failed` with the app and number. |
| R4 | Low | **Atomic writes were not durable** and used a predictable temporary name opened in a way that follows links. | Both programs create the temporary file exclusively under a random name and remove it on failure. The runner also syncs the file and its folder to disk. |
| C4 | Low | **The CLI took the next deploy number and the outcome on the runner's word.** A runner with older state made it sign a number it had signed before; a lying runner could collect a deploy signed far in the future; any answer that was not a refusal counted as success. | The next number is one above both what the runner reports and the highest number this machine signed, so a number is never signed twice. A runner more than 1,000 ahead of that is refused before anything is signed. The deploy is recorded as sent before it leaves, and success requires `started` or `start_failed` with the same app and number. |
| C5 | Low | **The hidden prompt cut a multi-line paste at the first line**, could leave the rest for the shell to read, and added control keys to the value. | The prompt is rebuilt on Ink. A value with a line break is refused with a pointer to `--stdin`; control keys never enter the value; Ctrl-C and Escape cancel; an empty answer is not stored. Echo is switched off before the question is drawn. The key handling is a pure function with unit tests. |
| C6 | Low | **Names from the runner reached the terminal unfiltered**, and `status` did not check which server answered. | Status keys are held to the app and secret name patterns in the message schema. `status` and `deploy` both refuse an answer from a different server or team. |

**Hardening, also done**

- A runner's answer is read up to the message size limit and no further.
- Words after a command are refused. `zekno secret set NAME value` says that a value is never an
  argument, instead of quietly ignoring it.
- Reserved secret names now cover everything the runner passes to Docker and the variables that
  change how programs load or connect: `PATH`, `HOME`, `TMPDIR`, `XDG_RUNTIME_DIR`, `GODEBUG`,
  `DOCKER_*`, `COMPOSE_*`, `BUILDKIT_*`, `BUILDX_*`, `LD_*`, `DYLD_*`, `SSL_CERT_*`, `*_PROXY`.
- The runner refuses to act when its folder or key file belongs to another user or is readable
  by anyone else.
- The profile folder is set to mode `0700` on every write. Deploy history is capped at 50 entries.
- The quickstart pipes a secret from a file, not from `echo`.
- The contract's order of work in `apply` now matches the code: secrets are opened before the
  state is saved, so a deploy that cannot be opened does not use up its number.
- The typed value is kept out of the interface's render state, and the `DEV` variable is hidden
  from Ink so that React's developer tooling can never be switched on around the prompt. The
  compiled program does not contain those tools.

## Where each fix is tested

| Finding | Test |
|---------|------|
| R1, R2, R3 | `apps/runner/test/runner.test.ts` |
| C1, C2, C3, C4, C6, resume of `server add`, answer size, extra words | `apps/cli/test/hardening.test.ts` |
| C5 | `apps/cli/test/secret-input.test.ts`, and by hand in a pseudo-terminal (below) |

**Checked by hand in a pseudo-terminal**, because a test runner has no terminal: the full journey
through the Ink interface; the typed value never appears in the terminal's output; the terminal's
echo flag is already off when the question first appears; backspace, a single-line paste, a
multi-line paste (plain and bracketed), arrow keys, Ctrl-C and Escape. Ctrl-C at the prompt
first hung the program and was fixed during this check.

## Not changed, and why

| Reviewer's note | Decision |
|-----------------|----------|
| **The first `setup` is first come, first served** (part of R2). Whoever can start the runner before `server add` decides which team the server obeys. | Documented, not changed. Install the runner and run `server add` in one sitting, and do not give anyone else a way to start the runner before then. A stolen first setup shows up as `already belongs to a team`. |
| **The runner trusts its environment** (R5): `ZEKNO_RUNNER_HOME`, `ZEKNO_DOCKER` and `PATH` decide where state lives and which program receives the secrets. | Documented, not changed. Do not let a less-trusted user start the runner with their own environment (no `PermitUserEnvironment`, no `AcceptEnv ZEKNO_*`, no sudo rule that keeps them). The ownership check above stops the runner from acting on a folder that is not its own. |
| **The server code is shown after the server was added**, so it cannot stop anything. | Over SSH the code and the key arrive through the same connection, so comparing them would prove nothing. The code is shown so the step is the one used later, when a control plane sits in between and the comparison matters. |
| **A signed Compose file can read the runner's key** through a bind mount or a relative path, because app folders sit inside the runner's folder. | A team member who can sign a deploy can already mount the whole host through Docker. Signing a deploy is equal to root on the server; that is a property of deploying with Docker, not of where the folder is. |

## Limits that are accepted, not defects

- Everything in the core library's review still applies:
  [`specs/002-core-library/security-review.md`](../002-core-library/security-review.md).
- Over SSH, the server's identity rests on SSH's host verification.
- Attacker B can still change where the CLI connects (the SSH destination or local folder in the
  profile). The other end then receives signed deploys, whose service definition is readable, but
  cannot open a secret or produce an answer that passes for the real server's acceptance of a
  different deploy. It can make deploys fail.
- Attacker B can delete history or secret records. The result is a refused or incomplete deploy,
  never a forged one. Which accepted deploy `rollback` picks by default depends on an unsigned
  `outcome` mark; every candidate is still a deploy the team signed for that app and server.
- A deploy signed by a member who has since left the team is not offered for rollback.
- What is typed before the question appears is echoed by the terminal, as with any hidden prompt.
- Docker's own output is passed to the developer's terminal. An error message from Docker can
  repeat a value that was filled in from a secret, such as a malformed port or address.
- Docker keeps a container's environment in its own configuration on the server.
- JavaScript strings cannot be wiped, so the signing key and a typed value stay in the CLI's
  memory until the process exits. Each command is one short process.
- One developer on one machine. Two machines deploying the same app would each count from their
  own history and the runner's last number; the runner refuses the loser of a tie.
