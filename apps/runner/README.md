# zekno-runner

The program that runs on your server. It is an ordinary command-line program, not an AI agent and
not a service: it opens no network port, and each run does one thing and exits.

The [CLI](../cli) runs it over SSH and pipes it one JSON message. The runner checks, with
[`@workspace/core`](../../packages/core), that a deploy was signed by your team, is addressed to
this server and is newer than the last one. Only then does it decrypt the secrets and start
Docker Compose. Having SSH access is not enough to make it run something: the signature is.

> **Unaudited.** See the note in the core library's README.

## Commands

| Command | Reads | Prints |
|---------|-------|--------|
| `zekno-runner setup` | the founding team list and the team code | this server's public key and its code |
| `zekno-runner sync` | newer team lists | `ok` or a refusal |
| `zekno-runner apply` | newer team lists and one deploy | `started`, `start_failed` or a refusal |
| `zekno-runner status` | nothing | versions and deploy numbers, never values |

Exit status: `0` done, `1` refused or the app did not start, `2` wrong usage.

## Its folder

`/var/lib/zekno`, or `ZEKNO_RUNNER_HOME`. Mode `0700`.

| File | What |
|------|------|
| `server.key` | This server's secret key. Mode `0600`. It never leaves the server. |
| `state.json` | The team list it trusts, the last deploy number per app and the latest version of each secret. |
| `apps/<app>/compose.yaml` | The Compose file of the last accepted deploy. |

Decrypted secrets are never written here. They are handed to Docker Compose through its
environment. Docker itself keeps a container's environment in its own configuration.

If `state.json` is damaged or incomplete, the runner refuses to act. It never treats a broken
file as "nothing accepted yet". It also refuses when the folder or the key file belongs to
another user, or can be read by anyone else.

It has no interface: one JSON line on standard output, and Docker's own output on standard error.

## Install on a server

```bash
# Here, in apps/runner. Build for the server's system, not your own
# (check with `ssh you@server uname -m`: x86_64 → bun-linux-x64, aarch64 → bun-linux-arm64).
bun build --compile --target=bun-linux-x64 src/main.ts --outfile dist/zekno-runner-linux-x64

# The file is about 80 MB; sent compressed it is about 27 MB.
xz -T0 -c dist/zekno-runner-linux-x64 | ssh you@server 'xz -d > /usr/local/bin/zekno-runner && chmod 755 /usr/local/bin/zekno-runner'
ssh you@server 'install -d -m 700 /var/lib/zekno && zekno-runner status'
```

The last command prints `{"outcome":"refused","reason":"not_set_up"}` on a fresh install. The
folder must belong to the user that runs the runner. `bun run compile` builds for the machine
you are on, which is only what you want when that machine is the server.

The server needs Docker with Compose. `ZEKNO_DOCKER` names the Docker command if it is not
`docker`.

## What to know before you rely on it

- **The first setup wins.** Until `zekno server add` has run, whoever can start the runner
  decides which team the server obeys. Install it and add the server in one sitting. If someone
  got there first, `server add` says the runner already belongs to a team.
- **The runner believes its environment.** `ZEKNO_RUNNER_HOME`, `ZEKNO_DOCKER` and `PATH` decide
  where its state lives and which program receives the secrets. Do not let a less-trusted user
  start it with their own environment: no `PermitUserEnvironment`, no `AcceptEnv ZEKNO_*`, no
  sudo rule that keeps those variables.
- **Signing a deploy is equal to root on the server.** A Compose file can mount anything Docker
  can reach. The signature decides who may do that; the runner does not limit what they deploy.
- **Docker's messages are passed back as they are.** An error from Docker can repeat a value
  that was filled in from a secret, such as a malformed port.

The review these come from is in
[`specs/003-cli-runner/security-review.md`](../../specs/003-cli-runner/security-review.md).

## Develop

```bash
bun test            # runs the runner as a real process against a stand-in docker
bun run typecheck
```
