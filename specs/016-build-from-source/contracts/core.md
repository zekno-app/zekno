# Contract: the core library (`packages/core`)

For FR-008, FR-012, FR-016, FR-021 to FR-031a, FR-036 to FR-037h, FR-044, FR-045, FR-049a, FR-063 to FR-067, FR-077, FR-081 to FR-085. Decisions: [plan.md](../plan.md), "Decisions where the maps differ". The code as it was: [research/map-core.md](../research/map-core.md). Rule numbers continue features 014 and 015 ([014 message.md](../../014-deploy-v2/contracts/message.md), [014 runner-checks.md](../../014-deploy-v2/contracts/runner-checks.md), [015 core.md](../../015-domains-https/contracts/core.md)); those files stay as their record. "Item N" is an item of the plan's "Needs the maintainer".

## CO1. The build entry (changes the reserved shape of 014)

No released runner carries a build out, so the shape changes once, in step 1 (FR-024). In `deploy/builds.ts`:

```ts
type Hex64 = string            // ^[0-9a-f]{64}$
type Hex32 = string            // ^[0-9a-f]{32}$ (the state's run token, CO13)
type ImageRef = string         // CO3's grammar, ending @sha256:<64 hex>, at most 255 characters
type Build = {
  key: Hex64
  pack: { hash: Hex64; size: number; chunks: Hex64[] }
  builder:
    | { name: "dockerfile"; dockerfile: string; target: string | null }
    | { name: "railpack"; version: string; frontend: ImageRef; images: ImageRef[];
        plan: { hash: Hex64; size: number; piece: Hex64 } }
  args: { name: string; value: string }[]
  secrets: string[]
  network: "default" | "none"
  timeout: number
  fresh: number | null
}
```

The key order above is the only spelling (F41). Rules of the schema (any break is `malformed`):

| Field | Rule |
|---|---|
| `pack.size` | 1 to `LIMITS.packBytes` (512 MiB) |
| `pack.chunks` | exactly `ceil(size / LIMITS.chunkBytes)` fingerprints |
| `builder.dockerfile` | the path rule of 014 (`staysInside`), 1 to 255 characters |
| `builder.target` | `null`, or `^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$` |
| `builder.version` | `^\d{1,4}\.\d{1,4}\.\d{1,6}$` |
| `builder.images` | 1 to `LIMITS.railpackImages` (8), sorted, each once |
| `builder.plan.size` | 1 to `LIMITS.planBytes` (256 KiB) |
| `args` | at most 32; names by today's `SECRET_NAME` rule, sorted, each once, none named by CO6; each value plain text and at most 4 KiB as UTF-8 (today's rules) |
| `secrets` | at most 32; secret names, sorted, each once; none a credential name (CO6) |
| `timeout` | 1 to 7,200 |
| `fresh` | `null`, or a whole number from 1 to the deploy's own `sequence` |

The payload's `builds` is at most 8 entries, sorted by `key`, each key once. Two services built with the same key share one entry (FR-012).

## CO2. Rules across fields (F6 gains)

- Each `key` equals `buildKey(build, listed)` (CO4) for the deploy's own secret listing.
- Each build secret is listed in the deploy's `secrets` (today's rule).
- No build argument shares its name with a secret the deploy lists (FR-036e).
- At most 64 distinct code pieces across all builds (today's rule), and at most one plan piece per build. A plan piece is never also a code piece.
- `args` take at most 64 KiB in all per deploy (today's rule).
- For each build, the Compose text holds `zekno.invalid/<app>:<key>` with this deploy's app. Every `zekno.invalid/` in the text is one of those names (FR-022, FR-077). A lexical check: it holds a hand-made text to zekno's own form; it is not a boundary.
- A deploy with builds for an app whose name ends with a hyphen is `malformed` (item 15).

## CO3. The image reference grammar

`<registry host>[:<port>]/<path>@sha256:<64 hex>`, lowercase path parts of `[a-z0-9]+([._-][a-z0-9]+)*` joined by `/`, a host of DNS labels, an optional `:<tag>` before the digest, at most 255 characters. A host of `zekno.invalid`, in any case and with any port, is refused. Used for the Railpack frontend and images, and by `railpackPlanImages`. zekno's Dockerfile reader (CLI) parses Docker's full grammar for references without digests; core holds only this one.

## CO4. The key and the values made from signed fields

```text
buildKey(build, listed) = hex(hash("zekno/v1/build", utf8(JSON.stringify([
  build.pack.hash,
  recipe,                                   // ["dockerfile", dockerfile, target]
                                            // or ["railpack", version, frontend, images, plan.hash]
  build.args.map(a => [a.name, a.value]),
  build.secrets.map(n => [n, listed(n).hash]),   // the fingerprint of the sealed value the deploy lists
  build.network,
  build.fresh === null ? null : String(build.fresh),
]))))
baseKey(build, listed)   = buildKey({ ...build, fresh: null }, listed)
secretsHash(build, listed) = hex(hash("zekno/v1/build-reads", utf8(JSON.stringify([args pairs, secret pairs]))))
buildSalt(app, build, listed) = first 32 characters of
                           hex(hash("zekno/v1/build-salt", utf8(JSON.stringify([app, secret pairs]))))
```

- Arrays, strings and null only, so both sides make the same bytes.
- `secretsHash` is Railpack's build argument `secrets-hash` (FR-036d, step 2). `buildSalt` names the runner's `--add-host` (FR-037d, step 1b, item 12); it is defined only for a build with secrets.
- Every input is signed and readable by a relay. None is a secret value or made from one by a plain hash.
- The domain stays `zekno/v1/build`: no released program computes 014's layout.

## CO5. The pack and its pieces (`pack/`)

`pack/tar.ts` writes, and `pack/check.ts` checks as a stream, the one form of [data-model.md](../data-model.md), "The pack":

- `compareNames(a, b)`: by UTF-8 bytes. JavaScript's `<` is never used for names.
- `splitsAsUstar(name)`: true when some `/` of the name as packed (a folder's trailing `/` counted) leaves a `prefix` of at most 155 bytes and a `name` of 1 to 100 bytes, or the whole name is at most 100 bytes. The one rule for which names fit (item 16): zekno's walk refuses any other before signing (C7), the writer and the checker use it, and it replaces a separate limit on the whole path and on its last part. So a folder whose last part is 100 bytes, which needs 101 with its `/`, and a path such as `a/<160 bytes>/<90 bytes>`, with no split point, are refused before signing, never an internal error.
- `header(entry)`: 512 bytes from `{ name, kind: "file" | "folder", mode: 0o644 | 0o755, size }`, with the fixed owner, time, magic and checksum, the name split as `splitsAsUstar` finds it. A name it refuses throws `CoreError("invalid_argument")`, which zekno never reaches, since its walk refused the name first.
- The checker rebuilds every header from what it parsed and compares all 512 bytes. It checks the zero padding, the order, that each parent came before, the end (two zero blocks, then nothing), at most `LIMITS.packEntries` entries, the signed size and the streamed `hash("zekno/v1/pack", …)`. Anything else is `pack_mismatch`. It yields each entry, so the runner can write the Railpack folder in the same pass.
- `withTime(header, seconds)`: the same header with another time and its checksum made again. Used only by the runner, after the check, as it streams to the builder (item 14).

`pack/pieces.ts`:

- `cutPieces(tar)`: fixed 8 MiB slices; `L(i) = min(8 MiB, size − i × 8 MiB)`.
- `sealPiece(bytes, serverKey)`: zstd level 3, then `crypto_box_seal`. Its fingerprint is `hash("zekno/v1/pack-chunk", sealed)`. zstd is Bun's built-in `node:zlib`, imported here (item 10).
- `openPiece(verified, sealed, length)`: accepts only a deploy a verifier registered, as `openSecrets` does. Refuses a sealed piece over `LIMITS.sealedPieceBytes` before opening; opens it; decompresses with `maxOutputLength = length`; requires exactly `length` bytes. Anything else is `pack_mismatch`.
- A plan piece is made and opened the same way, with `length = plan.size`; its opened bytes must hash to `plan.hash` under `zekno/v1/plan`.

`crypto/hash.ts` gains a streaming hash (`crypto_generichash_init`, `_update`, `_final`) that equals the one-shot `hash` for the same domain and bytes, and the domains `zekno/v1/plan`, `zekno/v1/build-reads`, `zekno/v1/build-salt`.

## CO6. Names a build is never given (`deploy/build-names.ts`)

- **Build arguments**: today's reserved names (`PATH`, `HOME`, `TMPDIR`, `XDG_RUNTIME_DIR`, `GODEBUG`, and names starting `DOCKER_`, `COMPOSE_`, `BUILDKIT_`, `BUILDX_`, `LD_`, `DYLD_`, `SSL_CERT_` or ending `_PROXY`), plus the names the builder reads as its own: `SOURCE_DATE_EPOCH`, `TARGETPLATFORM`, `TARGETOS`, `TARGETARCH`, `TARGETVARIANT`, `BUILDPLATFORM`, `BUILDOS`, `BUILDARCH`, `BUILDVARIANT`. Any case. For a Railpack build, also the credential names below (its variables reach the build as build secrets). Whether `RAILPACK_*` and `MISE_*` join the list is decided by check R7.
- **Build secrets**: never `GIT_AUTH_TOKEN`, `GIT_AUTH_HEADER`, or a name starting `HTTP_AUTH_TOKEN_` or `HTTP_AUTH_HEADER_`, any case (FR-037b).
- Exported as `isNeverGivenArg(name, builder)` and `isCredentialName(name)`, used by the schema and by zekno's summary (FR-036b).
- Railpack's own arguments `cache-key` and `secrets-hash` hold a hyphen, which no variable name can.
- **A `# syntax=` line**: `SYNTAX_LINE = /^\s*#\s*syntax\s*=/i` and `isSyntaxLine(line)`, applied to every line of the Dockerfile, wherever it stands. zekno's reader (CL3) and the runner (RB4) use this one function, so zekno never signs a line the runner refuses (FR-025): with item 11 (a) in every build, and whatever item 11 decides in a build whose `secrets` is not empty.

## CO7. What this core carries out (changes F7)

`carriedOut(payload)` reads one table in `deploy/carried-out.ts`, changed by each release. A well-formed deploy that asks for a refused row is `unsupported_version`, after F4 to F6:

| Refused `unsupported_version` | Step 1 | Step 1b | Step 2 |
|---|---|---|---|
| a build whose `builder.name` is `railpack` | yes | yes | no |
| a build with `secrets` not empty | yes | no | no |
| a Railpack build with `secrets` not empty | yes | yes | yes, until FR-089a lifts it |
| a Railpack build with `fresh` equal to the deploy's `sequence` | yes | yes | yes, until R4 shows it works |
| a Railpack build with `network: "none"` | yes | yes | yes (point 18) |
| `predeploy` not `null` | yes | yes | yes |

Each later lift is a protocol number, never a format change. `later-fields.ts` keeps `predeploy` only, for tests.

## CO8. Signing (`createDeployV2`)

Takes `builds?: readonly Build[]` (default `[]`) as an input of its own, sorts them by key, and throws `CoreError("invalid_argument")` for a key given twice. It reads the payload back through `readDeployV2Format` and `readDeployV2Bytes` before signing, as today: F4 to F6 and the one spelling (F41), so zekno never signs what a runner calls `malformed` (FR-025). Those readers do not apply F7, and `createDeployV2` gains no `carriedOut` call: the table in this library is the table of the runner it ships in, not of the runner a deploy is sent to. That zekno never signs what the target runner does not carry out comes from CL7's protocol checks (F1 to F3), each paired in a test with the row of CO7 it stands for. A rollback passes the old builds as they were; F6 computes each key again against the new listing, so a build secret set again or removed since makes the key differ or the secret unlisted, which zekno says before signing (FR-064a).

## CO9. The gate (`deploy/gate.ts`)

K4 to K10 of `verifyDeployV2` (envelope, signature, payload with F4 to F7, role, team and server, `previous`, expiry) move here, used by `verifyDeployV2` and by `pack`. `pack` uses nothing up and opens no secret. `verifyDeployV2` keeps K10b and K11 to K14 after it, and writes mark 5, carrying `builds` and `building` over unchanged, as it carries `routes` and `released`.

`stillAllowed(state, verified)`: the checks of K8 (the signer's role, team and server) and of K13 (`verifySecretStatement` and `verifySecretRemoval` for every statement and removal the deploy used, supplied or held), against the team lists now in `state`. The runner calls it whenever the team lists may have changed since K4 to K14: at K17 for every version-2 deploy, before and during each build (the team list watch), and at B3 (RB3, RB10). A removed member's secret then stops counting on the runner during a build too, as part 4.5 of deploy-v2.md asks (FR-044). It replaces the `signerStillAllowed` of the first draft, which checked the signer only.

## CO10. Refusals, outcomes and report fields

| Added to | Value | Carries | When |
|---|---|---|---|
| `DEPLOY_V2_REFUSALS` | `pack_missing` | `missing: { pieces: Hex64[]; images: { key: Hex64; state: "gone" \| "changed" }[] }`: pieces sorted, each once, at most 72; images at most 8 | a build not kept has a piece or a plan piece not staged. `images` names a build the state recorded whose image is gone or leads elsewhere |
| `DEPLOY_V2_REFUSALS` | `pack_mismatch` | nothing | a piece not listed, over its bound, that does not open, or opens to another length; a pack not in the one form; a pack or plan whose fingerprint differs; a plan that names an image not signed (FR-049a) |
| `RUNNER_REFUSALS` | `low_disk` | `disk: { free: number; floor: number }`, bytes | free disk below the floor before the number; or a `pack` whose piece would bring the disk of `<home>` below it |
| `RUNNER_REFUSALS` | `docker_too_old` | `docker: { engine: string; buildx: string \| null }`, each held to a version pattern | the engine, or buildx, below the floor (item 11) |
| `RUNNER_REFUSALS` | `docker_unchecked` (with item 12 (i)) | `docker: { engine: string; buildx: string \| null }`, as above | a build with secrets on an engine or buildx newer than the newest the Linux check covered |
| `RUNNER_REFUSALS` | `no_build_plugin` | nothing | no buildx, or a builder whose driver is not `docker` |
| `busy` (existing) | — | `building: { app: APP_NAME; seconds: number; limit: number; phase: "building" \| "stopping" \| "starting" }`, optional, read from the state's `building` (CO13) | the deploy lock is held by a deploy that builds, or a stopped build's record still runs. Only in a `deploy` answer |
| `RUNNER_OUTCOMES` | `build_failed` | `app`, `sequence`, and `build: { key: Hex64; reason: Reason; arch?: { image: Arch; server: Arch }; team?: { version: number } }` | a build failed or was stopped after the number was used. `arch` exactly with `wrong_processor`; `team` exactly with `team_changed` |

`Reason` is one of `step_failed`, `out_of_memory`, `out_of_disk`, `time_limit`, `wrong_processor`, `cache_used`, `team_changed`, `runner_restarted` (and `reserved_image` with item 17 (a) or (c)). `runner_restarted` is only ever in the state and in `builds`, never in a `deploy` answer (RB16). `Arch` is `amd64`, `arm64` or `other`. A report still has no free text, and each field comes only with its outcome or reason. Only a `deploy` answer of protocol 6 or more carries any of them, so no older zekno reads them.

## CO11. Events of `deploy`

| Event | Shape | Rule |
|---|---|---|
| `build` | `{ event: "build", key: Hex64, state: "reused" \| "building" \| "built" \| "failed" }` | once per state of each build |
| `build_line` | `{ event: "build_line", key: Hex64, line: string }` | `line` at most 4,096 characters; text for a person, never trusted; dropped as `progress` is when 8 MiB is unsent |
| `build_error` | `{ event: "build_error", key: Hex64, step: string, error: string }` | `step` at most 1,024 characters, `error` at most 4,096 (the runner cuts them); once, before the result of a `step_failed`; never dropped |

`progress` and `health` stay. Text of every event is for a person and never trusted: zekno passes `line`, `step` and `error` through `sanitize` before anything is drawn or printed (CL7). The tests measure a frame as JSON, where a control character takes 6 bytes: a `build_line` of 4,096 such characters is about 24 KiB, and a `build_error` with `step` at 1,024 and `error` at 4,096 about 30 KiB, so 1.5 times the longest frame (about 45 KiB) stays under the `deploy` bound of 64 KiB, which stays equal to `apply`'s. With `step` at 4,096 the `build_error` frame would be about 48 KiB, and 1.5 times it over the bound.

## CO12. Session commands

| Command | Input (strict) | Answer | Answer frame bound | Lock |
|---|---|---|---|---|
| `pack` (new) | `{ envelope: Envelope, piece: string }`: `piece` base64url, at most `sealedPieceBytes` decoded | `{ staged: Hex64 }`, or a report `refused` with a gate reason, `pack_mismatch` (not listed, over the bound), `too_large` (staging past 2 GiB), `low_disk` (the piece would bring free disk below the floor), `busy` | 4 KiB | state |
| `builds` (new) | `{}`, or `{ apps: APP_NAME[] (1 to 8), check?: Hex64[] (1 to 8, with exactly one app) }` | with no `apps`: `{ built: APP_NAME[] }`, the apps that have builds, sorted, at most 1,024; with `apps`: `{ apps: Record<APP_NAME, AppBuildsAnswer> }` | 1 MiB | none (RB15's bounded part may take the deploy lock once) |
| `builder` (new) | `{ usage?: true }` | `BuilderAnswer` | 16 KiB | none (as `builds`) |
| `deploy` | unchanged | CO10's refusals and outcome, CO11's events | 64 KiB | as today |

```ts
type AppBuildsAnswer = {
  running: number | null
  deploys: { sequence: number; keys: Hex64[] }[]
  fresh: { base: Hex64; sequence: number }[]
  records: BuildRecord[]                     // the builds of the deploy that runs, at most 8 (CO14)
  last: { sequence: number; outcome: "built" | "reused" | "build_failed"; reason: Reason | null; at: string } | null
  building: { sequence: number; seconds: number; limit: number; phase: "building" | "stopping" | "starting" } | null
  check?: Record<Hex64, "kept" | "gone" | "changed">   // only when asked
}
type BuilderAnswer = {
  docker: { engine: string | null; buildx: string | null; buildkit: string | null; driver: string | null }
  arch: Arch
  memory: number | null                      // bytes
  disk: { free: number | null; floor: number }
  can: "yes" | "no_docker" | "docker_too_old" | "no_build_plugin"
  stale: number                              // refs whose Docker record could not be removed (item 28)
  usage?: { images: number; cache: number } | null   // bytes, only when asked
}
```

One `AppBuildsAnswer` can reach about 42 KB: 8 records of CO14 with 16 bases of 255 characters each (about 37 KB), 3 deploys of 8 keys and 24 fresh entries. So a full answer is asked for at most 8 apps at a time: about 0.34 MB, and 1.5 times that, about 0.5 MB, stays under 1 MiB. The first draft's 64 apps (about 2.7 MB) would exceed the frame bound, and every app of a server that may hold 1,024 (about 43 MB) the 32 MiB message too. `zekno status` asks `builds` with no input, then for the apps it names in batches of 8; `zekno doctor` needs only the answer with no input (CL9). A request line of `pack` is at most about 12.7 MiB, within the 32 MiB line. `SESSION_COMMANDS` gains the three; a runner below protocol 6 answers each `invalid_request`.

## CO13. The state, mark 5 (changes ST1 to ST4)

```ts
type StoredRunnerState = RunnerState & {
  v: 5
  formats: Record<APP_NAME, 1 | 2>
  routes: Record<APP_NAME, AppRoutes>
  released: string[]
  builds: Record<APP_NAME, AppBuilds>
  building: {
    app: APP_NAME; sequence: number; keys: Hex64[]; since: string; limit: number
    phase: "building" | "stopping" | "starting"
    run: Hex32                                                   // the token every build client carries (RB15)
    stopped: string | null                                       // when the runner stopped it
  } | null
}
type AppBuilds = {
  running: number | null
  images: { key: Hex64; manifest: Digest; config: Digest }[]     // at most 24, sorted by key, each once
  deploys: { sequence: number; keys: Hex64[] }[]                 // at most 3, newest first; keys sorted, 1 to 8
  drop: { key: Hex64; manifest: Digest; config: Digest }[]       // at most 24, sorted by key: images to remove, kept until the removal succeeds
  fresh: { base: Hex64; sequence: number }[]                     // at most 24, sorted by base, each base once
  last: { sequence: number; outcome: "built" | "reused" | "build_failed"; reason: Reason | null; at: string } | null
}
```

Read strictly. A state marked 5 must also satisfy: every app in `builds` is at format 2; the keys of `deploys` together are exactly the keys of `images`; no key is in both `images` and `drop`; every sequence is at most the app's last number; `running` is `null` or one of the app's numbers; `building.app` is in `formats` and `building.sequence` equals its last number; `building.keys` 1 to 8, sorted; `building.run` 32 hex; `stopped` is a time exactly when `phase` is `stopping`, else `null`; a `Digest` is `sha256:` and 64 hex; `since`, `at` and `stopped` are ISO times; `limit` 1 to 57,600 (8 builds of 2 hours).

`building` is written with the number (`phase: "building"`), becomes `stopping` when the runner stops a build (RB10, RB15), `starting` at B3, and is cleared once U has run, or once a failed build's records are gone (RB3). Each change is one state write under the state lock, so the phase `busy` and `builds` report survives the process that set it.

Reading: marks 4, 3, 2 and none are read by their own rules, as feature 015 reads them, and given `builds: {}` and `building: null` in memory. A state marked anything above 5 is refused. `newRunnerState` writes mark 5. Runner 0.1.1 refuses mark 5 (`invalid_state` for every request), so FR-085 holds.

`deploy/kept-builds.ts`:

- `keepAfter(appBuilds, { sequence, keys, outcome, images }, running)`: the next entry. It keeps `running`'s keys and the two newest other deploys whose builds succeeded or were reused, deploys with the same keys counted once, and moves every image it no longer keeps from `images` to `drop`. A key of this deploy found in `drop` (K14a reused it) moves back to `images`. A `build_failed` deploy or a reuse never pushes an image out (FR-067). Called at B3 with the new images, and again before RB14 with the `running` U left, so `deploys` and `images` name the same keys at every write.
- `withDropped(appBuilds, key)`: the entry leaves `drop` once its removal succeeded, or its tag is gone or leads elsewhere (RB14).
- `withFresh(appBuilds, base, sequence)`, at most 24, the oldest dropped.
- `withAppBuilds(state, app, appBuilds | null)`, `withBuilding(state, building | null)`: each read back through the strict schema.

The team list checks the first draft put here as `signerStillAllowed` are `stillAllowed` in `deploy/gate.ts` (CO9).

## CO14. The build record (`deploy/build-record.ts`)

A strict schema for the runner's side file `kept/<app>/<key>.json` and for `records` in `builds`:

```ts
type BuildRecord = {
  key: Hex64; manifest: Digest; config: Digest
  builder: "dockerfile" | "railpack"; railpack: string | null      // its version
  docker: { engine: string; buildx: string; buildkit: string }
  reader: { kind: "dockerfile"; version: string } | { kind: "railpack"; frontend: Digest }
  cache: boolean                     // a cached step other than FROM was used
  bases: string[]                    // at most 16, each a reference with @sha256:, at most 255 characters
  arch: Arch
  built: string                      // ISO time
}
```

The server's word, shown as such, never signed. Never a line the builder printed.

## CO15. `railpackPlanImages` (`deploy/railpack-plan.ts`, step 2)

`railpackPlanImages(planBytes): ImageRef[] | "unreadable"`: every image the plan names, sorted and each once. The plan is read by a strict schema of the pinned version's plan format: every key the format allows, and no other. A key the schema does not know, at any depth, gives `"unreadable"`, so a field this reading does not look at (a step input, a deploy base, a field newer than the reading) can never name an image both sides miss. Images are taken from every field the format allows to hold a reference. zekno and the runner use the same function: zekno refuses a plan naming an image it holds no digest for (I25), and an `"unreadable"` plan with I25's form for it (item 23); the runner refuses, before the number, an `"unreadable"` plan or one whose images differ from the signed `images` (`pack_mismatch`, FR-049a). The schema, and which fields hold references, are established at M3 from the pinned version and checked by R5: a plan with an image in each such field, and a plan with one unknown key, must both be refused unless their images are signed.

## CO16. Limits (`protocol/limits.ts`)

New: `packEntries` 50,000; the ustar name rule as `splitsAsUstar` (CO5: prefix 155 bytes, name 100), in place of separate path and last-part limits; `sealedPieceBytes` 8 MiB + 64 KiB; `planBytes` 256 KiB; `railpackImages` 8; `missingPieces` 72; `stagingBytes` 2 GiB; `stagingSeconds` 86,400; `keptDeploysPerApp` 3; `keptImagesPerApp` 24, which also bounds `drop`; `freshPerApp` 24; `baseDigestsPerBuild` 16; `buildCacheBytes` 10 GiB; `diskFloorBytes` 2 GiB, confirmed by check L7; `buildDefaultSeconds` 1,800; `buildLineCharacters` 4,096; `buildStepCharacters` 1,024; `buildsAppsPerRequest` 8. Kept: 014's limits on builds, pieces, arguments and secrets. The summary's warning size (100 MB), the last 40 lines and the saved output's 32 MiB are zekno's own, not core's.

## CO17. The protocol (changes P1)

- `RUNNER_PROTOCOL = 6` with step 1: the runner builds with a Dockerfile, answers `pack`, `builds` and `builder`, and may answer `build_failed` and CO10's refusals to a `deploy`.
- `RUNNER_PROTOCOL = 7` with step 2: it also builds with Railpack.
- Step 1b takes the number of the release that first carries it, 6 or 7, and adds none (FR-081). Each later lift of CO7 takes its own.
- zekno's thresholds stay in the CLI (`ops/deploy-format.ts`): `BUILD_PROTOCOL = 6`, `RAILPACK_PROTOCOL = 7`, `BUILD_SECRETS_PROTOCOL` 6 or 7.
- The `version` answer stays the strict `{ version, protocol }`: a new field would break every released zekno.

## CO18. Older and newer programs

| Pairing | What happens |
|---|---|
| zekno of step 1 to runner 0.1.1, a deploy that builds | stops before signing (F1): protocol 5 is below 6 |
| the same, a deploy with no build | as in feature 015 |
| runner 0.1.1 handed a signed build anyway | `malformed` from its strict schema, no number used; zekno says F11 for `malformed` from a runner below 6 |
| runner 0.1.1 handed `pack`, `builds` or `builder` | `invalid_request` |
| zekno 0.1.1 to a runner of protocol 6 or 7 | C7 before signing anything, unchanged (FR-084); `status`, `logs`, `records` and `proxy` answer as before |
| zekno of step 2 to a runner of step 1, a Railpack build | stops before signing (F2); handed one anyway, the runner answers `unsupported_version` |
| zekno of step 1b to a runner without build secrets | stops before signing (F3); handed one anyway, `unsupported_version` |
| zekno of step 1 to a runner of step 2 | C7 before signing, even for images, as today's rule says |
| runner 0.1.1 put back after mark 5 | `invalid_state` for every request |

## CO19. Tests that change, and tests added

- `later-fields.test.ts` (15 tests pin 014's shape and key, and read "passes" as `unsupported_version`): rewritten for CO1, CO4 and CO7.
- `state.test.ts` (mark 5 refused today): mark 5 accepted, mark 6 refused, every earlier mark read forward.
- `messages-v2.test.ts` (protocol 5) and `protocol/session.test.ts`'s frame-room test: protocol 6, then 7; the `deploy` bound still equals `apply`'s; every bound at most `messageBytes / 8`; the longest frame of each new command times 1.5 under its bound. For `deploy`, a `build_error` with `step` of 1,024 and `error` of 4,096 control characters joins the frames measured. For `builds`, the worst case: 8 apps, each with 8 records of 16 bases of 255 characters, 3 deploys of 8 keys and 24 fresh entries; and the no-input answer with 1,024 names.
- New: the tar form read back by two independent readers, the second written inside the test (no tool from the machine, item 2); `splitsAsUstar` at its edges (a 100-byte folder name, a 155-byte prefix, a path with no split point); the byte order against `<`; a piece that opens to one byte more or less; a piece sealed for server A gives `pack_mismatch` with server B's key (FR-026); a 64 MiB zero bomb; every field of CO1 changed by one byte changes the key or is refused (SC-006); a marker string in a file never in a sealed piece or the payload (SC-007); credential and reserved names in every case; `isSyntaxLine` on lines before and after the first instruction; the carried-out table per step, each row paired with zekno's protocol threshold for it; `stillAllowed` with a removed signer and with a removed setter of a listed secret; the state's `building` through its phases; `keepAfter` against FR-067's cases (five builds, failures, reuses, rollbacks, a `drop` entry reused).

## What stays

The payload's format apart from `builds`, and its one-spelling rule; every other check and its order; the kinds and the other hash domains; version 1; the shape of `version`, `status`, `status` with routes, `records` and `proxy` answers.
