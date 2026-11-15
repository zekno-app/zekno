# Quickstart: checking the small CLI features

How to see each feature work, and where the results of each check are recorded. The contracts say
what is expected; this page says how to look. Nothing here contacts a real server: servers are the
stand-ins of `apps/cli/test/stand-in-server.ts`.

## Prerequisites

- Bun 1.4.4, from the repository root: `bun install --frozen-lockfile`.
- macOS or Linux, `/bin/sh` (and `/bin/dash` where installed, for the script tests).
- For the walkthrough: Python 3 for the pseudo-terminal driver (as in specs/004-cli-app/quickstart.md),
  kept in the scratchpad, not in the repository.

## 1. Automated checks

```bash
cd apps/cli
bun test test/version/version.test.ts test/compiled.test.ts            # the version (Phase 1)
bun test test/version/newest.test.ts                                     # the newer-release check (Phase 1)
bun test test/ui/questions.test.tsx                                 # the four kinds of question (Phase 2)
bun test test/asking/first-deploy.test.ts                               # User Story 1
bun test test/asking/asking.test.ts                                     # User Story 2
bun test test/secrets/import-file.test.ts test/secrets/import.test.ts           # User Story 3
bun test test/server/check-script.test.ts test/ops/doctor.test.ts           # User Story 4
bun test test/docs.test.ts                                       # commands, flags and docs in step
bun test                                                         # everything in apps/cli
```

From the root, at the end: `bun run typecheck`, `bun run lint`, `bun run test`, and in `apps/cli`
`bun run compile`.

Expected: every test passes; `bun test` in `apps/cli` passes after every phase.

## 2. The scenarios the tests prove

| Story | Scenario | Expected | Contract |
|-------|----------|----------|----------|
| US1 | Empty profile, a folder with a Compose file expecting one value; `zekno deploy` at a terminal; answers `ada`, `deploy@example.test`, `prod`, `demo`, `y`, a value | the app runs on the stand-in server; at most six answers; a second `zekno deploy` asks nothing | first-deploy.md |
| US1 | Leave at each question in turn, then run again | what was made stays, nothing half-made, the second run carries on | first-deploy.md, "When it stops" |
| US1 | The installer fails (no Docker, a checksum that does not match) | key kept, no server in the profile, the installer's sentence and F9 | first-deploy.md |
| US1 | No Compose file | today's sentence before any question | first-deploy.md |
| US1 | Piped | today's [NO-TEAM], [MS], [MA] and statuses | plan.md, "What each command asks" |
| US2 | Two servers, unlinked folder, each of the ten commands with no flags at a terminal | each asks exactly what it lacks, then runs | questions.md; plan.md |
| US2 | The same piped | none asks; today's sentence and status for each | plan.md |
| US2 | One server | used, `Using prod, your only server.` | questions.md, A1 |
| US2 | Esc at a list | `Nothing was done.`, status 1, nothing written or sent | questions.md, "Leaving" |
| US2 | `y` typed before a question | does not answer it | questions.md, "Keys typed before a question" |
| US3 | `.env` with new names, a replaced name, `PATH`, `my-var`, then a bad line | summary groups; nothing stored before the answer; a bad line stops all, names its number only | import.md |
| US3 | Twenty values, one command, one answer | twenty new versions; no value in any output or file but sealed (SC-003) | import.md |
| US4 | Everything in order | every check good, status 0 | doctor.md |
| US4 | Each broken setup below | the right line wrong, with its next step; status 1 | doctor.md |
| US4 | Any state | every file of the profile folder, the project folder and the stand-in server unchanged (SC-005) | doctor.md |
| Version | `zekno --version`, `zekno version`, `--json`, compiled and from source | mock-up 6; the same everywhere (SC-008) | version.md |
| Newer release | `zekno version` with a stand-in fetch answering a newer, the same, an older release, a pre-release, a hostile body, a huge body, a redirect to http, a hang, an error | `✔ This is the newest release.`, `! A newer release exists: <v>. Update zekno to get it.` or the dim `Could not check for a newer release.`; status 0 every time; nothing but the version taken from the answer | version.md |
| Newer release | `zekno --version`, and every other command but `doctor` | `deps.fetch` never called | version.md |
| Newer release | `zekno doctor` with a newer release | `! zekno` with the sentence under it; a warning, not a failure | doctor.md |

### SC-004: ways a setup can be broken, and the line `zekno doctor` marks

| # | Broken | Line | Result | Next step |
|---|--------|------|--------|-----------|
| 1 | no profile at all | Key | ✖ | D4 |
| 2 | the keychain entry removed | Key | ✖ | D8 |
| 3 | a team list in profile.json changed | Profile | ✖ | D13 |
| 4 | a `zekno.json` not signed by the team | This folder | ✖ | D19 |
| 5 | a linked folder whose `compose.yaml` was deleted | This folder | ✖ | D25 |
| 6 | a server that is down (`ssh` stand-in `down()`) | Reachable | ✖ | D29 |
| 7 | a server where SSH would ask (`ask()`) | Reachable | ✖ | `Open zekno and press enter on <server>` |
| 8 | a server without Docker Compose (`noCompose()`) | Docker | ✖ | D33 |
| 9 | an older runner (`reportingRunner` with an older version) | Runner | ! | `Run zekno server update <server>` |
| 10 | the runner removed from its path | Runner | ✖ | D40 |
| 11 | a nearly full disk (`df(100000)`) | Disk | ✖ | D48 |
| 12 | a newer runner speaking a newer protocol | Runner | ✖ | D38 |

## 3. The pseudo-terminal walkthrough (SC-007)

Each mock-up of design.md against the real program, at 100 by 30 and at 80 by 24, with a Python
driver that reads the terminal the whole time. The driver runs a small script in the scratchpad
that calls `run(argv, deps)` from `apps/cli/src/cli.ts` with `inkUi()` and `memoryKeyStore()`, as
feature 004's walkthroughs did, so the real keychain is never touched; `deps.fetch` is a stand-in,
so no request leaves the machine; `ssh` is the stand-in of
`sshStandIn`, first on `PATH`, in front of a stand-in server whose release is the real runner with
the stand-in Docker.

| Mock-up | Steps | What to compare |
|---------|-------|-----------------|
| 1 | two servers (`prod` over the stand-in `ssh`, `staging` on this machine), `zekno status` in an unlinked folder; ↓, ↑, Enter; again with Esc; again with one server | every line and column of mock-up 1; `✔ Server  prod`; `Nothing was done.` and status 1; `Using prod, your only server.` |
| 2 | `zekno deploy` with apps `demo` and `api` on `prod`; choose `+ a new app` | the rows, `+ a new app` last, `? Name for the new app › <folder>`, `✔ App  demo` |
| 3 | empty profile; `zekno deploy`; answer each question | every line of mock-up 3, in order; the result line; then a second run asks nothing |
| 4 | `zekno secret import .env` with mock-up 4's names; `y`; then once more with a bad line | every line of mock-up 4; the bad line's number and nothing of its content |
| 5 | `prod` with an older runner, `staging` where SSH would ask; `zekno doctor` | every line and column of mock-up 5, the `–` lines included; status 1 |
| 6 | `zekno --version`; `zekno version` three times, the driver's stand-in fetch answering a newer release, the newest, and nothing; `zekno doctor` with a newer release | the two lines; each of the three third lines, `✔` green, `!` yellow, the last dim; doctor's `! zekno` line with the sentence at column 17 |
| Type-ahead | write `y` and Enter to the terminal while the in-memory key store's read is slowed, before each question | no question is answered by them |

Record for each: passed, or what differed, with the screen as the driver read it.

Not part of the walkthrough: a real request to GitHub. The tasks never use the network. The
maintainer may run `bun apps/cli/src/main.ts version` once, with the network, to see the real
answer; it changes nothing.

## Results

Added by the tasks as they complete.

### Phase results

(not yet run)

### The pseudo-terminal walkthrough

(not yet run)

### The agent end-to-end tests

(not yet run)

### Checks at the end

(not yet run)
