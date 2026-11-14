# Command Contract

## `zekno` (the CLI)

| Command | Does |
|---------|------|
| `zekno init --name <you>` | Creates the signing key in the OS keychain and the team. Prints the team code. |
| `zekno server add <name> --ssh <destination> [--runner-path <path>]` | Sets up the runner over SSH, prints the server code, adds the server to the team list. |
| `zekno server add <name> --local [--home <dir>]` | The same with a runner on this machine. |
| `zekno server ls` | Lists connected servers. |
| `zekno secret set <NAME> --app <app> --server <name> [--stdin]` | Asks for the value without echo (or reads standard input) and stores the signed record. The value is never an argument. |
| `zekno secret rm <NAME> --app <app> --server <name>` | Signs a removal. |
| `zekno secret ls --app <app> --server <name>` | Names and versions. Never values. |
| `zekno deploy --app <app> --server <name> [-f <compose file>]` | Signs and delivers a deploy. Default file `compose.yaml`. |
| `zekno rollback --app <app> --server <name> [--to <number>]` | Deploys an earlier service definition under the next number. Default: the one before the latest. Only deploys this machine signed and the runner answered for are offered. |
| `zekno status --server <name> [--json]` | What the server holds. |

Global: `--json` on `deploy`, `rollback` and `status` prints one JSON object. `--help` on any
command. `ZEKNO_HOME` overrides the profile folder.

Exit status: `0` success; `1` the action was refused or failed; `2` wrong usage. A word after a
complete command is wrong usage.

### Output

| Where it runs | What it prints |
|---------------|----------------|
| At a terminal | The Ink interface: a spinner while a runner is being reached, a hidden prompt, aligned tables, colour. |
| Piped, in a script, with `--json`, or with `TERM=dumb` | Plain lines. Results on standard output, with table cells separated by tabs; warnings and failures on standard error, one sentence each. This form is stable and is what the tests assert. |

Over SSH nothing is animated, because SSH may ask for a password in the same terminal.

At the hidden prompt: Enter finishes, Ctrl-C or Escape cancels with exit status `1`, a value with
a line break is refused (use `--stdin`), and an empty answer stores nothing. Without a terminal
the value must come from standard input with `--stdin`.

### Order of work in `deploy` and `rollback`

1. Verify the profile: rebuild the team's trust from the signed team lists and the team code in
   the keychain. Anything that does not verify stops the command.
2. Ask the runner for its status. A different server or team stops the command.
3. Next number: one above both the runner's last number and the highest number in this machine's
   verified history. A runner more than 1,000 ahead stops the command; nothing is signed.
4. Sign the deploy and record it in the history as `sent`.
5. Deliver it. The answer must be `started` or `start_failed` for the same app and number;
   the history entry then takes that outcome.

## `zekno-runner` (on the server)

Each run reads one JSON message from standard input (none for `status`), prints one JSON line to
standard output and exits. It never prompts.

| Command | Input | Output |
|---------|-------|--------|
| `zekno-runner setup` | `RunnerSetupRequest` | `RunnerSetupResponse`, or a `RunnerReport` with `refused` |
| `zekno-runner sync` | `RunnerSyncRequest` | `RunnerReport` (`ok` or `refused`) |
| `zekno-runner apply` | `RunnerApplyRequest` | `RunnerReport` (`started`, `start_failed` or `refused`) |
| `zekno-runner status` | none | `RunnerStatus`, or a `RunnerReport` with `refused` |

Exit status: `0` for `ok`, `started` and a status or setup answer; `1` for `refused` and
`start_failed`; `2` for wrong usage.

Environment: `ZEKNO_RUNNER_HOME` (default `/var/lib/zekno`), `ZEKNO_DOCKER` (default `docker`).

## Order of work in `apply`

1. Take the lock, or report `busy`.
2. Read and validate the state, or report `invalid_state`.
3. Apply each newer team list in order. A refused list stops the run with that reason.
4. `verifyDeploy`. A refusal ends the run; state is left as it was after step 3.
5. `openSecrets`. A deploy whose secrets cannot be opened is refused and does not use its number.
6. Save the new state. From here the deploy is accepted and its number is used.
7. Write the service definition and start Docker Compose with the secrets in its environment.
   Any failure from here on is `start_failed`.
8. Report `started` or `start_failed`, and release the lock.

`setup` also takes the lock, and writes the key before the state.
