# Feature Specification: The Zekno Terminal App

**Feature Branch**: `004-cli-app`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "CLI app and runner, second version. Design is agreed and lives on the design canvas (nine screens); the spec must follow it and must not redesign it. A full-screen terminal app opened by running `zekno` with no arguments; first run from nothing; adding a server that installs the runner by itself; a deploy view with a summary panel and stages; live logs; secrets inside the app and a warning for values the Compose file expects; a project file `zekno.json`; single commands kept for scripts; the pixel wordmark logo; two read-only runner commands; one SSH connection per command; docs updated to match."

**Design reference**: the canvas "Zekno CLI interface", https://claude.ai/artifact/BVuvZPZTReLa4TSHfyzMJW. Nine screens, approved by the maintainer on 2026-11-13. Where this document and the canvas disagree about how a screen looks or reads, the canvas is right and this document is corrected.

## Clarifications

### Session 2026-11-13

- Q: How should the CLI behave when a command is run without all its details? → A: Running `zekno` alone opens a full-screen app that is moved around with keys. Single commands stay for scripts. Chosen by the maintainer over a guided question-and-answer style and over flags only.
- Q: What does a deploy look like while it runs? → A: A summary panel, a row of stages and one live line of progress. Chosen by the maintainer over a step list and a single line.
- Q: Where does a project remember its app, server and Compose file? → A: In a file named `zekno.json` in the project folder. Chosen by the maintainer over other formats and over no file.
- Q: Which logo does the app show? → A: The pixel wordmark "zekno.app", with "zekno" in white and ".app" in the brand blue, as solid blocks three lines tall, in the header of every app screen and on the first-run screen. The maintainer rejected a smaller dotted version.
- Q: The design shows a running or stopped state, live logs, the runner installed during "add a server", the project file and a warning about missing secrets. Which of these are in this feature? → A: All of them.
- Q: Who decides stack and library choices, such as where runner releases are published? → A: The maintainer, during planning. Nothing of that kind is assumed here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operate my servers and apps from one screen (Priority: P1)

A developer who already has a team and a connected server runs `zekno`. A full-screen app opens. They see their servers, the apps on the selected server, and the details and actions for the selected app. They open an app, look at its deploy history and its secrets, deploy the project folder they are in, and roll back to an earlier deploy, all with the keyboard.

**Why this priority**: this is the product's new face. Every other story is reached through it, and on its own it already replaces typing long commands with flags.

**Independent Test**: with a profile that has one server and one deployed app, open the app, deploy, roll back and set a secret using only the keys shown at the bottom of each screen, and confirm the server ran each deploy.

**Acceptance Scenarios**:

1. **Given** a team with two servers and three apps, **When** the developer runs `zekno` at a terminal, **Then** the Home screen shows the servers, the selected server's apps with deploy number and when each was last deployed, and the selected app's details and actions, laid out as on the canvas.
2. **Given** the Home screen, **When** the developer moves with the arrow keys and presses Enter on an app, **Then** the app's screen opens with its deploy history and its secrets by name and version, and Esc returns to Home.
3. **Given** an app's screen, **When** the developer presses the deploy key, **Then** a summary panel shows the deploy number, app, server, file, secrets and what it replaces, a row of stages advances from Checked to Started, and one line shows the current progress.
4. **Given** a deploy in progress, **When** the developer presses Esc, **Then** they return to the app's screen and the deploy carries on; **When** they quit instead, **Then** the app waits for the deploy to finish before it closes.
5. **Given** a deploy whose app does not start, **When** it ends, **Then** the failed stage is marked, what Docker reported is shown, and the developer is told the number is used.
6. **Given** an app with several deploys, **When** the developer selects an earlier one and presses the rollback key, **Then** that definition is deployed again under the next number.
7. **Given** an app's screen, **When** the developer presses the secret key, types a name and a hidden value, **Then** the secret is stored and marked as taking effect on the next deploy, and its value is never shown.
8. **Given** any screen, **When** the developer presses the help key, **Then** every key that works on that screen is listed.

---

### User Story 2 - From nothing to a running app without leaving the app (Priority: P2)

A developer who has just installed Zekno runs `zekno`. The app greets them with the logo and three steps: their key, a server, a first deploy. They type their name, then an SSH destination. The app connects, checks the server, installs the runner there, sets it up and adds the server to the team. They never log in to the server themselves.

**Why this priority**: the first test on a real server showed that installing the runner by hand is the slowest and most error-prone part. Without this story the app is only pleasant for people who already got through that.

**Independent Test**: on a machine with no Zekno profile and a server that has Docker but no runner, go from `zekno` to a running app, typing nothing on the server.

**Acceptance Scenarios**:

1. **Given** no team on this machine, **When** the developer runs `zekno`, **Then** the first-run screen shows the logo, the three steps and a question for their name, and says where the key will be kept.
2. **Given** the name is entered, **When** the key is created, **Then** step 1 is marked done and the app moves to "add a server".
3. **Given** an SSH destination and a name for the server, **When** the developer confirms, **Then** the app shows each step as it completes: connected, Docker with Compose found, runner installed and verified, runner set up for the team, server added to the signed team list.
4. **Given** a server with no runner, **When** the runner is installed, **Then** the server fetches a published release itself and the release is checked against a value the CLI already holds before it is installed.
5. **Given** "add a server" is running, **When** the team code and server code are shown, **Then** each has a sentence saying what it identifies and when someone would compare it.
6. **Given** a server that already has a runner set up for this team by an earlier attempt, **When** "add a server" runs, **Then** it carries on from there.
7. **Given** a server whose runner belongs to another team, **When** "add a server" runs, **Then** it stops and says so, and changes nothing on the server.
8. **Given** a server with an older runner than this CLI needs, **When** the developer opens it, **Then** the app says the runner is out of date and offers to update it by the same verified route.

---

### User Story 3 - See what is running and read the logs (Priority: P3)

A developer wants to know whether their app is up, and why it is not. Home and the app's screen show each app as running or stopped. One key opens the app's logs, which follow live, can be paused, filtered and narrowed to one service.

**Why this priority**: a failed start is the first thing that goes wrong for a new user, and today the only way to look is to log in to the server.

**Independent Test**: deploy an app that writes a line every few seconds, open its logs in the app and watch new lines arrive; stop the container on the server and see the state change.

**Acceptance Scenarios**:

1. **Given** apps on a server, **When** Home or an app's screen is shown, **Then** each app is marked running or stopped, by a word and a symbol as well as a colour.
2. **Given** a server that cannot be reached, **When** Home is shown, **Then** that server is marked unreachable and the rest of the app still works.
3. **Given** an app's screen, **When** the developer presses the logs key, **Then** recent lines from all its services are shown with time and service name, and new lines appear as they are written.
4. **Given** the logs screen, **When** the developer pauses, filters by text or picks one service, **Then** the view does that, and following can be resumed.
5. **Given** the logs screen, **Then** it states that the logs are read straight from the developer's server and do not pass through Zekno.
6. **Given** the connection drops while logs are following, **Then** the screen says so and offers to reconnect.

---

### User Story 4 - A project that remembers where it deploys (Priority: P4)

A developer links a project folder to an app and a server once. From then on `zekno deploy` in that folder needs no flags, and `zekno` opens focused on that app. Before a deploy, the developer is told which values the Compose file expects that have no secret yet, and can set them on the spot.

**Why this priority**: it removes the repeated `--app` and `--server`, and catches the most common cause of a broken first deploy, a missing value.

**Independent Test**: in a folder with a Compose file that expects two values, link the folder, try to deploy, set the two values when asked, and deploy with no flags.

**Acceptance Scenarios**:

1. **Given** a folder with no project file, **When** the developer deploys it from the app for the first time, **Then** the app offers to write `zekno.json` with the app name, server and Compose file.
2. **Given** a folder with `zekno.json`, **When** the developer runs `zekno deploy` with no flags, **Then** the app, server and file come from it.
3. **Given** a folder with `zekno.json`, **When** the developer runs `zekno`, **Then** the app opens with that server and app selected, and says the folder is linked.
4. **Given** a Compose file that expects values with no secret set, **When** the developer starts a deploy in the app, **Then** the missing names are listed and each can be set with the hidden prompt, or the developer can deploy without them.
5. **Given** `zekno.json` names a server or app this machine does not know, **When** any command reads it, **Then** the command says which name is unknown and does nothing else.
6. **Given** flags on the command line and a `zekno.json`, **Then** the flags win.

---

### User Story 5 - Single commands that match, and still work in scripts (Priority: P5)

A developer, or a script, runs one command and gets one result. At a terminal the commands use the same look as the app: the deploy summary panel, the same symbols and wording. Piped, in CI or with `--json` they print plain, stable lines and never ask a question. Each command reaches the server over one connection.

**Why this priority**: scripts and quick one-off commands already exist and must keep working; they should also not feel like a different product.

**Independent Test**: run `zekno deploy`, `zekno status` and `zekno secret ls` at a terminal and compare with the canvas; run the same commands piped and compare with the documented plain output.

**Acceptance Scenarios**:

1. **Given** a terminal, **When** `zekno deploy` runs, **Then** it shows the summary panel, the stages and a one-line result with what to run next, as on the canvas.
2. **Given** a terminal, **When** `zekno deploy` fails to start the app, **Then** the failed stage, what Docker reported and what to do next are shown.
3. **Given** output is piped, or `--json` is passed, **When** any command runs, **Then** it prints plain lines or one JSON object, with no colour, symbols or panels.
4. **Given** no terminal, **When** a command lacks a detail it needs, **Then** it fails naming the flag or the project file, and asks nothing.
5. **Given** no terminal, **When** `zekno` is run with no arguments, **Then** it prints the help and does not open the app.
6. **Given** any single command that talks to a server, **Then** it opens one connection to that server.

---

### Edge Cases

- The terminal is smaller than the app needs: the app shows one message asking for a larger window and resumes when there is room.
- The terminal is resized while the app is open: the layout follows it.
- Colours are switched off by the person's terminal settings: every state is still readable from its symbol and word.
- Two things happen at once, such as a deploy finishing while another screen is open: the result is shown where the developer is, and the history is correct when they return.
- The developer presses Ctrl-C: outside a prompt it behaves as quit, including waiting for a deploy in progress; inside the hidden prompt it cancels the prompt only.
- The server cannot download the runner, has an unsupported processor, or the downloaded file does not match the expected value: "add a server" stops, says which, and leaves nothing installed.
- The server has no Docker, or Docker without Compose: "add a server" stops before setup and says what is missing.
- The SSH connection asks for a password or to confirm a host key: the app steps aside so the question can be answered, then continues.
- A server's runner is older than this CLI needs: actions that need the newer runner are unavailable and the app offers the update; deploys keep working.
- `zekno.json` is malformed, or points at a Compose file that is missing: the command says so and does nothing else.
- The Compose file expects a value that is deliberately left to its default: the warning can be dismissed and is not repeated for that deploy.
- Logs produce more lines than can be kept: the oldest are dropped from the view; nothing is written to disk.
- A log line or a name coming from the server contains terminal control sequences: they are shown as plain text or removed, never acted on.
- The keychain refuses access while the app is open: the action that needed the key fails with that reason and the app stays usable.

## Requirements *(mandatory)*

### Functional Requirements

**The app**

- **FR-001**: Running `zekno` with no arguments at a terminal MUST open a full-screen app. When there is no terminal it MUST print the help instead.
- **FR-002**: The app MUST provide the screens on the canvas with their layout, wording, symbols and keys: Home, one app, a deploy in progress, live logs, first run, add a server, set a secret.
- **FR-003**: Every action in the app MUST be reachable from the keyboard, and the keys available on a screen MUST be shown on that screen. A help key MUST list them all.
- **FR-004**: The header of every app screen and the first-run screen MUST show the pixel wordmark "zekno.app": "zekno" in white and ".app" in the brand blue, solid blocks, three lines tall. On a terminal with a light background "zekno" takes the terminal's own text colour so that it stays visible; that variant is on the canvas as a proposal and needs the maintainer's approval.
- **FR-005**: The app MUST show that Zekno is pre-alpha and unaudited.
- **FR-006**: The app MUST leave the terminal as it found it when it closes, including after a failure.
- **FR-007**: The app MUST remain usable at 80 columns by 24 lines. Below that it MUST ask for a larger window instead of drawing a broken layout.
- **FR-008**: No state in the app may be shown by colour alone.

**First run and servers**

- **FR-009**: With no team on the machine, the app MUST lead the developer through creating the key, adding a server and a first deploy, showing the three steps and which one is current.
- **FR-010**: "Add a server" MUST need only an SSH destination and a name, and MUST show each step as it completes: connected, Docker with Compose found, runner installed and verified, runner set up, server added to the signed team list.
- **FR-011**: When the server has no runner, "add a server" MUST install one without the developer logging in to the server. The server fetches a published release, and the release MUST match a value the CLI already holds before it is installed. A value supplied by the place the release is fetched from does not count.
- **FR-012**: When the runner on a server is older than the CLI needs, the app MUST say so and offer to update it by the same verified route. It MUST NOT update a runner without being asked.
- **FR-013**: The team code and the server code MUST each be shown with a sentence saying what it identifies and who would compare it.
- **FR-014**: "Add a server" MUST stop, say why, and leave the server unchanged when Docker with Compose is missing, the processor is unsupported, the release cannot be fetched or does not match, or the runner belongs to another team.

**Deploying and rolling back**

- **FR-015**: A deploy, in the app or as a single command at a terminal, MUST show a summary panel (deploy number, app, server, file, secrets, and in the app what it replaces), a row of stages (Checked, Signed, Sent, Starting then Started) and one line of live progress.
- **FR-016**: Docker's own output MUST NOT be shown during a successful deploy unless the developer asks for it. On a failed start, what Docker reported MUST be shown.
- **FR-017**: Leaving the deploy screen MUST NOT cancel the deploy. Quitting the app MUST wait for a deploy in progress.
- **FR-018**: The app MUST show an app's deploy history with number, result and time, and MUST let the developer roll back to a selected earlier deploy.

**State and logs**

- **FR-019**: The app and `zekno status` MUST show, for each app on a server, whether it is running or stopped, and for each server whether it can be reached.
- **FR-020**: The app MUST show an app's logs live, with time and service name, and MUST allow pausing, filtering by text and showing one service.
- **FR-021**: Logs MUST be read directly from the developer's server, MUST NOT be written to disk by the CLI, and the logs screen MUST say that they do not pass through Zekno.
- **FR-022**: Anything that comes from a server and is shown in the terminal MUST have terminal control sequences removed or made visible, so a server cannot change what the screen shows or does.

**Secrets**

- **FR-023**: The app MUST let the developer set and remove secrets, with the hidden prompt and all of its existing rules. It MUST show names and versions and MUST NOT show a value.
- **FR-024**: Before a deploy, the app MUST list the values the Compose file expects that have no secret, and MUST let the developer set each one or continue without them.
- **FR-025**: The app MUST show when a secret was set or removed after the deploy that is running, so the developer knows a deploy is needed for it to take effect.

**The project file**

- **FR-026**: A project folder MAY hold a file named `zekno.json` giving the app name, the server and the Compose file. Single commands and the app MUST read it, and flags MUST take precedence over it.
- **FR-027**: The app MUST offer to write `zekno.json` the first time a folder is deployed, and MUST NOT write or change it without the developer agreeing.
- **FR-028**: `zekno.json` MUST contain no secret value and no key, and MUST be safe to commit.
- **FR-029**: A `zekno.json` that is malformed or names something unknown MUST stop the command with a message that names the problem.

**Single commands**

- **FR-030**: Every command of the first version MUST keep working with the same flags and exit statuses.
- **FR-031**: At a terminal, single commands MUST use the same symbols, wording and panels as the app.
- **FR-032**: When output is piped, in a script, or with `--json`, commands MUST print plain lines or one JSON object, with no colour, symbols, panels or animation. That output MUST be documented, and any change from the first version MUST be listed.
- **FR-033**: A command MUST NOT ask a question when there is no terminal. A missing detail is an error that names the flag or the project file.
- **FR-034**: A single command MUST open at most one connection to a server.

**The runner**

- **FR-035**: The runner MUST report, for each app, whether its services are running, without revealing a secret value.
- **FR-036**: The runner MUST provide an app's logs as a stream that ends when the reader goes away.
- **FR-037**: The two additions MUST be read-only. The runner MUST still open no network port, act only when started, and start nothing that the team did not sign.
- **FR-038**: The runner MUST report its own version so the CLI can tell whether it is new enough.

**What stays true**

- **FR-039**: Every protection recorded in the security reviews of the core library and of the first CLI and runner MUST stay in force: the profile is verified on every run, history holds signed deploys, a secret value is never an argument and never on disk, the hidden prompt never echoes, and a deploy number is never signed twice.
- **FR-040**: The signing key MUST stay in the system keychain only.
- **FR-041**: Neither program may print, log or include in an error any secret value or private key.

**Documentation**

- **FR-042**: The public docs and both READMEs MUST describe exactly what the CLI and runner support after this feature: every command, key and file, and nothing that does not exist.
- **FR-043**: The docs MUST state the limits that apply: unaudited, one developer on one machine, SSH as the route, logs and state read directly from the server.

### Key Entities

- **Project link**: what `zekno.json` holds: an app name, a server name and a Compose file path. It ties a folder to one app on one server. It is not signed and not secret; everything it names is checked against the verified profile when used.
- **App state**: for one app on one server, whether its services are running, as last reported by the runner, and when that was asked.
- **Log line**: a time, a service name and text, as produced by the app's containers. Shown, never stored.
- **Runner release**: a version of the runner for one kind of server processor, together with the value the CLI uses to check it.
- **Deploy in progress**: a deploy that has been signed and sent, its current stage, the latest line of progress, and Docker's output held for showing on request or on failure.
- **Expected value**: a name the Compose file reads from its environment, compared with the secrets set for that app.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Starting with no Zekno profile and a server that has Docker but no runner, a developer reaches a running app with one secret in under 5 minutes, typing nothing on the server.
- **SC-002**: Adding a server asks for two things, its SSH destination and a name, and needs no other step from the developer.
- **SC-003**: In a linked project folder, a deploy takes one key press in the app or one command with no flags.
- **SC-004**: A developer can tell whether an app is running, and read why it failed to start, without logging in to the server.
- **SC-005**: A line written by a running app appears in the logs screen within 3 seconds.
- **SC-006**: A single command opens one connection to the server where the first version opened two or three, and a deploy of an unchanged app is correspondingly faster on a distant server.
- **SC-007**: Each of the nine screens on the canvas exists in the app, and the maintainer confirms each one against the canvas before the feature is called done.
- **SC-008**: Every automated security test of the first version still passes, the internal security review of this feature leaves no finding rated high or critical open, and no private key or secret value is in any file either program wrote.
- **SC-009**: A script written for the first version's commands and exit statuses still works; every difference in plain output is listed in the documentation.
- **SC-010**: Every command, key and file named in the docs exists in the programs, and the reverse.

## Assumptions

- The canvas is the design. This feature builds it and does not change it. Anything the canvas does not show, such as the help screen, the "terminal too small" message and how panes behave at 80 columns, is designed with the maintainer before it is built.
- Stack and library choices are made with the maintainer during planning: where and how runner releases are published and verified, how the app's components are built, and how a single connection is kept.
- A single command that lacks a detail at a terminal fails with a message that names the flag, the project file and the app (`zekno`) as ways to give it. Asking questions one by one was the option the maintainer did not choose.
- The developer's machine is macOS or Linux with a system keychain and a terminal that can show block characters and at least 16 colours. Windows is not tested in this feature.
- Servers are Linux on x86-64 or ARM64 with Docker and Compose, able to reach the place runner releases are published. A server that cannot is installed by hand, as documented.
- Publishing runner releases is part of this feature only as far as "add a server" needs it. Packaging the CLI itself for installation with npm or Homebrew is out of scope.
- One developer on one machine, as before. Teammates arrive with the control plane.
- Out of scope: the control plane, building from source, domains and HTTPS, templates, automatic deploys from a repository, the desktop app, and searching or keeping logs.
- Feature 003 was committed on `003-cli-runner` and merged into a new `dev` branch on 2026-11-14 at the maintainer's request; this feature's branch `004-cli-app` starts from `dev`. Further commits are made only when the maintainer asks.
- The design remains unaudited. The security review in this feature is internal.
