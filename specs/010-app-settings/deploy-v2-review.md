# Review: the signed deploy, version 2

**Reviewed**: `specs/010-app-settings/deploy-v2.md` · **Date**: 2026-11-16 · **Kind**: independent
design review, internal, not an audit · **Branch**: `010-app-settings`

The reviewer did not write the design and read it without the author's reasoning. Nothing in the
repository was changed except this file. Zekno is pre-alpha and unaudited; this review does not
change that.

## 1. Scope and method

**Read.** The design, whole. The spec's User Story 5 and FR-032 to FR-034. The settings table in
`design.md`. The root `README.md` (threat table, design rules). The reviews of features 002, 003,
004 (S4, S8) and 006 (carried-over list).

**Checked against the code.** Every statement of part 2 and every claim about today in parts 3 to
9, against: `packages/core/src/deploy/deploy.ts` and `link.ts`, `crypto/envelope.ts`, `crypto/hash.ts`,
`crypto/sodium.ts`, `team/roster.ts`, `secrets/secrets.ts`, `secrets/secret-record.ts`,
`protocol/protocol.ts`, `protocol/limits.ts`, `protocol/result.ts`; `apps/runner/src/commands/commands.ts`,
`session/session.ts`, `docker/compose.ts`, `docker/inspect.ts`, `home/home.ts`, `main.ts`;
`apps/cli/src/ops/deploy.ts`, `ops/server.ts`, `ops/doctor.ts`, `profile/profile.ts`,
`server/session.ts`, `shared/views.ts`. Also that libsodium's streaming BLAKE2b
(`crypto_generichash_init`, `update`, `final`) exists in the `libsodium-wrappers` the core loads: it
does.

**Ran.** Docker 29.6.1, Docker Compose v5.3.0 and buildx 0.35 (Docker Desktop, macOS), with images
already present (`alpine:3`, `busybox:1.36`). Nothing was pulled, no port was published, nothing
contacted the network. Every project was named `zrv-*` in a temporary folder outside the
repository; every container, network, volume and image created was removed afterwards. Checks:

| # | Check | Result |
|---|---|---|
| D1 | What `docker compose -p P -f <file> config` reads from the folder it is started in | Nothing. A `.env` and a `compose.override.yaml` there were ignored. A `.env` beside the file was read. |
| D2 | The same without `-f` (as `ps` and `logs` run) | The start folder's `compose.yaml`, override and `.env` were all read. |
| D3 | `compose run --rm -T web echo --privileged -v /:/host --rm` | The words reached the command as text. None was read as an option. |
| D4 | `compose run` with a new file whose dependency `db` changed, while the old `db` runs | `db` was recreated with the new definition before the one-off container started. With `--no-deps` it was untouched. |
| D5 | Order of events when `up` replaces a changed service | New container created under a temporary name, old one stopped and removed, new one renamed and started. The old one stops before the new one starts. |
| D6 | Kill the `compose run` client (SIGKILL, then SIGTERM) during `sleep 40` | Both one-off containers kept running. A following `up -d --remove-orphans` left them running. |
| D7 | Another app's container joins this app's network with this app's container name as an alias | From this app's network, the name resolved to both containers. |
| D8 | `image: zekno.invalid/...` with `pull_policy: never`, image absent | "No such image" in 0.1 s. No pull. |
| D9 | `docker tag busybox zekno.invalid/...`, then `up` | The other image ran under that name. |
| D10 | `docker build -f sub/Dockerfile --network none --secret id=T,env=T --iidfile F -` with a tar on standard input (`FROM scratch`) | Built. The Dockerfile path inside the tar worked. `--iidfile` gave the image id. A link in the tar pointing to `/etc/hosts` was "not found", not the host's file. |

**Not run.** Anything that needs a registry, DNS or a `RUN` step (so no base image, no
`# syntax=`, no build secret actually read), a proxy, rootless Docker, or a Linux server. A
server's Compose may be older than v5.3.0; D1 to D9 hold for v5.3.0 only.

## 2. Findings

| Id | Severity | Finding |
|---|---|---|
| V1 | High | A relay can bring an old deploy back after newer ones, for any team with two deployers |
| V2 | High | A key limited to some servers deploys anywhere through the version-1 path |
| V3 | Medium | The pre-deploy step replaces the old version's changed dependencies (checked) |
| V4 | Medium | The pre-deploy time limit does not stop the command (checked) |
| V5 | Medium | A secret can be dropped from an unattended deploy by hiding its statement |
| V6 | Medium | How a route or health check finds its container is unsaid, and the named way can be answered by another app (checked) |
| V7 | Low | The "held record" rule does not require the name and version to match |
| V8 | Low | The build key's bytes are not defined and leave out the build's secrets |
| V9 | Low | A build reaches more than the design says: `"none"`, the `# syntax` frontend, a shared cache |
| V10 | Low | Staged chunks of deploys that will never run are kept, and "one deploy per app" is not defined |
| V11 | Low | One server-wide lock held for hours blocks `sync`, `pack` and every other app |
| V12 | Low | A proxy configuration that fails after the state is saved blocks every app's routes |
| V13 | Low | A rollback releases domains |
| V14 | Informational | The domain and health path patterns admit special names and characters |
| V15 | Informational | One runner per Docker daemon is assumed, not checked |
| V16 | Informational | A server limit on an admin means nothing |
| V17 | Informational | A restored runner folder reopens every deploy since, now with pre-deploy commands |
| V18 | Informational | Where plaintext source lands, and what a later server-key loss opens |

### V1. A relay can bring an old deploy back after newer ones (High)

**Why high.** It breaks the property T1 and T5 claim, through the attacker the product is built
against, and a pre-deploy command makes the result impossible to undo.

**Part.** 4.7 ("A deployer with no history"), part 6 step 8, T5, T15.

**Attacker.** The hosted service. It holds every message and no key.

**Steps.**
1. Developer A has signed up to number 490 for app `web`. The runner's real number is 500. A asks
   it through the service. The service answers 1,490. `sendDeploy` lets that pass: 1,490 is not
   more than 490 + `MAX_AHEAD` (1,000).
2. A signs 1,491. The service keeps it.
3. Developer B, or CI, asks and gets the truth, 500. They sign 501, 502 and so on. The service
   delivers them and the runner accepts them.
4. Days later the service delivers 1,491. It is above the last number and within 2^20, so step 8
   passes.

**Result.** A's old Compose text, builds, routes and health check replace B's newer ones. A's old
pre-deploy command runs against a database B's migrations have moved on. Only a secret whose
version changed in between stops it (`stale_secret`). `expiresAt`, when set, narrows the window to
its life. Note also that `expiresAt` is checked at step 8 and a build can then run for two hours
before the pre-deploy command starts.

**Source.** The document's own words are wrong. T5 says "Refused once a later deploy of the app
was accepted"; that holds only when "later" means "higher number", and the relay picks the
numbers. T15 names only deployers with no history. Review 003 C4 bounds how far ahead one machine
signs, not the order between two machines.

**Smallest change.** Bind each deploy to the state it was made against. Add a signed `previous`:
the app's last accepted number as the signer learned it (0 for none). The runner accepts a
version-2 deploy only when `previous` equals its `lastSequence` for the app (a new reason, number
not used). A lie about the number now only causes a refusal, and nothing signed before another
deploy was accepted can be accepted after it. The `pack` gate checks it too. This also makes
`MAX_AHEAD`, the step limit and "CI needs a number of its own" (4.7) unnecessary. What stays: two
deploys signed against the same `previous` are alternatives, and the relay picks one; `expiresAt`
bounds how long the older can wait, so make it required on every deploy through the service.

### V2. A key limited to some servers deploys anywhere through the version-1 path (High)

**Why high.** It lets a key limited to staging take root on production, and that limit is the
design's whole answer to a stolen CI key (T23, T24).

**Part.** 4.6, 4.7, part 6 (last two paragraphs), Q8.

**Attacker.** A member whose key is limited to some servers, for example CI's key limited to
staging, or that key stolen. Holds the key, the current team list and a way to the runner.

**Steps.**
1. Sign an envelope of kind `zekno.deploy.v1` for a new app name, `serverId` of production, the
   current `teamHash`, number 1, with a Compose text that mounts the Docker socket.
2. Send it with `apply`. Part 6 says a version-2 runner runs it "exactly as today", plus one check
   that the app is not at version 2. A new app never is.
3. `verifyDeploy` checks the role (`deployer` is in `DEPLOY_ROLES`), team, team list hash, server
   and that the server is listed. It has no notion of a server limit.

**Result.** Accepted. Root on production. The same path takes sealed values without statements, so
the runner-side half of T24 does not exist for version 1 either.

**Source.** The document's words (part 6) and what it leaves unsaid (4.6 does not name the
version-1 path).

**Smallest change.** Once the runner holds a team list of the version that can carry limits,
refuse every version-1 deploy. If that is too early, refuse a version-1 signer not allowed on this
server (`not_allowed_here`) in `verifyDeploy`. Either way, accept version 1 only for apps the
runner already held when it was upgraded, never for a new app.

### V3. The pre-deploy step replaces the old version's changed dependencies (Medium)

**Why medium.** The promise that the old version keeps serving, during and after a failed
pre-deploy command, is false whenever a dependency changed, and a database is the usual
dependency.

**Part.** 4.4 ("Where it runs", "When it fails"), part 6 step 16, Q13.

**Attacker.** None needed. The settings author decides what changes.

**Steps (D4).** Project with `db` and `web` (`depends_on: [db]`), up with the old file. The new
file changes `db`. `docker compose -p P -f new run --rm -T web true` printed `Container P-db-1
Recreate`, `Started`, and only then created the one-off container.

**Result.** Before the command runs, the new version's dependencies replace the old version's (a
new image, new settings). The old `web` keeps running against them. If the command fails, the
outcome is `predeploy_failed` and "the old version keeps running", but on the new dependency. A
database moved to a new major version just before a failed migration is the bad case.

**Source.** The document's words: "a dependency already running from the old version is not
replaced by this step". It does say this is to be checked.

**Smallest change.** Run `docker compose run --rm -T --no-deps` (D4: `db` untouched). Say the
command reaches only what already runs. On an app's first deploy, when nothing of the project
runs, starting dependencies harms nothing and can be allowed.

### V4. The pre-deploy time limit does not stop the command (Medium)

**Why medium.** A migration that hits its limit keeps running after the runner says it failed and
releases the lock, so two migrations can run at once.

**Part.** 4.4 ("Time"), 4.1 b ("Time"), part 6 steps 15 and 16.

**Attacker.** None needed: a slow migration, or a runner that dies mid-command.

**Steps (D6).** Killing the `compose run` client, with SIGKILL or SIGTERM, left the one-off
container running. A following `up -d --remove-orphans` did not remove it.

**Result.** The runner answers `predeploy_failed` and releases the lock. The next deploy's
pre-deploy command runs beside the first. The lock's liveness is the runner's process id
(`acquireLock` in home.ts), so the same follows when the runner dies.

**Source.** Unsaid. "The runner stops and removes the container after timeout" does not say how
it finds it.

**Smallest change.** Name it: `--name zekno-<app>-predeploy-<sequence>`. On time out,
`docker rm -f` that name and wait until it is gone before answering. Before any pre-deploy
command, refuse (`busy`) while a one-off container of `zekno-<app>` exists (label
`com.docker.compose.oneoff=True`). For builds, say how one is cancelled (BuildKit is documented to
stop a build whose client goes; not checked) and record the image from `--iidfile` (D10).

### V5. A secret can be dropped from an unattended deploy by hiding its statement (Medium)

**Why medium.** CI deploys with nobody watching, and some apps take a missing secret as "use an
insecure default".

**Part.** 4.5 ("How a deployer learns what the runner holds").

**Attacker.** The hosted service, once CI reads through it; over SSH, a lying runner.

**Steps.** CI asks `records` for app `web`. The answer leaves out the statement of
`SESSION_SECRET`. CI lists the rest and signs. The runner checks only what is listed; a deploy may
leave a name out, as in version 1.

**Result.** Accepted. The app starts without `SESSION_SECRET`; Compose fills an unset variable with
an empty string. T8 covers hiding a newer statement, not hiding all of them.

**Source.** Unsaid.

**Smallest change.** The runner now knows every live `app/NAME`, so require completeness: a
version-2 deploy must list every name the runner holds a live version of, in `secrets` or
`removed`, or it is refused (`secrets_mismatch`, number not used). Leaving a secret out becomes a
signed removal. A secret set by a removed member must then be set again or removed, which the CLI
already asks for.

### V6. How a route or health check finds its container is unsaid (Medium)

**Why medium.** The domains feature cannot be built from the design as written, and the one way it
names sends a domain's decrypted traffic to whichever app asks for it.

**Part.** 4.2 ("built, never pasted"), 4.3 ("Who makes the GET"), T27.

**Attacker.** A member who deploys another app on the same server. Also no attacker at all.

**Steps (D7).** App B's service `web` runs as `zrv-b-web-1`. App A's Compose text joins B's
network as an external network with the aliases `zrv-b-web-1` and `web`. From a container on B's
network, `zrv-b-web-1` resolved to both B's and A's addresses.

**Result.** A proxy that reaches B "by a name that is unique on the server" sends part of B's
traffic, after TLS, to A. T27 says "Stopped". Apart from that, the design does not say which
network the proxy and the check container join, or how a container is found when the service uses
`network_mode: host`, only named networks, a fixed `container_name`, or several copies. The runner
does not read the Compose text, so it has to ask Docker, and the design does not say how.

**Source.** Unsaid, and T27's wording.

**Smallest change.** State the rule: the runner lists the service's containers with
`docker compose -p zekno-<app> ps -q <service>`, inspects each, keeps only addresses on networks
labelled `com.docker.compose.project=zekno-<app>`, and gives those IP addresses to the proxy and the
check, fresh at every start. No such address: the route is not applied and the outcome is
`start_failed`. The health URL is built as `http://<address>:<port>` followed by the path. Change
T27 to "accidents only; another app's deployer is root anyway (part 2.6)".

### V7. The "held record" rule does not require the name and version to match (Low)

**Why low.** Only a signer can trigger it, but it leaves the state and the stored files
disagreeing, which then blocks every CI deploy of the app.

**Part.** 4.5 ("Held"), part 8.

**Steps.** The runner holds `web/API_KEY` at version 3, hash H. A deploy lists `API_KEY` at version
4 with hash H and supplies nothing. "Held" asks only for a record under H whose statement verifies.
The version rule passes (4 is higher). The state now says version 4. CI later reads the statement,
which says 3, and signs 3: `stale_secret`, every time. Listing another name with a held hash is
similar: the stored sealed name decides which variable is filled, the listed name goes in the
state.

**Source.** Unsaid. "Supplied" spells out every field; "Held" does not.

**Smallest change.** A held record counts only when its statement's team, server, app, name,
version and hash all equal the listing, as for a supplied one. Store records per app
(`records/<app>/<hash>.json`) so one app's file is never found for another.

### V8. The build key's bytes are not defined (Low)

**Why low.** A key that misses an input reuses the wrong image, and a key computed two ways
burns a number.

**Part.** 4.1 b ("The Compose text names the image of a build").

**Points.**
- "JSON of [...]" with `args` as objects leaves key order and escaping to each side. If the runner
  computes K' where the Compose text names K, `pull_policy: never` makes `up` fail: `start_failed`,
  number used.
- The build's secrets are in the key by name only. After a leaked `NPM_TOKEN` is replaced, the same
  recipe reuses the image built with the old one, and any layer that kept it.

**Smallest change.** Define the bytes (arrays only, a fixed order, `args` as `[name, value]`
pairs). Put the hash of each build secret (from `secrets[]`) in it. Add the key to the build entry
as a signed field, and refuse at step 6 (`malformed`) when it differs from the runner's own
computation, so a mismatch costs no number.

### V9. A build reaches more than the design says (Low)

**Why low.** Each point needs a registry's cooperation or a hostile Dockerfile a member chose to
deploy, but the document tells developers less than is true.

**Part.** 4.1 b ("What a build may reach"), T19, T22, Q10.

**Points.**
- BuildKit fetches base images, the frontend named by a `# syntax=` line, and `ADD <url>` or
  `ADD <git>` sources itself, outside the network of `RUN` steps. `"none"` limits `RUN` steps only
  (Docker's documentation, not checked).
- The frontend is code chosen by a registry tag. It builds every step and is handed the build's
  secret mounts. Whoever answers for that registry reaches the build's secrets, which T22 does not
  say.
- BuildKit's cache, including `RUN --mount=type=cache`, is shared by every app's builds on the
  server. One app's Dockerfile can write what another app's build later reads. Layer cache keys
  leave secret contents out, so a layer built with one app's secret mount can be reused by another
  app's identical step.

**Smallest change.** Say `"none"` means "no network for `RUN` steps". The CLI, which reads the
Dockerfile when it packs, warns on or refuses a `# syntax=` line without a digest and `ADD` of a
URL. The runner passes `--build-arg BUILDKIT_CACHE_MOUNT_NS=zekno-<app>` (a documented BuildKit
argument, not checked; `BUILDKIT_*` names are already reserved, so a deploy cannot set it), or keeps
one builder per app.

### V10. Staged chunks of deploys that will never run are kept (Low)

**Why low.** It denies uploads only, which a relay can do anyway by withholding.

**Part.** 4.1 b ("Runner keeps"), part 6 ("For `pack`").

**Points.**
- Chunks are deleted when their deploy has run, or when a newer upload for the app names others. A
  deploy refused for good (`domain_taken`, `untrusted_secret`, `expired`) or overtaken by a higher
  number never runs, so its chunks stay.
- "One deploy per app" does not say which. A relay holding two unused deploys of an app can
  upload them in turn, so each deletes the other's chunks.
- Unused genuine deploys of four apps fill the 2 GiB, and every other app's `pack` is refused.
- "The lock is taken only to read the state and to write the chunk" reads as two spans. A deploy
  accepted between them leaves a chunk for a used number.

**Smallest change.** Per app, stage only for the highest-numbered unused deploy and refuse `pack`
for a lower one. At every accepted deploy and every `pack`, delete chunks of deploys whose number
is used or whose `expiresAt` has passed. Give each app a share of the 2 GiB. Hold the lock across
the gate and the write. With V1, also refuse `pack` when `previous` is not the app's last number.

### V11. One server-wide lock held for hours (Low)

**Why low.** It costs availability, and it slows the answer to a stolen key.

**Part.** 4.1 b, 4.3, 4.4 ("The lock is held meanwhile"), part 6 step 2.

**Points.** The lock is held across a build (up to 7,200 s), a pre-deploy command (3,600 s), `up`
(no limit: `composeUp` has none today) and the health check (1,800 s). Meanwhile every other app's
deploy, every `pack` and every `sync` is refused `busy`, with no queue. An admin's `sync` that
removes a stolen key cannot land while that key's long deploy holds the lock.

**Smallest change.** Let `sync` take a short lock that covers only `state.json`. Give `up` a time
limit. If the long lock is ever split per app, the domain check (step 9) and the route change
(step 17) need a reservation saved with the state at step 14.

### V12. A proxy configuration that fails after the state is saved (Low)

**Why low.** One app's route the proxy will not load blocks route changes for every app until that
app is deployed again.

**Part.** 4.2 ("When routes change"), part 6 step 17.

**Points.** The routes are saved, then the whole configuration is written from every app's routes.
If the proxy refuses it, the outcome is `start_failed`, but the routes stay in the state, and every
later configuration includes them.

**Smallest change.** Before step 14, build the configuration as it would be and have the proxy
check it without loading it; refuse with no number used. If loading still fails at step 17, put the
earlier routes back in the state.

### V13. A rollback releases domains (Low)

**Why low.** A rollback taken for a code problem takes the site off the proxy and frees its
domains for any other app's next deploy.

**Part.** 4.2 ("Rollback"), 4.7 ("Rollback across the change").

**Smallest change.** A rollback keeps the current routes and health check unless the developer
asks, as Q5 already does for the pre-deploy command. A rollback to a version-1 entry then keeps
them too, instead of releasing every domain.

### V14. The domain and path patterns admit special names (Informational)

The domain rule admits special-use names (`.invalid`, `.test`, `.example`, `.local`, `.internal`,
`.alt`, `.onion`), including `zekno.invalid`, the name kept builds use. It also admits `xn--`
labels that are not valid A-labels, so two texts could name what a browser shows as one domain.
The health path admits a space and `#`. Refuse the special-use names, accept an `xn--` label only
when it round-trips, and hold the path to RFC 3986 path and query characters.

### V15. One runner per Docker daemon is assumed (Informational)

`defaultHome` (home.ts) lets a root runner and a user runner live on one machine. With one
rootful Docker, they share Compose project names (`zekno-<app>`), the tags
`zekno.invalid/<app>:<key>`, and ports 80 and 443. Version 2 adds a proxy and a domain table per
runner on a shared daemon. The project-name clash exists today. Say "one runner per Docker
daemon", and have the runner refuse to start its proxy when a proxy labelled with another server id
runs.

### V16. A server limit on an admin means nothing (Informational)

An admin signs team lists, so a limited admin can sign one without the limit. Say limits apply to
deployers, and refuse a list that limits an admin.

### V17. A restored runner folder reopens every deploy since (Informational)

As in version 1, a `state.json` restored from a backup lowers each app's number, so the relay can
deliver every deploy since, in order. Version 2 adds pre-deploy commands that run again, domains
that move back, and apps that return to "never at version 2" (version 1 accepted again). Nothing
cheap closes it; document it.

### V18. Where plaintext source lands (Informational)

The runner's folder holds only sealed chunks, as Q2 says, but BuildKit keeps the opened context in
Docker's storage and the image keeps the source. Packs and secrets are sealed to one long-lived
server key, so a relay that stores every sealed chunk can read all past source if that key is
ever lost. Say both in 4.1 b.

## 3. Wrong or unverified premises

| Where | Statement | What the code or a check shows |
|---|---|---|
| T5, 4.7 | A withheld deploy is "refused once a later deploy of the app was accepted"; only deployers with no history are exposed (T15) | Wrong. The relay chooses the numbers deployers see; see V1. |
| 4.4 | "A dependency already running from the old version is not replaced by this step" | Wrong on Compose v5.3.0 (D4). `--no-deps` keeps it (D4). |
| 4.4 | "The runner stops and removes the container after timeout" | Stopping the client is not enough (D6). Needs a name and `docker rm -f`. |
| 4.3 | `up` stops the old container before it starts the new one | Confirmed on v5.3.0 (D5): the new one is created first, but started only after the old one is stopped and removed. |
| 4.4 | Words cannot reach Compose as options | Confirmed on v5.3.0 (D3). |
| 4.1 b | `docker build -` takes a tar on standard input | Confirmed, with `-f` inside the pack, `--network none`, `--secret id=X,env=X` and `--iidfile` (D10). A link out of the pack does not reach the host's file (D10). |
| 4.1 b, Q13 | `pull_policy: never` keeps `zekno.invalid` from being pulled | Confirmed: fails at once, no pull (D8). Any image can be tagged under the name (D9), so the id check is needed. |
| 4.1 b | A registry answering for `zekno.invalid` "would need a certificate" | Not checked (it would need DNS). Docker treats a registry on a loopback address as plain HTTP without configuration. Moot while `pull_policy: never` is always written. |
| 4.1 a | Docker refuses content with another digest | Not checked (needs a registry). Docker's documented behaviour. |
| 4.1 b | `"none"` is no network | Per BuildKit's documentation it covers `RUN` steps only; see V9. Not checked. |
| T27 | "Stopped, by design" | Another app can answer to this app's container name on this app's network (D7). |
| 2.8, Q15 | What `up -f` reads from the start folder is not known | On v5.3.0, nothing (D1). Without `-f`, the start folder decides (D2), which is S8's reason for `ps` and `logs`. |
| 2.1 | `createdAt` is "read by nobody" | It is shown in the CLI's history view (`deployRow` in `apps/cli/src/shared/views.ts`). No decision rests on it, so the point stands. |
| 4.5 | "The state never names a missing file"; version-1 deploys "store nothing" | A version-1 deploy still writes a version and hash into the state with no file. The rule holds for apps at version 2 only. |
| 2.2 to 2.5 | `verifyDeploy` and `apply` order; `composeUp` argv and environment; home paths; `sendDeploy` numbering, `MAX_AHEAD`, history of 50; `RUNNER_PROTOCOL` 2; `runnerRelation`; strict answers; the runner opens no connection itself | All match the code. |
| 3 | Streaming BLAKE2b is the same function | `crypto_generichash_init`, `update` and `final` are present in the loaded `libsodium-wrappers`. Fed `domain`, `0x00`, then the data, unkeyed, 32 bytes, it gives the one-shot result. |
| 4.6 | A team list with a limit is a new team-list version; old runners refuse it in `follow` | Matches `MemberSchema` (strict) and `parseRoster` (`hasOtherVersion`). |
| 4.7 | A version-1 runner refuses a version-2 request before any command code runs | Matches `SessionRequestSchema` (closed enum), `RunnerApplyRequestSchema` (strict) and `readEnvelope` (kind before signature). |

## 4. What holds

- **Kind and version.** The kind is inside every signature (`signingInput`), so a version-2
  signature never verifies as version 1, and `readEnvelope` refuses the kind before the signature.
  Every pairing of kind and `v` lands on a refusal. The version-2 verifier must not reuse
  `hasOtherVersion`, which refuses any `v` but 1; the design's separate verifier covers this.
- **Old runners.** A version-1 runner refuses `deploy` (closed command list) and a version-2
  envelope through `apply` (strict schema, then the kind). A version-1 runner reading a version-2
  state fails closed (strict `RunnerStateSchema`).
- **Wrong server, app or team.** All three are signed and checked as in version 1. Chunks and
  records are sealed for one server's key; another server cannot open them, and that is found at
  step 11 or 13, before the number is used.
- **Chunks.** The ordered list of sealed-chunk hashes is signed. Opening a sealed box is
  deterministic for given bytes, so the list alone fixes the pack's bytes: a swapped, repeated,
  dropped, reordered or truncated chunk is found, and the second opening at step 15 reads what the
  first read. The plaintext `pack.hash` is not needed for that; it is needed as the stable input of
  the build key, and checking it keeps a kept image from being reused for other source.
- **The `pack` gate.** It needs a signed, unused, unexpired deploy for this team list and server,
  from a member allowed there, naming the chunk. Staging holds only sealed bytes. A used, foreign,
  expired or malformed deploy cannot open it.
- **Hash domains.** `zekno/v1/pack`, `zekno/v1/pack-chunk` and `zekno/v1/build` differ from each
  other and from the six existing labels. None contains a zero byte, so `domain || 0x00 || data`
  stays prefix-free although `zekno/v1/pack` is a prefix of `zekno/v1/pack-chunk`. A sealed chunk's
  hash cannot pass as a sealed secret's (`zekno/v1/secret`). No new primitive is used.
- **Number before effect.** The state is saved at step 14, before any build, command, route or
  start. A pre-deploy command cannot run twice for one deploy. Every refusal before step 14 costs no
  number.
- **Domains between two apps.** Claim and release are checked and applied under one lock; a claim
  delivered before its release is refused with no number used; the proxy's configuration comes
  only from the runner's state and patterned fields. A domain's text, as restricted, is one
  spelling per domain (V14 aside).
- **Supplied secret records.** Checked as `verifySecret` does, with version and hash equal to the
  listing, and a supplied record the deploy does not list is refused. A deployer that takes
  versions only from statements it verified cannot be made to sign a value no member set.
- **The health GET.** Its target is a container the runner finds, never an address the deploy or
  the relay names (given V6's rule).
- **Pre-deploy words.** They reach the command, not Compose (D3).
- **Records on disk.** Written and synced before the state that names them, deleted after; only
  sealed or signed bytes.

## 5. Too much, and too little

**Could be left out of version 2's first build** (the format keeps the fields, the runner refuses
them with `unsupported_version` until carried out):

- `predeploy`. None of the three next features (building from source, domains with HTTPS, deploys
  from CI) needs it, and it carries V3 and V4.
- `health.http`, until Q4 is settled, as the design already suggests.
- `removals` in the `deploy` request and `removals/<app>.json`. With V5's completeness rule, CI
  needs only the live statements; stored removal statements serve no reader.
- `held`. A convenience for resuming uploads; `pack_missing` already says what is missing.
- `builds[].network: "none"`, unless it is described as it is (V9).
- The 7-day cap on `expiresAt` counted from `createdAt`, which nobody checks against a clock. Cap
  `expiresAt` against the runner's own clock, or drop the cap.

**Missing, and needed by the next features:**

- V1's `previous` (CI with no history), V5's completeness rule, V6's address rule.
- The proxy's life: who starts it and updates it, what happens when a runner release changes its
  digest, how it binds 80 and 443 under rootless Docker (a sysctl or a capability), redirecting
  HTTP to HTTPS, the ACME account and contact, and what happens to the certificates and keys of a
  released domain.
- A bound on disk: BuildKit's cache and kept images grow without one. A builder garbage-collection
  setting, or a prune after each deploy, keeps the server from filling.
- A time limit on `up` and on the deploy as a whole (V11).
- `design.md` gives `source.build` a "build command". The `builds` entry has no place for one.
  Either the CLI writes a Dockerfile into the pack, or the format needs a field now.
- The pack's format: say uncompressed, or one fixed compressor. Gzip output differs between
  implementations, which breaks "the same files give the same hash" across machines, and a
  compressed pack can unpack to far more than 512 MiB in Docker's storage.
- For CI over SSH: the server's SSH host key pinned in CI, since over SSH the server's identity
  rests on that check (review 003).
- `http: null` counts a container as done when it is "running". A container in a restart loop can
  be running at that moment. Ask for it to stay running, with an unchanged restart count, for a few
  seconds.

## 6. The open questions

| # | Agree? | Note |
|---|---|---|
| Q1 | Yes | Both: the kind keeps version-1 code away, `v` keeps a payload self-describing. |
| Q2 | Yes | Sealing keeps source from a changed SSH destination. Say that the server's disk still holds plaintext in Docker's storage (V18). |
| Q3 | Yes | 512 MiB and 8 MiB are fine. Say that "64 distinct chunks per deploy" means all builds of one deploy share 512 MiB. |
| Q4 | Yes | The check container, with the address rule of V6. Shipping `http: null` first is right. |
| Q5 | Yes | And keep the current routes on a rollback the same way (V13). |
| Q6 | Yes | Servers, not apps. Enforce it on the version-1 path (V2) and only on deployers (V16). |
| Q7 | In part | Keep `expiresAt`, required on every deploy through the service and from CI. It does not fix ordering on its own; add `previous` (V1). |
| Q8 | With a change | Never accept version 1 for an app the runner did not already hold when upgraded, and refuse version 1 once the team list can carry limits (V2). |
| Q9 | Yes | Re-check stored statements each time, with every field of the listing (V7). |
| Q10 | Yes | `"default"`, with `"none"` described as "no network for `RUN` steps" (V9). |
| Q11 | Yes | Going further back is deploying an old checkout. |
| Q12 | Yes | Add that the plaintext pack hash and the build key let a guessed pack be confirmed. |
| Q13 | Yes | Checked: `pull_policy: never` fails fast with no pull (D8); any image can be tagged under the name (D9), so keep the id check and take the id from `--iidfile` (D10). `compose run` needs `--no-deps` (V3). |
| Q14 | Yes | Three deploys, plus a bound in bytes or a prune (section 5). |
| Q15 | Yes | Compose v5.3.0 reads nothing from the start folder when `-f` is given (D1), but setting it costs one line, covers older Compose versions, and keeps a `PATH` entry such as `.` from finding a `docker` in an untrusted folder. |

## 7. Two things in today's code

**`composeUp` started without a working folder.** Real: neither `Bun.spawn` in
`apps/runner/src/docker/compose.ts` sets `cwd`. On Compose v5.3.0 it has no effect: with `-f`,
Compose took `.env` from the Compose file's folder and ignored a `.env` and a
`compose.override.yaml` in the folder it started in (D1). Informational today; older Compose
versions were not checked, and a `PATH` with an empty or `.` entry would resolve `docker` in that
folder (the runner already trusts its environment, review 003 R5). Smallest fix: pass `cwd` set to
the runner's folder, as `dockerOutput` and `followLogs` do.

**`MAX_AHEAD` for a deployer with no history.** Real: in `sendDeploy`
(`apps/cli/src/ops/deploy.ts`), `signed` is 0 without history, so `accepted > signed + MAX_AHEAD`
refuses any app the runner accepted more than 1,000 deploys of, from a second machine, a fresh
profile or CI. Low: it fails closed and costs availability only. Smallest fix today: apply the
bound only when this machine has signed for the app (`signed > 0`); without history there is no
baseline to compare with, and over SSH the number comes from the server SSH checked. With V1's
`previous`, the bound is not needed at all.

## 8. Second pass: the revised design

### 8.1 Scope and method

**Read.** The revised `deploy-v2.md` whole (1,350 lines), and `git diff HEAD` against the draft the
first pass read. The parts above are left as they were.

**Checked against the code.** The revision's new claims about today: `createdAt` is read by
`appsOf` and `deployRow` (`apps/cli/src/shared/views.ts`): true. `verifyDeploy` does not check a
name the deploy leaves out: true. `apply` holds the lock to the end, and `composeUp` has no time
limit: true. `status` reports each removed name and its version (`RunnerStatusSchema`): true.
`currentSecrets` leaves out a record whose signer was removed and `sendDeploy` warns and deploys
without it: true, but the line it prints is "Left out a record: unknown_signer.", with no name,
because `currentSecrets` records no name for a record it could not verify (secret-record.ts), not
"Left out a record for …" as part 4.5 quotes. No file in `packages/` or `apps/runner/` changed.

**Ran.** Same machine, same limits as D1 to D10 (local `busybox:1.36` only, nothing pulled, no
port, no network; everything removed after).

| # | Check | Result |
|---|---|---|
| D11 | A Compose text sets `com.docker.compose.project: zrv-b`, `service: web` and `oneoff: "False"` on its own service, and project labels on a network it names `zrv-b_fake`; it is started with `-p zrv-a` | Compose v5.3.0 wrote its own labels over them: container and network say project `zrv-a`. `docker compose -p zrv-b ps -q web` listed only B's real container. |
| D12 | A Compose text with top-level `name: zrv-b`, started with `-p zrv-a` | The project is `zrv-a`. |
| D13 | A container with a restart policy on a user-defined network exits every 3 s; other containers join the network while it is down | While it restarts it holds no address. A container that started meanwhile got its old address (172.22.0.2); it came back as 172.22.0.4. |
| D14 | `docker network connect --alias <random name>` to a second network, then ten restarts by the restart policy | The alias stayed and resolved to the container's current address from another container on that network. A connect made while the container was restarting returned "network sandbox ... not found", yet the alias was in place afterwards: check, and retry. |

### 8.2 V1 to V18

| Id | Now | Why |
|---|---|---|
| V1 | Closed | `previous` equal to the runner's last number, and `sequence` one above it, makes a relayed lie refuse rather than reorder. What remains, alternatives, is V19. |
| V2 | Closed, given V21 | No version 1 once the team list can carry limits, and none for an app the runner did not hold at the upgrade. The rule depends on the state keeping its mark (V21). |
| V3 | Closed | `--no-deps` on every deploy but when no container of the project exists. One edge in V24. |
| V4 | Closed in part | Named container, `docker rm -f` at the limit, `busy` while one runs. The `busy` check (step 11) is made only for a deploy that has a pre-deploy command; a deploy without one runs `up` beside a migration left running. Make step 11 apply to every deploy of the app. |
| V5 | Closed | Completeness: a hidden statement now makes the deploy refused, not quietly weaker. A relay gains only a refusal, which it had by withholding. |
| V6 | Closed in part | A Compose text alone cannot forge Compose's labels (D11) or take another project's name (D12), so the rule is stronger than the revision claims. But addresses go stale and can be taken by another container (D13): V23. |
| V7 | Closed | Every field must match; records stored per app. |
| V8 | Closed | Bytes defined with arrays, strings and `null` only; build secrets' hashes in; signed key checked at step 6. `builds[].secrets` is not said to be sorted, so two signers can make two keys for one build: a cache miss only (V24). |
| V9 | Closed | `"none"` described as it is; unpinned frontend refused when a build names a secret; cache mounts per app; layer reuse accepted in 4.8. |
| V10 | Closed | The gate needs `previous`; cleanup at every deploy and `pack`; 24 hours; one span. But the cleanup rule now deletes the chunks of the deploy that is building: V20. |
| V11 | Closed in part | `sync` and `pack` take only the short lock; `up` has a limit. State writes after step 15 are not all placed under the short lock with a fresh read: V20. |
| V12 | Closed in part | The earlier routes are put back. The two writes (save routes, then load; on failure save again) leave the wedge if the runner dies between them. Load first, then save: a crash then leaves the old routes in the state, and the next configuration, built from the state, heals it. |
| V13 | Closed | A rollback keeps the current routes and health check unless asked. |
| V14 | Closed | Special-use names refused, A-labels round-trip, the path held to RFC 3986. |
| V15 | Closed | Stated, and the proxy is labelled with the server id and checked. |
| V16 | Closed | Limits for deployers only. |
| V17 | Closed (accepted) | T34. Add to it that a restored state also restores an older team list: keys removed since come back, and limits set since vanish. |
| V18 | Closed (accepted) | T35, and part 4.1 b. |

### 8.3 The two high findings, tried again

**V1.**

- *A relayed lie about the number.* Lower than the truth: `replayed`. Higher: `sequence_jump`.
  Nothing used. Holds.
- *A deploy signed before another was accepted.* Its `previous` is then below the runner's number:
  `replayed`, for good. Holds for any number of deployers, with or without history.
- *Two alternatives against one `previous`.* Exactly one can run; the other is dead the moment one
  is accepted. The relay chooses, and can wait until the chosen one's `expiresAt`, provided it
  withholds every other deploy of the app meanwhile (those carry the same `previous`, so they are
  alternatives too). The worst is that choice, plus a lie about which one ran: see V19.
- *A deploy held until just before `expiresAt`, nothing accepted in between.* It runs; the build can
  add two hours before its pre-deploy command. Stated (part 3.1, T5). Holds as stated.
- *A rollback.* A new deploy with `previous` the current number. Holds.
- *The first deploy of an app.* `previous` 0 is refused once the app exists. Holds. An app removed
  and created again: no removal exists yet; when it comes, it must keep the app's last number (V22).
- *Version 1, then version 2.* Version 1 keeps "above the last, within the step", over SSH only,
  for apps still marked version 1; the first version-2 deploy names whatever number is last; then
  version 1 is refused for the app. Holds, given V21.
- *A restored state.* Accepted (T34).
- *The clock.* Order never depends on it. A clock set back accepts a deploy that is late but still
  next; set forward, it refuses. Staging's 24 hours also follow the clock: denial only. Nothing out
  of order is accepted because of a wrong clock.

**V2.**

- *A runner set up fresh on version 2.* It holds no app, so nothing is marked version 1, and every
  version-1 deploy is refused. Holds, if setup writes a marked state; if it writes an unmarked one,
  the first read marks no app anyway, since it holds none.
- *The moment of upgrade.* An app the old runner accepted before the binary was replaced is held,
  and is marked version 1 at the first read. That is right. A read without a write (`status`) marks
  nothing on disk; the first write must. Holds, given V21.
- *A team list going back.* A team list can only move forward (`applyRosterUpdate`). Whether a later
  list may be written in the old format after every limit is removed is not said. If it may, the
  version-1 path reopens while no limit exists, which is harmless; but say that once a list of the
  new version is signed, later lists keep it, so the rule never depends on that.
- *An app name freed and reused.* There is no freeing yet. A future removal must not drop the app
  from the state (V22); a name the runner never held stays version 2 only. Holds.
- *A limited key that withholds the team list from the runner.* Over SSH the signer chooses the
  team lists sent with `apply`. A runner that never got the list that limits the key does not know
  the limit: that is T13, for version 2 as much as version 1. Not a gap of this rule.
- *A restored state.* A state from before the upgrade is unmarked, so its apps are marked version 1
  again, and its team list may be an older one without limits or without a removal. The version-1
  path then reopens for keys the newer list limited. T34 says restoring is not supported; add this
  consequence to it.
- *The version-1 path itself.* "`apply` as today" cannot run on a version-2 state, and if adapted
  naively it erases the mark: V21. This is the place the author was least sure of, and it is the
  one real gap left in V2.

### 8.4 What the revision added

**The two locks.** The order is safe for deadlock (deploy lock then state lock; `sync` and `pack`
take only the state lock). Steps 2 to 15 read and write under one span, so no state is written from
a stale read there. Step 18 reads again and changes only the routes, as the core review asks. Two
places are not covered: kept-build records and pruning after step 15, and the staging cleanup a
concurrent `pack` runs (V20). A deploy that passed step 15 goes on even if a `sync` then removes
its signer: it was accepted under the list it was checked against, as if the `sync` had come a
moment later. Say so, so an admin removing a stolen key knows a deploy already past step 15
finishes.

**Completeness, and the behaviour change.** Refusing is right. A secret set by a removed member is
the one a team should look at, and silence was V5. It costs availability at the worst moment:
removing a member blocks every app with a secret they set, on every server, until someone re-sets
or removes it. The CLI should say, when a member is removed, which secrets that will block, and
offer to re-set or remove them in one step. A relay cannot use the rule to block more than it
already could: it cannot make a valid statement fail, and hiding one was already a denial.

**Finding containers.** Stronger than the revision says: a Compose text alone cannot forge Compose's
labels or take another project's name (D11, D12), so only an app that controls Docker can stand
among this app's containers or networks. Weaker than it says on time: an address goes stale when
Docker restarts the container, and can then belong to another container (D13): V23.

**The named pre-deploy container.** Correct for the time limit and for a dead runner, except that
step 11 runs only for deploys that have a pre-deploy command (table, V4).

**The build key.** Correct; see V8 in the table for the order of `builds[].secrets`.

**`--no-deps` on every deploy but an app's first.** Correct, and it now says what the command
reaches: the old version's running containers. One edge in V24.

### 8.5 New findings

**V19. Through the relay, a developer cannot learn which alternative ran (Low).**

*Why low.* Both alternatives were signed as the next deploy; the harm is one alternative's
pre-deploy effects instead of the other's, and a false report.

*Part.* 3.1 ("Two honest deployers at once", "Alternatives"), T31, 4.7 ("History").

*Steps.* A developer deploys through the hosted service. The relay withholds it and answers
nothing. The developer deploys again; the relay still reports the old number, so the second deploy
carries the same `previous`. The relay delivers the first, and reports that the second started.
The CLI's history marks the second `started`.

*Result.* The superseded content runs, its pre-deploy command with it, and the team believes the
newer one did. Over SSH, T31's "the CLI tells its developer when theirs lost" holds; through the
relay it does not, since `status` and reports are unsigned. Separately, `expiresAt` may be `null`
over SSH because no relay holds the deploy; that stays true only while no copy of such an envelope
reaches anyone who can start the runner later.

*Smallest change.* When a deploy's answer never came and the content is unchanged, the CLI sends
the same envelope again instead of signing an alternative. Say in T31 that through the hosted
service the CLI cannot tell which alternative ran. Use a short default `expiresAt` for a deploy a
person is waiting for (an hour), and let CI choose its own. Never send an envelope with a `null`
`expiresAt` anywhere but the SSH session it was signed for.

**V20. State writes after step 15, and the building deploy's own chunks (Medium).**

*Why medium.* Written as the text stands, one path puts back a team list a `sync` replaced, which
can bring a removed key back; another makes a build fail after its number is used.

*Part.* Part 6 (the two locks, steps 15, 16, 18 and 20), 4.1 b ("Staging").

*Steps.*
1. A deploy saves the state at step 15 and releases the state lock. An admin's `sync` removes a
   stolen key and saves. The build ends at step 16, which "records the image id". Kept builds live
   in `state.json`. The text places only step 18 under the state lock with a fresh read, and says
   step 18 "changes only the routes". A runner that writes the kept build from the state it read at
   step 2 writes back the old team list: the removed key is a member again.
2. A deploy is accepted at step 15; its build streams its chunks from `packs/<app>/` at step 16. A
   `pack` arrives for the next deploy of the app (its `previous` is now this deploy's number, so it
   passes the gate). `pack` runs the cleanup of part 4.1 b, which deletes chunks of deploys whose
   `previous` is no longer the app's last number: that is this deploy's. The build cannot read the
   rest: `build_failed`, number used. An honest CLI sends `deploy` first and gets `busy`, so this
   needs a relay or a client that uploads early, which "`pack` does not wait" invites.

*Smallest change.* One sentence in part 6: every state write after step 15 (kept builds at step
16, routes at step 18, pruning at step 20) takes the state lock, reads the state again and changes
only its own part. At step 15, under the state lock, move the deploy's chunks out of `packs/<app>/`
into a folder of their own for the build, so cleanup never sees them; delete that folder after step
16.

**V21. The version-1 path on a version-2 runner can erase the state's mark (Medium).**

*Why medium.* Every version-1 deploy during the change would drop the domain table and the version
marks, which reopens version 1 for apps at version 2 and lets any app claim any domain.

*Part.* 4.7 ("The state file"), part 6 (last paragraphs: "then `apply` as today").

*Steps.* Today's `apply` loads the state with `parseRunnerState`, which is strict: it cannot read a
state with routes, kept builds and a mark. `verifyDeploy` returns `nextState` in the version-1
shape. An implementation that passes the version-1 part and saves `nextState`, as `apply` does
today, writes a state with no mark and no routes. The next read finds no mark, takes the state as
version 1, fills the new parts with nothing, and marks every held app as version 1.

*Result.* Domains read as held by nobody (the core review's finding 6 again), every app at version
2 accepts version 1 again while the team list is version 1, and kept builds are forgotten.

*Smallest change.* Say: the version-1 path checks the deploy against the version-1 part of the
state and writes back the whole version-2 state, with only `lastSequence` and `secrets` changed.
Every write by a version-2 runner writes the whole state with its mark, `setup` included; the mark
is never removed.

**V22. Removing an app must keep its number (Informational).**

Removal is left out (4.8), but the order rule now rests on `lastSequence`. A removal that deletes
the app from the state turns its last number into 0, and every first deploy of the app's earlier
life (`previous` 0) that has not expired, or carries a `null` `expiresAt`, becomes acceptable again.
Say now that a removal keeps the app's last number and its version mark, as a tombstone.

**V23. A routed container's address can pass to another container (Medium).**

*Why medium.* After a crash and restart, part of a domain's traffic, after TLS, can go to whichever
container next takes the address, and nothing notices until the app is deployed again.

*Part.* 4.2 ("How a route finds its service"), 4.3, Q17, T27.

*Steps (D13).* A routed container exits and Docker restarts it. While it is down its address is
free. A container that starts on that network meanwhile takes it: another service of the app, a
health check container, a one-off container, or another app's container that joined the network
as an external one (D7, a Compose text alone can do that). The routed container comes back with
another address. The proxy still holds the old one.

*Result.* Q17 says the routes "fail" until the next start. They can instead reach another
container. Another app's container that joined this network is the cross-app case; this app's own
other services are the accidental one.

*Smallest change.* Give each routed app a network the runner makes itself (`zekno-route-<app>`, not
a Compose project network). At step 18, connect each routed container to it with
`docker network connect --alias <random 128-bit name>`, and give the proxy and the check that name,
never an address. The alias survives Docker's restarts and resolves to the current address (D14).
Nobody can answer to it without first reading it from Docker, which only an app that controls Docker
can. Static addresses from a range dynamic allocation never uses would also do; the alias needs no
address planning.

**V24. Small corrections (Informational).**

- The `--no-deps` exception keys on "no container of the project exists". Volumes of an earlier
  run can still exist (after a manual `down`, or a pruned container), and starting a database of a
  new major version on old data is what V3 was about. Require "no container and no volume of the
  project".
- Part 4.5 quotes the CLI's warning as "Left out a record for …"; for a record whose signer was
  removed it prints "Left out a record: unknown_signer." with no name.
- `builds[].secrets` should be sorted and unique, like every other list, so one build has one key.

### 8.6 What was cut

- **The `held` read.** Nothing opens. `pack_missing` does not say which chunk is missing (the first
  pass was wrong to say it does), so an upload cut part way is sent again whole. Bandwidth only.
- **Removal statements in the request and on the runner.** Nothing opens. With completeness a
  deployer needs only the live statements; a removed name needs no listing; `status` explains a
  `stale_secret`. Server limits on removals are enforced where they matter, in the CLI's
  `currentSecrets`, since the runner applies a removal only from the deploy's own `removed` list,
  which an allowed deployer signs.
- **The cap on `expiresAt`.** The author is right that a cap counted from `createdAt` binds
  nothing. Without any cap, the window is whatever the signer sets; a CI configured with a year
  leaves T5 and T31 open for a year. A cap against the runner's own clock does bind: refuse an
  `expiresAt` more than 7 days after the runner's now. Optional; the signer is trusted.

### 8.7 The author's three disagreements

1. **Q9 and today's CLI.** The author is right. The draft said the CLI "already requires" a secret
   set by a removed member to be set again; the code drops it with a warning and deploys without it.
   The first pass did not catch that, and repeated it in V5 ("which the CLI already asks for"). It
   is a behaviour change, and refusing is still the right one (8.4).
2. **V6's cost.** Right, and the cost is larger than a failed route: a stale address can belong to
   another container (D13). V23 gives a rule without that cost.
3. **`pack_missing` does not name the chunk.** Right. `RunnerReportSchema` has no place for it, and
   the first pass's part 5 was wrong to say `pack_missing` "already says what is missing". Cutting
   `held` still opens nothing; it costs re-sending a cut-off upload whole.

### 8.8 New and changed questions

| # | Agree? | Note |
|---|---|---|
| Q7 | Yes | Required from the hosted service, `null` allowed over SSH, ordering left to `previous`. Add V19's rule that a `null`-expiry envelope never leaves its SSH session, and consider a cap against the runner's clock (8.6). |
| Q8 | Yes | With V21: the version-1 path writes the whole version-2 state; and once a team list of the new version is signed, later lists keep that version. |
| Q16 | Yes | `previous`, `expiresAt`, secrets with completeness, then builds. CI needs the first three and not builds, so if CI comes first, builds can wait for the build feature. V20 and V21 belong to this first runner. |
| Q17 | Answered, mostly | On Docker 29.6.1 a restarted container does not keep its address, and another container can take it (D13). Decide before domains ship; V23's alias network avoids the question. Repeat D13 on Linux. |
| Q18 | Yes | Add D11 to D14 to the checks, and have the runner read `docker compose version` and refuse version 2 below the minimum. |

### 8.9 Judgement

The revised design is sound enough to build the next three features on. The two high findings are
closed: the order rule is simple and right, and the version-1 rule is complete except for how the
state is written. Before the first version-2 runner is built (Q16's first step), close V20 (state
writes after step 15, and the building deploy's chunks) and V21 (the version-1 path keeps the whole
marked state). Both are a sentence or two in part 6 and part 4.7. Before the domains feature ships,
close V23 (addresses that pass to another container). Before the pre-deploy command is carried out,
close the rest of V4 (the `busy` check for every deploy). V19, V22, V24 and the remaining part of
V12 are wording and can be settled as each feature is built.
