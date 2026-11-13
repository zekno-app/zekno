# Research: CLI and Runner

Checked on the development machine (macOS, Bun 1.4.2) on 2026-11-13.

## R1. Reaching the runner

- **Decision**: the CLI runs `zekno-runner <command>` on the server through `ssh` and pipes one
  JSON message to its standard input; the runner prints one JSON line and exits.
- **Rationale**: the developer already has SSH to their own server, with host verification. The
  runner needs no port, no daemon and no credentials of its own. `OpenSSH 10.3` is present.
- **Safety**: the destination and the runner's path are validated against a strict pattern and
  passed after `--`, so neither can be read as an SSH option or inject a shell command.
- **Alternatives considered**: a runner that listens on a port (an exposed service to secure, and
  it needs its own authentication); an SSH library (a dependency with nothing gained).

## R2. The signing key

- **Decision**: `Bun.secrets` (`get`, `set`, `delete`), which uses Keychain on macOS, libsecret on
  Linux and Credential Manager on Windows. Service `app.zekno.cli`, one entry per team.
- **Rationale**: design rule 2, with no dependency and no shelling out. Confirmed present in
  Bun 1.4.2.
- **Tests**: the CLI takes its key store as a parameter. Tests pass an in-memory one, so the
  suite never touches the real keychain. There is no environment switch that makes the shipped
  CLI store keys in a file.

## R3. Starting the app

- **Decision**: the runner writes the signed service definition to its folder and runs
  `docker compose -p zekno-<app> -f <file> up -d --remove-orphans`, with the decrypted secrets in
  that process's environment and nowhere else.
- **Rationale**: Compose reads `${NAME}` and pass-through `environment:` entries from its own
  environment, so no secret file is needed. Docker 29.6 with Compose v5.3 is present.
- **Reserved names**: the runner's own variables (`PATH`, `HOME`, `DOCKER_*`, `COMPOSE_*`) cannot
  be overridden by a secret. The CLI refuses to set such a name and the runner ignores one.
- **Limit**: Docker keeps a container's environment in its own configuration on the server. That
  is inherent to environment variables and is covered by "a compromised server is out of scope".

## R4. The server's key and state

- **Decision**: a folder with mode `0700`; `server.key` and `state.json` with mode `0600`. State
  is written to a temporary file and renamed. A lock file taken with exclusive create serialises
  runs.
- **Rationale**: FR-014, FR-020, FR-021. Rename is atomic on one filesystem, so an interrupted
  run leaves the old state intact.

## R5. Deploy numbers and secret versions

- **Decision**: before each deploy the CLI asks the runner for its status and uses one above both
  the runner's last number and the highest number this machine signed. Secret versions come from
  the CLI's own store.
- **Rationale**: the runner's memory decides what is accepted, but its answer alone is not
  enough: a runner restored from a backup would make the CLI sign a number twice, and a lying one
  could collect a deploy signed far in the future. Changed after the security review (C4).

## R6. Messages

- **Decision**: add `RunnerSetupRequest`, `RunnerSetupResponse`, `RunnerSyncRequest`,
  `RunnerApplyRequest`, `RunnerReport` and `RunnerStatus` to `packages/core/src/protocol.ts`.
- **Rationale**: FR-024. Both programs validate with the same strict schemas.

## R7. A real container in tests

- **Decision**: one end-to-end test uses real Docker when the daemon answers and the image
  `caddy:2.11.9` is already present; otherwise it is skipped with a message. It uses a unique
  project name and removes what it started.
- **Rationale**: SC-002 asks for a real container. Pulling an image during tests would make them
  slow and network-dependent, so the test only uses what is there.

## R8. Command-line parsing

- **Decision**: `parseArgs` from `node:util`.
- **Rationale**: built in, strict by default, enough for a dozen commands.

## R9. The terminal interface

- **Decision**: Ink (React for the terminal) draws the interface when the CLI runs at a terminal.
  Commands do not print; they call a small `Ui` interface, and a plain implementation of it is
  used when output is piped, with `--json`, with `TERM=dumb` and in tests.
- **Rationale**: the maintainer chose Ink for the CLI. Keeping it behind one interface means
  scripts get stable plain output, tests need no terminal, and the hidden prompt's key handling
  is a pure function that can be tested on its own.
- **Details that matter**: echo is switched off before the question is drawn; Ink is told not to
  handle Ctrl-C itself, because that left the command waiting for an answer; nothing is animated
  over SSH, which may ask for a password in the same terminal; React's developer tools are not
  part of the compiled program and the `DEV` variable that would enable them is hidden from Ink.
- **Alternatives considered**: plain `console.log` and a hand-written raw-mode prompt (the first
  version; the review found the prompt mishandled pastes and control keys). A prompt library
  beside Ink (two ways of owning the terminal).

## R10. Where trust comes from on the developer's machine

- **Decision**: the profile folder holds only signed things, and no copy of the team's trust. The
  keychain entry holds the signing key and the founding list's confirmation code. Each run
  rebuilds trust from the lists and that code.
- **Rationale**: the folder is ordinary files that may be synced, shared or restored. A stored
  copy of trust is exactly what an attacker would edit (security review, C1). The keychain is the
  one place on the machine the design already relies on.
