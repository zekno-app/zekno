# Research record: `packages/core` for building from source (a snapshot at commit 00912ad)

Written by an agent on 2026-11-27 for the plan of feature 016. Line numbers go stale. The decisions below are proposals: what is decided goes into `plan.md`, `research.md` and the contracts. Nothing under `apps/` or `packages/` was changed.

## What was read, and what was run

**Read**: every file of `packages/core/src`; the tests that pin builds, the protocol number and the state mark; `spec.md`; `research.md` (parts 1 to 8); `design/lines.md`; `specs/010-app-settings/deploy-v2.md` part 4.1 (b), parts 5 to 10; `specs/015-domains-https/contracts/core.md` and `research/map-core-runner.md` (the model); the constitution. In `apps/`, only the places core's changes reach: `apps/cli/src/ops/deploy-format.ts`, `apps/cli/src/settings/compose.ts`, `apps/cli/src/settings/shape.ts`, `apps/cli/src/shared/history.ts`, `apps/runner/src/commands/deploy.ts`, `apps/runner/src/session/session.ts`.

**Ran** (Bun 1.4.4 on the maintainer's Mac, with `bun --no-env-file`; throwaway scripts in the session's scratchpad, `core-map/probe1.ts` and `core-map/probe2.ts`, not kept):

| # | What | Result |
|---|---|---|
| P1 | Streaming BLAKE2b from `libsodium-wrappers` (`crypto_generichash_init`, `_update`, `_final`), fed `domain`, `0x00`, then 20 MiB in 64 KiB pieces | Present. Equal to core's one-shot `hash("zekno/v1/pack", …)`. About 230 MB/s streamed, 254 MB/s one-shot. |
| P2 | zstd and gzip in Bun's `node:zlib` | `zstdCompressSync`, `zstdDecompressSync`, `createZstdDecompress` and `Bun.zstdCompressSync` all exist. |
| P3 | An 8 MiB random piece: zstd, then `crypto_box_seal`, then open, then unzstd | zstd output 8,388,810 bytes (+202). Sealed: +250 bytes over the piece. zstd 4 ms, seal 18 ms, open 18 ms, unzstd 3 ms. gzip: +2,583 bytes, 109 ms. |
| P4 | A bomb: 64 MiB of zeros compressed (2,067 bytes with zstd), opened with `maxOutputLength: 8 MiB` | zstd and gzip both throw `ERR_BUFFER_TOO_LARGE`. With the bound equal to the exact length, it opens. |
| P5 | A throwaway ustar writer in the one form proposed in D-C4 (sorted by UTF-8 bytes, fixed mode, owner and time, directories with `/`, the `prefix` split for a 130-byte path, two zero blocks) | The same bytes whatever the input order. `bsdtar 3.5.3` lists every entry with the right mode, owner, time and full path. Python's `tarfile` with `filter="data"` extracts all 19 entries. |
| P6 | JavaScript's `<` against UTF-8 byte order, for U+1F600 and U+FF5E | They disagree. A sort by `<` is not a sort by bytes. |

**Not run**: anything with Docker, BuildKit, Compose or Railpack; anything on Linux. Statements marked "from knowledge" are not checked in this session.

## 1. The map

### 1.1 The signed deploy and the build entry it reserves

| What | Where | Today |
|---|---|---|
| The payload | `packages/core/src/deploy/message.ts:38-72` | Strict. `builds: z.array(BuildSchema).max(8)` at :68. Every field present in every payload. |
| The build entry | `deploy/later-fields.ts:38-78` | `key`, `pack {hash, size, chunks}`, `dockerfile`, `target`, `args`, `secrets`, `network`, `timeout`. No builder, no plan, no fresh-build field. |
| Its key | `deploy/later-fields.ts:111-141` | `hash("zekno/v1/build", JSON.stringify([pack.hash, dockerfile, target, [[name, value]…], [[secret, listed hash]…], network]))`. Arrays, strings and null only. |
| Its cross-field rules | `deploy/later-fields.ts:150-190` (builds at :160-177) | `args` and `secrets` sorted and unique; each build secret listed in the deploy's `secrets`; chunks = `ceil(size / 8 MiB)`; at most 64 distinct chunks per deploy; `args` 64 KiB per deploy; `key === buildKey(...)`. |
| Names a build argument may not take | `secrets/secrets.ts:32-36`, used at `later-fields.ts:63` | `PATH`, `HOME`, `TMPDIR`, `XDG_RUNTIME_DIR`, `GODEBUG`, and names starting `DOCKER_`, `COMPOSE_`, `BUILDKIT_`, `BUILDX_`, `LD_`, `DYLD_`, `SSL_CERT_` or ending `_PROXY`, any case. |
| The Dockerfile's path rule | `deploy/link.ts:38-41` (`staysInside`) and `later-fields.ts:49-54` | Relative, no `\`, no `.` or `..` part, no control or format character, 1 to 255 characters. |
| Limits | `protocol/limits.ts:44-63` | Builds 8; pack 512 MiB; piece 8 MiB; 64 pieces per deploy; 32 args, 4 KiB each, 64 KiB per deploy; 32 build secrets; 7,200 s. Payload 1 MiB (:20); a message 32 MiB (:22). |
| Hash domains | `crypto/hash.ts:10-20` | `zekno/v1/pack`, `zekno/v1/pack-chunk`, `zekno/v1/build` exist. `hash` is one-shot only (:27-37). |
| Exports | `src/index.ts:103-111` | `Build` type and `buildKey` are exported. |

### 1.2 How consistency is checked

- **F4 to F6** (`message.ts:93-117`): an object, the strict schema, then the rules across fields, `laterFieldsAreConsistent` among them. Anything else is `malformed`.
- **F41** (`message.ts:132-147`): the signed text must equal `JSON.stringify` of what the reader gives. So the schema's key order is the only spelling.
- **F7** (`message.ts:155-167`, `carriedOut`): a non-empty `builds` or a `predeploy` is `unsupported_version`. It runs after F4 to F6, so a build that breaks a rule is `malformed` first.
- **Signing** (`deploy/deploy-v2.ts:128-263`): `createDeployV2` takes builds only through `later` (:139-142, :248, "for tests only"), and reads the payload back through both readers before it signs (:253-262). So zekno never signs what a runner calls `malformed`.
- **The runner's gate** (`deploy-v2.ts:305-443`): K4, K5 envelope and signature (:325-334); K6, K7 the payload and F7 (:336-339); K8 role, team, server (:342-359); K9 `previous` (:361-376); K10 expiry (:378-394); K10b domains (:396-407); K11 to K14 secrets (:409-417, in `listed-secrets.ts:45-226`). It writes `v: 4` as a literal into `nextState` (:421-433) and carries `routes` and `released` over by name.
- **The history reader** (`readSignedDeployV2`, `deploy-v2.ts:271-288`) applies F4 to F6 and F41, not F7.

### 1.3 The session protocol and its number

| What | Where | Today |
|---|---|---|
| `RUNNER_PROTOCOL` | `protocol/session.ts:26-39` | 5. 2 = runner 0.1.0, 3 = format 2, 4 = routes, 5 = the start limit. Pinned at `test/scenarios/messages-v2.test.ts:184-185`. |
| The `version` answer | `session.ts:42-45` | Strict `{ version, protocol }`. An extra field would break every released zekno, so capabilities can only travel as a protocol number. |
| Commands | `session.ts:48-61` | No `pack`, no `builds`. An unknown command is `invalid_request`. |
| Events | `session.ts:75-107` | `progress` (4,096 characters), `log`, `health`. |
| Frame bounds | `session.ts:129-150` | `deploy` 64 KiB, equal to `apply` (pinned at `messages-v2.test.ts:179`). Every bound at most `messageBytes / 8` = 4 MiB (`:180-181`); tests also want the longest frame times 1.5 under its bound. |
| Outcomes and reasons | `protocol/protocol.ts:172-190`, `result.ts:22-57` | No `build_failed`, `pack_missing`, `pack_mismatch`. |
| The report | `protocol.ts:241-264` | Strict, no free text. `routes`, `health`, `startLimit` each tied to one outcome. `startLimit` is carried only by the report of a version-2 `deploy`, so older zeknos never read it. |
| The CLI's thresholds | `apps/cli/src/ops/deploy-format.ts:25`, `:32`, `:51-69` | `VERSION_TWO_PROTOCOL = 3`, `ROUTES_PROTOCOL = 4`; a runner with a higher protocol than zekno's is stopped before signing (C7, :60-61). |

### 1.4 Sealing

- `sealSecret` (`secrets/secrets.ts:68-113`): `crypto_box_seal` for the server's key from the signed team list, with server, app and name sealed inside.
- `openSealedSecret` (`:126-170`) is reached only through `openSecrets` (`deploy/open.ts:34-76`), which accepts only an object a verifier registered (`open.ts:19-27`). That is the rule "nothing decrypts before it is verified".
- Nothing seals or opens a piece of code yet. There is no streaming hash, no compression and no tar code anywhere in the repository (research, part 7.1).
- A sealed box adds 48 bytes and uses a fresh key each time, so a piece sealed twice has two different hashes. The signed `chunks` list fixes them, so the sealed pieces must be kept from signing to upload (P3).

### 1.5 Secrets, their versions and their fingerprints

- The deploy lists each secret as `{ name, hash, version }` (`message.ts:59-63`). `hash` is `hash("zekno/v1/secret", ciphertext)` (`secrets.ts:115-119`), the fingerprint of the sealed value. A secret set again, even to the same value, gets a new ciphertext and so a new hash.
- `buildKey` already takes, for each build secret, its name and that listed hash, never a value (`later-fields.ts:131-139`). That is exactly what FR-037e allows a build key to take in.
- A build secret must be listed in the deploy's `secrets` (`later-fields.ts:164`). Nothing refuses a credential name (FR-037b) yet.

### 1.6 The stored state

- Mark 4 (`deploy/state.ts:133-145`, schema `:270-280`): today's fields, `formats`, `routes`, `released`. Read strictly by `readMarked` (`:283-288`); older marks are read forward by `readRunnerState` (`:311-333`); a runner refuses a mark it does not know. `test/deploy/state.test.ts:179` pins that mark 5 is refused today.
- No kept builds, no record of a build under way, no last outcome. `afterVersionOneDeploy` spreads the state (`:372-383`), so a new part survives a version-1 deploy.

### 1.7 Rollback

- The CLI's history keeps the whole envelope, but `HistoryDeploy` drops `builds` (`apps/cli/src/shared/history.ts:36-40`, `:104-118`). A rollback re-signs with `builds: []`.
- Core needs nothing new to carry builds: `createDeployV2` must take `builds` as an input of its own, and F6 recomputes each key against the new deploy's secret listing. A build secret set again or removed since then makes the old key differ, or the secret unlisted. That is how zekno finds FR-064a's case before signing.

### 1.8 The Compose text from settings (CLI)

- `apps/cli/src/settings/compose.ts:55-93` writes each service. The image line is `:56`, `image: ${quote(service.image)}`. A built service would write `image: "zekno.invalid/<app>:<key>"` and `pull_policy: "never"` there.
- `composeText(settings)` (`:96-109`) takes no app and no key today. It needs both.
- `deployedSettings` (`:191-209`) reads a signed text back into settings by its image line (`:121-125`). A built service's line would read back as an image under the reserved name.
- `apps/cli/src/settings/shape.ts:137` keeps `source.build` as `later`.

### 1.9 Files near the 500-line rule

`deploy-v2.ts` 443 lines, `deploy.ts` 442, `secret-record.ts` 411, `state.ts` 391, `session.ts` 302, `protocol.ts` 347. Builds cannot be added to `deploy-v2.ts` or `state.ts` without a split (D-C15).

## 2. The requirements that land in core

"Older programs" says what runner 0.1.1 (protocol 5) or zekno 0.1.1 does with the change.

| FR | What changes in core | Older programs |
|---|---|---|
| FR-008, FR-024 | The build entry names its builder: `dockerfile` or `railpack`, with Railpack's fields already in step 1 (D-C1). | Runner 0.1.1: any new field fails its strict schema, so `malformed`, no number used. zekno never sends it: it stops before signing (F1). |
| FR-012 | Builds sorted by key, each key once; pieces shared between builds count once (already). | Same as above. |
| FR-016, FR-030 | New `pack/` module: the one tar form, its writer and its streaming checker; UTF-8 byte order (D-C4). | Not reachable by older programs. |
| FR-018 | `LIMITS.packEntries` 50,000 and `LIMITS.packPathBytes` 255 (D-C16). | None. |
| FR-021, FR-021a | `fresh` field in the build entry (D-C3). | `malformed` on 0.1.1. |
| FR-022, FR-023 | New key layout (D-C2); F6 still recomputes it. | `malformed` on 0.1.1. |
| FR-025, FR-063 | `createDeployV2` takes `builds` as its own input, sorted by key; `later` keeps only `predeploy`. | None. |
| FR-026, FR-029, FR-029a | `pack/pieces.ts`: cut at 8 MiB, zstd, seal; open only for a verified deploy, to exactly the piece's length (D-C6). | None. |
| FR-027 | Railpack's plan is its own sealed piece; only its fingerprint, size and sealed hash are signed in the clear (D-C7). | None. |
| FR-028 | A gate for `pack`: K4 to K10 shared with `verifyDeployV2`, then "this deploy lists this piece" (D-C11). | 0.1.1 answers `pack` with `invalid_request`. |
| FR-029a | `pack_missing` lists the missing pieces' hashes (D-C10). | Only in `deploy` answers of protocol 6. |
| FR-031a, FR-071, FR-071b | `build_failed` outcome with a fixed reason list; events for the builder's lines and the failing step (D-C10). | zekno 0.1.1 is stopped by C7 before any deploy to a protocol-6 runner, so it never reads them. |
| FR-034a, FR-040, FR-078 | Runner refusals `docker_too_old`, `no_build_plugin`, `low_disk` with the free space (D-C10). | Same: `deploy` answers only. |
| FR-036, FR-036b | Names a build is never given: today's reserved names plus the builder's own (D-C13). | None. |
| FR-036d, FR-037d | `buildReadsStamp(build, listed)`: a value made only from signed fields, for Railpack's `secrets-hash` and any cache separation (D-C2). | None. |
| FR-036e | A build argument may not share its name with a secret the deploy lists (D-C13). | None. |
| FR-037b | Credential names refused in `secrets`: `malformed` (D-C13). | None. |
| FR-037h, FR-082, FR-083 | A table of what this core carries out, read by `carriedOut`: Railpack, build secrets, a Railpack fresh build, Railpack with no network each refused `unsupported_version` until their step (D-C9). | A step-1 runner handed a Railpack build: `unsupported_version`, no number used. |
| FR-044 | `signerStillAllowed(state, signer)` for a team list taken during a build; `busy` may carry the build under way (D-C10). | `busy` details only in `deploy` answers. |
| FR-045, FR-066, FR-067, FR-080 | State mark 5: kept builds, the deploys that keep them, fresh generations, the build under way, the last outcome; a `builds` read; a pure pruning function (D-C12). | Runner 0.1.1 put back after mark 5: `invalid_state` for every request (FR-085). |
| FR-049a, FR-060 | `railpackPlanImages(plan)`: every image the plan names, read the same way by zekno and the runner (step 2). | None. |
| FR-064, FR-064a | No new refusal: the runner answers `pack_missing`; zekno, holding no pack in a rollback, says G43. The key check finds a secret set again or removed. | None. |
| FR-077, FR-022 | F6 rule: the Compose text names each build's image, and names no other image under `zekno.invalid/` (D-C14). | `malformed` on 0.1.1 only if a hand-crafted deploy reached it. |
| FR-081 | `RUNNER_PROTOCOL` 6 with step 1, 7 with step 2 (D-C8). | zekno 0.1.1 meets 6: C7, unchanged (FR-084). |
| FR-085 | Mark 5 read forward from 4, 3, 2 and unmarked. | As above. |

Not in core: the ignore rules, the summary, the Dockerfile reader, the first-deploy question, Railpack's fetch and run, doctor, the docs (CLI); Docker, staging folders, locks, pruning images, the build command line (runner).

## 3. Decisions for core

### D-C1. The build entry, and where the builder and the plan are signed

**Decision.** The reserved entry changes shape once, in step 1 (FR-024 allows it: no released runner carries it out):

```ts
{
  key: hex64,                                   // D-C2
  pack: { hash: hex64, size: 1..512 MiB, chunks: hex64[1..64] },   // as today
  builder:
    | { name: "dockerfile", dockerfile: path, target: string | null }
    | { name: "railpack", version: "0.43.1", frontend: imageRef@sha256,
        images: imageRef@sha256[1..8], plan: { hash: hex64, size: 1..planBytes, piece: hex64 } },
  args: { name, value }[0..32],                 // the plain variables given to the build
  secrets: name[0..32],                         // build secrets, by name
  network: "default" | "none",
  timeout: 1..7200,
  fresh: number | null,                         // D-C3
}
```

The builder choice is signed in each build entry, in the clear, as `builder.name`. The plan is signed by its fingerprint (`plan.hash`, `hash("zekno/v1/plan", plan bytes)`), its size, and the hash of its sealed piece. Railpack's version, the frontend and every image the plan may name are signed in the clear, by digest. `images` is sorted and each once. An image reference has a strict grammar ending in `@sha256:<64 hex>`, at most 255 characters, and may not be under `zekno.invalid`.

**Why.** A discriminated union keeps each builder's fields together, so a Dockerfile build cannot carry a plan and the reverse, with no cross-field rule to forget. A later builder (Cloud Native Buildpacks) adds one option. The fields a relay may read (FR-027) are exactly the clear ones.

**Alternatives.** (a) Keep 014's flat fields and add `builder` and a nullable `railpack` object: needs cross-field rules, and `dockerfile` and `target` would be required and meaningless for Railpack. (b) Keep the shape so runner 0.1.1 says `unsupported_version` rather than `malformed`: impossible, since any new field fails its strict schema. A later builder will also make older runners say `malformed`; that is accepted, because zekno checks the protocol before signing.

### D-C2. The build key

**Decision.**

```
buildKey(build, listed) = hex(hash("zekno/v1/build", utf8(JSON.stringify([
  build.pack.hash,
  recipe,                    // ["dockerfile", dockerfile, target]
                             // or ["railpack", version, frontend, images, plan.hash]
  args  -> [[name, value], …],           // sorted by name (F6)
  secrets -> [[name, listed hash], …],   // sorted; the hash the deploy lists (FR-037e)
  network,
  fresh === null ? null : String(fresh),
]))))
```

The base key of a build is the same with `fresh` set to null (D-C3). Sizes, pieces, the plan's piece and size, and the time limit stay out (FR-022). The domain stays `zekno/v1/build`: no released program computes the old layout, and the two layouts cannot give the same text. A second function, `buildReadsStamp`, gives `hash("zekno/v1/build-reads", JSON.stringify([args pairs, secret pairs]))` for Railpack's `secrets-hash` (FR-036d) and for any cache separation FR-037d needs.

**Why.** It is the 014 rule (arrays, strings and null only, so both sides make the same bytes), with the builder, the recipe and the fresh generation added in a fixed place. Every input is already signed and readable by a relay, so the key reveals nothing new. A secret's listed hash is the fingerprint of its sealed value, never of its value.

**Alternatives.** Hashing the build object minus some fields: couples the key to the schema's key order. A length-prefixed binary encoding: more code for the same result. Putting the app in the key: not needed, the image name holds it.

### D-C3. The fresh-build field

**Decision.** `fresh: null | n`, a deploy number with `1 <= n <= sequence` (F6).

- `fresh === sequence` is the request for a fresh build. Its key is new by construction, since no earlier deploy of the app had that number, so the runner always builds it, with no cached step and every base image fetched again (FR-021a).
- After it succeeds, the runner records, for the app, the build's base key with `n`.
- Before signing a later deploy, zekno reads the app's fresh generations (`builds`, D-C11). For a build whose base key has one, it signs that `n`. Its key is then the fresh image's key, so it reuses the fresh image, or builds again under that key, never under the older one.
- A rollback carries the old entry unchanged. Its `fresh` is old, so its key names the old image, which runs if kept (US8 sc1). A rollback of the fresh deploy itself carries `fresh = n < sequence`: no longer a request, the same key, the fresh image.
- The runner keeps at most 24 fresh generations per app, oldest dropped (D-C12).

**Why.** A request that only changed the key would not last (point 11). A flag outside the key would make the fresh image and the older one share one image name, so a rollback to the deploy before the fresh build would run the fresh image, which US8 sc1 and sc2 do not allow. The generation travels the way `previous` does: zekno reads it from the runner on the deploy's own connection.

**Alternatives.** (K) `fresh: boolean`, not in the key; a fresh build replaces the kept image under the same key. Simpler, with no read before signing, but a rollback after a fresh build of the same code runs the fresh image, and "the server keeps the build of deploy 4" becomes untrue without the runner knowing. (C) The generation from this machine's history: a teammate or CI lacks it. (S) A generation in the settings file: a person must commit it, and an older checkout silently goes back.

**Cost.** One more read before signing a deploy that builds. Through the hosted service later, a relay that hides the generation can make a deploy reuse a pre-fresh image still kept: at most three deploys back, and only of code a member signed.

### D-C4. The deterministic tar

**Decision.** POSIX ustar, one form:

| Field | Value |
|---|---|
| Entries | Regular files (`0`) and folders (`5`) only. Every folder that holds a sent entry, and every folder the ignore rules do not leave out, is an entry. No `.` or `./` entry. No pax, no GNU long names. |
| Order | Strictly increasing by the UTF-8 bytes of the name as written, folders with a trailing `/`. A folder then always comes before what it holds (P5). JavaScript's `<` must not be used (P6). Each entry's parent folder is an earlier entry. |
| Names | Valid UTF-8 as on disk (no Unicode normalisation), relative, no empty, `.` or `..` part, no control character (Cc). At most 255 bytes. A name over 100 bytes is split into `prefix` and `name` at the last `/` that leaves `prefix` at most 155 bytes and `name` at most 100 and not empty; a name that cannot be split is refused before signing, with its place. |
| `mode` | `0000644\0`, or `0000755\0` for a folder and for a file whose owner may execute it (as git records it). |
| `uid`, `gid` | `0000000\0`. `uname`, `gname` all zero bytes. |
| `size` | 11 octal digits and `\0`; 0 for a folder. |
| `mtime` | One fixed time, `946684800` (2000-01-01 UTC), 11 octal digits and `\0`. See D-C5. |
| `chksum` | Six octal digits, `\0`, a space. |
| `linkname` | All zero bytes. |
| `magic`, `version` | `ustar\0`, `00`. |
| `devmajor`, `devminor` | `0000000\0`. |
| Data | Padded with zero bytes to 512. |
| End | Exactly two zero blocks, then nothing. |
| Links | Never in the pack. Each symbolic link, and anything not a file or folder, is left out and listed by zekno (FR-014). The runner refuses every other type. |

The runner's checker rebuilds each header from what it parsed and compares all 512 bytes, so there is one rule, written once in core and used by both sides. It also checks the zero padding, the end, the entry limit, the total size and the hash.

**Why.** P5 showed this form reads back with two independent readers. Without pax, the runner parses two entry types and no records. 255 bytes is the `prefix` plus `name` capacity, and most repositories keep paths short. Including folders keeps empty folders (as `docker build .` does) and lets the Railpack folder be written in one pass with fixed modes.

**Alternatives.** Pax `path` records for longer names: the runner then parses records, and adding pax later needs a protocol number. Keeping links that stay inside the folder: the spec says no (FR-014). A manifest instead of a tar: changes `pack.hash` and makes the runner build the tar.

### D-C5. File times in the pack

**Decision to put to the maintainer.** Three ways, the first recommended:

- **(A) One fixed time in the pack, and the runner gives each file the build's start time as it streams the checked pack into the builder** (it rewrites only `mtime` and the checksum of headers it has just checked; for Railpack, the files it writes simply get the time they are written). Images then hold recent times, as on platforms that build from a fresh clone.
- **(B) A time made from each file's content**, `946684800 + (first 4 bytes of hash("zekno/v1/pack-time", content)) mod 2^28`, checked by the runner. Deterministic, and a changed file always gets another time.
- **(C) One fixed time, documented.**

**Why it matters.** A web server that serves files straight from the image usually builds its `ETag` from the time and the size (from knowledge: nginx, Caddy and Apache do). With one fixed time, a file changed without changing its size keeps its `ETag`, so a browser that asks again gets "not modified". A real case: an `index.html` built on the developer's machine, sent in `dist/` (point 1 keeps such output), whose bundle names change but keep their length. And with a `Last-Modified` years in the past, a browser may cache a file without asking for a long time (heuristic freshness, from knowledge). (B) fixes the first problem only. (A) fixes both, and keeps zekno's pack simplest. Its costs: what the builder reads differs from the signed bytes in times only, and it rests on BuildKit leaving `mtime` out of its cache key, so that unchanged code still reuses cached steps (from knowledge, not checked; to add to FR-089's checks).

### D-C6. Pieces: cutting, compression, sealing, and the bound

**Decision.**

- The pack is cut at fixed 8 MiB boundaries of its bytes, not at entries. Piece `i` has exactly `L(i) = min(8 MiB, size - i * 8 MiB)` bytes. The count rule of F6 stays.
- Each piece is compressed alone with zstd, level 3, then sealed with `crypto_box_seal` for the server's key. Nothing else is inside. `chunks[i] = hash("zekno/v1/pack-chunk", sealed piece)`, as today.
- `LIMITS.sealedPieceBytes = 8 MiB + 64 KiB`. zstd adds about 200 bytes to 8 MiB that does not compress (P3), so this is far above need. As base64url, a sealed piece is at most about 11.3 MiB, within the 32 MiB line with the envelope.
- `openPiece` accepts only a deploy a verifier registered, as `openSecrets` does. It refuses a sealed piece over the bound before opening, then opens it, then decompresses with `maxOutputLength = L(i)` and requires exactly `L(i)` bytes. Anything else is `pack_mismatch`. So a piece never opens to more than its signed share of the pack, and never to more than 8 MiB (P4).
- `pack.hash` and the key are over the uncompressed tar, streamed through the new streaming hash (P1). Compression output is in no fingerprint, so its level can change freely.

**Why.** Point 8 decided compression before sealing. Per piece keeps pieces independent, so a cut upload resumes piece by piece (FR-029a). zstd was faster than gzip and as small (P3), and both are built into Bun, so no package is added. The exact length is a tighter bound than 8 MiB and costs nothing: the size is signed.

**Alternatives.** gzip (also built in; 25 times slower on random data in P3). No compression (the design's first choice; reversed by point 8). Hashes of the plain pieces in `chunks`, so a later run could reuse staged pieces: the runner would open every piece at upload, and a relay would learn a fingerprint per 8 MiB. `secretstream`: a new primitive for no gain (design, part 4.1 (b)).

**Note.** Core has no runtime import today. Compression brings `node:zlib` into core. The other way is for the CLI and the runner to pass compress and decompress functions in. Both callers are Bun programs.

### D-C7. How Railpack's plan travels

**Decision.** As one more sealed piece, made and checked like a code piece (compressed, sealed, opened to exactly `plan.size`), uploaded with `pack`, staged by its hash. `LIMITS.planBytes` is 256 KiB (the hand test's plan was 3,984 bytes). Plan pieces count apart from the 64 code pieces, at most one per build.

**Why.** FR-027 wants it sealed. FR-049 wants it kept outside the folder of code, which a separate piece gives at once. The code's fingerprint stays the code's, so two services with different plans still share one pack.

**Alternatives.** Inside the tar at a reserved path: the runner must pull it out and keep it out of the folder, and the code's fingerprint would depend on the plan. In the payload in the clear: a relay would read it (FR-027) and it eats the 1 MiB payload.

### D-C8. Protocol numbers

**Decision.** Two: 6 when runner 0.1.2-dev.1 builds with a Dockerfile, 7 when 0.1.2-dev.2 builds with Railpack. Step 1b takes the number of the release that first carries it, 6 or 7, and adds none. Each later lift (Railpack with build secrets, a fresh Railpack build, Railpack with no network) takes a number of its own. The CLI keeps the thresholds, as `ROUTES_PROTOCOL` is kept today (`deploy-format.ts:32`): `DOCKERFILE_BUILD_PROTOCOL = 6`, `RAILPACK_PROTOCOL = 7`, `BUILD_SECRETS_PROTOCOL = 6 or 7`.

**Why.** zekno must know before signing what a runner builds (FR-082), and the `version` answer is strict in every released zekno, so it cannot carry a list of builders. With one number, a step-1 runner and a step-2 zekno could only meet with a refusal after signing.

**Cost.** A zekno of step 1 meets a runner of step 2 with C7 and must be updated, even for an image deploy, as today's rule says.

### D-C9. What a runner carries out

**Decision.** `carriedOut` reads one table in core, changed per release:

| Refused `unsupported_version` | Step 1 | Step 1b | Step 2 |
|---|---|---|---|
| `builder.name === "railpack"` | yes | yes | no |
| a build with `secrets` not empty | yes | no | no |
| Railpack with `secrets` not empty | yes | yes | yes (FR-037h) |
| Railpack with `fresh === sequence` | yes | yes | yes (FR-021a, until R10 is answered) |
| Railpack with `network: "none"` | yes | yes | yes (point 18) |
| `predeploy` not null | yes | yes | yes |

**Why.** These are refusals of what is well-formed but not yet carried out, so each later lift is a protocol number, never a format change.

### D-C10. Refusals, outcomes, report fields and events

**Decision.**

- `DEPLOY_V2_REFUSALS` gains `pack_missing` and `pack_mismatch`. `pack_missing` carries `missing`: the sealed hashes the runner lacks, sorted, each once, at most 72. `pack_mismatch` covers a piece that is not listed, does not open, opens to another length, a pack not in the one form, a pack or plan whose fingerprint differs, and a plan naming an image not signed. Lines R11's draft `build_mismatch` becomes this code.
- `RUNNER_REFUSALS` gains `low_disk` (with `disk: { free, floor }` in bytes), `docker_too_old` and `no_build_plugin`.
- `RUNNER_OUTCOMES` gains `build_failed`, which always carries `build: { key, reason }`. `reason` is one of `step_failed`, `out_of_memory`, `out_of_disk`, `time_limit`, `wrong_processor`, `cache_used`, `team_changed`, `runner_restarted` (FR-031a, lines E19). `wrong_processor` adds `arch: { image, server }` from a fixed list; `out_of_disk` adds `disk`; `team_changed` adds the team list's version.
- `busy` may carry `building: { app, seconds, limit }`, only in a `deploy` answer of protocol 6, as `startLimit` is carried only by `deploy`. So no older zekno reads it.
- Events of `deploy`: `{ event: "build", key, state: "kept" | "building" | "built" | "failed" }`, and `{ event: "build_line", key, part: "output" | "step" | "error", line }` with `line` at most 4,096 characters. Text for a person, never trusted, as `progress` is. The longest such frame is about 25 KiB written out, so `deploy` keeps its 64 KiB bound and the test that it equals `apply`'s.
- A report still has no free text.

**Why.** Each new sentence of lines.md (E1 to E19, R11 to R14) gets the value it names, and nothing more. The builder's text travels only as events, in the session of the zekno that sent the deploy (FR-031a).

### D-C11. Session commands

| Command | Input | Answer | Frame bound |
|---|---|---|---|
| `pack` (new) | `{ envelope, piece }`, `piece` base64url of at most `sealedPieceBytes` | `{ staged: hex64 }`, or a report: a refusal of the gate, `pack_mismatch` (not listed, or over the bound), `too_large` (staging past 2 GiB) | 4 KiB |
| `builds` (new) | `{ app }` | kept builds (key, image id, deploy), fresh generations (base key, number), the build under way, the last outcome, and the records of FR-066 for the kept builds | 256 KiB |
| `deploy` | unchanged | new refusals, outcome and events above | 64 KiB, unchanged |

The `pack` gate is K4 to K10 of `verifyDeployV2`, F7 included, split out so both use one code path, then "the deploy lists this piece among its `chunks` or a plan's `piece`". Nothing is used up. A request is at most about 12.7 MiB, within the 32 MiB line.

**Why.** `builds` is needed anyway for `zekno status` (FR-080) and gives D-C3 its generations and FR-064 a check before signing (lines.md, unclear point 7). A new command keeps `status` unchanged for every older zekno.

### D-C12. The stored state, mark 5

**Decision.** Mark 4 plus:

```ts
builds: Record<app, {
  kept: { key: hex64, image: "sha256:<64 hex>" }[]      // at most 24, sorted by key
  deploys: { sequence: number, keys: hex64[] }[]        // at most 3, newest first; their keys are exactly `kept`
  fresh: { base: hex64, sequence: number }[]            // at most 24, sorted by base
  last: { sequence, outcome: "built" | "kept" | "build_failed", reason?, at } | null
}>
building: { app, sequence, keys: hex64[], since: time, limit: seconds } | null
```

Rules: every app in `builds` is at format 2; `last.sequence` and every `deploys[].sequence` at most the app's last number; `building.app` has its last number equal to `building.sequence`. `readRunnerState` reads marks 4, 3, 2 and none forward with `builds: {}` and `building: null`. `verifyDeployV2` writes mark 5 and carries `builds` and `building` over unchanged, as it does `routes`. The records of FR-066 (Docker and BuildKit versions, the reader, the cache, base digests) are the server's word for display only, so they live in a per-app file the runner keeps, under a strict schema in core, not in `state.json`.

A pure function `keepAfter(appBuilds, { sequence, keys, outcome }, running)` gives the next entry and the images to remove: the deploy that runs, and the two newest other deploys whose builds succeeded, deploys with the same keys counted once; a failed build or a reuse never pushes an image out (FR-067).

**Why.** Kept builds decide what runs again, so they sit under the strict state rules and the state lock. `building` gives the busy sentence its values and lets a restarted runner record `runner_restarted` and clean up (FR-031b). Mark 5 makes an older runner put back refuse everything (FR-085). Worst case about 8 KB per app; realistic states stay small.

### D-C13. Names a build is never given

- `args`: today's reserved names, plus the names the builder reads as instructions: `SOURCE_DATE_EPOCH`, `TARGETPLATFORM`, `TARGETOS`, `TARGETARCH`, `TARGETVARIANT`, `BUILDPLATFORM`, `BUILDOS`, `BUILDARCH`, `BUILDVARIANT`, any case (from knowledge of Docker's documented arguments; the plan confirms the list). For a Railpack build, also the credential names below, since its variables reach the build as build secrets (FR-036b). Whether `RAILPACK_*` and `MISE_*` belong there is for FR-089a's checks.
- `args` may not share a name with a secret the deploy lists (FR-036e).
- `secrets`: never `GIT_AUTH_TOKEN`, `GIT_AUTH_HEADER`, or a name starting `HTTP_AUTH_TOKEN_` or `HTTP_AUTH_HEADER_`, any case (FR-037b).
- All are schema rules, so they are `malformed`: zekno cannot sign one, and a runner refuses one with no number used. Lines R15's own reason `credential_secret` is then not needed; zekno says C-lines before signing.
- Railpack's own build arguments `cache-key` and `secrets-hash` hold a hyphen, which no variable name can, so they never collide.

### D-C14. The image name, the Compose text and the app's name

- F6 gains: for each build, the Compose text holds `zekno.invalid/<app>:<key>`; and every `zekno.invalid/` in the text is one of those names. This makes FR-022 ("the key names the image the signed Compose text runs") checkable by the runner, and backs FR-077 up for plain text. It is lexical: a hand-written text could hide a name with a YAML escape. That is not a boundary, since a signer is root on the server anyway.
- An app whose name ends with `-` cannot name an image: Docker's grammar wants each part of a repository name to end with a letter or a digit (from knowledge, not run), and `APP_NAME` allows a trailing hyphen (`secrets.ts:20`). A deploy with builds for such an app is `malformed`, and zekno says so before signing.

### D-C15. Where the code goes

| New or changed | Holds |
|---|---|
| `src/pack/tar.ts` | Name rules, the byte comparator, the header writer, the end. |
| `src/pack/check.ts` | The streaming checker; yields entries for the Railpack folder. |
| `src/pack/pieces.ts` | Cut, compress, seal; `openPiece` for a verified deploy. |
| `src/crypto/hash.ts` | A streaming hash; domains `zekno/v1/plan`, `zekno/v1/build-reads` (and `zekno/v1/pack-time` with D-C5 (B)). |
| `src/deploy/builds.ts` | `BuildSchema`, the image grammar, `buildKey`, `buildReadsStamp`, the builds rules of F6, the carried-out table. |
| `src/deploy/later-fields.ts` | Only `predeploy`, as `routes-and-checks.ts` took routes. |
| `src/deploy/gate.ts` | K4 to K10, shared by `verifyDeployV2` and the `pack` gate; brings `deploy-v2.ts` back under 400 lines. |
| `src/deploy/kept-builds.ts` | Mark 5's builds part, `keepAfter`, `signerStillAllowed`. |
| `src/deploy/railpack-plan.ts` (step 2) | `railpackPlanImages`. |
| `src/protocol/build-messages.ts` | `pack`, `builds`, the new events and report parts. |

No folder is named `build`. Tests mirror these folders. No package is added: libsodium's streaming hash (P1) and Bun's zstd (P2) are already there.

### D-C16. New limits

`packEntries` 50,000; `packPathBytes` 255; `sealedPieceBytes` 8 MiB + 64 KiB; `planBytes` 256 KiB; `railpackImages` 8; `stagingBytes` 2 GiB; `stagingMs` 24 hours; `keptDeploysPerApp` 3; `keptBuildsPerApp` 24; `freshPerApp` 24; `baseDigestsPerBuild` 16; `buildCacheBytes` 10 GiB; `diskFloorBytes` 2 GiB (FR-040, to confirm); `buildDefaultSeconds` 1,800. The warning size and the 40 last lines are zekno's.

## 4. Older and newer programs

| Pairing | What happens |
|---|---|
| zekno of step 1 → runner 0.1.1, a deploy that builds | Stops before signing (lines F1), from protocol 5 < 6. |
| The same, a deploy with no build | As in feature 015. |
| Runner 0.1.1 handed a signed build anyway | `malformed` from its strict schema, no number used. Lines F11 assumes `unsupported_version`: zekno should give F11's sentence for `malformed` from a runner below protocol 6. |
| Runner 0.1.1 handed `pack` or `builds` | `invalid_request`. |
| zekno 0.1.1 → runner of protocol 6 | C7 before any deploy (FR-084). `status`, `logs`, `records`, `proxy` answer as before; no new field reaches them. |
| zekno of step 2 → runner of step 1, Railpack | Stops before signing (F2). Handed one anyway: `unsupported_version`, no number. |
| zekno of step 1b → runner without build secrets | Stops before signing (F3). Handed one anyway: `unsupported_version`. |
| zekno of step 1 → runner of step 2 | C7, even for images. |
| Runner 0.1.1 put back after mark 5 | `invalid_state` for every request. |

## 5. Risks

1. Runner 0.1.1 answers a hand-crafted build `malformed`, not `unsupported_version` (§4); lines F11 must be mapped.
2. JavaScript's string order is not UTF-8 byte order (P6). Every pack sort and check must use the byte comparator from core.
3. File times (D-C5): (C) silently serves stale files in real cases; (A) rests on a BuildKit behaviour not checked here.
4. Fresh builds (D-C3) depend on a read of the runner's word, and may not "stick" across a later code change if Docker resolves an untagged base image to the older local one (base-image resolution is in research part 6, not established).
5. The CLI must keep every sealed piece from signing to the end of upload (up to about 512 MiB), since sealing again changes the signed hashes.
6. Splits are needed before anything is added: `deploy-v2.ts` 443 lines, `state.ts` 391, `session.ts` 302.
7. Tests that pin today's refusals all change: `later-fields.test.ts` (15 tests pin today's shape and key, and read "passes" as `unsupported_version`), `state.test.ts:179` (mark 5 refused), `messages-v2.test.ts:184-185` (protocol 5).
8. `node:zlib` is core's first runtime import (D-C6).
9. An app named with a trailing hyphen cannot be built (D-C14).
10. The Compose rule of D-C14 is lexical and can be bypassed by escapes; it is a consistency check, not a defence.

## 6. Not settled here

- Whether BuildKit keeps tar times in images and leaves them out of its cache key (decides D-C5 (A)).
- Railpack's plan format: how `railpackPlanImages` finds every image, and whether the frontend takes variables as build secrets (FR-089a).
- How the runner learns a build's reference before the build ends, so that a restart can remove Docker's record of it (FR-031b).
- The exact list of builder-reserved names (D-C13) and the Railpack additions.
- Whether `planBytes` of 256 KiB fits real monorepo plans.
- The fixed list of processor names for `arch`.

## For the plan

- The build entry names its builder as a union, `dockerfile` or `railpack`; Railpack's version, frontend, images and plan fingerprint are in it from step 1.
- The build key is `hash("zekno/v1/build", JSON.stringify([pack hash, recipe, args, [secret, listed hash], network, fresh]))`.
- `fresh` is a deploy number in the key; equal to the deploy's own number it requests a fresh build; later deploys sign the generation the runner reports.
- The pack is ustar in one form: files and folders only, UTF-8 byte order, fixed mode, owner and time, names up to 255 bytes split by `prefix`, no pax, no links.
- Pieces are 8 MiB of the tar, each compressed with zstd, then sealed; each opens to exactly its signed length or is `pack_mismatch`.
- Railpack's plan travels as its own sealed piece, signed by fingerprint, size and sealed hash.
- Two protocol numbers: 6 for step 1, 7 for step 2; step 1b rides on the first that carries it; each later lift takes its own.
- `carriedOut` reads one table of what this core carries out.
- New refusals `pack_missing` (with the missing hashes), `pack_mismatch`, `low_disk`, `docker_too_old`, `no_build_plugin`; new outcome `build_failed` with a fixed reason list; build events in `deploy` only.
- New commands `pack` and `builds`; `status` stays as it is.
- State mark 5 with kept builds, deploys, fresh generations, the build under way and the last outcome; records of FR-066 in a per-app file.
- Credential names and builder-instruction names are schema rules (`malformed`); R15 is dropped.
- F6 binds each build key to its image name in the Compose text.
- Code goes into `src/pack/`, `deploy/builds.ts`, `deploy/gate.ts`, `deploy/kept-builds.ts`, `protocol/build-messages.ts`; no package is added.

## Needs the maintainer

- **File times in the pack** (D-C5): (A) the runner gives files the build's time as it streams, recommended; (B) times made from content; (C) one fixed time, documented.
- **Compression format** (D-C6): zstd, recommended, or gzip. Both are built into Bun, so no package; but it is a format choice that a later change would cost a protocol number.
- **Core importing `node:zlib`** (D-C6): its first runtime module, or functions passed in by the CLI and the runner.
- **What a rollback after a fresh build runs** (D-C3): the image of the deploy named, recommended, at the cost of a read before signing; or the fresh image, with a simpler format.
- **Apps whose name ends with a hyphen** (D-C14): refuse their builds, recommended, or change how built images are named.
- **Names longer than 255 bytes** (D-C4): refused before signing, recommended, or pax records with a larger runner checker.
- **Lines that change with these choices**: R11 takes `pack_mismatch`; R15 goes; F11 is said for `malformed` from an older runner.
