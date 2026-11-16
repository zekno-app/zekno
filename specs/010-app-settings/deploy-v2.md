# Design: the signed deploy, version 2

**Feature**: 010-app-settings (spec FR-032 to FR-034, User Story 5) · **Date**: 2026-11-16 ·
**Status**: design, revised after an independent review (part 12). Nothing here is built. Feature
010 changes no message, no part of `packages/core` and no part of the runner (FR-029). The features
that need this design build it.

**How to read it.** Every statement about today names the file and the function it rests on. "The
code does not say" marks what the code leaves open. A statement about Docker or Docker Compose says
whether the reviewer checked it, on Docker 29.6.1 with Docker Compose v5.3.0 and buildx 0.35 on
macOS (checks D1 to D14 in [`deploy-v2-review.md`](./deploy-v2-review.md)), or is marked "not
checked". A server's Compose may be older; what was checked holds for v5.3.0 only (question Q18).

**Words.** *The hosted service* is the control plane: it will store and relay messages, and it is
treated as hostile. *The CLI* is the developer's machine (`apps/cli`), and also CI when CI deploys
with it. *The runner* is the program on the server (`apps/runner`). *A statement* is a signed secret
record's envelope (`zekno.secret.v1`) or a signed removal (`zekno.secret-removal.v1`).

## 1. Decisions in short

1. **A new kind of signed message**, `zekno.deploy.v2`, whose payload says `"v": 2`. Every field of
   version 1 stays, with the same meaning. New fields: `previous`, `expiresAt`, `builds`,
   `predeploy`, `health`, `routes`. Every field is present in every deploy; "none" is `null` or `[]`.
2. **Order.** A deploy names the number it was made after (`previous`), and its own number is one
   above. The runner accepts it only when `previous` is its own last number for the app. A lie about
   that number only makes a deploy fail, and nothing made before another deploy was accepted can run
   after it. `expiresAt` is required on every deploy the runner takes from the hosted service.
3. **An image pinned by digest** (pulled from a registry, or built in CI) needs no new field. The
   digest is in the Compose text, and the Compose text is signed.
4. **A build on the server** takes an uncompressed tar the CLI made, cut into chunks of at most
   8 MiB, each sealed for the server with the sealed box `packages/core` already uses, over SSH as
   well. The deploy signs each sealed chunk's hash, the whole pack's hash and size, and the build's
   key. The runner checks all of it before the deploy number is used, never unpacks the pack itself,
   and keeps the images of the last three deploys of each app.
5. **Routes**: a deploy states all of its app's routes. A domain belongs to the app whose deploy
   first reached its start with it, until a deploy of that app leaves it out. The proxy gets the
   random aliases the runner gives the app's own containers on a network the runner makes for the
   app, never addresses, which Docker can hand to another container. A rollback
   keeps the current routes.
6. **A health check** decides whether a deploy ends `started` or `unhealthy`. With Docker Compose
   alone the old version has already been stopped by then. Keeping it running needs the proxy and
   two copies of the app at once; that is left out, and the field does not change when it comes.
7. **A pre-deploy command** runs once, in a named one-off container of the new version's service,
   with `--no-deps`, so it reaches only what already runs and replaces nothing. At its time limit
   the runner removes the container by name, and no deploy of the app starts while one still runs.
   If it fails, the new version is not started.
8. **Secrets by version**: the signed lists keep their version-1 shape. The runner keeps the latest
   statement and sealed value of each secret, so a deploy sends a record only when the runner lacks
   it. A deployer takes versions and hashes only from statements it verified itself. A deploy must
   list every secret the app has; leaving one out takes a signed removal.
9. **Limiting a key**: to servers, for deployers, in the team list, with the CI feature. Not to
   apps: on one server that is not a boundary.
10. **Version 1 and version 2**: a runner that knows only version 1 refuses version 2 before it
    parses it. A version-2 runner accepts version 1 only while its team list cannot carry limits,
    and only for an app it already held when it was upgraded and that has had no version-2 deploy.

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
- **Time.** `createdAt` is signed and shown in the CLI's views (`appsOf` and `deployRow` in
  `apps/cli/src/shared/views.ts`). No decision rests on it. The core spec says "No security decision
  depends on time" (`specs/002-core-library/spec.md`, Assumptions), and replay protection chose a
  counter over expiry for that reason (`specs/002-core-library/research.md`, R5).

### 2.2 What the runner checks and does

`verifyDeploy` (deploy.ts), in order: (1) the envelope's size, shape and kind, then its signer and
signature, against the team list the runner holds; (2) JSON, `v`, strict schema, sorted and unique
lists; (3) role in `DEPLOY_ROLES`, team, team-list hash (`stale_team`), server, server listed; (4)
`sequence` above the last accepted for the app (`replayed`) and at most 2^20 above it
(`sequence_jump`); (5) the sealed secrets supplied are exactly the ones listed, by hash
(`secrets_mismatch`); (6) no secret goes to a lower version, or to another hash under the same
version (`stale_secret`). Nothing is decrypted. A secret the deploy does not list is not checked.

`apply` (`apps/runner/src/commands/commands.ts`), in order: parse the request with the strict
`RunnerApplyRequestSchema`; take the lock (`locked`, through `acquireLock` in home.ts); load key and
state (`load`); follow the team lists sent with it and save (`follow`); `verifyDeploy`;
`withinLimits`; `openSecrets` (before saving, so a deploy whose secrets cannot be opened does not use
up its number); `writeState`; from here the number is used; `writeCompose`; `composeUp`. The lock is
held to the end.

`composeUp` (`apps/runner/src/docker/compose.ts`) runs
`docker compose -p zekno-<app> -f <file> up -d --remove-orphans`, with no time limit, with the
deploy's secrets in Docker Compose's environment (reserved names left out, `isReservedSecretName`)
and the runner's own Docker variables over them (`dockerEnv`). The runner never reads the Compose
text: it writes it to a file and hands it to Docker. The runner's code makes no network connection
of its own; `docker`, which it starts, may (`main.ts`: "It opens no network port").

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
records), new state the runner must keep honest (the order of deploys, domains, kept images), and
effects that must never repeat (a pre-deploy command).

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
| Another app's deployer on the same server | Deploy any Compose text there. Root on the server already (2.6). |

Part 13 records two things found in today's code while this was written.

## 3. The shape of version 2

**Kind and version.** The envelope's kind is `zekno.deploy.v2` and the payload says `"v": 2`.
The kind is inside every signature (`signingInput`), so a version-2 signature never verifies as a
version-1 deploy, whatever a verifier does with `v`, and `readEnvelope` refuses it before parsing.
`v` stays so that a payload read on its own says what it is, as every other kind does. A payload
of kind `zekno.deploy.v2` whose `v` is not 2 is `malformed`. The version-2 verifier is a new
function: it must not reuse `hasOtherVersion`, which refuses any `v` but 1.

**Every field present.** As in version 1, every field is required. A deploy with no build says
`"builds": []`; with no health check, `"health": null`. A signer never leaves a decision to a
default someone else picks later.

**Fixed once, carried out in steps.** The format is decided here, once. The features that need it
can ship one after the other: a runner refuses a version-2 deploy that uses a field it does not
carry out yet (`unsupported_version`), and never ignores it. The protocol number says which fields
a runner carries out, so the CLI does not sign what the runner would refuse (part 7). Which fields
come first is question Q16.

**New hash domains.** Three labels join `HashDomain` (hash.ts): `zekno/v1/pack` (a whole source
pack), `zekno/v1/pack-chunk` (one sealed chunk) and `zekno/v1/build` (a build key). The construction
is the existing one. Hashing a pack of up to 512 MiB needs BLAKE2b fed in pieces; the reviewer found
`crypto_generichash_init`, `update` and `final` in the loaded `libsodium-wrappers`, giving the
one-shot result when fed the domain, `0x00`, then the data.

### 3.1 The order of deploys

**Why.** Version 1 orders deploys by a number alone: the runner accepts any number above its last
(`verifyDeploy`, step 4). The review showed (V1) that this lets the hosted service bring an old
deploy back after newer ones. It tells one developer a number far ahead (say 1,490 where the runner
holds 500; `MAX_AHEAD` lets that pass for a machine that signed up to 490), keeps the deploy signed
as 1,491, lets other members' deploys 501, 502 and so on through, and delivers 1,491 days later. It
is above the runner's last number, so it runs: old content, old routes, and an old pre-deploy
command against a database that has moved on. `MAX_AHEAD` bounds how far ahead one machine signs,
not the order between two machines.

**The rule.** Each version-2 deploy is bound to the state it was made against:

- `previous`: the app's last accepted number as the signer learned it; 0 when the app has none.
- `sequence`: exactly `previous + 1` (`malformed` otherwise).
- The runner accepts the deploy only when `previous` equals its own last number for the app
  (`lastSequence`, 0 when absent). Lower: `replayed`. Higher: `sequence_jump`. Neither uses a
  number. The `pack` gate checks the same (part 4.1 b).

**What the signer reads.** `lastSequence[app]` from the runner's `status`, on the deploy's own
connection, as `sendDeploy` does today. Over SSH that answer comes from the server SSH checked;
through the hosted service it is relayed and unsigned. Why a lie only makes the deploy fail: the
runner compares `previous` with its own state, never with what the signer was told. A number lower
than the truth is refused `replayed`, a higher one `sequence_jump`. Nothing signed before another
deploy of the app was accepted can be accepted after it, because its `previous` is then below the
runner's number. For version 2, the step limit (2^20) and `MAX_AHEAD` are not needed: a number can
only ever be one above the last. A deployer with no history (CI, a second machine) needs no number
of its own.

**Two honest deployers at once.** Both read 500; both sign `previous` 500 and number 501. The first
to arrive runs. The other is refused `replayed` before anything of it is used. Its CLI reads
`status` again, sees 501, and says that another deploy of the app reached the server first and
nothing of this one ran; deploying again signs `previous` 501 on top of it, and its content then
replaces the first's, as any later deploy does. Version 1 already refuses the loser of such a tie
(review 003, "Limits"). The CLI cannot tell from `status` which deploy numbered 501 ran, when it
signed one too; it says so, and a new deploy settles it.

**Alternatives.** Two deploys signed against the same `previous` are alternatives: whoever delivers
them picks which runs, never both. Over SSH the CLI delivers its own deploy and nobody holds the
other back. Through the hosted service, the one held back can run later only if nothing else of the
app was accepted meanwhile, and only before its `expiresAt`. Accepted (T31). Three rules keep
alternatives few (V19):

- When a deploy's answer never came and the content to deploy is unchanged, the CLI sends the same
  envelope again, from its history, instead of signing an alternative. It signs a new deploy only
  for new content.
- Through the hosted service, `status` and reports are unsigned, so the CLI cannot tell which
  alternative ran. It says so, and marks its history entry as reported, not as known. Over SSH the
  answer comes on the deploy's own connection, and the CLI tells its developer when theirs lost.
- A deploy a person waits for gets a short `expiresAt` (below).

**`expiresAt`.** A time, or `null`. The runner refuses a deploy whose `expiresAt` has passed by its
own clock, and a deploy it took from the hosted service whose `expiresAt` is `null` (both
`expired`). The CLI sets it on every deploy that goes through the hosted service: one hour ahead
when a person is waiting for the deploy, and what CI's configuration says for CI. It may leave it
`null` over SSH, where no relay holds a deploy, and that stays true only while no copy of such an
envelope reaches anyone who could hand it to the runner later. So an envelope whose `expiresAt` is
`null` never leaves the SSH session it was signed for: the CLI keeps it in its history, and never
hands it to the hosted service or to anything else. There is no upper bound in the format:
`createdAt` is checked against no clock, so a cap counted from it would bind nothing; a cap against
the runner's own clock would (question Q7). The runner
checks `expiresAt` once, before the number is used. The build that follows can add up to its own
time limit (2 hours) before the pre-deploy command starts; the signer chooses the window knowing
that. A wrong clock can refuse a deploy, or accept one that is late but still next; it never makes
the runner accept a deploy out of order, because the order rests on `previous`. Because a check now
depends on time, the core spec's assumption changes: question Q7.

**Rollback.** A new deploy like any other: `previous` is the current number.

**The first deploy of an app.** `previous` is 0. If the runner holds the app already, the deploy is
refused `replayed`, so a name typed as new can no longer replace an app on the server (review 006,
S3, now also enforced by the runner). The rule rests on the runner never forgetting an app's last
number. Version 2 has no message that removes an app (part 4.8); when one comes, it keeps the app's
last number and its version mark for good, as a tombstone. Dropping them would turn the number back
to 0, and every first deploy of the app's earlier life that has not expired, or whose `expiresAt`
is `null`, would be acceptable again (V22).

**A version-1 deploy, then a version-2 deploy.** One counter per app. Version-1 deploys keep their
rule (above the last, within the step) and travel over SSH only: the runner's client for the hosted
service takes version 2 only. The first version-2 deploy reads the last number, whatever version
made it, and names it. After it, version 1 is refused for that app (part 4.7).

**Cost.** One number in the payload, one comparison, and no state: `lastSequence` is already kept.
New failure: the loser of two concurrent deploys is refused, as in version 1.

### 3.2 An example

```json
{
  "v": 2,
  "teamId": "team_…", "teamHash": "…", "serverId": "srv_…", "app": "demo",
  "previous": 41, "sequence": 42,
  "createdAt": "2026-11-20T10:00:00.000Z", "expiresAt": null,
  "compose": "services:\n  web:\n    image: zekno.invalid/demo:3f9c…\n    pull_policy: never\n…",
  "secrets": [{ "name": "DATABASE_URL", "hash": "…", "version": 3 }],
  "removed": [],
  "builds": [{
    "key": "3f9c…",
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
90 KiB (64 chunk hashes, eight recipes and keys, 64 KiB of arguments), pre-deploy 16 KiB, health
20 KiB, routes 20 KiB. About 470 KiB before JSON escaping. A Compose text full of characters JSON
escapes can already pass the limit in version 1, where `signEnvelope` refuses it (`too_large`).

### 3.3 Where each later setting goes

The settings file reserves these places (design.md, "The file"); this is what the CLI turns each
into.

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
(Docker's documented behaviour; not checked, it needs a registry). The runner does not parse the
Compose text and version 2 keeps it so. A digest of a multi-platform index pins the list of
per-platform manifests, so it still pins content.

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
CI needs a member key, the team list and its founding code, and a way to the runner. Over SSH the
server's identity rests on SSH's host check (review 003), so CI pins the server's SSH host key and
never accepts a new one on its own. Part 4.6 and threats T23, T24 and T32 are about CI's key.

#### (b) An image built on the server from source the CLI packed

**Signed.** Each entry of `builds` names a key, a pack and a recipe:

- `key`: the build key (below), in hex.
- `pack.hash`: `hash("zekno/v1/pack", the pack's exact bytes)`.
- `pack.size`: its size in bytes.
- `pack.chunks`: in order, `hash("zekno/v1/pack-chunk", sealed chunk)` for each chunk.
- `dockerfile`: its path inside the pack. The pack is the build's context, so there is no separate
  context path. A settings file that gives a build command and no Dockerfile makes the CLI write a
  Dockerfile into the pack; it is then signed with the pack like any other file. No field is needed
  for it.
- `target`: a stage of the Dockerfile, or `null`.
- `args`: plain build arguments, as a sorted list of names and values. Signed, and readable by the
  hosted service. Names follow the secret-name pattern and are not reserved
  (`isReservedSecretName`): a `*_PROXY` argument would send the build's downloads elsewhere, and
  `BUILDKIT_*` names stay the runner's (below).
- `secrets`: names of secrets the build may read, sorted and each once, so that one build has one
  key (V24). Each must be in the deploy's `secrets` list.
- `network`: `"default"` or `"none"`.
- `timeout`: seconds.

Two builds that use the same folder carry the same pack (same hash and chunks); it travels once.

**The build key.** `hash("zekno/v1/build", bytes)` in hex, where `bytes` is the UTF-8 of
`JSON.stringify` (as `packages/core` runs it on both sides) of this array, in this order:
`[pack.hash, dockerfile, target, [[name, value], …] for args, [[name, hash], …] for the build's
secrets, network]`. Each secret's hash is the one `secrets[]` lists for it, so a build that read an
old `NPM_TOKEN` is not reused once the token is replaced. Only arrays, strings and `null` go in, so
key order cannot differ between two sides. The CLI writes the key into the build entry, which is
signed, and into the Compose text. The runner computes it again and refuses a deploy whose signed
key differs (`malformed`, part 6 step 6), so a mismatch costs no number.

**The image's name.** The Compose text names the image of a build as `zekno.invalid/<app>:<key>`,
with `pull_policy: never`, which the CLI always writes. The Compose text is still the whole
description of what runs, and the text printed by `zekno settings compose` still equals the text
signed (spec FR-027). With the image absent, Compose refused at once with "No such image" and did
not pull (checked on v5.3.0, D8). Any image can be tagged under that name (D9), so the runner never
trusts the tag alone (below).

**The pack.** An uncompressed tar archive of the folder the build uses, made on the CLI. The CLI
makes it the same every time for the same files (entries sorted, times and owners fixed), so the
same files give the same hash, key and Compose text on every machine; a compressor could make two
machines' bytes differ, and a compressed pack could open to far more than its signed size in
Docker's storage. The CLI never follows a link out of the project and leaves out files that hold
secrets (`.env*`) unless asked: rules for the build feature, recorded here because a cloned
repository decides what is in its folder.

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

**Where plaintext source still lands.** The server's own disk: Docker's storage keeps the opened
build context, and the image keeps the source. And all packs and records are sealed to one
long-lived server key: whoever stores every sealed chunk (the hosted service can) reads all past
source and secrets if that key is ever lost. There is no forward secrecy, for packs as for secrets
today. Accepted (part 4.8, T35).

**How the pack travels over SSH.** A new session command, `pack`, carries one sealed chunk and the
signed deploy that names it (part 7). The CLI sends `deploy` first; only when the runner answers
`pack_missing` does it upload, then sends the same signed deploy again (no number was used). So a
build the runner keeps sends nothing. The runner takes a chunk only when the deploy passes the
checks of part 6 steps 4 to 8 (signed by a current member allowed on this server, for this team,
team list and server, `previous` equal to the app's last number, not expired) and lists a chunk with
this chunk's hash. Nothing is used up by this. The chunk is kept sealed under
`packs/<app>/<chunk hash>`. Each request is one session line: 8 MiB sealed is about 11 MiB of
base64url, plus at most about 1.4 MiB of envelope, within the 32 MiB line limit (`requestLines`
with `LIMITS.messageBytes` in session.ts). The session holds at most 32 MiB of waiting requests
(`QUEUE_BYTES`), so the CLI waits for each chunk's answer before it sends the next, as every request
already does. `pack_missing` does not say which chunk is missing, so an upload cut off part way is
sent again whole (part 4.8).

**How it will travel through the hosted service.** The same sealed chunks, stored by the service
and fetched by the runner by chunk hash, each read bounded to 8 MiB and 48 bytes and checked against
the signed hash before it is kept. The runner fetches only chunks named by a deploy that passed the
same gate as `pack`. A pack can pass 32 MiB because it never travels as one message. What must
exist first: the runner's client for the hosted service (README: "The control-plane client is not
written yet"), a pending-deploys message for version 2 (`PendingDeploysResponseSchema` carries
version-1 requests only), and chunk upload and download in the protocol.

**Staging.** Chunks are staged per app for one deploy at a time; a `pack` for another deploy of the
same app replaces them. The gate needs `previous` equal to the app's last number, so only a deploy
that can still run stages anything. At every accepted deploy and every `pack`, the runner deletes
staged chunks of deploys whose `previous` is no longer the app's last number, whose `expiresAt` has
passed, or that were staged more than 24 hours ago. At most 2 GiB in all; past that, `pack` is
refused (`too_large`). The gate and the write are one span under the state lock (part 6). When a
deploy is accepted (part 6, step 15), its chunks move out of `packs/<app>/` into `building/<app>/`,
which no cleanup looks at, and are deleted when its build ends. Without that, the next deploy of
the app, whose `previous` is now this deploy's number, could upload during the build and its
cleanup would delete the chunks being built from (V20). What is left: whoever holds two unused alternatives of one app can upload them in turn so that each evicts
the other, and whoever holds unused deploys of four apps can fill the 2 GiB for up to a day. Both
deny uploads only, which the hosted service can do by withholding anyway; over SSH they are the
team's own deploys. Accepted.

**Runner checks, before the number is used.** For each build: if the runner keeps an image under
its key (below), nothing more. Otherwise every chunk of its pack must be staged, each with the
signed hash (`pack_missing` if one is absent); each must open with the server's key; the opened
bytes, fed through the hash as they come, must have the signed size and hash (`pack_mismatch`).
Nothing opened is written in this pass. All of this happens before the state is saved, so a missing
or wrong pack costs no number. Opening is deterministic for given bytes, so the signed list of
sealed-chunk hashes already fixes the pack; the plaintext hash is checked because it feeds the key
and keeps a kept image from being reused for other source.

**What a build may reach.** The runner runs the builder in its own folder and hands it the opened
pack as the build context on its standard input, opening the chunks a second time and checking each
chunk's hash again as it reads it. `docker build -f <path> --network none --secret id=T,env=T
--iidfile <file> -` built from a tar on standard input, with the Dockerfile's path inside the tar,
and a link in the tar to `/etc/hosts` was "not found" rather than the host's file (checked with
buildx 0.35, D10, on a `FROM scratch` build; no `RUN` step, base image or secret read was run). The
runner never unpacks the pack: paths inside it are the builder's to read, never the runner's to
write next to `server.key`.

- **Network.** `"default"` is the builder's usual network: the internet, and whatever the server's
  Docker bridge reaches, which includes the host and a cloud provider's metadata address, as any
  container does. `"none"` means no network for `RUN` steps only. BuildKit itself still fetches base
  images, the frontend a `# syntax=` line names, and `ADD` of a URL or a git repository (BuildKit's
  documentation; not checked). Never the host's network, never an app's network.
- **The frontend.** A `# syntax=` line makes a registry tag choose code that builds every step and
  is handed the build's secret mounts. So whoever answers for that registry reaches the build's
  secrets. The CLI reads the Dockerfile when it packs: it refuses a `# syntax=` line without a
  digest, and an `ADD` of a URL, in a build that names a secret, and warns on them otherwise.
- **Secrets.** Only those the build names, given to the builder as secret mounts read from its
  environment (`--secret id=NAME,env=NAME`, D10), never as build arguments, which stay in the
  image's history. The builder's environment is `dockerEnv` and those secrets, nothing else. A
  Dockerfile that copies a secret into a layer keeps it in the image; that image stays on the server.
- **The cache.** BuildKit's cache is shared by every build on the server. The runner passes
  `--build-arg BUILDKIT_CACHE_MOUNT_NS=zekno-<app>` (BuildKit's documented argument; not checked) so
  that one app's `RUN --mount=type=cache` is not another's; a deploy cannot set it, since
  `BUILDKIT_*` names are reserved. Layer cache keys leave secret contents out, so a layer built with
  a secret can be reused by an identical step after the secret changed, or by another app's
  identical step. Accepted (part 4.8).
- **Time.** At `timeout` the runner stops the builder's client. BuildKit is documented to stop a
  build whose client goes (not checked). If it went on, it could only tag an image the runner never
  recorded, which is then never reused (below). Builds take the deploy lock, so another deploy to
  this server waits (`busy`); `sync` and `pack` do not (part 6).
- **What the pack does not pin.** Base images named by tag in the Dockerfile, and whatever the
  build downloads. A `FROM` with a digest and a lockfile with integrity hashes narrow that. The CLI
  can warn; version 2 does not refuse.

**Runner keeps.** For each app, the keys and image ids of the builds of its last three deploys that
got as far as building (state `builds`). The id comes from the builder's `--iidfile` (D10), and the
image is tagged `zekno.invalid/<app>:<key>`. Before it reuses a kept image, the runner checks that
the tag still names the id it recorded; if not, it needs the pack. After each deploy the runner
removes its own tags past those three, found from its state, never from a list of all images, so it
never touches an image it did not make, and prunes BuildKit's cache down to 10 GiB. Kept images are
bounded in number, not in bytes.

**Hosted service.** Cannot swap a pack, a chunk, their order or their number: all signed. Cannot
make the runner take chunks without a signed, unused, unexpired deploy that names them. Can
withhold chunks: the deploy is refused `pack_missing` and its number is kept. Learns: each pack's
size and chunk count, its plaintext hash and build key (with which it can confirm a guess of the
exact pack, such as a public repository at a known commit), and the recipe: Dockerfile path,
arguments and their values, network choice, names of build secrets. Cannot read the source.

**Lying or compromised server.** New: it gets the source in plaintext (today only images reach it,
which often contain the source anyway). It already had every secret. It can keep a tampered image
under a kept key, which a later rollback would reuse.

**Rollback.** The rollback deploy copies the old deploy's `builds`. If the runner still keeps those
keys, no pack travels and nothing is built. If not, it refuses `pack_missing` (number kept) and the
CLI says the old source is no longer on the server; going back then means deploying the old source
again from a checkout. The CLI does not keep packs (question Q11). The same source, recipe and
build secrets always reuse a kept image, so rebuilding to pick up new base images needs a changed
recipe (an argument, for example); that is the build feature's to offer.

**Limits.** A pack at most 512 MiB; chunks at most 8 MiB; at most 64 distinct chunks per deploy, so
all builds of one deploy share 512 MiB; at most 8 builds per deploy; at most 32 arguments per build,
each value at most 4 KiB, all arguments of a deploy at most 64 KiB; at most 32 build secrets per
build; `timeout` 1 to 7,200 seconds; staging 2 GiB in all, chunks kept at most 24 hours; kept
builds: three deploys per app; BuildKit's cache 10 GiB after each deploy.

**Cost.** Payload: about 5 KiB per pack of chunk hashes, plus the recipes and keys. State: about
150 bytes per kept build, at most 24 per app. Disk: staging up to 2 GiB, the build cache up to
10 GiB, and kept images. New failures: `pack_missing`, `pack_mismatch` (refusals, number kept);
`build_failed` (an outcome, number used); a server without a builder; a full disk; another deploy to
the server waiting for the length of a build.

### 4.2 Routes

**Signed.** `routes`: every route of the app, each a `domain`, a `service` and a `port`, sorted by
domain, each domain once. It is the whole set, not a change: a route left out is released.

**The domain rule.** Lowercase ASCII, at most 253 characters, at least two labels of 1 to 63
letters, digits and hyphens, no label starting or ending with a hyphen. A label that starts `xn--`
only when it is a valid A-label: it decodes, and encodes back to the same text, so two texts never
name what a browser shows as one domain. A last label that is not all digits (never an IP address),
no trailing dot, no wildcard, not `localhost`, and nothing under a special-use name: `.invalid`,
`.test`, `.example`, `.local`, `.localhost`, `.internal`, `.alt`, `.onion` or `.arpa`. That keeps out
`zekno.invalid`, the name kept builds use. Two spellings of one domain cannot both pass, so comparing
the text compares the domains.

**Runner checks.** Each domain is held by no other app (`domain_taken`). The server holds at most
1,024 domains after the change (`too_large`). The service and the port are checked by pattern only:
the runner does not read the Compose text. The CLI checks before signing that the service exists in
the text.

**Two apps, one domain.** The first app whose deploy reached its start with the domain holds it.
A deploy of any other app that names it is refused, with no number used, until a deploy of the
holder leaves it out. Moving a domain from one app to another is two deploys: release, then claim.

**Who may release a domain.** Whoever may deploy the app that holds it to that server: any member
with a deploy role, and, with part 4.6, allowed on that server. There is no separate release
message. Removing an app altogether, and with it its domains, needs a message of its own and is
left out (part 4.8).

**How a route finds its service.** The runner never reads the Compose text, so it asks Docker,
and it gives the proxy a name only it has handed out, never an address. For each app with a route
or an HTTP health check, the runner makes a network of its own, `zekno-route-<app>`, with
`docker network create`, labelled with the runner's server id and the app. It is not a network of
the app's Compose project, so Compose neither makes nor removes it, and the runner removes it when
the app has neither a route nor such a check any more. At step 18, after `docker compose up`, in
its own folder:

1. `docker compose -p zekno-<app> ps -q <service>` lists the service's containers, every copy.
2. It inspects each, and keeps it only if its labels say project `zekno-<app>` and that service.
3. It connects each to `zekno-route-<app>` with
   `docker network connect --alias <a new random 128-bit name>`, then checks that the alias is in
   place, and tries again if not: a connect made while the container was restarting answered an
   error, yet the alias was in place afterwards (D14).
4. The proxy joins `zekno-route-<app>`, and no network of the app's Compose project. It reaches each
   container by its alias and the route's port. The health check's container joins the same network
   (part 4.3). The proxy leaves the route network of an app that no longer has a route.

No container (the service is absent, or uses `network_mode: host`, which cannot join another
network): the route is not applied and the outcome is `start_failed`. Several copies get an alias
each, and the proxy gets them all. A fixed `container_name` changes nothing. Aliases are new at
every start: a container `up` recreates gets a new one, and the old alias goes with the old
container. They are saved with the routes in force, so the configuration built for any app's deploy
includes them.

Why an alias and not an address. Docker frees a container's address while a restart policy brings
it back, and another container that starts on the network meanwhile can take it: the old address
went to a container that started in between, and the restarted one came back with another (checked
on Docker 29.6.1, D13). A proxy holding the address would then send part of a domain's traffic,
after TLS, to whichever container took it: another service of the app, a check or one-off
container, or another app's container that joined the network as an external one (D7). The alias
stayed through ten restarts and resolved, from another container on that network, to the
container's current address (checked on Docker 29.6.1, D14). While the container is down it
resolves to nothing, so a request fails instead of reaching another container.

Why an alias and not a name the app has. Another app's container can join this app's network as an
external network and take this app's container name as an alias; the name then resolves to both
(checked on v5.3.0, D7). A random alias the runner hands out cannot be taken that way: another
app's container can join `zekno-route-<app>` too, but cannot answer to a name it does not know, and
only Docker holds it. Such a container can reach the routed containers and the proxy on that
network, which it could already do by joining the app's own network (D7).

Why the containers found are the app's own. A Compose text cannot forge Compose's labels on its
containers or networks: Compose v5.3.0 wrote its own over them, and `ps -q` of the other project
listed only that project's real container (D11). Nor can it take another project's name with a
top-level `name:` (D12). So only an app whose deploy controls Docker (it can mount the Docker
socket, part 2.6) can stand among this app's containers or read its aliases, and that app's
deployer is root on the server already.

Not checked: D13 and D14 on Linux (they ran on Docker Desktop for macOS), and how a given proxy
resolves names (below). Question Q17.

**When routes change.** When the deploy reaches its start: after `docker compose up` has run,
whatever its exit status. If the run stops before that (the build or the pre-deploy command
failed), the app keeps its earlier routes and domains. The check (step 9) and the change (step 18)
both happen under the deploy lock, which serves one deploy at a time on the server (part 6), so no
other deploy can claim a domain in between. At step 18 the proxy's configuration comes first and
the state after (V12). The runner reads the state again under the state lock, builds the proxy's
whole configuration from the routes of every app in it, with this app's new routes and aliases in
place of its old ones, writes it in one atomic write (as `writeAtomic` in home.ts does), and has
the proxy load it. Only once the proxy has loaded it does the runner save the routes in force to
the state, again under the state lock with a fresh read. If the proxy will not load it, the runner
builds and loads the configuration from the state as it is, which still holds the earlier routes,
and the outcome is `start_failed`: one app's refused route never reaches the state to block every
later configuration. A runner that dies between loading and saving leaves the earlier routes in the
state; the next configuration, built from the state at any app's deploy, puts the proxy right. A
proxy that can check a configuration without loading it would let the runner check it before the
number is used too; that depends on the proxy chosen.

**The proxy's configuration is built, never pasted.** It is generated from the checked fields and
the runner's aliases only. No text from a deploy reaches the proxy's configuration language without
passing the patterns above.

**The proxy itself.** Which proxy is the maintainer's choice (Caddy or Traefik, as examples). The
design asks five things of it. Its program or image is chosen by the runner release and pinned by
digest in the runner's code, never named by a deploy; otherwise the registry would decide what
terminates TLS for every app. Any admin interface is off, or unreachable from the route networks
it joins. It asks for certificates only for domains in routes (ACME, as an example). The private
keys of those certificates live on the server, in the proxy's storage. And it resolves an upstream
alias when it connects, or keeps an answer only briefly, never once when the configuration loads:
a proxy that kept the first answer would keep an address that may since have passed to another
container (D13), and the alias would buy nothing. How each candidate proxy resolves names was not
checked.

**One runner per Docker daemon.** `defaultHome` (home.ts) lets a root runner and a user's runner
live on one machine. With one Docker daemon they would share Compose project names (`zekno-<app>`,
a clash that exists today), image tags, and ports 80 and 443. The design assumes one runner per
daemon. The runner labels its proxy with its server id, and does not start its proxy while a proxy
labelled with another server id runs.

**What the domains feature still has to decide.** Who starts and updates the proxy (recommended:
the runner, at the first deploy with routes, from the digest its release pins; a release with
another digest replaces it at the next deploy with routes). How it binds ports 80 and 443 when
Docker runs without root. Redirecting HTTP to HTTPS. The certificate authority's account and its
contact address. What happens to a released domain's certificate and key (recommended: deleted with
the release).

**Runner keeps.** The routes in force of each app with their aliases (state `routes`); the domain
table is computed from them, so there is one record, not two. A route network per routed or checked
app. The proxy's configuration file, which is always computed from that state. The proxy's
certificate storage.

**Hosted service.** Cannot add, change or move a route: routes are signed per app, and ownership is
checked on the runner. Can withhold a release so that a claim keeps being refused, or deliver a
claim before the release: the claim is refused, nothing is misrouted. Learns every domain.

**Whoever answers for a domain's DNS.** Decides which server browsers reach, and which server can
obtain a certificate. Zekno does not check DNS.

**Lying or compromised server.** Routes any traffic it gets. New: it holds the TLS private keys of
every routed domain.

**Rollback.** A rollback keeps the current routes unless the developer asks for the old ones; then
the CLI shows which domains move before it asks, and a domain another app took since makes the
rollback refused (`domain_taken`, no number used). A rollback taken for a code problem so never
takes the site off the proxy or frees its domains. If the old Compose text lacks a service a current
route names, the route finds no container and the outcome is `start_failed`; the CLI says so before
it signs.

**Limits.** At most 64 routes per deploy and 1,024 domains per server; a domain at most 253
characters; ports 1 to 65,535.

**Cost.** Payload up to about 20 KiB; state up to about 350 KiB; a proxy to run and update. New
failures: `domain_taken`; a proxy that is down or refuses a configuration; a routed service with no
container; an alias Docker will not attach; an app whose own Compose text publishes port 80 or 443.

### 4.3 A health check

**What Docker Compose does.** Docker records a health status for a container whose image or Compose
text has a health check. When a service's definition changes, `docker compose up` creates the new
container under a temporary name, stops and removes the old one, then renames and starts the new
one (checked on v5.3.0, D5). The old one stops before the new one starts. So when a health check
runs, the old version is already gone: there is nothing to keep running, and nothing to go back to
without a new deploy.

**Signed.** `health`: `null`, or a `timeout` and a list of services, each with `http`: `null`, or a
`port` and a `path`. The deploy counts as done when, within `timeout` seconds after Docker Compose
returns, each listed service has a running container and: with `http` null, Docker reports it
`healthy` if it has a health check, or, if it has none, it stays running with an unchanged restart
count for 10 seconds (a container in a restart loop can be running at one moment); with `http` set,
a GET of `path` on `port` of each of its containers answers with a status from 200 to 399.

**Who makes the GET, and to where.** Never the hosted service and never an address or name the
deploy gives. The runner connects each container of the service to the app's route network with a
random alias, as for a route (part 4.2). A short-lived check container, from an image the runner
release pins by digest, runs on `zekno-route-<app>` and requests `http://<alias>:<port><path>` for
each alias, resolving the alias as it connects. So the check, like the proxy, never reaches a
container that took a restarted container's old address (D13). It follows no redirect, reads at
most 1 KiB of the answer, and gives up on one try after 5 seconds. It works whether Docker runs as
root or not (from the host, container addresses are not reachable with rootless Docker; not
checked), needs no tool in the app's image, and needs no admin interface on the proxy (question
Q4).

**Runner checks.** The patterns and limits. A path starts with `/`, is at most 1,024 characters,
and holds only RFC 3986 path and query characters: letters, digits, `-._~!$&'()*+,;=:@/?`, and `%`
followed by two hex digits. No space, no `#`.

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

**Rollback.** Keeps the current health check unless the developer asks for the old one, as for
routes.

**Limits.** `timeout` 1 to 1,800 seconds; at most 16 services; the path rule above; ports 1 to
65,535.

**Cost.** About 1 KiB in the payload. Another deploy to the server waits up to `timeout`. A new
outcome, `unhealthy`. With `http`, an image the runner pulls once.

### 4.4 A pre-deploy command

**Signed.** `predeploy`: `null`, or a `service`, a `command` as a list of words, and a `timeout`.

**Where it runs.** In the runner's folder, before the new version starts:
`docker compose -p zekno-<app> -f <new text> run --rm -T --no-deps
--name zekno-<app>-predeploy-<sequence> <service> <words>`. The container is made from the new
deploy's definition of `service`: its new image, environment, volumes and networks. The new Compose
text is written beside the running version's, not over it, until the start.

**What it reaches.** With `--no-deps` it starts nothing else and replaces nothing, so it reaches
only what already runs: the old version's containers. Without it, Compose recreated a dependency
whose definition had changed (`db`, here) before the one-off container started; with it, the old
`db` was untouched (checked on v5.3.0, D4). So a migration reaches the old version's running
database container, as it is before this deploy. If the new version changes that service too (a new
image, a new major version), the migration still runs against the old one, and `docker compose up`
replaces it afterwards: the command must suit the database as it is before the deploy. If the new
version renames the service the command needs, or adds it, the command cannot reach it and fails,
and the old version keeps running. When the project has no container and no volume, there is
nothing old to keep: the runner leaves `--no-deps` out, so that dependencies start first. If the
command then fails, those dependencies keep running; nothing older existed. A volume alone is
enough to keep `--no-deps`: after a manual `down` or a pruned container the data of an earlier run
is still there, and starting a database of a new major version on it is the case V3 was about
(V24).

**With which secrets.** Exactly what that service gets from the Compose text. Docker Compose's
environment holds the deploy's secrets, as for `up` (`composeUp`), and the Compose text decides
which reach the container. No secret is added for this command.

**The words.** Passed as separate arguments, never through a shell on the server. Words such as
`--privileged -v /:/host --rm` after the service name reached the command as text, and none was
read as an option of Compose (checked on v5.3.0, D3). Inside the container a shell runs only if the
words name one (`["sh", "-c", "…"]`).

**Time.** Stopping the `compose run` client does not stop the container: after the client was
killed, with SIGKILL or SIGTERM, the one-off container kept running, and a later
`up -d --remove-orphans` left it running (checked on v5.3.0, D6). So the container has the name
above, and at `timeout` the runner removes it by that name (`docker rm -f`) and waits until it is
gone before it answers. If the runner itself dies during the command, the container runs on, and
the lock, whose liveness is the runner's process id (`acquireLock`), is free again. So the runner
refuses every deploy of the app (`busy`, no number used), whether or not it has a pre-deploy
command, while a one-off container of `zekno-<app>` still runs (labels
`com.docker.compose.project=zekno-<app>` and `com.docker.compose.oneoff=True`; part 6, step 11),
and removes one that has stopped. Two pre-deploy commands of one app never run at once, and no
deploy starts the app beside a migration left running (V4).

**When it fails** (an exit status other than 0, the time limit, or a container that cannot start):
the outcome is `predeploy_failed`. The new version is not started, its routes do not take effect,
and the old version keeps running, on the same dependencies it had (with `--no-deps`). The number is
used (the state was saved before the command ran), so this deploy can never run the command again.
Trying again is a new deploy.

**Why it is safe that a signed deploy names a command.** It already does. The Compose text names an
image and a command for every service (`command`, `entrypoint`, `healthcheck.test`), and can run
them privileged with the host's folders mounted (part 2.6). What is new, precisely:

1. The command runs once per deploy and to its end, outside Docker's restart rules. A deploy
   accepted twice would run it twice. What stops that is the order rule (part 3.1), with the state
   saved before the command runs (part 6, step 15).
2. It runs while the old version still serves, against what both share, such as a database. A
   failed or wrong command affects the running version.
3. Its exit status decides whether the deploy goes on.
4. Its output reaches the deployer, as Docker's output does today, and can print a secret's value,
   as Docker's errors can (review 003, "Limits").

**Runner keeps.** Nothing between deploys.

**Hosted service.** Cannot add or change a command, and cannot replay one (part 3.1). Can delay a
deploy that nothing else overtakes, so that the command runs later than meant, up to `expiresAt`
and then the build's time. Learns the command's words.

**Lying or compromised server.** Runs anything anyway. Nothing changes.

**Rollback.** A rollback copies everything but the pre-deploy command, unless the developer asks
for it, because a migration written to move forward rarely suits moving back (question Q5).

**Limits.** 1 to 64 words, each at most 4,096 characters of well-formed text without a NUL, all of
them at most 16 KiB; `timeout` 1 to 3,600 seconds.

**Cost.** Up to 16 KiB in the payload; another deploy to the server waits up to `timeout`; a new
outcome, `predeploy_failed`.

### 4.5 Secrets by version

**Today.** The deploy lists each secret's name, version and ciphertext hash, and the request must
carry exactly those sealed values (`verifyDeploy` step 5). A name the deploy leaves out is not
checked. The runner keeps only versions and hashes (`RunnerState.secrets`). The records live on the
machine of whoever set them (`secretsPath`, profile.ts). So CI, or a second teammate, cannot deploy
the app's secrets.

**Signed.** The same `secrets` and `removed` lists as version 1. What they mean is unchanged: these
versions, with these hashes. What changes is where the sealed value may come from, and that the
lists must be complete.

**Sent with the deploy, not signed.** `records`: whole secret records (statement and sealed value),
only for listed secrets the runner lacks.

**Every live secret is listed.** A version-2 deploy must list, in `secrets` or `removed`, every name
of the app for which the runner holds a live version (one whose hash is not `null`). Otherwise it is
refused `secrets_mismatch`, with no number used. Leaving a secret out takes a signed removal, never a
silence. Without this rule, the hosted service could leave one statement out of CI's `records`
read, and CI would deploy without that secret; Compose fills an unset variable with an empty
string, and some apps then fall back to an insecure default (V5). With it, a hidden statement makes
the deploy refused, not quietly weaker. A secret set by a member who has since been removed must
now be set again or removed before the app deploys. That is a change: today `currentSecrets` leaves
such a record out, and `sendDeploy` prints "Left out a record: unknown_signer." and deploys without
it. The line names no secret, because `currentSecrets` records no name for a record it could not
verify (secret-record.ts) (V24). Refusing costs availability at a bad moment: removing a member
blocks every app with a secret they set, on every server. So when an admin removes a member, the
CLI says which secrets that will block and offers to set them again or remove them in one step.

**Runner checks, for each listed secret**, before anything is opened: first the version rule of
version 1 (`stale_secret`). Then the record:

- **Supplied:** its statement must verify as `verifySecret` does (signed by a current member,
  allowed on this server with part 4.6, for this team, server and app, naming this sealed value's
  name and hash), its version must equal the listed version, and its hash the listed hash.
- **Held:** the runner holds a record of this app under the listed hash, its statement's team,
  server, app, name, version and hash all equal the listing, and it still verifies against the team
  list the runner holds now. Without every field, a listing could raise the state's version over a
  held statement that says less, and every later deploy from that statement would be refused (V7).
- **Neither:** refused `secret_missing`, with no number used.

A statement that no longer verifies (its signer was removed) is refused `untrusted_secret`. A
supplied record the deploy does not list is refused `secrets_mismatch`: what is supplied is still
exactly what is needed.

Checking statements on the runner is new. A removed member's secret then stops counting on the
runner as it already does on the CLI (`createDeploy` refuses it, and the core review lists "must be
set again" as a limit). It also lets the runner enforce part 4.6 on whoever set a secret, and lets
it give deployers statements they can check.

**Runner keeps.** For each `app/NAME` with a live version, its latest record (statement and sealed
value) in `records/<app>/<ciphertext hash>.json`, mode 0600, which the state's `{version, hash}` (as
today) names. Files are named by app and hash, never by secret name, since two secret names can
differ only in letter case and a disk may not tell them apart; and one app's file is never found
for another. Older versions are deleted, since the runner refuses them anyway. Removal statements
are not kept: with the rule above a deployer needs only the live statements, and `status` already
says which names are removed at which version (`RunnerStatusSchema`), which explains a
`stale_secret`. A new file is written and synced before the state that names it, and a file no
state names is deleted after, so for an app at version 2 the state never names a missing file. A
version-1 deploy still writes a version and hash with no file, as today; such a secret must come
with its record in the app's first version-2 deploy, or be removed. Everything kept is sealed or
signed; nothing decrypted is written.

**How a deployer learns what the runner holds without trusting a lie.** It never takes a version
or a hash from the runner's word, nor from the hosted service's. It asks the runner for the live
statements it holds for the app (a new read, `records`), checks each against its own team list (as
`currentSecrets` does with what the hosted service supplies), takes the highest version of each
name, and signs those versions and hashes. The sealed value never has to pass through the deployer.

What the runner says it holds only decides what is sent: a false "held" ends in `secret_missing`,
and a false "not held" makes the deployer send a record it has, which only the server can open. The
runner cannot make a deployer sign a value no member set, because every statement is checked. Leaving
a statement out makes the deploy refused (above). Answering with an older statement makes the
deployer sign an older version: a runner that saw the newer one refuses it (`stale_secret`), and one
that never saw it uses an older value a member did set. That is the withholding limit the core
review already records.

**A retired secret.** As in version 1: a removal, one version above the secret, listed in
`removed`. The runner sets the hash to `null`, deletes the stored sealed value, and refuses that
name at that version or below (`stale_secret`). A higher version brings the name back. A retired
secret never reaches an app.

**Version-1 deploys on a version-2 runner** store nothing: a version-1 request carries sealed
values without statements, so the runner could not show them to anyone. The first version-2 deploy
of an app must come from a machine that holds its records. Until then CI cannot deploy that app.

**Hosted service.** Relays records it cannot open, and cannot make one that counts. Can withhold
(above). Learns names, versions, hashes, sizes and the key ids of whoever set them, as today.

**Lying or compromised server.** Already holds the values. New: it can answer `records` with older
statements, and pretend to hold values it lacks. It cannot forge a statement, and a missing one
makes a deploy refused.

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

**Where the limit is written.** In the team list, which an admin signs: a member with the role
`deployer` may carry `servers`, a list of server ids from the same list. Absent means every server.
An admin signs team lists, so a limit on an admin could be signed away by that admin: a team list
that limits an admin is refused (`invalid_members`). The list's hash chain and the `stale_team` rule
already make every deploy name the list it was made with.

**How it is enforced.**

- Runner: in the version-2 deploy check, after the role, the signer must be allowed on this server
  (`not_allowed_here`, a new reason); the same for the signer of each statement it takes or uses
  (part 4.5); the same for `pack`. The version-1 path has no such check, so a runner that holds a
  team list able to carry limits takes no version-1 deploy at all (part 4.7).
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
stays version 1 until a limit is set. Once a list of the new version is signed, every later list
keeps that version, even after every limit is removed, so the rule of part 4.7 never depends on
which version a later admin happens to choose. Signing the first such list also ends every
version-1 deploy on every runner that takes it (part 4.7); the CLI says so before the admin signs. `TeamTrust` and
its stored schema (part of the runner's state) gain the field. Bytes: at most 32 server ids per
member, about 1.2 KiB; 64 members, about 80 KiB.

**Why not apps.** A deploy of app A can run a container with the Docker socket or the host's root
mounted, and through it control app B and read the runner's key (part 2.6). A key limited to app A
is not kept from app B on the same server. It would stop an honest mistake only, while reading like
a boundary. Servers are separate machines: there, a limit is a boundary, as far as the servers
share nothing else.

**Hosted service.** Can withhold a team list that adds a limit, or removes a key: until a runner has
the list, the key works there as before. Over SSH, a deploy by an up-to-date member carries the
whole chain (`sendDeploy`), and an admin can send it at once with `sync`, which no longer waits for
a long deploy (part 6).

**Recommendation.** Server limits on deployers, built with the CI feature, as a change to the team
list that is separate from the deploy message and can ship before or after it. No app limits.

### 4.7 Version 1 and version 2 together

**A runner that knows only version 1.** The CLI sends a version-2 deploy in a new session command
(named `deploy` here, part 7). A version-1 runner refuses a request with an unknown command as a
whole, before any command's code runs (`SessionRequestSchema`, in `runSession`: `invalid_request`).
Sent through `apply` instead, it would still be refused before the deploy's payload is parsed: the
strict `RunnerApplyRequestSchema` refuses the new request fields, and the envelope's kind would be
refused by `readEnvelope` (`wrong_payload_type`) before its signature is checked. Nothing is
half-understood. The CLI does not rely on this: it asks first.

**How the CLI knows.** The session's `version` answer gives the protocol (`RunnerVersionSchema`).
Version 2 raises `RUNNER_PROTOCOL` to 3; each later step that carries out more fields raises it
again (part 3). Before it signs (signing records a number in the history), the CLI decides:

- The runner's protocol carries out every field the deploy uses: a version-2 deploy.
- Otherwise, if the deploy uses nothing new (no build, routes, health check or pre-deploy command,
  and every record on hand) and the runner would accept version 1 for the app (below): a version-1
  deploy, as today.
- Otherwise it stops and says which runner to update. A runner that does not speak sessions
  reports no protocol and is treated as version 1 only (`runnerRelation`).

**When a version-2 runner accepts a version-1 deploy.** Only when both hold:

1. The team list it holds is version 1, the version that cannot carry limits. Once it takes a team
   list of the version that can (part 4.6), it refuses every version-1 deploy, of every app. The
   version-1 path (`verifyDeploy`) knows nothing of limits, so a key limited to staging could
   otherwise deploy to production through it (V2). Team lists only move forward
   (`applyRosterUpdate`), and once one is of the new version every later one is too (part 4.6), so
   version 1 never comes back on that runner.
2. The app was held by the runner when it was upgraded to version 2, and has had no version-2
   deploy since. When a version-2 runner first reads a version-1 state, it marks every app with a
   number of 1 or more as version 1 (state `formats`). An app name it has never held is version 2
   from its first deploy, so a version-1 deploy of a new app is refused.

Otherwise the refusal is `unsupported_version`, a reason a version-1 CLI can read (`DEPLOY_REFUSALS`).
A version-1 deploy has no routes, so accepting one for an app at version 2 would release its domains
and drop its health check without anyone asking for that. Recommended: version 1 is removed
altogether in a runner release, announced, at least one release after the first CLI that signs
version 2 (Q8).

**Existing answers keep their exact shape.** An old CLI reads `status` and reports with strict
schemas (part 2.5). So `status` stays as it is; a reason or outcome only version 2 has appears only
in answers to version-2 requests; new information comes from new reads.

**The state file.** It gains a version mark. A version-2 runner reads a state with no mark as a
version-1 state, once: it fills the new parts with nothing and marks the apps it holds as version 1
(above). A read that writes nothing (`status`) marks nothing on disk; the first write does. From
then on, every write by a version-2 runner writes the whole state with its mark, `setup` included,
and the mark is never removed. That holds for the version-1 path too: it checks a version-1 deploy
against the version-1 part of the state (what `verifyDeploy` reads) and writes back the whole
version-2 state with only `lastSequence` and `secrets` changed (part 6). Saved as `apply` saves
today, as `verifyDeploy`'s version-1 `nextState`, it would drop the mark, the routes, the kept
builds and the app version marks; the next read would then take the state for version 1, read
every domain as held by nobody, and mark every app version 1 again (V21). A state with the mark and
a missing part is damaged (`invalid_state`): a lost `routes` must never read as "no domains held",
which is the core review's finding 6 again. A version-1 runner cannot read a version-2 state, so
going back to an older runner after a version-2 deploy refuses everything (`invalid_state`): it
fails closed.

**Sequence numbers.** One counter per app for both versions (`lastSequence`); the order rule of part
3.1 binds every version-2 deploy to it. A version-1 deploy signed before the change and never
delivered is accepted later only if the app is still marked version 1, the team list is still
version 1, and its number is above the last.

**History on the developer's machine.** It holds both kinds; each is read with its own verifier
(`readSignedDeploy` for version 1, a new one for version 2), and the number is taken from under the
signature as today. Two entries can carry the same number when one lost a race (part 3.1); the
outcome mark tells the one that ran, and only entries the runner accepted are offered for rollback,
as today. The mark gains `build_failed`, `predeploy_failed` and `unhealthy`. A version-2 envelope is
at most about 1.4 MiB, so 50 entries are at most about 70 MiB per app.

**Rollback across the change.** To a version-1 entry from an app now at version 2: signed as
version 2 with the old Compose text, no build and no pre-deploy command, and the current routes and
health check (parts 4.2 and 4.3), so it releases no domain. To a runner that still accepts version
1 for the app: version-1 entries, as today.

### 4.8 Left out of version 2, and why

| Left out | Why |
|---|---|
| The runner reading or limiting the Compose text (only pinned images, no privileged containers, no host folders) | It needs a Compose parser on the runner and a policy language. Without it, signing stays equal to root on the server (part 2.6), and so does everything below that rests on it. |
| Keys limited to apps | Not a boundary while the line above is left out (part 4.6). |
| Two copies at once, switching traffic when healthy, going back by itself | Needs the proxy, services without host ports, fixed volume names and services that may run twice (part 4.3). The health check's field is ready for it. |
| Deploys of different apps on one server at the same time | Each deploy holds the deploy lock, up to about four hours with every time limit reached (build, pre-deploy, `up`, health). Per-app locks would need a domain reservation saved with the state at step 15. `sync` and `pack` do not wait (part 6). Availability only. |
| Fair shares of staging between apps; resuming an upload part way | Whoever holds unused genuine deploys can fill staging or make two alternatives evict each other, which denies uploads only (part 4.1 b). `pack_missing` does not name the missing chunk, so a cut-off upload is sent again whole. |
| Keeping one app's build cache apart from another's beyond cache mounts; a build without cache | A layer built with a secret can be reused after the secret changed, or by another app's identical step (part 4.1 b). The apps are the same team's, and each deployer is root on the server. The build feature can offer a rebuild without cache. |
| Forward secrecy for packs and records | Both are sealed to one long-lived server key; losing it opens every sealed chunk and record anyone kept (part 4.1 b, T35). |
| A runner folder restored from a backup | A restored `state.json` lowers each app's number. Whoever holds the deploys accepted since can deliver them again, in order, each matching `previous`: pre-deploy commands run again, domains move back, and apps can be marked version 1 again. It also brings back an older team list: keys removed since are members again, and limits set since vanish, so the version-1 path can reopen for a key the newer list limited. Nothing cheap closes it, since the runner has no anchor outside its folder. Do not restore the runner's state; set the server up again (a new key, so a new server id), and every older deploy is addressed to another server (T34). |
| Telling which of two deploys with the same number ran | A new deploy settles it (part 3.1). |
| Wildcard domains, routes by path, TCP or UDP routes, certificates the team brings, managing DNS | A wildcard overlaps other apps' domains, and a path splits one domain between apps: the "one app holds a domain" rule would need more. The rest are features of their own. |
| Removing an app (stopping it, releasing its domains, deleting its stored records and images) | Needs a signed message of its own, bound to the order rule. Today a deploy that leaves the domains out releases them. Whatever it removes, it keeps the app's last number and its version mark for good, as a tombstone: the order rule rests on them (part 3.1, V22). |
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
| `previous` | whole number | 0 to 2^53 - 2 | CLI: the app's last number from the runner's `status`, 0 for none | runner: equal to its own last number (`replayed` if lower, `sequence_jump` if higher) |
| `sequence` | whole number | exactly `previous + 1` | CLI | runner (`malformed`) |
| `createdAt` | ISO time | | CLI's clock | nobody; shown by the CLI, as in version 1 |
| `expiresAt` | ISO time or `null` | not `null` on a deploy taken from the hosted service | CLI: through the hosted service, one hour ahead when a person waits, CI's own setting for CI; may be `null` over SSH, and then the envelope never leaves its SSH session | runner, by its clock (`expired`) |
| `compose` | text | 256 KiB UTF-8 | CLI | runner: size only; Docker Compose reads it |
| `secrets[]` | name, hash (64 hex), version | 256; sorted, unique | CLI, from statements it verified | runner: complete with `removed` (`secrets_mismatch`), versions (`stale_secret`), records (`secret_missing`, `untrusted_secret`, `secrets_mismatch`) |
| `removed[]` | name, version | 256; sorted; no name also in `secrets` | CLI, from removals it verified | runner (`stale_secret`) |
| `builds[]` | object | 8 per deploy (new) | CLI | runner |
| `builds[].key` | 64 hex | | CLI: the build key (part 4.1 b) | runner: equal to its own computation (`malformed`) |
| `builds[].pack.hash` | 64 hex | | CLI: `hash("zekno/v1/pack", pack)` | runner, after opening every chunk (`pack_mismatch`) |
| `builds[].pack.size` | whole number | 1 byte to 512 MiB (new) | CLI | runner (`pack_mismatch`); the chunk count must be the size divided by 8 MiB, rounded up (`malformed`) |
| `builds[].pack.chunks[]` | 64 hex each | 1 to 64; at most 64 distinct per deploy (new) | CLI: `hash("zekno/v1/pack-chunk", sealed chunk)` | runner (`pack_missing`, `pack_mismatch`); the gate of `pack` |
| `builds[].dockerfile` | path | 1 to 255 characters; stays inside (`staysInside` in link.ts); no control or format character | CLI | runner (`malformed`); the builder finds it in the pack |
| `builds[].target` | text or `null` | `^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$` | CLI | runner (`malformed`) |
| `builds[].args[]` | name, value | 32 per build; name `SECRET_NAME`, not reserved; value at most 4 KiB, well-formed, no NUL; 64 KiB per deploy (new) | CLI | runner (`malformed`) |
| `builds[].secrets[]` | names | 32 per build; sorted, unique; each in `secrets[]` | CLI | runner (`malformed`) |
| `builds[].network` | `"default"` or `"none"` | | CLI | runner hands it to the builder (`"none"`: no network for `RUN` steps) |
| `builds[].timeout` | seconds | 1 to 7,200 | CLI | runner stops the builder's client |
| `predeploy` | object or `null` | | CLI | runner |
| `predeploy.service` | text | `SERVICE_NAME` | CLI | runner (`malformed`); Docker Compose finds it |
| `predeploy.command[]` | words | 1 to 64; each at most 4,096 characters, well-formed, no NUL; 16 KiB in all | CLI | runner (`malformed`) |
| `predeploy.timeout` | seconds | 1 to 3,600 | CLI | runner removes the container by name |
| `health` | object or `null` | | CLI | runner |
| `health.timeout` | seconds | 1 to 1,800 | CLI | runner |
| `health.services[]` | service, `http` | 1 to 16; sorted by service, unique; `SERVICE_NAME` | CLI | runner (`malformed`) |
| `health.services[].http` | `null`, or port and path | port 1 to 65,535; path: the rule of part 4.3 | CLI | runner (`malformed`) |
| `routes[]` | domain, service, port | 64 per deploy; 1,024 domains per server (new); sorted by domain, unique | CLI | runner (`malformed`, `domain_taken`, `too_large`) |
| `routes[].domain` | text | the rule of part 4.2 | CLI | runner (`malformed`) |
| `routes[].service` | text | `SERVICE_NAME` | CLI | runner (`malformed`) |
| `routes[].port` | whole number | 1 to 65,535 | CLI | runner (`malformed`) |

The CLI runs the same schema before it signs, so it never signs what the runner would call
`malformed`.

## 6. The runner's checks, in order

**Two locks.** The deploy lock (`lock`, as `acquireLock` takes it today) serves one deploy at a
time on the server and is held for a whole deploy. The state lock (new, short) covers every
read-then-write of `state.json` and of `packs/`. `sync` and `pack` take only the state lock, so a
team list that removes a stolen key, and uploads, are not refused while a long deploy builds (V11).
Each step below that reads or writes the state says how:

- *One span*: steps 2 to 15 run under the state lock taken at step 2. Nothing else writes the
  state meanwhile, so nothing there is written from a stale read. Steps 4 to 14 read the state
  loaded at step 2 and write nothing; step 12 also reads `packs/<app>/`.
- *Read again*: every state write after step 15 takes the state lock, reads the state again,
  changes only its own part (one kept build, the routes in force, the list of kept builds), writes
  the whole state back with its mark, and releases the lock. So a build's bookkeeping can never put
  back a team list that `sync` replaced meanwhile (core review, "What a runner must do"; V20).
- *Deploy lock only*: the step reads and writes no state.

A deploy past step 15 finishes even if a `sync` then removes its signer: it was accepted under the
team list it was checked against, as if the `sync` had come a moment later. An admin removing a
stolen key should know that one deploy may still finish. Every write by a version-2 runner writes
the whole state with its mark, `setup` included, and the mark is never removed (V21). `docker
compose up` gets a time limit on both paths (1,800 seconds), so no deploy holds the deploy lock
without end.

For a version-2 deploy (`deploy`, part 7). A refusal at steps 1 to 14 changes nothing but the team
lists saved at step 3, and uses no number.

1. The request line is at most 32 MiB and matches the strict request schema (`invalid_request`).
2. Take the deploy lock (`busy`), then the state lock; load the key and the state (`not_set_up`,
   `invalid_state`). *One span begins.*
3. Follow the team lists sent with it and save them, as `follow` does today, as the whole state
   with its mark. *One span.*
4. The envelope's size (`too_large`), shape (`malformed`) and kind `zekno.deploy.v2`
   (`wrong_payload_type`).
5. The signer is a current member (`unknown_signer`); the signature (`bad_signature`).
6. Only now is the payload parsed: JSON, `v` is 2, the strict schema and every pattern and limit of
   part 5, sorted and unique lists, each name once across `secrets` and `removed`, each build secret
   in `secrets`, `sequence` equal to `previous + 1`, each chunk count matching its size, each build
   key equal to the runner's own computation (`malformed`). A field this runner does not carry out
   yet and that is not empty (`unsupported_version`).
7. Role (`role_not_allowed`); signer allowed on this server, with part 4.6 (`not_allowed_here`);
   team (`wrong_team`); team list (`stale_team`); server (`wrong_server`); server listed
   (`unknown_server`).
8. `previous` equal to the app's last number (`replayed` if lower, `sequence_jump` if higher).
   `expiresAt` not passed by the runner's clock, and not `null` on a deploy taken from the hosted
   service (`expired`).
9. Routes: no domain held by another app (`domain_taken`).
10. Secrets: every name with a live version listed in `secrets` or `removed`
    (`secrets_mismatch`); versions (`stale_secret`); each listed secret supplied and verified, or
    held with every field equal and verified again (`secret_missing`, `untrusted_secret`,
    `secrets_mismatch`); each supplied record listed (`secrets_mismatch`).
11. No one-off container of `zekno-<app>` still runs (`busy`), whether or not this deploy has a
    pre-deploy command: a deploy without one would otherwise start the app beside a migration left
    running (V4).
12. Builds: a kept image whose tag names the recorded image id; or every chunk staged with its hash
    (`pack_missing`), each opening, the whole of the signed size and hash (`pack_mismatch`). Nothing
    opened is written.
13. After the change: apps, secrets, stored record bytes and domains within their limits
    (`too_large`).
14. Open the secrets, as `openSecrets` does (`secrets_mismatch` if one does not open, as today).
15. Write the new record files, then save the state: the number is used, the secret versions and
    the app's version mark are saved. Move this deploy's staged chunks out of `packs/<app>/` into
    `building/<app>/` (emptied first of anything a runner that died left there), where no cleanup
    looks, so a `pack` that arrives during the build cannot
    delete them (V20). Release the state lock. *One span ends.* From here every step has effects,
    and none can run twice for this deploy.
16. Build each build that is not kept, in the runner's folder, streaming its pack from
    `building/<app>/` into the builder, with the cache-mount namespace and `--iidfile`; stop its
    client at `timeout`. Record each image id. *Read again.* Then delete `building/<app>/`, whatever
    the build's result. On failure: outcome `build_failed`, stop.
17. Remove a stopped one-off container of the app. With a pre-deploy command: write the new Compose
    text beside the running version's; run the command with `--no-deps` (left out only when the
    project has no container and no volume), under its own name; at `timeout` remove it by name and
    wait until it is gone. On failure: outcome `predeploy_failed`, stop. *Deploy lock only.*
18. Put the new Compose text in place and run `docker compose up`, with its time limit. *Deploy lock
    only.* Connect the containers of each routed or checked service to the app's route network,
    each with a new alias (part 4.2). Build the proxy's whole configuration from the state, read
    again under the state lock, with this app's new routes and aliases in place of its old ones;
    write it and have the proxy load it, the state not yet changed. Once the proxy has loaded it,
    save the routes in force with their aliases. *Read again.* If the proxy will not load it, build
    and load the configuration from the state as it is, which still holds the earlier routes, and
    leave the state alone. A runner that dies between loading and saving leaves the earlier routes
    in the state, and the next configuration, built from the state, puts the proxy right (V12). A
    non-zero exit, the time limit, a routed service with no container, or a configuration not
    loaded: outcome `start_failed`.
19. The health check, through the same aliases. If it does not pass in time: outcome `unhealthy`.
    *Deploy lock only.*
20. Answer. Then drop the app's kept builds past the last three deploys from the state, *read
    again*, and clean `packs/` as part 4.1 b says; then remove those images and prune BuildKit's
    cache down to its bound (*deploy lock only*).

For a version-1 deploy on a version-2 runner: refused `unsupported_version` unless the team list is
version 1 and the app is marked version 1 (part 4.7). Then `apply`'s order (part 2.2), with one
change in what it reads and writes: it checks the deploy against the version-1 part of the state
(what `verifyDeploy` reads: server id, team trust, last numbers, secret versions), and writes back
the whole version-2 state with its mark, with only `lastSequence` and `secrets` changed. The app
version marks, the routes in force and the kept builds survive a version-1 deploy (V21). It holds
both locks, the state lock until its state is saved, and has the `up` time limit above.

For `pack`, under the state lock only, in one span: steps 4 to 8 (it carries no team lists), then
the deploy lists a chunk with this chunk's hash; staged chunks in `packs/` are cleaned as part 4.1 b
says (never `building/`); staging stays within its limit (`too_large`); the chunk is written sealed.

## 7. Messages between the CLI and the runner (protocol 3)

Every message is a strict schema in `packages/core/src/protocol/protocol.ts`, and each new command
gets a line length in `SESSION_FRAME_BYTES`.

| Command | Input | Answer | Answer at most |
|---|---|---|---|
| `deploy` (new) | team lists; the version-2 envelope; `records` (at most 256 secret records) | a report; outcomes `started`, `start_failed`, `build_failed`, `predeploy_failed`, `unhealthy`, or `refused` with a reason | 64 KiB, with progress lines as `apply` |
| `pack` (new) | the version-2 envelope; one sealed chunk, base64url | `ok`, or `refused` | 64 KiB |
| `records` (new) | an app | the statements of the live records the runner holds for it | 8 MiB |
| `apply`, `status`, `sync`, `setup`, `state`, `logs`, `version` | unchanged | unchanged | unchanged |

New refusal reasons, only in answers to version-2 requests: `secret_missing`, `untrusted_secret`,
`pack_missing`, `pack_mismatch`, `domain_taken`, `expired`, and `not_allowed_here` with part 4.6.
The order rule reuses `replayed` and `sequence_jump`. `records` is a read and takes no lock, as
`status` does not. Anyone who can start the runner can call it, as with `state` and `logs` (review
004, S4, still open): it gives names, versions, hashes and setters' key ids, never a value.

The report the runner will send to the hosted service (`StatusReportSchema`) has the outcomes
`accepted`, `refused`, `started` and `failed`. Its version-2 form, with the new outcomes and
reasons, comes with the runner's client for the hosted service, which takes version-2 deploys only.

## 8. What the runner keeps

| What | Where | Bound | New |
|---|---|---|---|
| Last number per app, never dropped, not even by a future removal of the app (V22) | `state.json` | 1,024 apps | no |
| Version and hash per `app/NAME` | `state.json` | 8,192 | no |
| Version mark of the state | `state.json` | | yes |
| Each app's message version (1 or 2), set for held apps when the state is first read | `state.json` | 1,024 | yes |
| Routes in force per app, with their aliases (domains are computed from them) | `state.json` | 1,024 domains | yes |
| Kept builds per app: key and image id | `state.json` | 3 deploys × 8 builds | yes |
| Latest statement and sealed value per live `app/NAME` | `records/<app>/<hash>.json` | 8,192 records, 64 MiB | yes |
| Staged sealed chunks | `packs/<app>/` | one deploy's per app; 2 GiB; 24 hours | yes |
| Sealed chunks of the deploy being built | `building/<app>/`, which no cleanup reads | one deploy's; deleted when its build ends | yes |
| The state lock | a second lock file beside `lock` | | yes |
| The proxy's configuration | `proxy/` | computed from the routes and aliases | yes |
| A route network per app with a route or an HTTP health check | Docker, `zekno-route-<app>`, labelled with the server id | 1,024 | yes |
| Images of kept builds | Docker, tagged `zekno.invalid/<app>:<key>` | 24 per app; bytes not bounded | yes |
| BuildKit's cache | Docker | 10 GiB after each deploy | yes |
| Certificates and their private keys | the proxy's storage | one per routed domain | yes |

New entries in `LIMITS`: pack 512 MiB per deploy, chunk 8 MiB, 64 chunks per deploy, 8 builds per
deploy, 32 arguments per build, 64 KiB of arguments per deploy, 64 routes per deploy, 1,024 domains
per server, 3 kept deploys of builds per app, 2 GiB of staging, staged chunks 24 hours, 64 MiB of
stored records, BuildKit's cache 10 GiB, build time 7,200 seconds, pre-deploy time 3,600 seconds,
`up` time 1,800 seconds, health time 1,800 seconds.

## 9. Threats

"Stopped" means the runner refuses or the action is impossible; "not stopped: accepted" gives the
reason. Rows T1 to T30 keep the numbers the review refers to; T31 to T36 are new.

| # | Attacker | Tries | What stops it |
|---|---|---|---|
| T1 | Hosted service | Replays an old deploy of the app to the same server | `previous` must equal the app's last number and `sequence` is one above it (part 3.1); one counter for versions 1 and 2; the state is saved before any build, command or start. Stopped. |
| T2 | Hosted service | Replays a deploy to another server | `serverId` is signed (`wrong_server`); chunks and records are sealed for the named server's key, and another server cannot open them. Stopped. |
| T3 | Hosted service | Applies a deploy to another app | `app` is signed and the runner takes the app from it only; a record's statement and its sealed contents name the app, and records are stored per app; chunks are named by hash in that deploy. Stopped. |
| T4 | Hosted service | Withholds a deploy, a chunk or a record | Not stopped: accepted. Delivery is not promised (core spec, Assumptions). A missing chunk or record is refused before the number is used, so the same deploy can come later. |
| T5 | Hosted service | Delivers a withheld deploy late, such as a migration a day after it was meant, or after newer deploys | Refused once any other deploy of the app has been accepted, whatever numbers it was shown (part 3.1). If nothing else was accepted meanwhile, it runs if its `expiresAt` has not passed; `expiresAt` is required on every deploy the runner takes from the service, one hour ahead when a person waits, and an envelope whose `expiresAt` is `null` never leaves its SSH session. Accepted within that window, plus the build's time limit before a pre-deploy command. |
| T6 | Hosted service | Swaps a pack, or one chunk; reorders, repeats or drops chunks | Each sealed chunk's hash, in order, and the whole pack's size and hash are signed and checked before the number is used (`pack_mismatch`). Stopped. |
| T7 | Hosted service | Supplies a sealed secret it made (anyone can seal for the server's key) | A record counts only if the deploy lists its hash and its statement is signed by a current member allowed on this server; deployers take hashes only from statements they verified. Stopped. |
| T8 | Hosted service | Shows CI or a teammate an older statement instead of the newest | They sign an older version; a runner that saw the newer one refuses it (`stale_secret`); one that never saw it uses an older value a member did set. Not stopped: accepted (core review, withholding). |
| T9 | Hosted service, or a lying runner | Says the runner holds a record or a build it lacks, or lacks one it holds | Only decides what is sent: `secret_missing` or `pack_missing` with no number used, or bytes sent again. Stopped. |
| T10 | Hosted service | Moves a domain to another app, or adds one | Routes are signed per app; a domain another app holds is refused (`domain_taken`); the proxy's configuration comes only from routes in the runner's state and the runner's own aliases. Stopped. |
| T11 | Hosted service | Delivers app B's claim before app A's release | B's deploy is refused, no number used, nothing misrouted. Stopped (the delay is T4). |
| T12 | Hosted service | Lies about the runner's protocol | Version 1 is refused unless the team list is version 1 and the app is marked version 1 (`unsupported_version`), and a version-1 deploy that is accepted keeps the state's marks and routes (part 4.7, V21); version 2 to a version-1 runner is refused before it is parsed; the runner's client for the service takes version 2 only. Stopped. |
| T13 | Hosted service | Withholds a team list that removes or limits a stolen key | Not stopped through the service: the key works on a runner that has not received the list. The admin sends the list directly with `sync`, which no longer waits for a deploy, and no later write by a running deploy puts the old list back, since every write after step 15 reads the state again and changes only its own part (part 6, V20). A deploy already past step 15 still finishes. `status` shows each runner's team list version. Accepted (core research R4). |
| T14 | Hosted service | Reads what it relays | Learns the Compose text with its plain variables, image names and digests, domains, build recipes with argument values, the pre-deploy command, health paths, secret names, versions and hashes, pack sizes, plaintext hashes and build keys (a guessed exact pack can be confirmed). Not secret values, not the source. Accepted: metadata (core spec, Assumptions), wider than in version 1. |
| T15 | Hosted service | Shows a deployer (with or without history) a far-ahead number, keeps the deploy and delivers it after newer ones | Stopped: the runner compares `previous` with its own number; the deploy is refused (`sequence_jump`, or `replayed` once others ran), no number used (part 3.1). |
| T16 | Whoever can start the runner (A); the hosted service | Uploads packs to fill the disk | A chunk is taken only with a signed, unused, unexpired deploy for this server, made after the app's last number, that names its hash; staging is cleaned at every deploy and `pack`, and bounded to 2 GiB and 24 hours; the chunks of the deploy being built sit in `building/<app>/`, out of the cleanup's reach, so an early upload cannot make a build fail after its number is used (V20). Stopped for A. Not stopped for whoever holds genuine unused deploys: it can fill staging for a day or make two alternatives evict each other; accepted, it denies uploads only (part 4.1 b). |
| T17 | Whoever can start the runner (A) | Reads statements, routes, kept builds | Not stopped: as `state` and `logs` today (review 004, S4, open). Names, versions, domains, never a value. |
| T18 | Profile folder (B) | Points the SSH destination at another machine | That machine gets signed deploys (readable fields), and sealed chunks and records it cannot open. It can make deploys fail. Source and secrets stopped; metadata accepted (review 003). |
| T19 | Project folder's author | A settings file whose build reads a production secret with the network on, and a Dockerfile that sends it out | Not stopped by the runner: the developer who deploys signs it. As a Compose file naming `${SECRET}` today. The deploy summary must show build secrets as it shows a service's. Accepted. |
| T20 | Project folder's author | A link in the project to `~/.ssh`, or `.env` files, ending up in the pack | The CLI never follows a link out of the project and leaves `.env*` out unless asked (a rule for the build feature). A link in a pack does not reach the server's files during the build (D10). Not the message's to stop. |
| T21 | Whoever answers for a registry | Serves other content for an image | With a digest in the signed text, Docker refuses it (documented; not checked): stopped after signing. When the CLI asks it for a tag's digest, it decides what is signed: accepted; a CI build's own digest avoids the question. |
| T22 | Whoever answers for a registry or package host during a server build, including the registry of a `# syntax=` frontend | Serves another base image, package or frontend; a frontend reaches the build's secrets | Not stopped for base images and packages: the pack pins the source and the Dockerfile, not what they download. A frontend without a digest is refused by the CLI in a build that names a secret (part 4.1 b). Otherwise accepted. |
| T23 | A stolen CI key | Deploys anything to every server it may reach, reads every secret there, sets or retires secrets, claims domains, runs a pre-deploy that drops a database | Not stopped: a deploy key is root on the servers it may deploy to (review 003). Narrowed by server limits (part 4.6), ended by removing the key once each runner has the list (T13). Two-person approval is on the roadmap. Accepted. |
| T24 | A stolen CI key limited to staging | Sets a production secret for an admin's next deploy to carry | Runner and CLI refuse statements whose signer is not allowed on that server, and a runner with such a team list takes no version-1 deploy. Stopped, with part 4.6. |
| T25 | A removed member | Deploys, or a secret they set is used | `unknown_signer` once the runner has the list; their statements stop counting on the runner (`untrusted_secret`) and on the CLI. Before the runner has the list: T13. |
| T26 | A member deploying app A | Takes app B's domain | `domain_taken`. Stopped. Controlling app B through Docker from app A's containers is not stopped (part 2.6), which is why keys are not limited to apps. |
| T27 | Another app on the server, or a container that starts while a routed one restarts | Answers to this app's container name on this app's network (D7), or takes a restarted container's address (D13), so the proxy or the health check reaches it | The proxy and the check reach only random 128-bit aliases the runner gives this app's own containers on `zekno-route-<app>`, resolved when they connect; an alias follows its container's current address through restarts (D14), and nobody can answer to one without reading it from Docker (part 4.2). A Compose text alone cannot pass for this app's containers (D11, D12). Stopped, on Docker 29.6.1 and Compose v5.3.0 (macOS; Linux not checked), given a proxy that resolves names when it connects. An app whose deploy controls Docker can read aliases and forge labels; its deployer is root anyway (part 2.6). Accepted for that case. |
| T28 | Whoever answers for a domain's DNS, or a certificate authority | Points the domain elsewhere, issues a certificate | DNS decides where browsers go; the proxy asks only for domains in signed routes. Accepted. |
| T29 | Whoever answers for the runner's time server | Moves the runner's clock | Matters for `expiresAt` only: a clock set back accepts a late deploy that is still next, set forward refuses deploys. The order never depends on time (part 3.1). Accepted. |
| T30 | A lying or compromised server | Misreports outcomes, health and holdings; serves old statements; keeps a tampered image for rollback | Not stopped: outside what zekno protects (README). New in version 2: the source in plaintext, the TLS private keys of routed domains. |
| T31 | Hosted service | Holds two deploys signed against the same `previous` (two members, or one who signed new content after an answer that never came), picks which runs, and reports the other as started | Not stopped: accepted. Both were signed as the next deploy; exactly one runs, never both, and the other is refused for good. Fewer alternatives exist: a developer whose answer never came sends the same envelope again for unchanged content (part 3.1). What the service can still do: choose between alternatives that differ (and so whose pre-deploy effects differ), hold the chosen one until its `expiresAt` (one hour when a person waits) provided it withholds every other deploy of the app meanwhile, and say the other ran, since reports through it are unsigned. Through it the CLI cannot tell which ran and says so; over SSH it can, and tells its developer when theirs lost. |
| T32 | A member whose key is limited to some servers (CI's, or that key stolen) | Signs a version-1 deploy for a new app on a server outside its limit, through `apply` | Stopped: a runner whose team list can carry limits refuses every version-1 deploy, and no runner takes version 1 for an app it did not hold when upgraded (part 4.7). |
| T33 | Hosted service, or a lying runner | Leaves one live statement out of CI's `records` read, so CI deploys without that secret | Stopped: a deploy that does not list every live secret in `secrets` or `removed` is refused (`secrets_mismatch`), no number used (part 4.5). |
| T34 | Whoever restores the runner's folder from a backup, with a hosted service that kept the deploys since | Replays every deploy accepted since, in order | Not stopped: accepted. Each matches `previous` again; pre-deploy commands run again and domains move back. The restored state also holds an older team list: keys removed since are members again, limits set since vanish, and the version-1 path can reopen for a key the newer list limited. Restoring the runner's state is not supported; set the server up again (part 4.8). |
| T35 | Whoever stores sealed chunks and records (the hosted service can), if the server key is ever lost | Opens all past source and secrets | Not stopped: accepted. Sealed boxes to one long-lived key have no forward secrecy, as for secrets today (part 4.1 b). |
| T36 | Another app's build on the server | Reads or writes this app's build cache | Cache mounts are kept apart per app (`BUILDKIT_CACHE_MOUNT_NS`, not checked). Reusing a layer built with another secret is not stopped: accepted, same team, root anyway (part 4.8). |

## 10. Questions for the maintainer

"Agreed" means the reviewer agreed with the recommendation; the review's notes are folded in.

| # | Question | Recommendation | After the review |
|---|---|---|---|
| Q1 | A new kind (`zekno.deploy.v2`) and `v: 2`, or the old kind with `v: 2`? | Both. The kind is inside the signature, so no version-1 code path can ever take a version-2 deploy; it costs nothing. | Agreed. |
| Q2 | Seal the pack over SSH too? | Yes: a changed SSH destination then gets no source, the runner's folder holds nothing opened, and one format serves both ways. Docker's storage on the server still holds the source (part 4.1 b). | Agreed. |
| Q3 | Pack and chunk limits | 512 MiB per deploy, shared by all its builds, and 8 MiB chunks. Raising the pack limit later is a new protocol number, not a new format. | Agreed. |
| Q4 | Who makes the health check's GET | A check container on the app's route network from a pinned image, reaching the runner's aliases of part 4.2. Carry out `http: null` first. | Agreed. |
| Q5 | Does a rollback run the old deploy's pre-deploy command? | No, unless the developer asks for it; and it keeps the current routes and health check the same way (V13). | Agreed. |
| Q6 | Limiting keys | To servers, for deployers only, in the team list, built with the CI feature; once a list can carry limits, no version-1 deploy (part 4.7). Not to apps. | Agreed, with V2 and V16 folded in. |
| Q7 | `expiresAt` | In the format, as `null` or a time; required on every deploy the runner takes from the hosted service, which the CLI sets one hour ahead when a person waits and CI sets from its configuration; may be `null` over SSH, and such an envelope never leaves its SSH session (V19). It does not order deploys; `previous` does (part 3.1). Also refuse an `expiresAt` more than 7 days after the runner's own clock (`expired`): it costs a refusal only on a clock days slow, and keeps a CI configured with a year from leaving T5 and T31 open for a year. It makes checks depend on the runner's clock, which changes the core spec's "No security decision depends on time", so it is yours to decide. | Changed twice: accepted only with `previous` (V1) and with the cap from `createdAt` dropped; the second pass added V19's rules and suggested the cap against the runner's clock, recommended here. |
| Q8 | When a version-2 runner accepts version 1 | Only while its team list is version 1, and only for an app it held when upgraded that has had no version-2 deploy (part 4.7). The version-1 path writes the whole version-2 state back (V21), and once a team list of the new version is signed, later lists keep it. Removed altogether in a runner release announced at least one release after the first CLI that signs version 2. | Changed: accepted with V2's two conditions, then with V21 and the team list's version kept. |
| Q9 | The runner checks statements again each time it uses a stored record | Yes, against its current team list and with every field of the listing (V7). A secret set by a removed member then stops a deploy until it is set again or removed. Today the CLI deploys without it, with a warning (part 4.5). | Agreed. The first version said the CLI "already requires" this; it does not, and the text is corrected. |
| Q10 | A build's network by default | `"default"`, since most builds download packages; `"none"`, which means no network for `RUN` steps, offered; the deploy summary shows which. | Agreed. |
| Q11 | Should the CLI keep packs for rollback past the runner's three deploys? | No. Going further back is deploying an old checkout. | Agreed. |
| Q12 | The hosted service reads more (T14) | Say so in the README's note on metadata now, including that a plaintext pack hash and a build key let a guessed pack be confirmed. Sealing the payload for the server is a later design. | Agreed. |
| Q13 | `zekno.invalid/<app>:<key>` with `pull_policy: never` | Keep it. | Answered by the review's checks on v5.3.0: no pull (D8); any image can be tagged under the name (D9), so the image id is checked and taken from `--iidfile` (D10). No longer a question, but see Q18. |
| Q14 | Kept builds per app | Three deploys, and BuildKit's cache pruned to 10 GiB after each deploy, since neither is bounded in bytes otherwise. | Agreed, with the byte bound added. |
| Q15 | Should `composeUp` run in the runner's folder? | Yes, in the next runner release. | Answered by the review: on v5.3.0, `up -f` reads nothing from the folder it starts in (D1); set the folder anyway (part 13). |
| Q16 | Which fields the first version-2 runner carries out | `previous`, `expiresAt` and secrets by version with the completeness rule first, with V20 and V21 closed (part 6, part 4.7): CI needs these three and not `builds`. Then `builds`, with the build feature, or in the first runner if that feature comes first. Then `routes` and `health` together, with the domains feature (design.md, C3), with V23 closed (part 4.2). `predeploy` last, with the rest of V4 closed: none of the next three features needs it. | New in the first pass; the second pass agreed and added the order of CI and builds. |
| Q17 | A routed container that Docker restarts gets another address, which another container can take | Largely answered: on Docker 29.6.1 a restarted container did not keep its address, and another container took it (D13); a random alias on a network the runner makes followed the current address through ten restarts (D14). The design now routes and checks by alias (part 4.2). Left: run D13 and D14 again on Linux, and choose a proxy that resolves an alias when it connects, not once at load. | Answered in large part by the second pass (V23). |
| Q18 | The oldest Docker Compose version the runner supports | Run the review's checks D1 to D14 again on it, on Linux. The runner reads `docker compose version` and refuses a version-2 deploy on an older Compose, since `--no-deps`, the one-off container's name, `pull_policy: never`, Compose's own labels and network aliases are what the design rests on. | New in the first pass; the second pass added D11 to D14 and the version check. |

## 11. What a second reading should try to break

- **The order rule (part 3.1).** Whether any deploy made before another deploy of the app was
  accepted can still run; whether a lie about the last number can do more than refuse; the loser of
  a race; the first deploy of an app; the change from version 1.
- **The version-1 path (part 4.7).** Whether a limited key, a new app name, a restored or migrated
  state, or a team list changing between versions can reopen it.
- **The two locks (part 6).** Whether any write after step 15 can still put back what `sync` or
  `pack` wrote meanwhile; whether a crash between loading the proxy's configuration and saving the
  routes can leave anything but the earlier routes; whether a version-1 deploy can lose the mark.
- **Completeness and held records (part 4.5).** A live name that cannot be listed; a statement
  that verifies but differs from the listing in any field; the first version-2 deploy of an app
  with version-1 secrets.
- **Aliases (part 4.2).** Whether anything but this app's own container can answer to an alias the
  runner gave, without controlling Docker; whether a proxy or check can still hold an old address.
- **The build key (part 4.1 b).** Whether two sides can compute different bytes, or an input that
  changes the image is missing.
- **The pre-deploy command (part 4.4).** Whether it can reach or replace anything but what already
  runs, run twice, or outlive its time limit.
- **Sizes.** The worst-case payload, request line, `records` answer and state against parts 3 and 8.

## 12. Review

### 12.1 First pass

**Who and when.** An independent reviewer that did not write this design read it on 2026-11-16,
checked every statement about today's code, and ran ten checks on Docker 29.6.1, Docker Compose
v5.3.0 and buildx 0.35 (macOS). The detail, with the checks D1 to D10, is in
[`deploy-v2-review.md`](./deploy-v2-review.md).

**Findings.** 18: 2 high, 4 medium, 7 low, 5 informational. Each is answered in the part named.

| Id | Severity | Finding | What changed | Part |
|---|---|---|---|---|
| V1 | High | A relay could bring an old deploy back after newer ones | Changed: `previous` signed and checked for equality, `sequence` exactly one above; `expiresAt` required from the hosted service; `MAX_AHEAD` and the step limit not needed for version 2; T1, T5 and T15 corrected; T31 added | 3.1, 6, 9 |
| V2 | High | A limited key could deploy anywhere through the version-1 path | Changed: version 1 only while the team list is version 1, and only for apps held when upgraded; T32 added | 4.6, 4.7 |
| V3 | Medium | The pre-deploy step replaced changed dependencies | Changed: `--no-deps`; the command reaches only what already runs, which is the old database; first deploy excepted | 4.4 |
| V4 | Medium | The pre-deploy time limit did not stop the command | Changed: a named container removed by name and waited for; refused while one still runs; builds record `--iidfile` | 4.4, 4.1 b |
| V5 | Medium | A secret could be dropped by hiding its statement | Changed: every live secret must be listed or removed; T33 added | 4.5 |
| V6 | Medium | How a route or health check finds its container was unsaid | Changed: addresses from the app's own containers on its own networks; T27 corrected; restart cost recorded (Q17) | 4.2, 4.3 |
| V7 | Low | A held record did not need its name and version to match | Changed: every field must match; records stored per app | 4.5 |
| V8 | Low | The build key's bytes were undefined and left out build secrets | Changed: bytes defined, build secrets' hashes included, key signed and checked at step 6 | 4.1 b |
| V9 | Low | A build reaches more than said | Changed: `"none"` is `RUN` steps only; unpinned frontends refused when a build names a secret; cache mounts per app. Layer reuse accepted | 4.1 b, 4.8 |
| V10 | Low | Staged chunks of deploys that never run were kept | Changed: gate needs `previous`; cleanup at every deploy and `pack`, 24 hours; one span. Fair shares accepted | 4.1 b, 4.8 |
| V11 | Low | One lock held for hours blocked `sync` and `pack` | Changed: a short state lock for `sync` and `pack`; a time limit on `up`. Per-app deploys accepted as left out | 6, 4.8 |
| V12 | Low | A refused proxy configuration blocked every app's routes | Changed: the earlier routes and configuration are put back | 4.2 |
| V13 | Low | A rollback released domains | Changed: a rollback keeps the current routes and health check unless asked | 4.2, 4.3, 4.7 |
| V14 | Informational | Domain and path patterns admitted special names | Changed: special-use names refused, A-labels must round-trip, path held to RFC 3986 | 4.2, 4.3 |
| V15 | Informational | One runner per Docker daemon was assumed | Changed: stated; the proxy is labelled and checked | 4.2 |
| V16 | Informational | A server limit on an admin means nothing | Changed: limits for deployers only; a list limiting an admin is refused | 4.6 |
| V17 | Informational | A restored runner folder reopens every deploy since | Accepted and documented; T34 | 4.8, 9 |
| V18 | Informational | Where plaintext source lands; no forward secrecy | Accepted and stated; T35 | 4.1 b, 9 |

**Premises corrected.** Where the first version said something the review showed wrong or
unverified, the text now says what was observed and on which version: dependencies under
`compose run` (D4), stopping a one-off container (D6), the order of `up` (D5), words reaching the
command (D3), `docker build -` with a tar (D10), `pull_policy: never` and tags (D8, D9), names on a
shared network (D7), the start folder (D1, D2), `createdAt` shown by the CLI, and the state naming
files for apps at version 2 only. A registry "answering for `zekno.invalid` would need a
certificate" was not checked and is gone: `pull_policy: never` makes it moot.

**Cut, as the review suggested.** The `held` read, removal statements in the request and on the
runner, and the seven-day cap on `expiresAt`. **Added from the review's list of what was missing.**
An uncompressed pack, a build command written into the pack as a Dockerfile, a byte bound on the
build cache, a time limit on `up`, a restart-count rule for `http: null`, CI pinning the server's
SSH host key, and what the domains feature still has to decide about the proxy.

### 12.2 Second pass

**Who and when.** The same independent reviewer read the revised design whole on 2026-11-16,
checked its new claims about today's code, and ran four more checks on the same machine: D11
(Compose's own labels cannot be forged by a Compose text), D12 (nor another project's name), D13 (a
restarted container's address can pass to another container) and D14 (a network alias follows the
current address through restarts). Review, part 8.

**V1 to V18, as the reviewer judged them.** Closed: V1, V3, V5, V7, V8, V9, V10, V13, V14, V15, V16.
Closed given V21: V2. Closed, accepted: V17, V18. Closed in part: V4 (the `busy` check ran only for
deploys with a pre-deploy command), V6 (stronger than said, by D11 and D12, but addresses go stale:
V23), V11 (state writes after step 15: V20) and V12 (the two writes in the wrong order). The parts
left open are closed below.

**Six new findings**: three medium, one low, two informational. With the rest of V4, V11 and V12:

| Id | Severity | Finding | What changed | Part |
|---|---|---|---|---|
| V4, rest | Medium | The `busy` check covered only deploys with a pre-deploy command | Changed: step 11 refuses every deploy of the app while a one-off container runs | 4.4, 6 |
| V12, rest | Low | Saving the routes before loading them could wedge route changes after a crash | Changed: the configuration is loaded first, the routes saved after | 4.2, 6 |
| V19 | Low | Through the relay a developer cannot learn which alternative ran | Changed: the same envelope is sent again for unchanged content; one hour by default when a person waits; an envelope with a `null` `expiresAt` never leaves its SSH session; T5 and T31 say what the relay can still do | 3.1, 5, 9 |
| V20 | Medium | State writes after step 15, and the building deploy's chunks | Changed: every write after step 15 reads the state again and changes only its own part; at step 15 the chunks move to `building/<app>/`; each step names its lock; T13 and T16 | 6, 4.1 b, 8, 9 |
| V21 | Medium | The version-1 path could erase the state's mark | Changed: it writes back the whole version-2 state with only `lastSequence` and `secrets` changed; every write keeps the mark | 4.7, 6, 9 |
| V22 | Informational | Removing an app must keep its number | Changed: a future removal keeps the last number and the version mark as a tombstone | 3.1, 4.8, 8 |
| V23 | Medium | A routed container's address can pass to another container | Changed: a network the runner makes per app, a random alias per container, a proxy that resolves when it connects; T27 rewritten; Q17 largely answered | 4.2, 4.3, 9, 10 |
| V24 | Informational | Three small corrections | Changed: no container and no volume for leaving out `--no-deps`; the CLI's real warning; `builds[].secrets` sorted and unique | 4.4, 4.5, 4.1 b, 5 |

**Notes taken from the second pass.** Once a team list is of the new version, later lists keep it
(4.6, 4.7). A restored state brings back an older team list too (T34, 4.8). A deploy already past
step 15 finishes even if a `sync` removes its signer (part 6). When a member is removed, the CLI
says which secrets that blocks and offers to set them again or remove them (4.5). Q7, Q8, Q16, Q17
and Q18 follow the reviewer's notes.

**Judgement.** The design is sound enough to build the next three features on. V20 and V21 must be
closed before the first version-2 runner is built; V23 before the domains feature ships; the rest of
V4 before the pre-deploy command is carried out. V19, V22, V24 and the rest of V12 are wording,
settled as each feature is built. All of them are now closed in this text. The text has not been
read a third time, and none of it is built.

## 13. Two findings in today's code

Noticed while this design was written, confirmed by the reviewer (review, part 7). Neither is fixed
in this feature, which changes no runner or core code (FR-029).

- **`composeUp` starts Docker Compose without a working folder.** Real: neither `Bun.spawn` in
  `composeUp` (`apps/runner/src/docker/compose.ts`) sets `cwd`, so Compose runs in the folder the
  runner was started in, whereas `dockerOutput` and `followLogs` (`apps/runner/src/docker/inspect.ts`)
  start in the runner's folder since review 004 S8. No effect on Compose v5.3.0 as checked: with
  `-f`, Compose took `.env` from the Compose file's folder and ignored a `.env` and a
  `compose.override.yaml` in the start folder (D1). Older Compose versions were not checked, and a
  `PATH` with an empty or `.` entry would find `docker` in that folder. Set the working folder to
  the runner's in the next runner release anyway: it costs one line.
- **`MAX_AHEAD` for a deployer with no history.** Real, low: in `sendDeploy`
  (`apps/cli/src/ops/deploy.ts`), a machine that has never signed for the app compares the runner's
  number with 0, so it refuses any app past its 1,000th deploy (a second machine, a fresh profile,
  CI). It fails closed and costs availability only. Fixed with the feature that brings deploys from
  CI; for version 2 the order rule of part 3.1 makes the bound unnecessary.
