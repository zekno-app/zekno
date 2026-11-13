# Implementation Plan: The Zekno Terminal App

**Branch**: `004-cli-app` (from `dev`) | **Date**: 2026-11-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-cli-app/spec.md`

## Summary

`zekno` with no arguments becomes a full-screen terminal app, drawn with Ink, that follows the
approved canvas: Home, one app, a deploy in progress, live logs, first run, add a server, set a
secret. To make that possible without a second copy of the logic, what each command does moves
into operations that both the single commands and the app call. The runner gains a session mode,
so one SSH connection carries several requests, and three read-only abilities: its version, what
is running, and a log stream. "Add a server" installs the runner by sending a fixed script that
downloads a GitHub release on the server and checks it against a SHA-256 the CLI carries. A
project remembers its app and server in `zekno.json`.

## Technical Context

**Language/Version**: TypeScript 5 on Bun 1.4.2, ES modules, JSX for Ink

**Primary Dependencies**: `@workspace/core`, `ink` 8.0.0, `react` 19.3.1, `zod` 4.6.7: all already in `apps/cli`. Bun built-ins: `Bun.YAML`, `Bun.spawn`, `Bun.secrets`. **No new packages.**

**Storage**: files, as in feature 003, plus `zekno.json` in a project folder. App state and logs are held in memory only.

**Testing**: `bun test`. Pure reducers and helpers by unit test; screens rendered to text with Ink's `renderToString`; operations against a real runner process and a stand-in Docker; one run with a real container; real-terminal behaviour in a pseudo-terminal.

**Target Platform**: CLI on macOS and Linux terminals. Runner on Linux x86-64 and ARM64 with Docker and Compose; also macOS for local use.

**Project Type**: two command-line apps and one library in the existing Bun workspace, plus one GitHub Actions workflow

**Performance Goals**: one SSH connection per single command (SC-006); a log line on screen within 3 seconds (SC-005); the first frame of the app drawn before any network call returns

**Constraints**: the runner opens no port and stays read-only in its new commands; nothing from a server reaches the terminal uncleaned; no secret value on disk, in arguments or in a frame; the app restores the terminal on every exit path; usable at 80×24

**Scale/Scope**: one developer, a handful of servers and apps. Seven screens, about 35 new source files across the three packages.

## Decisions made by the maintainer (2026-11-13)

| Decision | Choice |
|----------|--------|
| Interaction | Full-screen app for `zekno`; single commands stay |
| Deploy view | Summary panel, stage row, one live line |
| Project file | `zekno.json` |
| Components | Written for Zekno in `apps/cli/src/ui`; no component library |
| Logo | Solid pixel wordmark, three lines, in every app header and on first run |
| Scope | State, logs, runner install, project file and missing-value warning are all in |
| Release host | GitHub Releases on the public repository |
| Verification | SHA-256 values carried by the CLI; no signing key |
| One connection | Runner session mode |
| Release build | GitHub Actions on a version tag |
| New commands, non-root install, plain output, `--runner-file` | As proposed in this plan (confirmed 2026-11-14, below) |

## Design approvals

The seven boards of the canvas's fourth row (help, Home and one app at 80 columns, terminal too
small, Home on a light terminal, the two questions, the profile error) were approved by the
maintainer on 2026-11-14, with two decisions:

- A selected row is shown by the marker and bold text only, with no shaded bar, on every terminal.
- A `brand-darker` token (`#1a73d1`) is added to the design system. The CLI asks the terminal for
  its background colour at start and uses `brand` on dark and `brand-darker` on light, assuming
  dark when the terminal does not answer.

Confirmed by the maintainer on 2026-11-14, after reading this plan's proposals:

| Proposal | Decision |
|----------|----------|
| New single commands | `zekno logs`, `zekno link` and `zekno server update` are all added |
| A server user who is not root | The runner is installed in that user's home: `~/.local/bin/zekno-runner`, folder `~/.local/state/zekno` |
| Plain output | Both changes accepted: the secret count wording, and a state cell in `status` |
| `--runner-file` | Included, as a development-only option |

## Constitution Check

| Principle | How this plan complies | Status |
|-----------|------------------------|--------|
| I. Security Promise First | The signing key stays in the keychain only. The runner's new commands are read-only and a session runs the same checks as the one-shot commands. The runner that gets installed is checked against a value from the CLI, not from the download. Nothing depends on closed code; the release workflow is in the public repository. Every protection from the two earlier reviews is kept and re-tested (FR-039). | Pass |
| II. Honest Surface | The app shows "pre-alpha, unaudited". Docs and READMEs are brought in line with what exists (FR-042). "Runner", never "agent". Nothing on the website is changed to promise this before it is built. | Pass |
| III. Read the Installed Docs First | No Next.js code. Ink 8, `Bun.YAML` and Docker's output formats were read or run on this machine before design (research.md). | Pass |
| IV. One Design System | The terminal cannot use `packages/ui` components or CSS tokens. The CLI keeps one theme file whose brand colour is the `brand` token's value, named as such. Works on dark and light terminals by using the terminal's own text colour. | Justified deviation, below |
| V. Motion With Purpose | The only motion is a spinner while something is in progress. Nothing animates over SSH prompts. | Pass |
| VI. Accessible and Fast by Default | Every action has a key and the keys are on screen. No state by colour alone. Usable at 80×24. | Pass |
| VII. Verified Before Done | Typecheck, lint and tests from the root. The browser rule is met in its terminal form: each screen is run in a real pseudo-terminal and confirmed against the canvas by the maintainer (SC-007). Anything not checked is reported as not checked. | Pass |

## Project Structure

### Documentation (this feature)

```text
specs/004-cli-app/
├── plan.md, research.md, data-model.md, quickstart.md
├── contracts/
│   ├── commands.md       # CLI and runner commands, plain output, runner install, release workflow
│   ├── session.md        # the runner session protocol
│   └── app.md            # screens, keys, behaviour, and what still needs a design
├── checklists/requirements.md
└── tasks.md              # written by /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/protocol.ts        # + session, state, logs and version messages

apps/runner/src/
├── main.ts                          # + `session`, `version`
├── session.ts                       # new: read requests, write frames, one at a time
├── inspect.ts                       # new: what is running, log stream (read-only)
├── commands.ts                      # apply reports progress through a callback
├── compose.ts                       # Docker's output captured line by line
└── home.ts                          # default folder rule for a user who is not root

apps/cli/src/
├── main.ts                          # no arguments at a terminal → the app
├── cli.ts                           # + logs, link, server update; defaults from zekno.json
├── ops/                             # new: what each command does, without drawing anything
│   ├── deploy.ts, server.ts, secret.ts, status.ts, logs.ts
├── commands/                        # each is now an operation plus the Ui
├── session.ts                       # new: one connection, requests and frames; falls back for old runners
├── transport.ts                     # how the runner process is started (unchanged in spirit)
├── install.ts                       # new: the install script and its checks
├── runner-release.json              # new: version and SHA-256 values
├── project.ts                       # new: find, read and write zekno.json
├── compose-file.ts                  # new: values a Compose file expects
├── sanitize.ts                      # new: clean text that came from a server
├── ui/
│   ├── theme.ts, logo.ts            # new: colours and the pixel wordmark
│   ├── panel.tsx, stages.tsx, key-hints.tsx, select.tsx, text-input.tsx, confirm.tsx   # new
│   ├── ink.tsx, plain.ts, types.ts  # Ui gains a deploy view
│   └── secret-input.ts              # unchanged
└── app/                             # new: the full-screen app
    ├── app.tsx                      # root: alternate screen, size, routing
    ├── state.ts                     # pure reducer: screens, selection, keys
    ├── effects.ts                   # runs operations, feeds results to the reducer
    └── screens/                     # home, app, deploy, logs, welcome, add-server, set-secret

.github/workflows/runner-release.yml # new: builds and publishes runner releases on a tag

apps/web/content/docs/               # CLI and runner pages brought in line
```

**Structure Decision**: the same two apps and one library. The new split inside the CLI is
operations, presentation and app: operations know nothing about the terminal, so the single
commands, the app, the tests and later the desktop app all use the same ones.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|-----------|------------|--------------------------------------|
| Principle IV: the CLI has its own theme file and components, not `packages/ui` | A terminal draws character cells. It cannot render the shared React DOM components or read CSS tokens. | Importing token values from `packages/ui` at build time was considered; the CLI needs one colour from it, and a constant named after the token is clearer than a build step. |
