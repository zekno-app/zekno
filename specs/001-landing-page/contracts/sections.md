# Section Contract

Order, anchors, semantics and components for each part of the page. Copy comes from
the content files (see [content.md](./content.md)).

| # | Section | Anchor | Element | Rendering | Design-system components |
|---|---------|--------|---------|-----------|--------------------------|
| 1 | Navigation | — | `header` > `nav` | server + client menu | Button, FullscreenMenu |
| 2 | Hero | `#top` | `section`, the only `h1` | server + client stage | Badge, Button |
| 3 | Why | `#why` | `section` | server | — |
| 4 | How it works | `#how` | `section`, `h2` | client | Tabs |
| 5 | Feature blocks | `#features` | `section`, four `article`s with `h3` | server + client demos | Tabs (block d) |
| 6 | Threat model | `#security` | `section`, `h2` | client | Badge |
| 7 | Comparison | `#compare` | `section`, `h2`, `table` | server | Table |
| 8 | Open source | `#open-source` | `section`, `h2`, `ul` | server | Badge, Button |
| 9 | FAQ | `#faq` | `section`, `h2` | server | Accordion |
| 10 | Closing call to action | `#early-access` | `section`, `h2` | server | Button |
| 11 | Footer | — | `footer` | server | Separator |

## Rules for every section

- Anchored sections set `scroll-margin-top` to the navigation height so headings are not hidden.
- Content width is capped at 72rem with 1.5rem side padding (1rem under 400px).
- Headings follow one outline: `h1` in the hero, `h2` per section, `h3` inside sections.
- Links that leave the site open in a new tab with `rel="noreferrer"` and say so to assistive
  technology.

## Interactive contracts

| Control | Role and state | Keyboard |
|---------|----------------|----------|
| Mobile menu button | `button`, `aria-expanded`, labelled "Open menu"; opens a full-screen dialog whose close button ("Close menu") sits in the same place and takes focus | Enter or Space opens; Tab stays inside the menu; Escape or choosing a link closes; focus returns to the button |
| "Breach Zekno" / "Reset" | `button`; the label changes with the mode | Enter or Space |
| Hero stage | `role="img"` with a text alternative describing the three parties; the caption is a polite live region | — |
| How-it-works steps | tab list; each step is a tab with its panel | Arrow keys move, per the Tabs component |
| Team composition stages | tab list, as above | Arrow keys |
| Threat scenarios | list of `button`s with `aria-pressed`; result in a polite live region | Tab to each, Enter or Space selects |
| Comparison table | wrapper is a focusable `region` labelled "Comparison table" so it can be scrolled by keyboard | Arrow keys scroll when focused |
| FAQ items | Accordion: `button` with `aria-expanded` controlling a region | Enter or Space |

## Layout by width

| Width | Behaviour |
|-------|-----------|
| 360–639px | One column. Navigation collapses to a menu (the menu is used below 1024px, where the centred links would not fit on one line). Hero stage stacks the three parties vertically. Step tabs scroll sideways inside their own row. Threat results open under the selected scenario. Table scrolls inside its region. |
| 640–1023px | One column with wider stages; feature blocks still stack (media above text). |
| 1024px and up | Hero stage in one row. Feature blocks alternate left and right. Threat model shows the list beside the result panel. FAQ sits beside its heading. |

## Unresolved content

A control whose destination is a placeholder looks like the finished control, carries a
`data-placeholder` attribute, and does not navigate away. Placeholder text (source links, the
note under the closing call to action, footer links) renders in brackets with a dashed border.
