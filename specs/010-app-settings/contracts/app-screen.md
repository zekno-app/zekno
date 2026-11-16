# App Screen Contract: the settings screen

User Stories 2 and 3 in the full-screen app (FR-017 to FR-020, FR-030). design.md's decision 5 and
the boards `AppSettings` and `AppSettingsEdit` are binding for the look; design.md for the words.
What no board shows is built as written here and reviewed on the real program (the maintainer
dropped the approval step for it; research R9). The screen is `app/screens/settings.tsx`, its
keys and state `app/state/settings.ts`, its file reads and writes `app/effects/settings.ts`
(research R6).

## The way in

On an app's screen, `e` opens the settings screen of that app: the hint line gains `e settings`
after `x remove secret` (research R7, R9 item 10). Nothing else of the app screen changes. The
help screen does not change (research R9, item 8). `esc` on the settings screen goes back to the
app's screen.

## What it shows (board `AppSettings`, 100 by 30)

As built (the screen's own render at 100 by 30, the wordmark left out; see "As built" at the
end for what changed from the first drawing):

```text
 ▀▀▀▀ ... (the wordmark)    › prod › demo › settings              ● running deploy 4

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
 │                    │ │                                                                         │
 │                    │ │                                                                         │
 │                    │ │                                                                         │
 │ One app, one file: │ │ ─────────────────────────────────────────────────────────────────────── │
 │ zekno.app.json     │ │ A change is written to the file. It runs after the next deploy.         │
 ╰────────────────────╯ ╰─────────────────────────────────────────────────────────────────────────╯


 ↑↓ move  enter change  tab services  c Compose text  d deploy  esc back
```

- **Header**: the wordmark, `› <server> › <app> › settings` with `settings` bold, and on the right
  the app's state and `deploy <n>` as the app screen draws them (`StateCell`, from the same row of
  Home). Below 100 columns, the state alone.
- **Services pane**, 22 columns wide, dim border: `Services` (bold, dim), one row per service in
  the file's order, the shown one with `❯` in the brand colour and its name bold; at its foot,
  dim, AS2.
- **Service pane**, the rest of the width, brand border: on its first line the service's name bold
  and, on the right, dim, the file as the deploy names it; then the five sections, each heading
  bold in the text colour; under each, its rows: a marker column of 2 (`❯` in the brand colour on
  the selected row), the label dim (the selected one bold, in the text colour), padded to 11, then
  the value. At its foot a rule and AS1, dim.
- **Rows**: every setting of today is a row, set or not, so each can be changed here:

  | Section | Rows |
  |---|---|
  | Source | `image` |
  | Deploy | `start`, `restart`, `memory`, `cpus` |
  | Networking | `port`, `published` |
  | Variables | `secrets`; then one `plain` row per variable (`NAME=value`, the label `plain` on the first only), or one `plain` row `none` |
  | Volumes | one row per volume (its name as the label, its path as the value), or one row `none` with no label |

  A value not set is drawn dim with the words below ("Words"). `restart` reads `on failure` for
  `on-failure`. Secrets by name only. A value too wide goes on under itself, never under the
  labels.
- **Changed, not deployed** (FR-019): after the value, two spaces and AS3 in the warning colour,
  when it differs from this machine's last deploy of this app made from settings (research R4).
  Nothing is marked when that is not known.
- **No empty line between sections** (the board's 6 px are less than a line).

## Keys

(The first column is headed "Pressed", not "Key": `docs.test.ts` reads the first table headed
`| Key |` in this file, which is the "Key table" below.)

| Pressed | Does |
|---|---|
| `↑` `↓` | Move between rows (section headings are not rows). In the Compose text, scroll |
| `enter` | Change the selected row (below). On a `none` row of `plain` or `volumes`, AS7 on the status line |
| `tab` | The next service, from the first row; after the last, the first |
| `c` | Show the Compose text the settings turn into in place of the service pane; `c` again, or `esc`, back to the settings |
| `d` | Deploy, exactly as `d` on the app's screen (the same effect, the same questions) |
| `esc` | Back to the app's screen. While a change is open: close it, nothing written |
| `?` | Help, as on every screen |
| `q`, `ctrl-c` | Quit, as on every screen |

Hint lines, as `KeyHints` draws them:

| When | Hints |
|---|---|
| Showing the settings | `↑↓ move  enter change  tab services  c Compose text  d deploy  esc back` (board) |
| Typing a value | `enter next  esc back` |
| Picking `restart` | `↑↓ move  enter choose  esc back` |
| Asking y/N | `y write it  n keep <now>  esc back` (board) |
| The Compose text | `↑↓ scroll  c settings  esc back` |
| One sentence instead of settings (below) | `esc back` |

## Changing a value (board `AppSettingsEdit`)

While a change is open the screen is drawn as the board draws it (research R9, item 6): the
Services pane is not drawn; one pane, its border dim, holds the service's first line, the section
of the row being changed with its rows, and at its foot the change box, its border in the brand
colour. The hint line is the change's.

1. **Typing** (every row but `restart`): `enter` opens the box with
   `Change a setting  <svc> · <label>` (`Change a setting` bold, the rest dim), then the typed
   question `? <Question> › <value>` with the current value filled in and the cursor after it
   (`?` in the brand colour, the question bold, `›` dim). Letters type, Backspace removes,
   a paste of one line is taken, a paste of several is not.
   - `enter` checks the value with the setting's rule (`settings/values.ts`, the same check as
     `zekno settings set`). Refused: the rule, in the warning colour, set in by two columns under
     the question (board: `Use a size such as 512m or 1g.`), and the question stays open.
   - An empty value removes a setting that can be left out; for `image` it is refused with
     `A service needs an image.`
   - The same value as now closes the box; nothing is written.
   - The whole file with the change is checked too; a rule across settings it breaks is shown as
     a refusal, its place and rule (CS17's second part).
2. **Picking** (`restart`): `? Restart rule` and the rows `no`, `on failure`, `always`, the marker
   on the current one, as a list of single commands draws its rows.
3. **Asking**: the box shows `now  <old>` and `new  <new>` (labels dim, the new value bold), then
   `? Write this to zekno.app.json? Nothing is deployed until you deploy. (y/N)` (board, design
   CS9). `y` writes; `n`, `enter` and `esc` close the box and write nothing.
4. **Writing** (an effect): the file is read again, and must be the very bytes the screen holds
   (its SHA-256); the change is applied and written as `zekno settings set` writes (research R5).
   Then the screen reads the file again and shows the new value, with its mark (US3, scenario 2).
   Refused: the box closes, the screen reads the file again, and the status line says why (CS12,
   CS13, CS14 as an error notice). Nothing contacts a server, and nothing is deployed (FR-025).

`esc` at any point closes the box and changes nothing.

## The Compose text (`c`)

The service pane's place shows a pane titled `Compose text` with the file's name dim on the right,
holding the Compose text the settings turn into (`composeText`, all services), line by line, dim,
as the board `CmdSettings` draws the command's output. `↑` `↓` scroll it when it is taller than
the pane. The Services pane stays.

## States no board shows

Each draws the header and, in place of the two panes, one pane holding the sentence, and the hint
line `esc back`:

| State | Sentence |
|---|---|
| The folder has no settings file and no Compose file applies | SH1 |
| The folder deploys a Compose file (`compose.yaml`, or one its link names) | SH2 |
| The folder is linked to another app or server | AS6 |
| The file has a fault | its two sentences: the first bold, the rest dim on the next line (`<file> could not be read as settings.` then the place and rule; or the two of SL) |

Further:

- **Both files, not linked**: the settings are shown and can be changed; `d` says DP5 on the
  status line and deploys nothing (contracts/deploy.md).
- **Edited elsewhere**: while no change is open, the file is read again on every refresh (every 5
  seconds, as the app screen reads what is running), and the screen shows what it holds now,
  the selection kept on the same row number within the service's rows. A change confirmed after
  the file changed is refused (CS12). The last deploy's text is read again only when the screen
  opens and when a deploy of this app ends.
- **80 by 24**: the Services pane keeps its 22 columns; the service pane takes the rest. When its
  rows do not fit, it shows a window of them that keeps the selected row in view, with
  `↑ <n> more` above and `↓ <n> more` below, dim, as lists of single commands do. During a change
  only one section is drawn, which fits. The header shows the state alone.
- **Too small** (below 80 by 24): the app's "too small" message, as on every screen; the screen and
  an open change come back as they were.
- **A light terminal**: every colour comes from the theme (`useTheme`): brand, warning, dim, the
  text colour. Nothing is drawn in a fixed colour.
- **Opening it**: the file is read when the screen opens; until the read comes back the service
  pane is empty, as the app screen's panes are before their data.

## Words

| Id | Words |
|----|-------|
| AS1 | `A change is written to the file. It runs after the next deploy.` (design) |
| AS2 | `One app, one file: zekno.app.json` (board) |
| AS3 | `! changed, not deployed (was <old>)` (design); `! changed, not deployed` when the last deploy had no such setting |
| AS4 | `Change a setting` (board) |
| AS5 | `now`, `new` (board) |
| AS6 | `This folder is linked to <app> on <server>. Its settings are on that app's screen.` |
| AS7 | ``Add one with `zekno settings set <svc>.plain.<NAME> <value>`.`` / ``Add one with `zekno settings set <svc>.volumes.<name> <path>`.`` (an info notice) |

The words of a setting that is not set (dim; also the `<old>` and `<new>` of a change):

| Row | Words |
|---|---|
| `start` | `the image's own` (design.md's table) |
| `restart` | `no` |
| `memory`, `cpus` | `no limit` |
| `port`, `secrets`, `plain`, a volume | `none` |
| `published` | `not published` (board) |

The questions: `Image`, `Start command`, `Restart rule`, `Memory limit` (board), `Processor
limit`, `Port`, `Published port`, `Secrets` (names separated by `,`), `<NAME>` for a plain
variable, `Mount path for <vol>` for a volume. The labels after `<svc> · ` are those of
contracts/commands.md, "Each setting's words".

## Key table (read by `apps/cli/test/docs/docs.test.ts`)

| Key | Where | Does |
|-----|-------|------|
| `e` | App | Open the app's settings, from this folder's `zekno.app.json` |
| `c` | Settings | Show the Compose text the settings turn into, or the settings again |
| `y` | Settings, a change | Write the change to `zekno.app.json` |
| `n` | Settings, a change | Keep the value, write nothing |

## Tests

- **The reducer** (`test/app/settings-state.test.ts`): every key of the table in every state;
  `e` on the app screen pushes the screen and asks for `read-settings`; typing, refusing, the
  empty value, the same value, picking, asking, `y` asks for `write-setting` with the SHA-256 the
  view holds, `n` and `esc` ask for nothing; `tab` wraps; the selection stays on rows; nothing in
  the state holds a secret's value; the tick on this screen asks for `read-settings` (not the
  last deploy) only with no change open.
- **The screen** (`test/app/settings-screen.test.tsx`, through `AppView` as the other screens are
  drawn): the board `AppSettings` line by line at 100 by 30 for design.md's file with the memory
  changed since the last deploy (rows, labels, marks, foot, hints, the header); the board
  `AppSettingsEdit` at the asking step; the typing step with a refused value; picking; each
  state of "States no board shows"; the Compose text view; 80 by 24 with the window and its
  `more` lines, every line at most 80 columns and at most 24 lines; too small; drawn with the
  light theme, every colour from the theme.
- **The effects** (`test/app/settings-effects.test.ts`): reading in a folder of each kind
  (settings, Compose, both, none, linked elsewhere, a fault); the marks from a history with a
  settings deploy, with a Compose deploy (none), with none (none); writing: the file is the
  file with that one change; a file changed since it was read is not written and CS12 comes
  back; a symbolic link, CS13; the keychain is never read (a key store that throws) and no
  server is contacted.
- **The app screen**: its hint line at 100 by 30 and 80 by 24 with `e settings`
  (`test/app/app-operate.test.tsx`, research R7).

## As built

Settled while building the screen (tasks T041 to T046), each the smallest thing that keeps the
board, the contract's words and feature 004's look. The maintainer reviews them on the real
program.

### Showing the settings (US2)

1. **The row's columns.** The first drawing put the label 4 columns in and the value at column
   15. The board's grid (16 px marker, 96 px label, 8 px gaps) and this contract's own words ("a
   marker column of 2 ... padded to 11") give the label at column 2 and the value at column 13,
   as feature 004's panes draw a 16 px marker column (`Marker`, 2 columns). Built as the board
   and the words; the drawing above is the screen's own render.
2. **The Services pane** is 22 columns from border to border, as this contract says (the first
   drawing showed 24). Its title has no empty line under it, unlike the panes of feature 004
   whose boards put 10 px there: on this board the Services pane's 10 px and the service pane's
   8 px (2 px gap and 6 px above `Source`) keep `❯ web` level with `Source`, so both are drawn
   with none (`Pane`'s new `gap`, 0 here, 1 everywhere else as before).
3. **The header's right side** is drawn by the same parts as the app screen: `● running deploy 4`
   with one space between, as the app screen draws it today (its tests pin one space); the first
   drawing showed two.
4. **A label longer than 10 columns** (a volume's name can be 63) widens the label column to fit,
   up to half the pane; a longer one is cut with `…`. A value that does not fit goes on under
   itself from the value column, broken at a space (`wrapPieces`, the same breaking as single
   commands).
5. **The window's `more` lines** count lines hidden, a section's heading and a value's second line
   included, since the window is of lines (`listWindow` over the lines drawn, keeping the selected
   row's first line in view). At 80 by 24 the window of design.md's file starts
   `↓ 5 more`. The Services pane is a window the same way when its services do not fit (up to 32).
6. **A sentence in place of the settings** (SH1, SH2, AS6) is drawn as a fault is: its first
   sentence bold, the rest faint on the next line, so SH1 reads `This folder has no settings
   file.` then `Run zekno settings init to start one.`; SH2 is one sentence, bold. The pane has
   no title and a faint border (nothing in it takes keys), and fills the panes' room.
7. **Before the first read** the Services pane shows its title and AS2, and the service pane is a
   pane with nothing in it; the hints are those of showing the settings, and `d` deploys.
8. **The file named on the right** is the settings file as the deploy names it, relative to the
   folder the app was started in (`deploy/zekno.app.json` for a link that names one there).
9. **A deploy that ends** with a settings screen of that app anywhere in the stack reads the last
   deploy again (`read-settings` with `deployed: true`), so its marks are right when the person
   comes back to it from the deploy screen.

### Changing a value (US3)

10. **The SHA-256 a write is checked against** is kept in the change itself (`ScreenChange.sha256`,
    not in data-model.md's type): the file's as it was when the change was opened. A read that
    comes in while the change is open does not move it, so a change confirmed after the file was
    edited elsewhere is refused with CS12 whatever was read meanwhile.
11. **`next.value` is the value as typed** (a string; undefined removes the setting), not the
    value read: the effect applies it to the file as read again with `applyChange`, exactly as
    `zekno settings set` applies its argument.
12. **`y` closes the box at once** and asks for the write; the result reads the file again
    (written: the new value with its mark; refused: the reason on the status line). A second `y`
    typed ahead finds no question and writes nothing. `n`, `enter` and `esc` close it with nothing
    written, so a key typed ahead never writes (the app's own rule for its y/N questions).
13. **A symbolic link is never written through.** The reader follows a link that stays inside its
    folder, so the write effect looks at the file's own name (`lstat`) and refuses a link with
    CS13, the file it leads to untouched. Then the bytes must be those the change was opened on
    (CS12); the settings writer checks them once more right before the rename.
14. **The typed question** is drawn as on the board, the question bold (`TextQuestion` draws it
    in the text colour, so the line is built from pieces in its look). A value longer than about
    two lines of the box shows its end after `…`, so the cursor stays in view; up to 4096
    characters can be typed (a list of secret names, 256 × 130).
15. **The box's title** `Change a setting  <svc> · <label>` is its first line inside the box, as
    on the board, not in the top border as `Confirm` draws its title. The box's border is
    `Confirm`'s round border, in the brand colour. `now` and `new` are padded to 5; a value goes
    on under itself and takes at most 3 lines, the last ending with `…`. The board's 6 px between
    the box's lines are no empty line.
16. **The list of restart rules** is drawn as a list of single commands draws a row with no detail:
    two spaces, the marker, the rule bold when chosen and faint when not.
17. **`n keep <now>`**: a value wider than 24 columns is cut with `…` in the hint line.
18. **While a change is open** only its own keys and Ctrl-C do anything, as with every question
    of the app: `q` and `?` do nothing while picking or asking, and type into the value while
    typing. The section's rows are a window as well when they do not fit (a service can have 128
    plain variables). The pane's border is faint and its title bold in the text colour (`Pane`'s
    new `dimTitle`).
19. **A read that can no longer show settings** (the file was removed, or now has a fault) closes
    an open change; the sentence stands in the settings' place.
