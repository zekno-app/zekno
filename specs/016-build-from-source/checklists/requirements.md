# Specification Quality Checklist: Build from source

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-26
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details: requirements name only what a person types or sees (`zekno deploy`, `zekno.app.json`, `Dockerfile`, `.dockerignore`, `.gitignore`, `.env`, `.npmrc`, `.netrc`, `.git-credentials`, `node_modules`, `.venv`, `# syntax=`, `ADD`, `PORT`, the `--json` outcome `build_failed`, Railpack, Docker and its version), and limits the twice-reviewed design already fixed
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders: plain sentences a person coming from a managed platform understands
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain: the 25 choices that are the maintainer's are listed with options, a recommendation, the reason and their step under "Open points for the maintainer"
- [x] Requirements are testable and unambiguous; where one depends on an open point, it follows the recommendation and names the point, and every number a test needs is stated, marked "recommended" where it is a choice (open point 22)
- [x] Success criteria are measurable, and each names its step
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded (Out of scope)
- [x] Dependencies and assumptions identified, with what was run and what rests on documentation only

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows of both steps
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification
- [x] Security rules of the research (part 3 and part 7.4), including those for writing the code out for Railpack, are stated as testable requirements (FR-015 to FR-015b, FR-026 to FR-050, FR-051 to FR-056)
- [x] The one exception to "with no terminal, every existing command behaves as before" is stated and left to the maintainer (FR-074, open point 6)
- [x] What an older runner and a too-old zekno are told is stated (User Story 10, FR-081 to FR-085), and so is what a server with too old a Docker is told (FR-034a)
- [x] Maintainer steps are listed in order (M1 to M10)
- [ ] The 25 open points are decided by the maintainer
- [ ] The boards for every new screen and line are drawn and approved by the maintainer

## Notes

- Validated once, 2026-11-26. Revised the same day after three reviews (security; a person coming from a managed platform; testability). Every quoted sentence in the spec is marked as a draft; the words are settled on the boards.
- Where two reviews pulled opposite ways, the spec keeps the safer reading and the open point says so (points 9 and 23).
- The two unchecked items are the maintainer's (M1, M2). Planning can start on the recommendations, but a decision that differs from one changes the requirements that name it.
- Any tool or package the plan proposes, the Railpack version pinned among them, is shown to the maintainer before it is used (M3).
