# Quickstart: The Zekno Terminal App

How to check that this feature works. Details are in [contracts/](./contracts) and
[data-model.md](./data-model.md).

## Checks (repository root)

```bash
bun install
bun run typecheck
bun run lint
bun run test
```

## 1. The app on one machine

Needs Docker running. Uses a runner on this machine, so no server and no release is needed.

```bash
alias zekno="bun $(pwd)/apps/cli/src/main.ts"
export ZEKNO_HOME=$(mktemp -d)
mkdir -p /tmp/zekno-demo && cd /tmp/zekno-demo      # with a compose.yaml that expects GREETING
zekno
```

Expected, in order:

1. The first-run screen: the pixel logo, three steps, a question for your name.
2. After the name, "add a server". For this check choose the runner on this machine.
3. Home, with one server and no apps.
4. `d` offers to link the folder, lists `GREETING` as missing and asks for it without echo.
5. The deploy screen: summary panel, stages to Started, one live line. No Docker flood.
6. Home shows the app as running. Enter opens it; the history has deploy 1.
7. `l` shows its logs, following. `esc` returns.
8. Change the Compose file, `d` again, then select deploy 1 and press `r`: deploy 3 runs the
   first definition.
9. `q` closes the app and the terminal is as it was.

Clean up: `docker compose -p zekno-demo down`, and remove the `app.zekno.cli` keychain entry.

## 2. Single commands

In the same folder, after step 1:

```bash
zekno deploy                 # no flags: reads zekno.json; panel, stages, result line
zekno status                 # running or stopped per app
zekno logs --no-follow --tail 5
zekno deploy | cat           # plain line, no colour or symbols
zekno status --json | head -c 300
zekno deploy < /dev/null     # never asks; succeeds from zekno.json
```

## 3. A real server

Needs a Linux server with Docker and Compose, and either a published runner release or a
locally built runner.

```bash
zekno server add prod --ssh you@server                                  # with a published release
zekno server add prod --ssh you@server --runner-file apps/runner/dist/zekno-runner-linux-x64   # development
```

Expected: each step is listed as it completes, nothing is typed on the server, and the server
code is shown with what it is for. Then, from a linked folder, `zekno deploy` uses one SSH
connection (check with `ssh -v` or by timing against feature 003: about one connection's time
less on a distant server).

On a server set up in feature 003, `zekno status` still works and says the runner is out of
date; `zekno server update prod` brings it up to date.

## 4. What must still be true

```bash
bun test apps/cli/test/hardening.test.ts      # feature 003's security tests, unchanged
bun test apps/cli/test/journey.test.ts        # no key and no value in any file
```

## Limits to remember

- Unaudited. Do not use for anything you could not afford to lose.
- One developer on one machine. Teammates come with the control plane.
- State and logs are read from your server over SSH each time. Nothing is kept, and nothing
  passes through Zekno.
- Docker's messages are shown as they are and can repeat a value filled in from a secret.
- Installing the runner needs the server to reach GitHub. Otherwise install it by hand, as the
  runner's README describes.

## Results

To be filled in when the feature is implemented.
