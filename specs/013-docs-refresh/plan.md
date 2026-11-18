# Implementation Plan: README and docs refresh

**Branch**: `013-docs-refresh` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: `specs/013-docs-refresh/spec.md` and the six approved boards in `design/`.

## Summary

The root README says what works today before the planned design. The one long CLI page of the docs becomes seventeen pages in three groups. The docs show the CLI's real screens: a command in the repository draws each screen with the stand-ins the tests already use, stores it as text with its colours, and a test fails when a stored screen no longer matches the program. The CLI's README becomes a developer's guide. The desktop app is named nowhere.

No behaviour of the CLI, the runner or the core library changes, and no package is added.

## Needs the maintainer

Nothing blocks the work. Three things are the maintainer's to decide afterwards:

1. **The landing page** still names the desktop app in six places (`apps/web/modules/landing/content/index.ts`). It is outside this feature and is not changed. Changing it is a design decision.
2. **Reworded security rules.** Three design rules and one table row named the desktop app. Their new wording is in [contracts/readme.md](contracts/readme.md), "The desktop app's sentences", for the maintainer to read.
3. **Pushing.** Nothing is pushed or merged to `main` without the maintainer saying so.

## Design choices, approved by the maintainer (2026-11-18)

| Choice | Decision |
|---|---|
| Pages | Seventeen, in three groups: Start, Using zekno, Reference. Names and order as on the board `DocsTree` |
| A screen in the docs | The site's code-block box holding real output: title on the left, the command or the size on the right, a caption under it. Selectable text, sideways scroll inside the box, no window buttons |
| The README's top | Warning with what works today, one screen, "What works today", "Try it", today's path drawn before the planned design. A badge "audit: none yet" |
| The README's picture | An SVG file made from the same stored screen as the docs' frame |
| Roadmap | The order of the road map |
| Desktop app | Not named in the README or the docs |

## Technical Context

**Language/Version**: TypeScript on Bun 1.4.4, as the repository is.

**Primary Dependencies**: none added. The docs site keeps Fumadocs (`fumadocs-core` 16, `fumadocs-mdx` 15, the notebook layout), Next.js 16, Tailwind CSS 4. Screens are drawn by the CLI's own Ink interface through the stand-ins of `apps/cli/test/support`.

**Storage**: files. One JSON file per screen in `apps/web/content/screens/`, one SVG in `.github/assets/`.

**Testing**: `bun test` in `apps/cli` and in `apps/web`.

**Target Platform**: the docs site (static pages), GitHub's rendering of Markdown.

**Project Type**: documentation, with one small component and one capture command.

**Constraints**: no page of the docs over 500 lines; no code file over 500 lines; the site is never started or built from here (`next dev` and `next build` are not run); captures never reach a real server, the network, the keychain or the person's profile.

**Scale/Scope**: about 2,500 lines of docs moved, about 400 lines newly written, eight to eleven screens.

## Constitution Check

| Principle | How this feature meets it |
|---|---|
| I. Security Promise First | Every promise, limit, table row and design rule of the security model stays (FR-006). Rewordings are listed one by one. Captures use stand-ins only (FR-022) |
| II. Honest Surface | The main point of the feature: what is built is told from what is planned. A test refuses the desktop app's name |
| III. Read the Installed Docs First | The page tree's file (`meta.json`) and MDX components are written after reading Fumadocs' and Next's docs in `node_modules` |
| IV. One Design System | The frame reuses the site's code-block look and tokens. No new colour scheme beyond the terminal's own colours inside the frame |
| V. Motion With Purpose | No motion is added |
| VI. Accessible and Fast by Default | Each screen has a description for readers who cannot see it; the scrolling frame can be reached by keyboard; frames are plain server-rendered text |
| VII. Verified Before Done | Tests for links, page length, screens in step with the program, docs in step with the CLI. Full checks at the end |

No violation, so nothing to justify under Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/013-docs-refresh/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md, tasks.md
├── checklists/requirements.md
├── contracts/
│   ├── pages.md      # the page tree, each page's source, the rules of the move list
│   ├── screens.md    # the screens, the file format, the command, the tests
│   └── readme.md     # both READMEs section by section, the desktop app's sentences
├── move-list.md      # written while splitting: each old heading and where it went
└── design/           # the six approved boards
```

### Source Code (repository root)

```text
README.md                                  # rewritten top, kept security model
.github/assets/screen-home.svg             # made by the capture command
apps/cli/
├── README.md                              # cut down to a developer's guide
├── package.json                           # one script added: "screens"
└── test/
    ├── docs/docs.test.ts                  # reads the new set of pages
    └── screens/
        ├── capture.ts                     # the command: draw, store, or --check
        ├── format.ts                      # terminal text to runs, runs to the stored file
        ├── svg.ts                         # a stored screen to an SVG
        ├── recipes/<name>.ts              # one file per screen: how it is drawn
        └── screens.test.ts                # fails and names a screen that drifted
apps/web/
├── content/
│   ├── docs/
│   │   ├── meta.json                      # the three groups and the order
│   │   └── *.mdx                          # seventeen pages
│   └── screens/<name>.json                # one stored screen each
└── modules/docs/
    ├── components/screen.tsx              # the frame
    ├── components/mdx.tsx                 # registers <Screen>
    └── lib/
        ├── screens.ts, screens.test.ts    # reads and checks a stored screen
        └── pages.test.ts                  # length, links, tree, move list, no desktop app
```

**Structure Decision**: the capture command lives under `apps/cli/test/` because it is built from the test stand-ins and is not part of the shipped program; nothing under `apps/cli/src` changes. The stored screens live inside `apps/web` so the site's hosting build finds them without reaching into another app.

## What does not change

- `apps/cli/src`, `apps/runner`, `packages/core`: no file.
- `apps/cli/e2e.config.ts`, `apps/cli/tests/`, `apps/cli/.env.local`: not read, not touched.
- The landing page, the site's layout, its colours and its framework.
- `apps/web/content/docs/runner.mdx`, `apps/runner/README.md`, `CONTRIBUTING.md`: content kept; only links that point at moved text change.
- The sentences the CLI prints.

## Phases

1. **Screens** (US4): the capture command, the recipes, the stored screens, the SVG, the test.
2. **The frame** (US4): the loader and the component in the docs site, with tests. In parallel with phase 1; the file format in `contracts/screens.md` is what they share.
3. **The split** (US3): seventeen pages, `meta.json`, the move list, the reworked docs test, the page tests.
4. **New writing** (US2, part of US1): the introduction, the quick start, the security page, screens placed in the pages.
5. **The READMEs** (US1, US5): the root README, the CLI's README. In parallel with phase 4.
6. **Checks**: full checks, the statement-by-statement comparison with the old page, as-built notes, the road map and the feature map.

## Risks

| Risk | What is done about it |
|---|---|
| A sentence is lost in the split | A script compares every line of the old page with the new pages; each line not found is reworded on purpose or on the dropped list |
| A screen cannot be drawn without changing the CLI's source | It is reported and left out. The four screens on the boards are required; the others are added only if they can be drawn as they are |
| A screen shows a value no real run shows (a stand-in runner's size, a time of 0.0s) | The recipe fixes it by a rule written in the stored file, so the reader of the repository sees every value that was fixed |
| The SVG's lines do not join in GitHub's font | Box-drawing characters are drawn as lines, not as text |
| The site cannot be started from here to look at the pages | MDX is compiled by the type check; the frame is checked in a static preview made from the component's markup; the maintainer looks at the running site |
| Fumadocs' `meta.json` differs from what is remembered | Read from the installed package's docs before writing |

## Complexity Tracking

Nothing to justify.
