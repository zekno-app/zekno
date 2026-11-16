# Feature Specification: Templates

**Feature Branch**: `012-templates`

**Created**: 2026-11-17

**Status**: Draft. Direction agreed with the maintainer on 2026-11-17; the first set of templates and every screen are decided in the design, before anything is built.

**Input**: User description: "Stage 2 of the road map: templates. `zekno add postgres` adds a ready-made service to an app, with the secrets it needs." Decided with the maintainer on 2026-11-17: templates ship inside the CLI, and a template adds a service to the app's settings file (`zekno.app.json`); in a folder with a hand-written Compose file zekno prints the lines to add and edits nothing. The command's name was left to the builder's recommendation: `zekno add <template>`. Which templates come first was left for planning.

## Why

An app almost always needs something beside itself: a database, a cache. On a managed platform that is one click. With Zekno today the developer writes the service by hand, invents a password, sets it as a secret, and builds the connection string their app reads. Each step is small and each is a place to get it wrong: a weak password, a password pasted into a file, a database published to the internet by mistake.

App settings (feature 010) made an app a list of services in a file. A template is a service someone already wrote well. Adding one should be a single command that leaves the app's settings, and the secrets it needs, exactly as a careful person would have made them.

A template is code that runs on the developer's server. So where templates come from matters as much as what they do. The maintainer chose the smallest trust: templates are part of the CLI itself, reviewed and released with it. Nothing is downloaded when the command runs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a database to an app (Priority: P1)

A developer has an app described by its settings and wants a Postgres database for it. They run `zekno add postgres`. They are shown what will be added. They say yes. Their settings file has a new service, the passwords exist as secrets that were never shown, and their app's service is given the connection string as a secret. They run `zekno deploy` and the app reaches its database by name.

**Why this priority**: it is the feature.

**Independent Test**: in a folder with a settings file that describes one service, linked to an app on a server, run `zekno add postgres` and answer yes; the file has the new service and nothing else changed in it; the secrets exist sealed and their values appear nowhere; `zekno deploy` starts both services and the first reaches the second by its name.

**Acceptance Scenarios**:

1. **Given** an app with settings, a team and a server, **When** the developer runs `zekno add postgres` at a terminal, **Then** they are shown the service that will be added, the secrets that will be made and which of their services will read the connection secret, and asked once.
2. **Given** a yes, **When** the command finishes, **Then** the settings file holds the new service exactly as shown, every secret is stored sealed for the server, and nothing was deployed.
3. **Given** the same app, **When** the developer runs `zekno deploy`, **Then** the database starts with the app, keeps its data in a named volume, is not published outside the server, and the app's service reaches it by the service's name.
4. **Given** a no, Esc or Ctrl-C, **When** the command ends, **Then** the file is unchanged and no secret was made.
5. **Given** a failure part way (the file cannot be written, the secrets cannot be stored), **When** the command ends, **Then** either everything was done or nothing was: no service without its secrets, and no secret without its service.
6. **Given** a service with the template's name already in the app, **When** the developer adds the template, **Then** nothing is overwritten: they are told, and can give the new service another name.
7. **Given** an app with several services, **When** a template is added, **Then** the developer chooses which of them read the connection secret; with one other service it is that one, and the command says so.

---

### User Story 2 - See what exists before adding it (Priority: P2)

A developer wants to know which templates there are and what one would add, before changing anything.

**Why this priority**: a person should be able to look before they change their app, and it is how the feature is discovered.

**Independent Test**: `zekno add` with no template at a terminal lists the templates and adds the one picked; a flag prints the list and exits; another shows exactly what one template would add, without a team, a server or a settings file.

**Acceptance Scenarios**:

1. **Given** a terminal, **When** the developer runs `zekno add` with no template, **Then** they pick one from a list that says in a few words what each is.
2. **Given** any folder, **When** the developer asks for the list, **Then** each template is printed with its name, what it is and the version of the software it runs; piped, the lines are plain and stable.
3. **Given** a template's name, **When** the developer asks what it would add, **Then** they see the service's settings, the names of the secrets it makes and what each is for, where its data is kept, and what it does not do (backups), and nothing is changed.

---

### User Story 3 - A project with a hand-written Compose file (Priority: P3)

A developer deploys from a Compose file they wrote. They run `zekno add postgres`. Zekno does not edit their file. It prints the lines to add and the secrets to set, and can make and store the secrets for them.

**Why this priority**: those projects exist and must not be left with nothing, but editing someone's Compose file is not something to do by guesswork.

**Independent Test**: in a folder whose deploy uses `compose.yaml`, `zekno add postgres` prints a service block and the secret names, changes no file, and says what to do next.

**Acceptance Scenarios**:

1. **Given** a folder whose deploy uses a hand-written Compose file, **When** the developer adds a template, **Then** the Compose lines for the service are printed, the file is not changed, and one sentence says where to put them.
2. **Given** the same folder at a terminal, **When** the developer agrees, **Then** the secrets are made and stored as for a settings app, and their names are printed; with a no, nothing is made.

---

### User Story 4 - From scripts (Priority: P3)

A script adds a template with no terminal.

**Why this priority**: every other command of Zekno works in a script, and a set-up script is where this one would be used.

**Independent Test**: piped, `zekno add postgres` with the flag that goes ahead and the app and server given writes the file and stores the secrets with no question; without that flag it stops and changes nothing.

**Acceptance Scenarios**:

1. **Given** no terminal, **When** the command is run without saying to go ahead, **Then** it stops, names how, and changes nothing.
2. **Given** no terminal and the go-ahead, **When** everything it needs is given by flags or by the folder's link, **Then** it writes the file, stores the secrets and prints plain lines; anything missing stops it with the sentence the other commands use.

---

### Edge Cases

- No team or no server on this machine yet: secrets cannot be sealed for a server that does not exist. The command says what to do first and changes nothing.
- The folder has no settings file and no Compose file.
- The folder's link names another file than the settings file here, or is not in use on this machine yet: the same rule as `zekno settings` (feature 010).
- A secret with the same name already exists for the app, from an earlier try or set by hand: it is never replaced without the person saying so.
- The app's service already has a variable with the connection secret's name.
- The settings file would grow past its limits (services, secret names, size) with the new service.
- The settings file changed while the question was open.
- A template's image no longer exists in its registry, or the server cannot pull it: that is seen at the deploy, and the sentence must say which image.
- The developer adds the same template twice under two names (two databases).
- A template is taken out of a later version of the CLI while an app still uses its service: the app keeps working, because the service is ordinary settings.
- The database's data when the service is removed from the settings, or renamed: the volume is not deleted, and a renamed service starts with an empty one.

## Requirements *(mandatory)*

### Functional Requirements

**Where templates come from**

- **FR-001**: Templates MUST be part of the CLI itself. Adding one MUST NOT contact the network or read a template from the project folder, the profile folder or anywhere a person other than the CLI's publisher could have written.
- **FR-002**: Each template's image MUST be named by version and pinned by its digest.
- **FR-003**: A template MUST be expressible entirely as app settings of feature 010: it adds nothing the settings file could not say, and it is checked by the same rules before it is written.

**Adding one**

- **FR-004**: `zekno add <template>` MUST add the template's service to the settings file a deploy of this folder would use, found by the same rule `zekno settings` uses.
- **FR-005**: Before anything is written or made, the developer MUST be shown the service to be added, the names of the secrets to be made, and which services will read which secret. At a terminal they are asked once; with no terminal the command goes ahead only when told to.
- **FR-006**: Each secret a template needs that is a password or a key MUST be made on the developer's machine from the system's random source, sealed for the server at once, and never printed, logged, written to the settings file, placed in an argument or kept in memory longer than needed.
- **FR-007**: A connection secret built from a password (for example a database address) MUST be built on the developer's machine and stored as a secret, and MUST be given to the services the developer chose.
- **FR-008**: Adding MUST be all or nothing: the service in the file and every secret, or none of them.
- **FR-009**: Adding MUST NOT replace a service, a variable or a secret that exists. A clash stops the command with one sentence, and the developer can give another service name.
- **FR-010**: Adding MUST NOT deploy and MUST NOT contact the server. What was added runs after the next deploy, and the command says so.
- **FR-011**: A database or cache added from a template MUST keep its data in a named volume and MUST NOT be published outside the server by default.
- **FR-012**: The command needs an app and a server to store secrets for. It finds them as `zekno secret set` does (flags, the folder's link, a question at a terminal). With no team or no server yet, it MUST say what to do first and change nothing.

**Looking first**

- **FR-013**: The developer MUST be able to list the templates, and to see what one would add, without a team, a server, a settings file or any change.
- **FR-014**: `zekno add` with no template at a terminal MUST offer the list to pick from.

**A hand-written Compose file**

- **FR-015**: When the folder's deploy uses a hand-written Compose file, the command MUST NOT edit it. It prints the lines to add and what to do, and makes and stores the secrets only when the developer agrees.

**Honesty**

- **FR-016**: What is shown before adding, and the docs, MUST say that Zekno does not back up the data, where the data is kept, and that the image's version changes only with a new version of the CLI.
- **FR-017**: Every place the product says it is pre-alpha and unaudited MUST still say so.

**What stays as it is**

- **FR-018**: No message format, no part of the core library and no part of the runner MUST change. No runner release MUST be needed.
- **FR-019**: With no terminal, every command that exists today MUST behave exactly as before.
- **FR-020**: The Compose text of an app that uses a template MUST be produced by the same function as for any settings, and MUST be what `zekno settings compose` prints.

**Decided with the maintainer before building**

- **FR-021**: Which templates are in the first set, the exact settings of each, and the look and wording of every new screen and line MUST be shown to the maintainer with a recommendation, and approved, before anything is built.

### Key Entities

- **Template**: a named, reviewed description inside the CLI of one service: its image and version, its settings, the secrets it needs and how each is made, and the connection secret it offers to other services.
- **Made secret**: a password or key created at random on the developer's machine when a template is added. Stored sealed. Never shown.
- **Connection secret**: a secret built from made secrets and fixed parts, such as a database address, that the app's own services read.
- **Addition**: what one run of the command would do: the service, the secrets, and which services read what. Shown before it happens, and done whole or not at all.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer with a deployed settings app adds a database and deploys, with their app reaching it, in under 2 minutes and without opening a file or inventing a password.
- **SC-002**: Across every test of this feature, no made secret's value appears in any printed line, drawn screen, error, argument, log or file other than its sealed record.
- **SC-003**: For every template, the settings it adds pass the settings file's own checks, and the Compose text printed for the app equals the text its deploy signs, byte for byte.
- **SC-004**: Every failure injected between the first and the last step of adding leaves the settings file and the secret store exactly as they were.
- **SC-005**: Adding a template makes no network request and contacts no server, in every test.
- **SC-006**: With no terminal, every command that existed before this feature prints, writes, connects and exits exactly as before.
- **SC-007**: The diff of this feature touches no message format, no file of the core library and no file of the runner.
- **SC-008**: Each template of the first set is started once with real Docker from the settings it adds, and a client inside the app's network connects with the connection secret.

## Assumptions

- The app is described by a settings file, or the developer accepts printed lines for a hand-written Compose file.
- One template adds one service. A template that needs two services is out of this version.
- The services of one app reach each other by name, as they do today. A template as an app of its own waits for the stage that brings a network apps share (domains and the proxy).
- A setting cannot build one value out of another, so a connection secret is built on the developer's machine and stored whole. When a made password is replaced later, the connection secret has to be made again; this version says so and does not do it for the developer.
- Removing a template's service is done by editing the settings file. A command for it is out of this version. Its volume is never deleted by Zekno.
- Backups, replicas, moving to a newer major version of a database, templates from a catalogue or an address, and templates a user writes are out of this version.
- The first set is small. Which templates are in it is decided in the design (FR-021).
