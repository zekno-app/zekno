# Move list: the old command-line page, split into pages

Feature 013 split `apps/web/content/docs/cli.mdx` (as it was at `9ad84d3`, 1,975 lines) into the
pages of `contracts/pages.md`, and moved its "zekno add" into `templates.mdx`. The text was moved
by a script that cut the old file by its headings' line ranges; nothing was retyped. A section that
became a page lost its heading to the page's title, and the headings under it went up one level
(two for the parts of "zekno settings" that open `changing-settings.mdx`). Headings kept their
words, so their anchors keep their names.

## Where each heading went

One row for each heading of the old page (h2 to h4, outside code), in its order. "(the page)":
the heading is now the page's title.

| Old heading | Level | New page | New heading |
|---|---|---|---|
| Status and limits | 2 | /docs | Status and limits |
| Build from source | 2 | /docs/install | (the page) |
| The app | 2 | /docs/app | (the page) |
| Keys | 3 | /docs/app | Keys |
| Questions | 3 | /docs/app | Questions |
| What is running, and keeping in touch with servers | 3 | /docs/app | What is running, and keeping in touch with servers |
| Deploying from the app | 3 | /docs/app | Deploying from the app |
| The settings screen | 3 | /docs/changing-settings | The settings screen |
| Logs in the app | 3 | /docs/app | Logs in the app |
| Commands | 2 | /docs/cli | (the page) |
| zekno init | 3 | /docs/servers | zekno init |
| zekno server add | 3 | /docs/servers | zekno server add |
| zekno server update | 3 | /docs/servers | zekno server update |
| zekno server ls | 3 | /docs/servers | zekno server ls |
| zekno secret set, import, rm and ls | 3 | /docs/secrets | zekno secret set, import, rm and ls |
| zekno deploy | 3 | /docs/deploying | zekno deploy |
| zekno rollback | 3 | /docs/deploying | zekno rollback |
| zekno status | 3 | /docs/deploying | zekno status |
| zekno logs | 3 | /docs/deploying | zekno logs |
| zekno link | 3 | /docs/project-file | zekno link |
| zekno settings | 3 | /docs/settings | zekno settings |
| The settings file | 4 | /docs/settings | The settings file |
| The start command | 4 | /docs/settings | The start command |
| Published ports | 4 | /docs/settings | Published ports |
| Volumes | 4 | /docs/settings | Volumes |
| Showing the settings | 4 | /docs/changing-settings | Showing the settings |
| Changing one: zekno settings set and unset | 4 | /docs/changing-settings | Changing one: zekno settings set and unset |
| What will run: zekno settings compose | 4 | /docs/changing-settings | What will run: zekno settings compose |
| Starting a file: zekno settings init | 4 | /docs/changing-settings | Starting a file: zekno settings init |
| Exit status of zekno settings | 4 | /docs/changing-settings | Exit status of zekno settings |
| zekno add | 3 | /docs/templates | zekno add |
| Adding one | 4 | /docs/templates | Adding one |
| Whole or not at all | 4 | /docs/templates | Whole or not at all |
| Looking first: the picker, --list and --show | 4 | /docs/templates | Looking first: the picker, --list and --show |
| A Compose file written by hand | 4 | /docs/templates | A Compose file written by hand |
| With no terminal (scripts) | 4 | /docs/templates | With no terminal (scripts) |
| What it does not do | 4 | /docs/templates | What it does not do |
| Exit status of zekno add | 4 | /docs/templates | Exit status of zekno add |
| zekno doctor | 3 | /docs/doctor | zekno doctor |
| zekno version | 3 | /docs/doctor | zekno version |
| Exit status | 3 | /docs/output | Exit status |
| Output | 3 | /docs/output | Output |
| The project file: zekno.json | 2 | /docs/project-file | (the page) |
| Linking a folder | 3 | /docs/project-file | Linking a folder |
| Installing the runner | 2 | /docs/servers | Installing the runner |
| Which runner it installs | 3 | /docs/servers | Which runner it installs |
| How a release is trusted | 3 | /docs/servers | How a release is trusted |
| Supported servers | 3 | /docs/servers | Supported servers |
| When it stops | 3 | /docs/servers | When it stops |
| If this zekno holds no checksum | 3 | /docs/servers | If this zekno holds no checksum |
| Limits of this route | 3 | /docs/servers | Limits of this route |
| What is kept where | 2 | /docs/storage | (the page) |

## Reworded

Each line that changed for a reason of rule 4, with the old and the new text, cut from the files.
Line numbers are those of the old file at `9ad84d3` and of the new page.

### cli.mdx line 2 to 3 → cli.mdx line 2 to 3

The old page's front matter. The page at this address is now Commands.

Old:

```text
title: Command-line tool
description: The zekno command and its terminal app. Every command, every key, the project file, and how the runner gets onto a server.
```

New:

```text
title: Commands
description: Every command of zekno, one line each, with the page that describes it.
```

### cli.mdx line 21 → cli.mdx line 18

A link that pointed inside the old page.

Old:

```text
signs. See [zekno settings](#zekno-settings).
```

New:

```text
signs. See [zekno settings](/docs/settings#zekno-settings).
```

### cli.mdx line 39 → index.mdx line 118

A link that pointed inside the old page (now in "Status and limits" on the introduction).

Old:

```text
  [Installing the runner](#installing-the-runner).
```

New:

```text
  [Installing the runner](/docs/servers#installing-the-runner).
```

### cli.mdx line 63 → install.mdx line 2

A section that became a page: its heading is the page's title.

Old:

```text
## Build from source
```

New:

```text
title: Install
```

### cli.mdx line 89 → app.mdx line 2

A section that became a page: its heading is the page's title.

Old:

```text
## The app
```

New:

```text
title: The terminal app
```

### cli.mdx line 109 → app.mdx line 33

A link that pointed inside the old page.

Old:

```text
| Settings | `e` on an app | This folder's `zekno.app.json`, one service at a time, in sections; on `c`, the Compose text it turns into. See [The settings screen](#the-settings-screen) |
```

New:

```text
| Settings | `e` on an app | This folder's `zekno.app.json`, one service at a time, in sections; on `c`, the Compose text it turns into. See [The settings screen](/docs/changing-settings#the-settings-screen) |
```

### cli.mdx line 244 → changing-settings.mdx line 236

A link that pointed inside the old page.

Old:

```text
linked to that app on that server. See [zekno settings](#zekno-settings) for
```

New:

```text
linked to that app on that server. See [zekno settings](/docs/settings#zekno-settings) for
```

### cli.mdx line 330 → cli.mdx line 2

A section that became a page: its heading is the page's title.

Old:

```text
## Commands
```

New:

```text
title: Commands
```

### cli.mdx line 533 → deploying.mdx line 17

A link that pointed inside the old page.

Old:

```text
[zekno settings](#zekno-settings)). The first of these that applies decides
```

New:

```text
[zekno settings](/docs/settings#zekno-settings)). The first of these that applies decides
```

### cli.mdx line 576 → deploying.mdx line 60

A link that pointed inside the old page.

Old:

```text
deploy. A volume removed from them keeps its data (see [Volumes](#volumes)).
```

New:

```text
deploy. A volume removed from them keeps its data (see [Volumes](/docs/settings#volumes)).
```

### cli.mdx line 694 → project-file.mdx line 57

The sentence after it pointed to the project file's section, which is now this page itself (see Dropped).

Old:

```text
records it as used on your machine. See
```

New:

```text
records it as used on your machine.
```

### cli.mdx line 739 → settings.mdx line 19

A link that pointed inside the old page.

Old:

```text
a folder deploys one or the other (see [zekno deploy](#zekno-deploy) for
```

New:

```text
a folder deploys one or the other (see [zekno deploy](/docs/deploying#zekno-deploy) for
```

### cli.mdx line 749 → settings.mdx line 29

A link that pointed inside the old page.

Old:

```text
[zekno deploy](#zekno-deploy)): the one the `zekno.json` in use here names, in
```

New:

```text
[zekno deploy](/docs/deploying#zekno-deploy)): the one the `zekno.json` in use here names, in
```

### cli.mdx line 965 → changing-settings.mdx line 52

A link that pointed inside the old page.

Old:

```text
  volume from the settings keeps its data (see [Volumes](#volumes)). A service
```

New:

```text
  volume from the settings keeps its data (see [Volumes](/docs/settings#volumes)). A service
```

### cli.mdx line 1072 → changing-settings.mdx line 159 to 160

"Above" no longer holds: the settings file is on App settings.

Old:

```text
`zekno deploy` in this folder signs. For the file above:
```

New:

```text
`zekno deploy` in this folder signs. For the file in
[The settings file](/docs/settings#the-settings-file):
```

### cli.mdx line 1151 to 1152 → templates.mdx line 24 to 25

The link pointed at the templates page, where this text now is: it points at the list on the same page.

Old:

```text
Its image is the software's official one, pinned by digest. The
[templates page](/docs/templates) lists them with their authors, and
```

New:

```text
Its image is the software's official one, pinned by digest.
[The templates](#the-templates), below, lists them with their authors, and
```

### cli.mdx line 1176 → templates.mdx line 49

A link that pointed inside the old page.

Old:

```text
this folder would use, found by the rule of [zekno settings](#zekno-settings):
```

New:

```text
this folder would use, found by the rule of [zekno settings](/docs/settings#zekno-settings):
```

### cli.mdx line 1594 → doctor.mdx line 118

A link that pointed inside the old page.

Old:

```text
  [Build from source](#build-from-source).
```

New:

```text
  [Build from source](/docs/install).
```

### cli.mdx line 1649 → project-file.mdx line 2

A section that became a page: its heading is the page's title.

Old:

```text
## The project file: zekno.json
```

New:

```text
title: The project file
```

### cli.mdx line 1938 → storage.mdx line 2

A section that became a page: its heading is the page's title.

Old:

```text
## What is kept where
```

New:

```text
title: What is kept where
```

### templates.mdx line 49 → templates.mdx line 394

Two headings on one page would be the same (rule 5): "zekno add" brought its own "What it does not do", which keeps its name.

Old:

```text
## What it does not do
```

New:

```text
## What a template does not do
```

### runner.mdx line 164 → runner.mdx line 164

A link that pointed into the old page.

Old:

```text
[command-line tool page](/docs/cli#supported-servers). `ZEKNO_DOCKER` names
```

New:

```text
[Your key and servers page](/docs/servers#supported-servers). `ZEKNO_DOCKER` names
```

### runner.mdx line 175 → runner.mdx line 175

A link that pointed into the old page.

Old:

```text
[command-line tool page](/docs/cli#installing-the-runner).
```

New:

```text
[Your key and servers page](/docs/servers#installing-the-runner).
```

### runner.mdx line 261 → runner.mdx line 261

A link that pointed into the old page.

Old:

```text
[How a release is trusted](/docs/cli#how-a-release-is-trusted)). The release
```

New:

```text
[How a release is trusted](/docs/servers#how-a-release-is-trusted)). The release
```

## Dropped

Each line of the old page that is on no new page, with the reason.

### cli.mdx line 695

It pointed from "zekno link" to the section on the project file. Both are now on the page
`/docs/project-file`, whose title is that section's heading, so the link would lead to the top of
the page the reader is on.

```text
[The project file](#the-project-file-zeknojson).
```

### deploying.mdx: a hand-written copy of a screen

On `/docs/deploying`, the walkthrough of a first deploy from nothing, under "zekno deploy", the old page drew the screen by hand in a code block. The stored screen `first-deploy` now stands in its place, made by the real program (`<Screen name="first-deploy" />`), and `contracts/pages.md` rule 8 says a page never shows a hand-written block that imitates a screen. So the copy was dropped, after part D placed the screen. It also said `Runner installed  52 MB`, a figure from an old board: the program prints the size of the unpacked runner, about 110 MB, as the stored screen shows.

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

### templates.mdx: a hand-written copy of a screen

On `/docs/templates`, the summary of `zekno add postgres`, under "Adding one", the old page drew the screen by hand in a code block. The stored screen `add-postgres` now stands in its place, made by the real program (`<Screen name="add-postgres" />`), and `contracts/pages.md` rule 8 says a page never shows a hand-written block that imitates a screen. So the copy was dropped, after part D placed the screen. 

```text
$ zekno add postgres
✔ Read by  web
PostgreSQL 18.7  A relational database.                                 by zekno
╭──────────────────────────────────────────────────────────────────────────────╮
│ app     demo                                                                 │
│ server  prod deploy@203.0.113.7                                              │
│ file    zekno.app.json  2 services: web, worker                              │
╰──────────────────────────────────────────────────────────────────────────────╯
Adds a service
  postgres                postgres:18.7  pinned by digest
                          restart always · port 5432, not published
                          data kept in volume postgres-data
Makes a secret on this machine  never shown
  POSTGRES_PASSWORD       32 random characters
                          read by postgres
Builds a secret from it
  DATABASE_URL            postgres://app:••••@postgres:5432/app
                          read by web
! Zekno does not back up this data.
? Add postgres to demo? Nothing is deployed until you deploy. (y/N) yes
✔ Added postgres to zekno.app.json
✔ Stored POSTGRES_PASSWORD and DATABASE_URL, sealed for prod
  Run zekno deploy to start it.
```

### changing-settings.mdx: a hand-written copy of a screen

On `/docs/changing-settings`, the settings screen, under "The settings screen", the old page drew the screen by hand in a code block. The stored screen `settings-screen` now stands in its place, made by the real program (`<Screen name="settings-screen" />`), and `contracts/pages.md` rule 8 says a page never shows a hand-written block that imitates a screen. So the copy was dropped, after part D placed the screen. 

```text
╭────────────────────╮ ╭─────────────────────────────────────────────────────────────────────────╮
│ Services           │ │ web                                                      zekno.app.json │
│ ❯ web              │ │ Source                                                                  │
│   worker           │ │   image      ghcr.io/acme/demo-web:1.4.2                                │
│                    │ │ Deploy                                                                  │
│                    │ │   start      bun run start                                              │
│                    │ │   restart    on failure                                                 │
│                    │ │ ❯ memory     1g  ! changed, not deployed (was 512m)                     │
│                    │ │   cpus       1                                                          │
│                    │ │ Networking                                                              │
│                    │ │   port       3000                                                       │
│                    │ │   published  not published                                              │
│                    │ │ Variables                                                               │
│                    │ │   secrets    DATABASE_URL, SESSION_KEY                                  │
│                    │ │   plain      NODE_ENV=production                                        │
│                    │ │ Volumes                                                                 │
│                    │ │   uploads    /data/uploads                                              │
│ One app, one file: │ │ ─────────────────────────────────────────────────────────────────────── │
│ zekno.app.json     │ │ A change is written to the file. It runs after the next deploy.         │
╰────────────────────╯ ╰─────────────────────────────────────────────────────────────────────────╯

↑↓ move  enter change  tab services  c Compose text  d deploy  esc back
```

## Added

Text that is new, not moved: the front matter's `description` of each new page; on Commands, the
line "Each command is described on one page:" and the table of every command of the help, one
line each, with a link to where it is described (T019). Each line of that table is taken from the
first sentence of the command's own section, shortened, or with the command as its subject, where
that sentence did not stand alone.

## The introduction

Feature 013 rewrote `apps/web/content/docs/index.mdx` (as it was at `9ad84d3`, 100 lines) around
"Status and limits", which is kept word for word, and wrote `security.mdx` from it (T026, T027).
Each part of the old introduction is in one place: what Zekno is, what exists today and where to go
next stay on the introduction; the trust table, the steps of a deploy, what it protects and does
not protect against, the metadata note and the open-source paragraph go to the security model.

### The desktop app's sentences

Each sentence of the old introduction that named the desktop app, or meant it by "the app", and
what replaced it (`contracts/readme.md`, "Today (docs introduction)").

| Old (index.mdx at `9ad84d3`) | New | Where |
|---|---|---|
| Callout: "First versions of the core library, the command-line tool and the server runner are in the repository. The desktop app and the hosted service are not written yet; these docs describe the design they will follow." | "The command-line tool and the server runner work today, for one developer, deploying directly over SSH. The hosted service is not built yet; these docs describe the design it will follow." | index.mdx, the callout |
| "Zekno gives a team the convenience of a managed platform (a desktop app, teammates with roles, deploy history) on servers they own, …" | "… a managed platform (one command to deploy, teammates with roles, deploy history) on servers they own, …" | index.mdx, What Zekno is |
| Trust table row "Desktop app \| A team member's machine \| Team signing key \| Yes \| Yes" | "Command-line tool (`zekno`) \| A team member's machine \| Team signing key \| Yes \| Yes" | security.mdx, Who holds which key |
| "1. **Encrypt.** The desktop app encrypts each secret for your server's public key before anything leaves your machine." | "1. **Encrypt.** `zekno` encrypts each secret for your server's public key before anything leaves your machine." | security.mdx, How a deploy works |
| "2. **Sign.** The app signs the deploy with your team's key." ("the app" meant the desktop program) | "2. **Sign.** `zekno` signs the deploy with your team's key." | security.mdx, How a deploy works |
| Threat row "A Zekno app or runner release is tampered with \| …" ("app" meant the desktop program) | "A Zekno release (the CLI or the runner) is tampered with \| …", the rest of the row as it was, as in the README | security.mdx, What it does not protect against |
| "What exists today" row "Desktop app (`apps/desktop`) \| Planned" | Removed | index.mdx, What works today |

### Other changes

| Old | New | Why |
|---|---|---|
| Heading "The three parts" | "Who holds which key" | The security page's heading for the trust table (`contracts/pages.md`) |
| Heading "What exists today" | "What works today", with a short list of what you can do and links to the pages | `contracts/pages.md` |
| Command-line tool row: "See [Command-line tool](/docs/cli)" | "See [Commands](/docs/cli)" | The page at that address is now Commands |
| "Where to go next": three cards | Three cards added before them: Quick start, Using zekno, Reference | Links to the quick start and to the groups (T026) |
| Front matter description "What Zekno is, how it keeps your keys on your side, and where the project stands today." | "What Zekno is, what works today and its limits, how a deploy happens today, and the hosted service that is planned." | The page holds other things now |

### New text

- index.mdx: the sentence pointing to the quick start; the list under "What works today"; "A deploy
  today" (four steps: seal and sign on your machine, send over SSH, the runner verifies and
  decrypts, run); "The hosted service, planned" (one paragraph).
- security.mdx: the opening (the short form, the link to the README's full model at
  `https://github.com/zekno-app/zekno#security-model`, the control plane not built); the
  sentence after the steps ("Step 3 is the planned design. …"); the links to What is kept where,
  How a release is trusted and Status and limits; the sentence on reporting a vulnerability.
- quick-start.mdx: the whole page.
- A caption for each `<Screen>` placed on a page (T028).

### The control plane's status row (changed by the cloud session in part F)

Under "What works today" the row read as if the control plane existed (SC-007).

Old:

```text
| Control plane | Hosted by Zekno, closed source |
```

New:

```text
| Control plane | Not built yet. When built, hosted by Zekno, closed source |
```

## From the CLI's README

`apps/cli/README.md` (1,854 lines at `9ad84d3`) was cut to the five parts of `contracts/readme.md`:
its opening, Build from source, Develop, End-to-end tests (all as they were) and a new "Screens for
the docs" (T035). Before the cut, a script outside the repository split every part that goes
(Status and limits, The app, Commands, The project file, Installing the runner, What is kept where;
and the opening, which stays) into sentences, table rows and code lines, and looked for each on the
pages of the docs (T034). Links' addresses, backquotes and bold marks were left out of the
comparison.

- **1,308** pieces read. **1,239** are on a page of the docs as they are.
- **69** are not found as they are. **7** are the opening, which the README keeps. **1** was on no
  page and is moved: the release address, to `servers.mdx`, Installing the runner. **61** are on a
  page in other words, nearly all because the docs say "your machine" where the README said "this
  machine"; 3 of them are in Part C's lists above.

Changed in the parts the README keeps:

- Develop. Old: "`test/docs/docs.test.ts` checks that this file and the docs page name every
  command, flag and key, and nothing that does not exist." New: "`test/docs/docs.test.ts` checks
  that the pages of the docs name every command, flag and key, and that they, this file and the
  root README name nothing that does not exist." The old sentence was no longer true after the split
  (`research.md` §8).
- The opening's link "See [`zekno settings`](#zekno-settings)" now points at
  `https://zekno.app/docs/settings#zekno-settings`, and a sentence was added after the opening that
  points to the quick start and to Commands.

Each piece not found as it is, by its line in the README at `9ad84d3`:

| Line | Text | Where it is |
|---|---|---|
| 3 | Secrets are encrypted and deploys are signed on this machine. | Stays: the CLI's README keeps its opening (What zekno is) |
| 7 | Pre-alpha and unaudited. | Stays: the CLI's README keeps its opening (What zekno is) |
| 7 | Built on [@workspace/core]. | Stays: the CLI's README keeps its opening (What zekno is) |
| 7 | This program, | Stays: the CLI's README keeps its opening (What zekno is) |
| 8 | Do not use it for anything you | Stays: the CLI's README keeps its opening (What zekno is) |
| 9 | could not afford to lose, and do not rely on it in production before an external audit. | Stays: the CLI's README keeps its opening (What zekno is) |
| 14 | An app is deployed from a Compose file you write, or from its settings in zekno.app.json, which zekno turns into Compose text on this machine and signs. | Stays: the CLI's README keeps its opening (What zekno is) |
| 25 | They never pass through Zekno, and this machine keeps none of it. | index.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 28 | The runner comes from a release. zekno server add installs on a server the one runner version this build of zekno carries, and only when it matches the checksum this build holds. | index.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 44 | "Changed, not deployed" knows only this machine's deploys. | index.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 48 | The internal reviews say what was checked and what was not: | index.mdx, Status and limits: "The internal security reviews, which say what was checked and what was not, are in the specs folder of the repository" |
| 48 | [specs/003-cli-runner/security-review.md] and [specs/004-cli-app/security-review.md]. | index.mdx, Status and limits: "The internal security reviews, which say what was checked and what was not, are in the specs folder of the repository" |
| 153 | Its apps keep the deploy numbers this machine has. | app.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 180 | A folder linked by a zekno.json signed by your team and in use here deploys at once to its own app on its own server, and on its own server with no apps. | app.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 251 | ! changed, not deployed (was 512m) marks a value that differs from this machine's last deploy of that app, when that deploy was made from settings. | changing-settings.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 339 | It lists your servers, then the apps on the server you chose, read from its runner (or, when the runner cannot be reached, the apps this machine deployed there). | cli.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 354 | It stops if a team already exists on this machine. | servers.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 375 | Sends a runner built on this machine instead of downloading a release. | servers.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 377 | --local: a runner on this machine. --home <dir> is its folder; the default is runner/<name> in the profile folder. | servers.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 389 | A runner on this machine has nothing to update. | servers.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 411 | zekno secret set, zekno secret import, zekno secret rm, zekno secret ls | secrets.mdx: the heading "zekno secret set, import, rm and ls" (Part C) |
| 423 | secret rm signs the removal of a secret; it also takes effect on the next deploy. secret ls lists names and versions. | secrets.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 430 | It shows the names it found, never a value, asks once, and stores each value sealed and signed, as secret set does one at a time: | secrets.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 457 | A name that does not fit the rule of secret set, a reserved name, and an empty value are left out, and the rest is still offered. | secrets.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 477 | What it deploys is a Compose file, or an app's settings in zekno.app.json turned into Compose text on this machine (see [zekno settings]). | deploying.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 590 | Only deploys this machine signed and the runner answered for count. | deploying.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 625 | Writes zekno.json in the current folder, signs it with your key, and records it as used here. | Part C's "Dropped" (the link to The project file in `zekno link`, now on that page) |
| 625 | See [The project file]. | Part C's "Dropped" (the link to The project file in `zekno link`, now on that page) |
| 646 | Add --yes to use it > here. | project-file.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 659 | At each deploy, zekno turns them into Compose text on this machine, and that text is what is signed, sent and recorded, as a Compose file is. | settings.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 669 | A zekno.json is in use here when your team signed it and it was used in its folder on this machine. | settings.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 781 | A path on this machine: no setting takes one. | settings.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 781 | A command for this machine: nothing in the file runs here, and start runs in the container. | settings.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 799 | Its words go to the container as they are: no shell reads them, on this machine or on the server. | settings.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 856 | When the file is the one a zekno.json in use here names, zekno opens your team to verify it and this machine's history, which reads the keychain once. | changing-settings.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 856 | When your team signed it, the first line names its app, and each value that differs from this machine's last deploy of that app made from settings is marked: ! changed, not deployed (was 512m). | changing-settings.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 897 | Changing one: zekno settings set and zekno settings unset | changing-settings.mdx: the heading "Changing one: zekno settings set and unset" (Part C) |
| 965 | For the file above: | Part C's "Reworded" ("above" no longer held) |
| 1038 | The [templates page] of the docs lists them with their authors, and [CONTRIBUTING.md] says how to write one. | templates.mdx: "[The templates], below, lists them …" (Part C, the link now inside the page) |
| 1307 | Adding writes zekno.app.json and the secret store on this machine, and nothing else. | templates.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1383 | --server <name> checks this machine and that one server. --json prints one object: zekno, runner, machine (the checks of this machine), servers (each with name, where and checks), serversSkipped, latest, problems and warnings. | doctor.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1441 | At a terminal, single commands use the app's symbols, wording and panels. deploy and rollback show the summary panel, the stage row and a result line with what to run next; a failed start shows what Docker reported. | output.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1456 | \| status \| <server>: team list version <v>, then <app>\tdeploy <n>\t<state>, then <app>/<NAME>\tversion <v> \| Yes: a third cell, running, stopped, partly running or unknown; the apps in Home's order, the latest deploy from this machine first \| | output.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1472 | Lines that a runner, Docker or SSH write on standard error are passed on after the mark remote:, so they cannot pass for zekno's own. | output.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1472 | Those lines are the server's words, not zekno's. | output.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1479 | The project file: zekno.json | Part C: the heading became the page project-file.mdx (title "The project file") |
| 1500 | \| server \| A server name, same rule. It must be a server connected on this machine when used \| | project-file.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1532 | zekno.json in ~/code/shop is not signed by your team, so zekno does not use it. | project-file.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1532 | It names api > on prod. | project-file.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1532 | To link this folder yourself, run zekno link --app <name> --server <name> --force. > To leave the file aside, give --app and --server. | project-file.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1540 | You used it in this folder on this machine before, or you say yes once. | project-file.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1555 | Ada linked ~/code/shop to api on prod, and it has not been used in this folder on this > machine. | project-file.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1555 | To use it, run zekno link there once and answer its question, or > zekno link --yes from a script. | project-file.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1555 | To leave it aside, give --app and --server. | project-file.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1589 | Its SHA-256 must equal the value this zekno holds in src/version/runner-release.json. | servers.mdx, Installing the runner, step 7: "the value this `zekno` holds"; the file is named on that page under Which runner it installs |
| 1611 | A build of zekno installs exactly one runner version: the one src/version/runner-release.json names, with the SHA-256 of the runner for each kind of server. | servers.mdx, Which runner it installs, without the file's name (named in the same section) |
| 1626 | When you work on zekno itself, your build installs the release your branch's src/version/runner-release.json names, not the runner in your checkout. | servers.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1633 | The checksums in src/version/runner-release.json are written by one command only: the maintainer's second build ([RELEASING.md], part 7). | servers.mdx, How a release is trusted: "The checksums a build of `zekno` holds … the maintainer's second build", and the release procedure `apps/runner/RELEASING.md` |
| 1645 | What a server relies on is the checksum this zekno holds: it installs a download only when its SHA-256 equals that value. | servers.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1693 | A zekno whose src/version/runner-release.json holds no checksums has no published runner to install. | servers.mdx, If this zekno holds no checksum: "A `zekno` that holds no checksums …" |
| 1698 | Install the runner by hand, as the [runner's README] describes. | servers.mdx, If this zekno holds no checksum: the runner page in place of the runner's README; "A runner at the places in step 3 is found and used. Anywhere else, …" |
| 1698 | At the places in step 3 it is found and used; anywhere else, add the server with --runner-path <path>. | servers.mdx, If this zekno holds no checksum: the runner page in place of the runner's README; "A runner at the places in step 3 is found and used. Anywhere else, …" |
| 1701 | Its SHA-256 is computed here and checked on arrival, and it must answer with the version this zekno carries. | servers.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1709 | A release is trusted through the checksum this zekno holds, not through a signature. | servers.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1718 | Before the first server add, someone who can write to a folder on the PATH of the user you log in as could put a zekno-runner there, and it would be used. | servers.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1730 | On this machine: | doctor.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1738 | \| Project files used here \| ~/.zekno/links.json: the real path and SHA-256 of each zekno.json used on this machine, at most 500. \| | storage.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1739 | \| A runner on this machine \| ~/.zekno/runner/<name>, unless --home named another folder. \| | storage.mdx, in other words: "this machine" became "your machine" ("here" became "on your machine"), `zekno` in code, a command named in full, a line broken inside a quote, a link to another page, or zekno called "the tool" |
| 1761 | On the server, see the [runner's README]. | storage.mdx: "On the server, see the runner page" |

## The security model's wording

The root README's "Security model" (from its heading to "Repository") at `9ad84d3` and after feature
013, compared by a script row by row and rule by rule (T033). Every row of every table and every
design rule is still there, except the one row `contracts/readme.md` removes.

| Part | Before | After |
|---|---|---|
| Trust boundaries, rows | 3 | 3 (one reworded) |
| What a breach of Zekno does not give an attacker, rows | 3 | 3 (none changed) |
| What Zekno does not protect against, rows | 3 | 3 (one reworded) |
| Open-source boundary, rows | 6 | 5 (one removed) |
| Design rules | 8 | 8 (rules 1, 3, 6 and 8 reworded) |
| Other lines: the note on metadata, the two paragraphs of the open-source boundary, the line before the rules, reporting a vulnerability | 7 | 7 (none changed) |

### Changed

Trust boundaries, the first row.

- Old: `| Desktop app | A team member's machine | Team signing key | Yes | Yes |`
- New: `` | Command-line tool (`zekno`) | A team member's machine | Team signing key | Yes | Yes | ``

What Zekno does not protect against, the third row. Only its first cell changed.

- Old: `| A Zekno app or runner release is tampered with | The client is the trust anchor. … |`
- New: `| A Zekno release (the CLI or the runner) is tampered with | The client is the trust anchor. … |`

Rule 1.

- Old: "**Private keys stay in the desktop app's main process.** The UI asks the main process to encrypt or sign over typed RPC and never sees a key."
- New: "**Private keys stay out of the interface.** The code that draws screens asks a separate part of the program to encrypt or sign, and never holds a key. This is a rule for any interface. In the CLI today the separation is in the code, not in separate processes: the screens and the code that signs run in one program. [`apps/cli/test/layers/layers.test.ts`](apps/cli/test/layers/layers.test.ts) checks that the single commands' interface (`src/ui/`) takes only types from the code that encrypts and signs (`src/ops/`), and that `src/ops/` imports nothing that draws; it does not check the full-screen app's screens yet."
- Why it is worded so: `layers.test.ts` checks the directions of imports in `apps/cli/src`. Its rule 2 says `ops/` imports nothing from `ui/`, `app/`, `asking/` or `commands/`; its rule 4 says `ui/` imports from `ops/` only types. Nothing in it separates the full-screen app's screens (`src/app/screens/`) from the rest of `src/app/`, and nothing runs in a separate process. Read today (not checked by a test): no file of `src/ui/` or `src/app/screens/` imports `profile/` (the keychain) or `@workspace/core`, and key material is named only in `src/ops/` and `src/profile/`. So the contract's sentence is kept as the rule, and the rule says how far it is true today.

Rule 3.

- Old: "The app, the runner and the website reach the control plane only through the public protocol in `packages/core`."
- New: "The CLI, the runner and the website reach the control plane only through the public protocol in `packages/core`."

Rule 6.

- Old: "**Releases and updates are signed with an offline key**, and the app verifies that signature itself before applying an update. This is the rule for the planned desktop app. Runner releases are not signed yet: a server installs a runner only when its checksum equals the one the CLI holds, recorded after a second build (see the threat table above)."
- New: "**Releases and updates are signed with an offline key**, and whatever installs one verifies that signature itself first. This rule is not met yet: runner releases are not signed. A server installs a runner only when its checksum equals the one the CLI holds, recorded after a second build (see the threat table above)."

Rule 8.

- Old: "**The Electrobun version is pinned**, and `packages/core` stays free of Electrobun code."
- New: "**`packages/core` holds no interface or framework code**, so everything that encrypts or verifies does it with the same small library." (`packages/core` depends on `libsodium-wrappers` and `zod` only.)

### Removed

- Open-source boundary: `` | Desktop app | `apps/desktop` | Open | ``. The CLI's row, `` | Command-line tool | `apps/cli` | Open | ``, was already there.

### Elsewhere in the README

The other sentences that named the desktop app, replaced as `contracts/readme.md` lists them: the
Overview's "(a desktop app, …)" became "(one command to deploy, …)"; in the planned design the
box "Desktop app" became "zekno, the CLI", the sequence's participant "Desktop app" became
"zekno CLI" and "press Deploy" became "run zekno deploy", "If Zekno is unavailable, the desktop app
can deploy to the runner directly." became "…, the CLI deploys to the runner directly, over SSH, as
it does today.", and "The desktop app encrypts secrets …" became "The CLI encrypts secrets …"; in
Repository, the row `apps/desktop` and the tech stack's row "Desktop app (planned)" are removed,
"The desktop app and the runner both depend on it" became "The CLI and the runner …", and "those
stay in the desktop app" became "those stay on your machine"; the roadmap's "Desktop app: connect a
server, set secrets, deploy, roll back, logs" is removed, and so is "One-day spike: window,
keychain access, signed build, verified auto-update (macOS and Windows)", which was the desktop
app's.

## After the cloud session: the templates page made one

Done on the maintainer's computer on 2026-11-18, at the maintainer's word, because the page opened twice and listed twice what a template does not do (one text from the old templates page, one from "zekno add").

- Under "zekno add", the second paragraph no longer repeats the page's opening ("Each one is a data file inside `zekno`, reviewed before it ships with a release. Nothing is downloaded when you use one"). Its other sentences stay.
- Under "The templates", the short table of connection secrets is removed; the fuller table under "zekno add" has the same four rows. One sentence points at it. The sentences about `postgres` and `mysql` both offering `DATABASE_URL` stay.
- "What adding one does" is removed: each of its statements is under "zekno add" ("Adding one", "Whole or not at all").
- "What a template does not do" is removed: "What it does not do", under "zekno add", says each point in more detail. Its last words, "and in no settings file", were added to the sentence about Redis there, which is the only statement the fuller list lacked.

The row above that renamed "What it does not do" to "What a template does not do" no longer applies: that second heading is gone.

## After the cloud session: the landing page

The maintainer asked for the desktop app to be left out of the landing page too (2026-11-18). In `apps/web/modules/landing/content/index.ts`:

| Before | After |
|---|---|
| Card title "Desktop app" (on "Your machine") | "The zekno CLI" |
| "The desktop app encrypts each secret for your server's public key before anything leaves your machine." | "The CLI encrypts each secret …" |
| "If we are offline, the desktop app deploys to the runner directly." | "If we are offline, the CLI deploys to the runner directly." |
| "A desktop app, teammates with roles and a full deploy history." | "One command to deploy, teammates with roles and a full deploy history." |
| Open-source list: "Desktop app" | "Command-line tool" |
| "While we are offline, the desktop app can deploy to the runner directly." | "While we are offline, the CLI can deploy to the runner directly." |
| "A Zekno app or runner release is tampered with" | "A Zekno release (the CLI or the runner) is tampered with" |
| "A tampered Zekno app or runner release, which public code …" | "A tampered Zekno release, the CLI or the runner, which public code …" |

The page test that refuses the term now reads the landing page's content as well.

## After the cloud session: rule 1 and the roadmap

- **Rule 1's last sentence.** The cloud session wrote that the test "does not check the full-screen app's screens yet". A test was added on the maintainer's computer, `apps/cli/test/layers/screens-hold-no-key.test.ts`: no file of `src/ui/` or `src/app/screens/` loads `src/profile/` or `@workspace/core`. The sentence now reads: "Tests in `apps/cli/test/layers/` check that no file that draws (`src/ui/`, and the full-screen app's screens in `src/app/screens/`) loads the keychain code or the core library, that `src/ui/` takes only types from the code that encrypts and signs (`src/ops/`), and that `src/ops/` imports nothing that draws." The rest of rule 1 is unchanged, including "the screens and the code that signs run in one program".
- **Roadmap, Later.** "Two-person approval for production deploys" is back, and the dashboard is named with the hosted service: "The hosted service, teammates and the signed-in dashboard". The local mock of the control plane stays out: it is a tool for developing Zekno, not something a user gets.
