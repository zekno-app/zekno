# Motion Contract

Every animation on the page, with the purpose Constitution V requires. Durations are targets;
anything marked "feel-check" is tuned in the browser.

## Shared rules

- Curves: entrances and exits `cubic-bezier(0.23, 1, 0.32, 1)`; on-screen movement
  `cubic-bezier(0.77, 0, 0.175, 1)`; progress lines `linear`. Layout and shared-element moves use
  a spring with `bounce: 0`.
- Properties: `transform`, `opacity`, `clip-path`. Accordion height is the one exception.
- Entrances start at `scale(0.96)` or a 8–12px offset with `opacity: 0`, never `scale(0)`.
- Hover effects are inside `@media (hover: hover) and (pointer: fine)`.
- Looping stages run only while in view and while the tab is visible.
- Reduced motion: no loops, no travel. Controls still change state with an opacity cross-fade.
- State is never shown by lowering the opacity of text. Dimmed text failed the 4.5:1 contrast
  check, so inactive states use the muted text colour, icons and borders instead.

## Catalogue

| ID | Where | Purpose | Tool | Motion | Reduced motion |
|----|-------|---------|------|--------|----------------|
| M1 | Hero text | Preventing a jarring change | CSS animation | Badge, headline, copy, actions fade up 8px, 60ms apart, 500ms. Runs off the main thread, so it never waits for scripts. | Opacity only |
| M2 | Hero protocol stage | Explanation | Motion | Deploy loop, about 9s (see below) | Completed state, no loop |
| M2b | "Breach Zekno" | Explanation, feedback | Motion | Breach sequence, about 7s then hold (see below) | Jumps to the "refused" state |
| M3 | Why statement | Preventing a jarring change | CSS scroll-driven animation | One fade-up as it enters the viewport; no animation where the browser lacks support | None |
| M4 | How-it-works stepper | State indication, explanation | Motion `layoutId` + CSS | Active pill slides between steps; a linear progress line fills over 5s; the packet dot moves to the active party; the caption cross-fades in 200ms | Pill and dot jump; no progress line |
| M5 | Feature blocks | Preventing a jarring change | CSS scroll-driven animation | Text and media fade up as they enter the viewport | None |
| M6a | Block (a) leak demo | Explanation | Motion + scramble | Rows of a database dump re-scramble; a scan line passes; caption stays fixed | Static dump |
| M6b | Block (b) signature demo | Explanation | Motion | An unsigned manifest reaches the runner and is refused, then a signed one is accepted | Shows both results side by side |
| M6c | Block (c) uptime demo | Explanation | Motion | Zekno dims to "offline"; containers keep their running pulse; a direct machine-to-server line draws | Offline state, static |
| M6d | Block (d) team composition | Explanation, delight | Motion `layoutId` | Four-stage shared-element composition (see below) | Final stage, tabs cross-fade |
| M7 | Threat model | State indication | CSS / Motion opacity | Result panel cross-fades in 200ms; the compromised party re-shades | Same |
| M8 | Other sections | Preventing a jarring change | CSS scroll-driven animation | One fade-up as it enters the viewport | None |
| M9 | FAQ | Preventing a jarring change | CSS transition | Height and opacity, 200ms; chevron rotates | Opacity only |
| M10 | Buttons | Feedback | CSS transition | Press moves 1px (existing Button behaviour) | Unchanged |
| M11 | Nav | State indication | CSS transition | Border and background fade in once the page has scrolled | Unchanged |
| M12 | Mobile menu (full screen, below 1024px) | Spatial consistency, state indication | CSS transitions on the dialog's starting and ending states | Panel is revealed downward from the top bar with `clip-path`, 500ms; the menu icon's bars turn into a cross in place, 400ms; links then the two actions rise 14px one after another, 35ms apart, 450ms. Closing is a 200ms fade while the cross returns to bars. | 200ms fade only; no reveal, no rise, icon swaps without moving |

Not animated on purpose: the comparison table (people read across rows), the footer, and
anything triggered by keyboard navigation alone.

## M2. Hero deploy loop

| Beat | ms | What changes |
|------|----|--------------|
| `idle` | 900 | Machine shows three readable sample secrets and the team key. Zekno and server are empty. |
| `encrypt` | 1500 | A sealed packet forms on the machine; its lines scramble from the readable values to ciphertext, 90ms apart. |
| `sign` | 1000 | A "Signed" mark is revealed on the packet with a left-to-right `clip-path` wipe. |
| `relay-zekno` | 1300 | The packet moves to Zekno (shared element). A "stored, sealed" block fades in there. |
| `relay-server` | 1300 | The packet moves on to the server. Zekno keeps its sealed block. |
| `verify` | 1000 | "Signature verified" appears on the server with a check. |
| `run` | 1200 | Three containers switch on, 90ms apart. |
| `hold` | 1800 | Nothing moves. Then cross-fade to `idle`. |

A five-part progress rail under the stage shows Encrypt, Sign, Relay, Verify, Run.

## M2b. Breach sequence

| Beat | ms | What changes | Caption (live region) |
|------|----|--------------|-----------------------|
| `open` | 2200 | Zekno's frame takes the destructive colour and is labelled "Breached". Its sealed block opens to show ciphertext. | "The attacker reads everything Zekno holds. It is all ciphertext." |
| `forged` | 1800 | A dashed, unsigned packet leaves Zekno for the server. | "They push their own deploy to your server." |
| `refused` | 2400 | The packet arrives at the server, which shows "Refused: no team signature". Containers stay on. The packet is not dimmed, so its text keeps full contrast. | "Your server refuses it. It only runs what your team signed." |
| `hold` | 5600 | Still. Then return to the deploy loop. | unchanged |

Pressing "Breach Zekno" mid-loop retargets from the current state; nothing restarts from zero.

## M6d. Team composition (the signature piece)

One fixed-size stage. The same elements persist across four stages and move with shared-element
transitions (spring, `bounce: 0`, about 700ms, feel-check).

| Stage | Composition | What carries over |
|-------|-------------|-------------------|
| 1. Team | Three teammate tokens (initials in a circle, a small key beneath each) sit in a row at the centre. | — |
| 2. Sign | A deploy manifest card rises into the centre. The first teammate's token travels onto the card's signature line and a signature stroke draws. The other two tokens step back and dim. | Tokens; the card appears |
| 3. History | The manifest card compresses into the top row of a history list. Earlier rows fade in beneath it, each led by a teammate token that travels into place. | Card becomes a row; tokens become row leaders |
| 4. Servers | The history list compresses into a slim strip along the top. Three server tiles rise beneath it, a line draws from the strip to each, and their container dots switch on in sequence. Caption: "Your servers. You pay your provider directly." | Rows become the strip |

- Stage tabs (Team, Sign, History, Servers) sit under the stage with the same sliding pill and
  3.6s progress line as M4.
- No roles are named, no prices are shown, and nothing resembles an application window.
- Reduced motion: the server stage is shown; tabs switch stages with an opacity cross-fade.
