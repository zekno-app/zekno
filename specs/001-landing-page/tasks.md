# Tasks: Zekno Landing Page

> File paths in this checklist are the ones used when the tasks were done. The app was
> reorganised into modules on 2026-11-12; see the structure in [plan.md](./plan.md).

**Input**: Design documents from `/specs/001-landing-page/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: unit tests are included for the pure modules only, because Constitution VII requires
tests for logic with branches. No component or end-to-end test tasks are generated; interface
behaviour is verified in a browser per quickstart.md.

**Organization**: tasks are grouped by user story so each story can be built and checked on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task belongs to (US1 to US5)

## Path Conventions

Web app: `apps/web/`. Shared components and tokens: `packages/ui/`. All paths are relative to the
repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependencies, design-system components, scripts

- [X] T001 Add `@types/bun` as a dev dependency of `apps/web/package.json`, add `"test": "bun test"` to its scripts, and run `bun install` so `bun.lock` matches
- [X] T002 Add `"test": "turbo test"` and `"check:content": "bun apps/web/scripts/check-content.ts"` to the root `package.json`, and a `test` task to `turbo.json`
- [X] T003 Add `badge`, `accordion`, `tabs`, `table`, `sheet` and `separator` to `packages/ui/src/components/` with `bunx --bun shadcn@latest add <names> -c apps/web`, then read each generated file to learn its Base UI props
- [X] T004 Add the `--signal` and `--signal-foreground` tokens (light and dark values) and their `--color-*` mappings to `packages/ui/src/styles/globals.css`, plus the shared landing keyframes and the `scroll-margin-top` rule for anchored sections

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: content, placeholders and the animation clock that every story uses

**⚠️ CRITICAL**: no user story work can begin until this phase is complete

- [X] T005 [P] Create `apps/web/lib/landing/placeholders.ts` with `placeholder(id, where)`, `isPlaceholder(value)` and `registry()`; placeholder ids must be unique
- [X] T006 Create `apps/web/lib/landing/content.ts` exporting every entity in contracts/content.md with the counts in data-model.md ("Exactly three" parties, "Exactly five" steps, "Exactly four" feature blocks, "Exactly four" team stages, "Exactly six" scenarios, "Exactly six" comparison rows, "Exactly eight" FAQ items), the ten placeholders listed in contracts/content.md, and the wording decisions in its last table
- [X] T007 [P] Create `apps/web/lib/landing/beats.ts` with the pure functions `totalMs`, `nextIndex` and `beatAt` described in data-model.md
- [X] T008 [P] Write `apps/web/lib/landing/beats.test.ts` covering wrap-around when looping, clamping when not looping, and `beatAt` at beat boundaries
- [X] T009 [P] Write `apps/web/lib/landing/content.test.ts` enforcing the content invariants in data-model.md (no "Hetzner prices"; "Hetzner" only in the hero status line and the providers FAQ answer; entity counts; `value.length === cipher.length` for sample secrets; unique placeholder ids)
- [X] T010 Create `apps/web/lib/landing/use-beat-clock.ts`, a client hook that advances a sequence only while the element is in view, the tab is visible, reduced motion is off and it is not paused
- [X] T011 [P] Create `apps/web/scripts/check-content.ts` that prints unresolved placeholders and banned phrases and exits 1 while any remain
- [X] T012 [P] Create `apps/web/components/landing/section.tsx` (section shell with anchor, heading slot and width cap) and `apps/web/components/landing/placeholder.tsx` (bracketed marker and `data-placeholder` link treatment)
- [X] T013 [P] Create `apps/web/components/landing/motion-root.tsx`, a client wrapper with `MotionConfig reducedMotion="user"`

**Checkpoint**: content, clock and shells exist; `bun run test` passes

---

## Phase 3: User Story 1 - Understand the promise and act on it (Priority: P1) 🎯 MVP

**Goal**: the full page as readable content, with working actions and navigation

**Independent Test**: load `/` with animations ignored; the headline, copy, both actions, the pre-alpha line and all eleven sections are present, and links go where they say

### Implementation for User Story 1

- [X] T014 [P] [US1] Create `apps/web/components/landing/site-nav.tsx` (sticky header, in-page links, GitHub link, "Get early access") and `apps/web/components/landing/mobile-menu.tsx` (Sheet with the same links)
- [X] T015 [P] [US1] Create `apps/web/components/landing/hero.tsx` with the only `h1`, audience badge, body copy, both actions and the status line, using the M1 CSS entrance from contracts/motion.md
- [X] T016 [P] [US1] Create `apps/web/components/landing/why.tsx` with the incident statement and one source link per named company
- [X] T017 [P] [US1] Create `apps/web/components/landing/comparison.tsx` using the Table component inside a focusable scroll region
- [X] T018 [P] [US1] Create `apps/web/components/landing/open-source.tsx` listing the five parts with open or closed badges
- [X] T019 [P] [US1] Create `apps/web/components/landing/faq.tsx` using the Accordion component for the eight questions
- [X] T020 [P] [US1] Create `apps/web/components/landing/closing-cta.tsx` and `apps/web/components/landing/site-footer.tsx`
- [X] T021 [US1] Create `apps/web/components/landing/feature-blocks.tsx` with four `article`s in alternating layout and a media slot per block
- [X] T022 [US1] Replace `apps/web/app/page.tsx` with the eleven sections in order, and add static `metadata` (title, description, Open Graph text) to `apps/web/app/layout.tsx`

**Checkpoint**: the page reads end to end; typecheck, lint and build pass

---

## Phase 4: User Story 2 - See the mechanism (Priority: P2)

**Goal**: the hero protocol stage with deploy loop and breach, and the five-step walkthrough

**Independent Test**: watch one hero loop, press "Breach Zekno", then step through "How it works" by keyboard

### Implementation for User Story 2

- [X] T023 [P] [US2] Create `apps/web/components/landing/scramble-text.tsx`, a fixed-width text scramble that swaps instantly under reduced motion
- [X] T024 [US2] Create `apps/web/components/landing/protocol-stage.tsx` implementing the deploy beats in contracts/motion.md (M2): three party panels, shared-element packet, signature stroke, verify mark, containers, progress rail
- [X] T025 [US2] Add the breach mode (M2b) to `apps/web/components/landing/protocol-stage.tsx`: "Breach Zekno" and "Reset" buttons, the three captions in a polite live region, automatic return after the hold
- [X] T026 [US2] Mount the protocol stage in `apps/web/components/landing/hero.tsx` with a reserved height so nothing shifts
- [X] T027 [US2] Create `apps/web/components/landing/how-it-works.tsx` (M4): Tabs for the five steps, sliding pill, 5s progress line, pause on hover and focus, three-party diagram with the packet dot

**Checkpoint**: the mechanism plays, can be breached and reset, and pauses off-screen

---

## Phase 5: User Story 3 - Check the limits (Priority: P2)

**Goal**: the threat-model selector

**Independent Test**: select each of the six scenarios; outcome, result and reason match the README

### Implementation for User Story 3

- [X] T028 [US3] Create `apps/web/components/landing/threat-model.tsx` (M7): six `aria-pressed` buttons with outcome badges that differ by icon and text, a result panel in a polite live region beside the list on wide screens and under the selected scenario on narrow ones, a three-party mini diagram shading the compromised party, and the metadata note
- [X] T029 [US3] Mount the threat model in `apps/web/app/page.tsx` between the feature blocks and the comparison

**Checkpoint**: all trust sections work (comparison, open source and FAQ came with US1)

---

## Phase 6: User Story 4 - Feel what the product gives a team (Priority: P3)

**Goal**: animated demonstrations in the four feature blocks, with block (d) as the signature piece

**Independent Test**: scroll through the blocks; each demo plays only while visible; block (d) passes through four stages with elements carrying over

### Implementation for User Story 4

- [X] T030 [P] [US4] Create `apps/web/components/landing/demos/leak-demo.tsx` (M6a)
- [X] T031 [P] [US4] Create `apps/web/components/landing/demos/signature-demo.tsx` (M6b)
- [X] T032 [P] [US4] Create `apps/web/components/landing/demos/uptime-demo.tsx` (M6c)
- [X] T033 [US4] Create `apps/web/components/landing/demos/team-composition.tsx` (M6d): four stages with shared-element transitions for teammate tokens, the manifest card, the history rows and the server tiles; stage Tabs with sliding pill and 3.6s progress line; no role names, prices or app chrome
- [X] T034 [US4] Mount the four demos in `apps/web/components/landing/feature-blocks.tsx` and add the M5 in-view reveal

**Checkpoint**: all four blocks animate and stop when off-screen

---

## Phase 7: User Story 5 - Use the page on any device and setting (Priority: P2)

**Goal**: phone layout, keyboard operation, both themes, reduced motion, no script

**Independent Test**: repeat the earlier stories at 360px, by keyboard, in light theme, and with reduced motion on

### Implementation for User Story 5

- [X] T035 [US5] Check every section at 360px, 768px and 1440px, and at 200% zoom, in a browser and fix overflow, wrapping and stacking in the files under `apps/web/components/landing/`
- [X] T036 [US5] Check the light theme in a browser and fix any token misuse in the files under `apps/web/components/landing/`
- [X] T037 [US5] Emulate reduced motion in a browser and confirm the still states and working controls described in contracts/motion.md; fix `apps/web/lib/landing/use-beat-clock.ts` and the stage components where they differ
- [X] T038 [US5] Tab through the whole page in a browser and confirm focus order, visible focus and activation for every control listed in contracts/sections.md; fix the components where they differ
- [X] T039 [US5] Load the page with JavaScript disabled and confirm text, links, table and still stages render; fix server-rendered defaults where they differ

**Checkpoint**: quickstart scenarios 8 to 12 pass

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T040 Run `bun run typecheck`, `bun run lint`, `bun run test` and `bun run build` from the repository root and fix every failure
- [X] T041 Run `bun run check:content` and confirm it exits 1 listing exactly the ten placeholders in contracts/content.md
- [X] T042 Run the honesty sweep (quickstart scenario 13) and compare every claim in `apps/web/lib/landing/content.ts` with `README.md`
- [X] T043 [P] Update the "Repository" and "Commands" sections of `README.md` for the new `test` and `check:content` scripts and the landing page's status
- [X] T044 Run an automated accessibility audit (axe-core) against the running page in both themes and fix every violation in the files under `apps/web/components/landing/` (SC-005)
- [X] T045 Measure LCP and CLS on the production build (`bun run build` then `next start`) with a throttled profile and record the numbers in `specs/001-landing-page/quickstart.md` (SC-003, SC-004)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: needs Setup; blocks every story
- **US1 (Phase 3)**: needs Foundational
- **US2 (Phase 4)**: needs US1 (the stage mounts in the hero; the stepper mounts in the page)
- **US3 (Phase 5)**: needs US1 (mounts in the page)
- **US4 (Phase 6)**: needs US1 (media slots in the feature blocks)
- **US5 (Phase 7)**: needs US1 to US4, because it verifies them
- **Polish (Phase 8)**: needs everything above

### User Story Dependencies

- US2, US3 and US4 are independent of one another once US1 exists.
- US5 is a verification story over the others.

### Within Each User Story

- Content and hooks before components; components before mounting them in the page.
- T024 before T025 (same file). T033 before T034.

### Parallel Opportunities

- Phase 2: T005, T007, T008, T009, T011, T012, T013 touch different files.
- Phase 3: T014 to T020 touch different files.
- Phase 6: T030, T031, T032 touch different files.
- After US1: US2, US3 and US4 can proceed side by side.

---

## Parallel Example: User Story 1

```bash
# Seven independent section components:
Task: "Create site-nav.tsx and mobile-menu.tsx"
Task: "Create hero.tsx"
Task: "Create why.tsx"
Task: "Create comparison.tsx"
Task: "Create open-source.tsx"
Task: "Create faq.tsx"
Task: "Create closing-cta.tsx and site-footer.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 and Phase 2
2. Phase 3: the static page
3. Stop and check: the page already explains the product and both actions work

### Incremental Delivery

1. US1: readable page
2. US2: the mechanism plays in the hero
3. US3: threat model becomes interactive
4. US4: feature demos, including the signature block
5. US5: device, theme, keyboard and reduced-motion pass
6. Polish

---

## Notes

- The ten content placeholders are expected to remain at the end of this feature; resolving
  them is the maintainer's release step, not a task here.
- Commits are made only when the maintainer asks.
