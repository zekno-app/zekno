# Feature Specification: Templates

**Feature Branch**: `012-templates`

**Created**: 2026-11-17

**Status**: Draft. Direction and eight decisions agreed with the maintainer on 2026-11-17 (see Clarifications). Every screen and the exact settings of each template are approved on boards before anything is built.

**Input**: User description: "Stage 2 of the road map: templates. `zekno add postgres` adds a ready-made service to an app, with the secrets it needs." Decided with the maintainer on 2026-11-17: templates ship inside the CLI, and a template adds a service to the app's settings file (`zekno.app.json`); in a folder with a hand-written Compose file zekno prints the lines to add and edits nothing. The command's name was left to the builder's recommendation: `zekno add <template>`. Which templates come first was left for planning.

## Clarifications

### Session 2026-11-17

- Q: Which templates are in the first set? → A: Databases: PostgreSQL, MySQL, MongoDB and a Redis-compatible store. The maintainer asked whether starters for frameworks (Next.js, React with Vite, Bun) can be added too: see "Starters" under Assumptions; that question is open.
- Q: What does `zekno add` do when there is no server yet? → A: It says to run `zekno deploy` first and changes nothing.
- Q: Is there a command to remove a template's service? → A: Not in this version. The developer edits the settings file. The data volume is never deleted.
- Q: Can people outside the project contribute templates? → A: Yes, by pull request to the public repository: one data file per template, a guide for contributors, an automatic test of every template, and a page of the docs site built from the same files that credits each author. A maintainer reviews each one, and it ships with a CLI release.
- Q: Can a template ask the developer something, such as a domain? → A: The format keeps a place for questions now. They are built with domains (stage 3). Until then a template that has one is refused with a clear sentence.
- Q: Can one template hold several services? → A: The format allows it. Each template of the first set has one.
- Q: Can the same template be added twice to one app? → A: No, one of each per app in this version, because a secret's name is shared by the whole app.
- Q: Do tests run on GitHub for each pull request? → A: Yes, with no access to any secret of the repository.

## Why

An app almost always needs something beside itself: a database, a cache. On a managed platform that is one click. With Zekno today the developer writes the service by hand, invents a password, sets it as a secret, and builds the connection string their app reads. Each step is small and each is a place to get it wrong: a weak password, a password pasted into a file, a database published to the internet by mistake.

App settings (feature 010) made an app a list of services in a file. A template is a service someone already wrote well. Adding one should be a single command that leaves the app's settings, and the secrets it needs, exactly as a careful person would have made them.

A template is code that runs on the developer's server. So where templates come from matters as much as what they do. The maintainer chose the smallest trust: templates are part of the CLI itself, reviewed and released with it. Nothing is downloaded when the command runs.

Anyone can write one. On a managed platform an unreviewed template runs on the platform's machines; here it would run on the user's own server, next to a database password. So what is open is who may write a template, not what runs without anyone looking: a template is a small data file in the public repository, proposed by pull request, checked by an automatic test and read by a maintainer before it ships.

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

### User Story 5 - Contribute a template (Priority: P2)

Someone outside the project wants Zekno to offer a database they use. They copy an existing template file, change its values, run the template tests on their machine and open a pull request. The tests run again on GitHub. A maintainer reads the file and merges it. With the next release, `zekno add` lists it with the author's name, and the docs site shows it.

**Why this priority**: the catalogue grows only if adding to it is easy for a contributor and cheap to review for a maintainer; and the format must be right from the first release, because changing it later breaks every contribution.

**Independent Test**: a new template file that follows the guide passes the template tests with no other file changed, and appears in the list, in what `zekno add` shows, and on the docs page; a file that breaks a rule (an image with no digest, a published port, an unknown field, an image from a publisher that is not allowed) fails the tests with a sentence that names the rule and the place.

**Acceptance Scenarios**:

1. **Given** the guide and an existing template, **When** a contributor adds one file, **Then** the template is listed, shown, added and documented with no other change to the code.
2. **Given** a template file that breaks a rule, **When** the tests run, **Then** they fail and name the rule and the place in the file.
3. **Given** a pull request from a fork, **When** it is opened, **Then** the tests run on GitHub without access to any secret of the repository, and their result shows on the pull request.
4. **Given** a merged template, **When** the next CLI is released, **Then** the list and the docs page show its name, what it is, the software's version and its author.

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
- The developer adds a template the app already has: refused in this version, with one sentence that says why (one of each per app).
- A template file that has a question (`asks`): this version refuses it and says questions arrive with domains.
- A template whose software cannot take its password from a variable (the official Redis image takes it only on the command line): it cannot be a template, because a start command is plain text in the settings file. A compatible image that can (Valkey) is used instead, and the list says what it is compatible with.
- A pull request that changes a workflow file as well as a template.
- A template is taken out of a later version of the CLI while an app still uses its service: the app keeps working, because the service is ordinary settings.
- The database's data when the service is removed from the settings, or renamed: the volume is not deleted, and a renamed service starts with an empty one.

## Requirements *(mandatory)*

### Functional Requirements

**Where templates come from**

- **FR-001**: Templates MUST be part of the CLI itself, each one a file in the public repository that enters by a reviewed pull request. Adding one MUST NOT contact the network or read a template from the project folder, the profile folder or anywhere a person other than the CLI's publisher could have written.
- **FR-002**: Each template's image MUST be named by version, pinned by its digest, and published by the software's own publisher, from a list of allowed publishers kept in the repository.
- **FR-003**: A template MUST be expressible entirely as app settings of feature 010: it adds nothing the settings file could not say, and it is checked by the same rules before it is written.
- **FR-003a**: A template MUST be one data file, read strictly: known fields only, within size limits, and never code. The only things it can compute are a secret made at random and a secret built by placing made secrets and the service's name into a fixed text.
- **FR-003b**: The format MUST allow a template to hold several services, and MUST keep a place for questions to the developer. A template that asks a question is refused by this version with one sentence.
- **FR-003c**: The first set MUST be PostgreSQL, MySQL, MongoDB and one Redis-compatible store.

**Adding one**

- **FR-004**: `zekno add <template>` MUST add the template's service to the settings file a deploy of this folder would use, found by the same rule `zekno settings` uses.
- **FR-005**: Before anything is written or made, the developer MUST be shown the service to be added, the names of the secrets to be made, and which services will read which secret. At a terminal they are asked once; with no terminal the command goes ahead only when told to.
- **FR-006**: Each secret a template needs that is a password or a key MUST be made on the developer's machine from the system's random source, sealed for the server at once, and never printed, logged, written to the settings file, placed in an argument or kept in memory longer than needed.
- **FR-007**: A connection secret built from a password (for example a database address) MUST be built on the developer's machine and stored as a secret, and MUST be given to the services the developer chose.
- **FR-008**: Adding MUST be all or nothing: the service in the file and every secret, or none of them.
- **FR-009**: Adding MUST NOT replace a service, a variable or a secret that exists. A clash of service names stops the command with one sentence, and the developer can give another service name. A template the app already has MUST be refused: one of each per app in this version.
- **FR-010**: Adding MUST NOT deploy and MUST NOT contact the server. What was added runs after the next deploy, and the command says so.
- **FR-011**: A database or cache added from a template MUST keep its data in a named volume and MUST NOT be published outside the server by default.
- **FR-012**: The command needs an app and a server to store secrets for. It finds them as `zekno secret set` does (flags, the folder's link, a question at a terminal). With no team or no server yet, it MUST say to run `zekno deploy` first and change nothing.

**Looking first**

- **FR-013**: The developer MUST be able to list the templates, and to see what one would add, without a team, a server, a settings file or any change.
- **FR-014**: `zekno add` with no template at a terminal MUST offer the list to pick from.

**A hand-written Compose file**

- **FR-015**: When the folder's deploy uses a hand-written Compose file, the command MUST NOT edit it. It prints the lines to add and what to do, and makes and stores the secrets only when the developer agrees.

**Honesty**

- **FR-016**: What is shown before adding, and the docs, MUST say that Zekno does not back up the data, where the data is kept, and that the image's version changes only with a new version of the CLI.
- **FR-017**: Every place the product says it is pre-alpha and unaudited MUST still say so.

**Contributing**

- **FR-022**: Adding a template to the catalogue MUST need one new file and no change to other code: the list, what is shown before adding, the docs page and the tests all read the same files.
- **FR-023**: An automatic test MUST check every template: the file's form, the settings rules, the image's digest and publisher, no published port, data in a named volume; and, where Docker is present, that the service starts and a client connects with the secrets that were made.
- **FR-024**: The template tests MUST run on GitHub for every pull request, with no access to any secret of the repository, including for a pull request from a fork.
- **FR-025**: A guide for contributors MUST state the rules a template has to meet and what the reviewer checks by hand.
- **FR-026**: The docs site MUST have a page that lists the templates, built from the template files, with each one's author.

**What stays as it is**

- **FR-018**: No message format, no part of the core library and no part of the runner MUST change. No runner release MUST be needed.
- **FR-019**: With no terminal, every command that exists today MUST behave exactly as before.
- **FR-020**: The Compose text of an app that uses a template MUST be produced by the same function as for any settings, and MUST be what `zekno settings compose` prints.

**Decided with the maintainer before building**

- **FR-021**: The exact settings of each template, the template file's format, and the look and wording of every new screen and line MUST be shown to the maintainer with a recommendation, and approved, before anything is built.

### Key Entities

- **Template**: a named, reviewed data file inside the CLI that describes one or more services: each image and version, its settings, the secrets it needs and how each is made, the connection secret it offers to other services, and its author.
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

- **SC-009**: Adding a new template to the catalogue changes exactly one file, and the list, the docs page and the tests pick it up.
- **SC-010**: Each rule a template has to meet has a test with a file that breaks it, and that test names the rule and the place.

## Assumptions

- The app is described by a settings file, or the developer accepts printed lines for a hand-written Compose file.
- Each template of the first set adds one service. The format allows several.
- The services of one app reach each other by name, as they do today. A template as an app of its own waits for the stage that brings a network apps share (domains and the proxy).
- A setting cannot build one value out of another, so a connection secret is built on the developer's machine and stored whole. When a made password is replaced later, the connection secret has to be made again; this version says so and does not do it for the developer.
- Removing a template's service is done by editing the settings file. A command for it is out of this version. Its volume is never deleted by Zekno.
- Backups, replicas, moving to a newer major version of a database, and templates read from a catalogue, an address or the developer's own folder are out of this version. A template reaches users only through the repository and a release.
- **Starters** (open, asked by the maintainer on 2026-11-17): a starter for a framework, such as Next.js, React with Vite or Bun, is source code that has to be built into an image, and this version of Zekno runs only images that already exist in a registry. Starters are therefore not in this feature; the recommendation is to bring them with building from source, as settings for an app the framework's own tool created, not as code Zekno keeps.
- Paying authors, and templates that are not reviewed, are out of this version.
- The tests on GitHub are one workflow that reads the repository and nothing else. Making it a required check for a pull request is a setting of the repository and the maintainer's step.
