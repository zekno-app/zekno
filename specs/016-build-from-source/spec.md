# Feature Specification: Build from source

**Feature Branch**: `016-build-from-source`

**Created**: 2026-11-26

**Status**: Draft, revised on 2026-11-26 after three reviews: security, a person coming from a managed platform, and testability. The direction was decided by the maintainer on 2026-11-26 (D1 to D6 under Clarifications, from [`research.md`](./research.md), part 1). The points under "Open points for the maintainer" are not decided. Where a requirement depends on one, it follows the recommendation and names the point. No board exists yet. The look and the wording of every new screen and line are decided with the maintainer on boards before anything is built, so every sentence quoted in this spec is a draft.

**Input**: Stage 4 of the road map. Today an app's images must already exist in a registry. This feature lets `zekno deploy`, run in a folder of code, build the image on the customer's own server and run it. Step 1 covers a folder with a Dockerfile. Step 2 covers a folder without one, built with Railpack. It builds the design for server builds written and reviewed twice during feature 010 ([`deploy-v2.md`](../010-app-settings/deploy-v2.md), part 4.1 (b) and questions Q1 to Q18, "the design" below). It stands on the signed deploy of feature 014 and on runner 0.1.1 of feature 015. The research, the hand test of Railpack and the threats are in [`research.md`](./research.md) ("the research").

## Clarifications

### Session 2026-11-26 (before this spec)

- Q: Where does a build run? → A: On the customer's own server (D1). Building in CI belongs to the later stage "deploys from CI".
- Q: Which folders does this stage cover? → A: Folders with a Dockerfile, then folders without one, as two steps of one stage (D2).
- Q: How is a folder with no Dockerfile built? → A: With Railpack (D3).
- Q: Where is the builder chosen? → A: In the settings file. The signed format is made to hold more than one builder, so a later builder changes no format (D4).
- Q: Other builders? → A: Cloud Native Buildpacks come later, as a step of their own. Nixpacks is left out: its makers say it is in maintenance mode (D5).
- Q: How does the developer get Railpack? → A: zekno fetches a pinned copy by itself and checks its checksum, as it checks a runner release. The developer installs nothing by hand (D6).

## Why

Today Zekno runs only images that already exist in a registry. To deploy their own code, a person has to pick a registry, let the server log in to it, build the image, push it, and copy its name into the settings. A person who has used a managed platform expects none of this. They expect to run one command in a folder of code.

Building on the server has a second reason. Many developers sign on an ARM Mac, and many servers are x86-64. An image built on the server is built for the server's own processor.

It has to be done without weakening what Zekno promises. The server runs only what a team member signed. A build adds three things that decide what runs: the code, the build recipe and the builder. All three must be fixed by the signature. The code must be sealed for the server, so that nobody in between can read it, including the hosted service once it exists. Some of what a build downloads cannot be fixed by any signature, such as packages and language tools fetched while it runs. That must be said plainly. A build also shares the server with the apps already running there, and that must be said plainly too. And a Compose file written by hand must not become a way to build something outside these rules.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deploy a folder that has a Dockerfile (Priority: P1, step 1)

A developer has a folder of code with a Dockerfile, and a server with the new runner. They run `zekno deploy` in the folder. The first time, at a terminal, zekno shows what it would send and the settings file it would write, and asks whether to build this folder on the server (open point 3). The settings file holds one service, its build and the port it listens on. So the signed settings say a build happens, and the app can be reached. On a yes, zekno writes the file, seals the code for the server and signs the deploy. The server checks the code against the signature, builds the image with its own Docker, and starts the app. No registry is used and no image is built by hand.

**Why this priority**: It is the first step of the stage, and the case most people with a Dockerfile meet first.

**Independent Test**: With a test runner and real Docker on this machine, deploy a folder whose Dockerfile builds a small web server. The app answers on the port the written settings give it. The server holds the image under the name the signed Compose text gives it, and no registry was reached for the app's own image.

**Acceptance Scenarios**:

1. **Given** a folder with one file named exactly `Dockerfile`, no settings file and no Compose file, **When** the developer runs `zekno deploy` at a terminal, **Then** zekno first asks once whether to build the folder on the server, before the questions about the key, the server and the app. The question shows what would be sent and the settings file it would write: one service (its name drawn on the boards, such as `web`), its build, and the port the Dockerfile says it listens on, when it says one. The person can change the port, give one, or say the service has none, as for a worker. On a yes, zekno writes the file and goes on with the deploy.
2. **Given** the same question, **When** the person answers no, or presses Esc or Ctrl-C, **Then** nothing is written, and the deploy ends with today's sentence for a folder with no Compose file.
3. **Given** a folder with a Dockerfile, a `node_modules` folder of 600 MB and no `.dockerignore`, **When** the developer deploys at a terminal, **Then** the question also proposes a `.dockerignore`, drawn from the folder's `.gitignore` plus dependency folders, and shows it. The same yes writes it, and `node_modules` is not sent (open point 1).
4. **Given** a settings file whose service is built from the folder, **When** the developer deploys, **Then** the code is sent sealed, the server builds it, and the app starts as today.
5. **Given** the same folder with no terminal and no settings file, **When** `zekno deploy` runs, **Then** it deploys nothing and stops exactly as it does today in a folder with no Compose file.
6. **Given** a `Dockerfile` beside a file whose name starts with `Dockerfile.`, or a `Dockerfile` in a sub-folder that is sent, **When** the developer deploys, **Then** zekno never picks one by itself. The settings name it, or the person chooses in the first-deploy question and the choice is written to the settings.
7. **Given** two services built from the same folder with the same recipe (a web process and a worker), **When** the developer deploys, **Then** the code travels once and is built once, and each service runs the image with its own start command.
8. **Given** a server whose processor differs from the developer's machine, **When** the app is built there, **Then** the image is for the server's processor and starts.
9. **Given** a first deploy of a settings file zekno wrote, with a built service that has a port and no domain, **When** the app starts, **Then** the result says how to reach it. Draft: `web listens on 3000 inside prod. Give it a domain with zekno domain add <domain>, then deploy again.`
10. **Given** that first deploy, **When** the developer runs `zekno domain add` and deploys again with no change to the code, **Then** no code is sent, nothing is built, and the app answers over HTTPS on its domain.

---

### User Story 2 - Know what is sent before anything is signed (Priority: P1, step 1)

Before zekno signs a deploy that builds, it shows what it will send: how many files, how large, the largest folders, what it left out and why, and every secret-looking file it does send and why. A folder that is too large is refused before anything is signed. The sentence names the largest folders and how to leave them out. At a terminal, the first deploy that builds from a folder on this machine waits for a yes after the summary. A secret-looking file is sent only when the settings name it and the person agreed to it on this machine. So a person learns what the summary names, such as a forgotten `node_modules` or a `.env` file, on their own machine and before anything is signed.

**Why this priority**: The folder decides what reaches the server. A mistake here sends secrets or gigabytes, and it can only be caught before signing.

**Independent Test**: Pack test folders on this machine with stand-ins for the server. The summary counts files and bytes exactly. An ignored folder, a `.git` folder, each kind of file on the list of secret-looking files, and a link that leads out are each listed as left out. A listed file that the settings name is sent only after a yes on this machine. A folder over the limit signs nothing and names its largest folders.

**Acceptance Scenarios**:

1. **Given** a folder with code, a `.dockerignore` and a `.git` folder, **When** the developer deploys, **Then** the summary shows the number of files, the total size, the largest folders, and what was left out by the ignore file and by zekno's own rules, before anything is signed.
2. **Given** a folder whose packed size passes the limit a deploy can carry, **When** the developer deploys, **Then** nothing is signed or sent, and one sentence names the size, the limit, the largest folders and how to leave them out. Draft: `This folder packs to 734 MB, over the 537 MB a deploy can carry. Largest: node_modules 612 MB, .next 98 MB. List them in .dockerignore, then deploy again. Nothing was signed.`
3. **Given** a file such as `.env` in the folder, **When** the developer deploys, **Then** it is not sent unless the settings name it, and the summary says it was left out and where its values belong (open point 2). Draft: `.env was left out: it looks like it holds secrets. To give its values to the app, run zekno secret import .env.`
4. **Given** a file on the list of secret-looking files that the settings name, **When** the developer deploys at a terminal, **Then** zekno asks once whether to send that file. The answer is remembered on this machine, never in the folder, and the summary lists the file as sent and why. With no terminal and no earlier yes on this machine, the deploy stops before signing and names the file.
5. **Given** a settings file that builds, which arrived with a cloned repository, **When** the developer first deploys from that folder at a terminal, **Then** zekno shows the summary and waits for a yes before signing.
6. **Given** a link in the folder that leads out of it, **When** the developer deploys, **Then** zekno does not follow it, does not send what it leads to, and lists it as left out.
7. **Given** the same files on two machines, **When** each packs them, **Then** both get the same fingerprint, and for a Dockerfile the same image name in the Compose text.
8. **Given** no terminal, **When** a deploy that builds runs, **Then** the summary's facts are given as plain lines on standard error. Standard output keeps only today's result line, so a script that reads it gets the same line for a deploy that builds.

---

### User Story 3 - Follow a build, and a failed build leaves the app alone (Priority: P1, step 1)

While the server builds, the deploy shows a stage for the build, with the builder's latest line under it. When the build fails, the runner does not stop, replace or re-route the app that was running. The developer is told in one sentence that the build failed, and which deploy still runs or that none runs yet. The step that failed and its error follow, then the builder's last lines. A build that runs out of memory, out of disk or out of time says so in words. A build shares the server's memory, processor and disk with the apps already running there. A build that runs out of memory can make the server stop other programs, the running app among them. zekno says so plainly, in the sentence and in the docs.

**Why this priority**: A build is the slowest and most fragile part of a deploy. A person must see it move, and a failed build must never make the runner touch the site.

**Independent Test**: With a test runner, real Docker and a running app that writes to disk: a Dockerfile with a failing step ends the deploy as a failed build. The app of the previous deploy still answers and still writes. The failing step, its error and the builder's last lines are shown. A build that passes its time limit is stopped and said to be. A build that brings free disk below the floor (a stand-in) is stopped as out of disk.

**Acceptance Scenarios**:

1. **Given** a deploy that builds, **When** the code is sent and the server builds, **Then** the stage row shows the upload's progress, then a build stage between Sent and Starting with the builder's latest line under it.
2. **Given** an app running deploy 6, **When** the build of deploy 7 fails, **Then** the runner leaves deploy 6 untouched, the number 7 is used, and the lead sentence says so. Draft: `The build of web failed on prod. shop still runs deploy 6.` The step that failed and its error follow in the "Docker said" panel, then the builder's last lines (open point 10).
3. **Given** an app with no deploy yet, **When** its first build fails, **Then** the number is used, and the sentence says that nothing runs yet. Draft: `The build of web failed on prod. shop has no deploy running yet.`
4. **Given** a build that passes its time limit, **When** the limit is reached, **Then** the server stops it, the outcome is a failed build, and the sentence names the limit.
5. **Given** a build that brings free disk on the server below the floor, **When** the floor is reached, **Then** the runner stops the build, the outcome is a failed build, out of disk, and the app that was running is untouched.
6. **Given** a build that runs out of memory, **When** it fails, **Then** the sentence says so, says that the server may have stopped other programs too, and gives a step the person can take. Draft: `The build of web ran out of memory on prod and was stopped. A server out of memory can stop other programs too: zekno status shows whether shop still runs deploy 6. Give prod more memory or swap space, then deploy again.`
7. **Given** the connection drops during the build, **When** the developer looks again, **Then** the build went on to its end on the server, and `zekno status` shows how it ended.
8. **Given** no terminal, **When** a build fails, **Then** the sentence goes to standard error, and standard output keeps today's result line. `--json` gives a failed-build outcome with its reason (draft name: `build_failed`). The exit status is the one of a deploy whose app did not start.

---

### User Story 4 - Only what a team member signed is built (Priority: P1, step 1, again in step 2)

Whoever relays or stores a deploy, and whatever a Compose file says, the server builds only the code, the recipe and the builder a team member signed. The code travels sealed for the server. A person can read in the summary and in the docs what the signature fixes and what it does not.

**Why this priority**: It is Zekno's promise. A build that a relay could change, or that a Compose file could start, would break it.

**Independent Test**: With a test runner: change one byte of the code, of one sealed piece, of the recipe or of the builder's name after signing. Each is refused before the number is used. A hand-written Compose file that asks for a build is refused by zekno before signing. The runner, given such a text anyway, builds nothing. A marker string placed in a source file never appears in the sealed pieces, in the signed deploy or in the runner's own folder.

**Acceptance Scenarios**:

1. **Given** a signed deploy that builds, **When** any part of the code, the recipe or the builder is changed after signing, **Then** the runner refuses it, nothing runs, and no number is used.
2. **Given** a hand-written Compose file in which a service asks Docker to build an image, **When** the developer deploys, **Then** zekno stops before signing and says how to build with Zekno instead (open point 6). Draft: `compose.yaml asks Docker to build web. zekno builds from a settings file only: run zekno settings init to start one. Nothing was signed.`
3. **Given** a runner of this feature and a signed Compose text that asks for a build, **When** it starts the app, **Then** nothing is built, and a service whose image does not exist does not start.
4. **Given** the deploy summary of a build, **When** the developer reads it, **Then** a line says what the build downloads while it runs is not fixed by the signature, naming what applies to its builder. Draft for a Dockerfile: `What the build downloads while it runs, such as base images named by tag and packages, is not fixed by this signature.` Draft for Railpack: `What the build downloads while it runs, such as packages and language tools, is not fixed by this signature.`
5. **Given** a deploy that builds is sent to a machine other than the server it names, **When** that machine receives it, **Then** it cannot open the code.
6. **Given** a Dockerfile that names another app's built image, directly, through a build argument's default, or in a copy from another image, **When** the developer deploys, **Then** zekno refuses it before signing.
7. **Given** a build whose builder prints lines of the code, **When** the build ends, **Then** those lines went only to the zekno that sent the deploy. The runner keeps none of them, and its record of the build holds only the outcome and its reason.

---

### User Story 5 - Nothing changed, nothing sent, nothing built (Priority: P2, step 1)

A developer deploys again with no change to the code or the recipe, for example after changing a secret. The server still keeps the image of the earlier build. No code travels and nothing is built. The build stage says the image was kept. For a Railpack build, this holds while Railpack makes the same plan (User Story 6).

**Why this priority**: Most deploys change little. Sending and building again each time would make every deploy slow.

**Independent Test**: With a test runner: deploy a folder, then deploy again with only a secret changed. No code is sent, the builder is not started, and the app runs with the new secret.

**Acceptance Scenarios**:

1. **Given** the server keeps the image of the same code, recipe and builder, **When** the developer deploys, **Then** no code is sent, nothing is built, and the build stage says the image was kept and nothing was sent.
2. **Given** someone put another image under the kept image's name on the server, **When** the developer deploys, **Then** the runner does not trust the name, asks for the code, and builds again.
3. **Given** one file changed, **When** the developer deploys, **Then** the code is sent and built again.
4. **Given** a deploy that asked for a fresh build (open point 11), **When** the developer deploys again with only a secret changed, **Then** the image of the fresh build runs, never one built before it.

---

### User Story 6 - Deploy a folder that has no Dockerfile (Priority: P2, step 2)

A developer has a folder of code in a language Railpack knows, such as a Node app with a `package.json`, and no Dockerfile. They run `zekno deploy`. In a folder with no settings file, zekno first asks whether to fetch and run Railpack on it (open point 17). The first time a deploy needs Railpack, zekno fetches the version it pins from Railpack's own release, checks it against the checksum zekno carries, and keeps it. Railpack reads exactly the files zekno will send, on the developer's machine, and makes a build plan. Every deploy with Railpack runs it on this machine, and that needs the network. The plan, the Railpack version and everything the plan names are fixed by the signature. The server checks the plan, writes the code to a folder of its own, builds it with the pinned Railpack frontend, and runs it.

**Why this priority**: It is the second step of the stage. It brings the experience of a managed platform to folders with no Dockerfile.

**Independent Test**: With a test runner, real Docker and a stand-in for Railpack's release: deploy a small Node folder with no Dockerfile. zekno fetched and checked Railpack itself, the plan is part of what is signed, the runner checked the plan against its signed fingerprint, the app answers, and the folder the runner wrote the code to is gone after the build.

**Acceptance Scenarios**:

1. **Given** a folder with no Dockerfile, no settings file and no Compose file, **When** the developer runs `zekno deploy` at a terminal, **Then** zekno first asks whether to fetch and run Railpack on the folder, and fetches or runs nothing before a yes. Draft: `No Dockerfile here. Fetch Railpack (N MB) to find out how to build this folder?` With no terminal, nothing is fetched or run.
2. **Given** a machine without Railpack, **When** a deploy first needs it, **Then** zekno fetches the pinned version, checks its checksum, says what it fetched (open point 12), and goes on.
3. **Given** a freshly fetched file whose checksum does not match, **When** zekno checks it, **Then** it is never run and it is deleted. One sentence says that the file on Railpack's release is not the one this zekno pins. Nothing is signed.
4. **Given** a folder Railpack knows, **When** the developer deploys, **Then** the summary shows what Railpack found (open point 13), the deploy is signed with the plan, and the app starts on the server.
5. **Given** a Node folder with a `node_modules` of 600 MB, no `.dockerignore` and no Dockerfile, **When** the developer deploys at a terminal for the first time, **Then** it deploys on the first try with two answers, the one to run Railpack and the one that writes the files, and `node_modules` is not sent (open point 1).
6. **Given** a Railpack app whose language had a new patch release since the last deploy, **When** the developer deploys with only a secret changed, **Then** the summary says before signing why it builds again (open point 25). Draft: `Railpack now picks Node 22.23.6 (was 22.23.5), so web is sent and built again.`
7. **Given** a machine from which Railpack cannot reach the network, **When** a deploy with Railpack runs, **Then** nothing is signed, and one sentence says that Railpack needs the network to plan the build.
8. **Given** a folder Railpack cannot read, **When** the developer deploys, **Then** nothing is signed, and one sentence gives Railpack's reason and what to do (open point 14).
9. **Given** a runner that builds with a Dockerfile but not with Railpack, **When** the developer deploys a Railpack build, **Then** zekno stops before signing and says to update the runner.
10. **Given** a machine for which zekno carries no Railpack checksum, **When** the developer deploys a folder with no Dockerfile, **Then** zekno says so before signing, and a folder with a Dockerfile still deploys.
11. **Given** a signed Railpack build whose plan does not have the signed fingerprint, or names a frontend or an image not signed by digest, **When** the runner checks it, **Then** it refuses it before the number is used.

---

### User Story 7 - Build settings where a Railway user looks for them (Priority: P2, steps 1 and 2)

A developer sets how a service is built in the settings file, in the sections a person who has used Railway knows: the folder to send under Source, and under Build the builder, the Dockerfile's path and the other settings this version offers (open point 18). `zekno settings` shows them, `zekno settings set` and `unset` change them, `zekno settings init` can start a file that builds, and the deploy signs them.

**Why this priority**: The first deploy writes these settings. Changing them comes after the first success.

**Independent Test**: With stand-ins: each build setting is shown in its section, checked against its rule, changed with `set` and `unset` as other settings are, and turned into the same signed build on every machine.

**Acceptance Scenarios**:

1. **Given** a service that is built, **When** the developer runs `zekno settings`, **Then** its build settings are shown in their sections, and the service has a build or an image to run, never both.
2. **Given** a monorepo whose Dockerfile needs a folder above the settings file, **When** the developer sets the folder to send, **Then** it is accepted up to the top of the git repository the settings file is in, and refused with a sentence beyond it (open point 5).
3. **Given** a settings file that names the Railpack builder, read by a zekno of step 1, **When** it deploys, **Then** it stops before signing and says to update zekno.
4. **Given** a settings file that builds, read by a zekno from before this feature, **When** it deploys, **Then** it stops before signing with one of the sentences it gives today, for a setting it does not know or for a service with no image, and signs nothing (open point 18).
5. **Given** a folder with a Dockerfile and no settings file, **When** the developer runs `zekno settings init` at a terminal, **Then** it offers to build the folder instead of asking for an image, with the same port question as the first deploy.
6. **Given** a service that runs an image, **When** the developer sets a build on it, **Then** the build replaces the image as one change, shown on one change line. Setting an image on a built service replaces the build the same way.
7. **Given** a folder with a Dockerfile and a `compose.yaml` whose `web` service has `build: .`, **When** the developer deploys, is refused, runs `zekno settings init`, then deploys from the settings file, **Then** the app is built on the server and answers.

---

### User Story 8 - Roll back to a built deploy (Priority: P2, step 1)

`zekno rollback` to a deploy that was built reuses the image the server kept for it. Nothing is built again and no code travels. If the server no longer keeps that image, the rollback stops before anything runs and says how to go back.

**Why this priority**: Rolling back is how a person recovers from a bad deploy. It must not depend on building again, which could give a different image.

**Independent Test**: With a test runner and real Docker: build deploys 1, 2 and 3, then roll back to 2. No code is sent, and the image of deploy 2 runs. Build five deploys that each change the code, then roll back to the first: refused, no number used, with the sentence.

**Acceptance Scenarios**:

1. **Given** the server keeps the build of deploy 4, **When** the developer rolls back to it, **Then** the new deploy carries deploy 4's build, nothing is sent or built, and deploy 4's image runs.
2. **Given** the server no longer keeps it, **When** the developer rolls back, **Then** nothing runs, no number is used, and one sentence says so. Draft: `prod no longer keeps the build of deploy 1. To go back to it, deploy that code again from a checkout.`
3. **Given** the kept image's name now leads to another image, **When** the developer rolls back, **Then** the runner does not use it. A rollback never builds again by itself.
4. **Given** an app that runs deploy 4, and whose deploys 5, 6 and 7 failed to build, **When** the developer rolls back to deploy 3, **Then** deploy 3's image is still kept and runs, and nothing is sent or built.
5. **Given** deploy 2 changed the code after deploy 1, and deploys 3, 4 and 5 changed only a secret, **When** the developer rolls back to deploy 1, **Then** deploy 1's image is still kept and runs.

---

### User Story 9 - A server's disk stays in check, and doctor says when a server cannot build (Priority: P3, step 1)

Builds fill disks. The runner always keeps the images of the deploy each app runs, and of the two most recent other deploys whose builds succeeded. It removes older ones it made. It keeps the builder's cache within a bound. It refuses to start a build when free disk is below a floor, and stops a build that brings free disk below it. It refuses a build on a server whose Docker is too old for the rules this feature rests on. `zekno doctor` says, for each server that holds a built app or when asked, whether it can build, and why not.

**Why this priority**: A full disk takes down every app on the server. It matters most after weeks of deploys, not on the first day.

**Independent Test**: With a test runner and real Docker: after five builds of one app that each change the code, only the images of the last three deploys remain. With free disk below the floor (a stand-in), a build is refused with no number used. With stand-ins, `zekno doctor` names a server whose Docker cannot build, and a server whose Docker is too old.

**Acceptance Scenarios**:

1. **Given** an app with five built deploys that each changed the code, **When** the fifth ends, **Then** the server keeps the images of deploys 5, 4 and 3, and removes only images the runner itself made.
2. **Given** free disk on the server below the floor, **When** a deploy that builds arrives, **Then** it is refused before the number is used, with a sentence that names the free space.
3. **Given** a server whose Docker is older than Docker Engine 29.5, **When** a deploy that builds is made, **Then** it stops before the number is used, and before signing wherever zekno already knows the server's Docker version. One sentence names the server's Docker version, the version needed and how to update. Deploys of images still work there. Draft: `prod runs Docker 28.5, and building needs Docker 29.5 or newer. Update Docker on prod, then run zekno deploy again. Nothing was signed.`
4. **Given** a server whose Docker has no build plugin, **When** the developer runs `zekno doctor` and asks it to check builds, **Then** a line says this server cannot build and what to install. Deploys without a build still work there.
5. **Given** a server with built apps, **When** the developer runs `zekno doctor`, **Then** it shows the disk Zekno's builds take, the free space left, and the server's memory, with a warning below the figure of open point 22.
6. **Given** a server with no built app, **When** the developer runs `zekno doctor` with no terminal, **Then** its plain output for that server is as before.

---

### User Story 10 - Old and new programs say what to do (Priority: P2, steps 1 and 2)

Builds need a runner that builds. A zekno of this feature that meets an older runner with a deploy that builds stops before signing and says to update the runner. Deploys without a build work as before on any runner. A zekno from before this feature that meets the new runner stops before signing, as feature 014 decided.

**Why this priority**: Runners are updated by hand, one server at a time. Today's servers run 0.1.1, which does not build.

**Independent Test**: Run this feature's zekno against runner 0.1.1, and the zekno that carries 0.1.1 against this feature's runner, and check each scenario below.

**Acceptance Scenarios**:

1. **Given** a server running runner 0.1.1, **When** a deploy builds, **Then** nothing is signed, and one sentence says to update the runner. Draft: ``The runner on prod is version 0.1.1, too old to build from source. Run `zekno server update prod`, then run `zekno deploy` again. Nothing was signed.``
2. **Given** a server running runner 0.1.1, **When** a deploy does not build, **Then** everything is as in feature 015.
3. **Given** the new runner and a zekno from before this feature, **When** that zekno deploys any app, **Then** it stops before signing with the sentence feature 014 built for a runner that speaks a newer protocol: `The runner on prod is version 0.1.2-dev.1, newer than this zekno's 0.1.1, and speaks a newer protocol. Update zekno to deploy to prod. Nothing was signed.`
4. **Given** a runner of step 1, **When** a zekno of step 2 deploys a folder built with Railpack, **Then** it stops before signing and says to update the runner. Draft: ``The runner on prod builds with a Dockerfile, not with Railpack. Run `zekno server update prod`, then run `zekno deploy` again. Nothing was signed.``
5. **Given** an older runner handed a deploy with a build anyway, **When** it reads it, **Then** it refuses it, uses no number and runs nothing.
6. **Given** a server whose runner wrote the new state, **When** an older runner is put back by hand, **Then** it refuses every request rather than read the state wrongly. The way back is to update the runner again.
7. **Given** a runner of step 1 handed a signed Railpack build anyway, **When** it reads it, **Then** it refuses it with no number used, and never builds it another way.

---

### Edge Cases

**The folder and what is sent**

- **The Dockerfile copies a file zekno left out**, such as `.env`: the build fails at that step. The sentence names the file, why it was left out, and where its values belong.
- **`.dockerignore` lists the Dockerfile or itself**: Docker still sends both to the builder, and zekno does the same.
- **A Dockerfile with its own ignore file beside it** (named after the Dockerfile): Docker uses it in place of the folder's, and zekno does the same.
- **A folder with no `.dockerignore` that holds `node_modules` or `.venv`**: the first-deploy question proposes a `.dockerignore` (open point 1). In a later deploy, the summary warns above the warning size, and the refusal names the folder past the limit.
- **An empty folder, or one whose files are all left out**: refused before signing.
- **More files than the entry limit** (recommended: 50,000, open point 22): refused before signing, naming the folders with the most files.
- **A file zekno cannot read, or one that changes while it is packed**: the deploy stops before signing and names it.
- **A name that is not valid text, holds a control character, or is too long**: refused before signing with its place.
- **The same files checked out with other line endings, or names in another Unicode form**: they are packed as they are on disk, so the fingerprint differs between such machines. The build is the same.
- **A monorepo**: the folder to send can be above the settings file, up to the top of its git repository (open point 5).
- **A service that sets both an image and a build**, or more than 8 builds in one deploy: refused before signing.

**The build**

- **Another deploy to the same server during a build**: it waits or is told the server is busy. The sentence names the app that is building, how long it has been building, and its time limit.
- **A team list update during a build**: taken at once (open point 7). If the new list no longer lets the deploy's signer deploy to this server, the built app does not start. The deploy ends as stopped, and the app that was running keeps running.
- **Ctrl-C or a dropped connection during the upload**: no number is used. Within the same run, a cut upload resumes with the pieces the server lacks. The next deploy sends what is missing (open point 8).
- **Ctrl-C at a terminal during the build**: zekno says the build goes on on the server, and how to see how it ended. Open point 24 decides whether it can also stop it.
- **The runner restarts during a build**: the number is used, the build's leftovers are never recorded or reused, and the earlier version keeps running. The deploy is shown as not started.
- **A server whose Docker has no build plugin**, such as a distribution's own Docker package: the deploy is refused before the number is used, and `zekno doctor` says what to install.
- **A server whose Docker is older than Docker Engine 29.5**: a deploy that builds is refused before the number is used, with a sentence that names both versions. Deploys of images still work.
- **Out of memory on a small server**: a failed build, with its sentence. The server may also have stopped another program to free memory, the running app among them. The sentence and the docs say so.
- **Out of disk during the build**: the runner stops the build when free disk falls below the floor. It is a failed build, out of disk, with its sentence. The floor stops most cases before they start.
- **A Dockerfile that fixes another processor type**: the image does not match the server, and the build ends as failed with a sentence.
- **A `# syntax=` line**: the server ignores it, and the summary says so (open point 4).
- **An `ADD` of a web address or a git repository**: refused before signing when it has no checksum. One whose address names the server itself or a private address is refused even with a checksum (open point 4).
- **A base image named without a digest**: a warning in the summary, and the deploy goes on (open point 4).
- **A base image in a private registry**: it works only when the server's Docker is logged in to that registry, as for images today.
- **A Dockerfile that names another app's built image**, directly or through a build argument: refused before signing.
- **Someone re-tags a kept image on the server by hand**: the runner sees that the name leads to another image, does not use it, and builds again.
- **A build that has to run for more than two hours**: the signed limit is at most two hours; the build is stopped there.
- **A build that succeeds, and whose app then does not start or is not healthy**: the image is recorded and kept, and counts among the kept images. The outcome is as in feature 015.
- **Docker's build cache holds builds made outside Zekno**: the prune after each deploy can remove them (open point 9). The docs say so.

**Railpack (step 2)**

- **A new patch release of the language between two deploys**: Railpack resolves the version again, so the plan changes, and the code is sent and built again with no code change. The summary says why before signing (open point 25).
- **The plan's start command and the settings' start command differ**: the settings win. The summary shows which one runs.
- **Railpack's own configuration file in the folder**: Railpack reads it on the developer's machine, among the files to send. It travels with the code and is signed with it. If it makes the plan name an image zekno holds no digest for, the deploy is refused (open point 15).
- **A file left out of what is sent**: Railpack never sees it, since it runs on exactly the files zekno packs.
- **The fetch of Railpack fails** (no network, the release site down): nothing is signed, one sentence says so, and a folder with a Dockerfile still deploys.
- **Railpack cannot reach the network from this machine at a later deploy**: nothing is signed, and one sentence says that Railpack needs the network to plan the build.
- **The kept copy of Railpack was changed on disk**: it is found when checked before use, never run, and fetched again.
- **zekno is updated to a version that pins another Railpack**: the new one is fetched at the next deploy that needs it. The plan changes, so that deploy builds again.
- **"No network" for a Railpack build**: Railpack's builds download their tools, so it is not offered in this version (open point 18).
- **A fresh build with Railpack**: refused before signing until the Linux checks show that Railpack's builds honour it (open point 11).
- **The image Railpack builds runs as root inside its container, and starts through a shell**: as the hand test found. The docs say so.

**Versions**

- **A rollback to a deploy made before this feature** (an image deploy): as today.
- **A rollback from a machine whose history lacks that deploy**: as today, a rollback starts from this machine's history.
- **An older runner put back by hand after builds**: it refuses every request (User Story 10, scenario 6). The way back is to update the runner again. Restoring a runner's folder from a backup stays unsupported.

## Requirements *(mandatory)*

### Functional Requirements

**Which folders are built** (step 1; step 2 for folders with no Dockerfile)

- **FR-001**: `zekno deploy` MUST build on the server each service whose settings say to build, from the folder the settings name, with the builder the settings name.
- **FR-002**: zekno MUST never decide by itself to build. In a folder with a Dockerfile and neither a settings file nor a Compose file, at a terminal, it MUST ask once, showing the summary of what would be sent (FR-017) and the settings file it would write, and write the file on a yes (open point 3). The question MUST come first, where "Deploy from which file?" is asked today, before the questions about the key, the server and the app. "No", Esc or Ctrl-C MUST write nothing and end with today's sentence for a folder with no Compose file. In step 2 the same holds for a folder with no Dockerfile that Railpack recognises, once the person agreed to run Railpack on it (FR-060b, open point 17).
- **FR-002a**: The settings file written MUST hold one service (its name drawn on the boards, such as `web`), its build, and a port. The question MUST propose the port: the one the Dockerfile says the app listens on when it says one, or for Railpack a default. The person MUST be able to change it, give one, or say the service has none, as for a worker.
- **FR-002b**: When the folder has no `.dockerignore`, the same question MUST also propose one and show it before writing it. It is drawn from the folder's `.gitignore`, plus dependency folders such as `node_modules` and `.venv`. The same yes writes it (open point 1).
- **FR-002c**: After the first deploy of a settings file zekno wrote, the result MUST say how to reach each built service that has a port and no domain. Draft: `web listens on 3000 inside prod. Give it a domain with zekno domain add <domain>, then deploy again.`
- **FR-003**: With no terminal, a folder with no settings file and no Compose file MUST deploy nothing and stop exactly as today, with today's sentence and exit status. Nothing is fetched or run.
- **FR-004**: Only a file named exactly `Dockerfile` at the top of the folder MUST count as the folder's Dockerfile. There are several Dockerfiles when a `Dockerfile` stands beside a file whose name starts with `Dockerfile.`, or when a `Dockerfile` is in a sub-folder that is sent. Then zekno MUST NOT choose one. The settings name it, or the person chooses in the first-deploy question and the choice is written to the settings.
- **FR-005**: A folder with a Compose file, or a settings file whose services run images, MUST deploy as today, unless its Compose file asks Docker to build or names the space kept for built images (FR-075, FR-077). A Dockerfile in it changes nothing.

**The settings file** (steps 1 and 2)

- **FR-006**: A service in the settings file MUST be able to say that it is built, in place of naming an image to run. A service MUST have exactly one of the two. The refusal "Building from source is not in this version of zekno yet." MUST go.
- **FR-007**: The build settings MUST sit in the sections a Railway user knows (open point 18): the folder to send under Source, and the builder and the Dockerfile's path under Build, with the other settings the first version offers (recommended: the Dockerfile's stage, a time limit, and the network for the build).
- **FR-008**: The builder MUST be a choice between named values: a Dockerfile in step 1, then Railpack in step 2. A value this zekno does not know MUST be refused with a sentence that says to update zekno.
- **FR-009**: Paths in the build settings MUST be relative and MUST be checked when the file is read. The folder to send MUST be the settings file's folder, one inside it, or one above it up to the top of the git repository the settings file is in, never beyond. Outside a git repository, it MUST be the settings file's folder or one inside it (open point 5). A path beyond that reach, or one that passes through a link that leads out of it, MUST be refused with a sentence that names the setting.
- **FR-010**: The time limit MUST be a number of seconds from 1 to 7,200, the signed bound. Left out, it MUST be 1,800 seconds (recommended, open point 22).
- **FR-011**: `zekno settings`, `zekno settings set` and `unset`, `zekno settings compose`, `zekno settings init` and the settings screen MUST show and change build settings as they do other settings. Setting a build on a service that runs an image MUST replace the image as one change, shown on one change line. Setting an image on a built service MUST replace the build the same way. In a folder with a Dockerfile, and in step 2 a folder Railpack recognises once the person agreed to run it, `zekno settings init` MUST offer to build the folder instead of asking for an image, with the same port question as the first deploy. The Compose text printed MUST still equal, byte for byte, the text signed.
- **FR-012**: Two services built from the same folder with the same recipe and builder MUST share one build. The code travels once and is built once.

**What is sent** (step 1, used by step 2)

- **FR-013**: zekno MUST pack the folder on the developer's machine, choosing files by the rule open point 1 decides. Recommended: what Docker would send from this folder, with `.dockerignore` applied by zekno itself, so that what is signed is what is built.
- **FR-014**: zekno MUST never follow a link out of the folder. Links MUST NOT travel: each one is left out and listed as left out.
- **FR-015**: The `.git` folder and the files on zekno's list of secret-looking files MUST be left out unless the settings name them, and MUST be listed as left out (open point 2). The list holds `.env` and `.env.*` at any depth, `.npmrc`, `.netrc`, `.git-credentials`, and files whose name or content marks a private key. The plan may add names to it, and the docs show it.
- **FR-015a**: A file on that list that the settings name MUST be sent only after the person agrees to it at a terminal, once per file. The answer MUST be remembered on this machine, never in the folder. With no terminal, such a file MUST be sent only when this machine already allowed it. Otherwise the deploy MUST stop before signing and name the file.
- **FR-015b**: At a terminal, the first deploy that builds from a folder on this machine MUST show the summary and wait for a yes before signing. In a folder with no settings file, that is the yes of FR-002.
- **FR-016**: The same files MUST give the same packed bytes and fingerprint on every machine. For a Dockerfile, they MUST give the same build key and image name. For Railpack, they MUST give the same key and image name when Railpack makes the same plan. Order, times and owners are fixed, and a file is either plain or executable, nothing else.
- **FR-017**: Before signing, zekno MUST show a summary of what it will send: the number of files, the total size, the largest folders, what was left out and by which rule, and every file on the list of FR-015 that is sent, and why. With no terminal, the same facts MUST be given as plain lines on standard error, and standard output MUST keep only today's result line.
- **FR-018**: A pack over the size a deploy can carry (512 MiB, from the design) or over the entry limit (recommended: 50,000 files and folders, open point 22) MUST be refused before signing. One sentence names the size or the count, the limit, and the largest folders or the folders with the most files. Above a warning size (recommended: 100 MB, open point 22), the summary MUST warn and name the largest folders.
- **FR-019**: A file zekno cannot read, or one that changes while it is read, MUST stop the deploy before signing with a sentence that names it.
- **FR-020**: zekno MUST keep no copy of the packed code after the deploy (design, Q11).

**What is signed** (step 1, for both builders)

- **FR-021**: A deploy that builds MUST be signed with everything the developer's machine can fix that decides the image. That is the code's fingerprint and size, and the fingerprint of each sealed piece. It is the recipe: the Dockerfile's path and stage, or Railpack's plan. It is the builder: its name, and for Railpack its exact version and the digests of its frontend and of every image its plan names. It is the network choice and the time limit. And it is a request for a fresh build, when the person asks for one (open point 11).
- **FR-021a**: A fresh build MUST fetch every base image again and reuse no cached step, every time it is asked for. A fresh build whose record shows that a cached step was used MUST end as failed. After it, every later deploy of the same code and recipe MUST run the fresh image or one built later, never an image built before it, except a rollback that names that earlier deploy. Where the checks of FR-089a show that a builder cannot honour a fresh build, zekno MUST refuse a fresh build with that builder before signing, with a sentence (open point 11).
- **FR-022**: The build's key MUST be made from the code's fingerprint, the recipe (the Dockerfile's path and stage, or Railpack's plan), the builder (its name, and for Railpack its version and the digests of its frontend and images) and the network choice, and from nothing else but what FR-021a needs. The fingerprints of the sealed pieces, the size and the time limit are signed, but MUST NOT change the key. The key MUST name the image the signed Compose text runs, under a name no registry can answer for. Changing any part of the key MUST change the key.
- **FR-023**: The runner MUST compute the key again from what is signed, and refuse a deploy whose signed key differs, with no number used.
- **FR-024**: The signed format MUST name each build's builder, so that a later builder (Cloud Native Buildpacks, D5) adds a value, not a new format. This changes the shape of the build entry feature 014 reserved, which no released runner carries out. The signed format of step 1 MUST already hold the Railpack builder's entry: its version, the digests of its frontend and images, and the plan's fingerprint. Step 2 adds behaviour and a protocol number, not a field.
- **FR-025**: zekno MUST check a deploy that builds against the runner's rules before signing, so that it never signs what the runner would refuse as malformed.

**Sealed for the server** (step 1)

- **FR-026**: The code MUST be sealed on the developer's machine for the server's key, taken from the signed team list, in pieces, over SSH as well. A machine other than the server MUST be unable to open it.
- **FR-027**: Railpack's plan MUST travel sealed with the code. Of a build, a relay MUST be able to read no more than: the Dockerfile's path and stage, the builder and its version, the digests of its frontend and images, the network choice, the time limit, a request for a fresh build, the sizes, the number of pieces, the fingerprints and the build key. The builder's output is not among what a relay may read. When deploys go through the hosted service, it MUST travel sealed for the deployer, or not at all.
- **FR-028**: The runner MUST take a piece only for a signed deploy that can still run and that names that piece, within the design's staging bounds (2 GiB in all, kept at most 24 hours).
- **FR-029**: Before the number is used, the runner MUST check each build it does not keep: every piece is there, each opens, and the opened bytes have the signed size and fingerprint. Each piece MUST open to at most its bound, and the runner MUST stop reading a piece at its bound. A missing or wrong piece MUST be refused with no number used. zekno MUST then send what is missing.
- **FR-029a**: Each piece MUST be compressed before it is sealed. The code's fingerprint MUST stay that of the uncompressed code, so it is the same on every machine. When pieces are missing, the runner MUST say which, so that zekno sends only those within the same run (open point 8).
- **FR-030**: While it checks the code, the runner MUST accept only the one form zekno makes. Entries are plain files and folders. Names are valid text and relative, with no `..`, no empty part and no control character, each once, in the one order zekno writes them. Modes, owners and times are the fixed ones, and the code ends where its form says it ends. Anything else MUST be refused before the number is used.
- **FR-031**: Nothing opened from the code MUST be written to the runner's own folder, which holds its key, its state and its records. That folder MUST hold only sealed pieces.
- **FR-031a**: The builder's output MUST go only to the zekno that sent the deploy, in its session. The runner MUST keep none of it. Its record of a build MUST hold the outcome and its reason, never the builder's lines.

**How the server builds** (step 1; Railpack in step 2)

- **FR-032**: The runner MUST start every build in one fixed way, written in its own code. Only the signed recipe, builder, network choice, time limit and fresh-build request change it.
- **FR-033**: A build MUST never be given the host's network, the server's devices, steps that run outside the builder's sandbox, the server's SSH keys or connections, any file of the server beyond the code sent, any other source beside the code sent and, for Railpack, its signed frontend and images, or a way to write its output anywhere but the server's Docker images. A test MUST fail if the runner's way of building ever asks for one of these.
- **FR-033a**: The program that starts a build MUST run in an environment the runner fixes. That environment MUST hold no variable and no secret of the deploy.
- **FR-034**: The runner MUST choose itself the program that reads the recipe. For a Dockerfile, it is the one built into the server's Docker (open point 4). For Railpack, it is the frontend whose digest is signed. Neither a deploy nor a file in the folder MUST be able to choose another.
- **FR-034a**: The runner MUST refuse a build, before the number is used, on a server whose Docker is older than the oldest version on which FR-034, FR-035 and FR-061 were shown to hold. Until the Linux checks of FR-089 say otherwise, that is Docker Engine 29.5 (research, part 8, claim 1). zekno MUST stop such a deploy before signing wherever it already knows the server's Docker version. One sentence names the server's Docker version, the version needed and how to update (draft in User Story 9). Deploys of images MUST still work there.
- **FR-035**: Each app's build cache space MUST be its own, so that one app's build cannot read or fill another app's cached folders.
- **FR-036**: No build argument MUST reach a build except those the runner sets for FR-034 and FR-035, and those open point 19 may add, signed. Settings of the server's own Docker client, such as proxy settings, MUST NOT add any. Names the builder reads as instructions to itself MUST be refused wherever a deploy sets a name. Private base images MUST still work when the server's Docker is logged in to their registry, as images do today.
- **FR-037**: In this feature, no secret of the deploy MUST reach a build: not its steps, and not the program that starts it (open point 19). If secrets for builds come later, each MUST reach a build only as a mounted secret, under a name the runner picks, never as a build argument.
- **FR-038**: The network choice MUST be applied as signed. The summary and the docs MUST say that "none" covers the build's own steps only: the builder still fetches base images, and for a Dockerfile, files named by a web address.
- **FR-039**: A build MUST be stopped at its signed time limit. The outcome is then a failed build. The deploy lock and the free-disk check MUST hold until no step of the build still runs on the server.
- **FR-040**: A build MUST NOT start when free disk on the server is below a fixed floor. The floor MUST be checked before the number is used, and a deploy below it refused with no number used. The runner MUST also stop a build whose run brings free disk below the floor. The outcome is then a failed build, out of disk. The floor is a fixed number that the plan confirms from the measurement of FR-089, and the tests use it (recommended: 2 GiB, open point 22).
- **FR-041**: A built image whose processor type is not the server's MUST end the build as failed, with a sentence that says so.
- **FR-042**: zekno MUST refuse before signing a Dockerfile that names an image in the space Zekno keeps for built images, so that one app cannot build from another app's image, which holds that app's code. zekno MUST read every place a Dockerfile names an image as Docker reads it: every base image, every copy from another image and every mount taken from another image, with build argument defaults, the escape line and heredocs. It MUST resolve each name fully before signing. A name it cannot resolve fully MUST be refused, not passed.
- **FR-042a**: The summary MUST say when the Dockerfile has a `# syntax=` line, which the server ignores (FR-034). zekno MUST refuse before signing an `ADD` of a web address or a git repository that has no checksum. It MUST also refuse an `ADD` whose address names the server itself or a private address, even with a checksum. It MUST warn in the summary on a base image named without a digest (open point 4).
- **FR-043**: A failed build MUST use the deploy's number. The runner MUST change nothing of the app that was running: it does not stop, replace or re-route it, and its routes and domains stay as they were. The runner MUST NOT record an image from a failed or stopped build, so it is never reused.
- **FR-043a**: The docs and the out-of-memory sentence MUST say that a build shares the server's memory, processor and disk with the apps already running. They MUST say that a build that runs out of memory can make the server stop other programs, the running app among them (open point 9).
- **FR-044**: A deploy that builds MUST hold the server's deploy lock, so other deploys to that server wait or are told the server is busy. The busy sentence MUST name the app that is building, how long it has been building, and its time limit. A team list update, and an upload for a later deploy, MUST NOT wait for a build (open point 7). When a team list taken during a build no longer lets the deploy's signer deploy to this server, the built app MUST NOT start. The deploy then ends as stopped, its number used, the app that was running keeps running, and the sentence names the team list version.
- **FR-045**: When the connection to zekno drops during a build, the build MUST go on to its end, and its outcome and reason MUST be recorded. `zekno status` MUST show them. Leaving zekno at a terminal during a build MUST say that the build goes on, and how to see how it ended.

**Railpack builds on the server** (step 2)

- **FR-046**: For a Railpack build, the runner MUST write the code out as a folder, since Railpack cannot read it any other way (research, R4). It MUST do so only after every check of FR-029, FR-030 and FR-049a has passed.
- **FR-047**: That folder MUST be new and empty for each build, in a place apart from the runner's own folder, and readable by no other user of the server.
- **FR-048**: While writing it, the runner MUST create only plain files and folders with the fixed modes, never with a set-user or set-group mode. It MUST never follow a link, never replace an entry that exists, and stop at the signed size and the entry limit.
- **FR-049**: The builder MUST be given that folder and the signed plan, and nothing else of the server's files. The plan MUST be kept outside the folder of code. A file in that folder MUST NOT act as a setting of the program that starts the build, such as an ignore file or a build policy.
- **FR-049a**: Before the number is used, the runner MUST check that the plan has its signed fingerprint, and that it names only the signed frontend and images, each by digest. Anything else MUST be refused with no number used.
- **FR-050**: That folder MUST be deleted when the build ends, whatever the result. A folder left by a runner that stopped part way MUST be deleted before the next build.

**Railpack on the developer's machine** (step 2)

- **FR-051**: zekno MUST carry, for the one Railpack version it pins, the checksum of Railpack's file for each system zekno runs on, and the digests of its frontend and of the images its plans name. The maintainer MUST establish them before the version is pinned: from the release's checksum file, and its build attestation when Railpack publishes one, fetched over two networks and compared, then recorded in a reviewed change (maintainer step M3).
- **FR-052**: The first time a deploy needs Railpack, zekno MUST fetch that version from Railpack's own release, and keep it only when it matches the checksum zekno carries. The checksum MUST never come from the place the file came from.
- **FR-053**: A copy that does not match MUST never run and MUST be deleted, with one sentence, and nothing is signed. A mismatch on a fresh fetch MUST say that the file on Railpack's release is not the one this zekno pins. A kept copy MUST be checked again before each use. One that changed on disk MUST be fetched again, with a sentence of its own.
- **FR-054**: zekno MUST never use a Railpack the person installed, or one found on the machine's search path. The developer installs nothing by hand.
- **FR-055**: What was fetched, from where, and that it matched MUST be said (open point 12). With no terminal, that line MUST go to standard error. Every deploy with the Railpack builder MUST run Railpack on this machine, which needs the network. When Railpack cannot reach it, the deploy MUST stop before signing with one sentence that says so. The docs MUST say plainly that Railpack runs on the developer's machine, reads the files to send, and reaches the network to find versions.
- **FR-056**: zekno MUST run Railpack on exactly the files it packs, not on the folder as it is on disk. Railpack's arguments and environment MUST hold no secret value and no key.
- **FR-057**: On a system for which zekno carries no Railpack checksum, a deploy with the Railpack builder MUST stop before signing with a sentence that says so.
- **FR-058**: When Railpack cannot make a plan, zekno MUST stop before signing with Railpack's reason (open point 14).
- **FR-059**: Before signing, the summary MUST show a short form of the plan: the language and its version, the install, build and start commands, and the images it names. A command MUST print the whole plan, as `zekno settings compose` prints the Compose text (open point 13). The summary MUST say when the plan changed since the app's last deploy, and why when it is known, such as a new patch release of the language.
- **FR-060**: A plan that names an image zekno holds no digest for MUST be refused before signing (open point 15).
- **FR-060a**: When the folder has no lockfile, the summary MUST warn that the server may install other versions than the developer tested, and the deploy goes on (open point 16).
- **FR-060b**: In a folder with no Dockerfile, no settings file and no Compose file, zekno MUST ask at a terminal before it fetches or runs Railpack, and say what will happen (open point 17). With no terminal, it MUST fetch and run nothing.

**When nothing changed, and rollback** (step 1)

- **FR-061**: When the runner keeps an image under a build's key, and the image under that name is still the one it recorded, it MUST reuse it, within the rule of FR-021a: no code is sent and nothing is built.
- **FR-062**: The runner MUST never trust an image's name alone. When the name leads to another image, it MUST ask for the code and build.
- **FR-063**: A rollback to a deploy that built MUST carry that deploy's builds, so that the kept images are reused.
- **FR-064**: When the server no longer keeps a build a rollback needs, the rollback MUST be refused with no number used. zekno MUST say that the old code is no longer on the server, and how to go back. A rollback MUST never build again by itself.
- **FR-065**: This machine's history MUST keep, for each accepted deploy, what a rollback needs to carry its builds.

**What the runner records, and disk** (step 1)

- **FR-066**: For each build, the runner MUST record the image's id, the builder and its version, the server's Docker version and the version of the builder inside it, the program that read the recipe (for Railpack, its frontend's digest), whether the builder's cache was used, and the digests of the base images where it can learn them. `zekno status` MUST show them as the server's word, not as something signed.
- **FR-067**: The runner MUST always keep the images of the deploy an app runs now. Beside them, it MUST keep the images of the two most recent other deploys of the app whose builds succeeded, counting once the deploys that reused the same images. A failed build, and a deploy that reused kept images, MUST never push an image out. The runner MUST remove older images it made, found from its own records, never from a list of every image on the server.
- **FR-068**: The runner MUST bring the builder's cache within a bound after each deploy (10 GiB in the design; open point 9). The docs MUST say that this covers builds made outside Zekno on the same server.
- **FR-069**: Staged pieces MUST be cleaned as the design says: at most 2 GiB in all, none older than 24 hours, none of a deploy that can no longer run.

**What a person sees** (steps 1 and 2)

- **FR-070**: The deploy's stage row MUST gain a build stage between Sent and Starting (draft name: Built). It MUST show the upload's progress, then the builder's latest line, or that the image was kept and nothing was sent. The terminal app's deploy screen MUST show the same.
- **FR-071**: A failed build MUST be said in one sentence: that the build failed, why when it is known (a step failed, out of memory, out of disk, the time limit, the wrong processor), and which deploy still runs, or that none runs yet. The step that failed and the error the builder gave for it MUST follow in the "Docker said" panel, then the builder's last lines (recommended: 40, open point 22).
- **FR-071a**: At a terminal, zekno MUST keep the whole output of each app's last build on this machine, replacing the one before, and the failure sentence MUST say how to read it (open point 23). With no terminal, the builder's lines MUST go to standard error as they come, as Docker's lines do today.
- **FR-071b**: With no terminal, a failed build MUST end with the exit status of a deploy whose app did not start. `--json` MUST give a failed-build outcome with its reason (draft name: `build_failed`), as feature 015 added `routes_failed`. Every new refusal of a deploy MUST end with exit status 1, as a fault in the settings does. A new setting value that `zekno settings set` refuses MUST end with exit status 2, as other values do.
- **FR-072**: The summary MUST say what the signature does not fix, naming what applies to the builder: for a Dockerfile, base images named by tag and what its steps download; for Railpack, the packages and language tools its steps download. When a built service has variables or secrets, the summary MUST also say once that the build does not see them, and only the running app does (open point 19). How often the summary says these is decided on the boards. The docs MUST also name the server's builder version, base images already on the server, and steps reused from the server's build cache, which every app on the server shares.
- **FR-072a**: For a built service with a port, zekno MUST set a plain variable `PORT` to that port, unless the settings set `PORT` themselves. The summary and the Compose text MUST show it. Services that run an image MUST NOT change (open point 20).
- **FR-073**: Every new refusal and failure MUST have one sentence in the house pattern: what happened, what it means, what to do.
- **FR-074**: With no terminal, every existing command MUST behave exactly as before for apps that do not build, with one stated exception. A hand-written Compose file that asks Docker to build, and a Compose file or settings file that names the space kept for built images, are refused before signing (FR-075, FR-077). Such files are signed and sent today. This is a security change the maintainer approves under open point 6. Otherwise the frozen transcripts of plain output MUST NOT change.

**Hand-written Compose files** (step 1)

- **FR-075**: zekno MUST refuse before signing a hand-written Compose file in which a service asks Docker to build, with a sentence that says how to build with Zekno (open point 6).
- **FR-076**: The runner MUST start every app in a way that never builds an image from the Compose text, whatever the text says.
- **FR-077**: zekno MUST refuse before signing a hand-written Compose file or a settings file that names an image in the space Zekno keeps for built images.

**zekno doctor and zekno status** (step 1; Railpack's line in step 2)

- **FR-078**: `zekno doctor` MUST say, for each server that holds a built app, and for every server when asked to check builds, whether it can build. That covers a runner that builds, Docker's build plugin, Docker at least the version FR-034a names, free disk above the floor, the server's memory with a warning below the figure of open point 22, and the processor type. Its plain output for other servers MUST stay as before. A server that cannot build MUST still deploy images as before.
- **FR-079**: On the same servers, `zekno doctor` MUST show the disk Zekno's builds take. On this machine, once it has fetched Railpack or when asked, it MUST say whether the pinned Railpack is there and matches its checksum.
- **FR-080**: `zekno status` MUST show, for an app built on the server, that it was built, with which builder, when, and the record of FR-066.

**Old and new programs** (steps 1 and 2)

- **FR-081**: The protocol number MUST go up by one with step 1, and again with step 2, so that zekno knows before signing which builders a runner carries out.
- **FR-082**: zekno MUST stop before signing a deploy whose build the runner cannot carry out, and say to update the runner (drafts in User Story 10). A deploy without a build MUST behave as today on every runner.
- **FR-083**: A runner MUST refuse, with no number used, a build whose builder it does not carry out, whatever the shape of its build entry. It MUST never build it with another builder. A test MUST show this for runner 0.1.1, and for a runner of step 1 handed a signed Railpack build.
- **FR-084**: A zekno from before this feature MUST stop before signing against the new runner, with the sentence feature 014 built for a runner that speaks a newer protocol. That behaviour does not change.
- **FR-085**: An older runner put back by hand after this feature's runner wrote its state MUST refuse every request rather than read that state wrongly, as feature 014 made it. The docs MUST say that the way back is to update the runner again. A server updated from runner 0.1.1 MUST keep its apps, routes and domains working.

**Docs, review, release**

- **FR-086**: The docs MUST gain a page on building from source. It covers both builders; what is signed, and what is not; what lands on the server in plain text; that a build shares the server's memory, processor and disk with the apps already running, and that one out of memory can make the server stop other programs, the running app among them; that what the builder prints can quote the code, and anything a step prints; that the list of secret-looking files is a convenience, not a guarantee; and that an image Railpack builds runs as root inside its container. The pages on settings, deploying, rollback, doctor and security MUST say what changes. Neither the desktop app nor the dashboard is named.
- **FR-087**: The README's "What works today", its security model and its roadmap MUST be brought up to date. The security model MUST say what is new: the server holds the code in plain text, in Docker's storage and in the image; what a build downloads is not fixed; a build shares the server's memory with the running apps; what the builder prints can quote the code; and what a relay would learn of a build. It MUST also say: Railpack, at the version zekno pins, and its frontend are trusted as zekno is. Railpack runs with the developer's own rights on the machine that signs, and its plan decides what the server runs. The checksum makes every machine run the copy the maintainer approved. It does not make that copy safe.
- **FR-088**: An independent security review MUST cover the new surface before each step is merged: packing, sealing and sending the code; the runner's checks; the way it builds; the Railpack folder; kept builds and pruning; the Railpack fetch; and the rule on Compose files.
- **FR-089**: The first step of the plan MUST run, on Docker on Linux and on both of Docker's image stores, the checks the research lists as not established, before the plan relies on them (research, part 6, "To try"). They MUST include: what runner 0.1.1 does with a signed Compose file that asks for a build; the checks of FR-034, FR-035 and FR-061 on Docker Engine 29.5, the oldest version FR-034a allows, and on an older engine; whether the builder stops when the program that started it goes; an out-of-memory build on a 1 GB server while an app runs there; the disk a 512 MiB build uses, which sets the floor; that private base images work with the server's registry logins while the client's proxy settings stay out of builds; and the upload times of SC-003. The docs MUST say what was found.
- **FR-089a**: The first step of step 2's plan MUST run the Railpack checks on Linux: the pinned frontend on both image stores; a plan made on macOS, built on a Linux x86-64 server; whether Railpack makes the same plan on macOS and on Linux; whether "no network" and a fresh build reach Railpack's steps (R10); the checks of FR-049 and FR-049a; and that Railpack's release has a file for each system zekno carries a checksum for.
- **FR-090**: Each step MUST end with a runner development release (0.1.2-dev.N) and a proof on a real server (open point 21). Release numbers stay in the 0.1 line. Tags, releases, merging into `main` and every use of the maintainer's server are the maintainer's steps, each with a go-ahead.
- **FR-091**: No package or tool MUST be added without the maintainer's agreement. The Railpack version zekno pins is approved by the maintainer.
- **FR-092**: Every new or changed line a person sees MUST be approved by the maintainer on boards before it is built. Every sentence quoted in this spec is a draft.
- **FR-093**: Every sentence MUST keep the project's wording rules: "runner", never "agent"; pre-alpha and unaudited stay visible; nothing is promised that is not built.

### Key Entities

- **Build**: one service's image, built on the server from the code sent, with a builder and a recipe. Signed.
- **Code sent (the pack)**: the folder's files as zekno packed them, the same bytes for the same files on every machine. It has a fingerprint and a size, and travels in sealed pieces.
- **List of secret-looking files**: the names and contents zekno leaves out unless the settings name them, and sends only after a yes on this machine. A convenience, not a guarantee.
- **Summary**: what zekno shows before signing: files, size, largest folders, what was left out and why, every secret-looking file sent and why, and what the signature does not fix.
- **Builder**: a Dockerfile, read by the server's own Docker; or Railpack, at an exact version, with its frontend (the program the server's Docker runs to read Railpack's plan) and the images its plan names, each by digest. Cloud Native Buildpacks come later as a third value.
- **Recipe**: for a Dockerfile, its path and stage; for Railpack, the plan.
- **Build plan**: what Railpack wrote on the developer's machine about how to build the files sent. Fixed by the signature, and sealed with the code.
- **Build key**: made from the code's fingerprint, the recipe, the builder and the network choice. It names the image the Compose text runs. The time limit, the size and the sealed pieces are signed but not in it.
- **Fresh build**: a build the person asked for, made with no cached step and fresh base images. No later deploy of the same code and recipe runs an image built before it.
- **Kept build**: an image the runner keeps for the deploy an app runs, or for one of the two most recent other deploys whose builds succeeded, with the image id it recorded.
- **Build record**: the outcome and its reason, the image id, the builder's version, the server's Docker version and the version of the builder inside it, the program that read the recipe, whether the cache was used, and the base images' digests. The server's word, never signed. Never the builder's lines.
- **Railpack copy**: the pinned version of Railpack on the developer's machine, with the checksums zekno carries for it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (step 1): A person with a folder whose Dockerfile builds on their own machine, and a server with the new runner, gets the app running with one `zekno deploy` and one answer, with no registry, no image built by hand and no file edited by hand. This holds also when the folder holds a `node_modules` and no `.dockerignore`.
- **SC-002** (step 2): A person with a Node folder that has no Dockerfile gets it running with one `zekno deploy` and two answers (to run Railpack, then to write what it found), with nothing installed by hand on their machine or on the server, and no file edited by hand.
- **SC-003** (step 1): Over an upload of 10 Mbit/s with 50 ms of latency, zekno's own work before the build starts (packing, the summary, sealing and sending) takes under 30 seconds for a 10 MB folder and under 150 seconds for a 100 MB folder. The plan measures both (FR-089).
- **SC-004** (steps 1 and 2): A second deploy with no change to the code, the recipe or the builder, and for Railpack with the same plan, sends 0 bytes of code and starts no build, in every test.
- **SC-005** (step 1): In every test of a failed build (a failing step, the time limit, free disk falling below the floor during the build, the wrong processor, out of memory), the runner does not stop, replace or re-route the app that was running. In every such test but out of memory, run with an app that writes to disk, that app keeps answering and writing, and its routes are unchanged.
- **SC-006** (steps 1 and 2): A change to any byte of the code, a piece, the recipe, the plan or the builder after signing is refused with no number used, in every test.
- **SC-007** (steps 1 and 2): A marker string placed in a file of the folder never appears in the sealed pieces, in the signed deploy, or in the runner's own folder, in any test.
- **SC-008** (step 1): No build in any test is given the host's network, the server's devices, steps outside the sandbox, the server's SSH keys, other files of the server, another source, a variable or secret of the deploy, or another output.
- **SC-009** (step 1): A hand-written Compose file that asks for a build signs nothing with the new zekno, and the new runner builds nothing from Compose text, in every test.
- **SC-010** (step 1): Every deploy that builds shows its summary before signing, every folder over the limit signs nothing and names its largest folders, and no file on the list of secret-looking files is sent without a yes on this machine, in every test.
- **SC-011** (step 2): A Railpack file whose checksum does not match is never run, in every test, and zekno never runs a Railpack it did not fetch and check.
- **SC-012** (step 1): After any number of built deploys, failed builds and reused images, the server keeps the images of the deploy each app runs and of at most two other deploys per app, and the build cache is within its bound after each deploy. No build starts, or goes on, below the free-disk floor.
- **SC-013** (step 1): The code of one folder packs to the same fingerprint on macOS and on Linux.
- **SC-014** (steps 1 and 2): Every pairing of a zekno and a runner, older or newer, either works or stops before signing with a sentence that names what to update. None falls to a general sentence.
- **SC-015** (steps 1 and 2): Every approved sentence comes out of the real program word for word, at a terminal, in the terminal app and with no terminal. Every earlier test passes, and the frozen plain transcripts are unchanged but for the exception of FR-074.
- **SC-016** (steps 1 and 2): On a real Linux server, for each step: a folder deploys and answers; a deploy with no change sends nothing; a failed build leaves the app answering; a rollback reuses the kept image; nothing of the proof is left afterwards.
- **SC-017** (steps 1 and 2): The independent security review of each step ends with every finding answered, and none critical or high left open.
- **SC-018** (step 1): On a server whose Docker is older than the version FR-034a names, no build runs, in every test, and deploys of images still work.
- **SC-019** (step 1): After a fresh build, no later deploy of the same code and recipe runs an image built before it, in every test, except a rollback that names that earlier deploy.

## Assumptions

### What was run, and what rests on documentation only

Run:

- **Railpack 0.43.1, by hand, on macOS on ARM64** with Docker Desktop 29.6.1 (its built-in builder, the containerd image store), on 2026-11-26 (research, part 2). Railpack made a plan on the developer's machine in about 6 seconds, reaching the network. It made the same bytes twice. Its frontend refused the code as an archive on standard input. A build from a folder worked with Docker's own builder. The frontend named by digest worked, and so did the plan's two images rewritten to digests. A plan of 0.43.1 with the frontend of 0.44.0 worked for one app. The image ran as root, through a shell. Asking for no cache was not honoured on that builder, so whether "no network" and a fresh build reach Railpack's steps is not known. Nothing was run on Linux or on a server.
- **The design's review checks D1 to D14** (macOS, Docker 29.6.1, Docker Compose v5.3.0): a build from an archive on standard input with the Dockerfile's path inside it; a link inside that archive to a server file did not reach it; an image under the reserved name is never pulled; and any image can be put under that name. No step that runs a command, no base image, no `# syntax=` line and no build secret were tried there.
- **Measured in this repository**: its tracked files (10 MB), `node_modules` (1.4 GB), the compression of its 10.8 MB pack (2.57 MB), and that the archive writer of zekno's runtime cannot fix file times.
- **Runner 0.1.1** was proven on Linux x86-64 (Ubuntu 26.04, Docker Engine 29.8.2, Compose 5.6.0), but no build was run there.

From documentation or from reading source code only, not run:

- That "no network" covers only a build's own steps, and that the builder still fetches base images, frontends and files named by a web address.
- That a setting Docker documents makes the server ignore a `# syntax=` line. It holds only from Docker Engine 29.5 (research, part 8, claim 1). An older engine would look for a program that does not exist, so building needs Docker Engine 29.5 or newer (FR-034a).
- That a cache space per app keeps one app's cached folders from another's.
- That Docker's builder stops a build when the program that started it goes away. Not established.
- What the image id the builder reports means on each of Docker's two image stores. It may differ between an upgraded server and a fresh one.
- That `.dockerignore` is not applied to an archive sent on standard input.
- That Docker's built-in builder allows the host's network and devices by default unless told not to.
- That proxy settings of the Docker client become build arguments, and that some secret names are used as credentials for any host.
- That a memory limit per build step works on Docker's built-in builder. It needs Docker Engine 29.6, and an older one drops it without a word.
- That Docker's build cache cannot be pruned for one app only.
- That Railpack's release has files for macOS and Linux on x86-64 and on ARM64. Only macOS on ARM64 was run.
- Whether Railpack makes the same plan on macOS and on Linux, and whether a plan made on macOS builds on a Linux x86-64 server.
- What runner 0.1.1 does with a Compose file that asks for a build. Not tested.
- What an out-of-memory build does on a 1 GB server to the apps already running there. Not tested.

### Other assumptions

- The design's limits are used as they are: 512 MiB of code per deploy, in sealed pieces of at most 8 MiB, at most 64 pieces and 8 builds per deploy, a time limit of at most 7,200 seconds per build, staging of 2 GiB kept at most 24 hours, the builds of three deploys kept per app (the one that runs and two others), and the build cache brought to 10 GiB after each deploy. The numbers this spec adds are in open point 22.
- A server builds for its own processor: Linux on x86-64 or on ARM64, as the runner supports today.
- A server that builds has Docker Engine 29.5 or newer, with its build plugin. One without either can still deploy images.
- One runner per Docker daemon, as the design assumes.
- Private base images work only when the server's Docker is logged in to their registry. zekno does not manage registry logins.
- Railpack, at the version zekno pins, and its frontend are trusted as zekno is (FR-087).
- zekno runs on macOS and Linux, the systems Railpack has files for.
- The hosted service does not exist. Nothing here goes through it; what it would learn is written down.
- Teammates are not built. Tests use stand-ins.
- Still pre-alpha and unaudited, and that stays visible.

## Out of scope

- Building in CI or on the developer's machine (the stage "deploys from CI").
- Cloud Native Buildpacks (a later step of their own) and Nixpacks.
- Building for another processor type than the server's.
- The hosted service, and carrying sealed pieces through it.
- Turning an image's tag into a digest, and sending an image to a server without a registry.
- Build arguments and build secrets, unless open point 19 decides otherwise.
- Memory limits per build (open point 9), rules on the server about allowed base images, and images for several processor types.
- Stopping a running build from zekno, unless open point 24 decides otherwise.
- Keeping the builder's output on the server (open point 23).
- Pre-deploy commands: they stay refused, as in feature 015.
- Deploys on a git push, and watch paths.
- Removing an app, and restoring a runner's folder from a backup.

## Open points for the maintainer

Each point has a question, the options, a recommendation and the reason. Points 1 to 11 belong to step 1, points 12 to 17 to step 2, and points 18 to 21 to both. Points 22 to 25 were added after the three reviews, each with its step. Points 1, 3, 4, 6, 7, 8, 9, 10 and 18 come from the research's part 4. Its point "direction" was settled by D1. Where two reviews pulled opposite ways, the spec keeps the safer reading, and the point says so (points 9 and 23).

### Step 1

**1. Which files are sent** (step 1). When zekno packs a folder, which files go in?
- (a) What `docker build .` would send from this folder: every file except what `.dockerignore` lists, with `.git` and secret-looking files left out unless named (point 2).
- (b) Git's view: tracked files and new files git does not ignore, then `.dockerignore`.
- (c) The last commit only, so uncommitted edits are left out, as Kamal does.
- (d) As (a), but with no `.dockerignore`, the folder's `.gitignore` rules apply, and the summary says so.

**Recommended**: (a), with the summary before signing and the size refusal. When the folder has no `.dockerignore`, the first-deploy question also proposes one, drawn from the folder's `.gitignore` plus dependency folders such as `node_modules` and `.venv`. It shows it, and the same yes writes it (FR-002b).

**Why**: It sends what the developer built and tested on their own machine. It works in a folder that is not a git repository. It keeps build output that git ignores and a Dockerfile may copy, such as `dist/`. Git's view drops that output silently, and needs git. The last commit surprises anyone with uncommitted edits. A person coming from Railway, Render or Heroku expects `.gitignore` to apply: those platforms build from git, and Railway's own upload always leaves `node_modules` out. With (a) alone and no `.dockerignore`, a Node or Python folder that has run locally sends its `node_modules` or `.venv`. Over an upload of 10 Mbit/s, 400 MB takes over five minutes, and modules built on macOS can be wrong for a Linux server. The proposed `.dockerignore` gives that person what they expect, while the signed rule stays Docker's own. (d) needs no new file, but zekno's rule would then differ from what `docker build .` sends from the same folder.

**2. Files that look like secrets** (step 1). A `.env` file, a private key or a credentials file in the folder: what happens to it, and which files count?
- (a) Left out unless the settings name it, and listed in the summary. A file the settings name is sent only after the person agrees to it at a terminal, once per file, remembered on this machine, never in the folder. With no terminal, only when this machine allowed it before.
- (b) The deploy is refused until the settings name it or the ignore file lists it.
- (c) Never sent, whatever the settings say.

**Recommended**: (a). The list holds `.env` and `.env.*` at any depth, `.npmrc`, `.netrc`, `.git-credentials`, files whose name or content marks a private key, and the `.git` folder. A private key in a file's content also catches a cloud service-account key. A name such as `credentials.json` alone is not on the list, since many such files hold no secret. The docs show the list and say it is a convenience, not a guarantee.

**Why**: The design says left out unless asked. Refusing would make every folder with a local `.env` fail its first deploy. Never would break a Dockerfile that really needs a certificate file. The summary makes a left-out file visible. A Dockerfile that copies it fails at that step, and the sentence can name the file. A settings file arrives with a cloned repository, as in point 5, so it can name a `.env` that git never held. The yes per file keeps such a file from leaving this machine unseen. A summary scrolls past, so the first deploy that builds from a folder also waits for a yes after it (FR-015b).

**3. A folder with a Dockerfile and no settings file** (step 1). In a folder with a Dockerfile, no `zekno.app.json` and no Compose file, what does `zekno deploy` do?
- (a) Ask once at a terminal, then write a settings file that says to build. With no terminal, stop exactly as today.
- (b) Build at once, without asking or writing anything.
- (c) Stop with a sentence that says how to write the settings.

**Recommended**: (a). The question comes first, where "Deploy from which file?" is asked today, before the key, the server and the app. It shows the summary of what would be sent, the settings file it would write (one service such as `web`, its build and a port), and the `.dockerignore` it proposes when there is none. The port is the one the Dockerfile says the app listens on; the person can change it, or say there is none for a worker. "No", Esc or Ctrl-C writes nothing and ends with today's sentence. Count only a file named exactly `Dockerfile`. With several Dockerfiles, the question lists them, and the choice is written to the settings.

**Why**: Zekno's rule is that one file is never picked over another without the person saying so. Writing the settings means the signed file states that a build happens. Railway and Dokku pick silently, which breaks that habit. Without a port, the built app runs but nothing can reach it: a domain needs one. With no terminal, every existing command must behave as before, so today's sentence stays.

**4. Code a Dockerfile pulls in from outside the folder** (step 1). A Dockerfile can bring in what the signed folder does not hold: a frontend named by a `# syntax=` line, which would see the build's secrets; base images named by tag; and files fetched by `ADD` from a web address. How strict is the first version?
- (a) The server always uses the Dockerfile reader built into its Docker, so a `# syntax=` line is ignored. zekno refuses an `ADD` of a web address or a git repository that has no checksum, and an `ADD` whose address names the server itself or a private address even with a checksum. It warns on a base image named without a digest.
- (b) As the design says: zekno refuses an unpinned `# syntax=` line or an `ADD` of a web address only when the build reads a secret, and warns otherwise.
- (c) Strict: a digest on every base image, and a rule on the server that refuses anything else.

**Recommended**: (a). The runner records the base images' digests after each build.

**Why**: (a) is enforced by the server whatever zekno read, through a setting Docker documents. It closes the way by which a registry's frontend would read build secrets. What it costs: with (a), building needs Docker Engine 29.5 or newer on the server. An older engine lacks the setting, and every Dockerfile build would fail while looking for a program that does not exist (research, part 8, claim 1). Such a server is refused before the number is used, deploys of images still work there, and `zekno doctor` names the version (FR-034a). Many servers run an older Docker than the 29.8.2 of the runner's proof. A Dockerfile can also use only the features of the Docker on each server. zekno has to read Dockerfiles as Docker reads them, which it does not do today (FR-042). Docker itself fetches an `ADD` address from the server, so a checksum does not stop a fetch that reaches services listening only on the server's own addresses. Requiring digests would refuse most real Dockerfiles. Server-side rules of that kind are experimental in Docker and not tested on its built-in builder. The design and the research disagree on this point (research, part 5).

**5. How far the folder to send may reach** (step 1). A Dockerfile in a monorepo often needs the repository's top folder. May the settings name a folder above the settings file's own folder?
- (a) Only the settings file's folder, or one inside it.
- (b) Also a folder above it, up to the top of the git repository it is in, never beyond. Outside a git repository, as (a).
- (c) Any folder.

**Recommended**: (b). The summary names the folder sent.

**Why**: Monorepos are common, and Railway's root directory works inside one repository. A settings file arrives with a cloned repository, so it must not be able to make zekno send the person's home folder. (a) forces a monorepo to keep its settings at its top. (c) lets a cloned settings file reach anything the person can read.

**6. A hand-written Compose file that asks for a build** (step 1). How does Zekno stop such a file from building outside the rules?
- (a) zekno refuses it before signing, and the runner starts apps in a way that never builds from Compose text.
- (b) zekno turns each build in a hand-written Compose file into a signed build under the same rules as settings.
- (c) Leave it and document it. This feature's description rules it out.

**Recommended**: (a) now, (b) later if people ask. First test what runner 0.1.1 does with such a file, and say it in the docs.

**Why**: Runner 0.1.1 starts apps without forbidding Compose to build, and zekno does not check for it. Such a build's code could be a git address or a folder on the server. It would be unpinned, unrecorded, and see the deploy's secrets. (b) needs a second reader for Compose files. What (a) costs: it is the one stated exception to the rule that, with no terminal, every existing command behaves as before (FR-074). Such a file is signed and sent today, and would be refused. So would a Compose file or settings file that names the space kept for built images (FR-077). Approving (a) approves that exception.

**7. Team list updates during a long build** (step 1). A build can take up to two hours. While it runs, should the server still take a team list update, such as one that removes a stolen key?
- (a) Two locks: a team list update, and an upload for a later deploy, never wait for a build. Deploys of every app on the server still wait. A deploy whose signer the new team list no longer allows does not start its built app: it ends as stopped, and the running app keeps running.
- (b) One lock: everything waits or is told the server is busy, as today.
- (c) Builds outside any lock.

**Recommended**: (a).

**Why**: Feature 014 put the second lock off until builds make deploys long (014 spec, Assumptions, item 5). With one lock, a removed member's key keeps working for the whole build, because the update is refused. Taking the update is only half the answer: as the design stands, a deploy already accepted still finishes, so a stolen key's deploy would go live up to two hours after the key was removed. With no lock, the design's order and staging rules break (V20).

**8. How the code travels** (step 1). How should the code travel to the server?
- (a) As designed: sealed pieces of up to 8 MiB, sent one after another in the connection zekno already opens, uncompressed. A cut upload is sent again whole.
- (b) The same, but each piece compressed before it is sealed, and the server says which pieces it lacks, so a cut upload resumes within one run of zekno.
- (c) Raw bytes on a second connection.

**Recommended**: (b), decided now. Each piece opens to at most its bound, and the runner stops reading there (FR-029).

**Why**: Sealed bytes cannot be compressed, so compression must come first. Zekno's own 10.8 MB pack became 2.57 MB in 31 ms. The bound on what each piece opens to rules out a piece that opens to far more than its size. The fingerprint stays that of the uncompressed bytes, so it stays the same on every machine. No runner builds yet, so this costs no extra protocol number now; later it would. A second connection means a second login.

**9. Disk and memory on the server** (step 1). How does the runner keep builds from filling the server's disk or memory?
- (a) A free-disk floor before and during each build: a build that brings free disk below it is stopped. The build cache brought to 10 GiB after each deploy. No memory limit in the first version. The docs and the out-of-memory sentence say that a build shares the server's memory with the running apps, and can make the server stop one of them.
- (b) The same, plus a memory limit on each build step. It needs Docker Engine 29.6 and a recent build plugin. An older Docker drops it without a word, so the runner would have to check it took effect, and doctor would show it. It limits each step, not the whole build. Not tested.
- (c) No pruning by Zekno, only the floor.

**Recommended**: (a). The docs say that the prune covers every build on the server, also builds made outside Zekno. `zekno doctor` shows each server's memory and warns below a figure the plan measures (point 22).

**Why**: Docker's build cache is shared by the whole server, and Docker offers no way to prune one app's part. A memory limit per step is not tested on the builder that comes with Docker. The reviews pulled two ways on what a failed build promises. One asked to test that the running app survives an out-of-memory build. The other asked to promise only what the runner controls. The spec keeps the safer reading: the runner never touches the running app, the kernel may, and that is said plainly. The out-of-memory case is measured on a 1 GB server (FR-089), and the docs say what was found. If the measurement shows running apps are stopped often, (b) is the next step.

**10. How much of a build a person sees** (step 1). What does the deploy screen show for a build?
- (a) A build stage between Sent and Starting, with the builder's latest line under it; upload progress; a one-sentence failure, then the failing step and its error and the builder's last lines in the "Docker said" panel; and "kept, nothing sent" when nothing changed.
- (b) Only the new stage.
- (c) The whole build log in the terminal.

**Recommended**: (a), drawn on boards and agreed before anything is built.

**Why**: It extends today's stage row and "Docker said" panel. It says plainly that a failed build left the running app alone, as Render does. A full log in the terminal buries the one line that matters. Point 23 says where the whole output can be read.

**11. Building again from scratch** (step 1). The same code and recipe always reuse the kept image. How does a person build again to pick up a fixed base image or package?
- (a) An option of `zekno deploy` that signs a request for a fresh build. A fresh build fetches every base image again and reuses no cached step, every time it is asked for. Later deploys of the app never reuse an image built before its most recent fresh build, except a rollback that names that deploy. A fresh build whose record shows that the cache was used ends as failed.
- (b) Nothing in this feature: change a file or the recipe to build again.
- (c) The runner builds again whenever a base image has moved.

**Recommended**: (a). The signed field is added now, while the format changes for D4. Railpack's builds did not honour a request for no cache in the hand test (R10). Until the Linux checks show they do, a fresh build with Railpack is refused before signing, with a sentence.

**Why**: Security fixes in base images are the commonest reason to build again, and Railway, Render and Heroku all offer it. The request has to be signed, or a relay could add or drop it. A request that only changed the build's key would not last: the next deploy that changed only a secret would find the older, unpatched image still kept, and run it. A base image already on the server is also used as it is unless the build fetches it again. A field added now costs nothing; later it is a format change. (c) makes every deploy ask registries whether something moved.

### Step 2

**12. The first fetch of Railpack** (step 2). What does a person see the first time zekno fetches Railpack?
- (a) No question. One line says what is fetched, from where and how large, then that its checksum matched. With no terminal, the same line goes to standard error.
- (b) A question at a terminal before the first fetch. With no terminal, stop and say how to allow it.
- (c) A command of its own to fetch it, which a deploy asks the person to run.

**Recommended**: (a), for a deploy whose settings already chose Railpack. A folder with no settings file asks first (point 17).

**Why**: D6 says zekno fetches it by itself, and the developer installs nothing by hand. The download is pinned and checked against a checksum zekno carries, so a question would protect nothing a person can judge. The line still says plainly that a program from a third party arrived and runs on this machine.

**13. Showing the plan before signing** (step 2). Is Railpack's plan shown before the deploy is signed?
- (a) A short form in the summary: the language and its version, the install, build and start commands, and the images the plan names. A command prints the whole plan, as `zekno settings compose` prints the Compose text.
- (b) The whole plan, at every deploy.
- (c) Nothing beyond the builder's name.

**Recommended**: (a). The summary also says when the plan changed since the last deploy, and why when it is known.

**Why**: The plan decides what runs on the server, and the person signs it. It is several kilobytes, too long to read at every deploy. A new patch release of the language changes the plan by itself (Railpack turned "Node 22" into an exact version by asking the network), so a person should see why a deploy with no code change builds again.

**14. When Railpack cannot tell how to build** (step 2). What happens when Railpack cannot make a plan for the folder?
- (a) Stop before signing, with Railpack's own reason in one sentence and the two ways forward: add a Dockerfile, or set what Railpack needs in the settings, such as a start command.
- (b) Ask at a terminal for a start command, and try again.
- (c) Fall back to a default image.

**Recommended**: (a).

**Why**: Railpack's reason is the most useful fact the person can get. A guess would build something nobody chose. Questions can come later, once the common failures are known.

**15. How Railpack's frontend and images are pinned** (step 2). Railpack's plan names its frontend and its images by tag. How are they fixed?
- (a) zekno carries, with the Railpack version it pins, the digests of its frontend and of the images its plans name. It signs those, and refuses a plan that names any other image. The runner checks the plan against what is signed (FR-049a).
- (b) zekno asks the registry for each tag's digest when it signs, shows it and signs it.
- (c) Each runner release pins one frontend, and the deploy signs only the Railpack version.

**Recommended**: (a).

**Why**: The hand test pinned all three by digest, and the build worked. With (a), what the server runs is fixed by what zekno carries and the person signs, not by a registry at signing time. With (b), whoever answers for the registry decides what is signed. (c) ties every Railpack update to a runner release, and the signature would not fix the frontend. Whether a folder's own Railpack configuration can name other images is not established; until there is demand, such a plan is refused with a sentence.

**16. A folder with no lockfile** (step 2). Railpack warns when a folder has no lockfile: the server may then install other versions than the developer tested. What does zekno do?
- (a) A warning in the summary, and the deploy goes on.
- (b) Refuse until there is a lockfile.
- (c) Nothing.

**Recommended**: (a).

**Why**: Many small apps have no lockfile, and refusing would stop their first deploy. The warning says what it costs. A lockfile is also what narrows what the build downloads, which no signature can fix.

**17. A folder with no Dockerfile and no settings file** (step 2). In a folder of code with no Dockerfile, no settings file and no Compose file, what does `zekno deploy` do?
- (a) Ask first at a terminal whether to fetch and run Railpack on the folder, naming what will happen. Then show what Railpack found, the summary and the files zekno would write, and ask once more. With no terminal, fetch and run nothing, and stop exactly as today.
- (b) As (a), with no first question, but fetch and run Railpack only in a folder that holds a file marking a language Railpack knows, such as `package.json`.
- (c) Build with Railpack at once.
- (d) Stop with a sentence.

**Recommended**: (a). Draft of the first question: `No Dockerfile here. Fetch Railpack (N MB) to find out how to build this folder?` With Railpack already kept, the question says it will run it. The second question names what Railpack found, such as "a Node app".

**Why**: The same rule as for a Dockerfile: the signed settings say a build happens, and nothing is picked silently. Today `zekno deploy` in a folder opened by mistake, such as the home folder, only says there is no Compose file. Without the first question, zekno would fetch a third party's program and run it over that folder, reaching the network, before the person said yes to anything. Point 12's "no question" fits a deploy whose settings already chose Railpack, not this case. Naming what Railpack found lets the person catch a wrong guess before anything is signed.

### Both steps

**18. Which build settings, and where** (both steps). Which build settings does the first version offer, and in which sections of the settings file?
- (a) The folder to send under Source. A new Build section, as Railway shows it, with the builder, the Dockerfile's path, the Dockerfile's stage, the time limit and the network for the build (the internet, or none).
- (b) The same settings inside the Source section, in the place feature 010 reserved for builds.
- (c) Only the builder, the folder and the Dockerfile's path. Everything else later.

**Recommended**: (a). An image is not required when the service is built. For Railpack, the first version offers the builder, the folder and the time limit, with no network choice, because Railpack's builds download their tools.

**Why**: Railway shows Source (its root directory) and Build (the builder, the Dockerfile's path, a build command) as separate sections, so a Railway user looks there. The stage, the time limit and the network are already signed fields, and the design chose the internet by default with "none" offered (Q10). Today's zekno refuses either form before signing, so neither breaks an older program, but with different sentences. With (a), an older zekno gives its sentence for a setting it does not know, or for a service with no image. With (b), it keeps `Building from source is not in this version of zekno yet.` A build command for Railpack, as Railway offers, can come later. The exact names of the settings are drawn on the boards.

**19. Variables and secrets in builds** (both steps). May a build read the app's variables or secrets in the first version?
- (a) Neither: a build reads only the code.
- (b) Plain build variables named in the settings: signed, and readable by a relay. No secrets.
- (c) Secrets as well, given to the build as mounted secrets only, under names the runner picks.

**Recommended**: (a) in this stage. (b) next, when a framework needs a public value at build time. (c) when private package registries need it. The summary says once that the build does not see the app's variables (FR-072).

**Why**: Build secrets bring three problems: some names are used by the builder as credentials for any host it fetches from; a frontend would receive them; and a layer built with an old secret can be reused after the secret changed. Plain build variables are readable by the hosted service and stay in the image's history. Railway passes a service's variables to its builds, so a person coming from it may expect (b). The docs must say what is missing.

**20. The port a built app listens on** (both steps). Railway tells each app which port to listen on through a `PORT` variable, and many apps written for managed platforms read it. Does zekno do the same?
- (a) For a built service with a port, zekno sets a plain variable `PORT` to that port, unless the settings set `PORT` themselves. The summary and the Compose text show it.
- (b) Nothing: the person sets `PORT` as a plain variable when the app needs it.

**Recommended**: (a). The port comes from the settings file the first deploy writes (point 3).

**Why**: It makes the first deploy work for apps written for managed platforms, without a setting to learn. The variable is visible in the summary and in the Compose text, so nothing is hidden. Services that run an image are not changed.

**21. Releases for the two steps** (both steps). How are the two steps released?
- (a) Step 1 ends with runner 0.1.2-dev.1 and a proof on a real server. Step 2 ends with 0.1.2-dev.2 and its proof. When to release 0.1.2 is decided after.
- (b) One development release after both steps.
- (c) A prod release after step 1.

**Recommended**: (a).

**Why**: Step 1 is useful alone and smaller to review. A proof per step finds what differs on Linux before step 2 builds on it. Releases stay in the 0.1 line, and each prod release is the maintainer's call.

### Added after the reviews

**22. The numbers a test needs** (both steps). A requirement with no number cannot be tested. Which numbers does the first version use?
- (a) The values recommended here.
- (b) Other values, set by the maintainer.

**Recommended**: (a):
- the default time limit of a build: 1,800 seconds, the same 30 minutes the runner waits for an app to start; the settings can raise it to 7,200;
- the size above which the summary warns: 100 MB;
- the entry limit of what is sent: 50,000 files and folders;
- the free-disk floor: 2 GiB, raised if the plan measures that a 512 MiB build needs more (FR-089);
- the memory below which `zekno doctor` warns: 2 GB to start, then the figure the out-of-memory check on a 1 GB server supports (FR-089);
- the builder's last lines shown after a failure: 40.

**Why**: Spec 015 states its numbers (14 days, 60 seconds, 64 domains), and this spec should too. Heroku stops a build at 25 minutes, and Render allows 120. With 30 minutes, a build that hangs holds the server's deploy lock for at most that long, unless the settings raise it. Vercel allows 15,000 files per upload, and the research's proposal for the pack was about 50,000 entries. npm and pip print the cause of a failure tens of lines above the end, and the failing step and its error are shown first anyway (FR-071).

**23. Where the whole output of a build can be read** (step 1). The deploy shows the step that failed, its error and the builder's last lines. Where can a person read the whole output, when the cause is further up?
- (a) Nowhere: the runner keeps none of what the builder prints, and zekno keeps none either.
- (b) The server keeps the whole output of each app's latest build until the next build, and zekno reads it from there.
- (c) zekno keeps the whole output of each app's last build on this machine, replacing the one before, and the failure sentence says how to read it. The runner keeps none.

**Recommended**: (c).

**Why**: Two reviews pulled opposite ways. One asked that the runner keep none of the builder's output, since a compiler error quotes the code and any step can print a file. The other asked that the server keep the latest build's log, as managed platforms let a person open it. The spec keeps the safer reading: the runner keeps none (FR-031a). A log kept on the server would put code outside Docker's storage, in the runner's records, and through the hosted service later it would travel readable. This machine already holds the code, so (c) gives the person the whole log without a new place for it to leak. With no terminal, every line already goes to standard error.

**24. Stopping a build** (step 1). A build that hangs, such as an install waiting on the network, holds the server's deploy lock until its time limit, and every deploy to that server waits. Can a person stop it from zekno?
- (a) Yes: a request, signed like a deploy, stops the build on the server. The build ends as failed at the person's request, and the running app is untouched. At a terminal, Ctrl-C during the build asks whether to stop it there.
- (b) Not in this feature. The default time limit (point 22) bounds a hung build, and the busy sentence names the app that is building, for how long, and its limit.

**Recommended**: (b) in step 1, and (a) as soon as the Linux checks show that the builder stops when told.

**Why**: Railway and Render offer a cancel button, and Heroku stops a build at 25 minutes. But whether the builder stops when the program that started it goes is not established (research, part 6). A stop that said "stopped" while steps still ran would free the lock too early (FR-039). (a) also adds a signed request the runner does not have today. With (b), the 30-minute default keeps the wait short.

**25. Language versions between Railpack deploys** (step 2). Railpack asks the network for the language's latest patch release each time it plans. A new release changes the plan, so a deploy that changed only a secret sends the folder and builds again. May a deploy keep the versions of the app's last plan?
- (a) No: each deploy uses the plan Railpack makes, and the summary says why it builds again before signing.
- (b) Yes: a deploy keeps the versions of the app's last plan, unless a fresh build is asked for (point 11).

**Recommended**: (a) in step 2.

**Why**: (b) needs the last plan on every machine that deploys the app, and a teammate's machine would make another plan anyway. It also holds back patch releases, which bring fixes. Railpack can keep versions (research, part 7.5), so (b) can come later. With (a), a change of a secret can build again, but the person sees why before anything is signed, and SC-004 holds while the plan is the same.

## Maintainer steps

Each is the maintainer's, with a go-ahead at the time. They come in this order.

| Step | What |
|---|---|
| M1 | Answer the open points above. |
| M2 | Approve the boards: every new screen and line, and the new words of the README and the docs. |
| M3 | Approve the tools the plan names before they are used: the Railpack version zekno pins, and how its checksums and digests were established (the release's checksum file, and its build attestation if Railpack publishes one, fetched over two networks and compared, then recorded in a reviewed change with the digests of its frontend and images); and any package. |
| M4 | Say where the Linux checks of FR-089 and FR-089a run: a Linux Docker on this machine or in CI, or the maintainer's own server, with a go-ahead for each use. They need Docker Engine 29.5, an older engine, and a server with 1 GB of memory. |
| M5 | Step 1: merge `016-build-from-source` into `dev` after its security review, and push `dev`. |
| M6 | Push the tag `runner-v0.1.2-dev.1` from `dev`; the workflow publishes a pre-release. Run the second build and commit its checksums on `dev`. |
| M7 | The proof of step 1 on a real server, each use with a go-ahead: update the runner from 0.1.1; deploy a folder with a Dockerfile; deploy again with nothing changed; a failed build with the app still answering; a rollback to a built deploy; `zekno doctor`; clean up. |
| M8 | Step 2: merge into `dev` after its security review, push `dev`, push the tag `runner-v0.1.2-dev.2`, run the second build and commit its checksums. |
| M9 | The proof of step 2 on a real server, with a go-ahead: a folder with no Dockerfile, from a profile on which zekno has never fetched Railpack, so it fetches and checks it itself; the app answers; the folder the runner wrote the code to is gone; clean up. |
| M10 | Decide whether and when to release 0.1.2: merge `dev` into `main`, push the tag `runner-v0.1.2`, approve the release in the `prod` environment, run the second build and commit its checksums on `main`, then the short proof of the released files. |
