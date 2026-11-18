# Handoff: carry on with feature 013 in a cloud session

Written on 2026-11-18 by the session that designed and planned this feature on the maintainer's computer. The maintainer had to take the computer away, so the work continues in the cloud from this branch. This file is everything that session knew and the repository does not otherwise say. Read it whole before doing anything.

## Where things stand

- Branch `013-docs-refresh`. It is built on the local `dev`, which is ahead of GitHub's `dev`: the commit it branched from is `9ad84d3`.
- Done and approved by the maintainer: the spec, the six boards in `design/`, the plan, the contracts, the tasks.
- **No task of `tasks.md` is done.** T001 to T042 are all open. Three sub-agents were started on the first parts and stopped before they wrote a file.
- The README and the docs are as they were. No code has been written.

## What to read, in this order

1. `spec.md`: what and why. Read "Clarifications": they are the maintainer's decisions.
2. `plan.md`, `research.md`, `data-model.md`.
3. `contracts/pages.md`, `contracts/screens.md`, `contracts/readme.md`: what to build, exactly.
4. `tasks.md`: the order.
5. `design/*.dc.html`: the approved boards (HTML with inline styles; read the styles for sizes and colours). `design/README.md` says what each shows. `design/reference/*.styled.txt`: four captures of the real compiled program from earlier walkthroughs, to compare a drawn screen with by eye. Their `[names]text[/]` markup is not the stored format, and their values are not the docs' example values.
6. `AGENTS.md` at the repository's root: Next.js here is not the one you know. Read the installed docs in `node_modules` before writing for Next or Fumadocs.

The folder `.specify/` (the constitution, the spec-kit scripts) is ignored by git and is not here. Everything you need from it is in the plan's "Constitution Check" and in the rules below.

## The maintainer's rules (they are not negotiable)

**Models**

- **Never use the Fable model.** This session and every sub-agent it starts run on Opus. If a sub-agent would default to another model, set it to Opus.

**Git**

- Push only to `013-docs-refresh`. Never push to `dev` or `main`. Do not open a pull request. Do not merge anything. Do not rebase or force-push.
- Commit after each part passes its checks, with messages in the repository's style: `docs: …(013)`, `test(cli): …(013)`, `feat(web): …(013)`. One subject per commit.

**What may not be touched**

- No file under `apps/cli/src`, `apps/runner` (except links in `apps/runner/README.md`), `packages/core`, `apps/cli/tests` (the end-to-end folder, with an "s"), or `apps/cli/e2e.config.ts`.
- `apps/cli/.env.local` is never read, printed, copied or committed. Do not run the end-to-end tests (`test:e2e`): they need a key that is not here and must not be asked for.
- The landing page (`apps/web/modules/landing/`) is not part of this feature.

**What may not be done**

- No package is added, in any `package.json`. If a task seems to need one, stop that task, write why under "Needs the maintainer" in `PROGRESS.md`, and go on with the others.
- Never run `next dev` or `next build`. Do not use ports 3000 or 3100. `bun run typecheck` in `apps/web` runs `next typegen && tsc --noEmit`; that is allowed.
- No real server, no SSH to anywhere, no network from tests, no system keychain, no `~/.zekno`. Stand-ins only, as the tests do.
- No choice of a framework, a library or a visual design on your own. The design is the six boards. If something is not on them and cannot be decided from the contracts, write it under "Needs the maintainer" and take the plainest option that can be undone.

**Wording**

- The desktop app is named nowhere in the README, the apps' READMEs or the docs: not "desktop", not "Electrobun", not `apps/desktop`.
- "runner", never "agent". Pre-alpha and unaudited stay visible. Nothing is said to work that does not.
- Plain, short, true sentences. No marketing tone. Text that is moved is moved as it is, not improved.
- Every name, address and code shown is an example value. Nothing from a real machine: no home folder, no user name, no temporary path, no hostname.

**Code**

- Every module lives in a folder named for its subject; tests mirror them. Never a folder called `build`. No file over 500 lines.
- TypeScript as the neighbouring files write it: no semicolons, double quotes, doc comments in plain English.
- The site is dark for every visitor. There is one colour scheme.

## How the work is done

This is how the earlier features were built, and the maintainer expects the same care.

1. **One part at a time, in the order of "The parts" below.** A part is given to a sub-agent on Opus with a full brief (the briefs are below). Parts that touch different files may run at the same time.
2. **You check each part yourself before committing it.** A sub-agent's report is a claim, not a proof. Read the diff. Run the checks yourself. Try the thing that is supposed to fail and see it fail.
3. **The checks**, from the repository's root: `bun install` once, then `bun run typecheck --force`, `bun run lint --force`, `bun run test --force`. In `apps/cli`: `bunx prettier --check "**/*.{ts,tsx}"`. In `apps/web` only your own files need to be Prettier-clean: 24 files there and in `packages/ui` were already unformatted before this feature; do not reformat them.
4. **Known noise**: one test of the runner, `release.test.ts`, sometimes times out when the machine is busy. Run it again alone before believing it. Tests that need Docker are skipped without it; that is expected.
5. **Protected paths**: before each commit, `git diff 9ad84d3 --stat -- apps/cli/src apps/runner/src packages/core apps/cli/tests apps/cli/e2e.config.ts` must print nothing.
6. **Keep `PROGRESS.md` (in this folder) up to date** after each part: what was done, the checks' results with numbers, every deviation from a contract and why, every screen that could not be drawn and why, and "Needs the maintainer". Tick the tasks in `tasks.md`. Commit and push both with the part. The session on the maintainer's computer reads these two files to pick the work up again, so write them for a reader who saw nothing.
7. **Do not stop to ask** about what the documents answer. For a real decision that is the maintainer's, write it down and carry on with everything that does not depend on it.

## What the cloud session leaves for the maintainer's computer

- **Looking at pictures**, if no Chrome or Chromium is installed here: T015 (the frame beside the board at a wide and a 390px window) and the eye check of the README's SVG in T011. Do everything else of those tasks, say in `PROGRESS.md` that the eye check is open, and do not install a browser as a package of the repository. If a browser is available, do the eye checks and say which browser.
- **T041** (the road map and the feature map): they are private pages only the other session can update.
- **T042** (merging into `dev`): not here.
- The old pages for the comparison of T002 and T024 are in git: `git show 9ad84d3:apps/web/content/docs/cli.mdx`, and the same for `apps/cli/README.md`, `README.md`, `apps/web/content/docs/index.mdx` and `apps/web/content/docs/templates.mdx`. Keep copies outside the repository's tracked files (a temporary folder).

## The parts, and the brief for each

Give each sub-agent: this file, the contract of its part, its tasks, the rules above, the list of files it owns, and "do not commit; leave your work in the working tree; report facts".

### Part A: the screens (T003, T005 to T013)

Owns `apps/cli/test/screens/**`, one script in `apps/cli/package.json`, `apps/web/content/screens/*.json`, `.github/assets/screen-home.svg`.

- Build from the stand-ins the tests already have: `apps/cli/test/support/terminal.ts` (a stand-in terminal for `inkUi`), `helpers.ts` (`machine()`, `ready()`, `screenOf`, `answering`), `stand-in-server.ts` (`standInServer`, `sshStandIn`, `withSsh`, the stand-in runners), `colour.ts` (`drawnInColour`, `runsOf`; its comment explains why colours need a child process with `FORCE_COLOR=3`), `add-terminal.ts`, `settings-view.ts`, `settings-files.ts`. Prefer not to change files in `test/support`; other tests rely on them.
- Tests that already produce each screen: `test/scenarios/first-run.test.tsx` and `journey.test.ts` (a deploy from nothing), `test/app/app-screens.test.tsx` and `app-operate.test.tsx` (the app, Home), `test/app/settings-screen.test.tsx`, `test/scenarios/add-*.test.ts` and `test/ui/ink/addition-report.test.tsx` (`zekno add`), `test/commands` and `test/plain` (single commands).
- Required: `first-deploy`, `home`, `settings-screen`, `add-postgres`. Wanted: `settings`, `status`, `doctor`, `help`. If they can be drawn: `secrets`, `server-add`, `app-detail`. One that cannot be drawn without changing `apps/cli/src` is left out and reported. None is ever drawn or edited by hand.
- The same bytes on every run. Fix values through the stand-ins first (a key kept as a fixture gives the same fingerprint). Where the program reads the clock or the stand-in runner's file, replace the value by a rule in the recipe and list it under `fixed` in the stored file. A stored screen must not show what no real run shows: the stand-in runner makes the program print "Runner installed  1 MB" and times such as 0.0s; the real runner is far larger (take the figure from `apps/cli/src/runner-release.json` or `apps/runner/RELEASING.md` and say where it came from).
- A colour the program writes that is not in the contract's list: fail and report it, do not map it silently.
- The SVG: cells placed by column, box-drawing characters drawn as lines so they join in any font, a `<title>` with the description, no script, no web font.
- Prove it: `bun run screens` twice, the second run changes nothing; `bun run screens --check` exits 0; edit one word in a stored file by hand, see `bun test test/screens` name that screen, then restore with `bun run screens`. Then the whole `bun test` in `apps/cli`.

### Part B: the frame (T001, T004, T014, T015)

Owns `apps/web/modules/docs/components/screen.tsx`, the registration in `components/mdx.tsx`, `apps/web/modules/docs/lib/screens.ts` and `screens.test.ts`, at most one CSS file of the docs, and section 6 of `research.md`.

- Runs at the same time as part A. They share only the file format of `contracts/screens.md`. Its tests use files written to a temporary folder, not `apps/web/content/screens`.
- T001 first: what the installed Fumadocs needs in `meta.json` for three groups in the notebook layout's sidebar (the exact JSON), and how the installed version makes a heading's id (which slugger; what happens to backticks, punctuation and a repeated heading). Write it into `research.md` §6. Part C needs both.
- The loader checks every field by hand (no package, not zod) and throws with the screen's name. It reads from `join(process.cwd(), "content/screens")`, as `lib/templates.ts` resolves its folder, with the folder overridable for tests.
- The component is a server component with no client JavaScript: a `<figure>`, a title bar (the title on the left; on the right the command for a command's output, or `100 × 30` for a screen of the app), the screen as text at 12.5px with rows exactly 15px high (the ratio 1.2 is what makes box-drawing lines join), no wrapping, an optional caption under it. Colours inside the frame as in the contract. The body scrolls sideways inside the frame and can be focused by keyboard; the page never scrolls sideways. The description is given to screen-reader users and the drawn rows are hidden from them. Empty rows keep their height. No window buttons, no motion.
- Follow how `components/templates.tsx` styles things.

### Part C: the split (T016 to T024)

Owns the pages of `apps/web/content/docs/` except `quick-start.mdx` and `security.mdx` (part D writes those), `meta.json`, `apps/web/modules/docs/lib/pages.test.ts`, `apps/cli/test/docs/docs.test.ts`, `specs/013-docs-refresh/move-list.md`, and links in `apps/runner/README.md` and `CONTRIBUTING.md`.

- Can start once part B has written `research.md` §6, or reads the installed Fumadocs itself.
- **It is a move, not a rewrite.** Do it with a script or careful cut and paste, never by retyping. A sentence changes only when it must: a link that pointed inside the old page, an "above" or "below" that no longer holds, a heading's level (a section that becomes a page: its h2 is the page, its h3 become h2, its h4 become h3). Headings keep their words so anchors keep their names.
- The old page's opening goes to the top of "Commands" where it still fits, and to `app.mdx` for the sentences about the full-screen app. "Status and limits" is appended as it is to `index.mdx` under its own heading; part D rewrites that page around it.
- `meta.json` names `quick-start` and `security` in their places from the start.
- Does not place `<Screen>` yet, and leaves `README.md` and `apps/cli/README.md` alone, but lists the links in them that will need changing.
- Write the tests of `contracts/pages.md` for the final state. Do not weaken or skip a check because it cannot pass yet. When part C ends, these and only these fail, each for a reason outside it: `quick-start.mdx` and `security.mdx` do not exist; `README.md` and `index.mdx` still name the desktop app; the two READMEs still link into the old page; no screen is used by a page.
- Rework `docs.test.ts` as in the contract, then prove it still bites: take one flag out of a page, see the failure name it, restore the page exactly.
- **The comparison**: a script outside the tracked files takes every non-empty line of the old `cli.mdx` and the old `templates.mdx` and reports each that is on no new page. Every such line is explained in the move list under "Reworded" or "Dropped". The number unexplained must be 0. This is the only proof that nothing was lost, so do not skip or soften it.

### Part D: the new pages (T025 to T028), after A, B and C

Owns `quick-start.mdx`, `security.mdx`, `index.mdx`, and placing `<Screen>` in the pages.

- The quick start as on the board `DocsQuickStart`. Every requirement and limit it names is checked against `install.mdx` and the reference pages, word for word where a number is involved (Bun 1.4.4; built from source; one developer; a Linux server reached over SSH with Docker and Compose).
- The introduction: what Zekno is, what works today, the limits ("Status and limits" keeps every statement it has), a deploy as it happens today (the CLI seals and signs on your machine, sends over SSH, the runner verifies and decrypts), the hosted service as planned in a few lines.
- The security page: from the old introduction (the trust table, the steps, the limits), with the CLI as the program on your machine, and a link to the README's full model. It does not copy the README's tables: one place for each fact.
- Each screen gets a caption that says what the reader is looking at.

### Part E: the READMEs (T029 to T036), after A and C; may run beside D

Owns `README.md`, `apps/cli/README.md`, `apps/cli/test/docs/contributing.test.ts` if it read removed sections.

- The root README as in `contracts/readme.md` and on the boards `ReadmeTop` and `ReadmeOutline`.
- **The security model is kept whole.** Every row of every table and every design rule stays. Only the desktop app's sentences change, exactly as listed in `contracts/readme.md`. Rule 1 is worded only as far as `apps/cli/test/layers/layers.test.ts` and the code show it to be true today; read them before wording it. After the rewrite, compare the model before and after, row by row and rule by rule, and write every changed sentence, old and new, into `move-list.md` under "The security model's wording". The maintainer reads that list.
- The roadmap in this order, built items ticked: what is built; then domains and HTTPS, building from source, creating a server, installing with one command, deploys from CI, the Railway importer; later, the hosted service and teammates, an external audit.
- Before cutting a section out of the CLI's README, compare it with the docs. A sentence that is in the README and on no page of the docs is moved to the right page first and noted in the move list under "From the CLI's README".

### Part F: the end (T037 to T040)

Every check of `quickstart.md`. Read each new page once from top to bottom as a newcomer. Write "As built" at the end of `plan.md`: what differs from the plan, the screens that could not be drawn, what is left for the maintainer's computer. Leave T041 and T042 open.

## Things found while planning that are not in the contracts

- The CLI, the runner and the core library print no address of the docs, so nothing printed by a program can point at a moved heading.
- `apps/web/modules/docs/lib/templates.ts` reads `../cli/src/templates/files` from the site's folder. That is why screens are stored inside `apps/web` instead.
- The desktop app is named in `README.md` (14 lines), `apps/web/content/docs/index.mdx` (5 lines) and the landing page (6 lines, left alone). `apps/cli/test/server/check-script.test.ts` holds the string `v2.40.3-desktop.1`, a Docker Compose version; it is a test, not a page, and the "no desktop app" check does not read it.
- The old CLI page has 52 headings (h2 to h4, outside code fences).
- `zod` is used in `apps/web` without being named in its `package.json`. Do not add it there; the loader of part B does not use it.

## When everything here is done

Push the branch. `PROGRESS.md` ends with a short section "For the maintainer": what is finished, what is open, the reworded security rules (or where to read them), and anything to decide. Then stop. The session on the maintainer's computer does the eye checks that are left, updates the road map and the feature map, and merges into `dev`.
