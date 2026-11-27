# Feature Specification: Build from source

**Feature Branch**: `016-build-from-source`

**Created**: 2026-11-26

**Status**: Draft, revised on 2026-11-26 after three reviews: security, a person coming from a managed platform, and testability. The direction was decided by the maintainer on 2026-11-26 (D1 to D6 under Clarifications, from [`research.md`](./research.md), part 1). Later the same day the maintainer decided points 3, 4 and 19, and where the Linux checks and the proofs run (D7 to D10, under Clarifications, session 2026-11-26 (open points)). Point 19 was not decided as recommended, and the spec now follows the decision. Points 2, 5, 7 to 18, 20 and 22 to 25 are taken as recommended on 2026-11-26: the maintainer was told they follow the recommendations unless they object, and did not object (D11). Point 21 is taken as recommended with the change of D10. Points 1 and 6 were decided last, both as recommended (D12 and D13), point 1 with one addition: a line in the summary when the folder has changes that are not committed. No point is open. Revised on 2026-11-27: the maintainer approved the 18 boards, with the nineteen choices of [`design/lines.md`](./design/lines.md) as recommended, decided the items of the plan's "Needs the maintainer" as recommended but item 25, and accepted the plan's proposed spec changes (D14 to D17, under Clarifications, session 2026-11-27 (boards and plan)). Each change it made here is marked "changed on 2026-11-27". The words approved are those on the boards. A sentence written after the approval of 2026-11-27 is shown to the maintainer before its screen is built. Every new sentence quoted in this spec is a draft. Sentences quoted from today's zekno are marked "today's".

**Input**: Stage 4 of the road map. Today an app's images must already exist in a registry. This feature lets `zekno deploy`, run in a folder of code, build the image on the customer's own server and run it. Step 1 covers a folder with a Dockerfile, whose build can read the service's plain variables. Step 1b, right after it, lets a Dockerfile build read the secrets its settings name one by one. Step 2 covers a folder without a Dockerfile, built with Railpack. It builds the design for server builds written and reviewed twice during feature 010 ([`deploy-v2.md`](../010-app-settings/deploy-v2.md), part 4.1 (b) and questions Q1 to Q18, "the design" below). It stands on the signed deploy of feature 014 and on runner 0.1.1 of feature 015. The research, the hand test of Railpack and the threats are in [`research.md`](./research.md) ("the research").

## Clarifications

### Session 2026-11-26 (before this spec)

- Q: Where does a build run? → A: On the customer's own server (D1). Building in CI belongs to the later stage "deploys from CI".
- Q: Which folders does this stage cover? → A: Folders with a Dockerfile, then folders without one, as two steps of one stage (D2).
- Q: How is a folder with no Dockerfile built? → A: With Railpack (D3).
- Q: Where is the builder chosen? → A: In the settings file. The signed format is made to hold more than one builder, so a later builder changes no format (D4).
- Q: Other builders? → A: Cloud Native Buildpacks come later, as a step of their own. Nixpacks is left out: its makers say it is in maintenance mode (D5).
- Q: How does the developer get Railpack? → A: zekno fetches a pinned copy by itself and checks its checksum, as it checks a runner release. The developer installs nothing by hand (D6).

### Session 2026-11-26 (open points)

D7 to D10, D12 and D13 are the maintainer's answers to points 1, 3, 4, 6 and 19 and to where the checks run, given after this spec was written. D11 records the points taken as recommended, which is not an answer. All are recorded here, not in the research.

- Q: Point 19: may a build read the app's variables or secrets? → A: Not the earlier recommendation, which was (a). The build can read the app's plain variables, plus only the secrets named one by one as "the build may read this" (D7). Plain variables are not secret and are already in the signed settings. A named secret never leaves the customer's own server, so "Zekno cannot read it" holds, but it travels further on the server than today. So each is named, one by one, and nothing is passed by itself. Each reaches the build as a mounted build secret, never as a build argument, so the way it is handed over cannot put it in the image. Passing every secret to every build by itself, as Railway does, was advised against and is not chosen. Plain variables come with step 1 for a Dockerfile and with step 2 for Railpack. Named secrets for a Dockerfile come in step 1b, right after step 1, shipped no later than the release that ends step 2. For Railpack, named secrets wait until the Linux checks show how Railpack's frontend receives them and that they do not land in the image.
- Q: Point 4: code a Dockerfile pulls in from outside the folder? → A: (a), as recommended, with the runner recording the base images' digests after each build (D8). zekno looking up each base image's digest at deploy, showing it and signing it is wanted later, once proven on a plain server. It is not part of this feature.
- Q: Point 3: a folder with a Dockerfile and no settings file? → A: (a), as recommended (D9).
- Q: Where do the Linux checks and the proofs run (M4, point 21, M6, M9)? → A: Most of each step's proof runs on GitHub's own Linux machines, through a new check that runs on every push, which the maintainer agreed to add, and in a throwaway Linux container on the maintainer's Mac while building (D10). The maintainer's own server is used once, at the end of step 2, for one proof that covers both steps with a real domain, with a go-ahead at the time. The two development releases stay: 0.1.2-dev.1 after step 1, 0.1.2-dev.2 after step 2.
- Q: Points 2, 5, 7 to 18, 20 and 22 to 25? → A: Taken as recommended on 2026-11-26: the maintainer was told they follow the spec's recommendations unless they object, and did not object (D11). This is not an explicit answer. What a point says is drawn on the boards still waits for the boards. Point 21 is taken as recommended with the change of D10.

- Q: Point 1: which files are sent? → A: (a), as recommended, after the maintainer saw the four options and their costs (D12): what `docker build .` would send from the folder, with the proposed `.dockerignore` when there is none. One addition answers the cost that unfinished work is sent: when the folder has changes that are not committed, the summary says so before signing. The line warns and stops nothing (FR-017a).
- Q: Point 6: a hand-written Compose file that asks for a build? → A: (a), as recommended (D13). zekno refuses it before signing, and the runner starts apps in a way that never builds from Compose text. The maintainer approved the exception this makes to "with no terminal, every existing command behaves as before" (FR-074). Turning such a build into a signed build, (b), can come later if people ask.

No point is open after these answers.

### Session 2026-11-27 (boards and plan)

D14 to D17 record the maintainer's answers of 2026-11-27, given in their words "Let's use your recommends", after the 18 boards, the words of [`design/lines.md`](./design/lines.md) and the plan's "Needs the maintainer" in [`plan.md`](./plan.md) were put to them. "Item N" names an item of that list of the plan. "Choice X" names a choice of `design/lines.md`, "Choices for the maintainer".

- Q: The 18 boards, and the nineteen choices of `design/lines.md`? → A: The boards are approved, and each choice is decided as recommended there (D14). Maintainer step M2 is done. A sentence the maintainer has not seen yet, such as the new lines of item 23, is a draft: it is written now, marked as one, and shown to the maintainer before its screen is built (FR-092). The choices:
  - A-a: (a), the first-deploy question shows what it writes as `zekno add` shows its summary, the settings file as the rows `zekno settings` shows.
  - A-b: (a), the port is asked in one list question, with the port in its answers.
  - A-c: (b), `Don't build` at a terminal ends with today's `✖ Nothing was done.` With no terminal, today's sentence stays (FR-002, FR-003).
  - B-a: (b), the summary's notes show at the first deploy from the folder on this machine, and again when what they say changes. Its rows and warnings show every time (FR-072).
  - B-b: (a), the summary is a block above the deploy panel, with two new rows in the panel, `builds` and `sends`.
  - B-c: (A), the panel's `builds` row uses the summary's words, such as `web and worker, one build with Dockerfile`.
  - D-a: (a), the build stage reads `Building` while it runs or when it failed, and `Built` once done (FR-070).
  - D-b: (a), when every build was reused, the stage reads the word of choice D-e, and the line that nothing was sent stays under it (FR-070).
  - D-c: (a), a fresh build is asked for with `zekno deploy --fresh` (FR-021a).
  - D-d: (b), past one minute, a deploy's time reads like `in 5m 12s`, at a terminal and in the app's header.
  - D-e: (B), a build this deploy did not make again reads `Reused`. The server still keeps the image (User Story 5, FR-070).
  - E-a: (a), the "Docker said" panel shows the failing step and its error on two labelled rows, `step` and `error`.
  - E-b: (a), the whole output of a build is read with `zekno logs --build` (FR-071a).
  - G-a: (a), Railway's names: `source.root`, `build.builder`, `build.dockerfile`, `build.stage`, `build.timeout`, `build.network` (`internet` or `none`) and `build.secrets` (FR-007).
  - G-b: (a), a secret-looking file to send is named in `source.include`, a list of paths (FR-007, FR-015).
  - G-c: (B), the memory warning of `zekno doctor` reads `1 GB, less than 2 GB`, with the next step `Give prod-1 more memory or swap space before it builds`.
  - I-a: (a), `zekno settings plan` prints the whole Railpack plan (FR-059).
  - I-b: (B), the detail of Railpack's proposed port reads `a default: zekno sets PORT to it`.
  - J-a: (a), the full-screen app asks the first-time questions itself, in the panel of "Remember this folder?".
- Q: The items of the plan's "Needs the maintainer"? → A: Every item but 25 is decided as its recommendation says (D15). Where a recommendation waits on a check that has not run yet (items 1, 11, 12, 14, 17 and 27), the rule is decided with its conditions. The check's result then settles the branch without going back to the maintainer, except where the item says the choice comes back to the maintainer: item 12, when `--add-host` is not in the cache key on an engine the check covers, and item 26, any program the project supplies that Railpack starts. The items:
  - 1: (a), the Railpack release current when step 2 starts, once checks R1 to R10 and R16 have run on it. Any program `railpack prepare` downloads is pinned the same way, or step 2 waits. A build attestation, where the release carries one, is verified with `gh attestation verify`, else none. Whether the pinned release carries an attestation, seen at M3, settles the branch; the maintainer's own fetch of the checksums keeps its own go-ahead (D17).
  - 2: (C), a server stand-in with Docker's own packages at exact versions, on GitHub and on the Mac, with the images, the client container and the second tar reader the item names.
  - 3: (a), Ubuntu's `docker-registry` inside the stand-in.
  - 4: yes, an ARM64 job on GitHub (FR-089b).
  - 5: yes, a macOS job on GitHub, and the Mac's hand run stays (FR-089b).
  - 6: yes, a newest-engine leg, pinned and raised by hand (FR-089b).
  - 7: yes, `linux checks` becomes a required check for `dev` once it has passed there after step 1's merge. Agreed in principle; the setting is the maintainer's (D17).
  - 8: (a), the readers of `.dockerignore` and of Dockerfiles are written in the project.
  - 9: (a), `.git` is read by code written in the project, files only.
  - 10: (a), zstd level 3 from Bun's built-in `node:zlib`, imported by the core library.
  - 11: check L2 runs first. Point 4 (a) holds as decided if L2 shows it works at the floor and at the newest engine, on both image stores; else a `# syntax=` line is refused. Whatever L2 shows, a `# syntax=` line in a build that reads a secret is refused (FR-042a). L2 settles the branch.
  - 12: (a), a salt made from the app and the listed fingerprints of its named secrets, passed through `--add-host`, once L15 shows that two salts never share a step; and (i), a build with secrets on a Docker newer than the check covered is refused. L15 settles the branch, but the choice comes back to the maintainer if `--add-host` is not in the cache key on an engine the check covers.
  - 13: (a), the runner passes the ten proxy names empty (FR-036).
  - 14: (A), the runner gives each file the build's start time, once L4b shows that file times are not in the builder's cache checksums; else (C). L4b settles the branch.
  - 15: (a), a build of an app whose name ends with a hyphen is refused before signing.
  - 16: (a), a name the pack's form cannot hold is refused before signing.
  - 17: (c), with (a) beside it, if L9 shows the policy holds at the floor and at the newest engine; else (a), if L9 shows the images a build used; else (b). L9 settles the branch (FR-031a).
  - 18: (a), an exception to "byte for byte" in `zekno settings compose` (FR-011).
  - 19: (a), files named `Dockerfile.*` or `*.Dockerfile` at the top of a folder with no `Dockerfile` are listed in the first question (FR-004).
  - 20: (a), `railpack prepare` gets none of the person's proxy settings.
  - 21: (a), lines C26, G16 and G18 are approved as a second exception to FR-074.
  - 22: the nineteen choices, as recommended (D14).
  - 23: the lines that change with the plan, as it lists them. The new sentences among them are drafts (D14).
  - 24: the four help lines, appended to the frozen test's list.
  - 25: not decided (D17).
  - 26: (a), `strace -f` from Ubuntu's archive for check R16, and on macOS the programs macOS carries. Any program the project supplies that Railpack starts comes back to the maintainer before step 2.
  - 27: (a), the build runs under coreutils `timeout`, if L5 shows on Linux that a silent step outlives its runner; else (c). L5 settles the branch.
  - 28: (b), a stopped build whose record stays running with no process of it alive for 10 minutes is taken as ended (FR-039).
  - 29: (a), zekno uploads while another app builds, waits in the same run, then deploys (FR-044).
- Q: The plan's proposed spec changes? → A: Accepted, but for FR-044's upload clause, which applied only with item 29 (b) (D16). They are made in FR-004, FR-011, FR-031a, FR-036, FR-039, FR-042a and FR-074, in User Story 12 scenario 6, and in the edge cases "A `# syntax=` line", "A `# syntax=` line in a build that reads a secret" and "Ctrl-C or a dropped connection during the upload". The choices that change the spec's words are made in FR-002, FR-007, FR-015, FR-021a, FR-059, FR-070, FR-071a and FR-072, in User Story 1 scenario 2 and in User Story 5. Items 2 and 4 to 6 are made in FR-089b and under Assumptions. FR-092 and the maintainer steps say that M2 is done. Each change is marked "changed on 2026-11-27". Decided items that no requirement speaks of are under Assumptions, "Working readings of the decisions of 2026-11-27".
- Q: What stays the maintainer's own step? → A: Not decided on 2026-11-27, each with its own go-ahead at the time (D17): item 25, that is maintainer steps M5 to M10 (the merges into `dev`, the tags `runner-v0.1.2-dev.1` and `runner-v0.1.2-dev.2`, the second builds, the one proof on the maintainer's own server, and whether 0.1.2 is released); the ruleset setting of item 7, agreed in principle and made by the maintainer once the check has passed on `dev`; and the maintainer's own fetch of Railpack's checksums at M3.

## Why

Today Zekno runs only images that already exist in a registry. To deploy their own code, a person has to pick a registry, let the server log in to it, build the image, push it, and copy its name into the settings. A person who has used a managed platform expects none of this. They expect to run one command in a folder of code.

Building on the server has a second reason. Many developers sign on an ARM Mac, and many servers are x86-64. An image built on the server is built for the server's own processor.

It has to be done without weakening what Zekno promises. The server runs only what a team member signed. A build adds three things that decide what runs: the code, the build recipe and the builder. It can also read the app's plain variables and the secrets its settings name. The code, the recipe, the builder and the plain variables must be fixed by the signature. A secret's value never is: only its name is, with the version the deploy already lists for it. The code must be sealed for the server, so that nobody in between can read it, including the hosted service once it exists. Some of what a build downloads cannot be fixed by any signature, such as packages and language tools fetched while it runs. That must be said plainly. A build also shares the server with the apps already running there, and that must be said plainly too. And a Compose file written by hand must not become a way to build something outside these rules.

A build often needs values from the app's settings: a public address a framework writes into its pages, or a token to fetch private packages. Plain variables are not secret and are signed already, so a build can read them, and they are fixed by the signature too. A secret is different. Today it is opened only in memory when the app starts. A build hands it to steps that run other people's code and reach the internet. It still never leaves the customer's own server, but it travels further on it than today. So a build reads only the secrets its settings name, one by one, and the person agrees to each one on their own machine.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deploy a folder that has a Dockerfile (Priority: P1, step 1)

A developer has a folder of code with a Dockerfile, and a server with the new runner. They run `zekno deploy` in the folder. The first time, at a terminal, zekno shows what it would send and the settings file it would write, and asks whether to build this folder on the server (point 3, decided). The settings file holds one service, its build and the port it listens on. So the signed settings say a build happens, and the app can be reached. On a yes, zekno writes the file, seals the code for the server and signs the deploy. The server checks the code against the signature, builds the image with its own Docker, and starts the app. No registry is used and no image is built by hand.

**Why this priority**: It is the first step of the stage, and the case most people with a Dockerfile meet first.

**Independent Test**: With a test runner and real Docker on this machine, deploy a folder whose Dockerfile builds a small web server. The app answers on the port the written settings give it. The server holds the image under the name the signed Compose text gives it, and no registry was reached for the app's own image.

**Acceptance Scenarios**:

1. **Given** a folder with one file named exactly `Dockerfile`, no settings file and no Compose file, **When** the developer runs `zekno deploy` at a terminal, **Then** zekno first asks once whether to build the folder on the server, before the questions about the key, the server and the app. The question shows what would be sent and the settings file it would write: one service (its name drawn on the boards, such as `web`), its build, and the port the Dockerfile says it listens on, when it says one. The person can change the port, give one, or say the service has none, as for a worker. On a yes, zekno writes the file and goes on with the deploy.
2. **Given** the same question, **When** the person answers `Don't build`, or presses Esc or Ctrl-C, **Then** nothing is written, and the deploy ends with today's `✖ Nothing was done.` (changed on 2026-11-27, choice A-c).
3. **Given** a folder with a Dockerfile, a `node_modules` folder of 600 MB and no `.dockerignore`, **When** the developer deploys at a terminal, **Then** the question also proposes a `.dockerignore`, drawn from the folder's `.gitignore` plus dependency folders, and shows it. The same yes writes it, and `node_modules` is not sent (point 1, decided).
4. **Given** a settings file whose service is built from the folder, **When** the developer deploys, **Then** the code is sent sealed, the server builds it, and the app starts as today.
5. **Given** the same folder with no terminal and no settings file, **When** `zekno deploy` runs, **Then** it deploys nothing and stops exactly as it does today in a folder with no Compose file.
6. **Given** a `Dockerfile` beside a file whose name starts with `Dockerfile.`, or a `Dockerfile` in a sub-folder that is sent, **When** the developer deploys, **Then** zekno never picks one by itself. The settings name it, or the person chooses in the first-deploy question and the choice is written to the settings.
7. **Given** two services built from the same folder with the same recipe (a web process and a worker), whose settings give the build the same plain variables and secrets, **When** the developer deploys, **Then** the code travels once and is built once, and each service runs the image with its own start command. When what their builds read differs, the code still travels once, and each is built.
8. **Given** a server whose processor differs from the developer's machine, **When** the app is built there, **Then** the image is for the server's processor and starts.
9. **Given** a first deploy of a settings file zekno wrote, with a built service that has a port and no domain, **When** the app starts, **Then** the result says how to reach it. Draft: `web listens on 3000 inside prod. Give it a domain with zekno domain add <domain>, then deploy again.`
10. **Given** that first deploy, **When** the developer runs `zekno domain add` and deploys again with no change to the code, **Then** no code is sent, nothing is built, and the app answers over HTTPS on its domain. In step 1's checks, the domain and its certificate are stand-ins. A real domain is shown once, by the proof at the end of step 2 (FR-090).

---

### User Story 2 - Know what is sent before anything is signed (Priority: P1, step 1)

Before zekno signs a deploy that builds, it shows what it will send: how many files, how large, the largest folders, what it left out and why, and every secret-looking file it does send and why. A folder that is too large is refused before anything is signed. The sentence names the largest folders and how to leave them out. At a terminal, the first deploy that builds from a folder on this machine waits for a yes after the summary. A secret-looking file is sent only when the settings name it and the person agreed to it on this machine. So a person learns what the summary names, such as a forgotten `node_modules` or a `.env` file, on their own machine and before anything is signed.

**Why this priority**: The folder decides what reaches the server. A mistake here sends secrets or gigabytes, and it can only be caught before signing.

**Independent Test**: Pack test folders on this machine with stand-ins for the server. The summary counts files and bytes exactly. An ignored folder, a `.git` folder, each kind of file on the list of secret-looking files, and a link that leads out are each listed as left out. A listed file that the settings name is sent only after a yes on this machine. A folder over the limit signs nothing and names its largest folders.

**Acceptance Scenarios**:

1. **Given** a folder with code, a `.dockerignore` and a `.git` folder, **When** the developer deploys, **Then** the summary shows the number of files, the total size, the largest folders, and what was left out by the ignore file and by zekno's own rules, before anything is signed.
2. **Given** a folder whose packed size passes the limit a deploy can carry, **When** the developer deploys, **Then** nothing is signed or sent, and one sentence names the size, the limit, the largest folders and how to leave them out. Draft: `This folder packs to 734 MB, over the 537 MB a deploy can carry. Largest: node_modules 612 MB, .next 98 MB. List them in .dockerignore, then deploy again. Nothing was signed.`
3. **Given** a file such as `.env` in the folder, **When** the developer deploys, **Then** it is not sent unless the settings name it, and the summary says it was left out and where its values belong (point 2). Draft: `.env was left out: it looks like it holds secrets. To give its values to the app, run zekno secret import .env.`
4. **Given** a file on the list of secret-looking files that the settings name, **When** the developer deploys at a terminal, **Then** zekno asks once whether to send that file. The answer is remembered on this machine, never in the folder, and the summary lists the file as sent and why. With no terminal and no earlier yes on this machine, the deploy stops before signing and names the file.
5. **Given** a settings file that builds, which arrived with a cloned repository, **When** the developer first deploys from that folder at a terminal, **Then** zekno shows the summary and waits for a yes before signing.
6. **Given** a link in the folder that leads out of it, **When** the developer deploys, **Then** zekno does not follow it, does not send what it leads to, and lists it as left out.
7. **Given** the same files on two machines, **When** each packs them, **Then** both get the same fingerprint, and for a Dockerfile the same image name in the Compose text.
8. **Given** no terminal, **When** a deploy that builds runs, **Then** the summary's facts are given as plain lines on standard error. Standard output keeps only today's result line, so a script that reads it gets the same line for a deploy that builds.
9. **Given** a folder in a git repository with a changed file that is not committed, **When** the developer deploys, **Then** the summary says in one line that changes that are not committed are sent as they are, and the deploy goes on. In a folder outside a git repository, or with nothing to commit, the line is not shown.

---

### User Story 3 - Follow a build, and a failed build leaves the app alone (Priority: P1, step 1)

While the server builds, the deploy shows a stage for the build, with the builder's latest line under it. When the build fails, the runner does not stop, replace or re-route the app that was running. The developer is told in one sentence that the build failed, and which deploy still runs or that none runs yet. The step that failed and its error follow, then the builder's last lines. A build that runs out of memory, out of disk or out of time says so in words. A build shares the server's memory, processor and disk with the apps already running there. A build that runs out of memory can make the server stop other programs, the running app among them. zekno says so plainly, in the sentence and in the docs.

**Why this priority**: A build is the slowest and most fragile part of a deploy. A person must see it move, and a failed build must never make the runner touch the site.

**Independent Test**: With a test runner, real Docker and a running app that writes to disk: a Dockerfile with a failing step ends the deploy as a failed build. The app of the previous deploy still answers and still writes. The failing step, its error and the builder's last lines are shown. A build that passes its time limit is stopped and said to be. A build that brings free disk below the floor (a stand-in) is stopped as out of disk.

**Acceptance Scenarios**:

1. **Given** a deploy that builds, **When** the code is sent and the server builds, **Then** the stage row shows the upload's progress, then a build stage between Sent and Starting with the builder's latest line under it.
2. **Given** an app running deploy 6, **When** the build of deploy 7 fails, **Then** the runner leaves deploy 6 untouched, the number 7 is used, and the lead sentence says so. Draft: `The build of web failed on prod. shop still runs deploy 6.` The step that failed and its error follow in the "Docker said" panel, then the builder's last lines (point 10).
3. **Given** an app with no deploy yet, **When** its first build fails, **Then** the number is used, and the sentence says that nothing runs yet. Draft: `The build of web failed on prod. shop has no deploy running yet.`
4. **Given** a build that passes its time limit, **When** the limit is reached, **Then** the server stops it, the outcome is a failed build, and the sentence names the limit.
5. **Given** a build that brings free disk on the server below the floor, **When** the floor is reached, **Then** the runner stops the build, the outcome is a failed build, out of disk, and the app that was running is untouched.
6. **Given** a build that runs out of memory, **When** it fails, **Then** the sentence says so, says that the server may have stopped other programs too, and gives a step the person can take. Draft: `The build of web ran out of memory on prod and was stopped. A server out of memory can stop other programs too: zekno status shows whether shop still runs deploy 6. Give prod more memory or swap space, then deploy again.`
7. **Given** the connection drops during the build, **When** the developer looks again, **Then** the build went on to its end on the server, and `zekno status` shows how it ended.
8. **Given** no terminal, **When** a build fails, **Then** the sentence goes to standard error, and standard output keeps today's result line. `--json` gives a failed-build outcome with its reason (draft name: `build_failed`). The exit status is the one of a deploy whose app did not start.

---

### User Story 4 - Only what a team member signed is built (Priority: P1, step 1, again in step 2)

Whoever relays or stores a deploy, and whatever a Compose file says, the server builds only the code, the recipe and the builder a team member signed, with the plain variables and the names of the secrets that member signed for the build. The code travels sealed for the server. A person can read in the summary and in the docs what the signature fixes and what it does not.

**Why this priority**: It is Zekno's promise. A build that a relay could change, or that a Compose file could start, would break it.

**Independent Test**: With a test runner: change one byte of the code, of one sealed piece, of the recipe, of the builder's name, of a plain variable given to the build or of a build secret's name after signing. Each is refused before the number is used. A hand-written Compose file that asks for a build is refused by zekno before signing. The runner, given such a text anyway, builds nothing. A marker string placed in a source file never appears in the sealed pieces, in the signed deploy or in the runner's own folder.

**Acceptance Scenarios**:

1. **Given** a signed deploy that builds, **When** any part of the code, the recipe, the builder, the plain variables given to the build or the names of its secrets is changed after signing, **Then** the runner refuses it, nothing runs, and no number is used.
2. **Given** a hand-written Compose file in which a service asks Docker to build an image, **When** the developer deploys, **Then** zekno stops before signing and says how to build with Zekno instead (point 6, decided). Draft: `compose.yaml asks Docker to build web. zekno builds from a settings file only: run zekno settings init to start one. Nothing was signed.`
3. **Given** a runner of this feature and a signed Compose text that asks for a build, **When** it starts the app, **Then** nothing is built, and a service whose image does not exist does not start.
4. **Given** the deploy summary of a build, **When** the developer reads it, **Then** a line says what the build downloads while it runs is not fixed by the signature, naming what applies to its builder. Draft for a Dockerfile: `What the build downloads while it runs, such as base images named by tag and packages, is not fixed by this signature.` Draft for Railpack: `What the build downloads while it runs, such as packages and language tools, is not fixed by this signature.`
5. **Given** a deploy that builds is sent to a machine other than the server it names, **When** that machine receives it, **Then** it cannot open the code.
6. **Given** a Dockerfile that names another app's built image, directly, through a build argument's default, or in a copy from another image, **When** the developer deploys, **Then** zekno refuses it before signing.
7. **Given** a build whose builder prints lines of the code, **When** the build ends, **Then** those lines went only to the zekno that sent the deploy. The runner keeps none of them, its record of the build holds only the outcome and its reason, and it removed Docker's own record of the build (FR-031b).

---

### User Story 5 - Nothing changed, nothing sent, nothing built (Priority: P2, step 1)

A developer deploys again with no change to the code, the recipe or what the build reads, for example after changing a secret the build does not read. The server still keeps the image of the earlier build. No code travels and nothing is built. The build stage says the build was reused (changed on 2026-11-27, choice D-e). For a Railpack build, this holds while Railpack makes the same plan (User Story 6). A change to a plain variable or a secret the build reads makes a new build (User Stories 11 and 12).

**Why this priority**: Most deploys change little. Sending and building again each time would make every deploy slow.

**Independent Test**: With a test runner: deploy a folder, then deploy again with only a secret changed that the build does not read. No code is sent, the builder is not started, and the app runs with the new secret.

**Acceptance Scenarios**:

1. **Given** the server keeps the image of the same code, recipe and builder, **When** the developer deploys, **Then** no code is sent, nothing is built, and the build stage says the build was reused and nothing was sent (changed on 2026-11-27, choice D-e).
2. **Given** someone put another image under the kept image's name on the server, **When** the developer deploys, **Then** the runner does not trust the name, asks for the code, and builds again.
3. **Given** one file changed, **When** the developer deploys, **Then** the code is sent and built again.
4. **Given** a deploy that asked for a fresh build (point 11), **When** the developer deploys again with only a secret changed that the build does not read, **Then** the image of the fresh build runs, never one built before it.

---

### User Story 6 - Deploy a folder that has no Dockerfile (Priority: P2, step 2)

A developer has a folder of code in a language Railpack knows, such as a Node app with a `package.json`, and no Dockerfile. They run `zekno deploy`. In a folder with no settings file, zekno first asks whether to fetch and run Railpack on it (point 17). The first time a deploy needs Railpack, zekno fetches the version it pins from Railpack's own release, checks it against the checksum zekno carries, and keeps it. Railpack reads exactly the files zekno will send, on the developer's machine, and makes a build plan. Every deploy with Railpack runs it on this machine, and that needs the network. The plan, the Railpack version and everything the plan names are fixed by the signature. The server checks the plan, writes the code to a folder of its own, builds it with the pinned Railpack frontend, and runs it.

**Why this priority**: It is the second step of the stage. It brings the experience of a managed platform to folders with no Dockerfile.

**Independent Test**: With a test runner, real Docker and a stand-in for Railpack's release: deploy a small Node folder with no Dockerfile. zekno fetched and checked Railpack itself, the plan is part of what is signed, the runner checked the plan against its signed fingerprint, the app answers, and the folder the runner wrote the code to is gone after the build.

**Acceptance Scenarios**:

1. **Given** a folder with no Dockerfile, no settings file and no Compose file, **When** the developer runs `zekno deploy` at a terminal, **Then** zekno first asks whether to fetch and run Railpack on the folder, and fetches or runs nothing before a yes. Draft: `No Dockerfile here. Fetch Railpack (N MB) to find out how to build this folder?` With no terminal, nothing is fetched or run.
2. **Given** a machine without Railpack, **When** a deploy first needs it, **Then** zekno fetches the pinned version, checks its checksum, says what it fetched (point 12), and goes on.
3. **Given** a freshly fetched file whose checksum does not match, **When** zekno checks it, **Then** it is never run and it is deleted. One sentence says that the file on Railpack's release is not the one this zekno pins. Nothing is signed.
4. **Given** a folder Railpack knows, **When** the developer deploys, **Then** the summary shows what Railpack found (point 13), the deploy is signed with the plan, and the app starts on the server.
5. **Given** a Node folder with a `node_modules` of 600 MB, no `.dockerignore` and no Dockerfile, **When** the developer deploys at a terminal for the first time, **Then** it deploys on the first try with two answers, the one to run Railpack and the one that writes the files, and `node_modules` is not sent (point 1, decided).
6. **Given** a Railpack app whose language had a new patch release since the last deploy, **When** the developer deploys with only a secret changed, **Then** the summary says before signing why it builds again (point 25). Draft: `Railpack now picks Node 22.23.6 (was 22.23.5), so web is sent and built again.`
7. **Given** a machine from which Railpack cannot reach the network, **When** a deploy with Railpack runs, **Then** nothing is signed, and one sentence says that Railpack needs the network to plan the build.
8. **Given** a folder Railpack cannot read, **When** the developer deploys, **Then** nothing is signed, and one sentence gives Railpack's reason and what to do (point 14).
9. **Given** a runner that builds with a Dockerfile but not with Railpack, **When** the developer deploys a Railpack build, **Then** zekno stops before signing and says to update the runner.
10. **Given** a machine for which zekno carries no Railpack checksum, **When** the developer deploys a folder with no Dockerfile, **Then** zekno says so before signing, and a folder with a Dockerfile still deploys.
11. **Given** a signed Railpack build whose plan does not have the signed fingerprint, or names a frontend or an image not signed by digest, **When** the runner checks it, **Then** it refuses it before the number is used.

---

### User Story 7 - Build settings where a Railway user looks for them (Priority: P2, steps 1, 1b and 2)

A developer sets how a service is built in the settings file, in the sections a person who has used Railway knows: the folder to send under Source, and under Build the builder, the Dockerfile's path and the other settings this version offers (point 18), with, from step 1b, the secrets the build may read. `zekno settings` shows them, `zekno settings set` and `unset` change them, `zekno settings init` can start a file that builds, and the deploy signs them.

**Why this priority**: The first deploy writes these settings. Changing them comes after the first success.

**Independent Test**: With stand-ins: each build setting is shown in its section, checked against its rule, changed with `set` and `unset` as other settings are, and turned into the same signed build on every machine.

**Acceptance Scenarios**:

1. **Given** a service that is built, **When** the developer runs `zekno settings`, **Then** its build settings are shown in their sections, and the service has a build or an image to run, never both.
2. **Given** a monorepo whose Dockerfile needs a folder above the settings file, **When** the developer sets the folder to send, **Then** it is accepted up to the top of the git repository the settings file is in, and refused with a sentence beyond it (point 5).
3. **Given** a settings file that names the Railpack builder, read by a zekno of step 1, **When** it deploys, **Then** it stops before signing and says to update zekno.
4. **Given** a settings file that builds, read by a zekno from before this feature, **When** it deploys, **Then** it stops before signing with one of the sentences it gives today, for a setting it does not know or for a service with no image, and signs nothing (point 18).
5. **Given** a folder with a Dockerfile and no settings file, **When** the developer runs `zekno settings init` at a terminal, **Then** it offers to build the folder instead of asking for an image, with the same port question as the first deploy.
6. **Given** a service that runs an image, **When** the developer sets a build on it, **Then** the build replaces the image as one change, shown on one change line. Setting an image on a built service replaces the build the same way.
7. **Given** a folder with a Dockerfile and a `compose.yaml` whose `web` service has `build: .`, **When** the developer deploys, is refused, runs `zekno settings init`, then deploys from the settings file, **Then** the app is built on the server and answers.
8. **Given** a built service, **When** the developer names a secret the build may read with `zekno settings set` (step 1b), **Then** it is shown in the Build section, checked against its rules (FR-037a, FR-037b), and changed with `set` and `unset` as other settings are. A zekno that does not know this setting stops before signing with the sentence it gives for a setting it does not know, and signs nothing.

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
5. **Given** deploy 2 changed the code after deploy 1, and deploys 3, 4 and 5 changed only a secret the build does not read, **When** the developer rolls back to deploy 1, **Then** deploy 1's image is still kept and runs.
6. **Given** deploy 4's build read the secret `NPM_TOKEN`, set again since (step 1b), **When** the developer rolls back to deploy 4, **Then** zekno stops before signing, since the server cannot reuse a build made with an earlier value and a rollback never builds again. One sentence says so and how to go back. Draft: `Deploy 4 of shop was built with an earlier NPM_TOKEN, set again since, so prod cannot reuse its build. To go back to it, deploy that code again from a checkout. Nothing was signed.`
7. **Given** deploy 4's build read `NPM_TOKEN`, removed since with `zekno secret rm` (step 1b), **When** the developer rolls back to deploy 4, **Then** zekno stops before signing with one sentence that names the secret, says it was removed, and how to go back.

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
5. **Given** a server with built apps, **When** the developer runs `zekno doctor`, **Then** it shows the disk Zekno's builds take, the free space left, and the server's memory, with a warning below the figure of point 22.
6. **Given** a server with no built app, **When** the developer runs `zekno doctor` with no terminal, **Then** its plain output for that server is as before.

---

### User Story 10 - Old and new programs say what to do (Priority: P2, steps 1, 1b and 2)

Builds need a runner that builds, and a build that reads a named secret needs a runner that carries out step 1b. A zekno of this feature that meets an older runner with a deploy that builds, or that gives a build a secret, stops before signing and says to update the runner. Deploys without a build work as before on any runner. A zekno from before this feature that meets the new runner stops before signing, as feature 014 decided.

**Why this priority**: Runners are updated by hand, one server at a time. Today's servers run 0.1.1, which does not build.

**Independent Test**: Run this feature's zekno against runner 0.1.1; the zekno that carries 0.1.1 against this feature's runner; a zekno of step 2 against a runner of step 1 (scenarios 4 and 7); and, when step 1b ships after step 1, a zekno of step 1b against a runner of step 1 (scenario 8). Check each scenario below.

**Acceptance Scenarios**:

1. **Given** a server running runner 0.1.1, **When** a deploy builds, **Then** nothing is signed, and one sentence says to update the runner. Draft: ``The runner on prod is version 0.1.1, too old to build from source. Run `zekno server update prod`, then run `zekno deploy` again. Nothing was signed.``
2. **Given** a server running runner 0.1.1, **When** a deploy does not build, **Then** everything is as in feature 015.
3. **Given** the new runner and a zekno from before this feature, **When** that zekno deploys any app, **Then** it stops before signing with today's sentence, the one feature 014 built for a runner that speaks a newer protocol: `The runner on prod is version 0.1.2-dev.1, newer than this zekno's 0.1.1, and speaks a newer protocol. Update zekno to deploy to prod. Nothing was signed.`
4. **Given** a runner of step 1, **When** a zekno of step 2 deploys a folder built with Railpack, **Then** it stops before signing and says to update the runner. Draft: ``The runner on prod builds with a Dockerfile, not with Railpack. Run `zekno server update prod`, then run `zekno deploy` again. Nothing was signed.``
5. **Given** an older runner handed a deploy with a build anyway, **When** it reads it, **Then** it refuses it, uses no number and runs nothing.
6. **Given** a server whose runner wrote the new state, **When** an older runner is put back by hand, **Then** it refuses every request rather than read the state wrongly. The way back is to update the runner again.
7. **Given** a runner of step 1 handed a signed Railpack build anyway, **When** it reads it, **Then** it refuses it with no number used, and never builds it another way.
8. (When step 1b ships after step 1.) **Given** a runner that builds with a Dockerfile but does not carry out named build secrets, **When** a zekno of step 1b deploys a build that names one, **Then** it stops before signing and says to update the runner. Draft: ``The runner on prod builds without secrets. Run `zekno server update prod`, then run `zekno deploy` again. Nothing was signed.`` Handed such a signed build anyway, that runner refuses it with no number used, and never builds it without the secret.

---

### User Story 11 - A build reads the service's plain variables (Priority: P2, step 1 for a Dockerfile, step 2 for Railpack)

A developer's framework writes a public value into its pages at build time, such as the address of its API. They set it as a plain variable of the service, as they would on Railway. For a Dockerfile, the build reads the service's plain variables that the Dockerfile declares with `ARG`, and no other. For Railpack, the build reads every plain variable of the service but those zekno never gives a build (FR-036b). The summary names them before signing. A change to a variable the build reads builds again, and the summary says why. A change to one it does not read builds nothing.

**Why this priority**: Many frameworks need a public value at build time, and a person coming from Railway expects the build to see the service's variables. Plain variables are not secret and are signed already, so giving them to a build breaks nothing Zekno promises.

**Independent Test**: With a test runner and real Docker: a Dockerfile that declares `ARG API_URL` and writes it into a file of the image, and a service with the plain variables `API_URL` and `NODE_ENV`. The image holds the value of `API_URL`, the build was not given `NODE_ENV`, and the summary named `API_URL`. Changing only `NODE_ENV` sends no code and builds nothing. Changing `API_URL` sends the code and builds again, and the summary says why. For step 2, with a stand-in for Railpack's release: a Node folder whose build step reads a plain variable gets its value.

**Acceptance Scenarios**:

1. **Given** a Dockerfile that declares `ARG API_URL`, and a service with the plain variables `API_URL` and `NODE_ENV`, **When** the developer deploys, **Then** the build is given `API_URL` with its value and not `NODE_ENV`, and the summary names `API_URL` as read by the build before signing.
2. **Given** that deploy, **When** the developer changes only `NODE_ENV` and deploys, **Then** no code is sent, nothing is built, and the app runs with the new value.
3. **Given** that deploy, **When** the developer changes `API_URL` and deploys, **Then** the summary says before signing why it builds again, and the code is sent and built again. Draft: `API_URL changed, and the build of web reads it, so web is sent and built again.`
4. **Given** a Dockerfile that declares `ARG HTTP_PROXY`, and a service with a plain variable `HTTP_PROXY`, **When** the developer deploys, **Then** the build is not given it, the summary says so, and the deploy goes on.
5. **Given** a service whose Dockerfile declares more of its plain variables than a build can carry, or one whose value is longer than a build can carry, **When** the developer deploys, **Then** nothing is signed, and one sentence names the service, the variable and the limit.
6. **Given** a Dockerfile whose base image name uses a plain variable given to the build, **When** the developer deploys, **Then** zekno resolves the name with the variable's value before signing, and refuses it when it names the space kept for built images.
7. **Given** a folder built with Railpack and a service with plain variables (step 2), **When** the developer deploys, **Then** every plain variable of the service but those FR-036b leaves out reaches the build's steps, the summary names them, and a change to any of them builds again, with the summary saying why.
8. **Given** a folder built with Railpack and a service with 33 plain variables that a build may be given (step 2), **When** the developer deploys, **Then** nothing is signed, and one sentence names the service, the count and the limit.

---

### User Story 12 - A build reads only the secrets named for it (Priority: P3, step 1b)

A developer's Dockerfile installs packages from a private registry and needs a token. They set the token with `zekno secret set NPM_TOKEN`, then name it in the service's build settings as a secret the build may read. The first deploy that gives it to the build shows the summary, says plainly that a build that reads a secret and reaches the internet can send it anywhere, and waits for a yes. The build reads it as a mounted secret under its own name. It never becomes a build argument, and the way it is handed over puts nothing of it in the image. A secret that is not named for the build never reaches it, even when the running app reads it.

**Why this priority**: Private package registries are the commonest reason a build needs a secret. It follows step 1 as a part of its own, because a secret read by a build travels further on the server than today, and needs its own checks and review.

**Independent Test**: With a test runner and real Docker: a Dockerfile whose step reads a mounted secret named `NPM_TOKEN` and checks its value without writing or printing it. With the secret named in the build settings and agreed to, the build passes. A marker value of the secret appears nowhere in the image, its history, its metadata, the signed deploy, what a relay can read, or the runner's own folder. A second secret the service reads, not named for the build, is absent from the build. A secret named `GIT_AUTH_TOKEN` is refused before signing. Setting `NPM_TOKEN` again makes the next deploy build again, and the step that read the old value runs again.

**Acceptance Scenarios**:

1. **Given** a service whose build settings name `NPM_TOKEN`, a secret of the app, **When** the developer first deploys at a terminal, **Then** the summary names `NPM_TOKEN` as read by the build, and zekno asks once whether to give it to the build, saying what that means. Draft: `The build of web will read NPM_TOKEN. A build that reads a secret and reaches the internet can send it anywhere, and no signature prevents it. Give NPM_TOKEN to this build?` The question also names each base image of that build named without a digest (FR-037f). On a yes, the deploy is signed. The answer is remembered on this machine, never in the folder.
2. **Given** no terminal and no earlier yes on this machine, **When** the deploy runs, **Then** it stops before signing and names the secret. Draft: `The build of web reads NPM_TOKEN, and this machine has not agreed to give it to a build. Run zekno deploy once at a terminal to agree. Nothing was signed.`
3. **Given** the service also reads `DATABASE_URL` when it runs, and the build settings do not name it, **When** the build runs, **Then** `DATABASE_URL` does not reach the build, and the running app still gets it.
4. **Given** a build that read `NPM_TOKEN`, **When** `NPM_TOKEN` is set again and the developer deploys with no other change, **Then** the summary says before signing that the build runs again because `NPM_TOKEN` changed, the code is sent and built again, and no step built with the earlier value is reused. The signed deploy holds no value of `NPM_TOKEN`, and nothing made from the value by a plain hash.
5. **Given** build settings that name `GIT_AUTH_TOKEN`, `GIT_AUTH_HEADER`, or a name that starts with `HTTP_AUTH_TOKEN_` or `HTTP_AUTH_HEADER_`, **When** the developer deploys, **Then** zekno stops before signing with one sentence. Draft: `GIT_AUTH_TOKEN cannot be given to a build: the builder would send it to the hosts it fetches from. Set it under another name. Nothing was signed.` A runner handed such a signed build refuses it with no number used.
6. **Given** a Dockerfile with a `# syntax=` line, and a build that reads `NPM_TOKEN`, **When** the developer deploys, **Then** zekno stops before signing with one sentence, and a runner handed such a signed build refuses it with no number used, so no program but the reader built into the server's Docker receives the secret (changed on 2026-11-27, item 11).
7. **Given** build settings that name a secret the app does not have, or one removed with `zekno secret rm`, **When** the developer deploys, **Then** zekno stops before signing and names it.
8. **Given** a service built with Railpack whose build settings name a secret (step 2), **When** the developer deploys, **Then** zekno stops before signing with one sentence, until the Linux checks show how Railpack's frontend receives secrets and that they do not land in the image. Draft: `web is built with Railpack, and this version of zekno cannot give a Railpack build a secret yet. Remove NPM_TOKEN from what the build may read, or build web with a Dockerfile. Nothing was signed.`

---

### Edge Cases

**The folder and what is sent**

- **The Dockerfile copies a file zekno left out**, such as `.env`: the build fails at that step. The sentence names the file, why it was left out, and where its values belong.
- **`.dockerignore` lists the Dockerfile or itself**: Docker still sends both to the builder, and zekno does the same.
- **A Dockerfile with its own ignore file beside it** (named after the Dockerfile): Docker uses it in place of the folder's, and zekno does the same.
- **A folder with no `.dockerignore` that holds `node_modules` or `.venv`**: the first-deploy question proposes a `.dockerignore` (point 1, decided). In a later deploy, the summary warns above the warning size, and the refusal names the folder past the limit.
- **A folder with changes that are not committed**: they are sent as they are, and the summary says so in one line (FR-017a). A repository whose own configuration names a program to run is never asked to run it.
- **An empty folder, or one whose files are all left out**: refused before signing.
- **More files than the entry limit** (recommended: 50,000, point 22): refused before signing, naming the folders with the most files.
- **A file zekno cannot read, or one that changes while it is packed**: the deploy stops before signing and names it.
- **A name that is not valid text, holds a control character, or is too long**: refused before signing with its place.
- **The same files checked out with other line endings, or names in another Unicode form**: they are packed as they are on disk, so the fingerprint differs between such machines. The build is the same.
- **A monorepo**: the folder to send can be above the settings file, up to the top of its git repository (point 5).
- **A service that sets both an image and a build**, or more than 8 builds in one deploy: refused before signing.

**The build**

- **Another deploy to the same server during a build**: it waits or is told the server is busy. The sentence names the app that is building, how long it has been building, and its time limit.
- **A team list update during a build**: taken at once (point 7). If the new list no longer lets the deploy's signer deploy to this server, the built app does not start. The deploy ends as stopped, and the app that was running keeps running.
- **Ctrl-C or a dropped connection during the upload**: no number is used. Within the same run, a cut upload resumes with the pieces the server lacks, also over a new connection; a later run sends the code again (point 8; changed on 2026-11-27, a spec change of the plan accepted that day (D16), since FR-020 keeps no sealed piece between runs).
- **Ctrl-C at a terminal during the build**: zekno says the build goes on on the server, and how to see how it ended. Point 24 decides whether it can also stop it.
- **The runner restarts during a build**: the number is used, the build's leftovers are never recorded or reused, and the earlier version keeps running. The deploy is shown as not started.
- **A server whose Docker has no build plugin**, such as a distribution's own Docker package: the deploy is refused before the number is used, and `zekno doctor` says what to install.
- **A server whose Docker is older than Docker Engine 29.5**: a deploy that builds is refused before the number is used, with a sentence that names both versions. Deploys of images still work.
- **Out of memory on a small server**: a failed build, with its sentence. The server may also have stopped another program to free memory, the running app among them. The sentence and the docs say so.
- **Out of disk during the build**: the runner stops the build when free disk falls below the floor. It is a failed build, out of disk, with its sentence. The floor stops most cases before they start.
- **A Dockerfile that fixes another processor type**: the image does not match the server, and the build ends as failed with a sentence.
- **A `# syntax=` line**: the server ignores it, and the summary says so (point 4, decided). If the plan's check L2 does not show that the server ignores it, at the floor and at the newest engine on both image stores, zekno refuses it before signing and the runner before the number is used (changed on 2026-11-27, item 11).
- **An `ADD` of a web address or a git repository**: refused before signing when it has no checksum. One whose address names the server itself or a private address is refused even with a checksum (point 4, decided).
- **A base image named without a digest**: a warning in the summary, and the deploy goes on (point 4, decided).
- **A base image in a private registry**: it works only when the server's Docker is logged in to that registry, as for images today.
- **A Dockerfile that names another app's built image**, directly, through a build argument or through a plain variable given to the build: refused before signing.
- **Someone re-tags a kept image on the server by hand**: the runner sees that the name leads to another image, does not use it, and builds again.
- **A build that has to run for more than two hours**: the signed limit is at most two hours; the build is stopped there.
- **A build that succeeds, and whose app then does not start or is not healthy**: the image is recorded and kept, and counts among the kept images. The outcome is as in feature 015.
- **Docker's build cache holds builds made outside Zekno**: the prune after each deploy can remove them (point 9). The docs say so.

**Variables and secrets in a build** (plain variables in step 1 for a Dockerfile and in step 2 for Railpack; named secrets in step 1b)

- **A plain variable the Dockerfile does not declare with `ARG` changes**: the build key stays the same, and nothing is sent or built.
- **A plain variable the build reads changes**: the build key changes, so the code is sent and built again. The summary says why before signing.
- **A plain variable whose name zekno keeps for itself, or that the builder reads as an instruction to itself**, such as `HTTP_PROXY` or a name that starts with `BUILDKIT_`, and for Railpack a name the builder sends as a credential: never given to a build. When the Dockerfile declares it, or Railpack would read it, the summary says so, and the deploy goes on.
- **More plain variables, or longer values, than a build can carry**: refused before signing, naming the variable or the count, and the limit. A Railpack build is given every plain variable of the service, so a service with more than 32 that a build may be given cannot be built with Railpack (FR-036d).
- **A Dockerfile that declares with `ARG` a name that is a secret of the app**, as a Dockerfile brought from Railway may: the build is not given it. The summary says that a secret never reaches a build through `ARG`, and how a build reads one (FR-036e). The deploy goes on.
- **Two services built from the same folder and recipe whose builds read different values**: the code travels once, and each is built.
- **A named build secret the app does not have, or one removed with `zekno secret rm`**: refused before signing, naming it.
- **A named build secret under a name the builder sends as a credential** (`GIT_AUTH_TOKEN`, `GIT_AUTH_HEADER`, or one that starts with `HTTP_AUTH_TOKEN_` or `HTTP_AUTH_HEADER_`): refused before signing, whatever the settings say, and refused by the runner if it arrives signed.
- **A named build secret set again, or taken off the build's list**: the next deploy builds again, and no step built with the earlier value is reused. A step built with a secret is reused only by a build of the same app that reads that secret with the same value: never by a build that no longer reads it, nor by another app's build (FR-037d).
- **A rollback to a deploy whose build read a secret set again or removed since**: refused before signing, since the server cannot reuse that build, a removed secret cannot be given to a build, and a rollback never builds again. The sentence says whether the secret was set again or removed. Going back means deploying that code again from a checkout.
- **A settings file from a cloned repository, or from a teammate, that names a secret for the build**: the first deploy from this machine that gives that secret to that build asks for a yes at a terminal. With no terminal and no earlier yes, it stops before signing.
- **A step of the recipe that copies a named secret into a file**: the secret is in the image, which stays on the server. zekno cannot see this before signing. The docs say so.
- **A step that writes a named secret into a cache folder**: it stays there for later builds of the app, even builds that read no secret. zekno cannot see this before signing. The docs say so (FR-037g).
- **A step that prints a named secret**: the line reaches the zekno that sent the deploy (FR-031a). Docker's builder also keeps it in its record of the build until the runner removes that record (FR-031b). At a terminal, zekno keeps it with the last build's output on this machine (FR-071a). With no terminal, it goes to standard error, so a script's log can hold it. The docs say so.
- **A build that reads a secret, with the network on**: a step can send the secret anywhere. No signature prevents it. The question of the first yes and the docs say so.
- **A `# syntax=` line in a build that reads a secret**: refused by zekno before signing, and by the runner before the number is used, whatever check L2 shows (FR-042a; changed on 2026-11-27, item 11). So the rule that the secret reaches only the reader built into the server's Docker never rests on the server ignoring the line.
- **A Railpack build whose settings name a secret**: refused before signing, until the Linux checks show how Railpack's frontend receives secrets and that they do not land in the image (FR-037h).
- **A runner that builds but does not carry out named secrets**: a build that names one stops before signing, with a sentence that says to update the runner.

**Railpack (step 2)**

- **A new patch release of the language between two deploys**: Railpack resolves the version again, so the plan changes, and the code is sent and built again with no code change. The summary says why before signing (point 25).
- **The plan's start command and the settings' start command differ**: the settings win. The summary shows which one runs.
- **Railpack's own configuration file in the folder**: Railpack reads it on the developer's machine, among the files to send. It travels with the code and is signed with it. If it makes the plan name an image zekno holds no digest for, the deploy is refused (point 15).
- **A file left out of what is sent**: Railpack never sees it, since it runs on exactly the files zekno packs.
- **The fetch of Railpack fails** (no network, the release site down): nothing is signed, one sentence says so, and a folder with a Dockerfile still deploys.
- **Railpack cannot reach the network from this machine at a later deploy**: nothing is signed, and one sentence says that Railpack needs the network to plan the build.
- **The kept copy of Railpack was changed on disk**: it is found when checked before use, never run, and fetched again.
- **zekno is updated to a version that pins another Railpack**: the new one is fetched at the next deploy that needs it. The plan changes, so that deploy builds again.
- **"No network" for a Railpack build**: Railpack's builds download their tools, so it is not offered in this version (point 18).
- **A fresh build with Railpack**: refused before signing until the Linux checks show that Railpack's builds honour it (point 11).
- **The image Railpack builds runs as root inside its container, and starts through a shell**: as the hand test found. The docs say so.

**Versions**

- **A rollback to a deploy made before this feature** (an image deploy): as today.
- **A rollback from a machine whose history lacks that deploy**: as today, a rollback starts from this machine's history.
- **An older runner put back by hand after builds**: it refuses every request (User Story 10, scenario 6). The way back is to update the runner again. Restoring a runner's folder from a backup stays unsupported.

## Requirements *(mandatory)*

### Functional Requirements

**Which folders are built** (step 1; step 2 for folders with no Dockerfile)

- **FR-001**: `zekno deploy` MUST build on the server each service whose settings say to build, from the folder the settings name, with the builder the settings name.
- **FR-002**: zekno MUST never decide by itself to build. In a folder with a Dockerfile and neither a settings file nor a Compose file, at a terminal, it MUST ask once, showing the summary of what would be sent (FR-017) and the settings file it would write, and write the file on a yes (point 3, decided). The question MUST come first, where today's question "Deploy from which file?" is asked, before the questions about the key, the server and the app. "Don't build", Esc or Ctrl-C MUST write nothing and end with today's `✖ Nothing was done.`, as every other question declined does, and so MUST "No" at the first Railpack question of FR-060b. With no terminal, today's sentence for a folder with no Compose file stays (FR-003) (changed on 2026-11-27, choice A-c). In step 2 the same holds for a folder with no Dockerfile that Railpack recognises, once the person agreed to run Railpack on it (FR-060b, point 17).
- **FR-002a**: The settings file written MUST hold one service (its name drawn on the boards, such as `web`), its build, and a port. The question MUST propose the port: the one the Dockerfile says the app listens on when it says one, or for Railpack a default. The person MUST be able to change it, give one, or say the service has none, as for a worker.
- **FR-002b**: When the folder has no `.dockerignore`, the same question MUST also propose one and show it before writing it. It is drawn from the folder's `.gitignore`, plus dependency folders such as `node_modules` and `.venv`. The same yes writes it (point 1, decided).
- **FR-002c**: After the first deploy of a settings file zekno wrote, the result MUST say how to reach each built service that has a port and no domain. Draft: `web listens on 3000 inside prod. Give it a domain with zekno domain add <domain>, then deploy again.`
- **FR-003**: With no terminal, a folder with no settings file and no Compose file MUST deploy nothing and stop exactly as today, with today's sentence and exit status. Nothing is fetched or run.
- **FR-004**: A file named exactly `Dockerfile` at the top of the folder MUST count as the folder's Dockerfile. There are several Dockerfiles when a `Dockerfile` stands beside a file whose name starts with `Dockerfile.`, or when a `Dockerfile` is in a sub-folder that is sent. Then zekno MUST NOT choose one. The settings name it, or the person chooses in the first-deploy question and the choice is written to the settings. A folder with no file named exactly `Dockerfile`, but with files at its top whose names start with `Dockerfile.` or end with `.Dockerfile`, MUST NOT count as a folder with no Dockerfile: the first-deploy question lists those files, even when there is only one, and the person chooses, as when there are several (changed on 2026-11-27, item 19).
- **FR-005**: A folder with a Compose file, or a settings file whose services run images, MUST deploy as today, unless its Compose file asks Docker to build or names the space kept for built images (FR-075, FR-077). A Dockerfile in it changes nothing.

**The settings file** (steps 1 and 2; build secrets in step 1b)

- **FR-006**: A service in the settings file MUST be able to say that it is built, in place of naming an image to run. A service MUST have exactly one of the two. Today's refusal "Building from source is not in this version of zekno yet." MUST go.
- **FR-007**: The build settings MUST sit in the sections a Railway user knows (point 18), under Railway's names (changed on 2026-11-27, choices G-a and G-b). Under Source: `source.root`, the folder to send, and `source.include`, the secret-looking files to send (FR-015). Under Build: `build.builder`, `build.dockerfile` (the Dockerfile's path), `build.stage` (the Dockerfile's stage), `build.timeout` (the time limit) and `build.network` (the network for the build, `internet` or `none`). From step 1b, the Build section MUST also hold `build.secrets`, the secrets the build may read, named one by one (FR-037a). Plain variables need no build setting: the build reads them as FR-036a and FR-036d say.
- **FR-008**: The builder MUST be a choice between named values: a Dockerfile in step 1, then Railpack in step 2. A value this zekno does not know MUST be refused with a sentence that says to update zekno.
- **FR-009**: Paths in the build settings MUST be relative and MUST be checked when the file is read. The folder to send MUST be the settings file's folder, one inside it, or one above it up to the top of the git repository the settings file is in, never beyond. Outside a git repository, it MUST be the settings file's folder or one inside it (point 5). A path beyond that reach, or one that passes through a link that leads out of it, MUST be refused with a sentence that names the setting.
- **FR-010**: The time limit MUST be a number of seconds from 1 to 7,200, the signed bound. Left out, it MUST be 1,800 seconds (recommended, point 22).
- **FR-011**: `zekno settings`, `zekno settings set` and `unset`, `zekno settings compose`, `zekno settings init` and the settings screen MUST show and change build settings as they do other settings. Setting a build on a service that runs an image MUST replace the image as one change, shown on one change line. Setting an image on a built service MUST replace the build the same way. In a folder with a Dockerfile, and in step 2 a folder Railpack recognises once the person agreed to run it, `zekno settings init` MUST offer to build the folder instead of asking for an image, with the same port question as the first deploy. The Compose text printed MUST still equal, byte for byte, the text signed, with one exception for a built service whose key this machine cannot make alone (changed on 2026-11-27, item 18). For a Railpack build, a build that reads a named secret, or a build whose key this machine's history shows with a fresh build, the image line MUST show a marked placeholder for the key, and a note on standard error MUST say why. For a Dockerfile build that reads no secret, zekno MUST pack the folder and print the key, and a note on standard error MUST say that a fresh build made from any machine changes it.
- **FR-012**: Two services built from the same folder with the same recipe and builder, whose builds read the same plain variables with the same values and the same secrets, MUST share one build. The code travels once and is built once. When what their builds read differs, the code MUST still travel once, and each is built.

**What is sent** (step 1, used by step 2)

- **FR-013**: zekno MUST pack the folder on the developer's machine, choosing the files Docker would send from this folder, with `.dockerignore` applied by zekno itself, so that what is signed is what is built (point 1, decided).
- **FR-014**: zekno MUST never follow a link out of the folder. Links MUST NOT travel: each one is left out and listed as left out.
- **FR-015**: The `.git` folder and the files on zekno's list of secret-looking files MUST be left out unless the settings name them in `source.include` (changed on 2026-11-27, choice G-b), and MUST be listed as left out (point 2). The list holds `.env` and `.env.*` at any depth, `.npmrc`, `.netrc`, `.git-credentials`, and files whose name or content marks a private key. The plan may add names to it, and the docs show it.
- **FR-015a**: A file on that list that the settings name MUST be sent only after the person agrees to it at a terminal, once per file. The answer MUST be remembered on this machine, never in the folder. With no terminal, such a file MUST be sent only when this machine already allowed it. Otherwise the deploy MUST stop before signing and name the file.
- **FR-015b**: At a terminal, the first deploy that builds from a folder on this machine MUST show the summary and wait for a yes before signing. In a folder with no settings file, that is the yes of FR-002.
- **FR-016**: The same files MUST give the same packed bytes and fingerprint on every machine. For a Dockerfile, the same files and settings, with the same versions of the secrets the build reads, MUST give the same build key and image name. For Railpack, they MUST give the same key and image name when Railpack makes the same plan. Order, times and owners are fixed, and a file is either plain or executable, nothing else.
- **FR-017**: Before signing, zekno MUST show a summary of what it will send: the number of files, the total size, the largest folders, what was left out and by which rule, and every file on the list of FR-015 that is sent, and why. With no terminal, the same facts MUST be given as plain lines on standard error, and standard output MUST keep only today's result line.
- **FR-017a**: When the folder that is sent lies in a git repository and holds changes that are not committed (a changed file, or a new file that is sent), the summary MUST say so in one line before signing (point 1, decided). The line MUST NOT stop or delay the deploy, and MUST NOT change what is sent. Where zekno cannot tell, such as a folder outside a git repository, the line MUST be left out. To learn it, zekno MUST NOT run a program that the folder or the repository names, such as a hook or a program set in the repository's own configuration. With no terminal, the line MUST go to standard error with the summary's other facts. Draft: `This folder has changes that are not committed. They are sent as they are.`
- **FR-018**: A pack over the size a deploy can carry (512 MiB, from the design) or over the entry limit (recommended: 50,000 files and folders, point 22) MUST be refused before signing. One sentence names the size or the count, the limit, and the largest folders or the folders with the most files. Above a warning size (recommended: 100 MB, point 22), the summary MUST warn and name the largest folders.
- **FR-019**: A file zekno cannot read, or one that changes while it is read, MUST stop the deploy before signing with a sentence that names it.
- **FR-020**: zekno MUST keep no copy of the packed code after the deploy (design, Q11).

**What is signed** (step 1, for both builders)

- **FR-021**: A deploy that builds MUST be signed with everything the developer's machine can fix that decides the image. That is the code's fingerprint and size, and the fingerprint of each sealed piece. It is the recipe: the Dockerfile's path and stage, or Railpack's plan. It is the builder: its name, and for Railpack its exact version and the digests of its frontend and of every image its plan names. It is the plain variables given to the build, with their values (FR-036a, FR-036d), and the names of the secrets it may read (FR-037). It is the network choice and the time limit. And it is a request for a fresh build, when the person asks for one (point 11). The value of a secret is never signed: the deploy lists each secret's version and the fingerprint of its sealed value, as it does today.
- **FR-021a**: A fresh build, asked for with `zekno deploy --fresh` (changed on 2026-11-27, choice D-c), MUST fetch every base image again and reuse no cached step, every time it is asked for. A fresh build whose record shows that a cached step was used MUST end as failed. After it, every later deploy of the same code and recipe MUST run the fresh image or one built later, never an image built before it, except a rollback that names that earlier deploy. Where the checks of FR-089a show that a builder cannot honour a fresh build, zekno MUST refuse a fresh build with that builder before signing, with a sentence (point 11).
- **FR-022**: The build's key MUST be made from the code's fingerprint, the recipe (the Dockerfile's path and stage, or Railpack's plan), the builder (its name, and for Railpack its version and the digests of its frontend and images), the plain variables given to the build with their values, what the deploy lists for each secret the build reads (FR-037e), and the network choice, and from nothing else but what FR-021a needs. The fingerprints of the sealed pieces, the size and the time limit are signed, but MUST NOT change the key. The key MUST name the image the signed Compose text runs, under a name no registry can answer for. Changing any part of the key MUST change the key.
- **FR-023**: The runner MUST compute the key again from what is signed, and refuse a deploy whose signed key differs, with no number used.
- **FR-024**: The signed format MUST name each build's builder, so that a later builder (Cloud Native Buildpacks, D5) adds a value, not a new format. This changes the shape of the build entry feature 014 reserved, which no released runner carries out. The signed format of step 1 MUST already hold the Railpack builder's entry: its version, the digests of its frontend and images, and the plan's fingerprint. Step 2 adds behaviour and a protocol number, not a field. The entry feature 014 reserved already holds a build's plain values and the names of its secrets (the design, part 4.1 (b)), so step 1b adds behaviour, not a field.
- **FR-025**: zekno MUST check a deploy that builds against the runner's rules before signing, so that it never signs what the runner would refuse as malformed.

**Sealed for the server** (step 1)

- **FR-026**: The code MUST be sealed on the developer's machine for the server's key, taken from the signed team list, in pieces, over SSH as well. A machine other than the server MUST be unable to open it.
- **FR-027**: Railpack's plan MUST travel sealed with the code. Of a build, a relay MUST be able to read no more than: the Dockerfile's path and stage, the builder and its version, the digests of its frontend and images, the plain variables given to the build with their values, the names of the secrets it reads, the network choice, the time limit, a request for a fresh build, the sizes, the number of pieces, the fingerprints and the build key. A relay already reads the plain variables in the signed settings, and each secret's name, version and the fingerprint of its sealed value in the signed deploy. It MUST never read a secret's value, or anything made from the value by a plain hash. The builder's output is not among what a relay may read. When deploys go through the hosted service, it MUST travel sealed for the deployer, or not at all.
- **FR-028**: The runner MUST take a piece only for a signed deploy that can still run and that names that piece, within the design's staging bounds (2 GiB in all, kept at most 24 hours).
- **FR-029**: Before the number is used, the runner MUST check each build it does not keep: every piece is there, each opens, and the opened bytes have the signed size and fingerprint. Each piece MUST open to at most its bound, and the runner MUST stop reading a piece at its bound. A missing or wrong piece MUST be refused with no number used. zekno MUST then send what is missing.
- **FR-029a**: Each piece MUST be compressed before it is sealed. The code's fingerprint MUST stay that of the uncompressed code, so it is the same on every machine. When pieces are missing, the runner MUST say which, so that zekno sends only those within the same run (point 8).
- **FR-030**: While it checks the code, the runner MUST accept only the one form zekno makes. Entries are plain files and folders. Names are valid text and relative, with no `..`, no empty part and no control character, each once, in the one order zekno writes them. Modes, owners and times are the fixed ones, and the code ends where its form says it ends. Anything else MUST be refused before the number is used.
- **FR-031**: Nothing opened from the code MUST be written to the runner's own folder, which holds its key, its state and its records. That folder MUST hold only sealed pieces.
- **FR-031a**: The builder's output MUST go only to the zekno that sent the deploy, in its session. The runner MUST keep none of it, and MUST remove Docker's own record of it (FR-031b). Its record of a build MUST hold the outcome and its reason, never the builder's lines. The reason MUST be one of a fixed list (a step failed, out of memory, out of disk, the time limit, the wrong processor, a cached step used where none was allowed, stopped after a team list change, the runner restarted, and, where the plan's check L9 settles its item 17 as (a) or (c), the build's record shows it used an image in the space kept for built images, draft name `reserved_image`; changed on 2026-11-27, item 17), never text the builder printed and never the failing step's command. The step and its error reach only the zekno that sent the deploy (FR-071).
- **FR-031b**: Docker's builder keeps its own record of each build in Docker's storage on the server, with the builder's output and the build arguments (the records `docker buildx history` reads). After each build, whatever the outcome, the runner MUST remove that build's record, found by the reference the builder gives for that build, and never a record of a build it did not start. The plan states how a record is removed when the runner restarts during a build. Until the checks of FR-089 show that this works, the docs MUST say that Docker keeps the builder's output on the server.

**How the server builds** (step 1; Railpack in step 2)

- **FR-032**: The runner MUST start every build in one fixed way, written in its own code. Only the signed recipe, builder, plain variables given to the build, names of the secrets it reads, network choice, time limit and fresh-build request change it.
- **FR-033**: A build MUST never be given the host's network, the server's devices, steps that run outside the builder's sandbox, the server's SSH keys or connections, any file of the server beyond the code sent, any other source beside the code sent and, for Railpack, its signed frontend and images, or a way to write its output anywhere but the server's Docker images. A test MUST fail if the runner's way of building ever asks for one of these.
- **FR-033a**: The program that starts a build MUST run in an environment the runner fixes. That environment MUST hold no variable and no secret of the deploy but what FR-036d and FR-037 hand to the build, each under a name the runner picks.
- **FR-034**: The runner MUST choose itself the program that reads the recipe. For a Dockerfile, it is the one built into the server's Docker (point 4, decided). For Railpack, it is the frontend whose digest is signed. Neither a deploy nor a file in the folder MUST be able to choose another.
- **FR-034a**: The runner MUST refuse a build, before the number is used, on a server whose Docker is older than the oldest version on which FR-034, FR-035 and FR-061 were shown to hold. Until the Linux checks of FR-089 say otherwise, that is Docker Engine 29.5 (research, part 8, claim 1). zekno MUST stop such a deploy before signing wherever it already knows the server's Docker version. One sentence names the server's Docker version, the version needed and how to update (draft in User Story 9). Deploys of images MUST still work there.
- **FR-035**: Each app's build cache space MUST be its own, so that one app's build cannot read or fill another app's cached folders.

**Variables and secrets in a build** (point 19, decided: plain variables in step 1 for a Dockerfile and in step 2 for Railpack; named secrets in step 1b)

- **FR-036**: No build argument MUST reach a build except those the runner sets for FR-034, FR-035 (for Railpack, its frontend's `cache-key`, set per app) and FR-037d, the value of FR-036d that tells Railpack's frontend when what its steps read changed, the ten proxy names the runner passes empty, and the plain variables of FR-036a, signed. Settings of the server's own Docker client, such as proxy settings, MUST NOT add any: the runner passes `HTTP_PROXY`, `HTTPS_PROXY`, `FTP_PROXY`, `NO_PROXY`, `ALL_PROXY`, `http_proxy`, `https_proxy`, `ftp_proxy`, `no_proxy` and `all_proxy` empty, so that the client's proxy settings reach no step (changed on 2026-11-27, item 13). A build argument under a name the builder reads as an instruction to itself MUST be refused: zekno never signs one, and the runner refuses a signed build that carries one, with no number used. A plain variable under such a name is left out of the build, and the deploy goes on (FR-036b). Private base images MUST still work when the server's Docker is logged in to their registry, as images do today.
- **FR-036a**: For a Dockerfile build (step 1), zekno MUST give the build exactly those plain variables of the service whose names the Dockerfile declares with `ARG` anywhere in the file: in any stage, including stages the chosen stage does not use, and before the first `FROM`. Each is given with its value from the settings, and no other variable is given. zekno MUST find these names by reading the Dockerfile as Docker reads it (FR-042). A change to a plain variable the Dockerfile does not declare MUST NOT change the build key.
- **FR-036b**: A plain variable whose name zekno keeps for itself, or that the builder reads as an instruction to itself (FR-036), and, for a Railpack build, a name of FR-037b, MUST never be given to a build. When the Dockerfile declares such a name with `ARG`, or a Railpack build would read it, the summary MUST say that the build was not given it (FR-072b), and the deploy goes on.
- **FR-036c**: zekno MUST refuse before signing a deploy whose builds would be given more plain variables, or longer values, than a build can carry (from the design: 32 per build, each value at most 4 KiB, 64 KiB in all per deploy). One sentence names the service, the variable or the count, and the limit. The 4 KiB is counted in bytes, so a value the settings allow can still pass it.
- **FR-036d**: For a Railpack build (step 2), every plain variable of the service but those FR-036b leaves out MUST reach the build's steps, signed with the build, as Railway does: Railpack's plan declares nothing zekno can read in its place. Railpack's documentation says its frontend receives variables as build secrets whose names its plan lists, and that its cached steps are made again only when the build argument `secrets-hash` changes. The runner MUST hand the frontend only the signed plain variables, in the way the checks of FR-089a show, whatever names the plan lists. Handed over as build secrets, a plain variable under a name of FR-037b would be sent as a credential, so it MUST never be given to a Railpack build (FR-036b). The runner MUST pass as `secrets-hash` a value made only from signed fields: the build's plain variables with their values, and, once named secrets come to Railpack builds (FR-037h), each one's name and the fingerprint of its sealed value. A change to any of them makes a new build key, and every step that reads them MUST run again. A service whose plain variables given to the build pass the limits of FR-036c MUST be refused before signing with the sentence of FR-036c, which says how many it has and the limit. How Railpack's frontend receives them MUST be established by the checks of FR-089a before step 2 relies on it.
- **FR-036e**: When a Dockerfile declares with `ARG` a name that is a secret of the app, the build MUST NOT be given it. The summary MUST say that a secret never reaches a build through `ARG`, and how a build reads one: named in the build settings and read as a mounted secret (from step 1b). The deploy goes on.
- **FR-037**: No secret of the deploy MUST reach a build, its steps or the program that starts it, unless the build settings name it, one by one, as a secret the build may read (step 1b). Nothing is passed by itself: a secret the running service reads MUST NOT reach its build unless it is named. Each named secret MUST reach a build only as a mounted secret, which the recipe reads under the secret's own name, never as a build argument. The way the runner hands it over MUST put nothing of it in the image, its history, its metadata or the build cache. The program that starts the build MUST receive it only under a name the runner picks, never under the secret's own name, so that no secret can act as a setting of that program.
- **FR-037a**: Each secret the build settings name MUST be a secret of the app, set with `zekno secret set` and not removed. It need not be one the running service reads. A name that is not such a secret MUST be refused before signing, with a sentence that names it. `zekno settings`, `set` and `unset` MUST show and change these names as they do other settings (FR-011). `zekno settings set` MUST refuse, with exit status 2, a change it can judge wrong from the settings file alone: one that would leave a build naming a secret of FR-037b, more than 32 secrets for one build (from the design), or any secret for a Railpack build (FR-037h). Whether a name is a secret of the app is checked when the app deploys. A deploy whose settings name a secret that this requirement, FR-037b or FR-037h refuses, or more than 32 for one build, MUST stop before signing with exit status 1.
- **FR-037b**: A secret whose name the builder treats as a credential it sends when it fetches from a host MUST never be given to a build, whatever the settings say: `GIT_AUTH_TOKEN`, `GIT_AUTH_HEADER`, and every name that starts with `HTTP_AUTH_TOKEN_` or `HTTP_AUTH_HEADER_`, whatever the case of its letters. zekno MUST refuse such a setting before signing with a sentence, and the runner MUST refuse a signed build that names one, with no number used.
- **FR-037c**: A named secret MUST reach no program that reads the recipe but the one the runner chooses (FR-034). A `# syntax=` line, or anything else in the folder or the deploy, MUST NOT make the builder hand a secret to another program. Build secrets therefore rest on point 4's decision, and on the same Docker Engine 29.5 floor as every build (FR-034a): on an older Docker, a build that reads a secret is refused before the number is used. A test MUST show that a frontend named by a `# syntax=` line receives no secret.
- **FR-037d**: A cached step built while a named secret was mounted MUST be reused only by a later build of the same app that reads that secret with the same fingerprint of its sealed value (FR-037e). No other build MUST reuse it: not a build of another app on the server, whatever its secrets are named; not a build of this app that no longer reads that secret, or reads it with another fingerprint; and not a build that reads no secret at all. The plan states how, after the checks of FR-089. If the way chosen hands the builder a value that changes when a named secret changes, that value MUST be made only from the fingerprints of the sealed values the deploy already lists (FR-037e), never from a secret's value. Where the plan cannot show it, a build that reads a named secret MUST reuse no cached step, and no other build MUST reuse a step it made. If the plan finds no way to keep other builds from reusing such a step, it MUST bring this to the maintainer before step 1b is built. A build that may reuse no cached step, and whose record shows that a cached step was used, MUST end as failed, as FR-021a does. The record of FR-066 MUST say whether the cache was used.
- **FR-037e**: A named secret set again, or another secret named, MUST make a new build key, so that a kept image built with an earlier value is never reused. The key MUST take in, for each named secret, only what the signed deploy already lists for it: its name and the fingerprint of its sealed value (the design, part 4.1 (b) and part 4.5). Neither a secret's value nor anything made from the value by a plain hash MUST appear in a signed or relayed field.
- **FR-037f**: At a terminal, the first deploy that gives a secret to the build of a service MUST show the summary and wait for a yes, once per secret, service, app and server. The question MUST say that a build that reads a secret and reaches the internet can send it anywhere, and that no signature prevents it. The answer MUST be remembered on this machine, never in the folder. With no terminal, a secret MUST be given to a build only when this machine already gave that yes. Otherwise the deploy MUST stop before signing and name the secret, as FR-015a does for a file. The question MUST also name each base image of that build named without a digest (FR-042a). `zekno settings set --yes`, which names a secret for a build, writes the setting only. It MUST NOT count as this yes, and no option of any command gives it.
- **FR-037g**: The docs MUST say plainly that a build that reads a secret and has the network can send that secret anywhere, and that no signature prevents it. They MUST also say that a named secret never leaves the customer's own server, so Zekno cannot read it, but that it travels further on the server than today: it is handed to steps that run other people's code and download from the internet. And they MUST say that a step that copies a secret into a file puts it in the image, that a step that prints it puts it in the build's output (FR-031a, FR-031b, FR-071a), and that a step that writes it into a cache folder (`RUN --mount=type=cache`) leaves it there for later builds of the app, even builds that read no secret and reuse no cached step. They MUST say that the yes is asked once per secret, service, app and server, and not again when the recipe changes. They MUST show how a Dockerfile step reads a named secret, and that `ARG` never receives one.
- **FR-037h**: For a Railpack build, zekno MUST refuse before signing a setting that names a secret the build may read, with a sentence (draft in User Story 12), and the runner MUST refuse a signed Railpack build that names a secret, with no number used. This holds until the checks of FR-089a show how Railpack's frontend receives secrets, that they do not land in the image, and that nothing made from their values does. Railpack's documentation asks for a hash of the secret values as the build argument `secrets-hash`. The runner MUST instead make that value only from signed fields (FR-036d). zekno MUST give `railpack prepare` each secret's name with a stand-in value, never the value (FR-056). Lifting this refusal takes a protocol number of its own (FR-081).

**How the server builds, continued** (step 1; Railpack in step 2)

- **FR-038**: The network choice MUST be applied as signed. The summary and the docs MUST say that "none" covers the build's own steps only: the builder still fetches base images, and for a Dockerfile, files named by a web address.
- **FR-039**: A build MUST be stopped at its signed time limit. The outcome is then a failed build. The deploy lock and the free-disk check MUST hold until no step of the build still runs on the server. When a build was stopped, no process of it is alive, and Docker's record of it (FR-031b) still says it runs 10 minutes after the stop, the build MUST be taken as ended: the runner records its outcome, frees the lock, keeps what it needs to remove the record later, and `zekno doctor` names the record that still runs (changed on 2026-11-27, item 28).
- **FR-040**: A build MUST NOT start when free disk on the server is below a fixed floor. The floor MUST be checked before the number is used, and a deploy below it refused with no number used. The runner MUST also stop a build whose run brings free disk below the floor. The outcome is then a failed build, out of disk. The floor is a fixed number that the plan confirms from the measurement of FR-089, and the tests use it (recommended: 2 GiB, point 22).
- **FR-041**: A built image whose processor type is not the server's MUST end the build as failed, with a sentence that says so.
- **FR-042**: zekno MUST refuse before signing a Dockerfile that names an image in the space Zekno keeps for built images, so that one app cannot build from another app's image, which holds that app's code. zekno MUST read every place a Dockerfile names an image as Docker reads it: every base image, every copy from another image and every mount taken from another image, with build argument defaults, the values of the plain variables given to the build (FR-036a), the escape line and heredocs. It MUST resolve each name fully before signing. A name it cannot resolve fully MUST be refused, not passed.
- **FR-042a**: The summary MUST say when the Dockerfile has a `# syntax=` line, which the server ignores (FR-034). If the plan's check L2 does not show that the server ignores the line, at the floor and at the newest engine on both image stores, zekno MUST instead refuse such a Dockerfile before signing, and the runner before the number is used. In a build that reads a named secret, a `# syntax=` line MUST be refused that way whatever L2 shows, so that FR-037c never rests on the server ignoring the line (changed on 2026-11-27, item 11). zekno MUST refuse before signing an `ADD` of a web address or a git repository that has no checksum. It MUST also refuse an `ADD` whose address names the server itself or a private address, even with a checksum. It MUST read each address as it reads image names in FR-042, with the plain variables given to the build. It MUST warn in the summary on a base image named without a digest (point 4, decided). In a build that reads a named secret, the warning MUST say that whoever answers for that image's name can read the secret.
- **FR-043**: A failed build MUST use the deploy's number. The runner MUST change nothing of the app that was running: it does not stop, replace or re-route it, and its routes and domains stay as they were. The runner MUST NOT record an image from a failed or stopped build, so it is never reused.
- **FR-043a**: The docs and the out-of-memory sentence MUST say that a build shares the server's memory, processor and disk with the apps already running. They MUST say that a build that runs out of memory can make the server stop other programs, the running app among them (point 9).
- **FR-044**: A deploy that builds MUST hold the server's deploy lock, so other deploys to that server wait or are told the server is busy. The busy sentence MUST name the app that is building, how long it has been building, and its time limit. A team list update, and an upload for a later deploy, MUST NOT wait for a build (point 7). When a team list taken during a build no longer lets the deploy's signer deploy to this server, the built app MUST NOT start. The deploy then ends as stopped, its number used, the app that was running keeps running, and the sentence names the team list version.
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
- **FR-055**: What was fetched, from where, and that it matched MUST be said (point 12). With no terminal, that line MUST go to standard error. Every deploy with the Railpack builder MUST run Railpack on this machine, which needs the network. When Railpack cannot reach it, the deploy MUST stop before signing with one sentence that says so. The docs MUST say plainly that Railpack runs on the developer's machine, reads the files to send, and reaches the network to find versions.
- **FR-056**: zekno MUST run Railpack on exactly the files it packs, not on the folder as it is on disk. Railpack's arguments and environment MUST hold no secret value and no key.
- **FR-057**: On a system for which zekno carries no Railpack checksum, a deploy with the Railpack builder MUST stop before signing with a sentence that says so.
- **FR-058**: When Railpack cannot make a plan, zekno MUST stop before signing with Railpack's reason (point 14).
- **FR-059**: Before signing, the summary MUST show a short form of the plan: the language and its version, the install, build and start commands, and the images it names. A command, `zekno settings plan` (changed on 2026-11-27, choice I-a), MUST print the whole plan, as `zekno settings compose` prints the Compose text (point 13). The summary MUST say when the plan changed since the app's last deploy, and why when it is known, such as a new patch release of the language.
- **FR-060**: A plan that names an image zekno holds no digest for MUST be refused before signing (point 15).
- **FR-060a**: When the folder has no lockfile, the summary MUST warn that the server may install other versions than the developer tested, and the deploy goes on (point 16).
- **FR-060b**: In a folder with no Dockerfile, no settings file and no Compose file, zekno MUST ask at a terminal before it fetches or runs Railpack, and say what will happen (point 17). With no terminal, it MUST fetch and run nothing.

**When nothing changed, and rollback** (step 1; FR-064a in step 1b)

- **FR-061**: When the runner keeps an image under a build's key, and the image under that name is still the one it recorded, it MUST reuse it, within the rule of FR-021a: no code is sent and nothing is built.
- **FR-062**: The runner MUST never trust an image's name alone. When the name leads to another image, it MUST ask for the code and build.
- **FR-063**: A rollback to a deploy that built MUST carry that deploy's builds, so that the kept images are reused.
- **FR-064**: When the server no longer keeps a build a rollback needs, the rollback MUST be refused with no number used. zekno MUST say that the old code is no longer on the server, and how to go back. A rollback MUST never build again by itself.
- **FR-064a**: A rollback to a deploy whose build read a secret that was set again or removed since MUST stop before signing. The server cannot reuse a build made with an earlier value (FR-037e), a removed secret cannot be given to a build (FR-037a), and a rollback never builds again. One sentence names the secret, says whether it was set again or removed, and how to go back (draft in User Story 8).
- **FR-065**: This machine's history MUST keep, for each accepted deploy, what a rollback needs to carry its builds.

**What the runner records, and disk** (step 1)

- **FR-066**: For each build, the runner MUST record the image's id, the builder and its version, the server's Docker version and the version of the builder inside it, the program that read the recipe (for Railpack, its frontend's digest), whether the builder's cache was used, and the digests of the base images where it can learn them. `zekno status` MUST show them as the server's word, not as something signed.
- **FR-067**: The runner MUST always keep the images of the deploy an app runs now. Beside them, it MUST keep the images of the two most recent other deploys of the app whose builds succeeded, counting once the deploys that reused the same images. A failed build, and a deploy that reused kept images, MUST never push an image out. The runner MUST remove older images it made, found from its own records, never from a list of every image on the server.
- **FR-068**: The runner MUST bring the builder's cache within a bound after each deploy (10 GiB in the design; point 9). The docs MUST say that this covers builds made outside Zekno on the same server.
- **FR-069**: Staged pieces MUST be cleaned as the design says: at most 2 GiB in all, none older than 24 hours, none of a deploy that can no longer run.

**What a person sees** (steps 1, 1b and 2)

- **FR-070**: The deploy's stage row MUST gain a build stage between Sent and Starting, named `Building` while it runs or when it failed, and `Built` once done. It MUST show the upload's progress, then the builder's latest line, or that the build was reused and nothing was sent. When every build of the deploy was reused, the stage MUST read `Reused`, and the line that nothing was sent MUST stay under the stage row once the deploy ended (changed on 2026-11-27, choices D-a, D-b and D-e). The terminal app's deploy screen MUST show the same.
- **FR-071**: A failed build MUST be said in one sentence: that the build failed, why when it is known (a step failed, out of memory, out of disk, the time limit, the wrong processor), and which deploy still runs, or that none runs yet. The step that failed and the error the builder gave for it MUST follow in the "Docker said" panel, then the builder's last lines (recommended: 40, point 22).
- **FR-071a**: At a terminal, zekno MUST keep the whole output of each app's last build on this machine, replacing the one before, and the failure sentence MUST say how to read it: with `zekno logs --build` (point 23; changed on 2026-11-27, choice E-b). With no terminal, the builder's lines MUST go to standard error as they come, as Docker's lines do today.
- **FR-071b**: With no terminal, a failed build MUST end with the exit status of a deploy whose app did not start. `--json` MUST give a failed-build outcome with its reason (draft name: `build_failed`), as feature 015 added `routes_failed`. Every new refusal of a deploy MUST end with exit status 1, as a fault in the settings does. A new setting value that `zekno settings set` refuses MUST end with exit status 2, as other values do.
- **FR-072**: The summary MUST say what the signature does not fix, naming what applies to the builder: for a Dockerfile, base images named by tag and what its steps download; for Railpack, the packages and language tools its steps download. When a built service has plain variables or secrets that its build does not read, the summary MUST also say, in one line, that only the running app sees them (point 19, decided). These lines MUST show at the first deploy from the folder on this machine, and again when what they say changes (changed on 2026-11-27, choice B-a). The docs MUST also name the server's builder version, base images already on the server, and steps reused from the server's build cache, which every app on the server shares.
- **FR-072a**: For a built service with a port, zekno MUST set a plain variable `PORT` to that port, unless the settings set `PORT` themselves. The summary and the Compose text MUST show it. Services that run an image MUST NOT change (point 20).
- **FR-072b**: Before signing, the summary MUST name every plain variable and every secret each build will read. A secret is named only, never shown. The summary MUST also name each plain variable the build is not given under FR-036b: for a Dockerfile, one it declares with `ARG`; for Railpack, any. With no terminal, these MUST go to standard error with the summary's other facts (FR-017).
- **FR-072c**: When a deploy builds again only because a plain variable or a secret the build reads changed, the summary MUST say so before signing and name it, a secret by name only. Draft: `API_URL changed, and the build of web reads it, so web is sent and built again.`
- **FR-073**: Every new refusal and failure MUST have one sentence in the house pattern: what happened, what it means, what to do.
- **FR-074**: With no terminal, every existing command MUST behave exactly as before for apps that do not build, with two stated exceptions (changed on 2026-11-27, item 21). A hand-written Compose file that asks Docker to build, and a Compose file or settings file that names the space kept for built images, are refused before signing (FR-075, FR-077). Such files are signed and sent today. This is a security change the maintainer approved on 2026-11-26 (point 6, decided). The second exception, approved by the maintainer on 2026-11-27: three of today's sentences about settings change for every app, because a service can now have a build. They are said for a service with neither an image nor a build, for `zekno settings unset` of the image of a service with no build, and for a setting not known, whose sentence lists the settings (lines C26, G16 and G18 of `design/lines.md`). No frozen transcript of plain output holds any of them. Otherwise the frozen transcripts of plain output MUST NOT change.

**Hand-written Compose files** (step 1)

- **FR-075**: zekno MUST refuse before signing a hand-written Compose file in which a service asks Docker to build, with a sentence that says how to build with Zekno (point 6, decided).
- **FR-076**: The runner MUST start every app in a way that never builds an image from the Compose text, whatever the text says.
- **FR-077**: zekno MUST refuse before signing a hand-written Compose file or a settings file that names an image in the space Zekno keeps for built images.

**zekno doctor and zekno status** (step 1; Railpack's line in step 2)

- **FR-078**: `zekno doctor` MUST say, for each server that holds a built app, and for every server when asked to check builds, whether it can build. That covers a runner that builds, Docker's build plugin, Docker at least the version FR-034a names, free disk above the floor, the server's memory with a warning below the figure of point 22, and the processor type. Its plain output for other servers MUST stay as before. A server that cannot build MUST still deploy images as before.
- **FR-079**: On the same servers, `zekno doctor` MUST show the disk Zekno's builds take. On this machine, once it has fetched Railpack or when asked, it MUST say whether the pinned Railpack is there and matches its checksum.
- **FR-080**: `zekno status` MUST show, for an app built on the server, that it was built, with which builder, when, and the record of FR-066.

**Old and new programs** (steps 1, 1b and 2)

- **FR-081**: The protocol number MUST go up by one with step 1, and again with step 2, so that zekno knows before signing which builders a runner carries out. Step 1b MUST ship no later than the release that ends step 2. It comes with the protocol number of the first release that carries it, step 1's or step 2's, and adds none of its own, so that zekno also knows before signing whether a runner carries out named build secrets. Named secrets for Railpack builds, when they come later (FR-037h), MUST come with a protocol number of their own, so that zekno knows before signing whether a runner gives a Railpack build a secret.
- **FR-082**: zekno MUST stop before signing a deploy whose build the runner cannot carry out, and say to update the runner (drafts in User Story 10). A deploy without a build MUST behave as today on every runner.
- **FR-083**: A runner MUST refuse, with no number used, a build whose builder it does not carry out, whatever the shape of its build entry. It MUST never build it with another builder. A runner that does not carry out named build secrets MUST refuse, with no number used, a build that names one, and never build it without the secret. A test MUST show this for runner 0.1.1, for a runner of step 1 handed a signed Railpack build, and, if step 1b ships after step 1, for a runner of step 1 handed a signed build that names a secret.
- **FR-084**: A zekno from before this feature MUST stop before signing against the new runner, with the sentence feature 014 built for a runner that speaks a newer protocol. That behaviour does not change.
- **FR-085**: An older runner put back by hand after this feature's runner wrote its state MUST refuse every request rather than read that state wrongly, as feature 014 made it. The docs MUST say that the way back is to update the runner again. A server updated from runner 0.1.1 MUST keep its apps, routes and domains working.

**Docs, review, release**

- **FR-086**: The docs MUST gain a page on building from source. It covers both builders; what is signed, and what is not; what lands on the server in plain text, and that Docker's builder keeps a record of each build, with its output, until the runner removes it (FR-031b); that a build shares the server's memory, processor and disk with the apps already running, and that one out of memory can make the server stop other programs, the running app among them; that what the builder prints can quote the code, and anything a step prints; that the list of secret-looking files is a convenience, not a guarantee; and that an image Railpack builds runs as root inside its container. It MUST say which plain variables a build reads for each builder, that a service built with Railpack can give its build at most 32 of them (FR-036d), and that a plain variable given to a build is readable by a relay, as it already is in the signed settings, and, for a Dockerfile, stays readable in the image's history. It MUST say what FR-037g lists about named build secrets. The pages on settings, deploying, rollback, doctor, secrets and security MUST say what changes.
- **FR-087**: The README's "What works today", its security model and its roadmap MUST be brought up to date. The security model MUST say what is new: the server holds the code in plain text, in Docker's storage and in the image; what a build downloads is not fixed; a build shares the server's memory with the running apps; what the builder prints can quote the code; what a relay would learn of a build, the plain variables it reads among it; and that a secret named for a build stays on the customer's own server but is handed to the build's steps, which can send it anywhere when the build has the network, with no signature to prevent it. It MUST also say: Railpack, at the version zekno pins, and its frontend are trusted as zekno is. Railpack runs with the developer's own rights on the machine that signs, and its plan decides what the server runs. The checksum makes every machine run the copy the maintainer approved. It does not make that copy safe.
- **FR-088**: An independent security review MUST cover the new surface before each step is merged: packing, sealing and sending the code; the runner's checks; the way it builds; the Railpack folder; kept builds and pruning; the Railpack fetch; the rule on Compose files; and the plain variables and named secrets given to builds. Step 1b MUST have this review before it is merged, as each step does.
- **FR-089**: The first step of the plan MUST run, on Docker on Linux and on both of Docker's image stores, the checks the research lists as not established, before the plan relies on them (research, part 6, "To try"). They MUST include: what runner 0.1.1 does with a signed Compose file that asks for a build; the checks of FR-034, FR-035 and FR-061 on Docker Engine 29.5, the oldest version FR-034a allows, and on an older engine; whether the builder stops when the program that started it goes; an out-of-memory build while an app runs beside it, in a container held to 1 GB of memory (a stand-in, FR-089b); the disk a 512 MiB build uses, which sets the floor; that private base images work with the server's registry logins while the client's proxy settings stay out of builds; whether the runner can learn the base images' digests after a build on both image stores (point 4, decided); on both image stores, that after a build in which a step printed a marker, and after the runner removed the build's record, the marker is found nowhere in Docker's storage on the server or in the runner's folder (FR-031b); and the upload times of SC-003. Before step 1b relies on them, they MUST also include: that a named secret reaches the step that reads it and stays out of the image, its history, its metadata and the build cache; that a frontend named by a `# syntax=` line receives no secret; that a secret under a name of FR-037b never reaches the builder; whether a step built with a secret is reused after the secret's value changed, by a build of the same app that no longer reads the secret, or by another app's build with an identical step that reads a secret of the same name or none (FR-037d); and whether a build run with no cached step still reads the app's cache folders. The docs MUST say what was found, and where each check ran (FR-089b).
- **FR-089a**: The first step of step 2's plan MUST run the Railpack checks on Linux: the pinned frontend on both image stores; a plan made on macOS, built on Linux on x86-64; whether Railpack makes the same plan on macOS and on Linux; whether "no network" and a fresh build reach Railpack's steps (R10); the checks of FR-049 and FR-049a; that Railpack's release has a file for each system zekno carries a checksum for; whether Railpack must be given the plain variables when it plans on the developer's machine, and whether its frontend receives them as build secrets (FR-036d); that a change to one plain variable makes Railpack's steps run again through `secrets-hash`; that `cache-key` keeps one app's cache folders from another's (FR-035); and how it would receive a secret, whether that secret or a hash of its value then lands in the image, its history or its metadata, and whether a name given to `railpack prepare` with a stand-in value is enough for the plan (FR-037h).
- **FR-089b**: A check MUST run on GitHub's own Linux machines on every push, as the maintainer agreed on 2026-11-26 (D10). It runs the Linux checks of FR-089 and FR-089a, and each step's proof, except what it cannot show. While building, the same checks MUST also be able to run in a throwaway Linux container on the maintainer's Mac. Where each check runs:
  - On GitHub's Linux machines: runner 0.1.1 and a Compose file that asks for a build; the checks of FR-034, FR-035 and FR-061 on both image stores; whether the builder stops when the program that started it goes; the disk a 512 MiB build uses; private base images, with a registry the check starts itself (a stand-in) and the client's proxy settings; the base images' digests; Docker's record of a build and its removal (FR-031b); the checks of step 1b; every check of FR-089a but the one on macOS; the Linux side of SC-013; and, on GitHub's ARM64 Linux machines, a build on Linux on ARM64 (changed on 2026-11-27, item 4).
  - On GitHub's Linux machines, with the engines the plan establishes there: Docker Engine 29.5 and an older engine, for FR-034a. The plan MUST first check which Docker Engine GitHub's machines carry, since that is not known. If it is older than 29.5, the plan MUST say how the check gets Docker Engine 29.5 or newer, such as a pinned engine the check installs, and the maintainer approves that as a tool (FR-091). The older engine is got the same way. The maintainer approved the plan's way on 2026-11-27: a server stand-in with Docker's own packages at exact versions, which holds Docker Engine 29.5.0, the same without its build plugin, older engines, and the newest engine, pinned and raised by hand, on which the checks that FR-037c and FR-037d rest on also run (changed on 2026-11-27, items 2 and 6).
  - In the throwaway container on the maintainer's Mac: the same checks while building; a build on Linux on ARM64; the upload times of SC-003, over a link held to 10 Mbit/s with 50 ms of latency.
  - On the maintainer's Mac, and on GitHub's macOS machines on every push: the macOS side of SC-013 and of the Railpack checks that compare macOS with Linux. Their Linux side runs on GitHub's Linux machines, which also build the plan made on the Mac, on x86-64. The Mac side still runs by hand too (changed on 2026-11-27, item 5).
  - In a container held to 1 GB of memory, on either: an out-of-memory build while an app runs beside it. It shows what the builder reports and what zekno says. It does not show what a real server with 1 GB of memory does to the apps running there.

  Neither GitHub's machines nor a local container can show a real domain over HTTPS, or the behaviour of a small server with 1 GB of memory. The real domain is shown once, by the proof on the maintainer's own server at the end of step 2 (FR-090). The behaviour of a 1 GB server is not measured under this arrangement. The docs and the plan MUST NOT state a finding about it that was not measured on such a server.

  The check MUST use only keys, team lists and secret values it makes itself during the run, with marker values in place of real secrets. It MUST hold no repository secret, and never a key or SSH access to the maintainer's server. The real-domain proof MUST never run from it.
- **FR-090**: Steps 1 and 2 MUST each end with a runner development release: 0.1.2-dev.1 after step 1 and 0.1.2-dev.2 after step 2 (point 21, with D10). Step 1b ends with neither: it ships in one of them (FR-081). The proof of step 1 MUST run on GitHub's Linux machines and in a throwaway Linux container (FR-089b), not on a real server. The maintainer's own server MUST be used once, at the end of step 2, for one proof that covers steps 1, 1b and 2 with a real domain over HTTPS, with a go-ahead at the time. Release numbers stay in the 0.1 line. Tags, releases, merging into `main` and every use of the maintainer's server are the maintainer's steps, each with a go-ahead.
- **FR-091**: No package or tool MUST be added without the maintainer's agreement. The Railpack version zekno pins is approved by the maintainer.
- **FR-092**: Every new or changed line a person sees MUST be approved by the maintainer on boards before it is built. Every new sentence quoted in this spec is a draft. Sentences quoted from today's zekno are marked "today's". The 18 boards were approved on 2026-11-27 (D14, M2). A line written or changed after the approval of 2026-11-27, such as the new lines of the plan's item 23, is a draft, marked as one, and MUST be shown to the maintainer before its screen is built (changed on 2026-11-27).
- **FR-093**: Every sentence MUST keep the project's wording rules: "runner", never "agent"; pre-alpha and unaudited stay visible; nothing is promised that is not built.

### Key Entities

- **Build**: one service's image, built on the server from the code sent, with a builder and a recipe. Signed.
- **Code sent (the pack)**: the folder's files as zekno packed them, the same bytes for the same files on every machine. It has a fingerprint and a size, and travels in sealed pieces.
- **List of secret-looking files**: the names and contents zekno leaves out unless the settings name them, and sends only after a yes on this machine. A convenience, not a guarantee.
- **Summary**: what zekno shows before signing: files, size, largest folders, what was left out and why, every secret-looking file sent and why, every plain variable and every secret (by name) each build reads, and what the signature does not fix.
- **Build variables**: the plain variables of a service that its build reads: for a Dockerfile, those it declares with `ARG`; for Railpack, all of them but those FR-036b leaves out, at most 32. Signed with their values, readable by a relay, and in the build key.
- **Build secret**: a secret of the app that the build settings name, one by one, as one the build may read, and that this machine agreed to give to that build. It reaches the build as a mounted secret under its own name, never as a build argument. Its name is signed. Its value never is. A mounted secret is a file that only the step of the recipe that asks for it can read, while that step runs (in a Dockerfile, `RUN --mount=type=secret,id=NPM_TOKEN`). It is not saved in the image. A build argument is a value a Dockerfile declares with `ARG`. Docker can keep it in the image's history, the list of steps that anyone who has the image can read, and in the image's metadata.
- **Builder**: a Dockerfile, read by the server's own Docker; or Railpack, at an exact version, with its frontend (the program the server's Docker runs to read Railpack's plan) and the images its plan names, each by digest. Cloud Native Buildpacks come later as a third value.
- **Recipe**: for a Dockerfile, its path and stage; for Railpack, the plan.
- **Build plan**: what Railpack wrote on the developer's machine about how to build the files sent. Fixed by the signature, and sealed with the code.
- **Build key**: made from the code's fingerprint, the recipe, the builder, the build variables with their values, what the deploy lists for each build secret (never its value), and the network choice. It names the image the Compose text runs. The time limit, the size and the sealed pieces are signed but not in it.
- **Fresh build**: a build the person asked for, made with no cached step and fresh base images. No later deploy of the same code and recipe runs an image built before it.
- **Kept build**: an image the runner keeps for the deploy an app runs, or for one of the two most recent other deploys whose builds succeeded, with the image id it recorded.
- **Build record**: the outcome and its reason (one of a fixed list, FR-031a), the image id, the builder's version, the server's Docker version and the version of the builder inside it, the program that read the recipe, whether the cache was used, and the base images' digests. The server's word, never signed. Never the builder's lines.
- **Railpack copy**: the pinned version of Railpack on the developer's machine, with the checksums zekno carries for it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (step 1): A person with a folder whose Dockerfile builds on their own machine, and a server with the new runner, gets the app running with one `zekno deploy` and one answer, with no registry, no image built by hand and no file edited by hand. This holds also when the folder holds a `node_modules` and no `.dockerignore`.
- **SC-002** (step 2): A person with a Node folder that has no Dockerfile gets it running with one `zekno deploy` and two answers (to run Railpack, then to write what it found), with nothing installed by hand on their machine or on the server, and no file edited by hand.
- **SC-003** (step 1): Over an upload of 10 Mbit/s with 50 ms of latency, zekno's own work before the build starts (packing, the summary, sealing and sending) takes under 30 seconds for a 10 MB folder and under 150 seconds for a 100 MB folder. The plan measures both, over a link held to those figures in a throwaway container (FR-089, FR-089b).
- **SC-004** (steps 1, 1b and 2): A second deploy with no change to the code, the recipe, the builder, or the plain variables and secrets the build reads, and for Railpack with the same plan, sends 0 bytes of code and starts no build, in every test.
- **SC-005** (step 1): In every test of a failed build (a failing step, the time limit, free disk falling below the floor during the build, the wrong processor, out of memory), the runner does not stop, replace or re-route the app that was running. In every such test but out of memory, run with an app that writes to disk, that app keeps answering and writing, and its routes are unchanged.
- **SC-006** (steps 1, 1b and 2): A change to any byte of the code, a piece, the recipe, the plan, the builder, a plain variable given to the build or a build secret's name after signing is refused with no number used, in every test.
- **SC-007** (steps 1 and 2): A marker string placed in a file of the folder never appears in the sealed pieces, in the signed deploy, or in the runner's own folder, in any test.
- **SC-008** (steps 1 and 1b): No build in any test is given the host's network, the server's devices, steps outside the sandbox, the server's SSH keys, other files of the server, another source, another output, or a variable or secret of the deploy other than the plain variables of FR-036a and the secrets its settings name.
- **SC-009** (step 1): A hand-written Compose file that asks for a build signs nothing with the new zekno, and the new runner builds nothing from Compose text, in every test.
- **SC-010** (step 1): Every deploy that builds shows its summary before signing, every folder over the limit signs nothing and names its largest folders, and no file on the list of secret-looking files is sent without a yes on this machine, in every test.
- **SC-011** (step 2): A Railpack file whose checksum does not match is never run, in every test, and zekno never runs a Railpack it did not fetch and check.
- **SC-012** (step 1): After any number of built deploys, failed builds and reused images, the server keeps the images of the deploy each app runs and of at most two other deploys per app, and the build cache is within its bound after each deploy. No build starts, or goes on, below the free-disk floor.
- **SC-013** (step 1): The code of one folder packs to the same fingerprint on macOS and on Linux.
- **SC-014** (steps 1, 1b and 2): Every pairing of a zekno and a runner, older or newer, either works or stops before signing with a sentence that names what to update. None falls to a general sentence.
- **SC-015** (steps 1, 1b and 2): Every approved sentence comes out of the real program word for word, at a terminal, in the terminal app and with no terminal. Every earlier test passes, and the frozen plain transcripts are unchanged but for the help lines appended to `ADDED_TO_HELP` (item 24); neither exception of FR-074 is in a frozen transcript.
- **SC-016** (steps 1, 1b and 2): On GitHub's Linux machines, for each step: a folder deploys and answers; a deploy with no change sends nothing; a failed build leaves the app answering; a rollback reuses the kept image; for step 1b, a build that reads a named secret deploys and answers. Once, on the maintainer's own Linux server at the end of step 2, for steps 1, 1b and 2 together: the same, a built app answers over HTTPS on a real domain, and nothing of the proof is left afterwards.
- **SC-017** (steps 1, 1b and 2): The independent security review of each step ends with every finding answered, and none critical or high left open.
- **SC-018** (step 1): On a server whose Docker is older than the version FR-034a names, no build runs, in every test, and deploys of images still work.
- **SC-019** (step 1): After a fresh build, no later deploy of the same code and recipe runs an image built before it, in every test, except a rollback that names that earlier deploy.
- **SC-020** (step 1 for a Dockerfile, step 2 for Railpack): In every test, a build is given exactly the plain variables FR-036a or FR-036d names. A change to a plain variable a Dockerfile does not declare sends 0 bytes of code and starts no build. A change to one the build reads makes a new build, and the summary names the variable before signing.
- **SC-021** (step 1b): A marker value set as a named build secret never appears in the image, its history or metadata, the build cache, Docker's record of the build once the runner removed it (FR-031b), the signed deploy, what a relay can read, or the runner's own folder, in any test where no step of the recipe writes or prints it.
- **SC-022** (step 1b): In every test, no secret reaches a build unless its settings name it and this machine gave its yes; no secret under a name of FR-037b reaches a build; after a named secret is set again, no step built with its earlier value is reused; and no build reuses a step built with a named secret unless it is a build of the same app that reads that secret with the same fingerprint of its sealed value, never another app's build (FR-037d).

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
- What an out-of-memory build does on a 1 GB server to the apps already running there. Not tested, and not measured under the arrangement of D10 (FR-089b).
- That a secret mounted for a build step stays out of the image and the build cache, and that a build argument can stay in the image's history and metadata (research, part 8, claim 9).
- That the builder sends a secret named `GIT_AUTH_TOKEN`, `GIT_AUTH_HEADER`, `HTTP_AUTH_TOKEN_<host>` or `HTTP_AUTH_HEADER_<host>` as a credential when it fetches from a host (research, part 8, claim 6). That one without a host in its name applies to any host is an inference.
- Whether a changed secret value makes the builder run a step again. Not established (research, part 5 and part 8, claim 9), so FR-037d does not rely on it.
- How Railpack's frontend receives variables and secrets. Railpack's documentation (its page on the BuildKit frontend, read on 2026-11-26) says: their names go into the plan through `railpack prepare --env`, their values reach the build as build secrets, a build argument `secrets-hash` made from them makes cached steps run again, and a build argument `cache-key` keeps cache folders apart. Not run (FR-036d, FR-089a).
- That Docker's builder keeps a record of each build, with its output and its build arguments, in Docker's storage, bounded by the daemon's `builder.history` setting (moby's source and the buildx docs), and that one record can be removed by its reference (FR-031b). Not run.
- Whether GitHub's Linux machines carry Docker Engine 29.5 or newer. Not known (FR-089b).

### Other assumptions

- The design's limits are used as they are: 512 MiB of code per deploy, in sealed pieces of at most 8 MiB, at most 64 pieces and 8 builds per deploy, a time limit of at most 7,200 seconds per build, staging of 2 GiB kept at most 24 hours, the builds of three deploys kept per app (the one that runs and two others), the build cache brought to 10 GiB after each deploy, and per build at most 32 plain values of at most 4 KiB each (64 KiB in all per deploy) and at most 32 secrets. The numbers this spec adds are in point 22.
- A server builds for its own processor: Linux on x86-64 or on ARM64, as the runner supports today.
- A server that builds has Docker Engine 29.5 or newer, with its build plugin. One without either can still deploy images.
- One runner per Docker daemon, as the design assumes.
- Private base images work only when the server's Docker is logged in to their registry. zekno does not manage registry logins.
- Railpack, at the version zekno pins, and its frontend are trusted as zekno is (FR-087).
- zekno runs on macOS and Linux, the systems Railpack has files for.
- The hosted service does not exist. Nothing here goes through it; what it would learn is written down.
- Teammates are not built. Tests use stand-ins.
- Still pre-alpha and unaudited, and that stays visible.
- The check uses GitHub's x86-64 Linux machines, and its ARM64 Linux and macOS machines too (changed on 2026-11-27, items 4 and 5). A build on ARM64 is also checked in the throwaway container on the maintainer's Mac (FR-089b).

### Working readings of the decisions of 2026-11-26

The maintainer decided points 3, 4 and 19 and where the checks run (D7 to D10), but did not state every detail. Where they did not, the spec takes these readings. Each is the maintainer's to change.

- **Which plain variables a Dockerfile build reads**: those of the service that the Dockerfile declares with `ARG`, anywhere in the file and in any stage, read as Docker reads it (FR-036a, FR-042). So a change to a variable the build never reads makes no new build.
- **Which plain variables a Railpack build reads**: every plain variable of the service but those FR-036b leaves out, as Railway does, since a Railpack plan declares nothing zekno can read in its place (FR-036d). So a change to any of them makes a new build. They reach the build as Railpack's documentation describes, as build secrets, with a `secrets-hash` the runner makes from signed fields only. The design allows 32 plain values per build, so a service with more than 32 such variables cannot be built with Railpack and is refused before signing.
- **A secret a Dockerfile declares with `ARG`**: the build is not given it, the summary says how a build reads a secret, and the deploy goes on, rather than being refused (FR-036e).
- **A plain variable under a name zekno keeps, or that the builder reads as an instruction to itself**: never given to a build. When a Dockerfile declares one, the summary says so and the deploy goes on, rather than being refused (FR-036b), since such a variable is allowed for the running app.
- **What a plain variable given to a build reveals**: it is readable by a relay, as it already is in the signed settings, and for a Dockerfile it stays readable in the image's history (FR-086).
- **Which secrets can be named for a build**: any secret of the app that is set and not removed, whether or not the running service reads it (FR-037a).
- **How a change to a named secret makes a new build**: as the design already says (part 4.1 (b) and part 4.5): the build key takes in each named secret's name and the fingerprint of its sealed value, which the signed deploy already lists. The value, and anything made from it by a plain hash, is never in a signed or relayed field (FR-037e).
- **The name a recipe reads a secret under**: the secret's own name. The program that starts the build gets it under a name the runner picks (FR-037).
- **The three problems of point 19**: credential names are refused by zekno and by the runner (FR-037b); a frontend named by the Dockerfile gets no secret because the runner always chooses the reader, which needs Docker Engine 29.5 (FR-037c); and a step built with a secret is reused only by a build of the same app that reads that secret with the same fingerprint, never by a build that no longer reads it or by another app's build, with the mechanism left to the plan. Where the plan cannot show it, a build that reads a secret reuses no cached step and no other build reuses its steps (FR-037d).
- **The first yes for a build secret**: asked once per secret, service, app and server, remembered on this machine and never in the folder. With no terminal, the rule of FR-015a for a secret-looking file applies: the secret is given only when this machine already said yes; otherwise the deploy stops before signing (FR-037f).
- **A rollback to a build that read a secret set again or removed since**: refused before signing, since the design's key changes with the secret, a removed secret cannot be listed for a build, and a rollback never builds again (FR-064a).
- **Where a build secret's name is checked**: `zekno settings set` refuses, with exit status 2, what it can judge from the settings file alone (a credential name, more than 32 for one build, a secret for a Railpack build). Whether a name is a secret of the app is checked by the deploy, with exit status 1 (FR-037a).
- **Stricter than the design**: FR-037d and FR-037 are stricter than the design. It accepted reusing a step built with an old secret, or by another app's identical step (part 4.1 (b), T36), and it gave the builder each secret under its own name. This spec does neither.
- **Docker's own record of a build**: removed by the runner after each build, so that point 23 (the runner keeps none of the builder's output) holds for that record too (FR-031b).
- **Where step 1b ships**: with step 1's release if it is ready by then, otherwise with step 2's release (0.1.2-dev.2), with that release's protocol number and none of its own (FR-081). Its own security review comes before it is merged (FR-088).
- **Railpack and named secrets until the Linux checks**: refused by zekno before signing and by the runner with no number used (FR-037h). Lifting the refusal later takes a protocol number of its own (FR-081).
- **Where each Linux check runs**: as FR-089b lists it. The out-of-memory check runs in a container held to 1 GB of memory, a stand-in that cannot show what a real 1 GB server does. The memory figure of point 22 therefore stays at 2 GB, as recommended, until a real small server is measured.

### Working readings of the decisions of 2026-11-27

The maintainer decided the items of the plan's "Needs the maintainer" as recommended (D15). These readings record the decided items that no requirement speaks of, and the rules whose branch a check still settles. "Item N" names an item of that list in [`plan.md`](./plan.md), and "check" a check the plan names. Each is the maintainer's to change.

- **Which Railpack zekno pins (item 1)**: the release that is current when step 2 starts, once checks R1 to R10 and R16 have run on it. Its checksums are fetched on GitHub's network by the check and on the Mac's own network by the maintainer at M3, a step of its own with its go-ahead (D17), and both must match (FR-051). A build attestation, where the release carries one, is verified once with `gh attestation verify`; otherwise the checksums from two networks are the control. Any program `railpack prepare` itself downloads is pinned the same way, or step 2 waits.
- **What reads `.dockerignore`, Dockerfiles and `.git`, and how pieces are compressed (items 8 to 10)**: code written in the project, so no package is added (FR-091). Pieces are compressed with zstd level 3 from Bun's built-in `node:zlib` (FR-029a). That fixes the format of what is sealed, so changing it later costs a protocol number.
- **How a step built with a named secret is kept from other builds (item 12)**: the runner passes the builder a salt made from the app and the listed fingerprints of its named secrets, through `--add-host`, once check L15 shows, on every engine and image store the check covers, that two salts never share a step (FR-037d). If L15 shows that `--add-host` is not in the cache key on an engine the check covers, the choice comes back to the maintainer before step 1b is built. On a server whose Docker Engine or build plugin is newer than the check covered, a build that reads a named secret is refused before the number is used, and zekno stops before signing when it knows the versions (item 12 (i)).
- **File times in the pack (item 14)**: the pack holds one fixed time (FR-016). If check L4b shows that the builder leaves file times out of its cache checksums, the runner gives each file the build's start time as it hands the checked code to the builder, so a web server in the image does not keep serving a stale file (A). Otherwise the pack keeps one fixed time, and the docs say so (C).
- **App names that end with a hyphen (item 15)**: allowed today, and not valid in an image name. A build of such an app is refused before signing. Deploys of images do not change.
- **Long names in the pack (item 16)**: a name the pack's form cannot hold is refused before signing, as the edge case on names that are too long says. zekno's walk, the writer and the runner's check use the same rule.
- **Steps a base image adds to the build (item 17)**: a base image's `ONBUILD` steps run in this build, and could name another app's built image, which zekno cannot see before signing. If check L9 shows it holds at the floor and at the newest engine, the runner hands every build a policy it writes itself, outside the code sent, that denies every image in the space kept for built images, and it also fails a build whose record shows such an image (`reserved_image`, FR-031a). Else, if L9 shows that a build's record lists the images it used, the runner only fails such a build. Else the docs say so.
- **Railpack and the person's proxy settings (item 20)**: `railpack prepare` is given no proxy setting from the person's environment, since a proxy address can hold a password (FR-056).
- **The help's new lines (item 24)**: `zekno deploy --fresh`, `zekno logs --build [--app <app>] [--server <name>]` and `zekno doctor --builds`, and in step 2 `zekno settings plan`, are appended to the help, as features 010, 012 and 015 appended theirs. No other line of the help changes.
- **What `railpack prepare` does on the machine that signs (item 26)**: check R16 traces what it starts, writes and reaches, with `strace -f` from Ubuntu's archive on Linux and with the programs macOS carries on macOS. Any program the project supplies that Railpack starts goes to the maintainer before step 2.
- **A build whose runner died (item 27)**: if check L5 shows on Linux that a silent step outlives its runner, the build runs under coreutils `timeout` at a fixed path, so the signed time limit holds without the runner (FR-039). The free-disk check still waits for the next request. Otherwise an orphaned build is stopped by the next request that reads the runner's state, and the docs say that until then it can run past its limit.
- **An upload while another app builds (item 29)**: when the server is busy with a build, zekno sends the pieces of its builds that the server does not keep, waits in the same run with a live line, for at most that build's remaining time limit, then sends its deploy again (FR-044, point 7). When the wait runs out, it ends with the busy sentence. With no terminal it does the same. FR-044's upload clause stays as it is.

## Out of scope

- Building in CI or on the developer's machine (the stage "deploys from CI").
- Cloud Native Buildpacks (a later step of their own) and Nixpacks.
- Building for another processor type than the server's.
- The hosted service, and carrying sealed pieces through it.
- Turning an image's tag into a digest, and sending an image to a server without a registry.
- zekno looking up each base image's digest at deploy, showing it and signing it. Wanted later, as a step of its own, once proven on a plain server (D8). In this feature the runner only records the digests after each build (FR-066).
- Build arguments other than those FR-036 allows, and plain build values set only for the build.
- Passing every secret to every build by itself, as Railway does. Advised against and not chosen (D7).
- Named build secrets for Railpack builds, until the Linux checks show how Railpack's frontend receives them and that they do not land in the image (FR-037h).
- Measuring what a real server with 1 GB of memory does during an out-of-memory build (D10, FR-089b).
- Memory limits per build (point 9), rules on the server about allowed base images, and images for several processor types.
- Stopping a running build from zekno in step 1. It comes as soon as the Linux checks show that the builder stops when told (point 24, taken as recommended).
- Keeping the builder's output on the server (point 23).
- Pre-deploy commands: they stay refused, as in feature 015.
- Deploys on a git push, and watch paths.
- Removing an app, and restoring a runner's folder from a backup.

## Open points for the maintainer

Each point has a question, the options, a recommendation and the reason. Points 1 to 11 belong to step 1, points 12 to 17 to step 2, and points 18 to 21 to both. Points 22 to 25 were added after the three reviews, each with its step. Points 1, 3, 4, 6, 7, 8, 9, 10 and 18 come from the research's part 4. Its point "direction" was settled by D1. Where two reviews pulled opposite ways, the spec keeps the safer reading, and the point says so (points 9 and 23). A line in bold under each point gives its state on 2026-11-26: decided, or taken as recommended (Clarifications, session 2026-11-26 (open points)). No point is open since that day. "Point N" names a point of this list.

On 2026-11-27 the maintainer approved the boards and decided the plan's items (D14 to D16). Where that settled what a point below left to the boards or to the plan, the requirement named here now says so, marked "changed on 2026-11-27": what "Don't build" says (point 3, FR-002); a `# syntax=` line (point 4, FR-042a, item 11); the build stage's names and the word `Reused` (point 10, FR-070); `zekno deploy --fresh` (point 11, FR-021a); `zekno settings plan` (point 13, FR-059); the names of the settings (point 18, FR-007); and `zekno logs --build` (point 23, FR-071a). The rest of what points 3, 10 and 17 left to the boards is drawn on the boards approved that day: the service the first deploy writes, `web`, and the words of Railpack's two questions. The bold lines below still give each point's state on 2026-11-26.

### Step 1

**1. Which files are sent** (step 1). When zekno packs a folder, which files go in?
- (a) What `docker build .` would send from this folder: every file except what `.dockerignore` lists, with `.git` and secret-looking files left out unless named (point 2).
- (b) Git's view: tracked files and new files git does not ignore, then `.dockerignore`.
- (c) The last commit only, so uncommitted edits are left out, as Kamal does.
- (d) As (a), but with no `.dockerignore`, the folder's `.gitignore` rules apply, and the summary says so.

**Recommended**: (a), with the summary before signing and the size refusal. When the folder has no `.dockerignore`, the first-deploy question also proposes one, drawn from the folder's `.gitignore` plus dependency folders such as `node_modules` and `.venv`. It shows it, and the same yes writes it (FR-002b).

**Why**: It sends what the developer built and tested on their own machine. It works in a folder that is not a git repository. It keeps build output that git ignores and a Dockerfile may copy, such as `dist/`. Git's view drops that output silently, and needs git. The last commit surprises anyone with uncommitted edits. A person coming from Railway, Render or Heroku expects `.gitignore` to apply: those platforms build from git, and Railway's own upload always leaves `node_modules` out. With (a) alone and no `.dockerignore`, a Node or Python folder that has run locally sends its `node_modules` or `.venv`. Over an upload of 10 Mbit/s, 400 MB takes over five minutes, and modules built on macOS can be wrong for a Linux server. The proposed `.dockerignore` gives that person what they expect, while the signed rule stays Docker's own. (d) needs no new file, but zekno's rule would then differ from what `docker build .` sends from the same folder.

**Decided on 2026-11-26**: (a), as recommended, after the maintainer saw the four options and their costs (D12). One addition: when the folder has changes that are not committed, the summary says so before signing. The line warns and stops nothing (FR-017a).

**2. Files that look like secrets** (step 1). A `.env` file, a private key or a credentials file in the folder: what happens to it, and which files count?
- (a) Left out unless the settings name it, and listed in the summary. A file the settings name is sent only after the person agrees to it at a terminal, once per file, remembered on this machine, never in the folder. With no terminal, only when this machine allowed it before.
- (b) The deploy is refused until the settings name it or the ignore file lists it.
- (c) Never sent, whatever the settings say.

**Recommended**: (a). The list holds `.env` and `.env.*` at any depth, `.npmrc`, `.netrc`, `.git-credentials`, files whose name or content marks a private key, and the `.git` folder. A private key in a file's content also catches a cloud service-account key. A name such as `credentials.json` alone is not on the list, since many such files hold no secret. The docs show the list and say it is a convenience, not a guarantee.

**Why**: The design says left out unless asked. Refusing would make every folder with a local `.env` fail its first deploy. Never would break a Dockerfile that really needs a certificate file. The summary makes a left-out file visible. A Dockerfile that copies it fails at that step, and the sentence can name the file. A settings file arrives with a cloned repository, as in point 5, so it can name a `.env` that git never held. The yes per file keeps such a file from leaving this machine unseen. A summary scrolls past, so the first deploy that builds from a folder also waits for a yes after it (FR-015b).

**Taken as recommended on 2026-11-26.**

**3. A folder with a Dockerfile and no settings file** (step 1). In a folder with a Dockerfile, no `zekno.app.json` and no Compose file, what does `zekno deploy` do?
- (a) Ask once at a terminal, then write a settings file that says to build. With no terminal, stop exactly as today.
- (b) Build at once, without asking or writing anything.
- (c) Stop with a sentence that says how to write the settings.

**Recommended**: (a). The question comes first, where today's question "Deploy from which file?" is asked, before the key, the server and the app. It shows the summary of what would be sent, the settings file it would write (one service such as `web`, its build and a port), and the `.dockerignore` it proposes when there is none. The port is the one the Dockerfile says the app listens on; the person can change it, or say there is none for a worker. "No", Esc or Ctrl-C writes nothing and ends with today's sentence. Count only a file named exactly `Dockerfile`. With several Dockerfiles, the question lists them, and the choice is written to the settings.

**Why**: Zekno's rule is that one file is never picked over another without the person saying so. Writing the settings means the signed file states that a build happens. Railway and Dokku pick silently, which breaks that habit. Without a port, the built app runs but nothing can reach it: a domain needs one. With no terminal, every existing command must behave as before, so today's sentence stays.

**Decided on 2026-11-26**: (a), as recommended (D9). The name of the service the file holds is still drawn on the boards.

**4. Code a Dockerfile pulls in from outside the folder** (step 1). A Dockerfile can bring in what the signed folder does not hold: a frontend named by a `# syntax=` line, which would see the build's secrets; base images named by tag; and files fetched by `ADD` from a web address. How strict is the first version?
- (a) The server always uses the Dockerfile reader built into its Docker, so a `# syntax=` line is ignored. zekno refuses an `ADD` of a web address or a git repository that has no checksum, and an `ADD` whose address names the server itself or a private address even with a checksum. It warns on a base image named without a digest.
- (b) As the design says: zekno refuses an unpinned `# syntax=` line or an `ADD` of a web address only when the build reads a secret, and warns otherwise.
- (c) Strict: a digest on every base image, and a rule on the server that refuses anything else.

**Recommended**: (a). The runner records the base images' digests after each build.

**Why**: (a) is enforced by the server whatever zekno read, through a setting Docker documents. It closes the way by which a registry's frontend would read build secrets. What it costs: with (a), building needs Docker Engine 29.5 or newer on the server. An older engine lacks the setting, and every Dockerfile build would fail while looking for a program that does not exist (research, part 8, claim 1). Such a server is refused before the number is used, deploys of images still work there, and `zekno doctor` names the version (FR-034a). Many servers run an older Docker than the 29.8.2 of the runner's proof. A Dockerfile can also use only the features of the Docker on each server. zekno has to read Dockerfiles as Docker reads them, which it does not do today (FR-042). Docker itself fetches an `ADD` address from the server, so a checksum does not stop a fetch that reaches services listening only on the server's own addresses. Requiring digests would refuse most real Dockerfiles. Server-side rules of that kind are experimental in Docker and not tested on its built-in builder. The design and the research disagree on this point (research, part 5).

**Decided on 2026-11-26**: (a), as recommended, with the runner recording the base images' digests after each build (D8, FR-066). zekno looking up each base image's digest at deploy, showing it and signing it is wanted later, once proven on a plain server. It is out of scope for this feature. Named build secrets rest on this decision (FR-037c).

**5. How far the folder to send may reach** (step 1). A Dockerfile in a monorepo often needs the repository's top folder. May the settings name a folder above the settings file's own folder?
- (a) Only the settings file's folder, or one inside it.
- (b) Also a folder above it, up to the top of the git repository it is in, never beyond. Outside a git repository, as (a).
- (c) Any folder.

**Recommended**: (b). The summary names the folder sent.

**Why**: Monorepos are common, and Railway's root directory works inside one repository. A settings file arrives with a cloned repository, so it must not be able to make zekno send the person's home folder. (a) forces a monorepo to keep its settings at its top. (c) lets a cloned settings file reach anything the person can read.

**Taken as recommended on 2026-11-26.**

**6. A hand-written Compose file that asks for a build** (step 1). How does Zekno stop such a file from building outside the rules?
- (a) zekno refuses it before signing, and the runner starts apps in a way that never builds from Compose text.
- (b) zekno turns each build in a hand-written Compose file into a signed build under the same rules as settings.
- (c) Leave it and document it. This feature's description rules it out.

**Recommended**: (a) now, (b) later if people ask. First test what runner 0.1.1 does with such a file, and say it in the docs.

**Why**: Runner 0.1.1 starts apps without forbidding Compose to build, and zekno does not check for it. Such a build's code could be a git address or a folder on the server. It would be unpinned, unrecorded, and see the deploy's secrets. (b) needs a second reader for Compose files. What (a) costs: it is the one stated exception to the rule that, with no terminal, every existing command behaves as before (FR-074). Such a file is signed and sent today, and would be refused. So would a Compose file or settings file that names the space kept for built images (FR-077). Approving (a) approves that exception.

**Decided on 2026-11-26**: (a), as recommended (D13). The maintainer approved the exception to FR-074 that it makes. (b) can come later if people ask. What runner 0.1.1 does with such a file is still to be tested and said in the docs.

**7. Team list updates during a long build** (step 1). A build can take up to two hours. While it runs, should the server still take a team list update, such as one that removes a stolen key?
- (a) Two locks: a team list update, and an upload for a later deploy, never wait for a build. Deploys of every app on the server still wait. A deploy whose signer the new team list no longer allows does not start its built app: it ends as stopped, and the running app keeps running.
- (b) One lock: everything waits or is told the server is busy, as today.
- (c) Builds outside any lock.

**Recommended**: (a).

**Why**: Feature 014 put the second lock off until builds make deploys long (014 spec, Assumptions, item 5). With one lock, a removed member's key keeps working for the whole build, because the update is refused. Taking the update is only half the answer: as the design stands, a deploy already accepted still finishes, so a stolen key's deploy would go live up to two hours after the key was removed. With no lock, the design's order and staging rules break (V20).

**Taken as recommended on 2026-11-26.**

**8. How the code travels** (step 1). How should the code travel to the server?
- (a) As designed: sealed pieces of up to 8 MiB, sent one after another in the connection zekno already opens, uncompressed. A cut upload is sent again whole.
- (b) The same, but each piece compressed before it is sealed, and the server says which pieces it lacks, so a cut upload resumes within one run of zekno.
- (c) Raw bytes on a second connection.

**Recommended**: (b), in this feature rather than later. Each piece opens to at most its bound, and the runner stops reading there (FR-029).

**Why**: Sealed bytes cannot be compressed, so compression must come first. Zekno's own 10.8 MB pack became 2.57 MB in 31 ms. The bound on what each piece opens to rules out a piece that opens to far more than its size. The fingerprint stays that of the uncompressed bytes, so it stays the same on every machine. No runner builds yet, so this costs no extra protocol number now; later it would. A second connection means a second login.

**Taken as recommended on 2026-11-26.**

**9. Disk and memory on the server** (step 1). How does the runner keep builds from filling the server's disk or memory?
- (a) A free-disk floor before and during each build: a build that brings free disk below it is stopped. The build cache brought to 10 GiB after each deploy. No memory limit in the first version. The docs and the out-of-memory sentence say that a build shares the server's memory with the running apps, and can make the server stop one of them.
- (b) The same, plus a memory limit on each build step. It needs Docker Engine 29.6 and a recent build plugin. An older Docker drops it without a word, so the runner would have to check it took effect, and doctor would show it. It limits each step, not the whole build. Not tested.
- (c) No pruning by Zekno, only the floor.

**Recommended**: (a). The docs say that the prune covers every build on the server, also builds made outside Zekno. `zekno doctor` shows each server's memory and warns below the figure of point 22.

**Why**: Docker's build cache is shared by the whole server, and Docker offers no way to prune one app's part. A memory limit per step is not tested on the builder that comes with Docker. The reviews pulled two ways on what a failed build promises. One asked to test that the running app survives an out-of-memory build. The other asked to promise only what the runner controls. The spec keeps the safer reading: the runner never touches the running app, the kernel may, and that is said plainly. The out-of-memory case runs in a container held to 1 GB of memory (FR-089b). What a real 1 GB server does to the running apps is not measured, and the docs say so. If a later measurement on such a server shows running apps are stopped often, (b) is the next step.

**Taken as recommended on 2026-11-26.** Under D10, the out-of-memory case runs in a container held to 1 GB of memory, a stand-in. It shows what the builder and zekno say, not what a real 1 GB server does to the running apps, which is not measured (FR-089b). The docs say so.

**10. How much of a build a person sees** (step 1). What does the deploy screen show for a build?
- (a) A build stage between Sent and Starting, with the builder's latest line under it; upload progress; a one-sentence failure, then the failing step and its error and the builder's last lines in the "Docker said" panel; and a line such as (draft) "kept, nothing sent" when nothing changed.
- (b) Only the new stage.
- (c) The whole build log in the terminal.

**Recommended**: (a), drawn on boards and agreed before anything is built.

**Why**: It extends today's stage row and "Docker said" panel. It says plainly that a failed build left the running app alone, as Render does. A full log in the terminal buries the one line that matters. Point 23 says where the whole output can be read.

**Taken as recommended on 2026-11-26.** What the screen shows still waits for the boards.

**11. Building again from scratch** (step 1). The same code and recipe always reuse the kept image. How does a person build again to pick up a fixed base image or package?
- (a) An option of `zekno deploy` that signs a request for a fresh build. A fresh build fetches every base image again and reuses no cached step, every time it is asked for. Later deploys of the app never reuse an image built before its most recent fresh build, except a rollback that names that deploy. A fresh build whose record shows that the cache was used ends as failed.
- (b) Nothing in this feature: change a file or the recipe to build again.
- (c) The runner builds again whenever a base image has moved.

**Recommended**: (a). The signed field is added now, while the format changes for D4. Railpack's builds did not honour a request for no cache in the hand test (R10). Until the Linux checks show they do, a fresh build with Railpack is refused before signing, with a sentence.

**Why**: Security fixes in base images are the commonest reason to build again, and Railway, Render and Heroku all offer it. The request has to be signed, or a relay could add or drop it. A request that only changed the build's key would not last: the next deploy that changed only a secret would find the older, unpatched image still kept, and run it. A base image already on the server is also used as it is unless the build fetches it again. A field added now costs nothing; later it is a format change. (c) makes every deploy ask registries whether something moved.

**Taken as recommended on 2026-11-26.**

### Step 2

**12. The first fetch of Railpack** (step 2). What does a person see the first time zekno fetches Railpack?
- (a) No question. One line says what is fetched, from where and how large, then that its checksum matched. With no terminal, the same line goes to standard error.
- (b) A question at a terminal before the first fetch. With no terminal, stop and say how to allow it.
- (c) A command of its own to fetch it, which a deploy asks the person to run.

**Recommended**: (a), for a deploy whose settings already chose Railpack. A folder with no settings file asks first (point 17).

**Why**: D6 says zekno fetches it by itself, and the developer installs nothing by hand. The download is pinned and checked against a checksum zekno carries, so a question would protect nothing a person can judge. The line still says plainly that a program from a third party arrived and runs on this machine.

**Taken as recommended on 2026-11-26.**

**13. Showing the plan before signing** (step 2). Is Railpack's plan shown before the deploy is signed?
- (a) A short form in the summary: the language and its version, the install, build and start commands, and the images the plan names. A command prints the whole plan, as `zekno settings compose` prints the Compose text.
- (b) The whole plan, at every deploy.
- (c) Nothing beyond the builder's name.

**Recommended**: (a). The summary also says when the plan changed since the last deploy, and why when it is known.

**Why**: The plan decides what runs on the server, and the person signs it. It is several kilobytes, too long to read at every deploy. A new patch release of the language changes the plan by itself (Railpack turned "Node 22" into an exact version by asking the network), so a person should see why a deploy with no code change builds again.

**Taken as recommended on 2026-11-26.**

**14. When Railpack cannot tell how to build** (step 2). What happens when Railpack cannot make a plan for the folder?
- (a) Stop before signing, with Railpack's own reason in one sentence and the two ways forward: add a Dockerfile, or set what Railpack needs in the settings, such as a start command.
- (b) Ask at a terminal for a start command, and try again.
- (c) Fall back to a default image.

**Recommended**: (a).

**Why**: Railpack's reason is the most useful fact the person can get. A guess would build something nobody chose. Questions can come later, once the common failures are known.

**Taken as recommended on 2026-11-26.**

**15. How Railpack's frontend and images are pinned** (step 2). Railpack's plan names its frontend and its images by tag. How are they fixed?
- (a) zekno carries, with the Railpack version it pins, the digests of its frontend and of the images its plans name. It signs those, and refuses a plan that names any other image. The runner checks the plan against what is signed (FR-049a).
- (b) zekno asks the registry for each tag's digest when it signs, shows it and signs it.
- (c) Each runner release pins one frontend, and the deploy signs only the Railpack version.

**Recommended**: (a).

**Why**: The hand test pinned all three by digest, and the build worked. With (a), what the server runs is fixed by what zekno carries and the person signs, not by a registry at signing time. With (b), whoever answers for the registry decides what is signed. (c) ties every Railpack update to a runner release, and the signature would not fix the frontend. Whether a folder's own Railpack configuration can name other images is not established; until there is demand, such a plan is refused with a sentence.

**Taken as recommended on 2026-11-26.**

**16. A folder with no lockfile** (step 2). Railpack warns when a folder has no lockfile: the server may then install other versions than the developer tested. What does zekno do?
- (a) A warning in the summary, and the deploy goes on.
- (b) Refuse until there is a lockfile.
- (c) Nothing.

**Recommended**: (a).

**Why**: Many small apps have no lockfile, and refusing would stop their first deploy. The warning says what it costs. A lockfile is also what narrows what the build downloads, which no signature can fix.

**Taken as recommended on 2026-11-26.**

**17. A folder with no Dockerfile and no settings file** (step 2). In a folder of code with no Dockerfile, no settings file and no Compose file, what does `zekno deploy` do?
- (a) Ask first at a terminal whether to fetch and run Railpack on the folder, naming what will happen. Then show what Railpack found, the summary and the files zekno would write, and ask once more. With no terminal, fetch and run nothing, and stop exactly as today.
- (b) As (a), with no first question, but fetch and run Railpack only in a folder that holds a file marking a language Railpack knows, such as `package.json`.
- (c) Build with Railpack at once.
- (d) Stop with a sentence.

**Recommended**: (a). Draft of the first question: `No Dockerfile here. Fetch Railpack (N MB) to find out how to build this folder?` With Railpack already kept, the question says it will run it. The second question names what Railpack found, such as "a Node app".

**Why**: The same rule as for a Dockerfile: the signed settings say a build happens, and nothing is picked silently. Today `zekno deploy` in a folder opened by mistake, such as the home folder, only says there is no Compose file. Without the first question, zekno would fetch a third party's program and run it over that folder, reaching the network, before the person said yes to anything. Point 12's "no question" fits a deploy whose settings already chose Railpack, not this case. Naming what Railpack found lets the person catch a wrong guess before anything is signed.

**Taken as recommended on 2026-11-26.** The words of both questions still wait for the boards.

### Both steps

**18. Which build settings, and where** (both steps). Which build settings does the first version offer, and in which sections of the settings file?
- (a) The folder to send under Source. A new Build section, as Railway shows it, with the builder, the Dockerfile's path, the Dockerfile's stage, the time limit and the network for the build (the internet, or none).
- (b) The same settings inside the Source section, in the place feature 010 reserved for builds.
- (c) Only the builder, the folder and the Dockerfile's path. Everything else later.

**Recommended**: (a). An image is not required when the service is built. For Railpack, the first version offers the builder, the folder and the time limit, with no network choice, because Railpack's builds download their tools.

**Why**: Railway shows Source (its root directory) and Build (the builder, the Dockerfile's path, a build command) as separate sections, so a Railway user looks there. The stage, the time limit and the network are already signed fields, and the design chose the internet by default with "none" offered (Q10). Today's zekno refuses either form before signing, so neither breaks an older program, but with different sentences. With (a), an older zekno gives its sentence for a setting it does not know, or for a service with no image. With (b), it keeps today's sentence `Building from source is not in this version of zekno yet.` A build command for Railpack, as Railway offers, can come later. The exact names of the settings are drawn on the boards.

**Taken as recommended on 2026-11-26.** With point 19's decision, the Build section also holds, from step 1b, the secrets the build may read (FR-007, FR-037a). The exact names of the settings still wait for the boards.

**19. Variables and secrets in builds** (both steps). May a build read the app's variables or secrets in the first version?
- (a) Neither: a build reads only the code.
- (b) Plain build variables named in the settings: signed, and readable by a relay. No secrets.
- (c) Secrets as well, given to the build as mounted secrets only, under names the runner picks.

**Recommended** (rewritten on 2026-11-26 to match the decision; the earlier recommendation was (a), a build reads only the code): the build reads the service's plain variables, and only the secrets the build settings name, one by one, as ones it may read. For a Dockerfile, the plain variables are those it declares with `ARG` (FR-036a). For Railpack, they are all the service's plain variables (FR-036d). Each named secret reaches the build as a mounted secret, never as a build argument (FR-037), and the first deploy that gives one to a build waits for a yes on this machine (FR-037f). The summary names every variable and every secret the build reads, a secret by name only (FR-072b). Plain variables come with step 1 for a Dockerfile and with step 2 for Railpack. Named secrets for a Dockerfile come in step 1b, right after step 1, shipped no later than the release that ends step 2. For Railpack, named secrets are refused before signing until the Linux checks show how Railpack's frontend receives them and that they do not land in the image (FR-037h).

**Why**: Plain variables are not secret and are already in the signed settings, so giving them to a build conflicts with nothing Zekno promises. A plain variable given to a build is readable by a relay, as it already is, and for a Dockerfile stays in the image's history: the docs say so. Many frameworks need a public value at build time, and Railway passes a service's variables to its builds, so a person coming from it expects this. A secret is different. Today it is opened only in memory when the app starts. In a build it is handed to steps that run other people's code and download from the internet. It still never leaves the customer's own server, so "Zekno cannot read it" holds, but it travels further on the server than today. That is why each secret must be named, one by one, and nothing is passed by itself. Passing every secret to every build by itself, as Railway does, was advised against and is not chosen. Build secrets bring three problems, and each has a requirement. Some names are used by the builder as credentials for any host it fetches from: they are never a build secret's name (FR-037b). A frontend named by the Dockerfile would receive them: point 4's decision closes this, since the server always uses the reader built into its Docker, which needs Docker Engine 29.5 (FR-037c). And a step built with an old secret can be reused after the secret changed, or by another app's build: a step built with a secret is reused only by a build of the same app that reads it with the same value (FR-037d). One thing no rule closes: a build that reads a secret and has the network can send it anywhere, and no signature prevents it. The question of the first yes and the docs say so (FR-037f, FR-037g).

**Decided on 2026-11-26**: not the earlier recommendation. The build can read the app's plain variables, plus only the secrets named one by one as "the build may read this" (D7). The recommendation and the reason above are rewritten to match.

**20. The port a built app listens on** (both steps). Railway tells each app which port to listen on through a `PORT` variable, and many apps written for managed platforms read it. Does zekno do the same?
- (a) For a built service with a port, zekno sets a plain variable `PORT` to that port, unless the settings set `PORT` themselves. The summary and the Compose text show it.
- (b) Nothing: the person sets `PORT` as a plain variable when the app needs it.

**Recommended**: (a). The port comes from the settings file the first deploy writes (point 3).

**Why**: It makes the first deploy work for apps written for managed platforms, without a setting to learn. The variable is visible in the summary and in the Compose text, so nothing is hidden. Services that run an image are not changed.

**Taken as recommended on 2026-11-26.** `PORT` is a plain variable like any other, so a build that reads it gets it (FR-036a, FR-036d).

**21. Releases for the two steps** (both steps). How are the two steps released?
- (a) Step 1 ends with runner 0.1.2-dev.1 and a proof on a real server. Step 2 ends with 0.1.2-dev.2 and its proof. When to release 0.1.2 is decided after.
- (b) One development release after both steps.
- (c) A prod release after step 1.

**Recommended**: (a). D10 changed where the proofs run: see the line below.

**Why**: Step 1 is useful alone and smaller to review. A proof per step finds what differs on Linux before step 2 builds on it. Releases stay in the 0.1 line, and each prod release is the maintainer's call.

**Taken as recommended on 2026-11-26, with the change of D10.** Both development releases stay. The proof of step 1 runs on GitHub's Linux machines and in a throwaway Linux container, not on a real server. The maintainer's own server is used once, at the end of step 2, for one proof that covers steps 1, 1b and 2 with a real domain, with a go-ahead at the time (FR-089b, FR-090).

### Added after the reviews

**22. The numbers a test needs** (both steps). A requirement with no number cannot be tested. Which numbers does the first version use?
- (a) The values recommended here.
- (b) Other values, set by the maintainer.

**Recommended**: (a):
- the default time limit of a build: 1,800 seconds, the same 30 minutes the runner waits for an app to start; the settings can raise it to 7,200;
- the size above which the summary warns: 100 MB;
- the entry limit of what is sent: 50,000 files and folders;
- the free-disk floor: 2 GiB, raised if the plan measures that a 512 MiB build needs more (FR-089);
- the memory below which `zekno doctor` warns: 2 GB, until a real small server is measured (FR-089b);
- the builder's last lines shown after a failure: 40.

**Why**: Spec 015 states its numbers (14 days, 60 seconds, 64 domains), and this spec should too. Heroku stops a build at 25 minutes, and Render allows 120. With 30 minutes, a build that hangs holds the server's deploy lock for at most that long, unless the settings raise it. Vercel allows 15,000 files per upload, and the research's proposal for the pack was about 50,000 entries. npm and pip print the cause of a failure tens of lines above the end, and the failing step and its error are shown first anyway (FR-071).

**Taken as recommended on 2026-11-26.** Under D10, the out-of-memory check runs in a container held to 1 GB of memory, which cannot show what a real 1 GB server supports. So the memory below which `zekno doctor` warns stays at 2 GB until a real small server is measured (FR-089b).

**23. Where the whole output of a build can be read** (step 1). The deploy shows the step that failed, its error and the builder's last lines. Where can a person read the whole output, when the cause is further up?
- (a) Nowhere: the runner keeps none of what the builder prints, and zekno keeps none either.
- (b) The server keeps the whole output of each app's latest build until the next build, and zekno reads it from there.
- (c) zekno keeps the whole output of each app's last build on this machine, replacing the one before, and the failure sentence says how to read it. The runner keeps none.

**Recommended**: (c).

**Why**: Two reviews pulled opposite ways. One asked that the runner keep none of the builder's output, since a compiler error quotes the code and any step can print a file. The other asked that the server keep the latest build's log, as managed platforms let a person open it. The spec keeps the safer reading: the runner keeps none (FR-031a). A log kept on the server would put code outside Docker's storage, in the runner's records, and through the hosted service later it would travel readable. This machine already holds the code, so (c) gives the person the whole log without a new place for it to leak. With no terminal, every line already goes to standard error.

**Taken as recommended on 2026-11-26.** A step that prints a named build secret puts it in that kept output too, and the docs say so (FR-037g). Docker's builder keeps its own record of each build, with its output, in Docker's storage on the server. The runner removes that record after each build, so the runner still keeps none (FR-031b).

**24. Stopping a build** (step 1). A build that hangs, such as an install waiting on the network, holds the server's deploy lock until its time limit, and every deploy to that server waits. Can a person stop it from zekno?
- (a) Yes: a request, signed like a deploy, stops the build on the server. The build ends as failed at the person's request, and the running app is untouched. At a terminal, Ctrl-C during the build asks whether to stop it there.
- (b) Not in this feature. The default time limit (point 22) bounds a hung build, and the busy sentence names the app that is building, for how long, and its limit.

**Recommended**: (b) in step 1, and (a) as soon as the Linux checks show that the builder stops when told.

**Why**: Railway and Render offer a cancel button, and Heroku stops a build at 25 minutes. But whether the builder stops when the program that started it goes is not established (research, part 6). A stop that said "stopped" while steps still ran would free the lock too early (FR-039). (a) also adds a signed request the runner does not have today. With (b), the 30-minute default keeps the wait short.

**Taken as recommended on 2026-11-26.**

**25. Language versions between Railpack deploys** (step 2). Railpack asks the network for the language's latest patch release each time it plans. A new release changes the plan, so a deploy that changed only a secret sends the folder and builds again. May a deploy keep the versions of the app's last plan?
- (a) No: each deploy uses the plan Railpack makes, and the summary says why it builds again before signing.
- (b) Yes: a deploy keeps the versions of the app's last plan, unless a fresh build is asked for (point 11).

**Recommended**: (a) in step 2.

**Why**: (b) needs the last plan on every machine that deploys the app, and a teammate's machine would make another plan anyway. It also holds back patch releases, which bring fixes. Railpack can keep versions (research, part 7.5), so (b) can come later. With (a), a change of a secret can build again, but the person sees why before anything is signed, and SC-004 holds while the plan is the same.

**Taken as recommended on 2026-11-26.**

## Maintainer steps

Each is the maintainer's, with a go-ahead at the time. They come in this order.

| Step | What |
|---|---|
| M1 | Answer the open points above. Done on 2026-11-26: points 1, 3, 4, 6 and 19 decided, where the checks run decided (D10), and the rest taken as recommended (Clarifications, session 2026-11-26 (open points)). |
| M2 | Approve the boards: every new screen and line, and the new words of the README and the docs. Done on 2026-11-27: the 18 boards approved, with the nineteen choices of `design/lines.md` as recommended (D14). A sentence written after the approval of 2026-11-27, such as the new lines of the plan's item 23, is a draft and is shown to the maintainer before its screen is built (FR-092). |
| M3 | Approve the tools the plan names before they are used: the Railpack version zekno pins, and how its checksums and digests were established (the release's checksum file, and its build attestation if Railpack publishes one, fetched over two networks and compared, then recorded in a reviewed change with the digests of its frontend and images); and any package. On 2026-11-27 the rule for which Railpack zekno pins (item 1), the tools of the plan's items 2, 3 and 26, items 8 to 10 (no package), `timeout` if check L5 settles item 27 as (a), and the attestation tool of item 1 were approved as recommended (D15). The maintainer's own fetch of Railpack's checksums stays a step of its own, with its go-ahead at the time (D17). |
| M4 | Where the Linux checks of FR-089 and FR-089a run: decided on 2026-11-26 (D10). Agreed on 2026-11-26: a new check on GitHub's own Linux machines that runs on every push (FR-089b). The checks run there, and in a throwaway Linux container on the maintainer's Mac while building. Left for the maintainer: approve the way the check gets Docker Engine 29.5 or newer and an older engine, if GitHub's machines lack them (M3, FR-091). Neither place shows a real domain over HTTPS or a server with 1 GB of memory. On 2026-11-27 the maintainer approved the plan's way (item 2): a server stand-in with Docker's own packages at exact versions, with an ARM64 job, a macOS job and a newest-engine leg on GitHub (items 4 to 6). That `linux checks` becomes a required check for `dev` is agreed in principle (item 7): the maintainer sets it once the check has passed on `dev` (D17). |
| M5 | Step 1, and step 1b if it is ready by then (FR-081): merge into `dev` after each one's security review, and push `dev`. |
| M6 | Before the tag, read the proof of step 1 from the check on every push, which runs on GitHub's Linux machines and in a throwaway Linux container, not on a real server (D10): deploy a folder with a Dockerfile; a build that reads a plain variable; deploy again with nothing changed; a failed build with the app still answering; a rollback to a built deploy; `zekno doctor`. With step 1b, also a build that reads a named secret. |
| M7 | Push the tag `runner-v0.1.2-dev.1` from `dev`; the workflow publishes a pre-release. Run the second build and commit its checksums on `dev`. Then read the one part of step 1's proof that needs the published pre-release: updating the runner from 0.1.1. |
| M8 | Step 1b, unless it came with step 1, then step 2: merge each into `dev` after its security review, and push `dev`. Before the tag, read their proof from the check on every push. Then push the tag `runner-v0.1.2-dev.2`, run the second build and commit its checksums. |
| M9 | The one proof on the maintainer's own server, at the end of step 2, covering steps 1, 1b and 2 with a real domain, with a go-ahead at the time of each use (D10): update the runner from 0.1.1; deploy a folder with a Dockerfile, give it a domain, and it answers over HTTPS; deploy again with nothing changed; a build that reads a plain variable, and one that reads a named secret; a failed build with the app still answering; a rollback to a built deploy; `zekno doctor`; a folder with no Dockerfile, from a profile on which zekno has never fetched Railpack, so it fetches and checks it itself; the app answers; the folder the runner wrote the code to is gone; clean up. The same proof, but for the real domain, also runs on GitHub's Linux machines. |
| M10 | Decide whether and when to release 0.1.2: merge `dev` into `main`, push the tag `runner-v0.1.2`, approve the release in the `prod` environment, run the second build and commit its checksums on `main`, then the short proof of the released files. |
