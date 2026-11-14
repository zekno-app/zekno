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

In a folder whose `zekno.json` came from elsewhere, such as a cloned repository, nothing uses it
until this machine accepts it:

```bash
zekno deploy                 # stops with status 2: "zekno.json in <folder> names <app> on <server>.
                             # It was not made or accepted on this machine. ..." Nothing is sent.
zekno                        # Home opens without selecting its app and says the same; d deploys nothing
zekno link                   # checks it (server connected, Compose file inside the folder) and
                             # accepts it as it is: "Accepted zekno.json: <app> on <server>, file <compose>."
zekno deploy                 # now reads it; an edit to zekno.json (or a git pull) needs zekno link again
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

### User Story 1: operate servers and apps from one screen (2026-11-14)

**Automated**: `bun test apps/cli/test/app-operate.test.tsx`: Home, the app screen, the deploy
screen and "set a secret" rendered at 100 columns with their boards' wording, symbols and keys
(and within 80 by 24); deploy, a failed start, leaving and quitting during a deploy, rollback
from the app screen and from Home, setting and removing a secret, and an unreachable server
beside a slow one, each driven through the reducer and the effects against a real runner process
with the stand-in Docker. The typed secret value was looked for in the state and in every frame
drawn while it was typed, and in every file of the profile folder; it was in none.

**Walked through in a pseudo-terminal** (100 by 30, a Python driver reading the terminal the
whole time, an in-memory key store, a runner on the same machine with the stand-in Docker,
nothing over SSH), 35 checks, all passed:

- Home opened on an existing team with one server and one deployed app, after the switch to the
  alternate screen; the server was marked as answering. Arrows and tab moved between panes and
  rows.
- Enter opened the app screen with its history. `d` opened the deploy screen with the summary
  panel and the stage row, and said that leaving does not cancel. With Docker held mid-deploy,
  `esc` returned to the app screen; once Docker was let go, "✔ demo is live on dev in …" arrived
  there as a line and the history showed deploy 2.
- Selecting deploy 1 and pressing `r` ran deploy 3 from "what deploy 1 ran", to Started; the
  history then read "a rollback to 1".
- `s`, a name, then the hidden prompt: the terminal's echo flag was already off when "hidden as
  you type" first appeared. The value, typed one key at a time, never appeared in anything the
  terminal received; it was stored as version 1 and marked as set after the latest deploy. A
  pasted value of two lines was refused with the pointer to `--stdin`, and nothing of the paste
  was drawn. Ctrl-C at the prompt went back to the name question and the app stayed open.
- `q` closed the app: it left the alternate screen, showed the cursor again, echo and line
  editing were back on, raw mode was off, and the exit status was 0.

**Not checked**:

- Anything over SSH. No real server was used. Until the SSH hand-over (T032) exists, a server
  that needs a password or a host-key answer makes SSH ask on the terminal while the app is
  drawn, and the status check that runs when Home opens can cause that without a key press.
- Home and the app screen at 80 columns as their boards draw them (T053): at 80 columns Home
  leaves out the details pane, and nothing else was arranged.
- Colours: tests draw without colour, and the walkthrough did not inspect colour codes, the
  struck-out name of a removed secret, or a light terminal.
- Resizing the window during the walkthrough, and real Docker.
- Running state (shown as "unknown"), logs, missing values and the linked folder belong to later
  stories.

### User Story 2: from nothing to a running app without leaving the app (2026-11-14)

**Automated**: `bun test apps/cli/test/install.test.ts apps/cli/test/first-run.test.tsx`.

- The install script itself (`install.test.ts`), run with `/bin/sh` and with `/bin/dash` in a
  temporary home, against stand-in `uname`, `curl`, `wget`, `docker`, `sha256sum` and `id` first on
  PATH (never the network, never root): a fresh install as a user who is not root lands at
  `~/.local/bin/zekno-runner` with mode 755 and the folder `~/.local/state/zekno` with mode 700,
  and the same connection then carries the runner's session; ARM64 gets its own file; a runner
  already at this version is kept and nothing is downloaded; an older runner, or one that does
  not say its version, is used as it is and never replaced; no Docker; Docker without Compose; an
  unsupported processor; a system that is not Linux; no published checksum for the processor; a
  download that fails; a checksum that does not match (nothing installed, nothing left in the
  temporary folder); a redirect to plain HTTP followed by neither curl nor wget; wget following
  an HTTPS redirect hop by hop; no `sha256sum` or `shasum`; `--runner-file` sent after `ready` and
  checked on arrival, and a file changed in transit; a runner that installs but does not answer
  with this version; `update` replacing an older runner in place, leaving a current one, and
  saying when there is none; words that do not fit, refused by the script itself.
- For each of the four values placed into the script (version, architecture, SHA-256, runner
  path), inputs with shell syntax, a line break, quotes, backquotes, `$(...)` and a leading dash
  throw before anything is placed, and a recording transport shows no script was started. The
  script's source holds no `${` and no backquote. Its lines are read strictly and in order.
- The app (`first-run.test.tsx`), through the reducer and the effects: the first-run screen with
  its board's wording at 100 by 30 and within 80 by 24; the key created by the same operation as
  `zekno init`, in the in-memory key store and in no file; a keychain that refuses; from no
  profile to a connected runner on this machine (typed as `this machine`); from no profile to
  Home over a stand-in `ssh`, with every step and what was found, the runner installed and
  checked, and one SSH connection for all of it; the board drawn while the runner is set up; a
  failed step marked with the details kept for another try; `o` showing what the server printed;
  a runner set up for this team by an earlier attempt carried on from; a runner of another team
  stopping it with nothing changed on either side; an older runner reported, marked on Home with
  `u` in the hints, the question drawn as on its board, `esc` leaving it alone, and `u`, `u`
  updating it by the same verified route.
- SSH questions: the decision is a pure function (SSH's status 255 before any answer, with
  "Permission denied" or "Host key verification failed"); batch mode first, the terminal handed
  over and the request sent again only when SSH would ask, taken back at the first answer, for
  adding a server and for Home's status check; never handed over with a key that needs nothing
  typed; one hand-over at a time.
- `zekno server add --ssh` installing from a release, stopping with the "no published runner"
  sentence and changing nothing when there is no checksum and no runner, `--runner-file`, and
  `zekno server update` asking at a terminal, needing `--yes` without one, never updating unasked,
  and saying when the runner is already current.

**Walked through in a pseudo-terminal** (100 by 30, a Python driver reading the terminal the whole
time, an in-memory key store, a stand-in server with the stand-in Docker and a stand-in `curl`
serving the real runner as a "release", and a stand-in `ssh` that fails in batch mode and
otherwise asks for a password on the terminal). The final driver has 30 checks and passed all
of them in each of its last 9 runs, the last 3 on the code as committed; the 8 runs before
those, with 28 of the checks, passed too:

- First run on the alternate screen: the logo, the three steps, the name question and where the
  key is kept. After the name: "add a server" with step 2 current and the team code.
- The destination and the name, then the hand-over: the app left the alternate screen, the note
  "SSH needs an answer to reach deploy@example.test. zekno carries on once it is connected." and
  SSH's question appeared on the normal screen, nothing was drawn over the question for a second,
  and the terminal was in line mode with echo for SSH. After the password the app took the
  terminal back (raw mode again), every step completed, and Home showed prod.
- `q`, then the app opened again on Home: its status check handed the terminal over the same way,
  and after the password Home marked prod as answering. `q` closed it; the process exited with
  status 0; echo, line editing and the cursor were back.
- SSH was called in batch mode first each time; the installer's connection carried the session,
  so adding the server took one connection (two with the hand-over); the runner was installed
  with mode 755; the profile keeps `~/.local/bin/zekno-runner`.
- In 2 of those 17 runs, the line typed for SSH reached zekno instead (a read the app had already
  started). The app said so at once ("That line reached zekno instead of SSH, and zekno threw it
  away. Type it again."), the driver typed it again as a person would, the flow went on, and
  nothing of that line acted as a key in the app. Before that was handled, it left SSH waiting.

**Not checked**:

- A real server, a real `ssh`, a real download from GitHub, and real `curl` or `wget` behaviour on
  redirects: the stand-ins act as curl (with `--proto-redir =https`) and GNU wget 1.25 (checked
  against a local server) are documented to.
- The release workflow: it cannot run here. `bun build --compile` for Linux needs a download.
- Colours, resizing during the walkthrough, and a host-key question (the stand-in asks only for
  a password; the hand-over is the same).
- The terminal's background question: with `detectBackground()` before the app opens, no key
  reached the app in a pseudo-terminal (at commit `bacf938` too). The walkthrough gave the
  background as dark, as User Story 1's did. Reported for the maintainer.
