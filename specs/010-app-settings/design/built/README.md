# App settings as built

Twelve screens the approved boards did not show, captured from the real program on 2026-11-17
(branch `011-settings-polish`) in a pseudo-terminal, and turned into boards by a script. They
are the row "App settings as built" of the design canvas
(https://claude.ai/artifact/BVuvZPZTReLa4TSHfyzMJW).

The maintainer dropped the approval step for this stage and asked for these screens to be
settled by recommendation. They were reviewed against the look of feature 004's boards; five
things were changed first (`specs/010-app-settings/contracts/app-screen.md`, "As built"): a row
always shows under its section heading, a row is never cut in the middle, a mark stays with its
words, a refusal goes when the value changes, and the app's first-use question names the file.

| Board | Shows |
|---|---|
| `BuiltSettings80.dc.html` | The settings screen at 80 by 24, scrolled: the heading kept over its rows |
| `BuiltRemoved.dc.html` | A variable, a volume and a service removed since the last deploy |
| `BuiltLongValue.dc.html` | A long start command, cut with a mark |
| `BuiltLongChange.dc.html` | Changing a long value: the part that differs |
| `BuiltCompose.dc.html` | The Compose text behind `c` |
| `BuiltNotSet.dc.html` | Settings that are not set, in their words |
| `BuiltFault.dc.html` | A settings file that cannot be read |
| `BuiltNoFile.dc.html` | A folder with no settings file |
| `BuiltChangedBehind.dc.html` | `d` after the file changed behind the screen: nothing deployed |
| `BuiltRefused.dc.html` | A value refused while changing a setting |
| `BuiltRestart.dc.html` | Picking a restart rule from a list |
| `BuiltFirstUse.dc.html` | The first-use question in the app, naming the file |

They are drawn with the terminal's own box characters, as the program draws them.
