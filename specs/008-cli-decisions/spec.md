# Feature Specification: Three decisions on the small CLI features

**Feature Branch**: `008-cli-decisions`
**Created**: 2026-11-15
**Status**: Approved by the maintainer on 2026-11-15 ("Approve your recommends on those too")
**Input**: three points left open at the end of feature 006
([specs/006-cli-small-features](../006-cli-small-features/)), each with a recommendation. The
maintainer approved the three recommendations. They amend feature 006's contracts and boards, and
are built after feature 007 (code in folders), on a branch from `dev`.

## 1. Where the newer-release check asks

- **What it was.** `zekno version` and `zekno doctor` asked GitHub's REST API for the latest
  release. The API allows 60 unauthenticated requests an hour per network address. On a shared
  address it answered 403, and `zekno version` said "Could not check for a newer release." (seen
  on 2026-11-15).
- **What it is now.** The check reads the runner release file on `main`:
  `https://raw.githubusercontent.com/zekno-app/zekno/main/apps/cli/src/version/runner-release.json`.
  The file is held to the form the CLI's own reader of it accepts. A higher version is announced
  only when both checksums are there. Without them it cannot be installed yet, so it is not
  announced.
- **What a person sees.** A higher version with both checksums: "A newer release exists:
  <version>. Update zekno to get it." A higher version without both: "This is the newest
  release." The same or a lower version: "This is the newest release." Anything else: "Could not
  check for a newer release."
- **What stays the same.** Who asks (`zekno version` and `zekno doctor` only, once per run). One
  GET, Bun's own fetch handed in by `main.ts`, no credentials, `User-Agent: zekno`, 3 seconds,
  manual redirects to `https:` on the one host only, status 200 only, a bounded body, strict
  UTF-8, the version grammar, a development version not taken, the exit status, no download,
  nothing written. The API-only headers go. The body limit is now 16 KiB.

## 2. An import file that is a link (security review S4)

- **What it was.** `zekno secret import .env` followed a link and named only `.env`.
- **What it is now.** When the path typed is a symbolic link, the first line of the summary reads
  `<file> (a link to <real path>), for <app> on <server>`, at a terminal and in plain output. The
  real path is the one of the file that was opened, cleaned as every shown path is.
- **What stays the same.** A file that is not a link: the line is unchanged. Links are still
  followed. The last line ("still holds them in plain text") names the path as typed. A link to
  something that is not a regular file is refused as before.

## 3. Two looks in the new questions

- **(a) "Nothing more was done."** It keeps the common error style: the first sentence bold after
  `✖`, the rest dim on the next line. The program already drew it so. Only the board
  `design/DeployFromNothing.dc.html` of feature 006 changed. No code changed.
- **(b) A refused hidden value.** At the first deploy's hidden prompt, an empty value (A9) and a
  value of several lines (A10) are drawn as a refused typed answer is: the reason in the warning
  colour, at column 2 under the question, with no `!`. A10 drops its backticks, as error lines do
  at a terminal.
- **What stays the same.** The words of A9 and A10. The hidden prompt of `zekno secret set`: it
  ends the command with an error, so it stays as it is. The full-screen app. Every command with no
  terminal.

## Where the details are

- Contracts of feature 006: `contracts/version.md`, `contracts/import.md`,
  `contracts/questions.md`, `contracts/first-deploy.md`.
- Feature 006's `research.md` (R14, "Change of decision"; R10, "A link"), `design.md` (mock-up 4)
  and `security-review.md` (part 6, "After the review, feature 008").
- The tasks: [tasks.md](./tasks.md).
