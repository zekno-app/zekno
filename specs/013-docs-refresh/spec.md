# Feature Specification: README and docs refresh

**Feature Branch**: `013-docs-refresh`

**Created**: 2026-11-18

**Status**: Approved. The direction and the six boards (`design/`) were approved by the maintainer on 2026-11-18 (see Clarifications), with one change: the desktop app is not named anywhere in the README or the docs.

**Input**: User description: "I think we built a lot since the first README and the docs page were created. Now should we update them to match our current process including the CLI designs?" Answered with four proposals, and the maintainer said "Do it": the root README says what works today first; the one long CLI page of the docs is split into pages; the docs show the CLI's real screens; the CLI's own README is cut down to a developer's guide.

## Clarifications

### Session 2026-11-18

- Q: Is this done now or after domains (stage 3)? → A: Now, as feature 013. Domains becomes 014.
- Q: How do the CLI's screens appear in the docs? → A: As real captures of the program, shown as terminal frames whose text can be selected. Not drawn by hand, and not photographs.
- Q: Is the long CLI page split? → A: Yes, into a quick start, the terminal app, one page per group of commands, and reference pages.
- Q: Does the CLI's README keep its full copy of the docs? → A: No. It becomes a guide for people who build and test the CLI, and points to the docs for the rest.
- Q: Does this cover how the project is built (specs, boards before code, reviews)? → A: Not asked for. Out of scope unless the maintainer says otherwise.
- Q: Are the six boards approved? → A: Yes, all of them: the seventeen pages and their names, the frame, the README's top with the badge "audit: none yet", the README's picture as a file made from the capture, and the roadmap in the road map's order.
- Q: Is the desktop app described as planned? → A: No. The maintainer: "since we don't have anything related to the desktop app, defer all terms related to it in my docs and readme so users won't ask about it". It is not named in the README or the docs. Where the design needs a program on the developer's machine, that program is the CLI, which holds the key today.

## Why

The README and the docs were first written in the project's first week, when nothing ran. Since then eleven features were built, and each added its paragraphs where the last one stopped. The facts are mostly right. The shape is not:

- The README opens with "This repository is being scaffolded" and draws a desktop program and a hosted service, neither of which exists. What a person can run today, the CLI talking to the runner over SSH, is not drawn anywhere, and there is no way in for someone who wants to try it.
- The docs are four pages. One of them is 1,975 lines. There is no quick start. No screen of the CLI is shown, though its screens were designed with care and are the first thing a person meets.
- The CLI's README is 1,854 lines of nearly the same text as the docs page, so every change is written twice.

A person who finds the repository should learn in a minute what Zekno is, what works today, and what is only planned. A person who uses the CLI should find the page for the command in front of them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understand the project from the README (Priority: P1)

A developer opens the repository on GitHub. Before they scroll, they learn what Zekno is, that it is pre-alpha and unaudited, what works today, and what one screen of it looks like. They can tell the parts that exist from the parts that are planned.

**Why this priority**: The README is the first page anyone sees, and today it describes a product that is not there.

**Independent Test**: Give the README to someone who has never seen the project. They can say what they could run today and what they could not.

**Acceptance Scenarios**:

1. **Given** the README, **When** a reader reads its first screen, **Then** they find what works today (the CLI and the runner, over SSH, one developer), stated before the planned design.
2. **Given** the architecture section, **When** a reader looks at it, **Then** the path that exists today is drawn first, and the design with the hosted service is drawn after it and labelled as planned, with the CLI as the program on the developer's machine.
3. **Given** the README, **When** a reader looks for a screen of the CLI, **Then** they find one, made from the real program.
4. **Given** the security model as it stands today, **When** the README is rewritten, **Then** every promise, every limit and every design rule it states is still stated, with none weakened.
5. **Given** the road map the maintainer follows, **When** a reader reads the README's roadmap, **Then** it lists the same stages in the same order.

### User Story 2 - Try it, from nothing to a live app (Priority: P1)

A developer with a Linux server and Docker on it wants to try Zekno. One page takes them from a checkout to an app running on their server, and shows what they will see at each step.

**Why this priority**: There is no such page, so nobody can try the product without reading two thousand lines.

**Independent Test**: Follow the quick start on a clean machine with a server at hand. It ends with an app running, using only what the page says.

**Acceptance Scenarios**:

1. **Given** the docs, **When** a reader opens them, **Then** a quick start is the second page of the tree and is linked from the introduction and from the README.
2. **Given** the quick start, **When** a reader follows it, **Then** each step names one command, shows what the program prints for it, and says what happened.
3. **Given** the quick start, **When** it names a requirement or a limit (Bun's version, built from source, one developer, a supported server), **Then** it is the same requirement the reference pages state.

### User Story 3 - Find the page for one command (Priority: P2)

A developer wants to know what `zekno secret import` does with a line it cannot read. They open the page about secrets and find it, without scrolling past deploys and settings.

**Why this priority**: Everything is written down already, and hard to find.

**Independent Test**: For any command of the help, a reader reaches its section in two clicks from the docs' first page.

**Acceptance Scenarios**:

1. **Given** the docs, **When** a reader looks at the page tree, **Then** the pages are grouped (start, using zekno, reference) and each command belongs to exactly one page.
2. **Given** today's CLI page, **When** it is split, **Then** every statement in it is on one of the new pages, or is on a written list of what was dropped and why.
3. **Given** a link to today's CLI page, **When** someone follows it after the split, **Then** they reach a page that lists every command and where it is described.
4. **Given** the new pages, **When** the test that holds the docs and the CLI in step runs, **Then** it passes: every command, flag and key of the CLI is named in the docs, and every command the docs name exists.

### User Story 4 - See the CLI before installing it (Priority: P2)

A reader of the docs sees what the terminal app and the single commands look like: the real screens, in the terminal's own characters and colours.

**Why this priority**: The CLI's interface is the product today, and the docs describe it only in tables.

**Independent Test**: Change a sentence the program prints. A test names the screen in the docs that no longer matches.

**Acceptance Scenarios**:

1. **Given** a page that shows a screen, **When** a reader looks at it, **Then** the screen is what the program prints for that command or state, with nothing edited by hand.
2. **Given** a screen in the docs, **When** the program's output for it changes, **Then** a test fails and names that screen.
3. **Given** a screen in the docs, **When** a reader selects its text, **Then** they can copy it.
4. **Given** a narrow window, **When** a screen is wider than the page, **Then** the screen scrolls sideways inside its frame and the page does not.
5. **Given** any screen in the docs or the README, **When** it shows a name, an address or a code, **Then** it is an example value, never one from a real machine.

### User Story 5 - One place for each fact (Priority: P3)

A person who works on the CLI finds how to build, run and test it in a short README. A person who changes how a command behaves updates one page.

**Why this priority**: It halves the writing for every later feature.

**Independent Test**: Search the repository for one sentence about a command's behaviour. It is found in one page of the docs and nowhere else.

**Acceptance Scenarios**:

1. **Given** the CLI's README, **When** a developer opens it, **Then** it says how to build, run, develop and test the CLI, and points to the docs for what the commands do.
2. **Given** the CLI's README and the docs, **When** both are read, **Then** no section of one repeats a section of the other.

### Edge Cases

- A page of the docs links to a heading of today's CLI page. After the split the link points at the heading's new page.
- The CLI prints an address of the docs. It still leads to a page that exists.
- A screen needs a server, a team or a running app to exist. It is captured against stand-ins, as the tests do, and never against a real server.
- A screen holds a code or a time that differs on every run. The capture is made so that it is the same every time.
- GitHub cannot run the docs site's components. The README's screen is a picture made from the same capture.
- The site is dark for every visitor. A screen is dark too, and readable.

## Requirements *(mandatory)*

### Functional Requirements

**The root README**

- **FR-001**: The README MUST state, on its first screen, that the project is pre-alpha and unaudited, in words that are true today. It MUST NOT say the repository is being scaffolded.
- **FR-002**: The README MUST say what works today before it describes the planned design: the CLI and the runner, deploying directly over SSH, for one developer.
- **FR-003**: The README MUST draw the path that exists today, and MUST label the design with the hosted service as planned. In that design the program on the developer's machine is the CLI.
- **FR-004**: The README MUST hold a short way to try the CLI, and a link to the quick start.
- **FR-005**: The README MUST show one screen of the CLI made from the real program.
- **FR-006**: The README MUST keep every promise, limit, threat-table row and design rule of the security model it holds today. A reworded one MUST mean the same. The rows and rules that name the desktop app are reworded to name the CLI or the developer's machine, and each rewording is written down for the maintainer to read (FR-028).
- **FR-007**: The table of what exists MUST state each part's status in a sentence or two, and point to the docs for detail.
- **FR-008**: The README's roadmap MUST list the stages of the road map the maintainer follows, in its order, and mark what is done.

**The docs**

- **FR-009**: The docs MUST have a quick start that goes from a checkout to an app running on the reader's server.
- **FR-010**: Today's CLI page MUST be split into pages grouped in the page tree. No page of the docs may be longer than 500 lines.
- **FR-011**: Every statement of today's CLI page MUST be kept on one new page, or be named on a written list of what was dropped and why. Nothing is dropped silently.
- **FR-012**: The address of today's CLI page MUST stay, as a page that lists every command and links to where it is described.
- **FR-013**: The introduction MUST describe a deploy as it happens today, and the planned design as planned.
- **FR-014**: Every link inside the docs, and every address of the docs that the CLI prints, MUST lead to a page and a heading that exist. A test checks it.
- **FR-015**: The test that holds the docs and the CLI in step MUST keep passing over the new pages, and MUST fail as it does today when a command, flag or key is missing from them.

**Screens**

- **FR-016**: Each screen shown in the docs or the README MUST be captured from the real program by a command in the repository, and stored as text.
- **FR-017**: A test MUST fail, and name the screen, when a stored screen differs from what the program prints.
- **FR-018**: A screen in the docs MUST be text a reader can select, in the terminal's characters and the CLI's colours, on a dark ground.
- **FR-019**: A screen wider than the page MUST scroll inside its frame. The page MUST NOT scroll sideways.
- **FR-020**: A screen MUST be described for a reader who cannot see it.
- **FR-021**: Screens MUST show example values only: example names, an address from the range kept for documentation, codes made for the capture.
- **FR-022**: Capturing a screen MUST use stand-ins. It MUST NOT reach a real server, the network, the system keychain or the person's own profile.

**One place for each fact**

- **FR-023**: The CLI's README MUST hold what a developer of the CLI needs (build, run, develop, test, end-to-end tests) and MUST NOT repeat what the docs say about commands, screens and files.
- **FR-024**: The runner's page and README, the contributor guide and the templates page keep their content. Only links that point at moved text change.

**What stays as it is**

- **FR-025**: No behaviour of the CLI, the runner or the core library changes. The CLI's sentences stay as they are.
- **FR-026**: No package is added to the repository without the maintainer's agreement.
- **FR-027**: The wording rules of the project hold in every new sentence: "runner", never "agent"; pre-alpha and unaudited stay visible; nothing is promised that is not built.

**No desktop app**

- **FR-028**: The README, the READMEs of the apps and every page of the docs MUST NOT name the desktop app, its folder or the framework chosen for it. A test checks it. Every sentence that named it today is on a written list with the sentence that replaces it, or the reason it was removed. The landing page is not part of this feature and is not changed.

### Key Entities

- **Page**: one file of the docs, with a title, a place in the page tree and headings that links can point at.
- **Screen**: a named capture of what the program prints for one command or one state, at a stated size, stored as text with its colours.
- **Frame**: how a screen is shown on a page of the docs, and the picture made from it for the README.
- **Move list**: for each heading of today's CLI page, the page it went to, or the reason it was dropped.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader new to the project can say, after one minute with the README, what they can run today and what is planned.
- **SC-002**: A reader reaches the description of any command in two clicks from the docs' first page.
- **SC-003**: No page of the docs is longer than 500 lines (today: one of 1,975).
- **SC-004**: The CLI's README is under 250 lines (today: 1,854), and no section of it repeats the docs.
- **SC-005**: Every screen in the docs and the README is reproduced by one command, twice in a row, with the same result.
- **SC-006**: Every heading of today's CLI page is on the move list, with zero unexplained.
- **SC-007**: No sentence of the README or the docs presents a part that is not built as if it were, and none names the desktop app.
- **SC-008**: Every check of the repository passes, and no file of the CLI's source, the runner or the core library has changed.

## Assumptions

- The docs site keeps its layout, its framework and its dark colours. This feature adds pages and one way to show a screen. It does not redesign the site.
- Screens are captured at 100 columns by 30 lines, the size the designs were drawn at. A page may use the 80 by 24 capture where it reads better.
- The hosted service and teammates stay described, because the security model is the reason for the project. They are labelled as planned wherever they appear. The desktop app is not described at all (FR-028).
- The landing page is not part of this feature.
- The built site is not started or built from here. Pages are checked by the repository's tests and by compiling their text. The maintainer looks at the running site.
- How the project itself is built (specs, boards, reviews) is not documented by this feature.
