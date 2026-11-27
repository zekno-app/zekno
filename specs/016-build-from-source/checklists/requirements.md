# Specification Quality Checklist: Build from source

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-26
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details: requirements name only what a person types or sees (`zekno deploy`, `zekno.app.json`, `Dockerfile`, `.dockerignore`, `.gitignore`, `.env`, `.npmrc`, `.netrc`, `.git-credentials`, `node_modules`, `.venv`, `# syntax=`, `ADD`, `ARG`, `RUN --mount=type=secret`, `PORT`, the builder's credential names `GIT_AUTH_TOKEN`, `GIT_AUTH_HEADER`, `HTTP_AUTH_TOKEN_<host>` and `HTTP_AUTH_HEADER_<host>`, the `--json` outcome `build_failed`, Railpack, Docker and its version, and GitHub's Linux machines as the place the checks run), and limits the twice-reviewed design already fixed
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders: plain sentences a person coming from a managed platform understands
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain: the 25 choices that are the maintainer's are listed with options, a recommendation, the reason and their step under "Open points for the maintainer"
- [x] Requirements are testable and unambiguous; where one depends on a point of the list, it names the point, and every number a test needs is stated, marked "recommended" where it is a choice (point 22)
- [x] Success criteria are measurable, and each names its step
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded (Out of scope)
- [x] Dependencies and assumptions identified, with what was run and what rests on documentation only

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows of steps 1, 1b and 2
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification
- [x] Security rules of the research (part 3 and part 7.4), including those for writing the code out for Railpack, are stated as testable requirements (FR-015 to FR-015b, FR-026 to FR-050, FR-051 to FR-056)
- [x] The exceptions to "with no terminal, every existing command behaves as before" are stated: the first approved by the maintainer on 2026-11-26 (FR-074, point 6), the second, three of today's settings sentences, on 2026-11-27 (FR-074, item 21 of the plan)
- [x] What an older runner and a too-old zekno are told is stated (User Story 10, FR-081 to FR-085), and so is what a server with too old a Docker is told (FR-034a)
- [x] Maintainer steps are listed in order (M1 to M10)
- [x] The decisions of 2026-11-26 (D7 to D10) and the points taken as recommended (D11) are written into the spec, and each detail the maintainer did not state is recorded under Assumptions ("Working readings of the decisions of 2026-11-26")
- [x] The open points are decided by the maintainer: on 2026-11-26 points 1, 3, 4, 6 and 19 were decided (D7 to D9, D12, D13), and points 2, 5, 7 to 18 and 20 to 25 taken as recommended (21 with the change of D10). None is open
- [x] The 18 boards, with the nineteen choices of `design/lines.md` as recommended, are approved by the maintainer on 2026-11-27 (D14, M2). The lines written after the approval of 2026-11-27 are drafts, not approved yet, and are shown to the maintainer before their screens are built (FR-092)

## Notes

- Validated once, 2026-11-26. Revised the same day after three reviews (security; a person coming from a managed platform; testability). Every new sentence quoted in the spec is a draft, and those quoted from today's zekno are marked "today's"; the words are settled on the boards.
- Where two reviews pulled opposite ways, the spec keeps the safer reading and the open point says so (points 9 and 23).
- Revised again on 2026-11-26 with the maintainer's decisions D7 to D10 and the points taken as recommended (D11). Point 19 was not decided as recommended: a build now reads the service's plain variables (step 1 for a Dockerfile, step 2 for Railpack) and only the secrets named one by one (step 1b), with new requirements FR-036a to FR-036d, FR-037a to FR-037h, FR-064a, FR-072b, FR-072c and FR-089b, User Stories 11 and 12, and SC-020 to SC-022. Points 1 and 6 stay open, and the spec follows their recommendations.
- Revised a third time on 2026-11-26 after two reviews of that revision. Added FR-031b (Docker's own record of a build) and FR-036e (a secret a Dockerfile declares with `ARG`), User Story 8 scenario 7 and User Story 11 scenario 8. FR-036d follows what Railpack's documentation says of its frontend. FR-037d lets only a build of the same app that reads a secret with the same value reuse a step built with it. In the spec, "open point" now names only points 1 and 6.
- Revised a fourth time on 2026-11-26 with the last two answers: point 1 as recommended, with a line in the summary for changes that are not committed (D12, FR-017a, User Story 2 scenario 9); point 6 as recommended, with its exception to FR-074 approved (D13).
- Revised a fifth time on 2026-11-27 with the maintainer's answers D14 to D17: the boards approved with the nineteen choices of `design/lines.md` as recommended, the plan's items decided as recommended but item 25, and the plan's proposed spec changes accepted but FR-044's upload clause. Each change is marked "changed on 2026-11-27" in the spec, and the decided items no requirement speaks of are under Assumptions ("Working readings of the decisions of 2026-11-27"). Item 25 (M5 to M10), the ruleset setting of item 7 and the maintainer's own fetch of Railpack's checksums at M3 stay the maintainer's steps, each with its own go-ahead.
- The last unchecked item, the maintainer's (M2, the boards), was checked on 2026-11-27, for the 18 boards. The drafts written after that approval are not covered by it.
- Any tool or package the plan proposes, the Railpack version pinned among them, is shown to the maintainer before it is used (M3).
