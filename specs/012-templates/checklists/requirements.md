# Specification Quality Checklist: Templates

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-17
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- The spec names the product's own words (`zekno add`, `zekno deploy`, settings file, secret,
  image, volume), which are what a user of Zekno sees.
- Eight decisions of 2026-11-17 are recorded under Clarifications. Each template's exact
  settings, the file's format and every screen are left to the boards on purpose (FR-021): the
  approval step for designs applies to this stage.
- The four boards were approved on 2026-11-17. Nothing waits for the maintainer.
