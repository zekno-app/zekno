# Implementation Plan: Zekno Landing Page

**Branch**: `001-landing-page` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-landing-page/spec.md`

## Summary

Replace the starter page at `/` with an eleven-section marketing page that explains Zekno's
security mechanism and its limits. The page is a statically rendered Server Component. Five small
client islands carry the interaction: the hero protocol stage (deploy loop plus "Breach Zekno"),
the how-it-works stepper, three feature demos, the four-stage team composition in feature block
(d), and the threat-model selector. All copy lives in one typed content module with a placeholder
registry and a release check. Animation uses CSS for simple transitions and the `motion` library
for sequences and shared-element transitions.

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19.3, Node.js 26.13, Bun 1.4.2

**Primary Dependencies**: Next.js 16.4.6 (App Router), Tailwind CSS 4, shadcn/ui on Base UI
(`@workspace/ui`), `motion` 14.12, `lucide-react`, `next-themes`

**Storage**: N/A (no data is collected or stored)

**Testing**: `bun test` for pure modules; `bun run typecheck`, `bun run lint`, `bun run build`;
manual browser verification per [quickstart.md](./quickstart.md)

**Target Platform**: evergreen desktop and mobile browsers; statically prerendered route

**Project Type**: web application (one Next.js app in a Turborepo monorepo)

**Performance Goals**: LCP under 2.5s, CLS under 0.1, INP under 200ms on a mid-range phone;
animations at 60fps using transform and opacity

**Constraints**: no secret input anywhere; no app screens drawn; provider-neutral copy; works from
360px; keyboard operable; light and dark themes; reduced-motion and no-script still states;
animated stages reserve fixed height so nothing shifts

**Scale/Scope**: one route, eleven sections, five client islands, one content module, about
twenty component files, six design-system components added

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan satisfies it | Status |
|-----------|----------------------------|--------|
| I. Security Promise First | No inputs on the page. Secret names and values in the stages are constants in the landing module's content, written to be obviously fake. No environment variables or credentials are added. No closed-source dependency. | Pass |
| II. Honest Surface | Hero and demos draw parties, packets and containers, never app chrome. No stats, logos or testimonials. Named-company claims link to the companies' own reports (`sources` in `config/site.ts`); a content test requires each to be an `https://` address. "Pre-alpha" appears in the hero and the closing call to action. "Hetzner prices" stays out of the copy by agreement; the automated check for it was removed on 2026-11-12. Limits are in the threat-model section. | Pass |
| III. Read the Installed Docs First | Next.js 16 docs read for rendering, client boundaries and metadata (research R1, R2). Motion 14 exports checked in the installed package (R3). Generated shadcn files are read before use (R7). | Pass |
| IV. One Design System | Six components added to `packages/ui` through the shadcn CLI. One new token pair (`--signal`) added to `globals.css`; no hard-coded colours in components. | Pass |
| V. Motion With Purpose | Each animation's purpose is listed in [contracts/motion.md](./contracts/motion.md). Transform, opacity and `clip-path` only; accordion height is the one exception. No bounce. Reduced-motion variants and in-view gating are part of the shared clock hook. | Pass |
| VI. Accessible and Fast by Default | Semantic sections, one `h1`, real buttons and links, tab and accordion primitives from Base UI, live regions for stage captions, 360px layout, static prerender, headline rendered on the server. | Pass |
| VII. Verified Before Done | Unit tests for the clock and content invariants; root typecheck, lint and build; browser checks at three widths, two themes and reduced motion listed in quickstart. | Pass |

**Post-design re-check (after Phase 1)**: no violations introduced. One new dev dependency
(`@types/bun`) is justified in research R11. No new runtime dependency: `motion` was already
installed by the maintainer.

## Project Structure

### Documentation (this feature)

```text
specs/001-landing-page/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── content.md       # Shape of the content module and placeholder registry
│   ├── motion.md        # Every animation: purpose, tool, timing, reduced-motion state
│   └── sections.md      # Per-section structure, anchors and accessibility contract
├── checklists/
│   └── requirements.md
└── tasks.md             # Created by /speckit-tasks
```

### Source Code (repository root)

```text
apps/web/
├── app/                              # routes only
│   ├── layout.tsx                    # metadata, fonts, theme and motion providers
│   └── page.tsx                      # skip link, top bar, <LandingPage />, footer
├── modules/                          # one folder per feature
│   ├── module-seams.test.ts          # guards the dependency rules below
│   └── landing/
│       ├── index.ts                  # the module's interface: LandingPage
│       ├── components/
│       │   ├── landing-page.tsx      # server; the sections in reading order
│       │   ├── sections/             # hero, why, how-it-works, feature-blocks, threat-model,
│       │   │                         #   comparison, open-source, faq, closing-cta
│       │   ├── demos/                # client islands: protocol-stage, leak, signature, uptime,
│       │   │                         #   team-composition, demo-frame
│       │   └── ui/                   # section shell, stage-tabs, scramble-text, party-icon
│       ├── content/                  # index.ts: the page's copy; content.test.ts
│       ├── hooks/                    # use-beat-clock.ts: visibility and reduced-motion gating
│       ├── utils/                    # beats.ts: pure beat-clock maths; beats.test.ts
│       └── types/                    # shapes of the copy and sample data
├── components/                       # shared by the app shell and every module
│   ├── layout/                       # site-nav, mobile-menu, site-footer, logo-mark,
│   │                                 #   container, skip-link
│   ├── icons/                        # github-icon
│   └── content-link.tsx              # ContentLink, ButtonLink
├── config/
│   └── site.ts                       # site identity, links, navigation, footer, shared labels,
│                                     #   sources for claims, addresses still to be decided
├── types/                            # link.ts: Link
├── providers/                        # theme.provider.tsx, motion.provider.tsx
└── hooks/, lib/                      # shared hooks and libraries (none yet)

packages/ui/src/
├── components/                       # + badge, accordion, tabs, table, sheet, separator,
│                                     #   fullscreen-menu
└── styles/globals.css                # + signal, brand, info and surface tokens
```

**Structure Decision** (revised 2026-11-12, module-driven layout): each feature is a module under
`apps/web/modules`, used by the rest of the app through its `index.ts` only. Code that the app
shell or more than one module needs sits at the root of the app (`components`, `config`, `lib`,
`providers`, `hooks`, `types`). Dependencies point one way: `app` uses modules, modules use
shared code, shared code never imports a module. Inside a module, files use relative imports.
`modules/module-seams.test.ts` fails if any of this is broken. Shared primitives go to
`packages/ui` through the shadcn CLI. Root `package.json` has a `test` script and `turbo.json` has a `test` task. The placeholder
registry and the `check:content` release check were removed on 2026-11-12 at the maintainer's
request; undecided addresses are empty strings in `config/site.ts`.

## Complexity Tracking

No constitution violations. Nothing to justify.
