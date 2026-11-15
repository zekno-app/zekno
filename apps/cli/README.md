# zekno (CLI)

`zekno` deploys Docker Compose apps to servers you own. Secrets are encrypted and deploys are
signed on this machine. The [runner](../runner), a program on your server, checks every signature
before it decrypts or starts anything.

> **Pre-alpha and unaudited.** Built on [`@workspace/core`](../../packages/core). This program,
> the runner and the core library have had internal reviews only. Do not use it for anything you
> could not afford to lose, and do not rely on it in production before an external audit.

Run `zekno` alone at a terminal and a full-screen app opens. Everything the app does is also a
single command, for scripts.

## Status and limits

- **One developer on one machine.** Teammates arrive with the control plane, which is not
  written yet.
- **SSH is the route.** zekno talks to the runner directly, over SSH. No Zekno service is
  involved.
- **Only `zekno version` reaches the network on its own:** it asks GitHub once for the newest
  release, and sends nothing about you.
- **State and logs come from your server.** Whether an app is running, and its logs, are read
  from the runner over SSH when you look. They never pass through Zekno, and this machine keeps
  none of it.
- **The runner comes from a release.** `zekno server add` installs on a server the one runner
  version this build of zekno carries, and only when it matches the checksum this build holds. A
  zekno built from `main` installs a prod release, such as `0.1.0`; one built from `dev` installs
  a development release, such as `0.1.0-dev.1`. See [Installing the runner](#installing-the-runner).
- **The first runner release is 0.1.0.** A zekno built from `main` holds its checksums and
  installs it on a server by itself. Between a release being started and its second build, a
  zekno built from that branch holds no checksums and says it has no published runner to install.
- **Docker's messages are shown as they are.** An error from Docker can repeat a value that was
  filled in from a secret.
- Made for macOS and Linux with a system keychain. Windows is not tested.

The internal reviews say what was checked and what was not:
[`specs/003-cli-runner/security-review.md`](../../specs/003-cli-runner/security-review.md) and
[`specs/004-cli-app/security-review.md`](../../specs/004-cli-app/security-review.md).

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
and `test/compiled.test.ts` checks that it reads neither. Like any program built with Bun, the
compiled `zekno` still obeys three of Bun's own variables: `BUN_OPTIONS` (for example
`--preload <file>`, which runs that file first), `BUN_BE_BUN=1` (it then acts as Bun itself) and
`BUN_INSPECT` (it opens a debugger). Whoever can set them already controls your account.

From a checkout, `zekno server add --local` starts the runner from `apps/runner` next door. The
compiled `zekno` starts `zekno-runner` from your `PATH` instead.

A walk-through, with a runner on this machine, is in
[`specs/004-cli-app/quickstart.md`](../../specs/004-cli-app/quickstart.md).

## The app

`zekno` with no arguments, at a terminal, opens a full-screen app. Without a terminal (piped, in a
script, or with `TERM=dumb`) it prints the help and exits with status 2.

The window must be at least 80 columns by 24 lines. In a smaller one the app asks for a larger
window, and comes back to the same screen when there is room. Each screen lists its keys on its
last line. When you quit, the terminal is left as it was, also after an error.

| Screen | Opens from | Shows |
|--------|------------|-------|
| Home | Start, when a team exists | Servers; the selected server's apps with deploy number, state and when; the selected app's details and actions; whether this folder is linked |
| App | `enter` on an app | Deploy history; secrets by name and version; the selected deploy's details; a note when a secret is newer than the running deploy |
| Deploy | `d`, or `r` | Summary panel, stage row, one live line; Docker's output on `o` and on failure |
| Logs | `l` | Time, service, text; following or paused |
| First run | Start, when no team exists | The logo, the three steps (your key, a server, a first deploy), the name question |
| Add a server | `a` on Home, or step 2 of first run | The destination and name, each step as it completes, the team code and the server code with what each is for. Once done it stays, every step ticked and the server code shown, until `enter` goes to Home |
| Set a secret | `s`, or before a deploy when values are missing | The names that are missing, the hidden prompt |
| Help | `?` | Every key of the app, in groups |

A profile that does not verify opens an error screen with the reason instead of Home. Only `q`
and `ctrl-c` work there.

### Keys

| Key | Where | Does |
|-----|-------|------|
| `↑` `↓` | Lists, logs | Move the selection, or scroll |
| `←` `→`, `tab` | Home, App | Move between panes |
| `enter` | Lists, questions | Open, or confirm. On a secret, set its new value. On Logs after the connection dropped, connect again. On Home, on a server marked `!` (SSH needs an answer), connect to it so SSH can ask. On Add a server once it is done, go to Home with the new server selected |
| `esc` | Everywhere but Home | Go back. On Deploy, the deploy carries on. At the hidden prompt before a deploy, back to the list of missing values; on that list, the question "deploy without them?" |
| `d` | Home, App | Deploy this folder (see [Deploying from the app](#deploying-from-the-app)) |
| `r` | Home, App | Roll back: on App to the selected deploy, on Home to the one before the latest |
| `l` | Home, App | Logs |
| `s` | Home, App | Set a secret |
| `x` | App, secrets pane | Remove the selected secret, after a confirm |
| `a` | Home | Add a server |
| `u` | Home, on a server marked `! older runner` | Update the runner, after a confirm |
| `o` | Deploy, Add a server | Show or hide the full output |
| `f` | Logs | Pause or resume following |
| `/` | Logs | Filter by text; `esc` clears it |
| `1` to `9` | Logs | Show one service; `0` shows all |
| `?` | Everywhere but the profile error screen | Help for this screen |
| `q` | Everywhere but a question | Quit. Waits for a deploy in progress |
| `ctrl-c` | Everywhere | As `q`. In the hidden prompt it cancels the prompt only |

A key that does nothing on the current screen is ignored. While a text question is open, letter
keys type into it.

### Questions

| Question | Asked | Answers |
|----------|-------|---------|
| Remove `NAME`? | `x` on a secret | `enter` removes it, `esc` cancels |
| The runner on `<server>` is out of date | `u` | `u` updates now, `esc` leaves it for later |
| `<member>` linked this folder to `<app>` on `<server>` | The app opens where a teammate's signed `zekno.json` was not used here before. A file in a folder above is named with that folder and its Compose file: `<member>` linked `<folder>` to `<app>` on `<server>`, with `<folder>/<compose>` | `y` uses it here, `n` or `esc` not now |
| Remember this folder? | `d` in a folder with no `zekno.json` | `enter` writes `zekno.json`, signed by you, and deploys, `n` deploys without it, `esc` cancels |
| This folder is linked to `<app>` on `<server>` | `d` in a linked folder with another app selected | `y` deploys the folder to the selected app, `n` or `esc` does not deploy |
| Deploy `<app>` to `<server>` without `NAME`? | `esc` on the list of missing values | `y` deploys, `n` or `esc` does not deploy |

### What is running, and keeping in touch with servers

- Home and the App screen show each app as `running`, `stopped`, `partly running` or `unknown`, by
  a word and a symbol as well as a colour. An app is running when every service runs, stopped
  when none does, and partly running otherwise.
- State is read when a screen opens and every 5 seconds while Home or App is showing: Home reads
  every server, App its own. Nothing is read while a question is open, below 80 by 24, or while
  the app is quitting.
- When the app starts, it opens one session to each server: one SSH connection to the runner,
  kept open while the app runs. That is the moment SSH may ask for a password. Each read sends
  its requests over that session, so a read adds no SSH login. One read per server at a time.
- A read with no answer within 20 seconds, or a session that ends, closes that session. The
  server is then shown as not reached, with the reason, and its apps' state as unknown. Its apps
  keep the deploy numbers this machine has.
- A server whose session was lost is connected to again in the background, at most once every
  30 seconds, in SSH's batch mode only: it never asks for a password and never takes over the
  terminal.
- Where SSH would have had to ask (a password, a key passphrase, a host key) and was not
  answered, the server is marked `!` instead of its dot, with "needs an answer" under its
  name, and its apps' state is unknown. It is not tried in the background again until you
  connect to it on purpose: `enter` on it in the servers pane (the hints say `enter connect`),
  or start the app, deploy, roll back, open logs, update or add. A server that refuses the
  connection, does not answer in time or does not resolve is shown as not reached (`✖`).
- `enter connect` tries SSH's batch mode, then hands the terminal over so SSH can ask, checks
  that it is the server you connected, and keeps the session for the reads that follow. If you
  cancel at SSH's question, the mark stays.
- Deploys, rollbacks, secrets and logs use connections of their own, never the kept session.
- After a server is added from the app, the session it was added over is kept, so SSH does not
  ask a second time.
- A runner that does not report its version has no sessions. It is read when the app starts and
  after `u`, never in the background.
- Every kept session is closed when the app closes, on `q`, an error or a signal.
- If SSH has to ask for a password or a host key, the app first tries SSH's batch mode, then
  hands the terminal over so you can answer on the normal screen, and takes it back once the
  connection is up.

### Deploying from the app

- A folder linked by a `zekno.json` signed by your team and in use here deploys at once to its own app on its
  own server, and on its own server with no apps. With another app selected, on its own server
  or another, `d` first asks: "This folder is linked to web on dev. You selected billing. Deploy
  this folder to billing? It replaces what billing runs now." Only `y` deploys the folder's
  Compose file to the selected app; `n` or `esc` ends with "Nothing was deployed.", and `enter`
  does nothing. Nothing is read from the keychain, signed or sent before `y`, and `zekno.json` is
  not changed. On another server with no apps, `d` says so and deploys nothing. One exception:
  on its own server, a linked app that has never been deployed there has no row to select yet,
  so `d` deploys it as its first deploy whichever row is marked. No other app is replaced.
- A folder with no `zekno.json` deploys its `compose.yaml` to the selected app. Before the first
  deploy, the app asks whether to remember the folder; yes writes `zekno.json`, signed with your
  key, and records it as used here. With no app selected, it points you to `zekno link`.
- A folder whose `zekno.json` is not signed by your team deploys nothing, and Home says why. One
  signed by your team that was not used here before is asked about when the app opens; until you
  say yes, `d` deploys nothing and says so.
- The Compose file is read once, when `d` is pressed. The names listed and the text signed come
  from that one read.
- Before a deploy, names the Compose file expects that have no secret are listed, at most 64.
  Each can be set with the hidden prompt, or the deploy can go ahead without them. At the prompt
  `esc` returns to the list and signs nothing. On the list `esc` asks before deploying without
  them; "no" ends with "Nothing was deployed.".
- `esc` during a deploy returns to the screen before; the result arrives there as a line. `q`
  waits for the deploy to finish, then closes.
- The deploy screen shows a summary panel, a row of stages (checked, signed, sent, starting,
  then started or failed) and one live line. Docker's full output is shown on `o`, and on a
  failed start.

### Logs in the app

The logs screen follows an app's logs over a connection of its own. It keeps the last 2000 lines
in memory and writes nothing to disk. It says where they come from: "Read straight from your
server over SSH. Nothing passes through Zekno." When the connection drops, it says so, and
`enter` connects again.

## Commands

```text
zekno init --name <you>
zekno server add <name> --ssh <user@host> [--runner-path <path>]
zekno server add <name> --ssh <user@host> --runner-file <path>   (development only)
zekno server add <name> --local [--home <dir>]
zekno server update <name> [--yes]
zekno server ls
zekno secret set <NAME> [--app <app>] [--server <name>] [--stdin]
zekno secret rm <NAME> [--app <app>] [--server <name>]
zekno secret ls [--app <app>] [--server <name>]
zekno deploy [--app <app>] [--server <name>] [-f <compose file>] [--json]
zekno rollback [--app <app>] [--server <name>] [--to <number>] [--json]
zekno status [--server <name>] [--json]
zekno logs [--app <app>] [--server <name>] [--tail <n>] [--no-follow]
zekno link [--app <app>] [--server <name>] [-f <compose file>] [--force] [--yes]
zekno version [--json]
zekno --version [--json]
```

`zekno --help`, `zekno -h` and `zekno help` print this list. In a folder linked with
`zekno link`, `--app`, `--server` and `-f` come from its `zekno.json`. Flags win over it.

At a terminal, a command that still lacks `--server` or `--app` asks for it:

```text
$ zekno status
? Which server?
  ❯ prod       deploy@203.0.113.7
    staging    this machine
  ↑↓ move   enter choose   esc leave
```

It lists your servers, then the apps on the server you chose, read from its runner (or, when the
runner cannot be reached, the apps this machine deployed there). With one server, that server is
used and named: `Using prod, your only server.` Esc or Ctrl-C leaves the question: nothing is
done, and the command ends with "Nothing was done." and exit status 1. With no team yet, a
command other than `zekno init` and `zekno deploy` says to run `zekno deploy` in a project
folder, or `zekno init --name <you>`.

With no terminal, with `--json`, or with input piped, a command never asks: one that still lacks
a detail stops and names the flag and the project file, as before.

Names of apps and servers are lowercase letters, digits and hyphens, starting with a letter or a
digit.

### `zekno init`

Creates your signing key in the system keychain and starts a team with you as its admin. It
prints the team code, which identifies your team: a server checks it before it agrees to obey
your team. If the keychain cannot take the key, no team is created. It stops if a team already
exists on this machine.

```bash
zekno init --name ada
```

### `zekno server add`

Connects a server: the runner sets itself up for your team, and the server is added to your
signed team list. It prints the server code, which identifies the server's key. Teammates compare
it before they trust the server.

- `--ssh <user@host>`: over SSH. zekno checks Docker with Compose, looks for a runner, and
  installs one when none is there (see [Installing the runner](#installing-the-runner)). A runner
  that is already there is used as it is, whatever its version; one that is older or newer than
  this zekno is reported.
- `--runner-path <path>`: use the runner already installed at that path on the server. Nothing
  is installed, and the install steps are not run.
- `--runner-file <path>`: development only. Sends a runner built on this machine instead of
  downloading a release. Not with `--runner-path`.
- `--local`: a runner on this machine. `--home <dir>` is its folder; the default is
  `runner/<name>` in the profile folder.

A runner already set up for your team by an earlier attempt that stopped half way is carried on
from. A runner that belongs to another team stops it, and nothing is changed.

```bash
zekno server add prod --ssh deploy@203.0.113.7
```

### `zekno server update`

Replaces the runner on a server with the version this zekno carries, by the same checked route
as `server add`. At a terminal it asks first; without one it needs `--yes`. A runner is never
updated unasked. It replaces only a file named `zekno-runner`, never replaces a newer runner, and
the new runner must answer with its version before it replaces the old one. The runner's folder,
key and state are not touched. A runner on this machine has nothing to update.

A runner newer than the one this zekno carries is left as it is, and you are told to update zekno
instead. A build of zekno that holds no checksum for its runner stops with "This build of zekno
has no published runner to install", unless the runner already has this version.

```bash
zekno server update prod --yes
```

### `zekno server ls`

Lists the connected servers: name, SSH destination (or "this machine") and server id.

```bash
zekno server ls
```

### `zekno secret set`, `zekno secret rm`, `zekno secret ls`

`secret set` seals a value for one app on one server and signs it. It takes effect on the next
deploy. Before the value is asked for, zekno names where it goes: `Value for NAME (api on dev): `.

- A secret value is never an argument. Leave it out and you are asked for it with nothing shown
  as you type, or pipe it in with `--stdin`. A value of several lines needs `--stdin`. With
  `--stdin`, one line break at the end is dropped.
- An empty value is not stored. A value may be at most 64 KiB.
- A name uses letters, digits and underscore, and does not start with a digit. Names the runner
  uses to start Docker are reserved and refused.

`secret rm` signs the removal of a secret; it also takes effect on the next deploy. `secret ls`
lists names and versions. No command shows a value.

```bash
zekno secret set DATABASE_URL --app api --server prod --stdin < database-url.txt
```

### `zekno deploy`

Signs a deploy of a Compose file with the next deploy number, and sends it to the runner over one
connection. The Compose file is:

1. `-f <file>`, when given. It may be anywhere.
2. Otherwise the one a `zekno.json` signed by your team and in use here names, when the app is the one it names.
3. Otherwise `compose.yaml` in the current folder.

The second and third must stay inside their folder: a symbolic link out of it is refused. Every
Compose file is read once, from one open file, and must be a regular file of at most 256 KiB. A
named pipe is refused, not waited on. Do not put secrets in the Compose file itself: it is stored
and sent as written.

Exit status 1 when the runner accepted the deploy but the app did not start. The deploy number is
used either way.

```bash
zekno deploy --app api --server prod -f compose.yaml
```

At a terminal, `zekno deploy` run in a project folder first sets up what is missing, in this
order. Each thing is kept as soon as it is made.

1. Your key. It asks your name, creates the key in the system keychain as `zekno init` does, and
   shows the team code.
2. A server. It asks where the server is (`user@host`) and a name for it, installs the runner as
   `zekno server add` installs it, and shows the server code. With one server it uses that one
   and says so. With several it asks which.
3. The app. It offers the apps on that server, and `+ a new app` with the folder's name filled
   in. When it asked for the server or the app, it asks whether to remember this folder: yes
   writes a signed `zekno.json`, as `zekno link` does.
4. The values the Compose file expects that have no secret yet. Each is asked with nothing shown
   as you type. Esc skips one, and the next run asks for it again.
5. Then the deploy.

```text
$ zekno deploy
  Nothing is set up on this machine yet. Three things first: your key, a server, this app.

? Your name › ada
✔ Key created. It is in your system keychain.
  Team code    J4QF-AM29-F01W-PYWM-CS8P
  Identifies your team. A server checks it before it agrees to obey your team.

? Where is the server? › deploy@203.0.113.7
? A name for it › prod
✔ Connected over SSH
✔ Docker with Compose found
✔ Runner installed  52 MB, checksum verified
✔ Added prod to the signed team list
  Server code  MM4G-GPD7-M9VM-ACGJ-Y48R
  Identifies this server's key. Teammates compare it before they trust the server.
  You reached this server over SSH, so its identity rests on SSH's host verification.

? Name for this app › demo
? Remember this folder? It writes zekno.json, so it always deploys demo to prod. (y/N) yes

! compose.yaml expects 1 value that has no secret yet.
? Value for DATABASE_URL (demo on prod): (hidden)

  (the deploy panel and stages, as for any deploy)
✔ demo is live on prod in 6.1s
```

Esc or Ctrl-C leaves any question. What was made before it is kept, and running `zekno deploy`
again carries on from there. A detail given by a flag or by a linked folder is never asked for.
With no terminal, `zekno deploy` asks nothing and stops as before.

### `zekno rollback`

Deploys an earlier service definition again, under the next number, with the current secrets.
Only deploys this machine signed and the runner answered for count. Without `--to`, it returns to
the one before the latest.

```bash
zekno rollback --app api --server prod --to 3
```

### `zekno status`

Reads what a server holds: its team list version, each app's last deploy and whether it is
running, and each secret's version. Never a value. When the runner is older or newer than the one
this zekno carries, a warning says so, and what works until they match: an older runner is brought
up to date with `zekno server update`, and for a newer one you update zekno. Deploys still work,
unless the newer runner speaks a newer protocol; then you are told to update zekno first.

```bash
zekno status --server prod
```

### `zekno logs`

Prints an app's logs, read straight from its server. `--tail <n>` is how many earlier lines
Docker sends first: 0 to 1000, 200 by default. It follows until interrupted, or until Docker's
log command or the connection ends. `--no-follow` prints the lines Docker has and ends. Ctrl-C,
or a reader that closes the pipe (`zekno logs | head -1`), stops the reading on the server and
ends the command quietly with status 0. It needs a runner that reports its version, as every
released runner does, and an app the server has a deploy of. Nothing is written to disk.

```bash
zekno logs --app api --server prod --tail 50 --no-follow
```

### `zekno link`

Writes `zekno.json` in the current folder, signs it with your key, and records it as used here.
See [The project file](#the-project-file-zeknojson).

- An app or server not given is taken from a `zekno.json` that already applies to the folder,
  only when it is signed by your team and in use here. From any other nothing is taken: it stops
  with exit status 2 and says why.
- `-f` defaults to `compose.yaml` and must be a file inside the folder.
- It does not overwrite a `zekno.json` without `--force`. With `--force` and names, it replaces
  any file with one signed by you.
- With no `--app`, `--server` or `-f`, a `zekno.json` signed by your team that already applies (in
  this folder or one above) is checked as one being written would be, and recorded as used here,
  not rewritten. Recording it is the same decision as the question every command asks the first
  time it meets a teammate's file, so `zekno link` asks it too, and only `y` records it:
  `Accepted zekno.json: <app> on <server>, file <compose>.` No stops with "Nothing was done." and
  exit status 1. With no terminal it stops with exit status 2 unless you add `--yes`:

  > There is no terminal to ask on. Ada linked ~/code/shop to api on prod. Add `--yes` to use it
  > here.

  A file already in use here is left as it is: `Already in use: zekno.json, <app> on <server>, file
  <compose>.` A file not signed by your team is refused. Names given that are exactly those of a
  signed `zekno.json` in this folder are asked about and recorded the same way.

```bash
zekno link --app api --server prod
```

### `zekno version`

Prints the version of this zekno and of the runner release it installs. `zekno --version`
prints the same. With `--json`, one object: `{"zekno":"0.1.0","runner":"0.1.0"}`. It needs no
key, no profile and no terminal, and changes nothing.

`zekno version` then asks GitHub once whether a newer release exists, and says so in one more
line:

```text
$ zekno version
zekno 0.1.0
runner 0.1.0, the runner release this zekno installs
✔ This is the newest release.
```

When a newer release exists, the last line is a warning instead: "! A newer release exists:
0.2.0. Update zekno to get it." When it could not find out, it is a dim
`Could not check for a newer release.`: no network, no answer within 3 seconds, or an answer
that is not a version. The exit status is 0 in each case. With `--json` the answer is the field
`latest`, whose `state` is `newest`, `newer` (with the `version`) or `not_checked`:
`{"zekno":"0.1.0","runner":"0.1.0","latest":{"state":"newer","version":"0.2.0"}}`.

- It asks `api.github.com` for the latest published release of `zekno-app/zekno`, within 3
  seconds. `zekno --version` never uses the network.
- The request carries the name `zekno` and nothing about you, your team, your servers or your
  project. GitHub learns the address and the time of the request.
- Nothing else in zekno contacts GitHub on its own. There is no check in the background, and
  nothing is stored.
- zekno never downloads or installs a newer release. Until zekno is packaged, updating it means
  getting the newer source and building it again: see [Build from source](#build-from-source).

### Exit status

| Status | Means |
|--------|-------|
| `0` | Success. Also the app when you quit, and `zekno logs` stopped with Ctrl-C or a closed pipe |
| `1` | Refused or failed, including a deploy whose app did not start, and a question left with Esc or Ctrl-C |
| `2` | Wrong usage, including a `zekno.json` not signed by your team, one not used here yet when there is no terminal to ask on, and `zekno` with no arguments and no terminal |

### Output

At a terminal, single commands use the app's symbols, wording and panels. `deploy` and `rollback`
show the summary panel, the stage row and a result line with what to run next; a failed start
shows what Docker reported. Over SSH nothing is animated, because SSH may ask for a password in
the same terminal.

When standard output or standard input is not a terminal (piped, in a script, `< /dev/null`), with
`TERM=dumb` or with `--json`, commands print plain lines: results on standard output with table
cells separated by tabs, warnings and failures on standard error, no colour, symbols or panels.
With `--json`, one JSON object. That form is stable, and these are the changes from the first
version:

| Command | Plain output | Changed from the first version? |
|---------|--------------|---------------------------------|
| `deploy`, `rollback` | `Deploy <n> of <app> is running on <server> with <k> secrets.` | Yes: "`<k> secret(s)`" became "`<k> secrets`", "`1 secret`" or "`no secrets`" |
| `deploy --json` | `{"outcome","app","sequence","server"}` | No |
| `status` | `<server>: team list version <v>`, then `<app>\tdeploy <n>\t<state>`, then `<app>/<NAME>\tversion <v>` | Yes: a third cell, `running`, `stopped`, `partly running` or `unknown`; the apps in Home's order, the latest deploy from this machine first |
| `status --json` | As before, plus `"apps": { "<app>": { "state", "services": [...] } }` | Yes: one added field |
| `secret ls`, `server ls` | Unchanged | No |
| `logs` | `<time>\t<service>\t<text>`, one line per log line | New |

Docker's output is not printed during a deploy. On a failed start in plain mode, the lines
Docker reported are written to standard error after the failure sentence.

A script that gives zekno a terminal on both ends (`expect`, `script`, `docker run -t`) gets the
questions a person gets. Pass `--server` and `--app`, or `--json`, or `< /dev/null`, so that
nothing waits on a question.

Lines that a runner, Docker or SSH write on standard error are passed on after the mark
`remote:`, so they cannot pass for zekno's own. One place has no mark: at a terminal, `zekno deploy`
and `zekno rollback` show Docker's latest line dim and set in by two columns under the stage row, and
on a failed start show Docker's lines inside a panel titled "Docker said". Those lines are the
server's words, not zekno's. Text from a server is cleaned of terminal control sequences before it
reaches the terminal, in the app and in single commands.

## The project file: `zekno.json`

```json
{
  "app": "api",
  "server": "prod",
  "compose": "compose.yaml",
  "signed": { "payloadType": "zekno.link.v1", "payload": "...", "signature": { "keyId": "...", "sig": "..." } }
}
```

It saves typing `--app`, `--server` and `-f` in a project folder. It holds three names and your
team's signature of them, nothing else: no secret and no key (the signature and the key id are
public), so committing it gives nothing away. Its signature vouches for the names (which app,
which server, which Compose path), not for what the Compose file says. Whatever is checked out in
a linked folder is what `zekno deploy` deploys there, so read a branch, such as a pull request's,
before you deploy it.

| Field | Rule |
|-------|------|
| `app` | An app name: lowercase letters, digits and hyphens |
| `server` | A server name, same rule. It must be a server connected on this machine when used |
| `compose` | A relative path inside the folder that holds `zekno.json`. No `..`, not absolute. Default `compose.yaml` |
| `signed` | The signature `zekno link` adds: a member of your team signed this app, server and Compose file |

- An unknown field is an error, and so is a field written twice.
- It is looked for in the current folder, then each folder above it, stopping at your home folder
  or the filesystem root. A folder above your home folder is never read.
- Only a regular file named exactly `zekno.json`, of at most 4096 bytes, that belongs to you is
  used. A symbolic link, a pipe or another user's file is an error that names it.
- It is written only by `zekno link` or a "yes" in the app, signed with your key, never over an
  existing one without `--force`, as a whole file with mode 644.

### Linking a folder

Run `zekno link --app <app> --server <server>` in the folder, or answer yes to "Remember this
folder?" in the app. Commit the `zekno.json` it writes. From then on, in that folder and the
folders below it, `zekno deploy`, `rollback`, `status`, `logs` and `secret` need no `--app` or
`--server`, and the app opens on that app.

Two things must both be true before zekno uses a `zekno.json`:

1. **Someone in your team wrote it.** Its signature is checked against your verified team list,
   as it is now. A file with no signature, one from another team, one signed by someone since
   removed from the team, one edited by hand after it was signed, or one signed for a server of
   another name is not signed by your team. It is refused outright and never offered:

   > zekno.json in ~/code/shop is not signed by your team, so zekno does not use it. It names api
   > on prod. To link this folder yourself, run `zekno link --app <name> --server <name> --force`.
   > To leave the file aside, give --app and --server.

   With no terminal a command stops with exit status 2. At a terminal it names the file with its
   first two sentences, leaves it aside, and asks for the server and the app as if it were not
   there; `zekno link` without `--force` stops instead, since writing would replace the file. The
   app shows the first two sentences on Home, selects nothing, and `d` deploys nothing.
2. **You used it in this folder on this machine before, or you say yes once.** A signature proves
   who wrote a file, not where it is: anyone who can read a repository can copy its `zekno.json`
   into another folder beside another Compose file. So the first time a teammate's file is met in
   a folder, zekno shows what it names and asks once. At a terminal: `Ada linked this folder to
   api on prod. Use it here?` Only `y` goes on; anything else stops with "Nothing was done.". A
   file in a folder above is named with that folder and the Compose file a yes deploys: `Ada linked
   ~/Downloads to api on prod, with ~/Downloads/compose.yaml. Use it here?` When `--app` or
   `--server` sends the command elsewhere than the file names, the question says both: `Ada linked
   this folder to api on dev. This command uses api on prod. Use it here?` A key typed before the
   question is drawn, such as while the keychain asks, is thrown away: only a `y` typed at the
   question answers it. `zekno link` asks the same question. The app asks when it opens, with
   `y use it` and `n not now`. With no terminal the command stops with exit status 2:

   > Ada linked ~/code/shop to api on prod, and it has not been used in this folder on this
   > machine. To use it, run `zekno link` there once and answer its question, or
   > `zekno link --yes` from a script. To leave it aside, give --app and --server.

What you have used is recorded in `links.json` in the profile folder: the real path of each file
and the SHA-256 of its bytes. Any change to its bytes, such as a teammate's new link arriving with
a `git pull`, is asked about once more. Given both `--app` and `--server`, a command leaves the
file aside unless it is in use here, and never asks; a file that cannot be read (a link, another
user's file, not valid JSON) then counts as no `zekno.json`. `links.json` is not signed, on
purpose: someone who can write your profile folder and also plant a project folder gains nothing
from it they do not have already, and an entry alone never makes a file count.

Its Compose file goes with its app. With `--app` naming another app, the Compose file is `-f`, or
`compose.yaml` in the current folder, as without a project file.

## Installing the runner

`zekno server add <name> --ssh <user@host>` with no `--runner-path` runs a fixed shell script on
the server over SSH. It stops at the first step that fails, and installs nothing unless every
check before it passed:

1. Connect.
2. `docker compose version` must work.
3. Look for a runner: at `/usr/local/bin/zekno-runner` (root) or `~/.local/bin/zekno-runner`
   (any other user), then on the `PATH`. One that is found is used as it is; skip to step 8.
4. The server must be Linux on x86-64 or ARM64.
5. The server must have a C library the runner can use. When `getconf GNU_LIBC_VERSION` names
   glibc older than 2.17, or `ldd --version` names musl, it stops here. A server that answers
   neither goes on, and step 7 catches a runner that cannot start.
6. `sha256sum` or `shasum` must be there. Then the release file is downloaded with `curl` or
   `wget` into a new private temporary folder beside where the runner goes, and unpacked. The
   download goes over HTTPS only, and follows a redirect only to another HTTPS address. With
   `--runner-file`, the file zekno sends is read instead, and step 7 checks it against the
   SHA-256 zekno computed before sending it.
7. Its SHA-256 must equal the value this zekno holds in `src/runner-release.json`. The value
   never comes from the download or from the server. The new runner must then answer `version`
   with the expected version from the temporary folder. Only then is it moved into place, with
   mode 755.
8. `zekno-runner version` must answer with the expected version, when it was just installed or
   was found at this version.
9. Create the runner's folder with mode 700 if it is missing.

The runner then sets itself up for your team over the same connection.

| Who you log in as | Runner | Its folder |
|-------------------|--------|------------|
| root | `/usr/local/bin/zekno-runner` | `/var/lib/zekno` |
| any other user | `~/.local/bin/zekno-runner` | `~/.local/state/zekno` |

The script never uses `sudo`. The server needs `sh`, `uname`, `curl` or `wget`, `gzip`,
`sha256sum` or `shasum`, Docker with Compose, and to reach github.com over HTTPS. The release
address is
`https://github.com/zekno-app/zekno/releases/download/runner-v<version>/zekno-runner-linux-<arch>.gz`.

### Which runner it installs

A build of zekno installs exactly one runner version: the one `src/runner-release.json` names,
with the SHA-256 of the runner for each kind of server. Which one depends on the branch that build
of zekno came from. You never choose it.

| zekno built from | Installs | Its version | On GitHub |
|------------------|----------|-------------|-----------|
| `main` | a prod release | three numbers, such as `0.1.0` | a release |
| `dev` | a development release, for trying a runner on a real server before the prod release | three numbers and `-dev.<n>`, such as `0.1.0-dev.1` | a pre-release, never shown as the latest |

A development version is older than the prod version with the same three numbers. So a zekno
built from `main` brings a server that runs `0.1.0-dev.1` up to `0.1.0` with
`zekno server update`, and a zekno built from `dev` never replaces that `0.1.0` with a
development release of the same numbers. When one of the two is a development release and the
other is not, `zekno status`, `zekno server add` and the app say so after they say which is older.

When you work on zekno itself, your build installs the release your branch's
`src/runner-release.json` names, not the runner in your checkout. To try a runner you changed,
build it and send it with `--runner-file` (below); it must answer with the version your zekno
carries.

### How a release is trusted

The checksums in `src/runner-release.json` are written by one command only: the maintainer's
second build ([RELEASING.md](../runner/RELEASING.md), part 7). After GitHub's workflow has built
and published a release, the maintainer builds the same commit again on their own machine, with
the same Bun version, and compares each runner three ways: their own build, the file GitHub
published, and the release's `SHA256SUMS`. Only when all three agree are the checksums written,
and committed on the branch of that release. Development releases are checked the same way.

The second build proves that the published file is what this source and this build tool
produce, so GitHub's build service did not change it. It does not prove that the build tool or
the dependencies are good: both builds use the same Bun version, the same npm packages (pinned by
`bun.lock`) and the same Bun runtimes for Linux, so a fault in those would be in both.

Releases are not signed, and no record of how they were built (build provenance) is published
yet. What a server relies on is the checksum this zekno holds: it installs a download only when
its SHA-256 equals that value.

### Supported servers

The runner is built for:

- Linux on x86-64, with a processor that has SSE4.2: Intel Nehalem, AMD Bulldozer or newer.
- Linux on 64-bit ARM (ARM64).
- The GNU C library (glibc) 2.17 or newer: Debian, Ubuntu, RHEL and similar. Alpine and other
  systems with the musl C library are not supported yet.

The download is about 52 MB, and the runner about 110 MB on disk. While it installs, both are
side by side where the runner goes, so keep at least 256 MiB free there.

What was tried, and what was only read: on 2026-11-14 the install script ran in local containers,
as root, with the runner file sent after it as `--runner-file` does. The runner started on
Debian 12 on ARM64 and on x86-64 (emulated), and on CentOS 7, which has glibc 2.17, on both. On
Alpine the install stopped before the file was read, as it should. Containers stand in for the C
library and the kind of processor only. The processor floor (SSE4.2) comes from Bun's documents
and was not tried, and no old kernel was tried. What each release was tried on is added to its
release notes.

### When it stops

Each way the install can stop says what happened, and leaves the server as it was:

| When | zekno says |
|------|------------|
| No Docker with Compose | Docker with Compose was not found on the server. Install Docker with its Compose plugin there, then try again. |
| Not Linux on x86-64 or ARM64 | This kind of server is not supported yet. The runner is built for Linux on x86-64 and ARM64. |
| glibc older than 2.17, or musl; or the new runner cannot find its C library | This server does not have the GNU C library (glibc) 2.17 or newer that the runner needs. Alpine and other Linux systems with musl are not supported yet. Nothing was installed. |
| This zekno holds no checksum for that kind of server | This build of zekno has no published runner to install. It goes on to name the two ways in [If this zekno holds no checksum](#if-this-zekno-holds-no-checksum). |
| Neither `sha256sum` nor `shasum` | The server has neither sha256sum nor shasum to check the runner with, so nothing was downloaded or installed. |
| The download or unpacking failed, with less than 256 MiB free | The server ran out of disk space for the runner. It needs at least 256 MiB free in /usr/local/bin as root, or in ~/.local/bin for another user. Nothing was installed. |
| The download or unpacking failed otherwise | The server could not download the runner. It needs curl or wget, gzip, and to reach github.com over HTTPS. |
| The SHA-256 differs | The downloaded runner did not match the checksum this zekno holds. It was deleted and nothing was installed. |
| The new runner was stopped by an instruction the processor lacks | This server's processor cannot run the runner. On x86-64 it needs SSE4.2: Intel Nehalem, AMD Bulldozer or newer. Nothing was installed. |
| The new runner did not answer for another reason | The runner did not start on the server: it did not answer with version `<version>`. |

In `zekno server update`, the four for glibc, `sha256sum`, disk space and the processor end with
"The runner that was there is still in place." instead. When the new runner wrote something
before it failed, its first line is shown too, as a line from the server: after `remote:` in a
single command, and in the full output in the app.

### If this zekno holds no checksum

A zekno whose `src/runner-release.json` holds no checksums has no published runner to install.
That is so between a release and its second build, after a release was withdrawn, and before a
branch's first release is recorded. `zekno server add` still uses a runner already on the
server. Otherwise, use one of these:

- Install the runner by hand, as the [runner's README](../runner/README.md#install-on-a-server)
  describes. At the places in step 3 it is found and used; anywhere else, add the server with
  `--runner-path <path>`.
- For development, `--runner-file <path>` sends a runner you built. Its SHA-256 is computed here
  and checked on arrival, and it must answer with the version this zekno carries. A runner
  already on the server is used as it is, also with `--runner-file`.

### Limits of this route

From the reviews:

- A release is trusted through the checksum this zekno holds, not through a signature. The
  second build shows that GitHub's build service changed nothing; it does not check Bun or the
  npm packages both builds use.
- With `wget`, the download has no size limit, and `curl` before 8.4 does not stop a download of
  unknown length. Only whoever serves the release address over TLS could use that to fill the
  disk.
- "Installed the runner … It matched the checksum" repeats what the server printed. A server
  that lies can print it without doing it. What the server is trusted for is decided by the
  session that follows, where every answer is checked.
- Before the first `server add`, someone who can write to a folder on the `PATH` of the user you
  log in as could put a `zekno-runner` there, and it would be used.
- `--runner-file` checks the file, then reads it. A file swapped in between is read without the
  size limit. It is a development option.
- Installing as root has no automated test yet. It was tried by hand in the local containers
  above.
- An x86-64 processor without SSE4.2 was not tried. The installer reads a runner stopped by an
  illegal instruction as the processor's lack; whether the runner stops that way on such a
  processor is not known.

## What is kept where

On this machine:

| What | Where |
|------|-------|
| Your signing key and the team code | The system keychain, service `app.zekno.cli`. Never in a file; there is no option for that. |
| Team lists, connected servers | `~/.zekno/profile.json` (or `ZEKNO_HOME`). Public keys and signatures only. |
| Secrets | `~/.zekno/secrets/<server id>/<app>.json`, as encrypted, signed records. A value cannot be shown again after it is set. |
| Deploy history | `~/.zekno/history/<server id>/<app>.json`: the last 50 signed deploys of each app, for rollback. |
| Project files used here | `~/.zekno/links.json`: the real path and SHA-256 of each `zekno.json` used on this machine, at most 500. |
| A runner on this machine | `~/.zekno/runner/<name>`, unless `--home` named another folder. |
| Which app a folder deploys | `zekno.json` in the project folder. |

The profile folder has mode 700 and its files mode 600. App state and logs are never stored.

The files in `~/.zekno` are safe to read but are not believed as they stand. Every command
rebuilds the team from the signed team lists, starting from the team code in the keychain, and
checks each secret and each history entry against it. A file changed by something other than
`zekno` is refused or ignored, never signed. The folder holds no command to run.

On the server, see the [runner's README](../runner/README.md#its-folder).

## Develop

```bash
bun test            # includes a run with a real container when Docker and caddy:2.11.9 are present
bun run typecheck
bun run compile     # dist/zekno, a single file (build.ts)
```

Commands never print. They call the `Ui` they are given (`src/ui/types.ts`): `src/ui/ink.tsx` at
a terminal, `src/ui/plain.ts` everywhere else. What a command does lives in `src/ops/`, which the
app (`src/app/`) uses too. The app's keys are a pure reducer, `src/app/state.ts`, and what a key
press does at the hidden prompt is a pure function, `src/ui/secret-input.ts`. Tests use the plain
interface and an in-memory key store, so they need no terminal and never touch the real keychain. `test/docs.test.ts` checks that this file and the docs page name every command, flag and
key, and nothing that does not exist.

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
`test/stand-in-server.ts`. Without one, any SSH destination fails closed; no `ssh` is ever
started.

How it fits together: `tests/support/engine.ts` is the e2e engine, `terminal.ts` the
pseudo-terminal, `screen-model.ts` the screen it reads, and `screen-tree.ts` the tree the runner
and the model see. Each test sets its world up with exact steps (`tests/support/world.ts`) and
opens the app on the screen it is about. The screen model has its own unit tests in
`test/e2e-screen-model.test.ts`, which `bun test` runs.
