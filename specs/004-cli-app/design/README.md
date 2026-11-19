# Design snapshot

A copy of the artboards on the design canvas "Zekno CLI interface"
(https://claude.ai/artifact/BVuvZPZTReLa4TSHfyzMJW) as approved on 2026-11-14, kept here so the
exact wording, layout and keys of each screen can be read without access to the canvas. The
canvas remains the reference; if it changes, this copy is refreshed.

| File | Screen |
|------|--------|
| Main.dc.html | Home |
| App.dc.html | One app: deploys and secrets |
| Deploying.dc.html | A deploy in progress |
| Logs.dc.html | Live logs |
| Welcome.dc.html | First run: no team yet |
| AddServer.dc.html | Add a server |
| SetSecret.dc.html | Set a secret |
| CmdDeploy.dc.html | `zekno deploy`: success and failure |
| CmdOther.dc.html | Status, lists, errors and piped output |
| Help.dc.html | Help |
| Home80.dc.html | Home at 80 columns |
| App80.dc.html | One app at 80 columns |
| TooSmall.dc.html | Terminal too small |
| LightHome.dc.html | Home on a light terminal |
| Questions.dc.html | Two questions the app asks |
| ProfileError.dc.html | Profile could not be verified |

One decision made after the boards were drawn overrides what they show: the action letters in
Home's details pane use `brand` on a dark terminal and `brand-darker` on a light one.

A selected row is marked by the arrow and bold text only, with no shaded bar; the boards were
updated to show this on 2026-11-14.

The logo on the boards is an SVG of a 5-row bitmap, 42 columns wide; the boards were changed from
"zekno.app" to "zekno.dev" on 2026-11-19, one column wider, and the screen's place now follows the
wordmark with no column between them, so every header keeps the room it had. In the terminal it is
drawn with half-block characters, 3 lines tall.
