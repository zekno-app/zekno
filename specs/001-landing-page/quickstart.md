# Quickstart: Validate the Landing Page

How to prove the feature works. Contracts: [sections](./contracts/sections.md),
[motion](./contracts/motion.md), [content](./contracts/content.md).

## Prerequisites

- Bun 1.4.2, Node.js 26.13+
- `bun install` from the repository root

## Automated checks (repository root)

```bash
bun run typecheck      # expect: all workspaces pass
bun run lint           # expect: no errors
bun run test           # expect: beats and content tests pass
bun run build          # expect: route "/" listed as static
```

## Run it

```bash
bun run dev            # http://localhost:3000
```

## Manual scenarios

Run each at 360px, 768px and 1440px wide, in dark and light themes.

1. **First screen (Story 1)**: headline, supporting copy, both actions and the pre-alpha line are
   visible without scrolling at 1440px. "View on GitHub" opens the repository in a new tab.
   "Get early access" is marked as unresolved until the form address is supplied.
2. **In-page links**: each navigation link lands with the section heading visible below the
   sticky bar.
3. **Deploy loop (Story 2)**: watch the hero for one loop. Order is encrypt, sign, relay through
   Zekno, verify, run. Scroll it out of view and back; it pauses and resumes.
4. **Breach**: press "Breach Zekno" mid-loop. Zekno shows ciphertext only; the forged deploy is
   refused; containers stay on; captions read correctly. "Reset" returns to the loop. Left alone,
   it returns by itself.
5. **Stepper**: steps advance every 5 seconds; hovering or focusing pauses; arrow keys move
   between steps.
6. **Feature demos (Story 4)**: each plays only while visible. Block (d) passes through Team,
   Sign, History and Servers with elements carrying over; selecting a stage jumps to it.
7. **Threat model (Story 3)**: select all six scenarios; outcome, result and reason match the
   README. Outcomes are readable in greyscale.
8. **Table on a phone**: the table scrolls inside its own area; the page does not scroll
   sideways.
9. **FAQ**: every item opens and closes by click and by keyboard.
10. **Keyboard only (Story 5)**: Tab from the top of the page to the footer. Every control is
    reachable, shows focus and can be activated. Open and close the mobile menu with the
    keyboard at 360px.
11. **Reduced motion**: turn on "reduce motion" in the operating system (or emulate it in
    developer tools) and reload. Nothing loops or travels. Stages show their completed state.
    "Breach Zekno", steps, stages and scenarios still change what is shown.
12. **No script**: disable JavaScript and reload. All text, links and the table are readable and
    each stage shows a still state.
13. **Honesty sweep**: search the page for "Hetzner". It appears only in "Starting with Hetzner
    and Docker Compose" and the FAQ answer on providers. There are no app screens, prices,
    logos or testimonials.

## Results recorded on 2026-11-12

Checked with Chrome driven by a script against `next dev` (behaviour) and `next start`
(performance), on the maintainer's machine.

| Check | Result |
|-------|--------|
| Sideways overflow at 320, 360, 414, 720, 768, 1024, 1440, 1920px | None |
| Themes | Dark and light reviewed at 1440px; dark at 360px and 768px |
| Reduced motion | Stage unchanged over 4s, no looping animations, breach and stepper controls still work |
| Keyboard | 38 stops from skip link to footer in a sensible order; breach by Enter, FAQ by Space, arrow keys move between steps; mobile menu opens by Enter, closes by Escape and returns focus |
| No script | Headline, all nine `main` sections, six table rows, first FAQ answer and still stages render |
| axe-core, WCAG 2.2 AA | 0 violations in the default state, both themes, 360px and 1440px. Sampling while stages animate reports only frames caught mid cross-fade |
| LCP, throttled phone profile (4x CPU, 1.6 Mbps, 150ms) | 1.43–1.46s over three runs (local server, so no real network distance) |
| CLS over a full hero loop | 0 |
| Transfer size | 332 KB total, 240 KB of it JavaScript |

## Not covered by this guide

- SC-001 and SC-002 need five readers from the target audience.
- SC-003 and SC-004 need a throttled profile on a real mid-range phone; a local Lighthouse run
  is an approximation.
