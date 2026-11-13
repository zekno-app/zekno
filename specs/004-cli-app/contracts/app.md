# App Contract

The canvas is the reference for how each screen looks and reads:
https://claude.ai/artifact/BVuvZPZTReLa4TSHfyzMJW. This page records what each screen does, its
keys, and what the canvas does not show.

## Screens

| Screen | Canvas board | Opens from | Shows |
|--------|--------------|------------|-------|
| Home | Home | Start, when a team exists | Servers; the selected server's apps with deploy number, state and when; the selected app's details and actions; whether this folder is linked |
| App | One app: deploys and secrets | Enter on an app | Deploy history; secrets by name and version; the selected deploy's details; a note when a secret is newer than the running deploy |
| Deploy | A deploy in progress | `d`, or `r` on an earlier deploy | Summary panel, stage row, live line; Docker's output on `o` and on failure |
| Logs | Live logs | `l` | Time, service, text; following or paused |
| First run | First run: no team yet | Start, when no team exists | The logo, the three steps, the name question |
| Add a server | Add a server | `a` on Home, or step 2 of first run | The destination and name, each install step, the two codes with what they are for |
| Set a secret | Set a secret | `s`, or before a deploy when values are missing | The names that are missing, the hidden prompt |

Every app screen has the header with the pixel wordmark (three lines) and the screen's place in
the app, and a last line listing its keys.

## Keys

| Key | Where | Does |
|-----|-------|------|
| `↑` `↓` | Lists, logs | Move the selection, or scroll |
| `←` `→`, `tab` | Home, App | Move between panes |
| `enter` | Lists, questions | Open, or confirm |
| `esc` | Everywhere but Home | Go back. On Deploy, the deploy carries on |
| `d` | Home, App | Deploy the linked folder to the selected app |
| `r` | Home, App | Roll back: on App to the selected deploy, on Home to the one before the latest |
| `l` | Home, App | Logs |
| `s` | Home, App | Set a secret |
| `x` | App, secrets pane | Remove the selected secret, after a confirm |
| `a` | Home | Add a server |
| `u` | Home, on a server whose runner is out of date | Update the runner, after a confirm |
| `o` | Deploy, Add a server | Show or hide the full output |
| `f` | Logs | Pause or resume following |
| `/` | Logs | Filter by text; `esc` clears it |
| `1`–`9` | Logs | Show one service; `0` shows all |
| `?` | Everywhere | Help for this screen |
| `q` | Everywhere but a question | Quit. Waits for a deploy in progress |
| `ctrl-c` | Everywhere | As `q`. In the hidden prompt it cancels the prompt only |

A key that does nothing on the current screen is ignored. While a text question is open, letter
keys type into it.

## Behaviour

- **Start**: the profile is verified before anything is drawn. A profile that does not verify
  is an error screen with the reason and no actions.
- **Linked folder**: with a `zekno.json`, Home opens with that server and app selected.
- **Refresh**: server and app state are read when a screen opens and every 5 seconds while Home
  or App is showing. Nothing refreshes while a question is open.
- **Unreachable server**: marked as such; its apps show their last deploy numbers from the
  local history and "unknown" for state. Other servers are unaffected.
- **Deploy from the app**: needs a linked folder or a Compose file in the current folder. With
  neither, the app says so and names `zekno link`.
- **Missing values**: before a deploy, names the Compose file expects that have no secret are
  listed; each can be set, or the deploy can go ahead without them.
- **Leaving and quitting during a deploy**: `esc` returns to the previous screen and the result
  arrives as a line there; `q` shows "waiting for deploy <n> to finish" and closes when it ends.
- **SSH questions**: if SSH has to ask for a password or a host key, the app hands the terminal
  over and takes it back when the connection is up.
- **Closing**: the terminal is restored as it was, including after an error.

## The fourth canvas row

Approved by the maintainer on 2026-11-14 and built as drawn: Help; Home at 80 columns; One app
at 80 columns; Terminal too small; Home on a light terminal; Two questions the app asks; Profile
could not be verified. A selected row is shown by the marker and bold text, with no shaded bar.
