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

In a folder whose `zekno.json` came from elsewhere, such as a cloned repository, one not signed by
your team is never used, and one a teammate signed is used once you say yes here:

```bash
zekno deploy                 # not signed by your team: stops with status 2, "zekno.json in <folder> is
                             # not signed by your team, ..." Nothing is sent.
zekno deploy < /dev/null     # signed by a teammate, not used here yet: stops with status 2 (S2)
zekno deploy                 # at a terminal: "Ada linked this folder to <app> on <server>. Use it here?"
zekno link                   # asks the same; y records it: "Accepted zekno.json: <app> on <server>, file <compose>."
zekno link --yes < /dev/null # the same from a script
zekno deploy                 # now reads it; a change to its bytes (a git pull) is asked about again
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

### A real server (2026-11-14)

Run by the assistant with the maintainer's go-ahead, at commit `eb6a65e`, against the
maintainer's own server: Linux x86-64, root over SSH (an SSH config alias, key in the agent),
Docker Compose 5.6.0. The server had no runner, no runner folder and no zekno container
beforehand. The CLI ran from the working tree with a throwaway team; its key was kept in a file
in a temporary folder instead of the system keychain, so the maintainer's keychain and
`~/.zekno` were not touched. One SSH connection to this server took about 2.4 to 2.9 seconds.

| Step | Result |
|------|--------|
| `zekno server add night --ssh <alias> --runner-file <linux-x64 runner>` | Pass, 18 seconds. The 82 MB file was sent, checked against its SHA-256 on the server and installed as root at `/usr/local/bin/zekno-runner` (mode 755); `/var/lib/zekno` was created with mode 700. Nothing was typed on the server. This is the root install the tests cannot cover. |
| `zekno secret set GREETING --stdin`, `zekno link`, `zekno deploy` with no flags | Pass. Deploy 1 ran; `printenv GREETING` in the container printed the value; the container publishes no port. |
| `zekno status`, `zekno logs --tail 3 --no-follow`, `zekno secret ls`, `zekno rollback` | Pass. Status showed `nightdemo deploy 11 running`; logs printed three `time<TAB>service<TAB>text` lines and ended by itself. |
| The app in a pseudo-terminal, 100 by 30 | Pass. Home showed `● running` 3.6 seconds after opening. Over the next 17 seconds of refreshes there was one SSH process, not one per refresh. `l` showed live log lines after 3.3 seconds (a second SSH process, as designed). `esc`, `q`: exit status 0 and no SSH process left. |
| A runner from feature 003 put in its place by hand | Pass. `zekno status` still worked, said the runner is from before 0.2.0 and named `zekno server update`, and showed the state as `unknown`. Deploys still worked. |
| The 0.2.0 runner put back | Pass. It carried on from the state the older runner had written (deploy 22). |
| `zekno secret rm GREETING`, `zekno deploy` | Pass. The variable was gone from the container. The value was in no file in the runner's folder, the profile folder or the project folder. |
| Clean-up | The container, its network, the image, both runner files and `/var/lib/zekno` were removed, and checked: nothing named zekno is left on the server. The throwaway key and profile were deleted. |

Time for one deploy of a changed definition (five each; the test container stops at once, so
Docker's stop timeout is not in these numbers):

| CLI | Runner | Connections | Seconds (five runs) | Mean |
|-----|--------|-------------|---------------------|------|
| Feature 003 (`536f24c`) | Feature 003 | 2 | 6.19, 5.76, 5.74, 5.67, 5.59 | 5.8 |
| This feature | 0.2.0, session | 1 | 3.99, 3.83, 3.77, 3.69, 4.00 | 3.9 |
| This feature | Feature 003 (no session) | 3 | 8.29, 8.10, 8.14, 8.06, 8.14 | 8.1 |

So a deploy is about 1.9 seconds faster than in feature 003 on this server, a little under one
connection's time (SC-009). Two things to know:

- Against a runner from before 0.2.0, this CLI is slower than feature 003 was (8.1 against 5.8
  seconds), because it first tries to open a session and then falls back to one connection per
  request. That lasts until the runner is updated.
- `zekno status` takes 3.3 seconds against 2.4 in feature 003. It is still one connection; it
  now also asks Docker what is running.

Not covered by this run: installing from a published release (none exists yet, so
`server add` without `--runner-file` and `zekno server update` could not be run against a real
server), a server reached as a user who is not root, an ARM64 server, and a server that asks for
a password.

### Walkthrough of every screen (2026-11-14)

T062, on the code of `eb6a65e` (the commit after it, `ac1db21`, changed only this file and
tasks.md). A Python driver ran each program in a pseudo-terminal: it read the terminal the whole
time in a `select` loop while it typed, set the window size with `TIOCSWINSZ`, answered the
terminal's background question (OSC 11, then DA1) as a dark terminal, or a white one for the
light board, and kept a small screen model with colours and attributes. Each screen was compared
as text and by its SGR codes. A frame drawn inside a synchronised update was read whole, as a
terminal shows it. The app ran as `main.ts` opens it, with an in-memory key store, the real
`detectBackground()`, the stand-in Docker of `apps/runner/test/helpers.ts`, and the stand-in
server and stand-in `ssh` of `apps/cli/test/stand-in-server.ts`. The stand-in's folder was first
on `PATH` before Bun started, and every run checked that `Bun.which("ssh")` was the stand-in
before anything ran. No real `ssh`, server or keychain was used.

The data followed the boards: team ada; prod reached as `deploy@203.0.113.7` through the stand-in
`ssh`, its runner installed by the installer from a stand-in release; staging, a runner on this
machine; demo with deploys 1 to 4 (3 a rollback to 1), api with 12 deploys, worker with 3 and
stopped; DATABASE_URL at version 3, SESSION_KEY set after deploy 4, GREETING removed; the folder
linked to demo on prod. Times, "team list v3", "this machine" under staging, "1 secret" for
deploy 4 and the paths of temporary folders differ from the boards for that reason and are not
counted below.

Each board was compared line by line at 100 by 30 and at 80 by 24, by resizing the window, and
once by opening at 80 by 24: every word, symbol, key hint and column, and what is bold, dim or
coloured. The logo is three lines on every screen that has it, "zekno" in the terminal's own
colour and ".app" in `38;2;35;131;226` on a dark terminal, `38;2;26;115;209` on a light one. A
selected row is the arrow and bold text. No background colour was set anywhere.

| Board | 100 by 30 | 80 by 24 |
|-------|-----------|----------|
| Welcome | Matches. | No board at 80. Same content; the blank lines inside the panel are left out. |
| AddServer | Matches in wording, symbols, colours and keys, but D5. Minor: D10, D12. | No board at 80. Nothing left out; the three steps of first run move into the body. Minor: D10. |
| Main (Home) | Differs: D1, D2. | Compared with Home80. |
| Home80 | Compared with Main. | Matches. |
| LightHome | Differs as Main: D1, D2. The marker, the focused border, ".app" and the action letters are `brand-darker`: by decision (tasks.md T003, design/README.md). | Matches Home80, with `brand-darker`. |
| App | Matches. Minor: D10, D11. | Compared with App80. |
| App80 | Compared with App. | Matches. Minor: D11. |
| Deploying | Matches. | No board at 80. Nothing left out. |
| Logs | Differs: D3. | No board at 80. "all services" is left out of the header, a choice made in logs.tsx. |
| SetSecret | Matches. | Matches. Minor: D10. |
| Questions | "Remember this folder?" matches. "The runner on prod is out of date" matches; it says "from before 0.2.0", as a runner of feature 003 does not report its version. The line on Home differs: D4. | Both questions as at 100. Minor: D14. |
| Help | Matches. | Matches; more descriptions wrap inside their columns. |
| TooSmall | At 70 by 20: matches. Back at 100 by 30 the same screen returned. | Not applicable. |
| ProfileError | Differs: D6. Minor: D10. | Matches with a short profile path. Minor: D13. |
| CmdDeploy | Success and failure match. | Success and failure match. |
| CmdOther | `secret ls` matches. The refused `secret set` matches and adds "Run zekno --help for the list of commands.", the usage hint every exit status 2 has (contracts/commands.md). `status` adds the secret lines of the status table in contracts/commands.md, and differs: D7. An unreachable server: the two lines match; above them is what SSH printed, after `remote:` (security-review.md C8), but D8. Piped: `secret ls \| cat`, `deploy --json` and `deploy --app demo --server prod < /dev/null \| cat` match. Differs: D9. | As at 100. |

**Unexplained differences.** None of these is recorded in contracts/app.md, contracts/commands.md
or the results above.

- D1. Home at 100 (Main, LightHome): the servers pane shows prod's address as `deploy@203.0.11…`.
  The board shows `deploy@203.0.113.7` whole. The pane is 22 columns and the address gets 16.
- D2. Home at 100 (Main, LightHome): the board draws "This folder is linked to demo on prod by
  zekno.json." with "demo" and "prod" in the normal text colour and the rest dim. The app draws
  the whole sentence dim: the terminal receives `ESC[2mThis folder is linked to demo on prod by
  ESC[22m`. home.tsx asks for the two names without dim inside a dim text, and Ink does not undo
  the outer dim.
- D3. Logs: the board shows "job 1842 failed: connection refused, retry in 5s" in red. The app
  draws every log line in the normal text colour.
- D4. Questions, the line on Home: the board shows `❯ prod ! runner 0.1.0` on one row. The app
  shows `❯ prod`, then `! old runner` on the line below, then the address. It says "old runner"
  because the runner does not report a version. The reason for the separate line (the servers
  pane is narrower than the board's) is only in a comment in home.tsx.
- D5. AddServer: the "Server code" panel never shows the code. When setup finishes the screen
  closes at once, and Home says "✔ Connected prod and added it to the signed team list. Server
  code MM4G-GPD7-M9VM-ACGJ-Y48R." without the sentence on what the code identifies. On the board
  the code appears in the panel, above "Identifies this server's key. Teammates compare it before
  they trust the server." (spec FR-013).
- D6. ProfileError: the board says "A team list in the profile is not the one this machine's key
  belongs to." The app says "The team list in the profile is not the one this machine's key
  belongs to.", the error's own sentence.
- D7. CmdOther, `zekno status` at a terminal: the line "  Asking prod…" stays above the answer, at
  100 and at 80 (Ink erases one line too few after it). The apps are listed worker, api, demo;
  the board, and Home, list demo, api, worker.
- D8. CmdOther, an unreachable server at a terminal: a word longer than the room left on a
  `remote:` line (here a path) is not broken by zekno, so the terminal wraps it and the rest
  starts at the left edge: `irectory` at 100 columns, `ine 19:` and `/home:` at 80.
  security-review.md C8 says such a line never goes on at the left edge.
- D9. CmdOther: the board shows `zekno deploy --app demo --server prod < /dev/null` printing the
  plain line "Deploy 5 of demo is running on prod with 2 secrets." With the terminal as standard
  output, the app draws the panel, the stage row and the result line. The plain line comes only
  when standard output is not a terminal either (`| cat`).

Minor:

- D10. A line the app wraps can start with a space: " next deploy." (App), " agrees to obey your
  team." (AddServer), " < file" (SetSecret at 80), " when they do not match." (ProfileError),
  " to accept it." (the line about a zekno.json not accepted here).
- D11. App and App80: the secret names start two columns in, room for the marker. The board has
  no such indent.
- D12. AddServer at 100, before the questions are answered: "○ Add the server to the signed team
  l…" is cut; at 80 it is whole.
- D13. ProfileError at 80 by 24 with a profile path that takes three lines: "If you restored the
  folder from a backup, restore the matching one." is not drawn. With a short path both closing
  lines show.
- D14. At 80 columns the place in the header of "set a secret" (opened with `s`) and of "Remember
  this folder?" is cut to "› prod › demo…", so the screen's own name is not shown.

**Flows walked**: 11 driver scripts, each run of the program in fresh temporary folders, 162
checks. 161 passed; the one that did not is the red sentence on standard error described under
"What looked wrong".

- First run: the welcome screen; "ada" typed; enter created the key in the in-memory key store and
  opened "add a server" at step 2. Destination and name typed. SSH was called in batch mode
  first; it would have asked, so the app left the alternate screen, wrote "SSH needs an answer to
  reach deploy@203.0.113.7. zekno carries on once it is connected.", and SSH's password question
  came up in line mode with echo. After the password the app took the terminal back (raw mode),
  a step held in progress was drawn as on the board, `o` showed the details, every step
  completed, and Home showed prod. Two `ssh` calls in all. `esc` on the welcome screen quits with
  nothing written.
- A deploy from Home: the summary panel, the stage row, one live line; `o` showed and hid
  Docker's output; `?` opened help and `esc` came back; `esc` left while it ran; "✔ demo is live
  on prod" arrived as a line on Home; Docker's `up` ran once.
- A failed start from the app screen: "✖ Starting", the sentence, "Number 6 is used, so the next
  deploy will be 7.", the "Docker said" panel; the history row "✖ did not start".
- Rollback from the app screen to the selected deploy 1, and from Home with `r`; each started.
- `q` during a deploy showed "waiting for deploy 9 to finish"; Ctrl-C did not cut it short; the
  app closed with status 0 once the deploy ended.
- A secret set through the hidden prompt: echo and line mode were off; while 18 characters were
  typed the terminal received 0 bytes and the screen did not change; the value, or any 3
  characters of it, was in nothing the terminal received during the run. Stored as version 1.
  Ctrl-C at the prompt went back to the name question and the app stayed open. A secret removed
  after "Remove API_TOKEN?" and enter.
- Missing values (two names): the list and the hidden prompt; `esc` back to the list; `esc` asked
  "Deploy demo to prod without 2 values?"; `n` said "Nothing was deployed." and Docker was not
  called; `d`, `esc`, `esc`, `y` deployed once, without the two names; both values set from the
  list, then the deploy carried them.
- "Remember this folder?": `esc` wrote nothing and deployed nothing; enter wrote exactly `app`,
  `server` and `compose` and deployed.
- A zekno.json not accepted here: the line "✖ zekno.json here names api on prod. It was not made
  or accepted on this machine. Run `zekno link` to accept it."; `d` on either pane deployed and
  asked nothing.
- A runner of feature 003 on prod: "! old runner" and `u update runner` on Home; `u` asked; `esc`
  left it; `u`, `u` replaced it on the stand-in server: "✔ Updated the runner on prod to 0.2.0.
  It matched the checksum this zekno holds."
- Logs: following; `f` paused ("● paused" in yellow) and resumed; `/` asked for a filter, enter
  kept it, `/` and `esc` cleared it; `1` and `2` showed one service, `0` all; `↑` `↓` scrolled; a
  log line's colour codes and an OSC 52 clipboard write never reached the terminal. With the logs
  session's runner killed: "✖ disconnected", "✖ The connection to prod ended." and `enter
  reconnect`; enter reconnected.
- `?` opened help on Home, App, Logs, the deploy screen and the list of missing values, and `esc`
  came back. Where a text question is open (welcome, add a server, the secret's name, the logs
  filter) `?` is typed into it, as contracts/app.md says for open questions. On the other
  questions and on ProfileError it does nothing.
- Too small: at 70 by 20 the message; `d` did nothing; back at 100 by 30 the same screen.
- Quitting: `q` from Home, help, logs and ProfileError; Ctrl-C from App and Home; `esc` from the
  welcome screen. Each time: status 0, the alternate screen left, the cursor shown, and
  `tcgetattr` on the pseudo-terminal showed `ICANON` and `ECHO` on again (both were off while the
  app ran).
- After every run `ps` showed no runner, stand-in `ssh`, stand-in Docker or entry process left.

**What looked wrong in a flow** (none of it breaks the contract):

- After adding a server where SSH must ask, Home at once marks it "✖ prod could not be reached"
  with "SSH needs an answer to reach deploy@203.0.113.7. zekno asks only when it starts and when
  you add or update a server, deploy or open logs, never in the background.", right under "✔
  Connected prod and added it to the signed team list." This follows app.md ("Reconnecting"), but
  the two lines read as a contradiction.
- Home's `r` said "Roll back to deploy 6" while deploy 6 had not started, and ran what deploy 6
  ran. That is the contract's "the one before the latest": every deploy the runner accepted
  counts, as in feature 003.
- After `r` on the app screen with deploy 1 selected, the marker stayed on the same row, which
  then showed deploy 2.
- With only standard output piped, a failed deploy's sentence on standard error (still the
  terminal) is red: Bun colours `console.error` on a terminal. With both piped there is no escape
  sequence.
- `zekno logs --no-follow` at a terminal: the service column widens when "worker" first appears,
  so the first lines do not line up with the rest.

**The compiled programs.** `bun run compile` in apps/cli wrote `dist/zekno`, 64,456,050 bytes
(61.5 MiB); in apps/runner it wrote `dist/zekno-runner`, 62,920,434 bytes (60.0 MiB); both Mach-O
ARM64 on this machine, Bun 1.4.2. `git status` showed nothing new: `dist` is ignored. The compiled
`zekno`, in a pseudo-terminal with an empty `ZEKNO_HOME` in a temporary folder and an `ssh` on
`PATH` that would only leave a mark: it asked the background question, opened the welcome screen
on the alternate screen, "ada" typed reached the name question, and `esc` closed it with status 0,
the terminal back in line mode with echo and the cursor shown. Nothing was written to
`ZEKNO_HOME` and `ssh` never ran. Enter was not pressed: the compiled program uses the real
keychain. `zekno --help` exits 0 with the list of commands. `zekno-runner version` prints
`{"version":"0.2.0","protocol":2}` and exits 0.

**Not checked**: a real terminal emulator (only the driver's screen model), real Docker, a real
server or `ssh` (see "A real server"), a host-key question, the compiled `zekno` past the name
(it would write to the real keychain), and `--tail` (the stand-in Docker ignores it).

#### Checks at the end

T064, from the repository root at `ac1db21` (no source change since `eb6a65e`), with
`--force` so nothing came from the cache:

- `bun run typecheck`: passed in all 5 packages that have it (core, ui, cli, runner, web), no
  error.
- `bun run lint`: passed in the 2 packages that have a lint script (ui, web), no warning.
- `bun run test`: 750 tests, all passed, none failed: core 88 (12 files), runner 80 (5 files),
  cli 554 (25 files), web 28 (3 files).

### After the walkthrough (2026-11-14)

The walkthrough ran on `eb6a65e`. Commit `ccffd32` then fixed these of its differences, each
with a test, and checked them again in a pseudo-terminal (27 of 27 checks):

- D1: Home at 100 columns shows the server's address whole.
- D2: the names in "This folder is linked to demo on prod by zekno.json." are in the text colour.
- D5: the add-server screen stays open when it finishes, with the server code in its panel
  above its sentence, until enter.
- D7: `zekno status` leaves no "Asking" line, and lists apps in Home's order.
- D8: a long `remote:` line never reaches the left edge.
- D9: with standard input not a terminal, a command prints plain lines.
- The failure sentence on standard error has no colour in plain mode.

Left for the maintainer, each a question of design:

- D3: the Logs board draws a failed line in red. The app draws every log line alike; Docker
  does not say which lines are errors.
- D4: the outdated-runner mark is on its own row under the server's name, not beside it.
- D6: the profile error screen says "The team list…", the error's own sentence; the board says
  "A team list…".
- Wrapped lines that begin with a space, the service column of `zekno logs` that widens when a
  longer name appears, and that `r` on Home goes back to the deploy before the latest even when
  that one did not start.
- After adding a server that needs a password, Home shows it as not reached until the app is
  opened again, because the app never asks for a password in the background.

Checks at the end, at `ccffd32`, run without the cache: typecheck 5 of 5, lint passes, tests
core 88, runner 80, cli 565, web 28, none failing.
