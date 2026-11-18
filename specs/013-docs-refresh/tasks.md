# Tasks: README and docs refresh

**Input**: `specs/013-docs-refresh/` (spec.md, plan.md, research.md, data-model.md, contracts/, design/)

**Tests**: included. The constitution asks for a check on everything that can drift, and this feature's whole point is that docs stop drifting.

**Rules for every task**: no file under `apps/cli/src`, `apps/runner`, `packages/core`, `apps/cli/tests` or `apps/cli/e2e.config.ts` changes. `apps/cli/.env.local` is never read. No package is added. `next dev` and `next build` are never run. Ports 3000 and 3100 are not used. No code file over 500 lines. The desktop app is named nowhere.

## Phase 1: Setup

- [x] T001 Read the installed Fumadocs docs for the page tree's `meta.json` and for MDX components (`node_modules/fumadocs-*`, `node_modules/@fumadocs/*`), and Next's guide in `apps/web/node_modules/next/dist/docs/` for reading a file in a server component; note what differs from `research.md` §6 in `specs/013-docs-refresh/research.md`
- [x] T002 Save the old CLI page for the comparison at the end: `git show dev:apps/web/content/docs/cli.mdx` and `git show dev:apps/cli/README.md` into the scratchpad (not the repository)

## Phase 2: Foundational (the file format both sides share)

- [x] T003 [P] Write `apps/cli/test/screens/format.ts`: the terminal's text to rows of runs with the looks of `contracts/screens.md` (bold, dim, brand, green, yellow, red; an unknown colour throws with its name), trailing spaces removed, and the stored file written one row per line; with `apps/cli/test/screens/format.test.ts`
- [x] T004 [P] Write `apps/web/modules/docs/lib/screens.ts`: reads `apps/web/content/screens/<name>.json`, checks every field of `contracts/screens.md` by hand (no package), throws with the screen's name when the file is missing or unsound; with `apps/web/modules/docs/lib/screens.test.ts` on files made in a temporary folder

## Phase 3: User Story 4 - See the CLI before installing it (P2, built first because US1 and US2 show its screens)

**Goal**: real screens, stored as text, kept true by a test, shown in a frame.

**Independent test**: change a word a screen prints; `bun test test/screens` names the screen.

- [x] T005 [US4] Write `apps/cli/test/screens/capture.ts`: finds the recipes, runs each in a child process with `FORCE_COLOR=3`, writes `apps/web/content/screens/<name>.json`, or with `--check` writes nothing and names each screen that differs with its first differing row; add the script `"screens": "bun test/screens/capture.ts"` to `apps/cli/package.json`
- [x] T006 [US4] Recipe `apps/cli/test/screens/recipes/first-deploy.ts`: `zekno deploy` from nothing against the stand-in server, example values only, every value that differs between runs fixed and listed under `fixed` (the stand-in runner's size and the times must not show a value no real run shows)
- [x] T007 [P] [US4] Recipe `apps/cli/test/screens/recipes/home.ts`: the app's Home, 100 × 30, one server and one deployed app
- [x] T008 [P] [US4] Recipe `apps/cli/test/screens/recipes/settings-screen.ts`: the app's settings screen for `shop`, 100 × 30
- [x] T009 [P] [US4] Recipe `apps/cli/test/screens/recipes/add-postgres.ts`: `zekno add postgres` at a terminal, after the service is added
- [x] T010 [P] [US4] Recipes for the wanted screens `settings`, `status`, `doctor`, `help`, and for `secrets`, `server-add`, `app-detail` where they can be drawn without touching `apps/cli/src`; report each that cannot, with the reason
- [x] T011 [US4] Write `apps/cli/test/screens/svg.ts` and have the command write `.github/assets/screen-home.svg` from `home.json`: cells placed by column, box-drawing characters as lines, a `<title>` with the description
- [x] T012 [US4] Write `apps/cli/test/screens/screens.test.ts`: runs the check in a child process, fails naming each screen that drifted, and fails when the SVG differs from what `home.json` gives
- [x] T013 [US4] Run `bun run screens` twice; the second run changes no file (SC-005). Read every stored screen: example values only, nothing from this machine (no home folder, no user name, no temporary path)
- [x] T014 [P] [US4] Write `apps/web/modules/docs/components/screen.tsx` as on the board `DocsFrame` and in `contracts/screens.md`, "The frame in the docs"; register `Screen` in `apps/web/modules/docs/components/mdx.tsx`
- [x] T015 [US4] Check the frame by eye: a static preview of the component's markup with the site's fonts and tokens, in headless Chrome at a wide and at a 390px window, beside the board; fix what differs

## Phase 4: User Story 3 - Find the page for one command (P2)

**Goal**: seventeen pages in three groups, nothing lost.

**Independent test**: any command of the help is reached in two clicks from `/docs`.

- [ ] T016 [US3] Write `apps/web/modules/docs/lib/pages.test.ts` with the six checks of `contracts/pages.md` (length, tree, links, move list, no desktop app, callout), and the check that pages and stored screens agree
- [ ] T017 [US3] Split `apps/web/content/docs/cli.mdx` into the pages of `contracts/pages.md`: `install`, `app`, `deploying`, `servers`, `secrets`, `settings`, `changing-settings`, `project-file`, `doctor`, `output`, `storage`, moving text as it is (rules 4 and 5)
- [ ] T018 [US3] Move "zekno add" into `apps/web/content/docs/templates.mdx`, before the list of templates
- [ ] T019 [US3] Rewrite `apps/web/content/docs/cli.mdx` as "Commands": every command of the help, one line each, a link to where it is described
- [ ] T020 [US3] Write `apps/web/content/docs/meta.json` with the three groups in order
- [ ] T021 [US3] Fix every link in `apps/web/content/docs/runner.mdx`, `apps/runner/README.md`, `CONTRIBUTING.md` and the pages themselves that pointed into the old page
- [ ] T022 [US3] Write `specs/013-docs-refresh/move-list.md`: one row per old heading, then "Reworded" and "Dropped"
- [ ] T023 [US3] Rework `apps/cli/test/docs/docs.test.ts` for the new set of files (`contracts/pages.md`, "The tests"); take one flag out of a page and see it fail, then undo
- [ ] T024 [US3] Compare every non-empty line of the old page (T002) with the new pages: each is found, or is under "Reworded" or "Dropped" in the move list

## Phase 5: User Story 2 - Try it, from nothing to a live app (P1)

**Goal**: one page from a checkout to a running app.

**Independent test**: the page alone is enough to end with an app running.

- [ ] T025 [US2] Write `apps/web/content/docs/quick-start.mdx` as on the board `DocsQuickStart`: what you need, build, `zekno deploy` with the screen `first-deploy` and what happened, `zekno` with the screen `home`, what next. Every requirement it states is checked against `install.mdx` and the reference pages
- [ ] T026 [US2] Rewrite `apps/web/content/docs/index.mdx`: what Zekno is, what works today, limits, a deploy as it happens today, the hosted service as planned in a few lines, links to the quick start and the groups
- [ ] T027 [US2] Write `apps/web/content/docs/security.mdx` from today's introduction (trust table, steps, limits), with the CLI as the program on your machine and a link to the README's full model
- [ ] T028 [US2] Place the screens in their pages (`contracts/screens.md`, "Used on") with a caption each

## Phase 6: User Story 1 - Understand the project from the README (P1)

**Goal**: the README tells what works today from what is planned.

**Independent test**: a reader new to the project says what they could run today.

- [ ] T029 [US1] Rewrite the top of `README.md` as on the board `ReadmeTop`: badges, warning, the picture, "What works today", "Try it"
- [ ] T030 [US1] "How it works" in `README.md`: today's path as a Mermaid diagram first, then the planned design under its own heading with the CLI as the program on your machine
- [ ] T031 [US1] The security model in `README.md`: every row and rule kept; the desktop app's sentences replaced as in `contracts/readme.md`; rule 1 worded only as far as the code shows it true
- [ ] T032 [US1] "Repository", "Develop" and "Roadmap" in `README.md` as in `contracts/readme.md`
- [ ] T033 [US1] Compare the security model before and after, row by row and rule by rule; write each changed sentence, old and new, into `specs/013-docs-refresh/move-list.md` under "The security model's wording"

## Phase 7: User Story 5 - One place for each fact (P3)

**Goal**: the CLI's README is a developer's guide.

**Independent test**: a sentence about a command's behaviour is found in one page of the docs and nowhere else.

- [ ] T034 [US5] Compare each section of `apps/cli/README.md` that is to go with the docs; move what the docs lack to the right page and note it in the move list under "From the CLI's README"
- [ ] T035 [US5] Cut `apps/cli/README.md` to the five sections of `contracts/readme.md`, under 250 lines, with "Screens for the docs"
- [ ] T036 [US5] Update `apps/cli/test/docs/contributing.test.ts` and any test that read the removed sections

## Phase 8: Polish and checks

- [ ] T037 Run every check of `quickstart.md`; fix what fails
- [ ] T038 Compare the changed files with `dev`: nothing under the paths of "Rules for every task"
- [ ] T039 Read every new page once from top to bottom as a newcomer: a link that goes nowhere useful, a "see above" that points at nothing, a claim that something planned exists
- [ ] T040 Write "As built" at the end of `specs/013-docs-refresh/plan.md`: what differs from the plan, the screens that could not be drawn, what is left
- [ ] T041 Update the road map and the feature map (013 before domains, which becomes 014)
- [ ] T042 Merge into `dev` locally after the checks pass. Push nothing

## Maintainer steps (not tasks for the implementer)

1. Read the reworded security rules (`contracts/readme.md`, "The desktop app's sentences").
2. Look at the running site and at the README on GitHub.
3. Decide about the landing page, which still names the desktop app.
4. Say when to push.

## Dependencies

- Phase 2 before phases 3 and 4. T003 and T004 share only the format in `contracts/screens.md`, so they run in parallel.
- In phase 3, T005 before the recipes; T006 to T010 in parallel; T011 after T007; T012 after the recipes. T014 and T015 need only T004.
- Phase 4 needs the screens' names, not the screens. Phase 5 needs phases 3 and 4. Phase 6 needs T007 and T011 and the pages' addresses. Phase 7 needs phase 4.
- Phases 5 and 6 run in parallel: they touch different files.

## Implementation strategy

Screens first, because the two most important pages (the README and the quick start) show them. Then the split, which is the largest and most mechanical part and is checked line by line. Then the new writing. Each part is verified before the next starts, and nothing is merged until every check of `quickstart.md` passes.
