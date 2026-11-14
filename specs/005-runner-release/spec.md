# Feature Specification: Runner Releases

**Feature Branch**: `005-runner-release`

**Created**: 2026-11-14

**Status**: Draft

**Input**: User description: "Runner releases, first version. Today nobody but the maintainer can use Zekno, because no runner release exists: `zekno server add` can only install a runner from a published release whose checksum the CLI holds, and none is published, so adding a server needs the development option `--runner-file` or a runner copied by hand. Feature 004 built the pieces (the installer over SSH that verifies a checksum before installing, `zekno server update`, and a release workflow for the tag `runner-v<version>`); none of it has ever run for real. Deliver: adding a server installs the published runner by itself; updating an older runner; a release is installed only if it is exactly what the maintainers published, confirmed by a second independent build; the runner starts on ordinary Linux servers; a short written release procedure; the first release, 0.1.0, published, recorded and proven on a real server; the rule between CLI and runner versions; docs that say how it really works."

## Clarifications

### Session 2026-11-14

- Q: Where does the second build run? → A: On the maintainer's own machine, with one command that rebuilds the tagged commit and compares it with the published files. Chosen over a second build service.
- Q: Which processors must the x86-64 runner start on? → A: Also those without the newer instruction sets: the build tool's "baseline" build. The runner mostly waits on Docker and the network, so the speed cost does not matter.
- Q: Which Linux systems? → A: Those with the standard system library (Debian, Ubuntu, RHEL and similar). Alpine hosts are not supported in the first release, and the notes say so.
- Q: Is a signed statement of how a build was made published with it? → A: Not in the first release. The checksum the CLI holds, confirmed by the second build, is the trust.
- Q: Who may start a release? → A: Only the maintainer, enforced by a rule on the repository for the release tags.
- Q: Are releases made from one branch? → A: No, from two, as two environments. A **dev** release is cut from the `dev` branch, carries a version such as `0.1.0-dev.1`, and is marked as a pre-release; it is for proving a runner on a real server. A **prod** release is cut from `main`, carries a plain version such as `0.1.0`, and waits for the maintainer's approval before it is published. A CLI built from `dev` installs the dev release it carries; a CLI built from `main` installs the prod release. A user never chooses an environment.
- Q: Does the second build apply to dev releases? → A: Yes. One rule for both.
- Q: What is the first version? → A: 0.1.0. Nothing was ever released, so the number 0.2.0 that feature 004 used inside the repository is dropped. The first dev release is `0.1.0-dev.1`, the first prod release `0.1.0`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a server with nothing on it (Priority: P1)

A developer has installed nothing on their server but Docker. They run `zekno server add prod --ssh deploy@their-server`. Zekno connects, sees there is no runner, has the server download the published runner, checks it is exactly the one this version of Zekno expects, installs it, sets it up for the team and adds the server to the signed team list. The developer typed one command and never logged in to the server.

**Why this priority**: without this, nobody but the maintainer can use Zekno. Every other part of the product starts from a connected server.

**Independent Test**: on a Linux server that has Docker and no runner, run the one command with a released build of the CLI and no development option. The server ends up connected, and a deploy to it works.

**Acceptance Scenarios**:

1. **Given** a Linux x86-64 server with Docker and no runner, reached as root, **When** the developer runs `zekno server add <name> --ssh <destination>`, **Then** the published runner is installed, every step is shown as it completes, the server code is shown with what it is for, and the server is in the team list.
2. **Given** the same on a Linux ARM64 server, **When** the command runs, **Then** the runner built for ARM64 is installed and it works the same.
3. **Given** a server reached as a user who is not root, **When** the command runs, **Then** the runner is installed in that user's own folders, with no elevated rights asked for.
4. **Given** the full-screen app and a first run, **When** the developer adds a server from the app, **Then** the same install happens inside the app.
5. **Given** a server that cannot reach the place releases are published, **When** the command runs, **Then** nothing is installed and the developer is told what the server needs.
6. **Given** the file the server downloaded is not exactly the published one, **When** it is checked, **Then** it is deleted, nothing is installed, and the developer is told it did not match.

---

### User Story 2 - A release is only what the maintainers published (Priority: P1)

A maintainer cuts a release. Before any user's CLI will accept it, a second build of the same source, made somewhere the first build cannot influence, must produce the same runner files. Only then are the release's checksums written into the CLI. A person who can only start a release, or who controls the service that builds it, cannot get a different runner onto users' servers without the mismatch being seen.

**Why this priority**: the runner starts containers on servers its users own. Zekno's promise is that nobody in the middle can run code there. A release route that trusts one build service would break that promise at the first step.

**Independent Test**: build the runner twice from the same commit in two separate places and compare. Then change one byte of a published file and show that a server refuses it and that the comparison step reports it.

**Acceptance Scenarios**:

1. **Given** a release was built, **When** the second build of the same commit is made, **Then** its files are compared with the published ones and the result is recorded with the release.
2. **Given** the two builds differ, **When** the comparison runs, **Then** it fails, says which file differs, and the checksums are not recorded in the CLI.
3. **Given** the two builds match, **When** the checksums are recorded, **Then** the record names the release, each file's checksum, and that the second build agreed.
4. **Given** someone without the right to release pushes a release tag, **When** they try, **Then** it is refused and no release is made.
5. **Given** a published file is replaced after the checksums were recorded, **When** a server downloads it, **Then** the install stops, as in User Story 1, scenario 6.

---

### User Story 3 - Cut a release by following a short written procedure (Priority: P2)

A maintainer who has never made a release reads one page and makes one: which commits may be released, how the version is chosen, the one action that starts the build, how the second build is made and compared, how the checksums get into the CLI, what the release notes say, and how a bad release is withdrawn. The first release, runner 0.1.0, is made this way.

**Why this priority**: a release made from memory is where mistakes and shortcuts happen. The first release is also the proof that the procedure works.

**Independent Test**: a person follows the page from start to end with no other help and ends with a published release whose checksums are in the CLI. Then they follow the "withdraw" part on a test release.

**Acceptance Scenarios**:

1. **Given** the procedure page, **When** a maintainer follows it for 0.1.0, first as a dev release and then as a prod release, **Then** each release exists with the runner for x86-64 and ARM64, its notes, and the record of the second build.
2. **Given** a version that does not match what the runner says about itself, **When** a release is started, **Then** it stops before anything is published.
3. **Given** a release that turns out to be bad, **When** the maintainer follows the withdrawal steps, **Then** no CLI installs it any more, and the page says what happens to servers that already have it.
4. **Given** a commit that is not on the branch its kind of release is made from (`dev` for a dev release, `main` for a prod release), **When** a release is started from it, **Then** it is refused.
5. **Given** a prod release was started, **When** the maintainer has not approved it, **Then** nothing is published.
6. **Given** a dev release, **When** it is published, **Then** it is marked as a pre-release and is never shown as the latest release.

---

### User Story 4 - Bring an older runner up to date (Priority: P2)

A developer's server has a runner from before. Zekno tells them so, and what they are missing. They run `zekno server update prod`, confirm, and the runner is replaced by the one their CLI carries, with their apps still running. A runner newer than their CLI is never replaced by an older one.

**Why this priority**: once a second release exists, every server out there needs this. It is also the only way a server set up before releases existed gets state and logs.

**Independent Test**: on a server with the previous runner and a running app, run the update. The runner answers with the new version, the app never stopped, and its deploys and secrets are as before.

**Acceptance Scenarios**:

1. **Given** a server whose runner is older than the CLI's, **When** the developer runs `zekno status` or opens the app, **Then** they are told the runner is older and how to update it.
2. **Given** that server, **When** they run `zekno server update <name>` and confirm, **Then** the runner is replaced, it answers with the new version, and the apps on the server kept running.
3. **Given** a server whose runner is newer than the CLI's, **When** they run the update, **Then** nothing is changed and they are told to update Zekno instead.
4. **Given** the new runner cannot start on that server, **When** the update runs, **Then** the old runner stays in place and keeps working.
5. **Given** no terminal, **When** the update is run without saying yes in advance, **Then** it stops and names how to say yes.

---

### User Story 5 - The runner starts on ordinary servers (Priority: P3)

A developer has an older or smaller server: a processor a few generations back, or an older Linux. The published runner starts on it. Where it truly cannot, the install stops before anything is replaced and says why in words the developer can act on.

**Why this priority**: people who want their own servers often run modest or old ones. A runner that fails to start with no explanation looks like a broken product.

**Independent Test**: start the published runner on the oldest processor and the oldest Linux the release notes promise, and on one below that line, and compare what the developer is told.

**Acceptance Scenarios**:

1. **Given** a server at the oldest supported processor and Linux, **When** the runner is installed, **Then** it starts and a deploy works.
2. **Given** a server below what is supported, **When** the install runs, **Then** nothing is put in place, and the developer is told what the server lacks.
3. **Given** the release notes, **When** a developer reads them, **Then** they say which processors and Linux versions the runner is built for.

---

### User Story 6 - Docs that say how it really works (Priority: P3)

A newcomer reads the README or the docs and follows them from nothing to a running app, with no step that only works for the maintainer.

**Why this priority**: until now the docs had to say "no release exists yet". After the first release that sentence is wrong, and a wrong first step loses the reader.

**Independent Test**: a person who has not used Zekno follows the public docs on their own server and reaches a running app.

**Acceptance Scenarios**:

1. **Given** the first release is published and recorded, **When** the docs are read, **Then** nothing says a release does not exist, and the development option is described as such.
2. **Given** the docs, **When** compared with the CLI, **Then** every command and option they name exists, and the install route is described with its limits.

---

### Edge Cases

- The release exists but the CLI in hand was built before its checksums were recorded: it has nothing to install, and says so, as today.
- The server has a tool to download but not one to check a checksum, or the reverse.
- The server's disk fills during the download.
- The release was withdrawn while a server was half way through installing it.
- Two releases are started for the same version.
- The second build cannot be made at all (the place it runs is unavailable): the checksums are not recorded, and the release is not usable until it is.
- A server has a runner that somebody put there by hand under another file name.
- A server's runner was installed by another team's CLI at a version this CLI has never heard of.
- The developer's CLI is older than every published runner.

## Requirements *(mandatory)*

### Functional Requirements

**Installing from a release**

- **FR-001**: Adding a server MUST install the published runner by itself when the server has none, with no development option and nothing typed on the server.
- **FR-002**: The runner MUST be published for Linux on x86-64 and on ARM64, and the right one MUST be chosen from what the server reports.
- **FR-003**: The install MUST work for root and for a user who is not root, without asking for elevated rights.
- **FR-004**: A downloaded runner MUST be installed only when its checksum equals the one the CLI holds for that version and kind of server. The expected checksum MUST never come from the download or from the server.
- **FR-005**: A runner MUST be put in place only after it answered with its version from where it was downloaded to. One that cannot start MUST NOT replace one that can.
- **FR-006**: Every way the install can stop MUST tell the developer what happened and what to do, and MUST leave the server as it was.
- **FR-007**: A CLI that holds no checksum for its runner version MUST say that it has no published runner to install and name the alternatives, as today.

**What makes a release trusted**

- **FR-008**: A release's checksums MUST be recorded in the CLI only after a second build of the same source, made independently of the first, produced the same files.
- **FR-009**: The comparison MUST fail when any file differs, MUST say which, and MUST leave a record of its result with the release.
- **FR-010**: Starting a release MUST be limited to named maintainers. A dev release MUST be possible only from commits on `dev`, and a prod release only from commits on `main`.
- **FR-010a**: A prod release MUST wait for the maintainer's approval before anything is published. A dev release MUST be marked as a pre-release.
- **FR-010b**: A version MUST be either three numbers (a prod release) or three numbers followed by `-dev.` and a number (a dev release), and nothing else. A dev version MUST count as older than the plain version with the same three numbers.
- **FR-011**: A release MUST stop before publishing when the version asked for differs from the version the runner reports.
- **FR-012**: A published release's files MUST NOT be replaceable without that being caught by FR-004.
- **FR-013**: The release MUST state, in its notes and in a file beside the runner, the checksum of each file, the commit it was built from, and what the runner is built for.

**The procedure**

- **FR-014**: There MUST be one page that takes a maintainer through a release from start to end, including the second build, recording the checksums, the notes, and withdrawing a release.
- **FR-015**: Withdrawing a release MUST make every CLI that learns of it stop installing that release, and the page MUST say what to do about servers that already run it.
- **FR-016**: The first release, runner 0.1.0, MUST be made by following that page, as `0.1.0-dev.1` from `dev` and then as `0.1.0` from `main`, and each one's checksums recorded in the CLI on its branch.
- **FR-016a**: The version 0.2.0 that feature 004 used inside the repository MUST be replaced by 0.1.0 everywhere: nothing was released under it.

**Versions**

- **FR-017**: A CLI MUST install exactly the runner version it carries, and no other.
- **FR-018**: A CLI MUST tell the developer when a server's runner is older than the one it carries, and when it is newer.
- **FR-019**: Updating MUST replace an older runner with the one the CLI carries, MUST keep the server's apps running, MUST keep its team, deploys and secrets, and MUST never replace a newer runner with an older one.
- **FR-020**: Updating MUST happen only when the developer asked for it, and at a terminal only after they confirmed.
- **FR-021**: A CLI and a runner one release apart MUST still be able to deploy with each other, and the developer MUST be told what does not work until the runner is updated.

**Where it runs**

- **FR-022**: The published runner MUST start on the oldest processor and Linux version the release notes name, and those MUST be chosen so that ordinary servers people rent or own are covered.
- **FR-023**: On a server below that line, the install MUST stop before putting anything in place and say what the server lacks.

**Proof and docs**

- **FR-024**: After the first release, adding a server from the release, a deploy, and an update from an older runner MUST each be run on a real server and the results written down.
- **FR-025**: The README, the docs pages and the feature map MUST describe the install route as it works after the release, with its limits, and MUST NOT say that no release exists.
- **FR-026**: Everything the installer protects today MUST still hold: its text is fixed, its values are checked before they are used, it downloads over an encrypted connection only, and an update replaces only a file named `zekno-runner`.
- **FR-027**: The product MUST still say, wherever it says so today, that it is pre-alpha and has had no outside audit.

### Key Entities

- **Environment**: dev or prod. It decides the branch a release is cut from, the shape of its version, whether it waits for approval, and whether it is marked as a pre-release.
- **Release**: one version of the runner as published: its environment, its version, the commit it was built from, a file per kind of server, the checksum of each, its notes, and the record of the second build.
- **Expected checksums**: what one build of the CLI holds for the one runner version it installs: a checksum per kind of server, or nothing before a release is recorded.
- **Second build record**: who or what made the second build, from which commit, and whether each file matched.
- **Release procedure**: the page a maintainer follows.
- **Supported servers**: the kinds of processor and the oldest Linux the release is built for.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person with a Linux server that has Docker goes from an installed CLI to a connected server with one command and nothing typed on the server, in under two minutes on an ordinary connection.
- **SC-002**: A file that differs from the published runner by a single byte is never installed, in every test of it.
- **SC-003**: Two builds of the same commit made in two separate places give the same checksums, every time it is tried for the first release.
- **SC-004**: A maintainer who has not made a release before completes one by following the page alone, in under one hour.
- **SC-005**: Updating a server's runner keeps every app on it running for the whole update, measured on a real server.
- **SC-006**: A person without the right to release cannot make one, tried once for real.
- **SC-007**: The runner starts on every kind of server the release notes name, each tried for real or in a faithful stand-in, and the notes say which was which.
- **SC-008**: A newcomer following only the public docs reaches a running app on their own server.
- **SC-009**: No sentence in the README, the docs or the feature map describes the install route in a way the released CLI does not behave.

## Assumptions

- Releases are published on the project's public repository, as feature 004 decided, and the release workflow built there is the starting point.
- The second build must match the first exactly. Whether the build tool gives the same file twice is not known yet; it is checked first during planning. If it does not, how to reach the same assurance is decided with the maintainer before anything else is built.
- Tools and services are chosen with the maintainer during planning, not here: where the second build runs, whether a record of how a build was made is published with it, whether any signing key is used, which processor baseline and system library the runner is built for, and how the right to release is restricted on the repository.
- Pushing the release tag and changing repository settings are the maintainer's own actions, or are done only with their go-ahead each time.
- The CLI's own version stays as it is. Packaging the CLI for installation (npm, Homebrew) is a separate feature, so "an installed CLI" in this feature means one built from the repository.
- One real server is available for the proof: Linux x86-64, reached as root. ARM64 and a user who is not root are proven on a real server where one is available, otherwise in the closest stand-in, and the record says which.
- A runner does not update itself. Updating is always the developer's command.
- Out of scope: packaging the CLI, the control plane, servers that are not Linux, and checking a release on the server by anything other than its checksum.
- The product stays pre-alpha and unaudited. Nothing in this feature is an outside review.
