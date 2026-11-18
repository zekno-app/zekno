# zekno (CLI)

`zekno` deploys Docker Compose apps to servers you own. Secrets are encrypted and deploys are
signed on this machine. The [runner](../runner), a program on your server, checks every signature
before it decrypts or starts anything.

> **Pre-alpha and unaudited.** Built on [`@workspace/core`](../../packages/core). This program,
> the runner and the core library have had internal reviews only. Do not use it for anything you
> could not afford to lose, and do not rely on it in production before an external audit.

Run `zekno` alone at a terminal and a full-screen app opens. Everything the app does is also a
single command, for scripts.

An app is deployed from a Compose file you write, or from its settings in `zekno.app.json`, which
zekno turns into Compose text on this machine and signs. See [`zekno settings`](https://zekno.app/docs/settings#zekno-settings).

How to use it is in the docs: the [quick start](https://zekno.app/docs/quick-start) goes from a
checkout to an app running on your server, and [Commands](https://zekno.app/docs/cli) lists every
command with the page that describes it. This file is for people who build and test zekno.

## Build from source

zekno is not packaged for installation yet. It needs [Bun](https://bun.sh) 1.4.4, the version
pinned in the repository.

```bash
bun install                  # at the repository root
bun apps/cli/src/main.ts     # runs zekno from the checkout
cd apps/cli && bun run compile   # dist/zekno: one file, for the system you are on
```

Run from the checkout, zekno reads `.env` and `bunfig.toml` from the folder you start it in,
because that is how Bun runs a script, and a `bunfig.toml` can make it load other code first. The
runner it starts from `apps/runner` for `--local` does the same. So run it from source only inside
folders you trust, and use the compiled `zekno` anywhere else: it is built with both turned off,
and `test/compiled/compiled.test.ts` checks that it reads neither. Like any program built with Bun, the
compiled `zekno` still obeys three of Bun's own variables: `BUN_OPTIONS` (for example
`--preload <file>`, which runs that file first), `BUN_BE_BUN=1` (it then acts as Bun itself) and
`BUN_INSPECT` (it opens a debugger). Whoever can set them already controls your account.

From a checkout, `zekno server add --local` starts the runner from `apps/runner` next door. The
compiled `zekno` starts `zekno-runner` from your `PATH` instead.

A walk-through, with a runner on this machine, is in
[`specs/004-cli-app/quickstart.md`](../../specs/004-cli-app/quickstart.md).

## Develop

```bash
bun test            # includes a run with a real container when Docker and caddy:2.11.9 are present
bun run typecheck
bun run lint        # ESLint with typescript-eslint; any finding fails
bun run format      # Prettier, the repository's settings
bun run compile     # dist/zekno, a single file (build.ts)
```

Commands never print. They call the `Ui` they are given (`src/ui/types.ts`): `src/ui/ink/ink.tsx` at
a terminal, `src/ui/plain/plain.ts` everywhere else. What a command does lives in `src/ops/`, which the
app (`src/app/`) uses too. The app's keys are a pure reducer, `src/app/state/state.ts`, and what a key
press does at the hidden prompt is a pure function, `src/ui/parts/secret-input.ts`. Tests use the plain
interface and an in-memory key store, so they need no terminal and never touch the real keychain. `test/docs/docs.test.ts` checks that the pages of the docs name every command, flag
and key, and that they, this file and the root README name nothing that does not exist.

### Where the code lives

`src` holds `main.ts`, the entry point, and one folder per subject. Nothing else sits loose.

| Folder | What it holds |
|--------|---------------|
| `cli/` | Arguments and dispatch, what a command is given, errors |
| `commands/` | One file per command: what it draws and asks |
| `ops/` | What each command does, as data. The app uses these too |
| `asking/` | The questions single commands ask, and a first deploy from nothing |
| `secrets/` | Reading a file of secrets for import |
| `version/` | The version, the newer-release check, the runner release this build carries |
| `server/` | Reaching a server: transport, session, cleaning what a server says, the check script, and `install/`, the installer |
| `project/` | `zekno.json`, the record of first use, reading the Compose file |
| `settings/` | An app's `zekno.app.json`: its reader, its writer, the Compose text it turns into, and which file a deploy uses |
| `templates/` | The templates `zekno add` adds: one file each in `files/` and the index that names them, their reader, the passwords made, what adding one changes, and the lines for a Compose file written by hand |
| `profile/` | The profile folder and the keychain |
| `shared/` | What both the app and single commands show: times, app views, deploy stages |
| `ui/` | Single commands: `ink/` at a terminal, `plain/` everywhere else, `parts/` and `terminal/` for what both draw with |
| `app/` | The full-screen app: `state/` (the reducer, by screen), `effects/` (what it does outside its state), `screens/` |

Imports point one way: nothing outside `app/` imports `app/`, `ops/` imports nothing that draws,
and `test/layers/layers.test.ts` fails when a file breaks that. Tests sit in folders of the same
names under `test/`, with `test/support/` for stand-ins and `test/scenarios/` for tests that cross
subjects.

## End-to-end tests

Tests of the full-screen app as a person uses it: `zekno` runs in a real pseudo-terminal, and an
agent presses keys toward a goal written in the words on the screen ("deploy this folder", "roll
back to deploy 1"). After each goal the test checks exactly what the screen shows and what really
happened: what the stand-in Docker was asked to run, what the runner accepted, which files were
written. They use the [e2e](https://www.npmjs.com/package/e2e) test runner with the AI SDK, and
Claude Sonnet 5.5 through the Vercel AI Gateway.

```bash
cd apps/cli
bun run test:e2e          # every end-to-end test but the real-Docker one
bun run test:e2e:docker   # one real container; skipped when Docker or caddy:2.11.9 is missing
```

Neither is part of `bun run test`, and neither runs in turbo's `test` task.

**They cost money.** Each model call is billed to whoever owns the key. A run from an empty replay
cache made 38 model calls, about $0.15 (2026-11-14). A goal that passed is recorded in
`.e2e/cache/` and replayed with no model call while its screens stay the same, so a second run
makes none. `.e2e/` is output (`apps/cli/.gitignore`); whether to commit the replay cache is open.

**The key** goes in `apps/cli/.env.local` as `AI_GATEWAY_API_KEY=...`. Git ignores it. Only the
test runner reads it, through `--env-file` in the two scripts; `bun test` does not load
`.env.local`. Nothing the tests start sees it: the app, the runner and the stand-ins get an
environment built from an allow-list (`tests/support/world.ts`). Without the file, a goal for the
model fails at its first model call, unless the replay cache has it; the tests with no goal pass
as before.

**What is sent to the model:** the goal and its parameters, the test's title, the agent's
instructions in `e2e.config.ts`, and the screen as a tree of its lines. Only test data is ever on
that screen: a member `ada`, servers `prod` and `staging`, apps `demo` and `api`, example
addresses, made-up values. The app runs with a temporary home folder, so paths show as `~`. A
secret value is never sent: the model gets its name, and the runner types it into the hidden
prompt.

**What the model can do:** press keys and type text in the app's terminal, nothing else. It has
no tool that runs a command, reads a file or reaches the network. The app it drives is a test
build (`tests/support/zekno-test.ts`) that cannot do harm whatever is typed: a key store file in
the test's temporary folder instead of the keychain, temporary folders for the profile, the
project and the runner, the stand-in Docker, and SSH that reaches only the stand-in server of
`test/support/stand-in-server.ts`. Without one, any SSH destination fails closed; no `ssh` is ever
started.

How it fits together: `tests/support/engine.ts` is the e2e engine, `terminal.ts` the
pseudo-terminal, `screen-model.ts` the screen it reads, and `screen-tree.ts` the tree the runner
and the model see. Each test sets its world up with exact steps (`tests/support/world.ts`) and
opens the app on the screen it is about. The screen model has its own unit tests in
`test/e2e/e2e-screen-model.test.ts`, which `bun test` runs.

## Screens for the docs

The docs and the root README show screens of zekno drawn from the real program, never by hand. Each
screen has a recipe, `test/screens/recipes/<name>.ts`, which sets up the stand-ins of
`test/support`, runs the real command or opens the real app, and returns what the terminal shows,
with the screen's title, command, size and description.

```bash
bun run screens            # draws every screen, writes the files and the README's picture
bun run screens --check    # writes nothing, names each screen that differs, exits 1 if any does
bun run screens home       # one screen (or several, by name)
```

| File, from the repository's root | What it is |
|------|------------|
| `apps/cli/test/screens/recipes/<name>.ts` | How one screen is drawn |
| `apps/web/content/screens/<name>.json` | The stored screen, which a page of the docs shows with `<Screen name="<name>" />` |
| `.github/assets/screen-home.svg` | The root README's picture, made from `home.json` |

Each recipe runs in a process of its own, with colours on (`FORCE_COLOR=3`), `TZ=UTC` and a
temporary folder that is removed after it. It never reaches a real server, the network, the
system keychain or your own profile. A value that differs between runs, such as a code made from a
new key or a time read against the clock, is replaced by a rule in the recipe and listed under
`fixed` in the stored file, so two runs write the same bytes. `test/screens/screens.test.ts`, part
of `bun test`, fails and names each screen that differs from what the program prints, and fails
when the SVG differs from what `home.json` gives. The stored file's format is in
[`specs/013-docs-refresh/contracts/screens.md`](../../specs/013-docs-refresh/contracts/screens.md).

To add a screen: write `test/screens/recipes/<name>.ts` beside a recipe close to it, with example
values only (the app `shop`, the server `prod-1` at `203.0.113.7`), run `bun run screens <name>`,
read the stored file, and show it on its page with `<Screen name="<name>" />`. The page test in
`apps/web` fails while a stored screen is shown by no page.
