# Feature Specification: CLI and Runner, Deploying Directly

**Feature Branch**: `003-cli-runner`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "The first two programs built on the core library. A command-line tool on the developer's machine and a runner on the developer's own server, which together perform a real deploy with no Zekno service involved: create a key and a team, connect a server, set secrets, deploy a Docker Compose app, roll back. The command-line tool reaches the runner over SSH. This is the first real use of the core library and the 'Zekno is down' route the website already promises."

## Clarifications

### Session 2026-11-13

- Q: How does the command-line tool reach the runner without a control plane? → A: Over SSH, which the developer already has to their own server. The runner opens no network port. Proposed to the maintainer on 2026-11-13, who then asked for this feature to start.
- Q: Is this for one person or a team? → A: One person on one machine. Sharing a team between several machines needs something to carry team lists and secrets between them, which is the control plane's job and comes later. The team list, roles and signatures are still used exactly as the core defines them, so nothing here has to be redone.
- Q: Where is the developer's signing key kept? → A: In the operating system's keychain, never in a file, as design rule 2 requires.
- Q: Where is the server's key kept? → A: In a file only the runner's user can read, on the server. It never leaves the server.
- Q: How do secrets reach the containers? → A: Through the environment of the process that starts them. The runner does not write decrypted secrets to disk.
- Q: With no control plane, where do secret records, removals and deploy history live? → A: On the developer's machine. They are already encrypted or signed, so they need no extra protection, and they move to the control plane later unchanged.
- Q: Over SSH there is no hostile relay, so is comparing codes still needed? → A: The codes are still shown, and the server still pins the team by its code, so the flow is the same one people will use later. In this direct mode SSH's own host verification is what the developer relies on, and the documentation says so.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First deploy to my own server (Priority: P1)

A developer installs the command-line tool, creates their key and team, connects a server they rent, sets a secret, and deploys a Docker Compose app. The app starts on the server with the secret available to it. Nothing passed through any Zekno service.

**Why this priority**: it is the product working end to end for the first time, and the smallest thing a first user could actually use.

**Independent Test**: on a machine with Docker, connect a local runner, set a secret, deploy a one-service app that prints the secret, and see the container running with the right value.

**Acceptance Scenarios**:

1. **Given** a new machine, **When** the developer starts a team, **Then** a signing key is created in the operating system's keychain, the team's code is shown, and no key material is written to any file.
2. **Given** a server reachable over SSH with the runner installed, **When** the developer connects it, **Then** the server creates its own key, pins the team by its code, shows its own code, and is added to the team list.
3. **Given** a connected server, **When** the developer sets a secret, **Then** the value is asked for without being echoed or stored in shell history, and only its encrypted, signed record is kept.
4. **Given** a secret and a Compose file, **When** the developer deploys, **Then** the runner verifies the deploy, starts the app with the secret in its environment, and reports that it was accepted.
5. **Given** a successful deploy, **When** the developer asks for status, **Then** they see which deploy number each app is on and which version of each secret the server holds.

---

### User Story 2 - The runner refuses what my team did not sign (Priority: P2)

Someone with SSH access to the server, but without the developer's signing key, tries to make the runner run their own deploy, replay an old one, or use tampered secrets. The runner refuses each attempt with a clear reason and changes nothing.

**Why this priority**: SSH access must not be enough to run code through the runner; otherwise the runner adds nothing over SSH itself. It depends on the first story's machinery.

**Independent Test**: feed the runner a forged deploy, a replayed deploy and a deploy with exchanged secrets, and confirm each is refused, nothing is started, and its stored state is unchanged.

**Acceptance Scenarios**:

1. **Given** a deploy signed by a key that is not in the team list, **When** it is given to the runner, **Then** it is refused and no container is started.
2. **Given** a deploy the runner already accepted, **When** it is given again, **Then** it is refused as a replay.
3. **Given** a refused deploy, **When** the developer looks at the server's status, **Then** the deploy number and secret versions are what they were before.
4. **Given** input that is not a deploy at all, **When** it is given to the runner, **Then** it is rejected with a reason and the runner exits with a failure status.
5. **Given** the app fails to start after a deploy was accepted, **When** the runner reports back, **Then** the developer is told the deploy was accepted but the app did not start, and the deploy number is not reused.

---

### User Story 3 - Change, roll back and retire (Priority: P3)

After the first deploy the developer changes a secret, deploys a new version, decides it was a mistake and rolls back, and later removes a secret the app no longer needs.

**Why this priority**: these are the day-two operations. They make the tool usable for real work but are not needed to prove the first deploy.

**Independent Test**: deploy twice, roll back and see the first version's content running under a new deploy number; remove a secret and see it gone from the app's environment.

**Acceptance Scenarios**:

1. **Given** two deploys of an app, **When** the developer rolls back, **Then** the earlier service definition is deployed again under the next number, with the current secrets.
2. **Given** a secret, **When** the developer sets it again, **Then** its version goes up and the next deploy carries the new value.
3. **Given** a secret the app no longer needs, **When** the developer removes it and deploys, **Then** the app starts without it and the server refuses any later attempt to bring the old value back.
4. **Given** several apps and secrets, **When** the developer lists them, **Then** they see names and versions, never values.

---

### Edge Cases

- The developer runs a command before starting a team: told what to run first, nothing is created.
- The keychain is unavailable or refuses access: the command fails with that reason; no fallback to a file.
- The server is unreachable, or the runner is not installed on it: the command fails with what was tried.
- The runner was already set up for another team: connecting it is refused, not overwritten.
- The server is connected twice under different names: refused.
- The Compose file is missing, empty or larger than the limit: refused before anything is signed.
- A secret is set for an app or server that does not exist: refused with the list of known ones.
- Docker is not installed or not running on the server: the deploy is accepted and recorded, the start fails, and the report says so.
- The runner's stored state is damaged: the runner refuses to act and says the state is invalid, and never treats it as empty.
- Two deploys are started at the same moment for the same server: the second waits or fails cleanly; state is never half-written.
- A value is piped in for a secret: accepted from standard input so scripts can use it.

## Requirements *(mandatory)*

### Functional Requirements

**Command-line tool**

- **FR-001**: The tool MUST create a signing key and a team for the developer, store the private key only in the operating system's keychain, and show the team's confirmation code.
- **FR-002**: The tool MUST fail with a clear reason when the keychain is unavailable, and MUST NOT store a private key in a file under any option.
- **FR-003**: The tool MUST connect a server reachable over SSH: have the runner set itself up for this team, show the server's confirmation code, and add the server to the signed team list.
- **FR-004**: The tool MUST also be able to connect a runner on the same machine, without SSH, for trying the product and for automated tests.
- **FR-005**: The tool MUST set a secret for an app on a server, reading the value without echoing it, or from standard input, and MUST keep only the signed, encrypted record.
- **FR-006**: The tool MUST list secrets by name and version, and MUST have no way to display a value.
- **FR-007**: The tool MUST remove a secret by signing a removal with the next version number.
- **FR-008**: The tool MUST deploy an app from a Compose file: choose the next deploy number from what the server reports, gather the app's current secrets, sign the deploy and deliver it to the runner.
- **FR-009**: Before signing, the tool MUST show anything it left out of the current secrets and why.
- **FR-010**: The tool MUST keep a history of deploys per server and app, and MUST roll back by deploying an earlier service definition under the next number.
- **FR-011**: The tool MUST show status for a server: the team list version it holds, the last deploy number per app and the version of each secret.
- **FR-012**: Every command MUST exit with a zero status on success and a non-zero status on failure, and MUST print failures to standard error in one plain sentence that names what to do next when there is something to do.
- **FR-013**: The tool MUST offer machine-readable output for status and deploy results.

**Runner**

- **FR-014**: The runner MUST set itself up once: create the server's key, store the private half in a file readable only by its own user, pin the team from the founding list and the code it is given, and report its public key and confirmation code.
- **FR-015**: The runner MUST refuse to set itself up again when it already belongs to a team.
- **FR-016**: The runner MUST apply newer team lists it is given, in order, accepting each only as the core library allows.
- **FR-017**: The runner MUST accept a deploy only through the core library's check, and MUST save its new state before starting anything.
- **FR-018**: The runner MUST start an accepted deploy with Docker Compose, passing secrets through the environment of that process and never writing a decrypted secret to disk.
- **FR-019**: The runner MUST report one of: accepted and started, accepted but failed to start, or refused with the core library's reason.
- **FR-020**: The runner MUST never act on damaged or incomplete stored state, and MUST write state so that an interruption cannot leave it half-written.
- **FR-021**: The runner MUST process one deploy at a time.
- **FR-022**: The runner MUST open no network port. It runs only when invoked and reads its input from standard input.
- **FR-023**: The runner MUST report its status: server identity, team list version, last deploy number per app and secret versions, with no secret values.

**Both**

- **FR-024**: Messages between the tool and the runner MUST be defined once, in the core library, and validated by both sides.
- **FR-025**: Neither program may print, log or include in an error any secret value or private key.
- **FR-026**: Both programs MUST use the core library for every cryptographic operation and check, and MUST NOT reimplement any of them.
- **FR-027**: All names in output, documentation and code MUST follow the project's terms: "runner", never "agent".

### Key Entities

- **Developer profile**: on the developer's machine: the team as trusted so far, the chain of team lists, the connected servers and how to reach each, and the name under which the signing key sits in the keychain.
- **Server entry**: a name, how to reach it (an SSH destination, or "this machine"), and its identity.
- **Secret store**: per server and app, the signed secret records and removals. No values.
- **Deploy history**: per server and app, the service definition and number of each deploy, for rollback.
- **Runner home**: on the server: the server's private key, the runner's stored state, and the service definition of each app as last deployed.
- **Runner report**: what the runner says after an attempt: started, failed to start, or refused with a reason.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer with Docker and SSH access to a server goes from nothing installed to a running app with a secret in under 10 minutes, following the quickstart.
- **SC-002**: The whole first-deploy journey runs as an automated end-to-end test on one machine, with the runner as a separate process and a real container started.
- **SC-003**: Every refusal in User Story 2 is demonstrated by an automated test that also shows nothing was started and stored state did not change.
- **SC-004**: After any sequence of commands, no private key and no secret value appears in any file the tool or the runner wrote, checked by searching those files in an automated test.
- **SC-005**: A deploy of a small app, from command to "started", adds less than 2 seconds on top of the time Docker itself takes.
- **SC-006**: An internal security review of both programs reports no finding rated high or critical that remains open at the end of the feature.

## Assumptions

- The developer already has SSH access to the server, with host verification in place, and Docker with Compose installed there.
- The runner is installed on the server by the developer, as a single file. Automating installation is out of scope.
- The developer's machine is macOS, Linux or Windows with a working system keychain. A headless machine without one is out of scope.
- One developer, one machine. Teammates, roles in practice, and sharing secrets between machines arrive with the control plane.
- Building and hosting container images, logs from running apps, and deploys from CI are out of scope.
- The control plane is out of scope. Nothing in this feature talks to it, and the message formats are the ones it will later carry.
- The design remains unaudited. The security review here is internal.
