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

## Added

Text that is new, not moved: the front matter's `description` of each new page; on Commands, the
line "Each command is described on one page:" and the table of every command of the help, one
line each, with a link to where it is described (T019). Each line of that table is taken from the
first sentence of the command's own section, shortened, or with the command as its subject, where
that sentence did not stand alone.
