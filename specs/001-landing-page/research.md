# Research: Zekno Landing Page

Sources read on 2026-11-12: the installed Next.js 16.4.6 docs under
`node_modules/next/dist/docs/01-app/`, the installed `motion` 14.12.0 type definitions, the Motion
skill's React and Base UI guidance, `packages/ui/src/styles/globals.css`, and the current
`apps/web` sources.

## R1. Rendering model for the page

- **Decision**: `app/page.tsx` stays a Server Component with no request-time data, so the route is
  prerendered as static content. Interactive parts are separate files that start with
  `"use client"`.
- **Rationale**: the docs (`01-getting-started/05-server-and-client-components.md`, "Reducing JS
  bundle size") say to mark only the interactive components as client, not large parts of the UI.
  A build of the starter already reports `/` as `○ (Static)`.
- **Alternatives considered**: `ensureStatic` route config (`02-guides/keeping-pages-static.md`),
  not needed because nothing on the page reads request data; a single client page, rejected
  because it ships all copy as JavaScript and delays the headline.

## R2. Metadata

- **Decision**: export a static `metadata` object from `app/layout.tsx` (title, description, Open
  Graph and Twitter text fields).
- **Rationale**: `01-getting-started/14-metadata-and-og-images.md`, "Static metadata".
- **Alternatives considered**: a generated Open Graph image, deferred; it is not in the spec.

## R3. Animation library and import paths

- **Decision**: `motion` 14.12.0, already a dependency of `apps/web`. Client files import from
  `motion/react`. Never import from `framer-motion`.
- **Verified in the installed package**: `motion`, `AnimatePresence`, `LayoutGroup`, `MotionConfig`,
  `useReducedMotion`, `useInView`, `usePageInView`, `useAnimate`, `useMotionValueEvent` are
  exported. `stagger` and `AnimateNumber` are not, so staggering uses per-item `delay`.
- **Rationale**: block (d) and the hero need shared-element transitions (`layoutId`) and exit
  animations, which CSS cannot do. Everything simpler (hover, press, accordion, entrance fade)
  stays in CSS, per Constitution V "cheapest tool that works".
- **Alternatives considered**: CSS-only with View Transitions, rejected because shared elements
  must animate inside one component on a timer, not across navigations; Remotion, rejected
  because pre-rendered video cannot follow the theme, cannot be interactive and is heavier.

## R4. How animated stages are driven

- **Decision**: each stage is a small state machine. A pure module holds the ordered beats and
  their durations; a client hook advances the beat index on a timer; every visual is a function
  of the current beat, and Motion animates between the resulting states.
- **Rationale**: declarative states retarget cleanly when interrupted (the "Breach Zekno" press,
  fast step changes), which timed keyframe chains do not. The pure module is unit-testable with
  `bun test`.
- **Alternatives considered**: one imperative `useAnimate` timeline per stage, rejected because
  interruption and reduced-motion variants become special cases.

## R5. Only animate while visible

- **Decision**: the clock runs only when `useInView` (at least 35% visible) and `usePageInView`
  are both true and reduced motion is off.
- **Rationale**: spec FR-031 and Constitution V.

## R6. Reduced motion and no-script state

- **Decision**: every stage renders its completed state on the server (the deploy has run; block
  (d) shows its last stage). With reduced motion the clock never starts; controls still switch
  states, with opacity-only cross-fades. A `MotionConfig reducedMotion="user"` wrapper removes
  transform and layout animation as a second line of defence.
- **Rationale**: FR-030 and FR-033 ask for a meaningful still state. The completed state explains
  the most in one frame.
- **Trade-off**: when the loop starts after hydration the hero resets from the completed state to
  the first beat. It reads as the animation starting and does not move surrounding layout,
  because every stage reserves a fixed height.

## R7. Components from the design system

- **Decision**: add `badge`, `accordion`, `tabs`, `table`, `sheet` and `separator` to
  `packages/ui` with the shadcn CLI (`bunx --bun shadcn@latest add <name> -c apps/web`). Read each
  generated file before using it, because this registry style (`base-vega`) is built on Base UI,
  whose props differ from Radix (for example `render` instead of `asChild`).
- **Rationale**: Constitution IV. `button` is the only component present today.
- **Alternatives considered**: hand-written primitives, rejected by Constitution IV.

## R8. Tokens

- **Decision**: add one semantic colour pair to `globals.css`, `--signal` and
  `--signal-foreground`, for "signed / verified / running". Breach and refusal use the existing
  `--destructive`. No other colours are introduced.
- **Rationale**: the neutral palette cannot distinguish "verified" from "refused" in a diagram.
  Outcomes also differ by icon and text, so colour is never the only signal (FR-017).

## R9. Theme default

- **Finding**: `apps/web/providers/theme.provider.tsx` sets `defaultTheme="dark"` with
  `enableSystem`. The maintainer chose this after the wireframes.
- **Decision**: keep it. The page is designed dark-first and verified in both themes. The spec's
  FR-029 is updated to match.

## R10. Content and placeholders

- **Decision**: all copy lives in typed modules: `apps/web/config/site.ts` for site-wide copy and `apps/web/modules/landing/content/index.ts` for the landing page (one file, `apps/web/lib/landing/content.ts`, until the 2026-11-12 reorganisation). Unresolved
  facts are values created by `placeholder(id, where)`. A script, `bun run check:content`, lists
  unresolved placeholders and banned phrases and exits non-zero while any remain.
- **Rationale**: FR-025 needs a release check; one module makes copy reviewable against the
  README (SC-009) and testable.

## R11. Tests

- **Decision**: `bun test` for the pure modules (beat clock maths, content invariants). Add
  `@types/bun` as a dev dependency of `apps/web` so `tsc` can type-check the test files.
- **Rationale**: Constitution VII. Bun's test runner is built in; no other runner is added.
- **Alternatives considered**: Vitest, rejected as an unnecessary dependency; excluding tests
  from type-checking, rejected because untyped tests rot.

## R12. Existing code to respect

- `apps/web/app/layout.tsx` already loads Inter (`--font-sans`) and Geist Mono (`--font-mono`).
- `packages/ui/src/components/button.tsx` imports `cn` from the `cn` package; new landing
  components use `cn` from `@workspace/ui/lib/utils`, as `layout.tsx` does.
- `skullet` is an existing dependency that this feature does not use.
- `AGENTS.md` and `CLAUDE.md` are git-ignored; `next dev` rewrites `AGENTS.md`.
