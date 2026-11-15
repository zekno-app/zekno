# Feature Specification: Small CLI Features

**Feature Branch**: `006-cli-small-features`

**Created**: 2026-11-15

**Status**: Draft

**Input**: User description: "Include all the small CLI features in one spec: one command from nothing (`zekno deploy` in a fresh folder creates the team, asks for the server, installs the runner, asks for missing secrets and deploys); ask when something is missing in single commands (a pick-list for the server, a question for the app) instead of stopping with a sentence; `zekno secret import .env`; and `zekno doctor`. Packaging the CLI comes later, after these and the bigger features."

**Design**: every question, list and report this feature adds is something a person sees. The maintainer approves how each looks and reads before it is built. The approved mock-ups are kept in this feature's folder, and where this document and a mock-up disagree about how something looks or reads, the mock-up is right.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deploy a project from nothing with one command (Priority: P1)

A developer has installed Zekno and has a project folder with a Compose file. They have never used Zekno: no key, no server, no link. They run `zekno deploy` at a terminal. Zekno sees what is missing and asks for it, one thing at a time: a name for their key, the server to deploy to, a name for the app. It installs the runner on the server, remembers the folder, asks for the values the Compose file expects, and deploys. The developer typed one command and answered a few questions.

**Why this priority**: today the first deploy takes five commands in the right order, or the full-screen app. A newcomer who runs the one obvious command should get there.

**Independent Test**: in an empty profile and a folder with a Compose file, run `zekno deploy` at a terminal and answer the questions. The app is running on the server at the end, and a second `zekno deploy` asks nothing.

**Acceptance Scenarios**:

1. **Given** no key on this machine and a folder with a Compose file, **When** the developer runs `zekno deploy` at a terminal, **Then** they are asked for a name, their key is created, and the command goes on.
2. **Given** a key and no server, **When** it goes on, **Then** they are asked where the server is, the runner is installed there as `zekno server add` does, and the server code is shown with what it is for.
3. **Given** a server and a folder that is not linked, **When** it goes on, **Then** they are asked for the app's name, with the folder's name offered, and whether to remember the folder.
4. **Given** the Compose file expects values that have no secret, **When** it goes on, **Then** each is asked for at the hidden prompt, and may be skipped.
5. **Given** everything is in place, **When** it goes on, **Then** the deploy runs and ends as any `zekno deploy` does.
6. **Given** the developer stops at any question, **When** they leave, **Then** what was already made (the key, the server) stays, nothing half-made is left, and running the command again continues from there.
7. **Given** no terminal (a script, a pipe), **When** `zekno deploy` lacks something, **Then** it asks nothing and stops, naming what is missing and how to give it, as today.

---

### User Story 2 - Be asked instead of being told off (Priority: P1)

A developer with two servers runs `zekno status` in a folder that is not linked. Today the command stops and tells them to add a flag. Now, at a terminal, it shows their servers and lets them pick one. The same for a missing app: it asks. In a script nothing changes.

**Why this priority**: the commands people type most stop most often for a detail Zekno already knows the choices for.

**Independent Test**: with two servers and an unlinked folder, run each command with no flags at a terminal: each asks for exactly what it lacks and then runs. Run each piped: none asks.

**Acceptance Scenarios**:

1. **Given** more than one server and none named, **When** a command that needs a server runs at a terminal, **Then** the servers are listed and the developer picks one with the keyboard.
2. **Given** exactly one server and none named, **When** such a command runs, **Then** that server is used without asking, and the command says which.
3. **Given** no app named and apps already deployed to the chosen server, **When** a command that needs an app runs at a terminal, **Then** those apps are listed to pick from; `deploy` also offers a new name.
4. **Given** the developer leaves a question, **When** they press the key for leaving, **Then** the command ends, nothing was changed, and its exit status says it did not run.
5. **Given** no terminal, **When** a detail is missing, **Then** the command stops with the sentence it has today and the same exit status.
6. **Given** a flag or a linked folder gives the detail, **When** the command runs, **Then** nothing is asked.

---

### User Story 3 - Bring a project's values in from a file (Priority: P2)

A developer moving a project to Zekno has its values in a `.env` file. They run `zekno secret import .env`. Zekno reads the names, shows what it will set (names only), asks once, and stores each value sealed, as `zekno secret set` does one at a time.

**Why this priority**: a real project has ten or twenty values. Typing each at a hidden prompt is where people give up.

**Independent Test**: import a file with new names, names that already have a secret, a name Zekno does not accept and a line that is not a value. The summary names each group, nothing is stored before the answer, and afterwards `zekno secret ls` shows the new versions and no value appears anywhere.

**Acceptance Scenarios**:

1. **Given** a file of `NAME=value` lines, **When** the developer runs the import at a terminal, **Then** they see how many values are new and how many replace an existing secret, by name, and are asked once before anything is stored.
2. **Given** they say yes, **When** it finishes, **Then** every value is stored sealed for that app and server, takes effect on the next deploy, and the result names them without showing a value.
3. **Given** a name Zekno does not accept or keeps for itself, **When** the file is read, **Then** that line is left out and named, and the rest is still offered.
4. **Given** a line the file format does not allow, **When** the file is read, **Then** nothing is stored and the line's number is named, without showing its content.
5. **Given** no terminal, **When** the import runs without saying yes in advance, **Then** it stops and names how to say yes.
6. **Given** the import finished, **When** the developer reads the result, **Then** they are reminded that the file still holds the values in plain text.

---

### User Story 4 - Find out what is wrong (Priority: P3)

Something does not work. The developer runs `zekno doctor`. It checks this machine and each server, one line per check, and for each thing that is wrong says what to do. It changes nothing.

**Why this priority**: when a deploy fails for a reason outside Zekno (SSH, Docker, an old runner, a full disk), today the developer has to work it out from an error.

**Independent Test**: break one thing at a time (no key, a server that is down, a server without Docker, an old runner, a folder whose link is not usable) and run `zekno doctor`: the broken thing is the line marked wrong, with a next step, and every other line is as before.

**Acceptance Scenarios**:

1. **Given** everything is in order, **When** `zekno doctor` runs, **Then** every check is marked good and the command ends with success.
2. **Given** one thing is wrong, **When** it runs, **Then** that check is marked wrong with one sentence on what to do, the other checks still run, and the command ends with failure.
3. **Given** a server cannot be reached, **When** it runs, **Then** the checks that need that server are marked as not run, not as wrong.
4. **Given** a script, **When** it runs with the option for machine output, **Then** the same results come as data, with no colour or symbols.
5. **Given** any state, **When** it runs, **Then** nothing on this machine or on any server is changed.

---

### Edge Cases

- `zekno deploy` from nothing in a folder with no Compose file: it says so before asking anything.
- The developer's name, the server's address or the app's name is typed wrong: the question says what is wrong and asks again.
- The server asked for in story 1 needs a password or a host key answer: SSH asks, as it does for `zekno server add`.
- Installing the runner fails half way through story 1: the key stays, no server is added, and the command says how to go on.
- A pick-list with one entry, with fifty entries, in a window too small for it.
- A key typed before a question appears must not answer it.
- An import file that is empty, very large, not text, a link, or the folder's own `zekno.json`.
- An import file with the same name twice, with quotes, with a value that spans lines, with `export` in front, with a comment after a value.
- A value in the import file that is empty.
- `zekno doctor` when there is no profile at all.
- `zekno doctor` on a server whose runner is newer than this Zekno.
- A folder with a `zekno.json` that is not signed by the team, in every story: it is never used, and the questions are asked as if it were not there, after saying why.

## Requirements *(mandatory)*

### Functional Requirements

**Asking**

- **FR-001**: At a terminal, a command that lacks a detail it needs MUST ask for it instead of stopping, for: which server, which app, and for `deploy` whatever stands between an empty machine and a first deploy.
- **FR-002**: With no terminal, with machine output asked for, or when input is piped, a command MUST never ask. It MUST stop as it does today, with the same sentence and exit status.
- **FR-003**: A question MUST offer what Zekno already knows: the connected servers, the apps deployed to the chosen server, the folder's name as an app name.
- **FR-004**: When there is exactly one possible answer for the server, it MUST be used without asking, and the command MUST say which it used.
- **FR-005**: Every question MUST be leavable with one key. Leaving MUST change nothing further and end the command with a status that says it did not run.
- **FR-006**: A typed answer MUST be checked where it is typed, and a wrong one MUST be asked again with the reason.
- **FR-007**: A key typed before a question is on screen MUST NOT answer it.
- **FR-008**: A detail given by a flag or by a usable linked folder MUST never be asked for.
- **FR-009**: A `zekno.json` that is not signed by the team or not yet used here MUST be treated in the questions exactly as the rules for it say today: never used silently.

**From nothing**

- **FR-010**: `zekno deploy` at a terminal MUST be able to go from no key, no server and no link to a running app, asking only for what is missing, in this order: the key, the server, the app and whether to remember the folder, the values the Compose file expects, then the deploy.
- **FR-011**: Each thing made on the way MUST be complete before the next question, so that leaving at any question leaves nothing half-made, and running the command again continues from what exists.
- **FR-012**: Adding the server in this flow MUST do exactly what `zekno server add` does, with the same checks and the same codes shown.
- **FR-013**: A value typed in this flow MUST go through the same hidden prompt as `zekno secret set`, and MUST be skippable.
- **FR-014**: Before the first question, the flow MUST check what it can without asking (a Compose file is there and readable) and stop with a sentence when the deploy could not work anyway.

**Importing values**

- **FR-015**: `zekno secret import <file>` MUST read names and values from a file of `NAME=value` lines and store each as `zekno secret set` would.
- **FR-016**: Before storing anything, it MUST show the names, grouped as new, replacing an existing secret, and left out with the reason, and at a terminal MUST ask once. No value is ever shown.
- **FR-017**: With no terminal it MUST store nothing unless the developer said yes in advance.
- **FR-018**: A file that cannot be read as that format MUST store nothing. The message MUST name the line by number and MUST NOT repeat the line.
- **FR-019**: Either every accepted value is stored or none is.
- **FR-020**: The result MUST say that the values take effect on the next deploy, and that the file still holds them in plain text.
- **FR-021**: A value from the file MUST never appear in an argument, a message, a log or any file Zekno writes, other than sealed.

**Checking**

- **FR-022**: `zekno doctor` MUST check this machine (the key, the profile, the folder's link and Compose file when there are any) and each connected server (reachable, Docker with Compose, the runner and how its version relates to this Zekno, room on the disk), one line per check.
- **FR-023**: Each check MUST end as good, wrong, or not run. A wrong check MUST come with one sentence on what to do. A check that depends on one that failed MUST be not run.
- **FR-024**: `zekno doctor` MUST change nothing on this machine or on any server, and MUST never ask for a password in a way that blocks a script.
- **FR-025**: It MUST end with success only when no check is wrong, and MUST offer the same results as data for scripts.
- **FR-026**: It MUST be possible to check one server only.

**Everywhere**

- **FR-027**: Everything from a server that reaches the screen in these features MUST be cleaned as elsewhere, and marked as the server's where it is the server's own words.
- **FR-028**: The plain output of every existing command, and every existing exit status, MUST stay as it is for scripts.
- **FR-029**: The full-screen app MUST keep working as it does. These features change single commands only.
- **FR-030**: The README, the docs pages and the feature map MUST describe the new behaviour and the two new commands.

### Key Entities

- **Question**: something a command asks at a terminal: what it asks, what it offers, how a typed answer is checked, and what leaving does.
- **First-deploy flow**: the ordered steps from an empty machine to a running app, each complete before the next.
- **Import file**: a text file of names and values, read once, never kept.
- **Import summary**: the names grouped as new, replacing, and left out with a reason.
- **Check**: one line of `zekno doctor`: what was looked at, its result, and what to do when it is wrong.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A newcomer with a server and a project folder reaches a running app with one command and no more than six answers, in under three minutes, without reading the docs.
- **SC-002**: Every command that today stops for a missing server or app asks instead at a terminal, and none asks anything when piped: checked for each command.
- **SC-003**: Twenty values are imported from a file with one command and one answer, and no value appears on screen or in any file but sealed.
- **SC-004**: For each of ten ways a setup can be broken, `zekno doctor` marks the right check as wrong and names a next step that fixes it.
- **SC-005**: `zekno doctor` leaves this machine and every server byte for byte as they were.
- **SC-006**: Every script that used a Zekno command before this feature behaves the same after it: same output, same exit status.
- **SC-007**: The maintainer confirms each question, list and report against its approved mock-up.

## Assumptions

- "At a terminal" means what it means for the CLI today: both input and output are a terminal and machine output was not asked for.
- The commands that ask are those that take a server or an app today: `deploy`, `rollback`, `status`, `logs`, `secret set`, `secret rm`, `secret ls`, `secret import`, `link` and `server update`. `zekno` alone still opens the full-screen app.
- When a server has no apps yet, `deploy` asks for a new name; the other commands say there is nothing to act on.
- The import replaces an existing secret by storing a new version, as `zekno secret set` does. Nothing is deleted. A name in the file that Zekno keeps for itself, or that does not fit its rule for names, is left out and named.
- The import file is whatever path the developer typed, as with `-f`: it need not be inside the project folder. It is read once and never copied.
- `zekno doctor` reaches servers the way background reads do: it never hands the terminal to SSH. A server that needs a password is reported as needing one.
- How the import file's format is read, and whether `zekno doctor` needs anything new from the runner, are decided with the maintainer during planning, not here.
- Out of scope: packaging the CLI, the bigger features (building from source, templates, domains), anything in the full-screen app, and fixing what `zekno doctor` finds.
- The product stays pre-alpha and unaudited.
