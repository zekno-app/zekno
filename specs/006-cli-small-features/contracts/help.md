# Help Contract: the changes to `HELP`

`HELP` in `apps/cli/src/cli.ts` is what `zekno --help`, `zekno -h` and `zekno help` print, and
`apps/cli/test/docs.test.ts` reads its usage lines to check that both docs pages name every command
and flag. It is the one plain output of an existing command that changes in this feature, on
purpose: it lists the new commands (FR-030). Scripts do not read it.

## The new text

```text
zekno: deploy to your own servers. Secrets are encrypted and deploys are signed on this machine.

  zekno init --name <you>
  zekno server add <name> --ssh <user@host> [--runner-path <path>]
  zekno server add <name> --ssh <user@host> --runner-file <path>  (development only)
  zekno server add <name> --local [--home <dir>]
  zekno server update <name> [--yes]
  zekno server ls
  zekno secret set <NAME> [--app <app>] [--server <name>] [--stdin]
  zekno secret import <file> [--app <app>] [--server <name>] [--yes]
  zekno secret rm <NAME> [--app <app>] [--server <name>]
  zekno secret ls [--app <app>] [--server <name>]
  zekno deploy [--app <app>] [--server <name>] [-f <compose file>] [--json]
  zekno rollback [--app <app>] [--server <name>] [--to <number>] [--json]
  zekno status [--server <name>] [--json]
  zekno logs [--app <app>] [--server <name>] [--tail <n>] [--no-follow]
  zekno link [--app <app>] [--server <name>] [-f <compose file>] [--force] [--yes]
  zekno doctor [--server <name>] [--json]
  zekno version [--json]
  zekno --version [--json]

In a folder linked with `zekno link`, --app, --server and -f come from its zekno.json. Flags win over it.
At a terminal a command asks for a server or an app it was not given, and `zekno deploy` sets up what a first deploy needs. In a script it asks nothing.
```

Changed from today: the lines `zekno secret import ...`, `zekno doctor ...`, `zekno version ...` and
`zekno --version ...`, and the last paragraph's second line. Every other line is as it was.

## What else changes with it

- `WORDS` in `cli.ts`: `"secret import": 3`, `doctor: 1`, `version: 1`.
- `parseArgs` options: `version: { type: "boolean" }`. No other new option: `doctor` takes the
  existing `--server` and `--json`; `secret import` the existing `--app`, `--server` and `--yes`.
- `apps/cli/test/docs.test.ts`: the usage line `zekno --version [--json]` has no command words, so
  `commandsOf` files its flags under the empty command `""`. The flags `zekno` alone may take become
  `HELP_FLAGS` plus those of `""`, so `zekno --version` in the docs is not reported as a wrong flag;
  `zekno version` is an ordinary command. The test that `--help`, `-h` and `help` print `HELP` stays.
- Both docs pages (`apps/cli/README.md`, `apps/web/content/docs/cli.mdx`) show the same list in
  their "Commands" section, in the same task that changes `HELP`, so `docs.test.ts` stays green.
