# Implementation Plan: CLI and Runner, Deploying Directly

**Branch**: `003-cli-runner` | **Date**: 2026-11-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-cli-runner/spec.md`

## Summary

Two small programs on top of `@workspace/core`. `apps/cli` (`zekno`) keeps the developer's key in
the OS keychain, holds the team list, secret records and deploy history in a profile folder, and
signs. `apps/runner` (`zekno-runner`) lives on the server, keeps the server key and its state in
a private folder, verifies with the core library and starts Docker Compose. The CLI reaches the
runner by running it and piping JSON to it: over SSH for a real server, or as a local process for
trying the product and for tests. The messages between them are defined in the core library.

## Technical Context

**Language/Version**: TypeScript 5 on Bun 1.4, ES modules

**Primary Dependencies**: `@workspace/core`; Bun's built-ins only (`Bun.secrets` for the OS keychain, `Bun.spawn` for SSH and Docker, `node:util` `parseArgs`). No new packages.

**Storage**: files. CLI profile under `~/.zekno` (or `ZEKNO_HOME`); runner home under `/var/lib/zekno` (or `ZEKNO_RUNNER_HOME`). The signing key is in the OS keychain, not in a file.

**Testing**: `bun test`. Runner tests run the runner as a separate process against a stand-in `docker`. CLI tests drive the commands in-process with an in-memory key store and a local runner process. One end-to-end test starts a real container when Docker is running and a suitable image is already present.

**Target Platform**: CLI on macOS, Linux and Windows with a system keychain. Runner on Linux servers with Docker and Compose; it also runs on macOS for local use.

**Project Type**: two command-line apps in the existing Bun workspace

**Performance Goals**: under 2 seconds added to a deploy on top of Docker's own time (SC-005)

**Constraints**: the runner opens no port; no decrypted secret on disk; no private key in a file on the developer's machine; state written atomically; one deploy at a time per server

**Scale/Scope**: one developer, a handful of servers and apps. About 10 source files per app.

## Constitution Check

| Principle | How this plan complies | Status |
|-----------|------------------------|--------|
| I. Security Promise First | Signing key only in the OS keychain, with no file fallback. Every check and cryptographic operation goes through the core library. The runner cannot be made to run anything by SSH access alone. No credentials in the repository; tests generate keys. | Pass |
| II. Honest Surface | Not a visitor-facing surface. Names follow the rule added in version 1.2.0: "runner", never "agent". The quickstart states that the design is unaudited. | Pass |
| III. Read the Installed Docs First | No framework code. `Bun.secrets`, Docker Compose and SSH availability were checked on the machine before design (research.md). | Pass |
| IV to VI | No UI. | N/A |
| VII. Verified Before Done | Typecheck and `bun test` from the root; an end-to-end run with a real container; an internal security review. | Pass |

No violations.

## Project Structure

### Documentation (this feature)

```text
specs/003-cli-runner/
├── plan.md, research.md, data-model.md, quickstart.md
├── contracts/commands.md     # CLI commands, runner commands, messages, exit codes
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/src/protocol.ts   # + the messages between CLI and runner

apps/runner/
├── package.json                # @workspace/runner, bin zekno-runner
├── src/
│   ├── main.ts                 # entry: one command per run, JSON in, one JSON line out
│   ├── commands.ts             # setup, sync, apply, status
│   ├── home.ts                 # the runner's folder: key file, state, lock, atomic writes
│   └── compose.ts              # starts Docker Compose with secrets in the environment
└── test/                       # runs the runner as a process against a stand-in docker

apps/cli/
├── package.json                # @workspace/cli, bin zekno
├── src/
│   ├── main.ts                 # entry: real keychain, real transports, Ink or plain output
│   ├── cli.ts                  # argument parsing and dispatch
│   ├── context.ts              # what commands are given; `openTeam` verifies the profile
│   ├── commands/               # init, server, secret, deploy, rollback, status
│   ├── profile.ts              # the profile folder: team lists, servers, secret store, history
│   ├── keystore.ts             # KeyStore interface; OS keychain; in-memory for tests
│   ├── transport.ts            # reach a runner: over SSH, or as a local process
│   └── ui/                     # how commands talk to the person
│       ├── types.ts            #   the `Ui` interface commands call
│       ├── ink.tsx             #   at a terminal: Ink (spinner, hidden prompt, tables)
│       ├── plain.ts            #   piped, `--json`, tests: plain lines
│       └── secret-input.ts     #   what each key press does to a hidden value (pure)
├── build.ts                    # compiles to one file, leaving out React's developer tools
└── test/                       # in-process commands against a real runner process
```

**Structure Decision**: two apps, because they are installed on different machines and must not
share anything but the core library and the message definitions. Each app keeps one seam for
what differs between production and tests: the CLI's key store, transport and interface are
passed in, and the runner's Docker command and home folder come from its environment.

Commands never print. They call the `Ui` they are given, so the same command draws with Ink at a
terminal and prints plain lines everywhere else. The runner has no interface: one JSON line.

## Complexity Tracking

No constitution violations to justify.
