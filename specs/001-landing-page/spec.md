# Feature Specification: Zekno Landing Page

**Feature Branch**: `001-landing-page`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Marketing landing page for Zekno, served at the root of the website. For small engineering teams moving off managed hosting platforms to servers they own. A visitor understands in under a minute that Zekno deploys to their own servers while never holding a key, believes it because the page shows the mechanism and its limits honestly, and asks for early access or opens the GitHub repository. Eleven sections; interactive protocol-stage hero with a 'Breach Zekno' action and no app interface; feature block four is the signature motion piece; provider-neutral copy (no 'Hetzner prices')."

**Reference**: Wireframes at https://claude.ai/artifact/4e77d3Pqd9qQFRPTPsefyA. The maintainer's edited wording on the "Desktop 1440" board is the source of truth for copy, except where this specification overrides it (hero visual, feature block four, provider-neutral wording).

## Clarifications

### Session 2026-11-12

- Q: Where should "Get early access" send people, given there is no backend to store sign-ups? → A: An externally hosted form opened in a new tab. Built with a placeholder address that blocks publishing until the real link is supplied.
- Decision (2026-11-12, maintainer): the placeholder registry, the bracketed markers and the automated release check are removed. Undecided addresses are empty strings in the site config; an unset button stays visible without navigating and an unset footer link is hidden. Requirements and success criteria below that mention placeholders or the release check (the unresolved-placeholder edge case, the Content placeholder entity, SC-008) are superseded by this decision. Claims naming a company still need a linked source.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understand the promise and act on it (Priority: P1)

An engineer at a small team that is leaving a managed hosting platform opens the page. Without scrolling they read what Zekno is, who it is for, and that it never holds a key. They see that it is pre-alpha and open source. They either ask for early access or open the GitHub repository. Scrolling on, they can read every section of the page as plain content.

**Why this priority**: this is the whole job of the page. With only this story built, the page already explains the product and converts.

**Independent Test**: load the page with scripting disabled or animations off; confirm the headline, supporting copy, both actions, the maturity line and all eleven sections are present and readable, and that both actions lead where they say.

**Acceptance Scenarios**:

1. **Given** a first-time visitor on a desktop browser, **When** the page loads, **Then** the headline "Deploy to your own infrastructure. Keep every key.", the supporting copy, a "Get early access" action and a "View on GitHub" action are visible without scrolling.
2. **Given** a visitor anywhere on the page, **When** they look at the navigation bar, **Then** "Get early access" is available as the primary action.
3. **Given** a visitor reading the hero, **When** they look above the headline and below the actions, **Then** they see that the project is pre-alpha (announcement pill) and open source under the MIT license (status line).
4. **Given** a visitor who selects "View on GitHub", **When** the link opens, **Then** they land on the project's public repository.
5. **Given** a visitor who selects "Get early access", **When** the action completes, **Then** the externally hosted early-access form opens in a new tab.
6. **Given** a visitor who selects an in-page navigation link, **When** the page moves, **Then** the matching section is at the top of the viewport and not hidden behind the navigation bar.

---

### User Story 2 - See the mechanism instead of taking it on faith (Priority: P2)

A sceptical visitor wants to know how a hosted service can deploy for them without being able to read their secrets. The hero shows three parties (their machine, Zekno, their server) and plays one deploy: secrets are sealed on their machine, Zekno holds only a sealed packet, their server verifies and runs. The visitor presses "Breach Zekno" and sees that the attacker gets only ciphertext, and that a deploy the attacker pushes is refused. Further down, a five-step walkthrough explains each step in one sentence.

**Why this priority**: the claim is unusual; showing it is what separates this page from any other hosting page. It depends on Story 1 for the surrounding content.

**Independent Test**: watch the hero for one full loop, press "Breach Zekno", then step through the five-step walkthrough by keyboard; confirm each state matches the written security model.

**Acceptance Scenarios**:

1. **Given** the hero is on screen, **When** the visitor watches, **Then** one deploy plays from readable secrets on "your machine", to a sealed packet at "Zekno", to running containers on "your server", and then repeats.
2. **Given** the hero is on screen, **When** the visitor activates "Breach Zekno", **Then** the stage shows what an attacker who fully controls Zekno obtains (ciphertext only) and shows a deploy pushed by that attacker being refused by the server, with a short written explanation of each.
3. **Given** the breach view is showing, **When** the visitor activates "Reset" (or the breach sequence ends), **Then** the stage returns to the normal deploy loop.
4. **Given** the "How it works" section, **When** the visitor does nothing, **Then** the five steps (Encrypt, Sign, Relay, Verify, Run) advance on their own, each with a one-sentence description and the active party highlighted.
5. **Given** the "How it works" section, **When** the visitor selects a step or focuses the step controls, **Then** that step is shown and automatic advancing pauses.
6. **Given** any animated stage, **When** it is scrolled out of view, **Then** it stops playing, and it resumes when it returns.

---

### User Story 3 - Check the limits before trusting it (Priority: P2)

An engineer evaluating a security claim looks for what the product does not do. They find a threat-model section with six scenarios, three protected and three not protected, and can select each to read the outcome and the reason. They compare Zekno with a managed platform and with their own scripts in a table, see which parts are open source and which are closed, and read short answers to common questions.

**Why this priority**: honesty about limits is what makes the claim believable to this audience. It is independent of the animated stages.

**Independent Test**: select each of the six scenarios and confirm the outcome and reason match the written security model; read the comparison table on a phone; open and close each FAQ item by keyboard.

**Acceptance Scenarios**:

1. **Given** the threat-model section, **When** it first appears, **Then** six scenarios are listed, each labelled with its outcome, and the first is selected with its result and reason shown.
2. **Given** the threat-model section, **When** the visitor selects a "not protected" scenario, **Then** the result states plainly that Zekno does not protect against it and why.
3. **Given** the threat-model section, **When** the visitor reads below the scenarios, **Then** they see what metadata the control plane still sees.
4. **Given** the comparison table on a phone, **When** the table is wider than the screen, **Then** it scrolls sideways inside its own area and the page itself does not.
5. **Given** the open-source section, **When** the visitor reads it, **Then** each part of the system is marked open or closed, and the closed part is explained.
6. **Given** the FAQ, **When** the visitor activates a question, **Then** its answer opens, and activating it again closes it.

---

### User Story 4 - Feel what the product gives a team (Priority: P3)

A visitor scrolling the page meets four feature blocks. Each pairs a short claim with a small animated demonstration: a breach leaking nothing, an unsigned deploy being refused, apps staying up while Zekno is offline, and a team working together on servers they rent themselves. The fourth block is the page's showpiece: a multi-stage composition in which teammates, a signed deploy, the deploy history and the team's own servers transform into one another.

**Why this priority**: it adds persuasion and polish on top of a page that already explains and convinces.

**Independent Test**: scroll through the four blocks; confirm each demonstration plays only while visible, that the fourth passes through all of its stages with continuous transitions, and that none of them draws an application screen.

**Acceptance Scenarios**:

1. **Given** a feature block scrolls into view, **When** it becomes visible, **Then** its demonstration starts, and it stops when the block leaves the view.
2. **Given** the fourth feature block, **When** it plays, **Then** it moves through four stages (the team, a signed deploy, the deploy history, the team's own servers) and the same visual elements carry over from one stage to the next instead of being replaced.
3. **Given** the fourth feature block, **When** the visitor selects a stage, **Then** the composition moves to that stage and automatic advancing pauses.
4. **Given** any feature block, **When** the visitor reads its text and looks at its demonstration, **Then** no invented application screen, price or provider-specific claim is shown.

---

### User Story 5 - Use the page on any device and setting (Priority: P2)

A visitor reads the page on a phone, navigates it with a keyboard, prefers a dark theme, or has asked their device to reduce motion. The page is fully usable in each case.

**Why this priority**: the audience is engineers judging the team's care; a broken phone layout or an inaccessible control undermines a security pitch.

**Independent Test**: complete Stories 1 to 4 at phone width, by keyboard only, in dark theme, and with reduced motion turned on.

**Acceptance Scenarios**:

1. **Given** a phone-width screen, **When** the page loads, **Then** every section is readable in one column, the navigation collapses to a menu, and the page does not scroll sideways.
2. **Given** a keyboard user, **When** they tab through the page, **Then** every action, link, step, scenario and question is reachable, shows a visible focus indicator, and can be activated.
3. **Given** a visitor whose device asks for reduced motion, **When** the page loads, **Then** each animated stage shows a meaningful still state, nothing loops or travels, and every interactive control still changes what is shown.
4. **Given** a visitor using the dark theme, **When** they view any section, **Then** all text and controls remain legible and nothing appears as a light box on a dark page.

---

### Edge Cases

- A visitor activates "Breach Zekno" repeatedly or mid-loop: the stage moves to the breach view from wherever it is, without visual breakage or stacked sequences.
- A visitor switches steps or scenarios faster than the transitions take: the latest selection wins and intermediate states are skipped.
- The browser tab is in the background: animated stages do not keep running.
- The page is zoomed to 200%: text reflows without loss of content.
- A placeholder (incident links, pricing, contact, privacy, terms) is still unresolved: it is visibly marked in the working build and listed by the release check, and the page is not published.
- Scripting fails to load: all text, links and tables remain readable; animated stages show their still state; accordions and selectors show their content or default selection.
- Very long translated or edited copy in a heading: headings wrap; they never clip or overflow their section.

## Requirements *(mandatory)*

### Functional Requirements

**Page structure and actions**

- **FR-001**: The site's root address MUST present the landing page, replacing the starter page, with these sections in order: navigation, hero, why, how it works, feature blocks, threat model, comparison, open-source boundary, FAQ, closing call to action, footer.
- **FR-002**: The navigation MUST show the Zekno name, in-page links (How it works, Security, Open source, FAQ), a Docs link, a GitHub link and the primary "Get early access" action, and MUST stay available while scrolling. On narrow screens the links MUST collapse into a menu the visitor can open and close.
- **FR-003**: The hero MUST show an announcement pill above the headline (muted background, a blue "Pre-alpha" badge first, then the line "Zekno is in active development"), the headline "Deploy to your own infrastructure. Keep every key.", supporting copy, the "Get early access" and "View on GitHub" actions, and the line "Open source (MIT). Starting with Hetzner and Docker Compose."
- **FR-004**: "View on GitHub" and every GitHub link MUST open the project's public repository. Docs, Roadmap, License and "Report a vulnerability" MUST lead to the matching part of the repository until dedicated pages exist.
- **FR-005**: "Get early access" MUST open an externally hosted early-access form in a new tab. The form's address is a single configurable value; until the maintainer supplies it, it is an unresolved content placeholder under FR-025. The site itself MUST NOT collect or store visitor details.
- **FR-006**: The page MUST provide a title and description suitable for search results and link previews, consistent with the hero copy.

**Mechanism (hero stage and walkthrough)**

- **FR-007**: The hero visual MUST be a protocol stage showing three parties: the visitor's machine holding sample secrets and the team signing key, Zekno holding a sealed packet, and the visitor's server holding containers.
- **FR-008**: The hero stage MUST play one deploy on a loop in five beats: secrets are encrypted, the deploy is signed, the sealed packet is relayed through Zekno, the server verifies the signature, containers run.
- **FR-009**: The hero stage MUST offer a "Breach Zekno" action that shows, with a written line for each, that (a) an attacker who controls Zekno finds only ciphertext and (b) a deploy that attacker pushes is refused by the server. A "Reset" action MUST return the stage to the normal loop, and the stage MUST return on its own after the breach view has been shown for about 12 seconds without interaction.
- **FR-010**: The hero stage MUST NOT depict any application interface (windows, sidebars, dashboards, forms). All secret names and values shown MUST be fixed, obviously fake samples; the stage MUST NOT accept typed input.
- **FR-011**: The "How it works" section MUST present five steps (Encrypt, Sign, Relay, Verify, Run) over a three-party diagram, with a one-sentence description per step. Steps MUST advance automatically, MUST be selectable, and automatic advancing MUST pause while the visitor is interacting with them.

**Persuasion (why and feature blocks)**

- **FR-012**: The "Why" section MUST present the statement about the October 2026 incidents and the shared flaw. Each named company MUST carry a link to a public source; the claim MUST NOT be published without those links.
- **FR-013**: The page MUST present four feature blocks in alternating layout, each with a heading, one short paragraph and an animated demonstration:
  (a) "A breach of Zekno leaks nothing";
  (b) "Nobody deploys to your servers but you";
  (c) "We go down, you stay up";
  (d) a block about the team platform on servers the team rents itself.
- **FR-014**: Feature block (d) MUST be a multi-stage composition with four stages (the team, a signed deploy, the deploy history, the team's own servers) in which visual elements persist and transform between stages. Stages MUST advance automatically and MUST be selectable.
- **FR-015**: Feature block (d) MUST NOT show invented application screens, named roles, prices or cost figures, and its copy MUST NOT contain the phrase "Hetzner prices" or name a single provider as the basis of the claim.
- **FR-016**: Copy across the page MUST be provider-neutral. Hetzner and Docker Compose MAY be named only as the first supported targets (for example "Starting with Hetzner and Docker Compose").

**Trust (limits, comparison, openness, FAQ)**

- **FR-017**: The threat-model section MUST list six scenarios with their outcomes: database copied (protected), Zekno controlled and a deploy pushed (protected), Zekno down (apps keep running), a team member's machine compromised (not protected), one of the visitor's servers compromised (not protected), a Zekno app or agent release tampered with (not protected). Selecting a scenario MUST show its result and reason. Outcomes MUST be distinguishable without relying on colour.
- **FR-018**: The threat-model section MUST state the metadata the control plane still sees: server addresses, app names, deploy times and team membership.
- **FR-019**: The comparison section MUST present a table comparing Zekno, managed platforms and self-managed scripts across six rows: who can decrypt secrets, who can run code on the servers, what a vendor breach exposes, what happens when the vendor is down, team roles and deploy history, and whether it runs on servers the team owns.
- **FR-020**: Any comparison column that names a specific company or product MUST have its claims backed by a linked public source, or MUST use a generic category name instead.
- **FR-021**: The open-source section MUST list the core library, server agent, desktop app and website as open and the hosted control plane as closed, with the reason the closed part does not need to be trusted.
- **FR-022**: The FAQ MUST present eight questions that open and close individually: zero-knowledge proofs, what the control plane sees, what happens if Zekno goes down, what Zekno does not protect against, supported servers and providers, why the control plane is closed, production readiness, and cost. Answers MUST be consistent with the project README and MUST NOT state prices that have not been decided.
- **FR-023**: The closing call to action MUST restate the pre-alpha status and repeat both actions. The footer MUST show the product name, one-line description, link groups (Product, Open source, Company) and the copyright and licence line.

**Honesty and release control**

- **FR-024**: The page MUST NOT contain testimonials, customer logos, usage numbers, benchmarks or prices that do not exist.
- **FR-025**: Unresolved content (incident source links, pricing answer, contact, privacy and terms destinations, early-access destination if not yet provided) MUST be visibly marked in the working build, and a release check MUST list every unresolved item and fail while any remain.
- **FR-026**: The limits of the design MUST appear on the same page as the protections claimed (satisfied by FR-017 and FR-018).

**Experience quality**

- **FR-027**: Every section MUST be usable from 360px wide upward with no sideways page scrolling.
- **FR-028**: Every interactive element MUST be operable by keyboard with a visible focus indicator, and MUST expose its name and state to assistive technology.
- **FR-029**: The page MUST default to the dark theme for every visitor, regardless of their system setting, and MUST still render correctly in the light theme.
- **FR-030**: When the visitor's device requests reduced motion, every animated stage MUST show a meaningful still state without looping or travelling motion, while interactive controls continue to change what is shown.
- **FR-031**: Animated stages MUST play only while visible and while the tab is in the foreground.
- **FR-032**: The headline, supporting copy and actions MUST be readable before any animation starts, and animation MUST NOT shift the layout of surrounding content.
- **FR-033**: With scripting unavailable, all text content, links and the comparison table MUST remain readable, and each animated stage MUST show a still state.

### Key Entities

- **Section**: one of the eleven ordered parts of the page, with an anchor that navigation can target.
- **Party**: one of the three actors in the mechanism (your machine, Zekno, your server), with what it holds and what it can do.
- **Deploy step**: one of the five beats of a deploy (Encrypt, Sign, Relay, Verify, Run), with a name, the active party and a one-sentence description.
- **Threat scenario**: a situation, its outcome (protected, apps keep running, not protected), a short result and a reason.
- **Comparison row**: a question and the answer for each of the three columns.
- **Feature block**: a heading, a paragraph and a demonstration; block (d) additionally has four named stages.
- **FAQ item**: a question and its answer.
- **Content placeholder**: an unresolved fact with a name and the place it appears, which blocks publishing until resolved.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor can state, after viewing only the first screen for 10 seconds, what Zekno does and that it never holds a key (checked with 5 people from the target audience; at least 4 succeed).
- **SC-002**: After one visit, at least 4 of 5 target-audience readers can correctly name one thing Zekno protects against and one thing it does not.
- **SC-003**: The headline and both actions are readable within 2.5 seconds of opening the page on a mid-range phone over a typical mobile connection.
- **SC-004**: Nothing on the page visibly shifts position after it first appears (layout shift score under 0.1), and the page responds to any tap or key press within 200 milliseconds.
- **SC-005**: 100% of interactive elements can be reached and operated with a keyboard alone, and an automated accessibility audit of the page reports no violations at WCAG 2.2 AA.
- **SC-006**: At 360px, 768px and 1440px widths, in light and dark themes, no content is clipped, overlapped or scrolls sideways.
- **SC-007**: With reduced motion requested, zero elements loop or travel across the screen, and all five steps, six scenarios, four stages and eight questions remain reachable.
- **SC-008**: At publish time the release check reports zero unresolved placeholders, and every claim naming a company has a working source link.
- **SC-009**: A reviewer comparing the page against the README security model finds zero statements that contradict it.
- **SC-010**: The page shows zero invented application screens, testimonials, logos, statistics or prices.

## Assumptions

- **Hero direction**: the hero uses the interactive protocol stage recommended during wireframing instead of the app-window mock still drawn on the "Desktop 1440" board, because no desktop app design exists and the maintainer did not want to promise an interface.
- **Provider-neutral wording**: the hero supporting copy reads "on their own servers" (not "on their own Hetzner servers"), and feature block (d) is headed "A real team platform, on servers you rent yourself" with body copy that says the team pays its provider directly. These follow the maintainer's instruction not to appear locked in to Hetzner; the line "Starting with Hetzner and Docker Compose" stays.
- **Cost comparison**: the "[ADD COST COMPARISON]" note is dropped from block (d) for this release because no figures exist; a cost comparison can be added as a later feature once figures are available.
- **Illustrative details**: teammates in block (d) are shown as initials with a signing key each; no role names are shown because the product's role model is not defined yet.
- **Links**: GitHub links point to `https://github.com/zekno-app/zekno-monorepo`. "Docs" points to the repository README, "Roadmap" and "Report a vulnerability" to the matching README sections, and "License" to the LICENSE file, until dedicated pages exist.
- **Cost answer**: the FAQ answer on cost says pricing has not been announced and that teams pay their server provider directly, until the maintainer supplies pricing.
- **Comparison columns**: the maintainer's column names ("Managed platforms, e.g. Railway" and "Kamal or your own scripts") are kept, with source links required before publishing (FR-020).
- **Theme control**: dark is always the default, by the maintainer's instruction. No visible theme switch is added in this feature.
- **Language and region**: the page is in English only.
- **Analytics**: no analytics or tracking is added in this feature.
- **Out of scope**: the signed-in dashboard, documentation pages, the desktop app, a pricing page, a blog, and any service that stores early-access requests beyond what FR-005 resolves to.
