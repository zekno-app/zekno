# zekno (CLI)

Deploys Docker Compose apps to servers you own. Secrets are encrypted and deploys are signed on
this machine; the [runner](../runner) on the server checks every signature before it decrypts or
starts anything.

> **Unaudited.** Built on [`@workspace/core`](../../packages/core), which has had an internal
> review only. Do not use it for anything you could not afford to lose.

This first version talks to the runner directly, over SSH. No Zekno service is involved. It is for
one developer on one machine; teammates arrive with the control plane.

An internal review of this program and the runner is in
[`specs/003-cli-runner/security-review.md`](../../specs/003-cli-runner/security-review.md).

## Commands

```text
zekno init --name <you>
zekno server add <name> --ssh <user@host> [--runner-path <path>]
zekno server add <name> --local [--home <dir>]
zekno server ls
zekno secret set <NAME> --app <app> --server <name> [--stdin]
zekno secret rm <NAME> --app <app> --server <name>
zekno secret ls --app <app> --server <name>
zekno deploy --app <app> --server <name> [-f <compose file>] [--json]
zekno rollback --app <app> --server <name> [--to <number>] [--json]
zekno status --server <name> [--json]
```

Exit status: `0` success, `1` refused or failed, `2` wrong usage.

A secret value is never an argument. Leave it out and you are asked for it without echo, or pipe
it from a file with `--stdin < file`. A value of several lines needs `--stdin`.

## Interface

At a terminal the interface is drawn with [Ink](https://github.com/vadimdemedes/ink): a spinner
while a runner is being reached, a hidden prompt, aligned tables. When output is piped, in a
script, or with `--json`, it prints plain lines instead: results on standard output with table
cells separated by tabs, warnings and failures on standard error. That form is stable.

Over SSH nothing is animated, because SSH may ask for a password in the same terminal.

A walk-through is in [`specs/003-cli-runner/quickstart.md`](../../specs/003-cli-runner/quickstart.md).

## What is kept where

| What | Where |
|------|-------|
| Your signing key and the team code | The system keychain, service `app.zekno.cli`. Never in a file; there is no option for that. |
| Team lists, connected servers | `~/.zekno/profile.json` (or `ZEKNO_HOME`). Public keys and signatures only. |
| Secrets | `~/.zekno/secrets/…`, as encrypted, signed records. A value cannot be shown again after it is set. |
| Deploy history | `~/.zekno/history/…`: the last 50 signed deploys of each app, for rollback. |

Do not put secrets in the Compose file itself. It is stored and sent as written.

The files in `~/.zekno` are safe to read but are not believed as they stand. Every command
rebuilds the team from the signed team lists, starting from the team code in the keychain, and
checks each secret and each history entry against it. A file changed by something other than
`zekno` is refused or ignored, never signed. The folder holds no command to run.

## Develop

```bash
bun test            # includes a run with a real container when Docker and caddy:2.11.9 are present
bun run typecheck
bun run compile     # dist/zekno, a single file (build.ts)
```

Commands never print. They call the `Ui` they are given (`src/ui/types.ts`): `src/ui/ink.tsx` at
a terminal, `src/ui/plain.ts` everywhere else. Tests use the plain one and an in-memory key
store, so they need no terminal and never touch the real keychain. What a key press does at the
hidden prompt is a pure function, `src/ui/secret-input.ts`.
