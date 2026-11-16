# Feature Specification: App settings

**Feature Branch**: `010-app-settings`

**Created**: 2026-11-16

**Status**: Design approved 2026-11-16; ready for planning

**Input**: User description: "App settings, the way people coming from Railway know them. An app gets settings in the sections such a person expects. The settings live in a file in the project, and the developer's machine turns them into the Compose text and signs that. A hand-written Compose file stays possible." Agreed in direction by the maintainer on 2026-11-16 ("Yes agree"). The full description is in the first commit of this folder.

## Why

Today an app is deployed from a Compose file the developer writes by hand. Nothing else describes it. A person who has used a managed platform thinks of an app as a few settings: where it comes from, how it starts, its health check, its domains, its variables, its volumes. They have often never written a Compose file.

Zekno can give them those settings without giving up its promise, because of where the settings live and who acts on them. They live in a file in the project, beside the code, not on a hosted service. The developer's own machine turns them into the Compose text and signs it. The server keeps understanding only what it understands today. A settings page on a hosted service could never change what runs, because it signs nothing.

Most of the bigger features planned next (building from source, domains with HTTPS, deploys from CI) are these settings seen from the user's side. This feature builds the part that today's server can already run, and fixes the shape of the rest so it does not change when they ship.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deploy an app from its settings (Priority: P1)

A developer has an image of their app in a registry and has never written a Compose file. They describe the app in a settings file in their project: what it runs, how it starts, its port, the secrets it reads, a volume for its data. They run `zekno deploy` and the app runs on their server.

**Why this priority**: it is the feature. Everything else here looks at, changes or explains the same file.

**Independent Test**: in a folder with a settings file and no Compose file, run `zekno deploy` against a server; the app runs as the settings say, and the deploy is checked, signed and recorded exactly as a deploy from a Compose file is.

**Acceptance Scenarios**:

1. **Given** a folder with a settings file that describes one service and no Compose file, **When** the developer runs `zekno deploy`, **Then** the app is deployed with that service's image, start command, port, restart rule, limits, volume, secrets and plain variables, and the deploy ends as a deploy does today.
2. **Given** a settings file with two services, **When** it is deployed, **Then** both run as one app and each can reach the other by its name.
3. **Given** a settings file that names a secret which has no value yet, **When** the developer deploys at a terminal, **Then** they are asked for it as today's deploy asks for a missing value, and with no terminal the deploy stops with today's sentence.
4. **Given** a folder with a settings file and a Compose file, **When** the developer deploys without saying which, **Then** nothing is deployed until it is clear which one is meant: the rule is stated in one sentence, and neither file is ever picked silently over the other.
5. **Given** a settings file that asks for something this version cannot do (for example building from source, or a domain), **When** the developer deploys, **Then** nothing is deployed and one sentence names the setting and says it is not available yet.
6. **Given** a settings file that is not in the right form (an unknown field, a wrong type, too large, a name outside its rule), **When** any command reads it, **Then** nothing is deployed or written, and one sentence names where the fault is without repeating the file's content.
7. **Given** a deploy made from settings, **When** the developer rolls back, looks at status or reads logs, **Then** each works as it does for any other deploy.

---

### User Story 2 - See an app's settings (Priority: P2)

A developer wants to see how an app is set up without reading a file format. They run `zekno settings`, or open the app in the full-screen app and go to its settings. They see the same sections a managed platform shows: Source, Deploy, Networking, Variables, Volumes.

**Why this priority**: it is what makes the file feel like settings and not like one more config format. It also shows a newcomer what can be set.

**Independent Test**: with a settings file in the folder, `zekno settings` prints every setting under its section; the settings screen of the full-screen app shows the same values; with a pipe the output is plain and stable, and `--json` gives the data.

**Acceptance Scenarios**:

1. **Given** a folder with a settings file, **When** the developer runs `zekno settings`, **Then** each service is shown with its settings grouped in sections, in a fixed order, and a secret is shown by name only.
2. **Given** the full-screen app with an app selected whose folder has a settings file, **When** the developer opens its settings, **Then** the same sections and values are shown, and the keys that work there are listed as on every screen.
3. **Given** a folder with no settings file, **When** the developer runs `zekno settings`, **Then** one sentence says there is none and how to start one.
4. **Given** a folder whose app is deployed from a hand-written Compose file, **When** the developer looks at its settings, **Then** they are told the app is described by a Compose file, and nothing is invented from it.
5. **Given** output that is piped or `--json`, **When** `zekno settings` runs, **Then** it prints plain lines or one JSON object, asks nothing, and never prints a secret's value.

---

### User Story 3 - Change a setting without opening the file (Priority: P3)

A developer wants to raise a memory limit or change the start command. They change it from the settings screen, or with one command. They see the change before it is written. Nothing is deployed until they deploy.

**Why this priority**: it is what a settings page is for. It comes after seeing them, and the file can always be edited by hand.

**Independent Test**: change one setting by command and one from the screen; the file holds exactly the new value and is otherwise unchanged; nothing was sent to any server; the next `zekno deploy` deploys the new value.

**Acceptance Scenarios**:

1. **Given** a settings file, **When** the developer changes one setting by command at a terminal, **Then** they are shown the old and the new value and asked once; on yes the file is rewritten with that one change, and on no nothing changes.
2. **Given** the settings screen, **When** the developer edits a value and confirms, **Then** the file is rewritten with that one change and the screen shows the new value.
3. **Given** a new value that is not allowed (a port out of range, a limit that is not a size), **When** it is entered, **Then** it is refused with one sentence and the file is not touched.
4. **Given** no terminal, **When** a setting is changed by command, **Then** it is written only when the command says to go ahead without asking, and otherwise stops naming how.
5. **Given** a change that has been written, **When** the developer looks at the app, **Then** it is clear the running app does not have the change yet, until the next deploy.
6. **Given** a settings file changed by something else between being read and being rewritten, **When** the developer confirms a change, **Then** the other change is not lost: the write is refused and they are told to try again.

---

### User Story 4 - Know exactly what will run (Priority: P3)

A developer, or someone reviewing a pull request that changes the settings, wants to see what the settings turn into. They ask for the Compose text. It is the text the deploy signs, byte for byte.

**Why this priority**: the settings are a friendlier face on something precise. Being able to see the precise thing is what makes the friendlier face trustworthy, and it is the escape hatch to a hand-written Compose file.

**Independent Test**: ask for the Compose text of a settings file, then deploy the same file; the text printed equals the text in the signed deploy.

**Acceptance Scenarios**:

1. **Given** a settings file, **When** the developer asks for what it turns into, **Then** the Compose text is printed, and it holds no secret value.
2. **Given** the same settings file read twice, on two machines, **When** each asks for the Compose text, **Then** both get the same bytes.
3. **Given** a developer who wants more than the settings offer, **When** they save that text as their Compose file and remove the settings file, **Then** the app deploys as before from the Compose file.

---

### User Story 5 - The shape of what comes next is written down (Priority: P4)

The maintainers are about to build three features that each change what a signed deploy says. They want one design, reviewed once, for the settings those features add and for the second version of the deploy message, before any of them is built.

**Why this priority**: it is a document, not software a person uses. It is here because the format this feature ships must not change shape later, and because one design is cheaper and safer than three.

**Independent Test**: the document exists in this feature's folder, names every later setting and where it goes in the file, says what the signed deploy will carry for each, and records what an independent reader of it found.

**Acceptance Scenarios**:

1. **Given** the settings format of this feature, **When** a later feature adds building from source, domains, a health check, a pre-deploy command or deploys from CI, **Then** each has a named place in the file that this feature already reserves, and a settings file written today stays valid.
2. **Given** the design document, **When** a maintainer reads it, **Then** for each later setting it says what the developer's machine signs, what the server checks, and what a hosted service in between could and could not change.
3. **Given** this feature built, **When** its changes are listed, **Then** no message format, no part of the core library and no part of the server program changed, and no server program release is needed.

---

### Edge Cases

- The folder has a settings file, a Compose file and a link (`zekno.json`) that names a Compose file. Which one a deploy uses must follow one stated rule, and a flag always wins.
- The settings file is a link to a file elsewhere, is not a regular file, is larger than its limit, or changes while it is being read.
- The settings file comes from a repository someone else wrote. It may try to name a path outside the project, mount a folder of the server, name hundreds of services, or use a field from a later version.
- A service is renamed or removed between two deploys. The app must end up as the settings say, with nothing of the old service left running.
- A secret is named in the settings and was retired, or is named twice, or has a name Zekno keeps for itself.
- A plain variable has the same name as a secret of the same service.
- Two services ask for the same published port.
- A volume is removed from the settings. Its data on the server must not be deleted by that.
- The settings screen is open while the file is edited in an editor.
- The window is 80 columns wide, or too small, when the settings screen is open.
- The app was first deployed from a Compose file and is now deployed from settings, or the other way round.

## Requirements *(mandatory)*

### Functional Requirements

**The settings file**

- **FR-001**: A project folder MAY hold one settings file that describes one app as one or more named services.
- **FR-002**: For each service the file MUST be able to say: the image it runs, its start command, the port it listens on and whether that port is published, its restart rule, its memory and processor limits, its volumes and where each is mounted, the names of the secrets it reads, and its plain variables.
- **FR-003**: The file MUST NOT be able to hold a secret's value. A name that Zekno keeps for itself or that is not a valid secret name MUST be refused.
- **FR-004**: The file MUST be read strictly: from one open file, within a size limit and limits on counts, with every field known and of the right type. Anything else MUST stop the command with one sentence that names where the fault is and repeats none of the file's content.
- **FR-005**: The file MUST NOT be able to name a path outside the project, mount a folder of the server, run a command on the developer's machine, or include another file.
- **FR-006**: The file's format MUST already have a named place for the settings later features add (where the code comes from and how it is built, domains, a health check, a pre-deploy command). A file that uses one of them MUST be refused by this version with one sentence that names the setting and says it is not available yet.
- **FR-007**: A settings file valid in this version MUST stay valid when those later settings are added.

**Deploying from settings**

- **FR-008**: `zekno deploy` in a folder with a settings file and no Compose file MUST deploy the app the settings describe.
- **FR-009**: The developer's machine MUST turn the settings into the Compose text, and that text MUST be what is checked, signed, sent and recorded, exactly as a hand-written Compose file is today. The same settings MUST always give the same bytes.
- **FR-010**: Everything a deploy does today MUST stay as it is for a deploy from settings: the questions for a missing server or app, the question for a missing secret value, the summary, the stages, the deploy number, the history, rollback, status and logs.
- **FR-011**: When a folder has both a settings file and a Compose file, which one is used MUST follow one stated rule. A flag that names a file MUST win. With no flag and nothing else that decides it, nothing MUST be deployed: at a terminal the developer is asked which, and with no terminal the command stops naming both.
- **FR-012**: Removing a service from the settings and deploying MUST stop that service. Removing a volume from the settings MUST NOT delete its data.
- **FR-013**: The rules for a link file (`zekno.json`) that is not signed by the team, or is signed and not yet used here, MUST stay exactly as they are.

**Seeing the settings**

- **FR-014**: `zekno settings` MUST print the settings of the folder's app, each service under the sections Source, Deploy, Networking, Variables and Volumes, in a fixed order.
- **FR-015**: A secret MUST be shown by its name only, everywhere.
- **FR-016**: With output that is not a terminal, `zekno settings` MUST print plain, stable lines and ask nothing; with `--json` it MUST print one JSON object.
- **FR-017**: The full-screen app MUST have a settings screen for an app whose folder has a settings file, showing the same sections and values, reachable from that app's screen.
- **FR-018**: For a folder with no settings file, and for an app described by a Compose file, each surface MUST say so in one sentence and MUST NOT invent settings.
- **FR-019**: A setting that has been changed in the file and not yet deployed MUST be recognisable as such where settings are shown, when this machine knows what was last deployed.

**Changing a setting**

- **FR-020**: A developer MUST be able to change one setting with a single command, and from the settings screen.
- **FR-021**: Before a change is written, the old and the new value MUST be shown. At a terminal the developer is asked once. With no terminal the change is written only when the command says to go ahead without asking.
- **FR-022**: A value that is not allowed MUST be refused with one sentence, and the file MUST NOT be touched.
- **FR-023**: Writing a change MUST rewrite the file with that one change and nothing else different in what it means, and MUST never leave a half-written file.
- **FR-024**: A file that changed since it was read MUST NOT be overwritten: the write is refused.
- **FR-025**: Changing a setting MUST NOT contact any server and MUST NOT deploy.

**Knowing what will run**

- **FR-026**: A developer MUST be able to print the Compose text the settings turn into, without deploying and without a server.
- **FR-027**: That text MUST equal, byte for byte, the Compose text a deploy of the same settings signs.

**What stays as it is**

- **FR-028**: With no terminal, every command that exists today MUST behave exactly as before in a folder that has no settings file.
- **FR-029**: No message format, no part of the core library and no part of the server program MUST change. No server program release MUST be needed.
- **FR-030**: The existing screens of the full-screen app MUST NOT change, except for the way into the settings screen.
- **FR-031**: Every place the product says it is pre-alpha and unaudited MUST still say so.

**The design of what comes next**

- **FR-032**: This feature MUST include a written design of the second version of the signed deploy message, covering: how an image or the source it is built from is pinned, which domain reaches which service, a health check, a command run before the new version starts, and secrets named by version without being sent again.
- **FR-033**: For each of those, the design MUST say what the developer's machine signs, what the server checks before acting, and what a hosted service in between could and could not change.
- **FR-034**: The design MUST be read by someone who did not write it, and what they found MUST be recorded beside it. Nothing of it is built in this feature.

**Decided with the maintainer before building**

- **FR-035**: The format and the name of the settings file, and the look and wording of every new screen and line, MUST be shown to the maintainer with options and a recommendation, and approved, before anything is built.

### Key Entities

- **Settings file**: one file in the project folder that describes one app. It holds services and their settings. It holds no secret value and no signature. It is content of the project, like the Compose file.
- **Service**: one named part of an app, run from one image. It has settings in five sections.
- **Section**: Source (what runs), Deploy (start command, restart rule, limits), Networking (port, and later domains), Variables (secret names and plain variables), Volumes (named volumes and where they are mounted).
- **Compose text**: what the settings turn into on the developer's machine. It is the only thing the deploy signs and the server acts on.
- **Change**: one setting's old and new value, shown before it is written.
- **Deploy message, second version**: a design only in this feature. What a signed deploy will say once later features need more than a Compose text.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer who has an image and has never written a Compose file deploys it with a start command, a port, one secret and one volume, using only the settings file, in under 5 minutes from an empty folder.
- **SC-002**: For every settings file in the test set, the Compose text printed on request equals the text in the signed deploy, byte for byte, and is the same on a second run.
- **SC-003**: Every setting of this version can be seen with one command and on one screen, and changed without opening the file.
- **SC-004**: No secret value appears in the settings file, in any printed line, in any drawn screen or in any error, across every test of this feature.
- **SC-005**: Every malformed or hostile settings file in the test set (unknown field, wrong type, too large, too many services, a path outside the project, a host folder, a later-version field) stops the command before anything is written or sent, with a sentence that repeats none of the file's content.
- **SC-006**: With no terminal, every command that existed before this feature prints, writes, connects and exits exactly as before, in a folder with no settings file.
- **SC-007**: The diff of this feature touches no message format, no file of the core library and no file of the server program.
- **SC-008**: Each later setting (build, domains, health check, pre-deploy command, CI) has a named place in the format and a section in the design that an independent reader has read.

## Assumptions

- The person using this has an image of their app in a registry their server can pull from. Building the image is a later feature.
- One settings file describes one app. An app with several services is one file, as one Compose file is today.
- The settings file is not signed where it lies in the project, as a Compose file is not. What is signed is the Compose text it turns into, at the moment of a deploy, by the person deploying.
- Only named volumes can be set. Mounting a folder of the server stays possible only through a hand-written Compose file.
- The format and name of the file, the commands' exact names and flags, and every screen are decided in this feature's design, with the maintainer, before the plan (FR-035).
- A health check, domains, replicas, scheduled jobs and a build have no meaning in this version, and are refused with a sentence when a file asks for them.
- The settings screen is reached from an app's screen in the full-screen app. Which key opens it is part of the design.
- The second version of the deploy message is designed here and built by the features that need it.
