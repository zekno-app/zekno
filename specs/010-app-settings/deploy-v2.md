# Design: the signed deploy, version 2

**Feature**: 010-app-settings (spec FR-032 to FR-034, User Story 5) · **Date**: 2026-11-16 ·
**Status**: design for review. Nothing here is built. Feature 010 changes no message, no part of
`packages/core` and no part of the runner (FR-029). The features that need this design build it.

**How to read it.** Every statement about today names the file and the function it rests on. "The
code does not say" marks what the code leaves open. A statement about Docker or Docker Compose that
is not in this repository is marked "Docker's behaviour, not checked here". An independent reviewer
reads this after it is written; what they find is recorded in part 12 (FR-034).

**Words.** *The hosted service* is the control plane: it will store and relay messages, and it is
treated as hostile. *The CLI* is the developer's machine (`apps/cli`), and also CI when CI deploys
with it. *The runner* is the program on the server (`apps/runner`). *A statement* is a signed secret
record's envelope (`zekno.secret.v1`) or a signed removal (`zekno.secret-removal.v1`).

## 1. Decisions in short

1. **A new kind of signed message**, `zekno.deploy.v2`, whose payload says `"v": 2`. Every field of
   version 1 stays, with the same meaning. New fields: `expiresAt`, `builds`, `predeploy`, `health`,
   `routes`. Every field is present in every deploy; "none" is written `null` or `[]`.
2. **An image pinned by digest** (pulled from a registry, or built in CI) needs no new field. The
   digest is in the Compose text, and the Compose text is signed.
3. **A build on the server** takes a source pack the CLI made. The pack is cut into chunks of at
   most 8 MiB, each sealed for the server with the sealed box `packages/core` already uses, over SSH
   as well. The deploy signs the hash of each sealed chunk, and the hash and size of the whole pack.
   The runner checks all of it before it uses up the deploy number, never unpacks the pack itself,
   and keeps the images of the last three deploys of each app.
4. **Routes**: a deploy states all of its app's routes. A domain belongs to the app whose deploy
   first reached its start with it, until a deploy of that app leaves it out. The runner writes the
   proxy's configuration only from routes in its own state.
5. **A health check** decides whether a deploy ends `started` or `unhealthy`. With Docker Compose
   alone the old version has already been stopped by then. Keeping it running needs the proxy and
   two copies of the app at once; that is left out, and the field does not change when it comes.
6. **A pre-deploy command** runs once, in a one-off container of a named service of the new
   version, before that version starts, with a time limit. If it fails, the new version is not
   started.
7. **Secrets by version**: the signed lists keep their version-1 shape. The runner keeps the latest
   statement and sealed value of each secret, so a deploy sends a record only when the runner lacks
   it. A deployer takes versions and hashes only from statements it has verified itself.
8. **Limiting a key**: to servers, in the team list, with the CI feature. Not to apps: on one server
   that is not a boundary.
9. **Version 1 and version 2**: a runner that knows only version 1 refuses version 2 before it
   parses it. A version-2 runner accepts version 1 for an app until that app's first version-2
   deploy. One deploy counter per app serves both.

## 2. What exists today

### 2.1 The signed deploy

- **Payload.** `DeploySchema` in `packages/core/src/deploy/deploy.ts`: `v: 1`, `teamId`,
  `teamHash` (hash of the team list the signer used), `serverId`, `app`, `sequence`, `createdAt`,
  `compose` (the Compose text, at most 256 KiB as UTF-8, `LIMITS.composeBytes`), `secrets` (name,
  ciphertext hash, version; at most 256, sorted, unique) and `removed` (name, version; at most 256).
  A name appears once across both lists.
- **Envelope.** `signEnvelope` in `packages/core/src/crypto/envelope.ts` signs
  `zekno-sig-v1\n<kind>\n<length>\n` followed by the payload (`signingInput`), with Ed25519. The kind
  of a deploy is `zekno.deploy.v1` (`PAYLOAD_TYPES.deploy`). `readEnvelope` refuses another kind
  (`wrong_payload_type`) before any signature is checked. `hasOtherVersion` makes every verifier
  refuse a payload whose `v` is not 1 (`unsupported_version`).
- **Hashes.** `hash` in `packages/core/src/crypto/hash.ts`: BLAKE2b over
  `domain || 0x00 || data`. The domains are a closed list (`HashDomain`).
- **Sealed secrets.** `sealSecret` in `packages/core/src/secrets/secrets.ts` seals
  `{v, serverId, app, name, value}` with `crypto_box_seal` for the server's key. The deploy carries
  `hash("zekno/v1/secret", ciphertext)` (`sealedSecretHash`). `openSealedSecret` refuses a value
  sealed for another server, app or name (`binding_mismatch`).
- **Who vouches for a ciphertext.** Anyone can seal for a server's public key. So `createDeploy`
  (deploy.ts) accepts only records whose statement a current member signed for this team, server
  and app (`verifySecret` in `packages/core/src/secrets/secret-record.ts`). This was finding 1 of
  the core review (`specs/002-core-library/security-review.md`).
- **Time.** `createdAt` is signed and read by nobody. The core spec says "No security decision
  depends on time" (`specs/002-core-library/spec.md`, Assumptions), and replay protection chose a
  counter over expiry for that reason (`specs/002-core-library/research.md`, R5).

### 2.2 What the runner checks and does

`verifyDeploy` (deploy.ts), in order: (1) the envelope's size, shape and kind, then its signer and
signature, against the team list the runner holds; (2) JSON, `v`, strict schema, sorted and unique lists; (3) role in `DEPLOY_ROLES`,
team, team-list hash (`stale_team`), server, server listed; (4) `sequence` above the last accepted
for the app (`replayed`) and at most 2^20 above it (`sequence_jump`); (5) the sealed secrets supplied
are exactly the ones listed, by hash (`secrets_mismatch`); (6) no secret goes to a lower version, or
to another hash under the same version (`stale_secret`). Nothing is decrypted.

`apply` (`apps/runner/src/commands/commands.ts`), in order: parse the request with the strict
`RunnerApplyRequestSchema`; take the lock (`locked`); load key and state (`load`); follow the team
lists sent with it and save (`follow`); `verifyDeploy`; `withinLimits`; `openSecrets` (before
saving, so a deploy whose secrets cannot be opened does not use up its number); `writeState`; from
here the number is used; `writeCompose`; `composeUp`.

`composeUp` (`apps/runner/src/docker/compose.ts`) runs
`docker compose -p zekno-<app> -f <file> up -d --remove-orphans`, with the deploy's secrets in
Docker Compose's environment (reserved names left out, `isReservedSecretName`) and the runner's own
Docker variables over them (`dockerEnv`). The runner never reads the Compose text: it writes it to a
file and hands it to Docker. The runner's code makes no network connection of its own; `docker`,
which it starts, may (`main.ts`: "It opens no network port").

### 2.3 What the runner keeps

`apps/runner/src/home/home.ts` (`paths`): `server.key`, `server.pub`, `state.json`, `lock`, and
`apps/<app>/compose.yaml`. The state (`RunnerState`, deploy.ts) holds the server id, the team trust,
the last number per app (`lastSequence`), and for each `app/NAME` the latest version and its
ciphertext hash, or `null` for a removal (`secrets`). No ciphertext is kept. Nothing decrypted is
written (home.ts, header). `parseRunnerState` is strict: a damaged state is an error, never "nothing
accepted yet" (core review, finding 6).

### 2.4 The developer's machine

`sendDeploy` (`apps/cli/src/ops/deploy.ts`): asks the runner's `status` on the deploy's own
connection and checks its identity (`checkIdentity`); takes the next number as one above both the
runner's and the highest this machine signed (`sentDeploys`), and refuses a runner more than 1,000
ahead of its own (`MAX_AHEAD`, review 003 C4); gets the app's current secrets from the records this
machine holds (`~/.zekno/secrets/<serverId>/<app>.json`, `secretsPath` in
`apps/cli/src/profile/profile.ts`) through `currentSecrets`; signs; records the deploy as `sent`
before it leaves; sends it with the whole team-list chain (`rosters: team.profile.rosters`).

History: the signed envelopes, at most 50 per app (`HISTORY_LENGTH`, profile.ts), each with an
outcome of `sent`, `started` or `start_failed`. `prepareRollback` reads the old Compose text from a
signed history entry (`readSignedDeploy`); `sendDeploy` then signs it with a new number and the
*current* secrets. A rollback is a new deploy with old content.

### 2.5 Versions between the CLI and the runner

`RUNNER_PROTOCOL` is 2 (`packages/core/src/protocol/protocol.ts`). The session command `version`
reports the runner's version and protocol (`version` in `apps/runner/src/session/session.ts`).
`runnerRelation` (`apps/cli/src/ops/server.ts`) warns about a runner with a higher protocol ("Update
zekno before you deploy") and blocks nothing. The CLI reads every answer with a strict schema
(`answer` in `apps/cli/src/server/session.ts`): an unknown field, outcome or reason is "unexpected".

### 2.6 What every item below stands on

A signed Compose text can already name any image and command, run a container privileged, and
mount the host's folders or the Docker socket. Review 003 ("Not changed, and why") records it:
signing a deploy is equal to root on the server. The product does not protect against a compromised
server (README, "What Zekno does not protect against"). So most new fields give a signer no power
they lack today. What they add is: new places where unsigned bytes enter the runner (packs, stored
records), new state the runner must keep honest (domains, kept images), and effects that must never
repeat (a pre-deploy command).

### 2.7 The attackers

As in the earlier reviews (003, 004, 005, 006) and the core review:

| Attacker | Can do |
|---|---|
| The hosted service | Read, change, drop, delay, reorder, replay and invent any message it relays. Holds no key. |
| Whoever can start the runner (A) | Send the runner any input. Holds no team key. |
| Whoever can change the profile folder (B) | Change `~/.zekno`, including the SSH destination and the history. Cannot read the keychain. |
| A project folder's author | Write a cloned repository: its settings file, Compose file, Dockerfile, links. |
| A runner or server that lies | Answer anything. Includes another machine at the SSH destination. |
| Whoever answers for a network host | A registry, a package host during a build, a domain's DNS, a certificate authority, a time server. |
| A stolen member key | In particular CI's key, which lives in CI's secret store. |

### 2.8 Noticed while reading, not part of this design

- `composeUp` starts Docker Compose without a working folder (no `cwd` in its `Bun.spawn`), so it
  runs in the folder the runner was started in. `dockerOutput` and `followLogs`
  (`apps/runner/src/docker/inspect.ts`) start theirs in the runner's folder since review 004 S8.
  What `docker compose up -f <file>` reads from the folder it starts in, the code does not say.
  Every Docker command version 2 adds should start in the runner's folder; whether `composeUp`
  should too is worth a reviewer's look.
- With no deploy history (CI, or a second machine), `MAX_AHEAD` in `sendDeploy` compares the
  runner's number with 0, so such a deployer refuses any app past its 1,000th deploy. Part 4.7 says
  what this means for version 2.

## 3. The shape of version 2

**Kind and version.** The envelope's kind is `zekno.deploy.v2` and the payload says `"v": 2`.
The kind is inside every signature (`signingInput`), so a version-2 signature never verifies as a
version-1 deploy, whatever a verifier does with `v`, and `readEnvelope` refuses it before parsing.
`v` stays so that a payload read on its own says what it is, as every other kind does. A payload
of kind `zekno.deploy.v2` whose `v` is not 2 is `malformed`.

**Every field present.** As in version 1, every field is required. A deploy with no build says
`"builds": []`; with no health check, `"health": null`. A signer never leaves a decision to a
default someone else picks later.

**Fixed once, carried out in steps.** The format is decided here, once. The features that need it
can ship one after the other: a runner refuses a version-2 deploy that uses a field it does not
carry out yet (`unsupported_version`), and never ignores it. The protocol number says which fields
a runner carries out, so the CLI does not sign what the runner would refuse (part 7).

**New hash domains.** Three labels join `HashDomain` (hash.ts): `zekno/v1/pack` (a whole source
pack), `zekno/v1/pack-chunk` (one sealed chunk) and `zekno/v1/build` (a build key). The construction
is the existing one. Hashing a pack of up to 512 MiB needs BLAKE2b fed in pieces (libsodium's
`crypto_generichash` init, update, final): the same function as `hash`, which today takes its input
in one piece.

**An example.**

```json
{
  "v": 2,
  "teamId": "team_…", "teamHash": "…", "serverId": "srv_…", "app": "demo",
  "sequence": 42, "createdAt": "2026-11-20T10:00:00.000Z", "expiresAt": null,
  "compose": "services:\n  web:\n    image: zekno.invalid/demo:3f9c…\n    pull_policy: never\n…",
  "secrets": [{ "name": "DATABASE_URL", "hash": "…", "version": 3 }],
  "removed": [],
  "builds": [{
    "pack": { "hash": "…", "size": 18874368, "chunks": ["…", "…", "…"] },
    "dockerfile": "Dockerfile", "target": null,
    "args": [{ "name": "NODE_ENV", "value": "production" }],
    "secrets": [], "network": "default", "timeout": 1800
  }],
  "predeploy": { "service": "web", "command": ["bun", "run", "migrate"], "timeout": 600 },
  "health": { "timeout": 120, "services": [{ "service": "web", "http": { "port": 3000, "path": "/health" } }] },
  "routes": [{ "domain": "demo.example.com", "service": "web", "port": 3000 }]
}
```

**Size.** The whole payload stays within `LIMITS.payloadBytes` (1 MiB), as version 1. Worst case
with every list full: Compose text 256 KiB, secrets about 40 KiB, removals about 20 KiB, builds about
90 KiB (64 chunk hashes, eight recipes, 64 KiB of arguments), pre-deploy 16 KiB, health 20 KiB,
routes 20 KiB. About 470 KiB before JSON escaping. A Compose text full of characters JSON escapes
can already pass the limit in version 1, where `signEnvelope` refuses it (`too_large`).

**Where each later setting goes.** The settings file reserves these places (design.md, "The
file"); this is what the CLI turns each into.

| Place in `zekno.app.json` | In the signed deploy |
|---|---|
| `source.image` with a digest | the Compose text only (part 4.1 a) |
| `source.build` | an entry of `builds`, and the image `zekno.invalid/<app>:<key>` in the Compose text (part 4.1 b) |
| `deploy.healthcheck` | `health` (part 4.3) |
| `deploy.predeploy` | `predeploy` (part 4.4) |
| `networking.domains` | `routes` (part 4.2) |
| `deploy.replicas` | nothing in version 2 (part 4.8) |

**CI is not a setting.** Deploying from CI changes which key signs, not what is deployed. A key's
standing lives in the team list, which an admin signs (role `deployer`, and with part 4.6 the
servers it may reach), and CI's own configuration holds the key and the team code. The settings
file is unsigned content of a project, possibly a cloned repository's, so nothing in it may decide
who can deploy. A CI deploy carries the same fields as any other (part 4.1 c, part 4.5).

## 4. Item by item

Each item says: what is signed; what the runner checks; what it keeps; what the hosted service can
and cannot do; what changes with a lying or compromised server; how a rollback works; limits and
cost. Part 6 puts every check in one order.

### 4.1 How what runs is pinned

#### (a) An image pinned by its digest

**Signed.** Nothing new. The Compose text names `image: <name>@sha256:<64 hex>` (a tag may stand
before the `@`; the digest decides). Whether the CLI turns a tag into a digest before it signs, by
asking the registry, is the settings feature's choice. Recommended: yes, and show it.

**Runner checks.** Nothing new. Docker pulls by digest and refuses content with another digest
(Docker's behaviour, not checked here). The runner does not parse the Compose text and version 2
keeps it so. A digest of a multi-platform index pins the list of per-platform manifests, so it
still pins content.

**Runner keeps.** Nothing new. Docker keeps pulled images until something prunes them.

**Hosted service.** Cannot change the digest: it is inside the signed text. Can withhold. Learns
image names and digests (it reads every Compose text today: core spec, Assumptions).

**Whoever answers for the registry.** After signing, it can only make the pull fail. When the CLI
asks it for a tag's digest, it decides what the developer signs: pinning protects what happens
after signing, not the lookup. A CI build's own digest (c) avoids the lookup.

**Lying or compromised server.** Runs what it wants and says it ran the digest. Nothing changes.

**Rollback.** The old Compose text names the old digest. Docker uses its copy, or pulls by digest;
if the registry deleted it and the server pruned it, the rollback starts nothing (`start_failed`).

**Cost.** None in the message, none in the runner's state, no new failure.

#### (c) An image built in CI and pinned by digest

The same as (a) on the runner's side. What differs: the digest comes from CI's own build output,
not from asking a registry afterwards, and the deploy is signed with CI's key (role `deployer`).
CI needs a member key, the team list and its founding code, and a way to the runner (SSH today).
Part 4.6 and threats T23 and T24 are about that key. Part 4.7 is about CI having no history.

#### (b) An image built on the server from source the CLI packed

**Signed.** Each entry of `builds` names a pack and a recipe:

- `pack.hash`: `hash("zekno/v1/pack", the pack's exact bytes)`.
- `pack.size`: its size in bytes.
- `pack.chunks`: in order, `hash("zekno/v1/pack-chunk", sealed chunk)` for each chunk.
- `dockerfile`: its path inside the pack. The pack is the build's context, so there is no separate
  context path.
- `target`: a stage of the Dockerfile, or `null`.
- `args`: plain build arguments, as a sorted list of names and values. Signed, and readable by the
  hosted service. Names follow the secret-name pattern and are not reserved
  (`isReservedSecretName`): a `*_PROXY` argument would send the build's downloads elsewhere.
- `secrets`: names of secrets the build may read. Each must be in the deploy's `secrets` list.
- `network`: `"default"` or `"none"`.
- `timeout`: seconds.

Two builds that use the same folder carry the same pack (same hash and chunks); it travels once.

The Compose text names the image of a build as `zekno.invalid/<app>:<key>`, with
`pull_policy: never`, where `key` is
`hash("zekno/v1/build", JSON of [pack.hash, dockerfile, target, args, secrets, network])` in hex.
The CLI computes the key and writes it; the runner computes it again and tags its build with it.
The Compose text is still the whole description of what runs, and the text printed by
`zekno settings compose` still equals the text signed (spec FR-027). `.invalid` is reserved and
never resolves (RFC 2606, RFC 6761), so if the tag were missing, a pull of that name could not reach
any registry, and a registry answering anyway would need a certificate for that name.

**The pack.** A tar archive of the folder the build uses, made on the CLI, compressed or not: the
hash is of the exact bytes. The CLI makes it the same every time for the same files (entries
sorted, times and owners fixed), so the same files give the same hash, key and Compose text. The CLI
never follows a link out of the project and leaves out files that hold secrets (`.env*`) unless
asked: those are rules for the build feature, recorded here because a cloned repository decides
what is in its folder.

**Sealed, in chunks, over SSH as well.** The CLI cuts the pack into chunks of at most 8 MiB and
seals each with `crypto_box_seal` for the server's key, taken from the signed team list as
`sealSecret` does. Why seal over SSH, where the connection is already encrypted:

1. A deploy can go to a machine other than the server: attacker B can change the SSH destination
   (review 003, "Limits"), and over SSH the server's identity rests on SSH's host check. With a
   sealed pack, that machine gets no source.
2. The runner's folder then holds only sealed bytes, as home.ts promises ("Nothing decrypted is
   ever written here").
3. One format for SSH and the hosted service: a deploy signed for one can travel by the other.

Why not a primitive meant for large data (libsodium's `secretstream`): `packages/core` does not use
it, and the sealed box serves here. Each chunk has its own throwaway key and costs 48 bytes. The
signed list of chunk hashes fixes their order and number, so a dropped, repeated or reordered chunk
is found. No new primitive is proposed.

**How the pack travels over SSH.** A new session command, `pack`, carries one sealed chunk and the
signed deploy that names it (part 7). The runner takes the chunk only when the deploy opens as a
version-2 deploy signed by a current member allowed on this server, for this team, team list and
server, with a number it has not used and is within the step, and lists a chunk with this chunk's
hash. Nothing is used up by this check. The chunk is kept sealed under
`packs/<app>/<chunk hash>`. Each request is one session line: 8 MiB sealed is about 11 MiB of
base64url, plus at most about 1.4 MiB of envelope, within the 32 MiB line limit (`requestLines`
with `LIMITS.messageBytes` in session.ts). The session holds at most 32 MiB of waiting requests
(`QUEUE_BYTES`), so the CLI waits for each chunk's answer before it sends the next, as every request
already does. A read, `held`, says which chunks the runner already has, so an upload can resume. It
is a hint (part 4.5 explains why a hint is enough).

**How it will travel through the hosted service.** The same sealed chunks, stored by the service
and fetched by the runner by chunk hash, each read bounded to 8 MiB and 48 bytes and checked against
the signed hash before it is kept. The runner fetches only chunks named by a deploy that passed the
same gate as `pack`. A pack can pass 32 MiB because it never travels as one message. What must
exist first: the runner's client for the hosted service (README: "The control-plane client is not
written yet"), a pending-deploys message for version 2 (`PendingDeploysResponseSchema` carries
version-1 requests only), and chunk upload and download in the protocol.

**Runner checks, before the number is used.** For each build: if the runner keeps an image under
its key (below), nothing more. Otherwise every chunk of its pack must be staged, each with the
signed hash (`pack_missing` if one is absent); each must open with the server's key; the opened
bytes, fed through the hash as they come, must have the signed size and hash (`pack_mismatch`).
Nothing opened is written in this pass. All of this happens before the state is saved, so a missing
or wrong pack costs no number, and the same signed deploy can be sent again after the upload.

**What a build may reach.** The runner hands the opened pack to the builder as the build context on
its standard input (for example `docker build -` takes a tar there; Docker's behaviour, not checked
here), opening the chunks a second time and checking each chunk's hash again as it reads it. The
runner never unpacks the pack: paths inside it are the builder's to read, never the runner's to
write next to `server.key`.

- **Network.** `"default"` is the builder's usual network: the internet, and whatever the server's
  Docker bridge reaches, which includes the host and a cloud provider's metadata address, as any
  container does. `"none"` is no network. Never the host's network, never an app's network.
- **Secrets.** Only those the build names, given to the builder as secret mounts read from its
  environment (BuildKit's `--secret id=NAME,env=NAME`, as an example), never as build arguments,
  which stay in the image's history. The builder's environment is `dockerEnv` and those secrets,
  nothing else. A Dockerfile that copies a secret into a layer keeps it in the image; that image
  stays on the server.
- **Time.** The runner stops the builder after `timeout`. The lock is held meanwhile, so another
  deploy to this server is refused `busy`.
- **What the pack does not pin.** Base images named by tag in the Dockerfile, and whatever the
  build downloads. A `FROM` with a digest and a lockfile with integrity hashes narrow that. The CLI
  can warn; version 2 does not refuse.

**Runner keeps.** For each app, the keys and image ids of the builds of its last three deploys that
got as far as building (state `builds`). Images are tagged `zekno.invalid/<app>:<key>`. After each
deploy the runner removes its own tags past those three, found from its state, never from a list of
all images, so it never touches an image it did not make. Before it reuses a kept image it checks
that the tag still names the image id it recorded; if not, it needs the pack. Staged chunks are
deleted when the deploy that named them has run. Staging holds the chunks of one deploy per app
(chunks of an earlier upload for the app that the newer deploy does not name are deleted), and at
most 2 GiB in all; past that `pack` is refused (`too_large`).

**Hosted service.** Cannot swap a pack, a chunk, their order or their number: all signed. Cannot
make the runner take chunks without a signed, unused deploy that names them. Can withhold chunks:
the deploy is refused `pack_missing` and its number is kept. Learns: each pack's size and chunk
count, its plaintext hash (with which it can confirm a guess of the exact pack, such as a public
repository at a known commit), and the recipe: Dockerfile path, arguments and their values, network
choice, names of build secrets. Cannot read the source.

**Lying or compromised server.** New: it gets the source in plaintext (today only images reach it,
which often contain the source anyway). It already had every secret. It can keep a tampered image
under a kept key, which a later rollback would reuse.

**Rollback.** The rollback deploy copies the old deploy's `builds`. If the runner still keeps those
keys, no pack travels and nothing is built. If not, it refuses `pack_missing` (number kept) and the
CLI says the old source is no longer on the server; going back then means deploying the old source
again from a checkout. The CLI does not keep packs (question Q11). The same source and recipe
always reuse a kept image, so rebuilding to pick up new base images needs a changed recipe (an
argument, for example); that is the build feature's to offer.

**Limits.** A pack at most 512 MiB; chunks at most 8 MiB; at most 64 distinct chunks per deploy;
at most 8 builds per deploy; at most 32 arguments per build, each value at most 4 KiB, all
arguments of a deploy at most 64 KiB; at most 32 build secrets per build; `timeout` 1 to 7,200
seconds; staging one deploy's chunks per app and 2 GiB in all; kept builds: three deploys per app.

**Cost.** Payload: about 5 KiB per pack of chunk hashes, plus the recipes. State: about 150 bytes
per kept build, at most 24 per app. Disk: staging up to 2 GiB; kept images are bounded in number,
not in bytes. New failures: `pack_missing`, `pack_mismatch` (refusals, number kept);
`build_failed` (an outcome, number used); a server without a builder; a full disk; the lock held
for the length of a build.

### 4.2 Routes

**Signed.** `routes`: every route of the app, each a `domain`, a `service` and a `port`, sorted by
domain, each domain once. It is the whole set, not a change: a route left out is released. A domain
is lowercase ASCII (an international name as its `xn--` form), at most 253 characters, at least two
labels of 1 to 63 letters, digits and hyphens, no label starting or ending with a hyphen, a last
label that is not all digits (so never an IP address), no trailing dot, no wildcard, and not
`localhost` or under `.localhost`. Two spellings of one domain cannot both pass, so comparing the
text compares the domains.

**Runner checks.** Each domain is held by no other app (`domain_taken`). The server holds at most
1,024 domains after the change (`too_large`). The service and the port are checked by pattern only:
the runner does not read the Compose text, so a route to a service the text lacks gives the proxy
nothing to reach. The CLI checks that before signing.

**Two apps, one domain.** The first app whose deploy reached its start with the domain holds it.
A deploy of any other app that names it is refused, with no number used, until a deploy of the
holder leaves it out. Moving a domain from one app to another is two deploys: release, then claim.

**Who may release a domain.** Whoever may deploy the app that holds it to that server: any member
with a deploy role, and, with part 4.6, allowed on that server. There is no separate release
message. Removing an app altogether, and with it its domains, needs a message of its own and is
left out (part 4.8).

**When routes change.** When the deploy reaches its start: after `docker compose up` has run,
whatever its exit status. If the run stops before that (the build or the pre-deploy command
failed), the app keeps its earlier routes and domains. The check and the change happen under the
same lock (`locked` in commands.ts), so no other deploy can claim a domain in between. The routes
in force are saved to the state, then the runner writes the proxy's whole configuration from the
routes of every app in its state, in one atomic write (as `writeAtomic` in home.ts does), and has
the proxy load it. A configuration that cannot be applied makes the outcome `start_failed`.

**The proxy's configuration is built, never pasted.** It is generated from the checked fields only.
No text from a deploy reaches the proxy's configuration language without passing the patterns
above. The proxy reaches a service by a name that is unique on the server (for example the
container name Compose gives it, which starts with the project name `zekno-<app>`), on that app's
own network, never by the bare service name: two apps can both have a service called `web`, and the
proxy sits on both networks.

**The proxy itself.** Which proxy is the maintainer's choice (Caddy or Traefik, as examples). The
design asks four things of it. Its program or image is chosen by the runner release and pinned by
digest in the runner's code, never named by a deploy; otherwise the registry would decide what
terminates TLS for every app. Any admin interface is off, or unreachable from the app networks it
joins. It asks for certificates only for domains in routes (ACME, as an example). The private keys
of those certificates live on the server, in the proxy's storage.

**Runner keeps.** The routes in force of each app (state `routes`); the domain table is computed
from them, so there is one record, not two. The proxy's configuration file, which is always
computed from that state. The proxy's certificate storage.

**Hosted service.** Cannot add, change or move a route: routes are signed per app, and ownership is
checked on the runner. Can withhold a release so that a claim keeps being refused, or deliver a
claim before the release: the claim is refused, nothing is misrouted. Learns every domain.

**Whoever answers for a domain's DNS.** Decides which server browsers reach, and which server can
obtain a certificate. Zekno does not check DNS.

**Lying or compromised server.** Routes any traffic it gets. New: it holds the TLS private keys of
every routed domain.

**Rollback.** The rollback copies the old routes. Domains the old deploy had come back if no other
app holds them; domains it lacked are released. If another app has taken one since, the rollback is
refused `domain_taken`, with no number used. The CLI shows which domains a rollback moves before it
asks.

**Limits.** At most 64 routes per deploy and 1,024 domains per server; a domain at most 253
characters; ports 1 to 65,535.

**Cost.** Payload up to about 20 KiB; state up to about 350 KiB; a proxy to run and update. New
failures: `domain_taken`; a proxy that is down; an app whose own Compose text publishes port 80 or
443.

### 4.3 A health check

**What Docker Compose can do.** Docker records a health status for a container whose image or
Compose text has a health check. When a service's definition changes, `docker compose up` stops the
old container before it starts the new one (Docker's behaviour, not checked here). So when a health
check runs, the old version is already gone: there is nothing to keep running, and nothing to go
back to without a new deploy.

**Signed.** `health`: `null`, or a `timeout` and a list of services, each with `http`: `null`, or a
`port` and a `path`. The deploy counts as done when, within `timeout` seconds after Docker Compose
returns, each listed service has a running container and: with `http` null, Docker reports it
`healthy` if it has a health check, or running if it has none; with `http` set, a GET of `path` on
`port` of that container answers with a status from 200 to 399.

**Who makes the GET.** Never the hosted service and never an address the deploy names. Options are
in question Q4. Recommended: a short-lived check container on the app's own network, from an image
the runner release pins by digest. It works whether Docker runs as root or not (from the host,
container addresses are not reachable with rootless Docker), needs no tool in the app's image, and
needs no admin interface on the proxy. It follows no redirect, reads at most 1 KiB of the answer,
and gives up on one try after 5 seconds.

**Runner checks.** The patterns and limits. Nothing about the services: the runner does not read
the Compose text.

**When it fails.** The outcome is `unhealthy`. The new version keeps running and its routes are in
force. The runner rolls nothing back by itself, because going back to the previous deploy would mean
acting without a signature asked for now, with today's secrets anyway (as a rollback does), and
possibly in front of a database the pre-deploy command has just changed. Going back is a signed
rollback, which is quick when the image is kept.

**What keeping the old version running needs.** The new version started as a second Compose
project beside the old (for example `zekno-<app>-<sequence>`), the proxy switched to it once
healthy, the old one stopped after. That needs the proxy (only it can move traffic without a gap),
services that publish no host port (two copies cannot bind one port), volumes with fixed names
(Docker Compose names a volume after its project), and services that may run twice at once (not a
database on one volume, not a worker that must be alone). Left out of version 2 (part 4.8). The
health check's result is what that switch would wait for, so `health` does not change when it
comes.

**Runner keeps.** Nothing; the outcome is reported, not stored.

**Hosted service.** Cannot change the check. Learns the paths and ports. Runner reports are not
signed, so it can turn `unhealthy` into `started` for whoever reads the outcome through it (core
review, "Limits"). Over SSH the CLI reads the outcome itself.

**Lying or compromised server.** Reports any outcome. Nothing changes.

**Rollback.** Copies the old check.

**Limits.** `timeout` 1 to 1,800 seconds; at most 16 services; a path starts with `/`, at most
1,024 printable ASCII characters; ports 1 to 65,535.

**Cost.** About 1 KiB in the payload. The lock is held up to `timeout`. A new outcome, `unhealthy`.
With `http`, an image the runner pulls once.

### 4.4 A pre-deploy command

**Signed.** `predeploy`: `null`, or a `service`, a `command` as a list of words, and a `timeout`.

**Where it runs.** In a one-off container of `service` as the new deploy's Compose text defines it
(its new image, environment, networks and volumes), in the project `zekno-<app>`, before the new
version starts: in Docker Compose's terms, `docker compose run --rm <service> <words>`. The old
version keeps serving meanwhile. Docker Compose starts the service's dependencies that are not
running (Docker's behaviour, not checked here); a dependency already running from the old version
is not replaced by this step, which also is to be checked against the Compose version used.

**With which secrets.** Exactly what that service gets from the Compose text. Docker Compose's
environment holds the deploy's secrets, as for `up` (`composeUp`), and the Compose text decides
which reach the container. No secret is added for this command.

**The words.** Passed as separate arguments, never through a shell on the server. Each word must
reach the container's command, and none may be read as an option of the program that starts the
container (for example by ending its options before the service name). That is to be tested
against the Compose version used. Inside the container a shell runs only if the words name one
(`["sh", "-c", "…"]`).

**Time.** The runner stops and removes the container after `timeout`. The lock is held meanwhile.

**When it fails** (an exit status other than 0, the time limit, or a container that cannot start):
the outcome is `predeploy_failed`. The new version is not started, its routes do not take effect,
and the old version keeps running. The number is used (the state was saved before the command
ran), so this deploy can never run the command again. Trying again is a new deploy.

**Why it is safe that a signed deploy names a command.** It already does. The Compose text names an
image and a command for every service (`command`, `entrypoint`, `healthcheck.test`), and can run
them privileged with the host's folders mounted (part 2.6). What is new, precisely:

1. The command runs once per deploy and to its end, outside Docker's restart rules. A deploy
   accepted twice would run it twice. What stops that is the number rule, with the state saved
   before the command runs (step 14 of part 6).
2. It runs while the old version still serves, against what both share, such as a database. A
   failed or wrong command affects the running version.
3. Its exit status decides whether the deploy goes on.
4. Its output reaches the deployer, as Docker's output does today, and can print a secret's value,
   as Docker's errors can (review 003, "Limits").

**Runner keeps.** Nothing.

**Hosted service.** Cannot add or change a command, and cannot replay one (the number). Can delay a
deploy, so that the command runs later than meant: a migration a day late. Only `expiresAt` bounds
that (question Q7). Learns the command's words.

**Lying or compromised server.** Runs anything anyway. Nothing changes.

**Rollback.** Recommended: a rollback copies everything but the pre-deploy command, unless the
developer asks for it, because a migration written to move forward rarely suits moving back
(question Q5).

**Limits.** 1 to 64 words, each at most 4,096 characters of well-formed text without a NUL, all of
them at most 16 KiB; `timeout` 1 to 3,600 seconds.

**Cost.** Up to 16 KiB in the payload; the lock held up to `timeout`; a new outcome,
`predeploy_failed`.

### 4.5 Secrets by version

**Today.** The deploy lists each secret's name, version and ciphertext hash, and the request must
carry exactly those sealed values (`verifyDeploy` step 5). The runner keeps only versions and
hashes (`RunnerState.secrets`). The records live on the machine of whoever set them
(`secretsPath`, profile.ts). So CI, or a second teammate, cannot deploy the app's secrets.

**Signed.** The same `secrets` and `removed` lists as version 1. What they mean is unchanged: these
versions, with these hashes. What changes is where the sealed value may come from.

**Sent with the deploy, not signed.** `records`: whole secret records (statement and sealed value),
only for listed secrets the runner lacks. `removals`: removal statements, if the deployer has them.

**Runner checks, for each listed secret**, before anything is opened: first the version rule of
version 1 (`stale_secret`). Then the record:

- **Supplied:** its statement must verify as `verifySecret` does (signed by a current member,
  allowed on this server with part 4.6, for this team, server and app, naming this sealed value's
  name and hash), its version must equal the listed version, and its hash the listed hash.
- **Held:** the runner holds a record under the listed hash, and its statement still verifies
  against the team list the runner holds now.
- **Neither:** refused `secret_missing`, with no number used.

A statement that no longer verifies (its signer was removed) is refused `untrusted_secret`. A
supplied record the deploy does not list is refused `secrets_mismatch`: what is supplied is still
exactly what is needed. Supplied removal statements that verify are kept; a removal needs no
statement to take effect, as in version 1.

Checking statements on the runner is new. A removed member's secret then stops counting on the
runner as it already does on the CLI (`createDeploy` refuses it, and the core review lists "must be
set again" as a limit). It also lets the runner enforce part 4.6 on whoever set a secret, and lets
it give deployers statements they can check.

**Runner keeps.** For each `app/NAME`, the latest accepted statement: a record (its statement and
sealed value) or a removal (its statement only). A record is kept in `records/<ciphertext hash>.json`,
which the state's `{version, hash}` (as today) already names; an app's removal statements are kept
together in `removals/<app>.json`. Files are named by hash and by app, never by secret name, since
two secret names can differ only in letter case and a disk may not tell them apart. Mode 0600.
Older versions are deleted, since the runner refuses them anyway. A new file is written and synced
before the state that names it, and a file no state names is deleted after, so the state never
names a missing file. Everything kept is sealed or signed metadata; nothing decrypted is written.

**How a deployer learns what the runner holds without trusting a lie.** It never takes a version
or a hash from the runner's word, nor from the hosted service's. It asks the runner for the
statements it holds for the app (a new read, `records`), checks each against its own team list (as
`currentSecrets` does with what the hosted service supplies), takes the highest version of each
name, and signs those versions and hashes. The sealed value never has to pass through the deployer.

Which values the runner says it holds only decides what is sent: a false "held" ends in
`secret_missing`, and a false "not held" makes the deployer send a record it has, which only the
server can open. The runner cannot make a deployer sign a value no member set, because every
statement is checked. It can hide a newer statement; then the deployer signs an older version, and
a runner that saw the newer one refuses it (`stale_secret`), while one that never saw it uses an
older value a member did set. That is the withholding limit the core review already records.

**A retired secret.** As in version 1: a removal, one version above the secret, listed in
`removed`. The runner sets the hash to `null`, deletes the stored sealed value, keeps the removal
statement if it was supplied, and refuses that name at that version or below (`stale_secret`). A
higher version brings the name back. A retired secret never reaches an app.

**Version-1 deploys on a version-2 runner** store nothing: a version-1 request carries sealed
values without statements, so the runner could not show them to anyone. The first version-2 deploy
of an app must come from a machine that holds its records. Until then CI cannot deploy that app's
secrets.

**Hosted service.** Relays records it cannot open, and cannot make one that counts. Can withhold
(above). Learns names, versions, hashes, sizes and the key ids of whoever set them, as today.

**Lying or compromised server.** Already holds the values. New: it can hide statements from
deployers, and pretend to hold values it lacks. It cannot forge a statement.

**Rollback.** Takes the current versions, as today (`prepareRollback` takes the old Compose text;
`sendDeploy` the current records).

**Limits.** Per deploy as version 1 (256 and 256). Stored: at most `LIMITS.secretsPerServer`
(8,192) records and at most 64 MiB in all, since one sealed value can approach 525 KiB of base64url
at the 64 KiB value limit (`MAX_CIPHERTEXT` in secrets.ts); a deploy that would pass either is
refused `too_large`. Records sent in one request stay within 32 MiB (`LIMITS.messageBytes`), as
today's sealed values must. The answer to `records` is at most 8 MiB.

**Cost.** Up to 64 MiB of disk; one signature check per listed secret per deploy (about 256 at
most); new refusals `secret_missing` and `untrusted_secret`; a new read.

### 4.6 Limiting a key

**Where the limit is written.** In the team list, which an admin signs: a member may carry
`servers`, a list of server ids from the same list. Absent means every server. The list's hash
chain and the `stale_team` rule already make every deploy name the list it was made with.

**How it is enforced.**

- Runner: in the deploy check, after the role, the signer must be allowed on this server
  (`not_allowed_here`, a new reason); the same for the signer of each statement it takes or uses
  (part 4.5); the same for `pack`.
- CLI: `createDeploy`, `createSecret`, `createSecretRemoval` and `createLink` refuse a signer not
  allowed on that server; `currentSecrets` leaves out statements whose signer is not; `verifyLink`
  refuses such a link.

Statements must be held to the limit too. Any member can set a secret (`createSecret` checks only
membership), and the next deploy by anyone carries the highest version (`currentSecrets`). Without
this, a CI key limited to staging could set `DATABASE_URL` for production, and an admin's next
production deploy would carry it.

**What it costs in the team list's format.** `MemberSchema` (roster.ts) is a strict object, and
`parseRoster` refuses any `v` other than 1 (`hasOtherVersion`). So a list with a limit is a new
version of the team list. A runner or CLI that cannot read it refuses the list: the runner in
`follow` (commands.ts), and from then on every deploy made with the new list (`stale_team`). So
every runner and CLI of the team must read the new version before an admin signs one, and a list
stays version 1 until a limit is set. `TeamTrust` and its stored schema (part of the runner's state)
gain the field. Bytes: at most 32 server ids per member, about 1.2 KiB; 64 members, about 80 KiB.

**Why not apps.** A deploy of app A can run a container with the Docker socket or the host's root
mounted, and through it control app B and read the runner's key (part 2.6). A key limited to app A
is not kept from app B on the same server. It would stop an honest mistake only, while reading like
a boundary. Servers are separate machines: there, a limit is a boundary, as far as the servers
share nothing else.

**Hosted service.** Can withhold a team list that adds a limit, or removes a key: until a runner has
the list, the key works there as before. Over SSH, a deploy by an up-to-date member carries the
whole chain (`sendDeploy`), and an admin can send it at once with `sync`.

**Recommendation.** Server limits, built with the CI feature, as a change to the team list that is
separate from the deploy message and can ship before or after it. No app limits.

### 4.7 Version 1 and version 2 together

**A runner that knows only version 1.** The CLI sends a version-2 deploy in a new session command
(named `deploy` here, part 7). A version-1 runner refuses a request with an unknown command as a
whole, before any command's code runs (`SessionRequestSchema`, in `runSession`: `invalid_request`).
Sent through `apply` instead, it would still be refused before the deploy's payload is parsed: the
strict `RunnerApplyRequestSchema`
refuses the new request fields, and the envelope's kind would be refused by `readEnvelope`
(`wrong_payload_type`) before its signature is checked. Nothing is half-understood. The CLI does
not rely on this: it asks first.

**How the CLI knows.** The session's `version` answer gives the protocol (`RunnerVersionSchema`).
Version 2 raises `RUNNER_PROTOCOL` to 3; each later step that carries out more fields raises it
again (part 3). Before it signs (signing records a number in the history), the CLI decides:

- The runner's protocol carries out every field the deploy uses: a version-2 deploy.
- Otherwise, if the deploy uses nothing new (no build, routes, health check or pre-deploy command,
  and every record on hand) and the app is not at version 2 on that runner: a version-1 deploy, as
  today.
- Otherwise it stops and says which runner to update. A runner that does not speak sessions
  reports no protocol and is treated as version 1 only (`runnerRelation`).

**Does a version-2 runner accept version 1, and for how long.** It accepts a version-1 deploy,
through `apply` unchanged, for an app that has never had a version-2 deploy. After an app's first
version-2 deploy (state `formats`), a version-1 deploy of it is refused with `unsupported_version`,
a reason a version-1 CLI can read (`DEPLOY_REFUSALS`). A version-1 deploy has no routes, so
accepting one would release the app's domains and drop its health check without anyone asking for
that. Recommended: version 1 stays accepted for such apps until a runner release, announced, that
comes at least one release after the first CLI that signs version 2; then it is removed (Q8).

**Existing answers keep their exact shape.** An old CLI reads `status` and reports with strict
schemas (part 2.5). So `status` stays as it is; a reason or outcome only version 2 has appears only
in answers to version-2 requests; new information comes from new reads.

**The state file.** It gains a version mark. A version-2 runner reads a state with no mark as a
version-1 state and fills the new parts with nothing, once. A state with the mark and a missing
part is damaged (`invalid_state`): a lost `routes` must never read as "no domains held", which is
the core review's finding 6 again. A version-1 runner cannot read a version-2 state, so going back
to an older runner after a version-2 deploy refuses everything (`invalid_state`): it fails closed.

**Sequence numbers.** One counter per app for both versions (`lastSequence`). A version-1 deploy
signed before the change and never delivered is accepted later only if nothing after it was
accepted and the app is still at version 1.

**A deployer with no history** (CI, a second machine) takes the next number from the runner's
`status`. Over SSH that answer comes from the server SSH checked. Through the hosted service it does
not: the service could report a number far ahead, keep the deploy signed with it, let the next
deploys through with lower numbers, and deliver the kept one later, which brings old content back.
Review 003's guard (C4: one above both the runner's number and this machine's own, and at most
1,000 ahead of its own) needs a history; with none, `MAX_AHEAD` compares with 0 and refuses any app
past its 1,000th deploy (part 2.8). Not a field of the message: CI needs a number of its own kept
between runs, or `expiresAt` set on what it signs (Q7).

**History on the developer's machine.** It holds both kinds; each is read with its own verifier
(`readSignedDeploy` for version 1, a new one for version 2), and the number is taken from under the
signature as today. The outcome mark gains `build_failed`, `predeploy_failed` and `unhealthy`. A
version-2 envelope is at most about 1.4 MiB, so 50 entries are at most about 70 MiB per app.

**Rollback across the change.** To a version-1 entry from an app now at version 2: signed as
version 2 with the old Compose text and every new field empty (no build, no routes, so its domains
are released, no health check, no pre-deploy command). The CLI says so before it asks. To a runner
still at version 1: only version-1 entries, as today.

### 4.8 Left out of version 2, and why

| Left out | Why |
|---|---|
| The runner reading or limiting the Compose text (only pinned images, no privileged containers, no host folders) | It needs a Compose parser on the runner and a policy language. Without it, signing stays equal to root on the server (part 2.6), and so does everything below that rests on it. |
| Keys limited to apps | Not a boundary while the line above is left out (part 4.6). |
| Two copies at once, switching traffic when healthy, going back by itself | Needs the proxy, services without host ports, fixed volume names and services that may run twice (part 4.3). The health check's field is ready for it. |
| Wildcard domains, routes by path, TCP or UDP routes, certificates the team brings, managing DNS | A wildcard overlaps other apps' domains, and a path splits one domain between apps: the "one app holds a domain" rule would need more. The rest are features of their own. |
| Removing an app (stopping it, releasing its domains, deleting its stored records and images) | Needs a signed message of its own, with its own number rule. Today a deploy that leaves the domains out releases them. |
| Copies of a service (replicas), scheduled jobs | Features of their own (design.md lists them as later). |
| Proof of where an image was built, image signatures | The deploy's signature is the team's statement that it chose this digest. |
| Pinning what a build downloads | The pack pins the source and the Dockerfile only (part 4.1 b). |
| Hiding the Compose text, the recipe and the routes from the hosted service | The core spec puts it out of scope. It would mean sealing the payload for the server. Version 2 widens what the service reads (T14). |
| Packs kept on the developer's machine for rollback | Size. The runner keeps three deploys' builds (Q11). |
| Two-person approval | On the roadmap (README). |
| One deploy for several servers | One deploy, one server, one app (core spec). |
| Moving a domain in one step | Two deploys do it, each checked. |

## 5. Every field of the payload

Set by: the CLI, from the settings file, a Compose file, flags or its own state. "Runner" means
the checks of part 6. Limits marked new join `LIMITS` (part 8).

| Field | Type | Limit | Set by | Checked by |
|---|---|---|---|---|
| `v` | the number 2 | | CLI | runner (`malformed` otherwise: the kind already says the version); the CLI when it reads its history |
| `teamId` | text | `TEAM_ID` | CLI, from the team list | runner: its team (`wrong_team`) |
| `teamHash` | 64 hex | | CLI: hash of the team list it holds | runner: the list it holds (`stale_team`) |
| `serverId` | text | `SERVER_ID` | CLI, from the signed team list | runner: itself (`wrong_server`), listed (`unknown_server`) |
| `app` | text | `APP_NAME` | CLI | runner: every effect is on this app; at most 1,024 apps |
| `sequence` | whole number | 1 to 2^53 - 1; at most 2^20 above the last | CLI: one above the runner's and its own | runner (`replayed`, `sequence_jump`) |
| `createdAt` | ISO time | | CLI's clock | nobody, as in version 1 |
| `expiresAt` | ISO time or `null` | at most 7 days after `createdAt` (new) | CLI (Q7) | runner, by its clock, when not `null` (`expired`) |
| `compose` | text | 256 KiB UTF-8 | CLI | runner: size only; Docker Compose reads it |
| `secrets[]` | name, hash (64 hex), version | 256; sorted, unique | CLI, from statements it verified | runner (`stale_secret`, `secret_missing`, `untrusted_secret`, `secrets_mismatch`) |
| `removed[]` | name, version | 256; sorted; no name also in `secrets` | CLI, from removals it verified | runner (`stale_secret`) |
| `builds[]` | object | 8 per deploy (new) | CLI | runner |
| `builds[].pack.hash` | 64 hex | | CLI: `hash("zekno/v1/pack", pack)` | runner, after opening every chunk (`pack_mismatch`) |
| `builds[].pack.size` | whole number | 1 byte to 512 MiB (new) | CLI | runner (`pack_mismatch`); the chunk count must be the size divided by 8 MiB, rounded up |
| `builds[].pack.chunks[]` | 64 hex each | 1 to 64; at most 64 distinct per deploy (new) | CLI: `hash("zekno/v1/pack-chunk", sealed chunk)` | runner (`pack_missing`, `pack_mismatch`); the gate of `pack` |
| `builds[].dockerfile` | path | 1 to 255 characters; stays inside (`staysInside` in link.ts); no control or format character | CLI | runner (`malformed`); the builder finds it in the pack |
| `builds[].target` | text or `null` | `^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$` | CLI | runner (`malformed`) |
| `builds[].args[]` | name, value | 32 per build; name `SECRET_NAME`, not reserved; value at most 4 KiB, well-formed, no NUL; 64 KiB per deploy (new) | CLI | runner (`malformed`) |
| `builds[].secrets[]` | names | 32 per build; each in `secrets[]` | CLI | runner (`malformed`) |
| `builds[].network` | `"default"` or `"none"` | | CLI | runner hands it to the builder |
| `builds[].timeout` | seconds | 1 to 7,200 | CLI | runner stops the builder |
| `predeploy` | object or `null` | | CLI | runner |
| `predeploy.service` | text | `SERVICE_NAME` | CLI | runner (`malformed`); Docker Compose finds it |
| `predeploy.command[]` | words | 1 to 64; each at most 4,096 characters, well-formed, no NUL; 16 KiB in all | CLI | runner (`malformed`) |
| `predeploy.timeout` | seconds | 1 to 3,600 | CLI | runner stops the container |
| `health` | object or `null` | | CLI | runner |
| `health.timeout` | seconds | 1 to 1,800 | CLI | runner |
| `health.services[]` | service, `http` | 1 to 16; sorted by service, unique; `SERVICE_NAME` | CLI | runner (`malformed`) |
| `health.services[].http` | `null`, or port and path | port 1 to 65,535; path starts with `/`, at most 1,024 printable ASCII | CLI | runner (`malformed`) |
| `routes[]` | domain, service, port | 64 per deploy; 1,024 domains per server (new); sorted by domain, unique | CLI | runner (`malformed`, `domain_taken`, `too_large`) |
| `routes[].domain` | text | the rule of part 4.2; at most 253 characters | CLI | runner (`malformed`) |
| `routes[].service` | text | `SERVICE_NAME` | CLI | runner (`malformed`) |
| `routes[].port` | whole number | 1 to 65,535 | CLI | runner (`malformed`) |

The CLI runs the same schema before it signs, so it never signs what the runner would call
`malformed`.

## 6. The runner's checks, in order

For a version-2 deploy (`deploy`, part 7). A refusal at steps 1 to 13 changes nothing but the team
lists saved at step 3, and uses no number.

1. The request line is at most 32 MiB and matches the strict request schema (`invalid_request`).
2. Take the lock (`busy`); load the key and the state (`not_set_up`, `invalid_state`).
3. Follow the team lists sent with it and save them, as `follow` does today.
4. The envelope's size (`too_large`), shape (`malformed`) and kind `zekno.deploy.v2`
   (`wrong_payload_type`).
5. The signer is a current member (`unknown_signer`); the signature (`bad_signature`).
6. Only now is the payload parsed: JSON, `v` is 2, the strict schema and
   every pattern and limit of part 5, sorted and unique lists, each name once across `secrets` and
   `removed`, each build secret in `secrets`, each chunk count matching its size (`malformed`).
   A field this runner does not carry out yet and that is not empty (`unsupported_version`).
7. Role (`role_not_allowed`); signer allowed on this server, with part 4.6 (`not_allowed_here`);
   team (`wrong_team`); team list (`stale_team`); server (`wrong_server`); server listed
   (`unknown_server`).
8. Number above the app's last and within the step (`replayed`, `sequence_jump`). `expiresAt`, when
   not `null`, not passed by the runner's clock (`expired`).
9. Routes: no domain held by another app (`domain_taken`).
10. Secrets: versions (`stale_secret`); each listed secret supplied and verified, or held and
    verified again (`secret_missing`, `untrusted_secret`, `secrets_mismatch`); each supplied record
    listed (`secrets_mismatch`).
11. Builds: a kept image whose tag names the recorded image id; or every chunk staged with its hash
    (`pack_missing`), each opening, the whole of the signed size and hash (`pack_mismatch`). Nothing
    opened is written.
12. After the change: apps, secrets, stored record bytes and domains within their limits
    (`too_large`).
13. Open the secrets, as `openSecrets` does (`secrets_mismatch` if one does not open, as today).
14. Write the new stored records, then save the state: the number is used, the secret versions and
    the app's version mark are saved. From here every step has effects, and none can run twice for
    this deploy.
15. Build each build that is not kept, streaming its pack into the builder; record its image id.
    On failure: outcome `build_failed`, stop.
16. Write the new Compose text beside the running version's, not over it, and run the pre-deploy
    command with it. On failure: outcome `predeploy_failed`, stop.
17. Put the new Compose text in place and run `docker compose up`. Save the routes in force; write
    the proxy's configuration and have the proxy load it. A non-zero exit, or a configuration not
    applied: outcome `start_failed`.
18. The health check. If it does not pass in time: outcome `unhealthy`.
19. Answer. Then delete the app's staged chunks, and remove its kept images past the last three
    deploys.

For a version-1 deploy on a version-2 runner: `apply` exactly as today (part 2.2), plus one check
after the number: the app is not at version 2 (`unsupported_version`).

For `pack`: steps 1, 2 and 4 to 8 (it carries no team lists), then: the deploy lists a chunk with
this chunk's hash; staging stays within its limits (`too_large`); the chunk is written sealed. The
lock is taken only to read the state and to write the chunk.

## 7. Messages between the CLI and the runner (protocol 3)

Every message is a strict schema in `packages/core/src/protocol/protocol.ts`, and each new command
gets a line length in `SESSION_FRAME_BYTES`.

| Command | Input | Answer | Answer at most |
|---|---|---|---|
| `deploy` (new) | team lists; the version-2 envelope; `records` (at most 256 secret records); `removals` (at most 256 envelopes) | a report; outcomes `started`, `start_failed`, `build_failed`, `predeploy_failed`, `unhealthy`, or `refused` with a reason | 64 KiB, with progress lines as `apply` |
| `pack` (new) | the version-2 envelope; one sealed chunk, base64url | `ok`, or `refused` | 64 KiB |
| `held` (new) | the version-2 envelope | the deploy's chunk hashes staged, and its build keys kept. A hint. | 64 KiB |
| `records` (new) | an app | the statements of the records and removals the runner holds for it | 8 MiB |
| `apply`, `status`, `sync`, `setup`, `state`, `logs`, `version` | unchanged | unchanged | unchanged |

New refusal reasons, only in answers to version-2 requests: `secret_missing`, `untrusted_secret`,
`pack_missing`, `pack_mismatch`, `domain_taken`, `expired`, and `not_allowed_here` with part 4.6.
`records` and `held` are reads and take no lock, as `status` does not. Anyone who can start the
runner can call them, as with `state` and `logs` (review 004, S4, still open): they give names,
versions, domains and hashes, never a value.

The report the runner will send to the hosted service (`StatusReportSchema`) has the outcomes
`accepted`, `refused`, `started` and `failed`. Its version-2 form, with the new outcomes and
reasons, comes with the runner's client for the hosted service.

## 8. What the runner keeps

| What | Where | Bound | New |
|---|---|---|---|
| Last number per app | `state.json` | 1,024 apps | no |
| Version and hash per `app/NAME` | `state.json` | 8,192 | no |
| Version mark of the state | `state.json` | | yes |
| Each app's message version (1 or 2) | `state.json` | 1,024 | yes |
| Routes in force per app (domains are computed from them) | `state.json` | 1,024 domains | yes |
| Kept builds per app: key and image id | `state.json` | 3 deploys × 8 builds | yes |
| Latest statement and sealed value per `app/NAME` | `records/<hash>.json`; removal statements in `removals/<app>.json` | 8,192 records, 64 MiB | yes |
| Staged sealed chunks | `packs/<app>/` | one deploy's per app; 2 GiB | yes |
| The proxy's configuration | `proxy/` | computed from the routes | yes |
| Images of kept builds | Docker, tagged `zekno.invalid/<app>:<key>` | 24 per app; bytes not bounded | yes |
| Certificates and their private keys | the proxy's storage | one per routed domain | yes |

New entries in `LIMITS`: pack 512 MiB, chunk 8 MiB, 64 chunks per deploy, 8 builds per deploy, 32
arguments per build, 64 KiB of arguments per deploy, 64 routes per deploy, 1,024 domains per
server, 3 kept deploys of builds per app, 2 GiB of staging, 64 MiB of stored records, build time
7,200 seconds, pre-deploy time 3,600 seconds, health time 1,800 seconds, a deploy's life 7 days.

## 9. Threats

"Stopped" means the runner refuses or the action is impossible; "not stopped: accepted" gives the
reason.

| # | Attacker | Tries | What stops it |
|---|---|---|---|
| T1 | Hosted service | Replays an old deploy of the app to the same server | The number must be above the app's last, one counter for versions 1 and 2, saved before any build, command or start. Stopped. |
| T2 | Hosted service | Replays a deploy to another server | `serverId` is signed (`wrong_server`); chunks and records are sealed for the named server's key, and another server cannot open them. Stopped. |
| T3 | Hosted service | Applies a deploy to another app | `app` is signed and the runner takes the app from it only; a record's statement and its sealed contents name the app; chunks are named by hash in that deploy. Stopped. |
| T4 | Hosted service | Withholds a deploy, a chunk or a record | Not stopped: accepted. Delivery is not promised (core spec, Assumptions). A missing chunk or record is refused before the number is used, so the same deploy can come later. |
| T5 | Hosted service | Delivers a withheld deploy late, such as a migration a day after it was meant | Refused once a later deploy of the app was accepted. Otherwise not stopped, unless `expiresAt` is set (Q7). Accepted. |
| T6 | Hosted service | Swaps a pack, or one chunk; reorders, repeats or drops chunks | Each sealed chunk's hash, in order, and the whole pack's size and hash are signed and checked before the number is used (`pack_mismatch`). Stopped. |
| T7 | Hosted service | Supplies a sealed secret it made (anyone can seal for the server's key) | A record counts only if the deploy lists its hash and its statement is signed by a current member allowed on this server; deployers take hashes only from statements they verified. Stopped. |
| T8 | Hosted service | Hides a newer secret statement from CI or a teammate | They sign an older version; a runner that saw the newer one refuses it (`stale_secret`); one that never saw it uses an older value a member did set. Not stopped: accepted (core review, withholding). |
| T9 | Hosted service, or a lying runner | Says the runner holds a record, chunk or build it lacks, or lacks one it holds | A hint only: `secret_missing` or `pack_missing` with no number used, or bytes sent again. Stopped. |
| T10 | Hosted service | Moves a domain to another app, or adds one | Routes are signed per app; a domain another app holds is refused (`domain_taken`); the proxy's configuration comes only from routes in the runner's state. Stopped. |
| T11 | Hosted service | Delivers app B's claim before app A's release | B's deploy is refused, no number used, nothing misrouted. Stopped (the delay is T4). |
| T12 | Hosted service | Lies about the runner's protocol | Version 1 for an app at version 2 is refused (`unsupported_version`); version 2 to a version-1 runner is refused before it is parsed. The CLI signs version 1 only for a deploy that needs nothing new. Stopped. |
| T13 | Hosted service | Withholds a team list that removes or limits a stolen key | Not stopped through the service: the key works on a runner that has not received the list. The admin sends the list directly with `sync`; `status` shows each runner's team list version. Accepted (core research R4). |
| T14 | Hosted service | Reads what it relays | Learns the Compose text with its plain variables, image names and digests, domains, build recipes with argument values, the pre-deploy command, health paths, secret names, versions and hashes, pack sizes and plaintext hashes (a guessed exact pack can be confirmed). Not secret values, not the source. Accepted: metadata (core spec, Assumptions), wider than in version 1. |
| T15 | Hosted service | Reports a far-ahead number to a deployer with no history, keeps that deploy and delivers it after newer ones | Not stopped by the message (part 4.7). Needs CI to keep its own last number, or `expiresAt` (Q7). Accepted until then. |
| T16 | Whoever can start the runner (A) | Uploads packs to fill the disk | A chunk is taken only with a signed, unused deploy for this server that names its hash; staging is one deploy's chunks per app and 2 GiB in all. Stopped. |
| T17 | Whoever can start the runner (A) | Reads statements, routes, kept builds | Not stopped: as `state` and `logs` today (review 004, S4, open). Names, versions, domains, never a value. |
| T18 | Profile folder (B) | Points the SSH destination at another machine | That machine gets signed deploys (readable fields), and sealed chunks and records it cannot open. It can make deploys fail. Source and secrets stopped; metadata accepted (review 003). |
| T19 | Project folder's author | A settings file whose build reads a production secret with the network on, and a Dockerfile that sends it out | Not stopped by the runner: the developer who deploys signs it. As a Compose file naming `${SECRET}` today. The deploy summary must show build secrets as it shows a service's. Accepted. |
| T20 | Project folder's author | A link in the project to `~/.ssh`, or `.env` files, ending up in the pack | The CLI never follows a link out of the project and leaves `.env*` out unless asked (a rule for the build feature). Not the message's to stop. |
| T21 | Whoever answers for a registry | Serves other content for an image | With a digest in the signed text, Docker refuses it: stopped after signing. When the CLI asks it for a tag's digest, it decides what is signed: accepted; a CI build's own digest avoids the question. |
| T22 | Whoever answers for a registry or package host during a server build | Serves another base image or package | Not stopped: the pack pins the source and the Dockerfile, not what they download. Accepted. |
| T23 | A stolen CI key | Deploys anything to every server it may reach, reads every secret there, sets or retires secrets, claims domains, runs a pre-deploy that drops a database | Not stopped: a deploy key is root on the servers it may deploy to (review 003). Narrowed by server limits (part 4.6), ended by removing the key once each runner has the list (T13). Two-person approval is on the roadmap. Accepted. |
| T24 | A stolen CI key limited to staging | Sets a production secret for an admin's next deploy to carry | Runner and CLI refuse statements whose signer is not allowed on that server. Stopped, with part 4.6. |
| T25 | A removed member | Deploys, or a secret they set is used | `unknown_signer` once the runner has the list; their statements stop counting on the runner (`untrusted_secret`) and on the CLI. Before the runner has the list: T13. |
| T26 | A member deploying app A | Takes app B's domain | `domain_taken`. Stopped. Controlling app B through Docker from app A's containers is not stopped (part 2.6), which is why keys are not limited to apps. |
| T27 | Two apps with a service of the same name | The proxy reaches the wrong app's `web` | The proxy names an upstream by a name unique on the server, on that app's network. Stopped, by design (to be tested when built). |
| T28 | Whoever answers for a domain's DNS, or a certificate authority | Points the domain elsewhere, issues a certificate | DNS decides where browsers go; the proxy asks only for domains in signed routes. Accepted. |
| T29 | Whoever answers for the runner's time server | Moves the runner's clock | Only with `expiresAt`: a clock set back accepts a late deploy (as version 1 always does), set forward refuses deploys. The number rule never depends on time. Accepted. |
| T30 | A lying or compromised server | Misreports outcomes, health and holdings; serves old statements; keeps a tampered image for rollback | Not stopped: outside what zekno protects (README). New in version 2: the source in plaintext, the TLS private keys of routed domains. |

## 10. Questions for the maintainer

| # | Question | Recommendation |
|---|---|---|
| Q1 | A new kind (`zekno.deploy.v2`) and `v: 2`, or the old kind with `v: 2`? | Both. The kind is inside the signature, so no version-1 code path can ever take a version-2 deploy; it costs nothing. |
| Q2 | Seal the pack over SSH too? | Yes: a changed SSH destination then gets no source, the runner's folder holds nothing opened, and one format serves both ways. Cost: 48 bytes per chunk and a second's work for 512 MiB. |
| Q3 | Pack and chunk limits | 512 MiB and 8 MiB. Raising the pack limit later is a new protocol number, not a new format. |
| Q4 | Who makes the health check's GET: the runner from the host (fails with rootless Docker), the proxy (needs an interface the runner can ask, and only reaches routed apps), or a check container on the app's network from a pinned image | The check container. If no new image is wanted, carry out `http: null` (Docker's own health) first and refuse `http` until decided. Health and domains ship together (design.md, C3). |
| Q5 | Does a rollback run the old deploy's pre-deploy command? | No, unless the developer asks for it, and the CLI says so. |
| Q6 | Limiting keys | To servers, in the team list, built with the CI feature. Not to apps (part 4.6). |
| Q7 | `expiresAt`: in the format? Set when? | In the format, as `null` or a time. The CLI sets it for every deploy through the hosted service and for CI (24 hours by default, at most 7 days), and may leave it `null` over SSH from a machine with history. It only narrows: a wrong clock can refuse a deploy, never accept one the number refuses. It changes the core spec's "No security decision depends on time", so it is yours to decide. |
| Q8 | How long a version-2 runner accepts version 1 | For apps never deployed with version 2, until a runner release announced at least one release after the first CLI that signs version 2. Never for an app at version 2. |
| Q9 | The runner checks statements again, against its current team list, each time it uses a stored record | Yes. A secret set by a removed member then stops a deploy until a member sets it again, as the CLI already requires. |
| Q10 | A build's network by default | `"default"`, since most builds download packages; `"none"` offered, and the deploy summary shows which. |
| Q11 | Should the CLI keep packs for rollback past the runner's three deploys? | No. Going further back is deploying an old checkout. |
| Q12 | The hosted service reads more (T14) | Say so in the README's note on metadata now. Sealing the payload for the server is a later design. |
| Q13 | `zekno.invalid/<app>:<key>` with `pull_policy: never` | Keep, after testing with the Docker Compose version the runner supports, together with `compose run` and the start of dependencies (part 4.4). |
| Q14 | Kept builds per app | Three deploys. |
| Q15 | Should `composeUp` run in the runner's folder, as `ps` and `logs` do (part 2.8)? | Check what `docker compose up -f` reads from the folder it starts in; if anything, yes. |

## 11. What an independent reviewer should try to break

- **The order of part 6.** Anything with an effect before step 14 (a build, a command, a route, a
  file other than staging), and anything refusable after step 14 that a hostile relay could use to
  burn numbers.
- **The gate of `pack`.** Whether a used, foreign, expired or malformed deploy can open it; whether
  a hosted service holding many genuine unused deploys can fill the disk past the bounds; whether
  staging can hold plaintext.
- **Chunks.** Whether any reordering, repetition, truncation, swap between two packs of one deploy,
  or reuse of a chunk from another server's pack passes part 6 step 11; whether the second opening
  (step 15) can read different bytes from the first.
- **Domains.** Interleavings of claim and release between two apps; a rollback, a version-1 deploy
  or a failed build releasing or keeping a domain it should not; text in a domain or service that
  could change the proxy's configuration for another app; the proxy confusing two apps' services.
- **Records.** A supplied record whose statement's version, name, app or server differs from the
  listing; a stored record reused after retirement, or after its signer left; two names sharing a
  hash; the order of record files and state on a crash.
- **The version boundary.** Every pairing of kind and `v`; a version-1 deploy for an app at
  version 2; an old CLI meeting a new answer; a state without its mark; going back to an older
  runner.
- **Kept images.** Whether anything but the runner's own build can come to stand under
  `zekno.invalid/<app>:<key>` and be reused (a Compose `build:` section with that `image:`, a
  pull, a tag).
- **The pre-deploy command.** Whether a word can reach Docker Compose as an option, whether it can
  run twice for one deploy, and what it can reach while the old version serves.
- **The health GET.** Whether its address can be anything but the named service's container.
- **Limits.** Whether a team list limited to one server still lets that key's statements count on
  another, through any path (deploy, removal, link, the `records` read).
- **Sizes.** The worst-case payload, request line, `records` answer and state against part 3 and
  part 8.
- **What a lying server learns or does** that it could not in version 1, beyond T30.

## 12. Review

Not yet read by an independent reviewer. Their findings, and what is done about each, are recorded
here (FR-034).
