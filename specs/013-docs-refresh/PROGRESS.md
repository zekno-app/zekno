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
| C, the split | T016 to T024 | open |
| D, the new pages | T025 to T028 | open |
| E, the READMEs | T029 to T036 | open |
| F, the end | T037 to T040 | open |

T002 is done: the old pages are kept outside the repository for the comparisons (from `9ad84d3`, since GitHub's `dev` does not hold that commit).

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

- **The address on Home is cut.** The servers pane of `home` shows `deploy@203.0.113.…`: `deploy@203.0.113.10` is one cell too long for the pane, and the program cuts it. That is what the program really draws. The contract's example address is kept; a shorter one (such as `203.0.113.7`, as in the walkthroughs) would show whole. Yours to choose.
- **Values chosen for the screens**: `in 4.2s`, `2 min ago`, and an hour between the two deploys of `app-detail`. The runner's size is `110 MB` from `apps/runner/README.md`.
- **`help` wraps** at 100 columns (the `zekno add` line and the last notes), because that is what the program prints there.

- **GitHub access for the cloud session.** Reconnect GitHub at claude.ai and check that the Claude GitHub App is installed on `zekno-app`; then the commits of this session can be pushed.
