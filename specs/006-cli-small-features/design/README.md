# Boards for the small CLI features

A copy of the five boards added to the design canvas "Zekno CLI interface",
https://claude.ai/artifact/BVuvZPZTReLa4TSHfyzMJW, on 2026-11-15, in its last row. Each file is
an HTML mock-up of what a terminal shows; open it in a browser beside the canvas's `support.js`,
or look at the canvas.

| Board | File |
|-------|------|
| Questions in single commands | `AskInCommands.dc.html` |
| zekno deploy from nothing | `DeployFromNothing.dc.html` |
| zekno secret import | `SecretImport.dc.html` |
| zekno doctor | `Doctor.dc.html` |
| The version, and a newer release | `Version.dc.html` |

The wording on them is the wording of `../design.md` and of the contracts, which the maintainer
approved. The boards add how it looks: the colours, what is bold and what is dim, the spacing
and the alignment, in the style of the boards "zekno deploy: success and failure" and "Status,
lists, errors and piped output" from feature 004. Where a board and `../design.md` disagree
about a word, `../design.md` is right; where they disagree about how something looks, the board
is right. The maintainer approved the boards on the canvas on 2026-11-15.

Colours: background `#0b0d10`, text `#d7dde4`, strong text `#ffffff`, dim `#8b949e`, the brand
blue `#2383e2` for `?` and `❯`, green `#3fb950` for `✔`, yellow `#d29922` for `!`, red `#f85149`
for `✖`, lines `#2a313a`. On a light terminal the same roles use the theme of
`apps/cli/src/ui/theme.ts`, as the existing single commands do.
