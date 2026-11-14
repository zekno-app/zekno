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
| `esc` | Everywhere but Home | Go back. On Deploy, the deploy carries on. At the hidden prompt before a deploy, back to the list of missing values; on that list, the question "deploy without them?" |
| `d` | Home, App | Deploy this folder. A linked folder deploys only to its own app on its own server (on a server with no apps, only when that server is its own); with another app or server selected, it says so and deploys nothing. One exception: on its own server, a linked app that has never been deployed there has no row to select, so `d` deploys it as its first deploy whichever row is marked |
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
- **Linked folder**: with a `zekno.json` this machine accepted (data-model.md, "When a project
  file is used"), Home opens with that server and app selected. One that was not made or accepted
  here selects nothing: Home opens as it would without it, the line above the key hints says
  "zekno.json here names &lt;app&gt; on &lt;server&gt;. It was not made or accepted on this
  machine. Run `zekno link` to accept it." (the file's path in place of "zekno.json here" when it
  is in a folder above), and `d` in that folder deploys nothing and offers nothing: it says the
  same again. One that names a server this machine is not connected to selects nothing either.
- **Refresh**: server and app state are read when a screen opens and every 5 seconds while Home
  or App is showing (Home reads every server, App its own). Nothing refreshes while a question
  is open, below 80 by 24, or while the app is quitting. The reads go over one session per
  server, kept open while the app runs (research R16): the connection the app makes to each
  server when it starts, where SSH may ask (R10), checked once to be the right server on the
  team, then `status` and `state` over it each time. A read adds no SSH login. One read per
  server at a time.
- **A read that fails or hangs**: a read with no answer within 20 seconds, or a session that
  ends, closes that session and shows the server as unreachable at once, with the reason. Its
  state is never left looking current.
- **Reconnecting**: a server whose session was lost is connected to again in the background,
  in SSH's batch mode only (it never asks and never hands the terminal over), at most once
  every 30 seconds, and only while the screens above refresh. Where SSH would have had to ask,
  it is not tried in the background again until something connects to it on purpose (start,
  deploy, rollback, logs, update, add). Deploys, rollbacks, secrets and logs use connections of
  their own, never the kept session. A runner from before sessions has no session to keep and
  is not read in the background. After `u` updates a runner, its server's session is opened
  again on purpose. Every kept session is closed when the app closes, on `q`, an error or a
  signal.
- **Unreachable server**: marked as such; its apps show their last deploy numbers from the
  local history and "unknown" for state. Other servers are unaffected.
- **Deploy numbers**: once a server has answered, Home's deploy column, the app header and
  "running now" use the runner's last accepted deploy of each app. A deploy is "running now"
  only when every service runs, its number is the runner's last accepted one, and it started;
  a latest deploy that did not start is "✖ did not start" and nothing is marked running now.
- **Deploy from the app**: needs a linked folder or a Compose file in the current folder. With
  neither, the app says so and names `zekno link`. A linked folder deploys only to its own app
  and server: with another selected, `d` says "This folder is linked to &lt;app&gt; on
  &lt;server&gt;. Select it to deploy this folder. To deploy it elsewhere, run `zekno deploy
  --app <name> --server <name>` here." and deploys nothing. A linked app that has never been
  deployed to its own server cannot be selected there, so on that server `d` deploys it as a
  first deploy whichever row is marked; no other app is replaced. The Compose file is read once, when
  `d` is pressed; the names listed and the text signed come from that read, also after a
  question.
- **Missing values**: before a deploy, names the Compose file expects that have no secret are
  listed (at most 64; as many as fit are drawn around the marked one, and "and &lt;n&gt; more"
  says how many are not); each can be set, or the deploy can go ahead without them. At the
  hidden prompt (`enter save`, `esc cancel`), esc closes the prompt only and returns to the
  list; nothing is signed. On the list (`↑↓ move`, `enter set`, `esc deploy without them`), esc
  asks "Deploy &lt;app&gt; to &lt;server&gt; without &lt;NAME&gt;?" (or "without &lt;n&gt;
  values?") with `y deploy` and `n do not deploy`. `y` goes ahead without them; `n`, or esc on
  the question, ends the deploy with nothing signed, back on the screen `d` was pressed on, with
  "Nothing was deployed.".
- **Leaving and quitting during a deploy**: `esc` returns to the previous screen and the result
  arrives as a line there; `q` shows "waiting for deploy <n> to finish" and closes when it ends.
- **SSH questions**: if SSH has to ask for a password or a host key, the app hands the terminal
  over and takes it back when the connection is up.
- **Closing**: the terminal is restored as it was, including after an error.

## The fourth canvas row

Approved by the maintainer on 2026-11-14 and built as drawn: Help; Home at 80 columns; One app
at 80 columns; Terminal too small; Home on a light terminal; Two questions the app asks; Profile
could not be verified. A selected row is shown by the marker and bold text, with no shaded bar.
