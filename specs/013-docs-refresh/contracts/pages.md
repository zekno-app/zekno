# Contract: the pages of the docs

## The tree

`apps/web/content/docs/meta.json` gives three groups, in this order. The address of a page is `/docs/<file>`; the introduction is `/docs`.

| Group | File | Title | Holds | Text comes from |
|---|---|---|---|---|
| Start | `index.mdx` | Introduction | What Zekno is, what works today, its limits, how a deploy happens today, the planned hosted service in a few lines | Rewritten from today's introduction and "Status and limits" |
| Start | `quick-start.mdx` | Quick start | From a checkout to an app running on your server, in three steps, with screens | New |
| Start | `install.mdx` | Install | Build from source | `cli.mdx`, "Build from source" |
| Start | `security.mdx` | Security model | Who holds which key, what a breach gives and does not give, what is not protected, and a link to the README's full model | Today's introduction (the trust table, the steps, the limits) |
| Using zekno | `app.mdx` | The terminal app | Opening it, keys, questions, running state, deploying from the app, logs | `cli.mdx`, "The app" without "The settings screen" |
| Using zekno | `deploying.mdx` | Deploying | `zekno deploy`, `rollback`, `status`, `logs` | `cli.mdx`, those four commands |
| Using zekno | `servers.mdx` | Your key and servers | `zekno init`, `server add`, `server update`, `server ls`, installing the runner | `cli.mdx`, those commands and "Installing the runner" |
| Using zekno | `secrets.mdx` | Secrets | `zekno secret` and its subcommands | `cli.mdx`, "zekno secret" |
| Using zekno | `settings.mdx` | App settings | The settings file `zekno.app.json`: every key, the start command, published ports, volumes | `cli.mdx`, "zekno settings" up to and without "Showing the settings" |
| Using zekno | `changing-settings.mdx` | Changing settings | Showing the settings, changing one, `settings compose`, `settings init`, exit status, the app's settings screen | `cli.mdx`, the rest of "zekno settings", and "The settings screen" |
| Using zekno | `templates.mdx` | Templates | `zekno add`, then the list of templates and how to write one | `cli.mdx`, "zekno add", and today's templates page |
| Using zekno | `project-file.mdx` | The project file | `zekno.json`, `zekno link`, linking a folder | `cli.mdx`, "zekno link" and "The project file" |
| Using zekno | `doctor.mdx` | Doctor and version | `zekno doctor`, `zekno version` | `cli.mdx`, those two commands |
| Reference | `cli.mdx` | Commands | Every command of the help with one line and a link to where it is described | `cli.mdx`, "Commands", extended into the full list |
| Reference | `output.mdx` | Output and exit status | Exit status, output with and without a terminal | `cli.mdx`, "Exit status" and "Output" |
| Reference | `storage.mdx` | What is kept where | Every file and key the CLI keeps, and where | `cli.mdx`, "What is kept where" |
| Reference | `runner.mdx` | Server runner | Unchanged | Unchanged |

If a section fits another page of this table better once its text is read, it may go there; the move list says where it went. The seventeen files and their titles do not change.

## Rules for every page

1. No page is longer than 500 lines.
2. Each command of the help is described on exactly one page. Other pages link to it.
3. Each page that describes the CLI, the runner or the core library keeps the callout "Pre-alpha and unaudited" at its top, as today's pages have it.
4. Text is moved as it is. A sentence changes only when it must: a link that pointed inside the old page, "above" or "below" that no longer holds, a heading's level. Nothing is rewritten for style.
5. Headings keep their words, so their anchors keep their names. A heading changes only when two on one page would be the same.
6. Links inside the docs are written `/docs/<file>#<anchor>` to another page and `#<anchor>` inside a page.
7. No page names the desktop app, its folder or its framework.
8. A page shows a screen with `<Screen name="…" />` and never with a hand-written code block that imitates one. Examples of files and of what to type stay ordinary code blocks.

## The move list

`specs/013-docs-refresh/move-list.md`: one row for each heading of `cli.mdx` as it is on `dev` today (52 headings), in the old page's order.

```markdown
| Old heading | Level | New page | New heading |
|---|---|---|---|
| The app | 2 | /docs/app | (the page) |
| Keys | 3 | /docs/app | Keys |
```

After it, two short lists:

- **Reworded**: each sentence that changed for a reason of rule 4, with the old and the new.
- **Dropped**: each sentence that is on no new page, with the reason. Expected to be only the sentences that tied the old page together ("See … below").

## The tests

In `apps/web/modules/docs/lib/pages.test.ts`:

| Check | Fails when |
|---|---|
| Length | A page of the docs is longer than 500 lines |
| Tree | `meta.json` names a page that does not exist, or a page is not in it, or the seventeen files differ from this contract |
| Links | A link `/docs/…`, `/docs/…#…` or `#…` in a page, in the root README or in an app's README leads to a page or a heading that does not exist. Anchors are made from headings the way the site makes them |
| Move list | A row of the move list points at a page or a heading that does not exist |
| No desktop app | "desktop", "Electrobun" or `apps/desktop` appears in a page, in the root README or in an app's README (any case). The Docker Compose version string in a test is not a page and is not read |
| Callout | A page of rule 3 lacks the callout |

In `apps/cli/test/docs/docs.test.ts` (it exists; its set of files changes):

| Check | Over |
|---|---|
| Every command and flag of the help, and every key of the two contracts, is named | All pages of the docs together |
| Every `zekno` command a file names exists, with flags that command takes | Each page of the docs, the CLI's README, the root README |
| Every key in a key table exists | Each page of the docs |

It must still fail when a command, a flag or a key is taken out of the docs (FR-015); that is tried once by hand and noted in the tasks.
