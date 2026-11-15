# Tasks: Three decisions on the small CLI features

**Input**: [spec.md](./spec.md)

## Decision 1: the newer-release check reads a file

- [X] T001 `apps/cli/src/version/newest.ts`: the raw file's address and host, `User-Agent: zekno` only, a 16 KiB body limit, the file held to `RunnerReleaseSchema` (exported from `runner-release.ts`), a higher version announced only with both checksums
- [X] T002 Tests: `apps/cli/test/version/newest.test.ts`, `version.test.ts` and `test/ops/doctor.test.ts` answer in the file's form; new cases for every row of the decision

## Decision 2: an import file that is a link

- [X] T003 `apps/cli/src/secrets/import-file.ts`: the real path of the opened file, checked against the descriptor's device and inode; `apps/cli/src/commands/secret.ts`: I1 names it, cleaned
- [X] T004 Tests: `apps/cli/test/secrets/import-file.test.ts` (links, refusals, a link changed while it is read) and `import.test.ts` (plain, at a terminal, a real path with escape sequences)

## Decision 3: two looks

- [X] T005 (a) The board `specs/006-cli-small-features/design/DeployFromNothing.dc.html` draws "Nothing more was done." in the common error style; no code
- [X] T006 (b) `apps/cli/src/ui/ink/hidden-prompts.tsx` and `questions.tsx`: A9 and A10 drawn as a typed answer's reason, A10 without backticks; `zekno secret set` unchanged
- [X] T007 Tests: `apps/cli/test/ui/ink/questions.test.tsx`, `wrap.test.tsx`, `apps/cli/test/asking/first-deploy.test.ts`

## Records and docs

- [X] T008 Feature 006: `contracts/version.md`, `contracts/import.md`, `contracts/questions.md`, `contracts/first-deploy.md`, `research.md` (R14, R10), `data-model.md` (Latest), `plan.md` (a note), `design.md` (mock-up 4), `quickstart.md`, `design/README.md`, `security-review.md` (part 6)
- [X] T009 `apps/cli/README.md` and `apps/web/content/docs/cli.mdx`: the host and the file asked for; one line on a linked import file
- [X] T010 `bun run typecheck`, `bun run lint`, `bun run test` from the repository root

## After the second security review (part 7 of feature 006's security review)

- [X] T011 S5: name the real path when any part of the path as typed is a link (`typedParts`, `whereLinkLeads` in `apps/cli/src/secrets/import-file.ts`); tests for a folder link, `..`, letter case, an absolute path, the race; contracts and docs
- [X] T012 The address names the branch exactly: `refs/heads/main` in `RELEASE_FILE`, its tests, `contracts/version.md`, `research.md` R14, `spec.md`
- [X] T013 The implementer's part 8 of the security review; typecheck, lint and every test from the root
