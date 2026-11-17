# Templates as built

Thirteen screens of `zekno add`, captured from the real program on 2026-11-18 (branch
`012-templates`) in a pseudo-terminal of 100 by 30 or 80 by 24, and turned into boards by a
script. They are the row "Templates as built" of the design canvas
(https://claude.ai/artifact/BVuvZPZTReLa4TSHfyzMJW). Nothing in them was edited by hand. The
first line of each, `$ zekno ...`, is the driver's echo of the command.

They show what the approved boards did not, and where the program differs from them. The
walkthrough's full record (134 captures, each compared with its board) is in
`../../quickstart.md`, "The pseudo-terminal walkthrough".

| Board | Shows |
|---|---|
| `BuiltAddReaders.dc.html` | The question about which services read the new secret; rows start two columns in |
| `BuiltAddAdded.dc.html` | `zekno add postgres` from the question to the result; the summary starts with `✔ Read by  web` |
| `BuiltAddMongo.dc.html` | MongoDB's summary: a secret name longer than its column takes a line of its own |
| `BuiltAddIN6.dc.html` | A Compose file beside the settings file: the note before the summary |
| `BuiltAddPicker.dc.html` | `zekno add` with no template: the picker; rows start two columns in |
| `BuiltAddList.dc.html` | `zekno add --list` |
| `BuiltShowRedis.dc.html` | `--show` for Redis: the whole digest and the start command go on under their column |
| `BuiltShowMongo80.dc.html` | `--show` for MongoDB at 80 columns |
| `BuiltHand.dc.html` | The lines for a Compose file written by hand, the question and the result |
| `BuiltHandRedis80.dc.html` | Redis's lines at 80 columns: long lines go on inside the box from its first column |
| `BuiltHandPiped.dc.html` | The same lines piped, with `--yes`: no box, no volume line |
| `BuiltAddAD29.dc.html` | A service that already reads that secret: the sentence added after the security review |
| `BuiltAddSH4.dc.html` | A `zekno.json` not in use on this machine names another file |

## Where the program differs from the approved boards

1. `--show` prints the whole digest, so the image line goes on under its column at 100 and at 80
   columns. The board shortens the digest.
2. The rows of the picker and of the readers question start two columns in, as every list of
   the CLI does. The board draws the marker at the edge.
3. When the readers question was asked, the summary starts with `✔ Read by  <services>`. The
   board starts at the heading.
4. Blocks follow each other with no empty line between them. The board spaces them.
5. Esc at the picker or at the readers question leaves the question's line above `Nothing was
   added.`.
6. The readers question is asked before the check that refuses a service which already reads the
   secret, so a person answers a question and is then refused whatever they answered.
7. A command's colours do not change on a light terminal: single commands never ask the terminal
   for its background.

They are drawn with the terminal's own box characters, as the program draws them.
