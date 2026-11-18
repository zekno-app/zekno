# Specification Quality Checklist: Deploy version 2, the first step

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-18
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [ ] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [ ] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [ ] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [ ] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [ ] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- The spec names the signed message's fields (`previous`, `expiresAt`, `builds`, `routes`,
  `health`, `predeploy`), its kind, the runner's refusal codes and protocol 3. They are the
  contract between the CLI, the runner and later the hosted service, and they are what a reviewer
  checks. It names no file, function or library, and points to the design's parts for detail.
- Not written for non-technical readers: a reader needs to know what a signed deploy and a runner
  are. It is written for a person who uses or reviews Zekno, as the reference specs are.
- There are no [NEEDS CLARIFICATION] markers. In their place, nine decisions wait in Assumptions,
  "Needs the maintainer", each with its options. Until they are answered:
  - FR-027, FR-028 and FR-050 point at items 6, 8 and 1 and are not yet testable or unambiguous.
  - The scope is not fully bounded: item 1 (which release, and whether this reaches `main`), item 4
    (the two findings in today's code) and item 5 (two locks and the time limit on `up`) each
    widen or narrow the work.
  - Item 2 (this CLI and a newer runner) is a gap neither the design nor the review covers.
- Five decisions of 2026-11-18 are recorded under Clarifications.
- Every new or changed line is in `design/lines.md` as a proposal. None is approved; the approval
  step for designs applies to this feature (FR-048). "Feature meets measurable outcomes" is left
  unchecked until the boards are approved and the nine items answered.
