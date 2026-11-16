# Polish of the settings screens

**Branch**: `011-settings-polish` | **Date**: 2026-11-17
**Asked for by the maintainer** on 2026-11-17: "solve the 'screens no board shows' follow your
recommends".

A compact record. Feature 010 (app settings) was built with the approval step dropped for the
screens its five boards did not show; the maintainer then handed the review of those screens to
the builder. This is what the review decided and changed.

## Kept as built

The settings screen at 80 columns, the marks for what was changed or removed since the last
deploy, the cut of a long value, the empty and broken states, the Compose text behind `c`, the
light terminal; `zekno settings` with no file drawn as an error at a terminal; the words of a
value not set inside a change; the order of the checks when both files are present with no
terminal; orphan words where a long sentence wraps; the "too small" message (feature 004's).

## Changed

1. A row is never shown without its section heading: the window of rows keeps the heading of
   the first row it shows.
2. A row is never cut in the middle: a row of several lines scrolls as one piece.
3. A mark stays with its words: the `!` never ends a line with its words starting the next.
4. A refusal goes at the first key that changes the value.
5. The first-use question of the full-screen app names the file a yes deploys when it is not
   `compose.yaml`, as the single-command question does since feature 010. This closes the
   known limit left by security review S6 of feature 010.

The exact lines are in `specs/010-app-settings/contracts/app-screen.md` and `deploy.md`, "As
built". Twelve boards made from captures of the real program are in
`specs/010-app-settings/design/built/` and on the design canvas.

## Checked

Typecheck, lint and format pass. Tests: CLI 1673 (1664 before), core 102, runner 147 with 1
skipped, web 28. The agent end-to-end tests pass 11 of 11 from their recordings. The core, the
runner, every message format and the recorded transcripts are unchanged.

## Seen and left

- On Home, after a yes to the first-use question, one wrapped line starts with a stray space
  (feature 004's screen).
- When the window of rows starts part way through the plain variables, none of the rows drawn
  carries the `plain` label.
- `zekno settings` (the command) can still end a line with a mark's `!` when a row wraps.
