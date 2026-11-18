# Feature Specification: Deploy version 2, the first step

**Feature Branch**: `014-deploy-v2`

**Created**: 2026-11-18

**Status**: Approved. The direction, the four boards in [`design/`](./design/) and the nine points that were open were settled with the maintainer on 2026-11-18 (see Clarifications, and Assumptions, "Decided with the maintainer"). The words of every new line are in [`design/lines.md`](./design/lines.md) and on the boards.

**Input**: The signed deploy, version 2, was designed and reviewed twice during feature 010 and never built ([`deploy-v2.md`](../010-app-settings/deploy-v2.md), "the design" below, and [`deploy-v2-review.md`](../010-app-settings/deploy-v2-review.md), "the review"). The maintainer decided on 2026-11-18 to build it in two features. This one is the first step, as the design's question Q16 defines it: the new signed message in the core library, the runner and the CLI; a runner that carries out `previous`, `expiresAt` and secrets by version with the completeness rule, with the review's findings V20 and V21 closed; a version-2 deploy that uses a field the runner does not carry out yet (`builds`, `routes`, `health`, `predeploy`) refused, never ignored; protocol number 3; version 1 and version 2 living together as the design's part 4.7 says. The format of the whole version-2 message is fixed now, once (parts 3 and 5), including the fields carried out later. Feature 015 (domains and HTTPS) follows.

## Clarifications

### Session 2026-11-18

- Q: One feature or two? → A: Two. 014 is deploy version 2, the first step: the message in the core library, the runner and the CLI. 015 is domains and HTTPS: routes, a reverse proxy, `zekno domain`, health checks. 015 ends with runner release 0.1.1 and a proof on a real server.
- Q: Do deploys expire? → A: As the design says (Q7). Over SSH a deploy may have no expiry. Through the hosted service, when it exists, it must have one. Only the field and its checks are built now.
- Q: What happens to a secret set by a member who was since removed (Q9)? → A: The runner refuses a deploy that uses it, until the secret is set again or removed. Today the CLI warns and deploys without it; that changes.
- Q: Does the README say what the hosted service can read (Q12)? → A: Yes, when this feature lands.
- Q: Which numbers do releases get? → A: The maintainer, on 2026-11-18: "keep using 0.1 term, we can pump it like 0.1.1 or 0.1.1-rc or something but never pump to version 2". Releases of zekno and of the runner stay in the 0.1 line: the next runner release is 0.1.1, with development releases such as 0.1.1-dev.1 before it. No release is numbered 0.2 or higher until the maintainer says so. "Version 2" in this spec is the number of the signed deploy's format, a field inside the message, not a release of the product.
- Q: Are the four boards approved? → A: Yes, all four (`Deploy2Overtaken`, `Deploy2Secrets`, `Deploy2Versions`, `Deploy2Refusals`), with the 0.1.1 numbers.
- Q: The nine open points? → A: Each as recommended. The maintainer answered the four that change what a person sees or the release plan one by one (no runner release in this feature; an older zekno stops before signing; `zekno secret set` and `zekno secret rm` may ask the server; a removed member's secret stops the deploy on old runners too), and was told the other five follow the design. On the second of these the maintainer added "but need to decide soon"; read here as: how a person updates zekno has to be decided soon, since that sentence tells them to. It is not settled by this feature.
- Q: Does "never version 2" cover the name of the new message? → A: No. "I just mean our app versioning only." The format number stays 2.
- Q: Release candidates? → A: Pre-releases keep the form `0.1.1-dev.1`; no `-rc` form is added.
- Q: Item 6 again, after the plan showed that "asking the server" changes `zekno secret set` and `zekno secret rm` for one developer and a test feature 006 froze? → A (maintainer, 2026-11-18): decision B. Set and rm never connect. Each version-2 deploy remembers on this machine the statements and versions the server says it holds for the app, and set and rm take their version from this machine's records and that memory. A deploy that finds something this machine cannot account for stops before signing (C4, C5, and the new C5b, proposed), and the two commands it names then work offline.
- Q: What is decided for 015 already? → A: The reverse proxy is Caddy. The first version has no zero-downtime deploys. Zekno never changes DNS. All three are out of scope here and recorded only so this spec does not contradict them.

## Why

Version 1 of the signed deploy does what it promises for one developer over SSH. It cannot carry the features that come next, and two of its rules fail once more than one machine deploys.

- **An old deploy can run after newer ones.** The runner accepts any deploy numbered above its last. Whoever carries deploys and holds one back (the hosted service, when it exists) can deliver it days later, after a teammate's or CI's newer deploys, and it runs: old content, and later an old pre-deploy command against a database that has moved on (the review's V1, high). Version 2 binds each deploy to the number it was made after, so a deploy overtaken by another can never run.
- **Secrets live only on the machine that set them.** Every deploy sends every sealed value again, and a deploy may leave a secret out without anyone noticing: Docker Compose fills a missing variable with an empty string, and some apps then fall back to an insecure default (V5). CI or a second machine cannot deploy an app's secrets at all. Version 2 keeps each secret's latest record on the server, sends a record only when the server lacks it, and refuses a deploy that does not account for every secret the app has.
- **A secret set by someone who has left is dropped quietly.** Today the CLI prints "Left out a record: unknown_signer." and deploys without it, so the app starts with one secret fewer. Version 2 stops and says what to do.
- **There is no room for what comes next.** Domains, health checks, builds from source and pre-deploy commands each need a signed field. Fixing the whole format once means later features add behaviour, never a new format.

For one developer deploying over SSH, little changes day to day. This feature is the ground the next features stand on, and its value is in what it closes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A deploy that was overtaken can never run (Priority: P1)

A developer runs `zekno deploy`. The deploy names the last deploy of the app it was made after. If another deploy of the app reached the server first, this one is refused, nothing of it runs, and the developer is told so in one sentence that says what to do (lines.md, C1). No deploy, however validly signed, runs after a deploy of the same app that was accepted after it was made.

**Why this priority**: It is the high finding the design was revised for, and the hosted service and CI both depend on it.

**Independent Test**: With a test runner, sign two deploys of one app against the same last number and deliver them in either order: exactly one runs, the other is refused and changes nothing. Sign a deploy, let another be accepted, then deliver the first: it is refused, for good.

**Acceptance Scenarios**:

1. **Given** an app at deploy 41 on a server, **When** the developer runs `zekno deploy`, **Then** the deploy is signed as made after 41 and numbered 42, and the result line is today's: `Deploy 42 of demo is running on prod with 2 secrets.`
   **Decided: (b), and no real-server proof in this feature.** The new runner is tried in the tests, which run the real runner program and real Docker on this machine. `main` stays releasable: a zekno built from it keeps installing 0.1.0 and signing version 1 until 015 ships 0.1.1, which is also when the proof on a real server happens, as decided. The reason not to prove it on the maintainer's server now: the first write of the new runner makes the server's state unreadable to runner 0.1.0, and no release exists to leave it on.
2. **Given** two terminals that both read 41 and both sign 42, **When** the second arrives after the first was accepted, **Then** it is refused, nothing of it runs, no number is used, and the CLI reads the server again and says another deploy reached it first as deploy 42 and that deploying again puts this one on top (C1).
   **Decided: (a).** Stop before signing, with the sentence on the board `Deploy2Versions`. Releasing an app's domains because zekno was out of date is the kind of surprise this project exists to prevent.
3. **Given** a deploy whose answer never came, **When** the developer deploys again and the server's last number equals that deploy's own, **Then** the CLI says it cannot tell which deploy with that number ran (C2).
   **Decided: (a).** It is the design's own recommendation and a few lines of code.
4. **Given** an app the server already holds, **When** a deploy for it is signed as the app's first, **Then** the runner refuses it (`replayed`) and the CLI's own check that stops such a deploy before signing stays as it is.
   **Decided: (b).** Give `composeUp` its working folder in the new runner. Leave the bound of 1,000 alone: it lives only on the version-1 path, which is on its way out, and it has never been met.
5. **Given** an app at deploy 41, **When** the developer runs `zekno rollback`, **Then** it prints today's `Rolling back demo to what deploy 40 ran.` and signs a new deploy made after 41 and numbered 42, with the current secrets.
   **Decided: (b).** One lock and no time limit now. Both belong with builds from source, which is what makes a deploy long.
6. **Given** a runner whose answer about the app's last number is false, **When** the deploy reaches it, **Then** it is refused (`replayed` or `sequence_jump`) and nothing runs: a lie can only make a deploy fail.
   **Decided: B (2026-11-18), replacing (a).** `zekno secret set` and `zekno secret rm` stay offline, as today, in every case. They learn a version from this machine's records and from what it remembers of the server's statements, read by its last version-2 deploy.

---

### User Story 2 - Secrets are sent once, and every secret is accounted for (Priority: P1)

A developer sets three secrets and deploys. The server keeps each secret's latest sealed record. On the next deploy, only a secret that changed travels again. A deploy must name every secret the app has on the server, as current or as removed. A secret is left out only by `zekno secret rm`, which signs its removal, as it does today.

**Why this priority**: It closes V5, and it is what lets CI and a second machine deploy an app later.

**Independent Test**: Deploy an app with three secrets, then deploy again with none changed: the second request carries no sealed value and the app starts with all three. Sign a deploy that lists two of the three: the runner refuses it and nothing runs.

**Acceptance Scenarios**:

1. **Given** an app whose three secrets the server holds, **When** the developer deploys with nothing changed, **Then** no sealed value is sent, the app starts with all three, and the result line counts three secrets.
2. **Given** one secret set again since the last deploy, **When** the developer deploys, **Then** only that record is sent, and the server keeps the new version and deletes the old one.
3. **Given** a deploy that leaves out a secret the server holds, **When** it arrives, **Then** it is refused (`secrets_mismatch`), no number is used, and the CLI explains it in one sentence (R3).
4. **Given** `zekno secret rm API_KEY` and a deploy, **When** the deploy is accepted, **Then** the server marks the secret removed, deletes its stored record, and refuses that version or any lower one for good.
5. **Given** this machine has lost its copy of a secret the server holds, **When** the developer deploys, **Then** the deploy lists it from the record the server holds, checked on this machine, and the value never passes through this machine.

---

### User Story 3 - A secret set by someone no longer in the team stops the deploy (Priority: P1)

A team list removes a member who had set `DATABASE_URL`. The next deploy of the app stops before anything is signed. The developer is told which secret, why, and the two commands that fix it (C4). After either command, the deploy goes through.

**Why this priority**: The maintainer decided it (Clarifications). It turns a quiet loss into a refusal a person can act on.

**Independent Test**: With stand-ins (the CLI has no command to remove a member yet), build a team of two, have the second member set a secret, remove that member from the team list, and deploy: the CLI stops and names the secret; a deploy signed anyway is refused by the runner (`untrusted_secret`); after the secret is set again, the deploy starts.

**Acceptance Scenarios**:

1. **Given** a secret set by a member since removed, **When** the developer runs `zekno deploy`, **Then** nothing is signed and the CLI names the secret and says to run `zekno secret set` or `zekno secret rm` for it (C4).
2. **Given** a runner that already has the team list without that member, **When** a deploy that uses the secret arrives anyway, **Then** it is refused (`untrusted_secret`) and no number is used (R5).
3. **Given** the secret set again by a current member, **When** the developer deploys, **Then** the deploy starts.
4. **Given** the secret removed with `zekno secret rm`, **When** the developer deploys, **Then** the deploy starts without it, and the removal is signed.

---

### User Story 4 - Old and new programs say plainly what to do (Priority: P1)

A developer updates zekno before updating the runner, or the other way round. Every pairing either works or stops with a sentence that says which program to update. Nothing is half understood, silently dropped, or silently signed in an older format.

**Why this priority**: Runners are updated by hand, one server at a time. Today's servers run 0.1.0, which knows only version 1.

**Independent Test**: Run this feature's CLI against runner 0.1.0, and runner 0.1.0's own CLI against this feature's runner, and check each scenario below.

**Acceptance Scenarios**:

1. **Given** a server that runs 0.1.0, **When** the developer runs `zekno deploy` with this feature's CLI, **Then** the CLI signs a version-1 deploy as today, the app starts, and the CLI says this deploy was signed in the older format and how to update the runner (C6). `zekno status` and `zekno server add` say today's W3, and `zekno doctor`'s Runner line says today's `0.1.0, older than this zekno's …` (lines.md, part V).
2. **Given** this feature's runner and a zekno from before it, **When** that zekno deploys an app the runner held before it was updated and that has had no version-2 deploy, **Then** it is accepted as today.
3. **Given** the same pair, **When** that zekno deploys a new app, or an app this feature's CLI has deployed since, **Then** it is refused before anything is used, and that zekno says what it says today for an unknown reason: `The runner refused the request (unsupported_version).`
4. **Given** a runner of a later version than this CLI, **When** the developer runs `zekno status`, **Then** it says today's W5 (`… and speaks a newer protocol. Update zekno before you deploy to prod.`). What `zekno deploy` does then is Decided with the maintainer, item 2.
5. **Given** this feature's runner has written its state, **When** someone puts runner 0.1.0 back by hand, **Then** that runner refuses every request (`invalid_state`) and never reads the state as empty.

---

### User Story 5 - A deploy that asks for what the runner does not do yet is refused (Priority: P2)

A version-2 deploy whose `builds`, `routes`, `health` or `predeploy` is not empty reaches a runner of this feature. The runner refuses it, uses no number, and runs nothing. The CLI of this feature never signs such a deploy; a later CLI asks the runner's protocol first and stops before signing (design, part 4.7).

**Why this priority**: The format is fixed now for fields that are carried out later. A runner that ignored one would run something other than what was signed.

**Independent Test**: Sign, in a test, a version-2 deploy with one route, then one with each other later field: each is refused `unsupported_version`, and the runner's state and the app are unchanged. A deploy whose later field breaks its own pattern is refused `malformed` first.

**Acceptance Scenarios**:

1. **Given** a version-2 deploy with a non-empty `routes`, **When** it reaches this feature's runner, **Then** it is refused `unsupported_version`, no number is used, and the CLI explains it in one sentence (R7).
2. **Given** a version-2 deploy with an unknown field, a `v` other than 2, or a later field that breaks part 5's rules, **When** it arrives, **Then** it is refused `malformed`.

---

### User Story 6 - Deploys can carry an expiry (Priority: P3)

Every version-2 deploy says when it expires, or that it does not. The runner refuses one whose time has passed by its own clock. Over SSH, this feature's CLI signs no expiry, so a person sees no difference. The rule that a deploy taken from the hosted service must carry an expiry is built and tested, ready for that service.

**Why this priority**: Decided with the maintainer: only the field and its checks now.

**Independent Test**: Sign a deploy that expired a minute ago: refused `expired`, no number used. Check, in the core library, a deploy with no expiry marked as taken from the hosted service: refused `expired`.

**Acceptance Scenarios**:

1. **Given** a deploy whose expiry has passed by the runner's clock, **When** it arrives, **Then** it is refused `expired` and nothing runs (R6).
2. **Given** a deploy with no expiry, **When** the CLI keeps it, **Then** it is kept only in this machine's history and sent only over the SSH session it was signed for.

---

### User Story 7 - The README says what the hosted service can read (Priority: P3)

A reader of the security model learns exactly what the hosted service, when it exists, would read of each deploy, and what it cannot read.

**Why this priority**: Decided with the maintainer (Q12). Version 2 widens what the service reads, and today's note understates it.

**Independent Test**: Compare the README's note with the design's threat T14 and part 4.5: every readable item is named, and none is said to be hidden that is not.

**Acceptance Scenarios**:

1. **Given** the README's security model, **When** a reader reads the note on metadata, **Then** it names what a deploy shows the hosted service and says it cannot read secret values (M1).
2. **Given** the docs' security page, **When** it is read, **Then** its note says the same as the README's (M2).

---

### Edge Cases

- Two deploys of one app from two terminals at once: one gets today's `busy`; one that read the number before the other finished is refused as overtaken (C1).
- A connection that drops after the deploy was sent: the history keeps it as sent. What the next `zekno deploy` does with it depends on Decided with the maintainer, item 7.
- A runner restored from a backup lowers each app's number, and deploys accepted since could be delivered again in order (design T34). Restoring the runner's folder is not supported; set the server up again. Unchanged by this feature, and the docs say so.
- An app deployed only with version 1 so far, with secrets: its first version-2 deploy must carry each secret's record, or the secret must be removed. A machine that holds the records sends them; one that does not is told which secret it cannot account for (C5).
- A secret this machine never had, held by the server: listed from the server's record without its value passing through this machine.
- A team list update that removes a member arrives during a deploy that has already passed the point where its number is used: that deploy finishes (design, part 6).
- `zekno server update` brings a server from 0.1.0 to this feature's runner: from its first write, runner 0.1.0 cannot read the server's state again, and a zekno from before this feature can deploy only the apps that have had no version-2 deploy.
- A runner on this machine (`--local`) comes with zekno, so it moves to version 2 with the CLI, and an older zekno then refuses it as above.
- A zekno from before this feature reading this feature's runner's `status`: the answer keeps its exact shape.
- The server's clock is wrong: an expiry can refuse a deploy, or accept one that is late but still next. The order never depends on the clock.

## Requirements *(mandatory)*

### Functional Requirements

**The version-2 message**

- **FR-001**: The core library MUST define the version-2 deploy as the design's parts 3 and 5 give it: kind `zekno.deploy.v2`, `"v": 2`, every field of version 1 with the same meaning, and `previous`, `expiresAt`, `builds`, `predeploy`, `health` and `routes`. Every field MUST be present in every deploy; "none" is `null` or `[]`.
- **FR-002**: The whole format MUST be fixed now, with every pattern and limit of part 5, including those of the fields carried out later, so that later features add behaviour and never change the format. The payload stays within today's 1 MiB.
- **FR-003**: The kind MUST be inside the signature, so that a version-2 signature never verifies as version 1 and a version-1 signature never as version 2. A payload of kind `zekno.deploy.v2` whose `v` is not 2 MUST be refused `malformed`. The version-1 verifier MUST keep accepting exactly what it accepts today.
- **FR-004**: Every message MUST be read strictly: an unknown field, a missing field or a value outside its rule is refused, never ignored and never filled with a default.
- **FR-005**: The CLI MUST check a version-2 deploy against the same rules before it signs, so it never signs what the runner would refuse as `malformed`.

**The order of deploys** (design, part 3.1)

- **FR-006**: `previous` MUST be the app's last accepted number as the CLI read it from the runner on the deploy's own connection, 0 when the app has none, and `sequence` MUST be exactly `previous + 1`.
- **FR-007**: The runner MUST accept a version-2 deploy only when `previous` equals its own last number for the app: lower is refused `replayed`, higher `sequence_jump`. Neither uses a number.
- **FR-008**: Version-1 and version-2 deploys of an app MUST share one counter. The first version-2 deploy of an app names whatever number is last, whichever version made it.
- **FR-009**: The runner MUST never drop an app's last number.
- **FR-010**: For a version-2 deploy the CLI MUST NOT keep a number of its own or apply the bound of 1,000 above this machine's highest; it signs one above the runner's number.
- **FR-011**: When a version-2 deploy is refused `replayed`, the CLI MUST read the runner's state again on the same connection and say that another deploy of the app reached the server first, with its number, and that nothing of this one ran (C1); when this machine signed a deploy with that number too, it MUST say it cannot tell which ran (C2).
- **FR-012**: A rollback MUST be a new deploy made after the current number, with the old Compose text and the current secrets. `zekno rollback` keeps its flags and its lines. A rollback to a version-1 entry of an app now at version 2 is signed as version 2.

**Expiry**

- **FR-013**: `expiresAt` MUST be a time or `null`. The runner MUST refuse `expired` a deploy whose expiry has passed by its own clock, checked once, before the number is used.
- **FR-014**: The core library MUST refuse `expired` a deploy taken from the hosted service whose `expiresAt` is `null`. No runner takes deploys from the hosted service in this feature; the rule is built and tested only.
- **FR-015**: This feature's CLI MUST sign no expiry over SSH, and MUST NOT hand an envelope whose `expiresAt` is `null` to anything but this machine's history and the SSH session it was signed for.
- **FR-016**: Whether a deploy may run, and in which order, MUST NOT depend on any clock except for the expiry check.

**Secrets by version** (design, part 4.5)

- **FR-017**: The signed `secrets` and `removed` lists MUST keep their version-1 shape and meaning. A version-2 request MUST carry a whole record (statement and sealed value) only for a listed secret the runner lacks.
- **FR-018**: The runner MUST keep, for each secret with a live version, its latest record, sealed as it arrived and readable only by its owner, and delete older ones. Nothing decrypted is ever written.
- **FR-019**: A version-2 deploy MUST list every secret the runner holds a live version of, in `secrets` or `removed`, or be refused `secrets_mismatch` with no number used. Leaving a secret out takes a signed removal.
- **FR-020**: For each listed secret the runner MUST, before anything is opened, apply the version rule of version 1 (`stale_secret`), then accept a supplied record only when its statement verifies against the team list it holds now, for this team, server, app, name and sealed value, with the listed version and hash; or a held record only when every field of its statement equals the listing and it verifies again now. Otherwise: `secret_missing` when there is neither, `untrusted_secret` when its statement no longer verifies, `secrets_mismatch` for a supplied record the deploy does not list.
- **FR-021**: The CLI MUST take versions and hashes only from statements it verified itself, its own records and those the runner reports through a new read, taking the highest version of each name. It MUST NOT take a version or a hash from the runner's word.
- **FR-022**: A secret the runner holds and this machine does not MUST be deployable without its value passing through this machine.
- **FR-023**: The new read MUST give names, versions, hashes and the key ids of whoever set them, never a value.
- **FR-024**: A version-1 deploy on a version-2 runner MUST store no record. Such a secret MUST come with its record in the app's first version-2 deploy, or be removed.
- **FR-025**: Stored records MUST stay within 8,192 and 64 MiB on a server; a deploy that would pass either is refused `too_large`.

**A secret set by a member since removed**

- **FR-026**: The runner MUST refuse a deploy that uses a secret whose statement was signed by a member no longer in the team list it holds (`untrusted_secret`), until the secret is set again or removed.
- **FR-027**: The CLI MUST find such a secret before it signs, stop with a sentence that names it and the two commands that fix it (C4), and sign nothing. On the version-2 path this replaces today's warning "Left out a record: unknown_signer." How the version-1 path treats it is Decided with the maintainer, item 8.
- **FR-028**: `zekno secret set` and `zekno secret rm` MUST be able to fix such a secret, and a secret only the server holds, without connecting to anything. They learn its version from this machine's records and from what this machine remembers of the server: the statements and versions the server reported to this machine's last version-2 deploy of the app, read as a floor and never trusted for a hash or for what a deploy lists (Decided with the maintainer, item 6).

**Version 1 and version 2 together** (design, part 4.7)

- **FR-029**: Before it signs, the CLI MUST learn the runner's protocol on the deploy's own connection and decide: version 2 when the runner carries out every field the deploy uses; otherwise version 1, as today, when the deploy uses nothing new and the runner would accept version 1 for the app; otherwise it stops and names the runner to update. This feature's CLI with runner 0.1.0 therefore signs version 1.
- **FR-030**: When it signs version 1 because the runner is older, the CLI MUST say so (C6), in `zekno deploy`, `zekno rollback` and the app's deploy screen.
- **FR-031**: A version-2 runner MUST accept a version-1 deploy only while the team list it holds is version 1, and only for an app it held when it first read a state from before version 2 and that has had no version-2 deploy since. Otherwise it refuses `unsupported_version`, a reason older CLIs can read.
- **FR-032**: The state MUST carry a version mark. A version-2 runner reading a state with no mark MUST mark every app it holds as version 1, and MUST write the whole state with its mark at every write, `setup` included. The version-1 path MUST write back the whole version-2 state with only the last numbers and the secret versions changed (V21). A marked state with a missing part is `invalid_state`.
- **FR-033**: The answers that exist today (`status`, `apply`, `sync`, `setup`, `state`, `logs`, `version`) MUST keep their exact shape. A reason only version 2 has appears only in answers to version-2 requests.
- **FR-034**: An older runner reading a version-2 state MUST fail closed, as it does today with any state it cannot read.
- **FR-035**: The CLI's history MUST hold both kinds, each read and checked with its own verifier; only deploys the runner accepted are offered for rollback, as today.

**What the runner does not carry out yet**

- **FR-036**: A version-2 deploy whose `builds`, `routes` or `health` is not empty, or whose `predeploy` is not `null`, MUST be refused `unsupported_version` once every format check has passed, with no number used and nothing run.
- **FR-037**: The protocol number MUST become 3 and mean: version 2 with `previous`, `expiresAt` and secrets by version. A runner of this feature MUST answer two new session commands, one that takes a version-2 deploy and one that reads the held records of an app, each with its own bound on the answer's size (design, part 7). The upload of build chunks (`pack`) is not part of protocol 3.
- **FR-038**: The runner MUST check a version-2 deploy in the order of the design's part 6 for the fields this step carries out, so that every refusal comes before the number is used and changes nothing but the team lists sent with it.
- **FR-039**: The CLI MUST explain every new refusal reason in one plain sentence (lines.md, R-lines). None may fall to the general `The runner refused the request (…)`.

**What stays true**

- **FR-040**: What runs MUST be what was signed: the Compose text is signed whole, and the runner hands it to Docker Compose unchanged.
- **FR-041**: Secret values MUST be sealed for the server on the developer's machine, opened only by the runner after every check, and never printed, logged or written decrypted, on either side.
- **FR-042**: The team list MUST decide who may deploy and whose secret statements count, on the runner as on the CLI.
- **FR-043**: The runner MUST open no network port and make no network connection of its own.
- **FR-044**: The state MUST be saved before anything starts, so that a deploy accepted once never runs twice; a refusal MUST leave the app and the state as they were, except the team lists sent with it.

**Review, release and the project's rules**

- **FR-045**: An independent security review of the new surface MUST be part of this feature, before it is merged: the message and its verifier, the runner's checks and stored state, stored records, the version-1 path on a version-2 runner, and the CLI's choice of format. Each finding is answered in writing.
- **FR-046**: No package MUST be added without the maintainer's agreement. If part 5's rules need one (for example to check a domain's A-labels), it is brought to the maintainer first.
- **FR-047**: Every new sentence MUST keep the project's wording rules: "runner", never "agent"; pre-alpha and unaudited stay visible; nothing is promised that is not built; the desktop app is not named in the README or the docs.
- **FR-048**: Every new or changed line a person sees MUST be approved by the maintainer before it is built.
- **FR-049**: The maintainer's server MUST be used only with a go-ahead each time. Every outward step (pushing a branch or a release tag, approving a release) is the maintainer's.
- **FR-050**: Which runner release this feature ends with, and whether it reaches `main`, is Decided with the maintainer, item 1. `main` MUST never name a development version.

**The README and the docs**

- **FR-051**: The README's note on what the hosted service can read MUST name what each deploy would show it (design, T14 and part 4.5), label the items that arrive with later features, and say it cannot read secret values (M1).
- **FR-052**: The docs' security page MUST say the same (M2). The docs pages on deploying, rolling back, secrets and the runner MUST describe what changes, and the test that holds the docs and the CLI in step MUST keep passing.

### Key Entities

- **Version-2 deploy**: a signed statement that one server should run one app's Compose text with these secrets, made after a named deploy, valid until a time or without one, with the later fields present and empty.
- **Previous number**: the app's last accepted deploy number the signer read. The runner accepts the deploy only when it still is.
- **Expiry**: the time after which the runner refuses the deploy, or none.
- **Held record**: a secret's latest statement and sealed value, kept by the runner per app and checked again at every use.
- **Version mark**: on the runner's state, that a version-2 runner wrote it; per app, whether it may still take version 1.
- **Protocol 3**: what a runner of this feature says it carries out.
- **Refusal reason**: the fixed word a runner answers with, which the CLI turns into one sentence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In tests of every order of delivery of up to three deploys of one app, no deploy runs after a deploy of the app that was accepted after it was made, and every refused deploy leaves the state unchanged.
- **SC-002**: Every pairing of kind (`zekno.deploy.v1`, `zekno.deploy.v2`) and `v` (1, 2, other) lands on a refusal except the two matching pairs.
- **SC-003**: Each later field, set alone, is refused `unsupported_version` by this feature's runner with no number used, in 4 of 4 tests.
- **SC-004**: A second deploy with no secret changed carries 0 sealed values; a deploy that leaves out a live secret is refused, in every test.
- **SC-005**: Every end-to-end deploy test of today passes against runner 0.1.0 driven by this feature's CLI, which says the older format was used each time.
- **SC-006**: A zekno from before this feature deploys an app held before the update, and is refused for a new app and for an app deployed with version 2, with the server's state byte for byte unchanged after each refusal.
- **SC-007**: After a version-1 deploy on a version-2 runner, the state keeps its mark and every app's mark (V21), in every test.
- **SC-008**: Across every test of this feature, no secret value appears in any printed line, error, log, history entry or file other than a sealed record.
- **SC-009**: The independent review ends with every finding answered, and none high or medium left open.
- **SC-010**: Every check of the repository passes, and the runner opens no listening socket in any test.
- **SC-011**: Every refusal reason a runner of this feature can give is explained by its own sentence; 0 fall to the general one.

## Assumptions

### Decided with the maintainer (2026-11-18)

Each of these was a decision this step needed that neither the design nor the first decisions of 2026-11-18 settled. The maintainer took the recommendation on each. The options are kept so the reason stays readable.

1. **The release this feature ends with, and `main`.** The maintainer said 0.1.1 comes with 015. (a) A development release, such as `0.1.1-dev.1`, cut from `dev` and recorded there, while `main` keeps 0.1.0: `dev` then names a development version, so `dev` cannot be merged into `main` (the `check-main` rule of `apps/runner/RELEASING.md`) until 015's 0.1.1, and any fix meant for `main` meanwhile goes another way. (b) No release: the new runner is tried from source only (`--runner-file`, a runner on this machine); a zekno built from `dev` keeps installing 0.1.0 and so signs version 1 on every server until 015. (c) A prod release now, so 015 ends with another number than 0.1.1. Also: whether this feature includes a proof on a real server, or leaves it to 015.
2. **This CLI and a runner newer than it.** Today a runner with a higher protocol only draws a warning (W5) and deploys go ahead. This CLI signs every later field empty, and on a runner that carries out routes an empty `routes` releases every domain of the app (design, part 4.2: "a route left out is released"). Neither the design nor the review covers this direction. (a) `zekno deploy` and `zekno rollback` stop before signing when the runner's protocol is higher than the CLI's (C7). (b) Keep today's warning only, and accept that an out-of-date zekno can release domains.
3. **A cap on expiry.** Q7 recommends refusing an `expiresAt` more than 7 days after the runner's own clock, and leaves it to the maintainer. (a) Build the cap: a CI configured with a long expiry cannot keep T5 and T31 open past a week. (b) No cap: the signer chooses any window.
4. **The two findings in today's code (part 13).** `composeUp` runs without a working folder; the bound of 1,000 refuses a machine with no history past an app's 1,000th deploy. (a) Fix both here, in the runner release this feature ends with and in the version-1 path the CLI still uses with 0.1.0. (b) Fix the first only. (c) Fix neither: version 2 makes the second unneeded, and the design says "in the next runner release" for the first.
5. **Two locks and a time limit on `docker compose up`.** Part 6 gives the runner a short state lock beside the deploy lock, so a team list update (`sync`) is never refused while a deploy runs, and limits `up` to 1,800 seconds on both paths. (a) Build both now. (b) Keep one lock and no limit until builds make deploys long. With one lock, V20 holds because nothing writes the state after the number is used; with two, the rule "read again, change only your own part" is needed now.
6. **How `zekno secret set` and `zekno secret rm` learn a secret's version** when this machine has no record it can verify (the server holds it, or the member who set it was removed). Today both work without reaching the server. (a) They ask the server for the records it holds, on one connection, as `zekno status` does. (b) They stay offline, and take the version from a record on this machine without trusting its signer; a false version can then lock the name.
   **Decided: B (maintainer, 2026-11-18), replacing the earlier (a).** Set and rm never connect: the four scenes `apps/cli/test/plain/plain-unchanged.test.ts` froze stay as they are. Each version-2 deploy keeps, on this machine, what the server said it holds for the app (its statements and its versions, never a value), replaced whole at each read. Set and rm take the next version as one above the highest of this machine's records and removals and that memory, read without trusting its signer; `zekno secret rm` signs the removal of a name this machine only remembers from the server. A remembered statement never gives a hash and never decides what a deploy lists (FR-021). A deploy that finds the server holding something this machine cannot account for stops before signing (C4, C5; and C5b, proposed, when this machine's latest record is older than one the server holds), after which the commands those sentences name work offline. Accepted: a lying runner can report a huge version, which only raises this machine's next version for that name.
7. **Sending the same deploy again (V19).** The design says that when an answer never came and nothing changed, the CLI sends the same signed deploy again instead of signing another (C3). (a) Build it now, and say what "nothing changed" means: the same Compose text, secrets and removals. (b) Leave it for the hosted service, where alternatives matter most; over SSH the CLI signs a new deploy as today.
   **Decided: (b).** Over SSH the next `zekno deploy` signs a new deploy, as today. The line C3 is not built.
8. **A removed member's secret on the version-1 path.** With runner 0.1.0 this CLI signs version 1, where no runner checks statements. (a) Stop before signing, as on version 2 (C4). (b) Keep today's warning and deploy without it.
   **Decided: (a).** One rule for the person, whichever runner the server has: the sentence on the board `Deploy2Secrets`.
9. **Refusal reasons of later fields.** The design lists `pack_missing`, `pack_mismatch`, `domain_taken` and `not_allowed_here` among protocol 3's new reasons. (a) The core library knows them all now, so this CLI explains a later runner's refusal. (b) Each joins with its feature; this CLI then says "The runner did not answer as expected" for one it does not know.
   **Decided: (b).** With item 2 (a), this zekno never deploys to a later runner, so it never receives one of them.

### Other assumptions

- Teammates are not built: the CLI has no command to add or remove a member. A secret set by a removed member is tested with stand-ins. The design's offer to set again or remove the blocked secrets when an admin removes a member comes with that command.
- Team lists stay version 1 in this feature: limits on keys (part 4.6, `not_allowed_here`) come with deploys from CI. So the version-1 path stays open on this feature's runners for apps marked version 1.
- No runner takes deploys from the hosted service, and no report goes to it. Its client, its version-2 report and its pending-deploys message are later work.
- The core library's assumption "No security decision depends on time" (spec 002) no longer holds as written: expiry depends on the runner's clock. The order never does.
- What the screens look like does not change beyond the lines in `design/lines.md`. The stage row keeps Checked, Signed, Sent, Starting.
- Screens and tests use stand-ins and example values only, never a real server, the person's profile or the system keychain.

## Out of scope

- For 015: routes and `zekno domain`, the reverse proxy (Caddy, decided), health checks, the route network and aliases (V23), runner release 0.1.1 and its proof on a real server. The first version has no zero-downtime deploys, and Zekno never changes DNS.
- Later features: builds from source and `pack` (part 4.1 b), the pre-deploy command and the rest of V4, limits on keys (part 4.6), deploys from CI, the hosted service and its client, the oldest Docker Compose the runner supports (Q18).
- Removing version 1 from the runner (Q8 recommends a later release, announced).
- Removing an app, wildcard domains, two-person approval, hiding the Compose text from the hosted service, forward secrecy for sealed records (part 4.8).
- Restoring a runner's folder from a backup (T34): not supported, as today.
