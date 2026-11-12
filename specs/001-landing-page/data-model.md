# Data Model: Zekno Landing Page

The page stores nothing. Its "data" is the typed content in `apps/web/config/site.ts` and `apps/web/modules/landing/content/index.ts` and
the state of each interactive stage.

## Content entities

| Entity | Fields | Rules |
|--------|--------|-------|
| `Link` | `label`, `href: string \| Placeholder`, `external?` | An unresolved `href` renders as a marked, non-navigating control. |
| `Placeholder` | `kind: "placeholder"`, `id`, `where` | Created only by `placeholder()`, declared in the `pending` record. Listed by the release check. |
| `Party` | `id: "machine" \| "zekno" \| "server"`, `label`, `title`, `holds: string[]` | Exactly three, in that order. |
| `DeployStep` | `id: "encrypt" \| "sign" \| "relay" \| "verify" \| "run"`, `label`, `party`, `description` | Exactly five, in that order. One sentence each. |
| `SampleSecret` | `name`, `value`, `cipher` | Fixed fake values. `value` and `cipher` have equal length so text never reflows. |
| `FeatureBlock` | `id: "leak" \| "signature" \| "uptime" \| "team"`, `heading`, `body` | Exactly four. `team` also has four `stages`. |
| `TeamStage` | `id: "team" \| "sign" \| "history" \| "servers"`, `label`, `caption` | Exactly four, in that order. |
| `ThreatScenario` | `id`, `title`, `outcome: "protected" \| "running" \| "unprotected"`, `outcomeLabel`, `result`, `reason`, `compromised: PartyId \| "release" \| null` | Exactly six: three not `unprotected`, three `unprotected`. |
| `ComparisonRow` | `question`, `zekno`, `managed`, `scripts` | Exactly six. |
| `ComparisonColumn` | `label`, `source?: Placeholder \| string` | A column naming a company needs a `source`. |
| `OpenPart` | `label`, `status: "open" \| "closed"` | Five entries, one `closed`. |
| `FaqItem` | `question`, `answer` | Exactly eight. Answers agree with `README.md`. |

## Content invariants (enforced by `content.test.ts`)

- No string contains "Hetzner prices".
- "Hetzner" appears only in the hero status line and the FAQ answer on supported providers.
- Counts: 3 parties, 5 steps, 4 feature blocks, 4 team stages, 6 scenarios, 6 comparison rows,
  8 FAQ items.
- Every `SampleSecret` has `value.length === cipher.length`.
- Every placeholder id is unique.

## Stage state

### Beat clock (shared)

`beats.ts` is pure:

- `Sequence = { id: string; ms: number }[]`
- `totalMs(sequence)`: sum of durations.
- `nextIndex(index, length, loop)`: next beat, wrapping when `loop`, otherwise clamping.
- `beatAt(sequence, elapsedMs, loop)`: index for an elapsed time (used by tests and by resume).

`use-beat-clock.ts` holds `index` and exposes `{ index, id, set(index), pause(), resume() }`. It
advances only while the element is in view, the tab is visible, reduced motion is off and it is
not paused.

### Hero protocol stage

```text
mode: "deploy" | "breach"

deploy beats:  idle → encrypt → sign → relay-zekno → relay-server → verify → run → hold → (loop)
breach beats:  open → forged → refused → hold → (back to deploy at idle)
```

- "Breach Zekno" sets `mode = "breach"` at beat `open` from any deploy beat.
- "Reset", or the end of the breach `hold`, sets `mode = "deploy"` at beat `idle`.
- Server-rendered and reduced-motion state: `mode = "deploy"`, beat `run`.
- With reduced motion, "Breach Zekno" shows the breach `refused` state directly and "Reset"
  returns to `run`.

### How-it-works stepper

`step: 0..4`, auto-advancing every 5s, looping. Paused while the pointer is over the section's
controls or focus is inside them. Selecting a step sets it and keeps the pause until the pointer
and focus leave.

### Team composition (feature block d)

`stage: 0..3` (team, sign, history, servers), auto-advancing every 3.6s, looping. Same pause rule
as the stepper. Server-rendered and reduced-motion state: `servers`.

### Threat model

`selected: scenario id`, default the first scenario. No timer.

### Mobile menu

`open: boolean`, owned by the Sheet component.
