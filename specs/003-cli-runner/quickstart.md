# Quickstart: CLI and Runner

## Checks (repository root)

```bash
bun install
bun run typecheck
bun run test
```

## Try it on one machine

Needs Docker running. Uses a runner on this machine instead of SSH.

```bash
alias zekno="bun $(pwd)/apps/cli/src/main.ts"
export ZEKNO_HOME=$(mktemp -d) RUNNER_HOME=$(mktemp -d)

zekno init --name Ada
zekno server add dev --local --home "$RUNNER_HOME"

mkdir -p /tmp/zekno-demo && cd /tmp/zekno-demo
cat > compose.yaml <<'YAML'
services:
  web:
    image: caddy:2.11.9
    command: ["sh", "-c", "echo started; sleep 3600"]
    environment:
      - GREETING
YAML

printf 'hello from zekno' > greeting.txt
zekno secret set GREETING --app demo --server dev --stdin < greeting.txt   # or leave out --stdin and type it
rm greeting.txt
zekno deploy --app demo --server dev
zekno status --server dev
docker compose -p zekno-demo exec web printenv GREETING     # hello from zekno
docker compose -p zekno-demo down                            # clean up
```

`zekno init` stores a signing key in your system keychain under the service `app.zekno.cli`.
Remove it there when you are done trying things out.

Read a secret from a file or type it at the prompt. `echo value | zekno …` leaves the value in
your shell's history.

At a terminal the CLI draws its interface with Ink. Piped or with `--json` it prints plain lines.

## A real server

```bash
# In apps/runner. The runner must be built for the server, not for your machine:
bun build --compile --target=bun-linux-x64 src/main.ts --outfile dist/zekno-runner-linux-x64    # or bun-linux-arm64
# The file is about 80 MB. Sent compressed it is about 27 MB:
xz -T0 -c dist/zekno-runner-linux-x64 | ssh you@server 'xz -d > /usr/local/bin/zekno-runner && chmod 755 /usr/local/bin/zekno-runner'
ssh you@server 'install -d -m 700 /var/lib/zekno && zekno-runner status'    # {"outcome":"refused","reason":"not_set_up"}

zekno server add prod --ssh you@server
zekno secret set DATABASE_URL --app web --server prod
zekno deploy --app web --server prod
```

The server needs Docker with Compose, and a folder the runner can write to
(`/var/lib/zekno`, or set `ZEKNO_RUNNER_HOME`), owned by the user that runs it.

Install the runner and run `server add` in one sitting. Until a runner is set up, whoever starts
it first decides which team it obeys.

## Limits to remember

- Unaudited. Do not use for anything you could not afford to lose.
- One developer on one machine. Teammates come with the control plane.
- Over SSH, you are relying on SSH's host verification. The confirmation codes are shown so the
  steps are the same ones used later, when a control plane sits in the middle.
- Docker keeps a container's environment in its own configuration on the server.
- Signing a deploy is equal to root on the server, because Docker is.
- The runner believes its environment. Do not let anyone start it with their own
  `ZEKNO_RUNNER_HOME`, `ZEKNO_DOCKER` or `PATH`.

## Results

Recorded 2026-11-13 on macOS, Bun 1.4.2, Docker 29.6.1 with Compose v5.3.0.

| Check | Result |
|-------|--------|
| `bun run typecheck` (repository root) | Pass, 5 workspaces |
| `bun run test` (repository root) | Pass: core 86, runner 16, CLI 50, web 28 |
| "Try it on one machine", run as written (after the security fixes) | Pass. The signing key and team code went into the macOS Keychain as one entry, the container started, and `printenv GREETING` inside it printed `hello from zekno`. A second deploy and a rollback followed: deploy 3 ran the first definition again. No key and no value was in any file. The container, the keychain entry and the folders were removed afterwards. |
| Real container through CLI and runner (automated) | Pass. About 300 ms from command to "started" (SC-005 allows 2 s on top of Docker). |
| No key or secret value in any file written (SC-004) | Pass, automated and checked again after the manual run |
| Both programs compile to single files | Pass: `dist/zekno` and `dist/zekno-runner`, about 64 MB each. The compiled CLI was run at a terminal and piped. |
| Ink interface in a pseudo-terminal | Pass. The whole journey, with the secret typed at the hidden prompt: the value reached the app and never appeared in the terminal's output, and echo was already off when the question appeared. Pastes, backspace, arrow keys, Ctrl-C and Escape behave as the contract says. |
| "A real server" over SSH | Pass, run by the maintainer on 2026-11-13 against a Linux x86_64 server with Docker Compose v5.6.0, reached through an SSH config alias, with the Ink interface at a real terminal. In order: `init`, `server add`, `secret set` at the hidden prompt, `deploy` (deploy 1; `printenv GREETING` in the container printed the typed value), a changed definition (deploy 2), `rollback` (deploy 3, the first definition again), `secret rm`, `deploy` (deploy 4 with no secrets), `status`. Checked on the server afterwards: the variable is gone from the container, the runner reports deploy 4 and `GREETING` version 2 as removed, and the value is in no file in the runner's folder or in the profile folder. A hand-made `apply` request sent over the same SSH access was refused with `invalid_request`. |
| Security review | No finding rated high or critical. Four medium and six low findings fixed; see [security-review.md](./security-review.md) |
