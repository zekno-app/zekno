# Contract: screens

How a screen of the CLI gets into the docs and the README, and how it is kept true.

## The screens

Example values in every screen: the app `shop`, the server `prod-1` at `203.0.113.10` (user `deploy`), a team and keys made for the capture. No value from a real machine.

| Name | Shows | Size | Used on | Needed |
|---|---|---|---|---|
| `first-deploy` | `zekno deploy` in a folder with a Compose file and nothing set up: the key is made, the server added, the runner installed, the app deployed | 100 wide, as tall as its output | Quick start, Deploying | Required |
| `home` | The app's Home with one server and one deployed app | 100 × 30 | README (as SVG), Quick start, The terminal app | Required |
| `settings-screen` | The app's settings screen for `shop` | 100 × 30 | Changing settings | Required |
| `add-postgres` | `zekno add postgres` at a terminal, after it added the service | 100 wide | Templates | Required |
| `settings` | `zekno settings` for an app with one service | 100 wide | App settings | Wanted |
| `status` | `zekno status` for a running app | 100 wide | Deploying | Wanted |
| `doctor` | `zekno doctor` with every check passing | 100 wide | Doctor and version | Wanted |
| `help` | `zekno --help` | 100 wide | Commands | Wanted |
| `secrets` | `zekno secret ls` or the app's secrets screen | 100 wide | Secrets | If it can be drawn |
| `server-add` | `zekno server add` installing the runner | 100 wide | Your key and servers | If it can be drawn |
| `app-detail` | The app's screen for one app: its deploys | 100 × 30 | The terminal app | If it can be drawn |

A screen that cannot be drawn without changing a file under `apps/cli/src` is left out and reported. It is never drawn by hand.

## The stored file

`apps/web/content/screens/<name>.json`, UTF-8, ending with a newline:

```json
{
  "name": "home",
  "title": "The app: Home",
  "command": "zekno",
  "columns": 100,
  "rows": 30,
  "alt": "The full-screen app. A header with the team's name, a list with one server, prod-1, and one app, shop, shown as running, and a line of keys at the bottom.",
  "fixed": [{ "what": "how long ago the deploy was", "shown": "2 minutes ago" }],
  "lines": [
    [["", "  "], ["bold", "zekno"], ["dim", "  pre-alpha"]],
    []
  ]
}
```

| Field | Rule |
|---|---|
| `name` | The file's name without `.json`. Lower-case letters, digits and hyphens |
| `title` | What the screen shows, in a few words. The left of the frame's title bar |
| `command` | What the person typed. For a command's output it is also the right of the title bar |
| `columns` | 100, or 80 |
| `rows` | A number for a screen of the full-screen app (the whole terminal is shown, empty rows included). `null` for a command's output (as tall as what was printed) |
| `alt` | One to three sentences for a reader who cannot see the screen: what is on it, not how it looks |
| `fixed` | Every value the recipe replaced so the screen is the same on each run, with what is shown instead. An empty list when nothing was replaced |
| `lines` | One entry per row of the screen, top to bottom. A row is a list of runs. A run is `[look, text]` |

A run's `look` is an empty string, or names joined by commas, from: `bold`, `dim`, `brand`, `green`, `yellow`, `red`. `brand` is the CLI's blue, `#2383e2`. A colour the CLI writes that is not in this list makes the capture fail with its name, so that none is dropped unseen; the list is then extended here, in the component and in the SVG maker together.

Trailing spaces of a row are removed. No row is longer than `columns` cells. The file is written with one row of the screen per line of the file, so a change shows in a diff as the rows that changed.

For a command's output, the first row is the prompt and the command (`$ zekno deploy`), drawn dim and plain as the walkthroughs did, then what the program printed.

## The command

In `apps/cli`:

```sh
bun run screens            # draws every screen, writes the files and the README's SVG
bun run screens --check    # draws every screen, writes nothing, names each that differs, exits 1 if any does
bun run screens home       # one screen
```

Rules:

- Each screen has a recipe, `apps/cli/test/screens/recipes/<name>.ts`, which sets up the stand-ins, runs the real command or opens the real app, and returns the terminal's text with the screen's title, command, size and description.
- A recipe uses the stand-ins of `apps/cli/test/support`. It never reaches a real server, the network, the system keychain or the person's own profile (FR-022). It imports from `apps/cli/src` and changes nothing there.
- Colours are on (`FORCE_COLOR=3`), in a process of its own.
- Running it twice in a row writes the same bytes (SC-005).
- It prints one line per screen, and for `--check` the first row that differs.

## The SVG

`.github/assets/screen-home.svg`, written by the same command from `home.json`.

- The same look as the frame in the docs: dark ground `#0b0d10`, a 1px border, rounded corners, a title bar with the title and `100 × 30`.
- Each run is placed by its column, so the picture does not depend on the reader's font. Box-drawing characters are drawn as lines so they join.
- It holds a `<title>` with the screen's description. No script, no outside file.
- The README shows it with the same description as its alternative text.

## The frame in the docs

`<Screen name="home" />` in a page, and optionally `caption="…"`.

- A `<figure>`: the title bar, the screen as text in the site's monospace font at 12.5px with rows 15px high, and a caption under it when one is given.
- Colours inside the frame are the terminal's: ground `#0b0d10`, text `#d7dde4`, dim `#8b949e`, brand `#2383e2`, green `#3fb950`, yellow `#d29922`, red `#f85149`, bold in white.
- The text can be selected and copied (FR-018).
- When the screen is wider than the page it scrolls sideways inside the frame, which can be focused with the keyboard. The page never scrolls sideways (FR-019).
- The description (`alt`) is given to readers who cannot see the screen, and the drawn rows are hidden from them (FR-020).
- A name with no stored file fails the build, with the name in the message.

## The tests

| Test | Where | Fails when |
|---|---|---|
| Screens in step | `apps/cli/test/screens/screens.test.ts` | A stored screen differs from what the program draws now; it names the screen. Also when the SVG differs from what `home.json` gives |
| Stored files are sound | `apps/web/modules/docs/lib/screens.test.ts` | A file breaks the format above, a row is longer than `columns`, a full-screen capture does not have exactly `rows` rows, a look is unknown, a description is missing |
| Screens and pages agree | `apps/web/modules/docs/lib/pages.test.ts` | A page names a screen with no file, or a stored screen is used by no page and not by the README |
