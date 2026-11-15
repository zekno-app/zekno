# Approved mock-ups: Small CLI Features

Approved by the maintainer on 2026-11-15. The wording, the symbols and the order on these are
binding: where `spec.md` or a contract disagrees with a mock-up about how something looks or
reads, the mock-up is right. Colours follow the single commands of feature 004 (the board
"Status, lists, errors and piped output"): `?` and `❯` in the brand colour, `✔` green, `!` yellow,
`✖` red, hints and second lines dim.

None of this is ever shown when there is no terminal, when input or output is piped, or with
`--json`: a command then stops with the sentence and exit status it has today.

## 1. A question with a list

```text
$ zekno status
? Which server?
  ❯ prod       deploy@203.0.113.7
    staging    this machine
  ↑↓ move   enter choose   esc leave
```

After a choice the question collapses to one line, `✔ Server  prod`, and the command goes on.
With exactly one server nothing is asked; one dim line says `Using prod, your only server.`

Leaving with `esc` prints `Nothing was done.` and the command ends with exit status 1.

## 2. Which app

```text
? Which app on prod?
  ❯ demo       deploy 4, running
    api        deploy 12, running
    + a new app
```

`+ a new app` is offered by `deploy` only. Choosing it asks, with the folder's name filled in:

```text
? Name for the new app › my-folder
```

After a choice: `✔ App  demo`.

## 3. `zekno deploy` from nothing

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

? Name for this app › demo
? Remember this folder? It writes zekno.json, so it always deploys demo to prod. (y/N)

! compose.yaml expects 1 value that has no secret yet.
? Value for DATABASE_URL (demo on prod): (hidden)   esc skips it

  (the deploy panel and stages, as today)
✔ demo is live on prod in 6.1s
```

Only what is missing is asked: with a key already, the first block is not shown, and so on. The
opening line counts what is missing ("Two things first: a server, this app.").

The from-nothing flow is in `zekno deploy` only. Another command run with no team says to run
`zekno deploy` in a project folder, or `zekno init`.

## 4. `zekno secret import`

```text
$ zekno secret import .env
  .env, for demo on prod

  new         DATABASE_URL, SESSION_KEY, STRIPE_KEY
  replaces    API_URL
  left out    PATH (zekno keeps this name), line 7 (not a valid name)

? Store 4 values? Values are never shown. (y/N)
✔ Stored 4 values for demo on prod. They take effect on the next deploy.
  .env still holds them in plain text. Delete it, or keep it out of git.
```

A name that already has a secret gets a new version. A name left out is named by its line's
number (`my-var` is on line 7 of this `.env`), unless it is one zekno keeps, such as `PATH`: what
looks like a name may be the end of a value wrapped onto its own line. One line the format does
not allow stops the whole import: the message names the line's number and never repeats the line. In a script,
`--yes` stores without the question.

## 5. `zekno doctor`

```text
$ zekno doctor
  This machine
✔ zekno          0.1.0, installs runner 0.1.0
✔ Key            in your system keychain
✔ Profile        verified, team list v2
✔ This folder    linked to demo on prod, compose.yaml is readable

  prod  deploy@203.0.113.7
✔ Reachable      over SSH
✔ Docker         Compose 5.6.0
! Runner         0.1.0-dev.1, older than this zekno's 0.1.0
                 Run zekno server update prod
✔ Disk           133 GB free

  staging   deploy@198.51.100.4
✖ Reachable      SSH needs an answer
                 Open zekno and press enter on staging
–  Docker        not checked
–  Runner        not checked
–  Disk          not checked

  1 problem, 1 warning.
```

A warning (`!`) does not fail the command; only a problem (`✖`) does. `--server <name>` checks
one server; `--json` gives the same results as data.

## 6. The version

```text
$ zekno --version
zekno 0.1.0
runner 0.1.0, the runner release this zekno installs
```

With `--json`: one object with both versions. `zekno --version` never uses the network.

`zekno version` prints the same two lines, then asks GitHub once whether a newer release exists
(approved by the maintainer on 2026-11-15), and adds one of:

```text
$ zekno version
zekno 0.1.0
runner 0.1.0, the runner release this zekno installs
✔ This is the newest release.
```

```text
! A newer release exists: 0.2.0. Update zekno to get it.
```

```text
  Could not check for a newer release.
```

The last one is dim, and is what an unreachable network, a slow answer or an answer that is not
a version gives. None of the three changes the exit status: `zekno version` ends with 0.

The first line of `zekno doctor` ("This machine") shows the same two versions, and makes the same
check. A newer release is a warning there, with the same sentence on the line below; no answer
is not a warning:

```text
! zekno          0.1.0, installs runner 0.1.0
                 A newer release exists: 0.2.0. Update zekno to get it.
```

zekno never checks on its own: only these two commands do, each once per run. It never downloads
or installs anything because of the answer.
