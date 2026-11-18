# Progress: feature 013, README and docs refresh

Kept by the cloud session that carries on from `HANDOFF.md`. Written for a reader who saw nothing.

## Starting numbers (2026-11-18, before any change)

Branch `013-docs-refresh` at `352ed2f`. Bun 1.4.4 was already installed in this environment; `bun install` changed no tracked file.

| Check | Result |
|---|---|
| `bun run typecheck --force` | passes (5 of 5 tasks) |
| `bun run lint --force` | passes (5 of 5 tasks) |
| `bun run test --force` | fails: web 32 pass; core 102 pass; runner 144 pass, 2 skip, 2 fail; cli (run alone, `bun test` in `apps/cli`) 2092 pass, 9 skip, 67 fail, across 106 files |
| `bunx prettier --check "**/*.{ts,tsx}"` in `apps/cli` | passes |

**The failures that were already there, and why.** This environment runs every command as `root`. The runner keeps its key and state in `/var/lib/zekno` when it runs as root and nothing sets `ZEKNO_RUNNER_HOME` (`apps/runner/src/home/home.ts`, `defaultHome`). The CLI's stand-in server does not set it, so under root every stand-in runner of every test shares `/var/lib/zekno`: the first test that sets one up claims it, and the next ones are refused with "The runner on that server already belongs to a team", or read their state from the wrong folder. That accounts for the stand-in-SSH tests among the 67 (first deploy, `server add`, doctor, the app's add-server screen, ...); the rest are tests that make a folder read-only, which root can still write. On the maintainer's computer (not root) they pass. The two runner failures (`release.test.ts` gzip check, the compiled runner's `.env` check) are of the same kind or the known noise of `HANDOFF.md`. `/var/lib/zekno` is removed after each run here, since the tests left it behind.

These numbers are the baseline: a failure is new only if it is not in this list.

## Parts

| Part | Tasks | State |
|---|---|---|
| A, the screens | T003, T005 to T013 | done |
| B, the frame | T001, T004, T014, T015 | done |
| C, the split | T016 to T024 | done |
| D, the new pages | T025 to T028 | done |
| E, the READMEs | T029 to T036 | done |
| F, the end | T037 to T040 | done; T041 and T042 left for the maintainer's computer |

T002 is done: the old pages are kept outside the repository for the comparisons (from `9ad84d3`, since GitHub's `dev` does not hold that commit).

## Part F, the end (T037 to T040): done

- **T037, the checks of `quickstart.md`, last full run**: `bun run typecheck --force` passes (5 of 5); `bun run lint --force` passes (5 of 5); `bun run test --force`: web 52 pass, 0 fail; core 102 pass; runner 144 pass, 2 skip, 2 fail (the same two as at the start); cli 2139 pass, 9 skip, 66 fail across 108 files. **No failure is new**: every CLI failure is one of the baseline's 67, all caused by running as root (see "Starting numbers"). In `apps/cli`: Prettier clean; `bun run screens --check` every screen in step. No page over 500 lines (longest `templates.mdx`, 402); the CLI's README 171 lines; no "desktop" or "Electrobun" in the READMEs or `apps/web/content`; the comparison of the old pages, 0 unexplained.
- **T038**: `git diff 9ad84d3 --stat` over `apps/cli/src`, `apps/runner/src`, `packages/core`, `apps/cli/tests`, `apps/cli/e2e.config.ts` prints nothing. (`dev` on GitHub does not hold `9ad84d3`, the commit this branch grew from, so the comparison is with it.)
- **T039**: the new pages were read from top to bottom. Every "above" and "below" still points at something on its page. One row was changed: the introduction's status table said "Control plane | Hosted by Zekno, closed source" under "What works today", as if it existed; it now begins "Not built yet." (in `move-list.md`).
- **T040**: "As built" is at the end of `plan.md`.

## Part D, the new pages (T025 to T028): done

- `quick-start.mdx` (100 lines, as on the board `DocsQuickStart`): what you need, build `zekno`, `zekno deploy` with the screen `first-deploy` and what happened, `zekno` with the screen `home`, what next. Every requirement it names was checked against the reference pages, word for word where a number is involved: Bun 1.4.4 (`install.mdx`), built from source (`install.mdx`), one developer and macOS or Linux with a system keychain ("Status and limits"), a Linux server on x86-64 or ARM64 with glibc 2.17 or newer, Docker with its Compose plugin and HTTPS to github.com (`servers.mdx`, "Supported servers"), a window of 80 by 24 (`app.mdx`).
- `index.mdx` (144 lines) rewritten: what Zekno is, what works today, a deploy as it happens today, the hosted service as planned in one paragraph, "Status and limits" with every statement it had, where to go next. The callout keeps the old page's title, "Pre-alpha", and says it is unaudited; the page test exempts the introduction from the standard callout.
- `security.mdx` (75 lines): the trust table, the steps of a deploy, what it protects against and what it does not, from the old introduction, with the CLI as the program on your machine, and a link to the README's full model. It does not copy the README's open-source table or design rules.
- Every old sentence of the introduction that changed or moved, and where, is in `move-list.md` under "The introduction".
- All eleven screens are placed, each with a caption, on the pages `contracts/screens.md` names.
- **Fixed by this session after part D**: three code blocks moved by part C drew a screen by hand right next to the real screen of the same thing (the first deploy in `deploying.mdx`, `zekno add postgres` in `templates.mdx`, the settings screen in `changing-settings.mdx`). `contracts/pages.md` rule 8 forbids that, and the first one said `Runner installed  52 MB`, which no real run prints (the program prints the unpacked runner's size, about 110 MB). The three blocks were removed and are written out whole in `move-list.md` under "Dropped", with the reason. The usage list on Commands is a list of what to type, not a screen, and stays. The comparison of T024, run again: 1,756 old lines, 1,670 on a page as they were, 22 reworded, 64 dropped, **0 unexplained**.

## Part E, the READMEs (T029 to T036): done

- `README.md` (331 lines): badges with "audit: none yet", the warning word for word, the picture of Home with its description, "What works today", "Try it", the overview and why, "How it works" with today's path first (a new Mermaid diagram) and the hosted service under "Planned: …", the security model, "Repository", "Develop", the roadmap in the road map's order, contributing, license.
- **The security model is whole.** This session compared it with the old one line by line: the only lines that differ are the seven `contracts/readme.md` lists (the trust row, the threat row, the open-source row removed, rules 1, 3, 6 and 8). Every changed sentence, old and new, is in `move-list.md` under "The security model's wording".
- **Rule 1** is longer than the contract's sentence, as the contract's fallback asks: `apps/cli/test/layers/layers.test.ts` checks only that `src/ops/` imports nothing that draws and that `src/ui/` takes only types from `src/ops/`; it does not check the full-screen app's screens, and the screens and the signing code run in one program. So the rule says it is a rule for any interface and how far the CLI meets it today.
- `apps/cli/README.md` cut from 1,854 to 171 lines: what zekno is, build from source, develop, end-to-end tests, screens for the docs. Before cutting, 1,308 sentences of the removed sections were compared with the docs: 1,239 are on a page as they are, 61 are there in other words, 7 are the opening that stays, and 1 (the runner release's address) was on no page and was moved into `servers.mdx`. Each is in `move-list.md` under "From the CLI's README".
- No test needed changing (T036): `contributing.test.ts` still holds over the short README, and `docs.test.ts` already reads it as one file among others. The docs test was checked to fail on `zekno deploy --bogus` put into `README.md`.
- Links into the docs from both READMEs are full `https://zekno.app/docs/…` addresses, checked by the page test.

## Part C, the split (T016 to T024): done

- The old `cli.mdx` (from `9ad84d3`) was cut by a script along its headings, never retyped, into `install`, `app`, `deploying`, `servers`, `secrets`, `settings`, `changing-settings`, `project-file`, `doctor`, `output`, `storage`; "zekno add" went into `templates.mdx` before the list of templates; `cli.mdx` is now "Commands": the old opening where it fits, the old command list, and a new table of every command of the help with the page that describes it (each line taken from the first sentence of that command's section). "Status and limits" is appended as it is to `index.mdx`. `meta.json` is exactly the one of `research.md` §6. The longest page is `templates.mdx`, 423 lines.
- All 52 old headings are on the page the contract names (`move-list.md`). Heading levels: a command's h3 became h2 and its h4 h3; a whole h2 that became a page became the page's title.
- **Deviations, small**: `project-file` has `zekno link` before "Linking a folder" (the contract's order; the old page had them the other way). The old templates page's "What it does not do" became "What a template does not do", because `zekno add` brings a heading of the same name onto the page (rule 5). `templates.mdx` therefore has two overlapping openings and two "does not do" lists, one from each old page: kept, because this is a move.
- **Links**: `runner.mdx` (3 links) now points at `/docs/servers#…`. `apps/runner/README.md` (3 links that went to `../cli/README.md#…`, sections part E removes) now points at `https://zekno.app/docs/servers#…`, the site's address in `apps/web/config/site.ts`. `CONTRIBUTING.md` had no link into the old page.
- **The comparison (T024)**: of the 1,756 non-empty lines of the old `cli.mdx` and `templates.mdx`, 1,733 are on a new page as they were, 22 are under "Reworded" in the move list, 1 under "Dropped" (a link to "The project file" in `zekno link`, now on that very page). **Unexplained: 0.** This session checked it again with a script of its own: 23 lines are on no page, and each is in the move list.
- **Tests**: `apps/web/modules/docs/lib/pages.test.ts` has the checks of `contracts/pages.md` for the final state, plus "screens and pages agree". `apps/cli/test/docs/docs.test.ts` reads every page of the docs. After part C, `bun test` in `apps/web` gave 48 pass, 4 fail, the four expected: `quick-start` and `security` do not exist (tree; callout); `README.md` and `index.mdx` still name the desktop app; no stored screen is shown yet. `bun test test/docs` in `apps/cli`: 42 pass, 0 fail. **The docs test bites** (tried by this session): `--force` changed to `--forse` on every page made it fail with "No page of the docs names --force" and "… `zekno link` does not take --forse"; the pages were put back byte for byte.
- Typecheck and lint of the whole repository pass; Prettier is clean on the two test files; protected paths unchanged.

## Part A, the screens (T003, T005 to T013): done

- `bun run screens` in `apps/cli` (`apps/cli/test/screens/capture.ts`) draws every screen from a recipe in `test/screens/recipes/`, each in a child process with `FORCE_COLOR=3`, `TZ=UTC` and a temporary folder of its own, and writes `apps/web/content/screens/<name>.json` and `.github/assets/screen-home.svg`. `--check` writes nothing and names each screen that differs, with its first differing row. Shared pieces are in `test/screens/scene/`. No file of `test/support` changed.
- **All eleven screens are drawn**: the four required (`first-deploy`, `home`, `settings-screen`, `add-postgres`), the four wanted (`settings`, `status`, `doctor`, `help`) and the three "if they can be drawn" (`secrets`, `server-add`, `app-detail`). None needed a change under `apps/cli/src`.
- **Root**: the stand-in server's release in the recipes is the real runner with `ZEKNO_RUNNER_HOME` set inside the stand-in server's own folder, so a capture never writes `/var/lib/zekno` and gives the same bytes as root and as an ordinary user (checked once as uid 65534).
- **Values fixed by a rule, each listed under `fixed` in its file**: in `first-deploy` the team code (`7KQ2-M4XD-9WTA-3HPE-R8NC`) and the server code (`C5VJ-2PRX-8DQM-K7TW-4NHA`), which come from keys made on each run; the runner's size, shown as `110 MB, checksum verified` (the stand-in release is a small script; 110 MB is what `apps/runner/README.md` says, "The file is about 110 MB"; `runner-release.json` holds no size); the deploy's time, `in 4.2s`. In `server-add` the server code. In `home` the latest deploy's age, `2 min ago`. In `app-detail` the times of the two deploys, `today 10:28` and `today 09:28`. A rule that finds nothing to replace fails the capture.
- **Checked by this session**: `bun run screens --check` exits 0 with every screen "in step"; two runs of `bun run screens` give byte-identical files (sha256 of all twelve); a word changed by hand in `first-deploy.json` makes `bun test test/screens` fail with `first-deploy  differs at row 13`, and `bun run screens` restores it. No stored screen holds a path, user or host name of this machine. All eleven files pass the docs site's loader. The SVG has a `<title>`, no script, no font, no outside file, and looked right in Chromium (lines join). `tsc`, ESLint and Prettier in `apps/cli` are clean. The whole `bun test` in `apps/cli` (run by part A's agent): 2107 pass, 9 skip, 66 fail across 108 files; every failure is in the root-caused files of the baseline, none in `test/screens`.

## Part B, the frame (T001, T004, T014, T015): done

- **T001**: `research.md` §6 now holds the installed Fumadocs facts (fumadocs-core 16.19.0, fumadocs-mdx 15.6.1, next 16.4.6): the exact `meta.json` with the three groups as `---Name---` separators; `index` must be named; a page not named in `pages` leaves the sidebar (so the page test checks every page is named); every `.json` under `content/docs` is read as a meta file (so screens live in `content/screens`). Heading ids: github-slugger 2.0.0 through `remarkHeading`, one slugger per page, backticks dropped, punctuation removed, spaces not collapsed (`` `--json` and `--plain` `` gives `--json-and---plain`), repeats get `-1`, `-2`. The same slugger is reachable from `apps/web` as `createHeadingIds` in `fumadocs-core/mdx-plugins/remark-heading.runtime`.
- **T004**: `apps/web/modules/docs/lib/screens.ts` reads and checks a stored screen by hand (no package) and throws with the screen's name; `screens.test.ts` works on files in a temporary folder.
- **T014**: `apps/web/modules/docs/components/screen.tsx`, a server component with no client JavaScript, registered as `Screen` in `components/mdx.tsx`.
- **T015**: looked at in Playwright's Chromium 157 with a static preview of the component's markup and the site's compiled CSS, at 1440px and at 390px, beside the board. At 390px the page is 390px wide and the frame scrolls sideways inside itself; the keyboard moves it. Nothing in the component needed fixing.
- **Checked by this session**: `bun test` in `apps/web` 41 pass, 0 fail; typecheck and lint pass; Prettier clean on the four files; a stored screen with an unknown colour and a missing name each throw with the screen's name. Protected paths unchanged.
- **Choices the board did not settle** (the plainest, easy to undo): corners 10px as on the board, though Fumadocs' code block is 14px; a colour with `dim` shows the colour; long titles are cut on a phone, the command on the right never; the native thin scrollbar rather than the drawn track of the phone board.
- **For the maintainer's eye**: box-drawing lines join only if the site's Geist Mono serves its U+2500 to U+259F part. With the full font they join in the preview; on the built site it is still to be seen.

## Pushing

Every push from this session is refused by GitHub with 403: "Claude doesn't have GitHub access to zekno-app/zekno for your organization". It is refused for `013-docs-refresh` and for any other branch name tried (`claude/013-docs-refresh`), so there is no branch this environment allows. The commits are made on the local `013-docs-refresh` and a git push is tried again after each part.

GitHub's API through the session's GitHub connector was tried too: it can read the repository (it lists the branches) but refuses to write ("403 Resource not accessible by integration" when it makes a tree). So nothing of this session reaches GitHub until the access is fixed; all of it is in the local branch's commits.

## Needs the maintainer

- **The address on Home was cut** (`deploy@203.0.113.…`, one cell too long for the pane). Settled on the maintainer's computer: the example address is now `203.0.113.7`, as on the approved boards and in the docs' other examples, and it shows whole.
- **Values chosen for the screens**: `in 4.2s`, `2 min ago`, and an hour between the two deploys of `app-detail`. The runner's size is `110 MB` from `apps/runner/README.md`.
- **Is `https://zekno.app/docs` live?** The runner's README now links there (the address in `config/site.ts`). This session cannot check that the docs are served there; if not, a relative link to `../web/content/docs/servers.mdx#…` would do.
- **`templates.mdx` has two openings and two "does not do" lists**, one from the old templates page and one from `zekno add`. Merging them is a rewording, so it is left to you.
- **Hand-written examples beside the real screens.** The doctor and secrets pages keep hand-written examples that show other cases than their screens (a warning and a problem; another app), and the usage list stays on Commands. They use the old example values (`demo`, `prod`, `203.0.113.7`). Whether to keep them is yours.
- **The quick start builds from `main`**, because only a build from `main` is documented to install the published runner; `main` does not have `zekno add` yet (feature 012 is on `dev`), so the quick start's "Add a database" card points at a command that build lacks until `dev` is merged.
- **Roadmap items left out** to follow the contract's list: two-person approval for production deploys, a local mock of the control plane, and the signed-in dashboard. "Website: the landing page and the docs" was added under Built.
- **Rule 1 could be stated as checked** if a test kept `src/app/screens/` and `src/ui/` from importing `profile/` and `@workspace/core`. That would be a test-only change, for a later feature.
- **`help` wraps** at 100 columns (the `zekno add` line and the last notes), because that is what the program prints there.

- **GitHub access for the cloud session**: settled. The maintainer installed the Claude GitHub App on `zekno-app`, and the cloud session pushed its eleven commits (`352ed2f..80ab3a5`).

## For the maintainer

**Finished**: parts A to F, tasks T001 to T040. Seventeen pages in three groups; eleven real screens of the CLI, kept true by `bun run screens --check` and a test; the frame `<Screen>`; the README that says what works today first; the CLI's README as a developer's guide (171 lines); the desktop app named nowhere outside the landing page.

**Open**:

- Everything of the cloud session is on GitHub's `013-docs-refresh` since the access was fixed.
- T041 (the road map and the feature map) and T042 (merging into `dev`): for your computer, as `HANDOFF.md` says.
- The eye checks on the running site and on GitHub (see "As built" in `plan.md`).

**The reworded security rules**: in `specs/013-docs-refresh/move-list.md`, under "The security model's wording", each with the old and the new sentence: the trust-boundaries row, the threat row, the open-source row removed, and rules 1, 3, 6 and 8. The rest of the model is unchanged, line for line.

**To decide**: the items under "Needs the maintainer" above.

## Checked on the maintainer's computer (2026-11-18, after the cloud session)

The session that planned the feature pulled the branch and checked the work itself before merging.

- **Protected paths**: `git diff 9ad84d3 --stat` over `apps/cli/src`, `apps/runner/src`, `packages/core`, `apps/cli/tests`, `apps/cli/e2e.config.ts` and the landing page prints nothing. The only `package.json` change is the script `screens`. No lockfile change.
- **Checks, as an ordinary user**: `bun run typecheck --force` and `bun run lint --force` pass. Tests: web 52 pass; core 102 pass; cli **2,210 pass, 4 skip, 0 fail** across 108 files (the cloud's 66 failures were its running as root, as it said); runner 146 pass, 1 skip, 1 fail: `release.test.ts`, "a tag is runner-v and a version, and nothing else", which runs out of its 5 seconds on this machine and passes with a longer limit. It is the known timing noise; no file of the runner changed but three links in its README. Prettier clean in `apps/cli`; `bun run screens --check`: every screen in step.
- **The security model**, compared again with a script of this session: 44 lines before, 43 after; the only lines that differ are the trust row, the threat row, the removed open-source row and rules 1, 3, 6 and 8.
- **Nothing private** in what was added: no home folder, user name, host name or temporary path. The screens hold only example values.
- **By eye**, in Chrome: all eleven stored screens drawn with the frame's colours and font, and the README's SVG. Lines join, the logo and the panes are as the real program draws them.
- **One change made here**: the example address (see "Needs the maintainer"). Five screens and the SVG were redrawn by `bun run screens`; two captions no longer say the address is cut.
- **T041 and T042**: the road map and the feature map updated, and the branch merged into `dev` on this computer.

Still for the maintainer's eye: the running site (the sidebar's three groups, a frame at a narrow window, whether the site's Geist Mono joins the box lines) and the README on GitHub.

## After the checks: four fixes, the built site, and the pushes (2026-11-18)

Asked for by the maintainer before pushing.

- **The landing page** no longer names the desktop app (eight sentences, listed in `move-list.md`), and the page test that refuses the term reads it too.
- **The templates page** opens once and lists once what a template does not do (363 lines, from 402).
- **The roadmap** has "Two-person approval for production deploys" again, and names the dashboard with the hosted service.
- **Two tests**: `apps/cli/test/layers/screens-hold-no-key.test.ts` (no file that draws loads the keychain code or the core library), so the README's rule 1 now says what is checked; and the runner's tag test has 30 seconds, since it starts one program per refused tag at once.
- **Found on the built site, and fixed**: in a frame, `●` came out 10px wide and `←` 17px against a cell of 7.5px, because the site's monospace font lacks them and the browser took them from a wider font; every border after them on the row moved. `screen.tsx` now holds each character outside ASCII and the box-drawing range to one cell. No test here could see it: it shows only with the site's real fonts.
- **Last full run of the checks**: typecheck and lint pass; web 52 pass; core 102 pass; runner 147 pass, 1 skip, 0 fail; cli 2,213 pass, 4 skip, 0 fail across 109 files; Prettier clean in `apps/cli`; every screen in step.
- **The built site, looked at** in the maintainer's browser on the preview of `dev`: the sidebar's three groups; Home's frame with straight borders and the address whole, every bordered row the same width; at a 386px window the page does not scroll sideways and the frame scrolls inside itself; all eighteen pages answer, and none holds the term.
- **Pushed**, at the maintainer's word for this time only: `dev`, then `main`.
