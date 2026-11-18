# Research: README and docs refresh

Facts checked in the repository on 2026-11-18, and the decisions that follow.

## 1. How a screen is captured

**Decision**: draw each screen in process with the CLI's own interface and the stand-ins of `apps/cli/test/support`, in a child process started with `FORCE_COLOR=3`.

**Rationale**: the tests already do exactly this. `test/support/terminal.ts` gives `inkUi` a stand-in terminal of a given size and reads the screen back. `test/support/stand-in-server.ts` and `helpers.ts` give a stand-in server, SSH, profile and keychain. `test/support/colour.ts` reads a line back as runs (bold, dim, colour) and notes that Ink fixes how much colour it writes when it is loaded, which is why a child process is needed. Nothing is added to the repository's packages.

**Alternatives considered**: the walkthroughs' way (the compiled program in a pseudo-terminal, read by a terminal emulator written in Python). It is closer to a person's terminal, but it needs Python and an emulator kept in the repository. Rejected for a docs feature.

## 2. How a screen is stored

**Decision**: one JSON file per screen in `apps/web/content/screens/`. Each row of the screen is one line of the file, a list of runs `[look, text]`. Format in `contracts/screens.md`.

**Rationale**: plain text with its colours, readable in a diff row by row, and read by the site and by the SVG maker with `JSON.parse`, so there is no markup to escape and no parser to keep in step in two apps.

**Alternatives considered**: the raw terminal text with its escape codes (unreadable in a diff and on GitHub); a bracket markup as in the walkthrough notes (needs escaping and one parser per app).

## 3. Where the stored screens live

**Decision**: inside `apps/web`.

**Rationale**: the docs' templates list reads `../cli/src/templates/files` from the site's folder, and whether the hosting build carries that folder is still unchecked. Screens do not add a second such reach.

## 4. Values that differ on every run

**Decision**: fixed where the stand-ins allow (a key kept as a fixture gives the same fingerprint every time; example names; the address `203.0.113.10`). Where the program takes the value from a clock or from the stand-in runner's file, the recipe replaces it by a rule, and the rule is written into the stored file under `fixed`.

**Rationale**: SC-005 needs the same result twice in a row, FR-025 forbids changing the program to make that easier, and the reader of the repository must be able to see what was fixed.

## 5. The README's picture

**Decision**: an SVG written by the capture command from the stored Home screen, at `.github/assets/screen-home.svg`. Text is placed cell by cell; box-drawing characters are drawn as lines.

**Rationale**: GitHub shows an SVG as an image and loads no web font into it, so text alone would not line up. Cells and drawn lines look the same in any font. A test regenerates it and compares.

## 6. The docs' page tree

**Decision**: one `meta.json` in `apps/web/content/docs/` with the three groups as separators. To be confirmed against the installed Fumadocs docs before writing (constitution III).

**Facts**: no `meta.json` exists today; the tree comes from `source.getPageTree()`; MDX components are `defaultMdxComponents` plus `TemplateList` (`modules/docs/components/mdx.tsx`).

## 7. Addresses of the docs printed by the programs

**Fact**: `apps/cli/src`, `apps/runner/src` and `packages/core/src` print no address of the docs. FR-014's second half has nothing to check today; the page test still checks every link inside the docs and the READMEs.

## 8. The test that holds the docs and the CLI in step

**Facts**: `apps/cli/test/docs/docs.test.ts` reads the help and two contracts, and checks two files: the CLI's README and `cli.mdx`. For each it checks (a) every command, flag and key is named, (b) every command it names exists with the flags given, (c) every key in a key table exists.

**Decision**: (a) is checked over all pages of the docs taken together. (b) and (c) are checked for each page of the docs, and for the CLI's README and the root README. The CLI's README no longer has to name every command.

## 9. Where the desktop app is named today

`README.md` (14 lines), `apps/web/content/docs/index.mdx` (5 lines), the landing page's content (6 lines, outside this feature). Nowhere else outside `specs/`. Each line and its replacement: `contracts/readme.md`.
