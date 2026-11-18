# Contract: the version-2 deploy message

FR-001 to FR-005, FR-036, FR-046. The design's part 5 is the source of every rule; this contract
states each rule this step enforces, in the words a test is written from. Built in
`packages/core/src/deploy/message.ts` (the payload) and `deploy/later-fields.ts` (builds, predeploy,
health, routes); signed by `createDeployV2`, read by `readSignedDeployV2` and `verifyDeployV2`
(`deploy/deploy-v2.ts`). The CLI runs the same reader before it signs (FR-005): `createDeployV2`
throws `CoreError("invalid_argument")` for anything `readDeployV2Payload` would refuse.

## The envelope

- **F1.** Kind `zekno.deploy.v2` (`PAYLOAD_TYPES.deployV2`), signed as every kind
  (`signingInput`: `zekno-sig-v1\n<kind>\n<length>\n` then the payload), so the kind is inside the
  signature. `readEnvelope` refuses another kind (`wrong_payload_type`) before any signature.
- **F2.** The payload is at most `LIMITS.payloadBytes` (1 MiB); `signEnvelope` refuses more
  (`too_large`), `readEnvelope` too.
- **F3. Pairings of kind and `v`** (SC-002): `zekno.deploy.v2` with `v: 2` is read; with `v` 1, 3,
  `"2"`, missing, or any other value: `malformed`. `zekno.deploy.v1` with `v: 1` is read by
  version 1, as today; with any other `v`: `verifyDeploy` refuses `unsupported_version` and
  `readSignedDeploy` refuses `malformed`, as today. A version-2 envelope given to `verifyDeploy` or
  `readSignedDeploy`, and a version-1 envelope given to `verifyDeployV2` or `readSignedDeployV2`:
  `wrong_payload_type`.

## Reading the payload: `readDeployV2Payload(json)`

Pure; no signature, no state. Returns the payload, or `malformed`, or `unsupported_version`:

1. **F4.** JSON that is an object (`parseJson`; else `malformed`).
2. **F5.** The strict schema: every field below present, no other field, each value its type and
   rule (`malformed`). A value outside a rule is never clamped, defaulted or ignored (FR-004).
3. **F6.** The cross-field rules below (`malformed`).
4. **F7.** Only now: `builds` not `[]`, `predeploy` not `null`, `health` not `null`, or `routes`
   not `[]` is `unsupported_version` (FR-036). A later field that breaks its own rule was refused
   `malformed` at step 2 or 3 first.

Where the signed bytes are read, F41 comes between step 3 and step 4.

## One spelling (F41)

- **F41.** A version-2 payload has one spelling. Where its signed bytes are read
  (`readDeployV2Bytes` in `deploy/message.ts`, used by `verifyDeployV2` at K6 and by
  `readSignedDeployV2`), after F4 to F6 and before F7: the payload's text must equal
  `JSON.stringify` of what the reader gives for it, which is the text `createDeployV2` signs;
  otherwise `malformed`. One rule refuses a key written twice (`JSON.parse` keeps the last; another
  reader may keep the first), a number written another way (`-0`, `1e0`, `1.0`), whitespace
  anywhere, an escape `JSON.stringify` does not write (`\u0061` for `a`, `\/`), and keys in
  another order than the format's: the reader gives the fields in the order of the tables below.
  Every object of the payload is a strict object with fixed field names, none of which looks like
  a number, and none has keys of free text, so the order JavaScript gives keys that look like
  numbers never comes into it (such a key is an unknown field, refused at F5). Version 1 and the
  secret statements are read as before (FR-003). Security review S5 and S6.

## Fields carried out in this step

| # | Field | Type and rule | Limit |
|---|---|---|---|
| F8 | `v` | the number `2` | |
| F9 | `teamId` | `TEAM_ID` | |
| F10 | `teamHash` | `^[0-9a-f]{64}$` | |
| F11 | `serverId` | `SERVER_ID` | |
| F12 | `app` | `APP_NAME` | |
| F13 | `previous` | whole number | 0 to 2^53 - 2 |
| F14 | `sequence` | whole number, exactly `previous + 1` (F6) | 1 to 2^53 - 1 |
| F15 | `createdAt` | `isoTime` (as version 1) | |
| F16 | `expiresAt` | `null`, or `isoTime` that equals `new Date(expiresAt).toISOString()` | |
| F17 | `compose` | text | at most 256 KiB as UTF-8 (`LIMITS.composeBytes`) |
| F18 | `secrets[]` | `{ name: secretName, hash: 64 hex, version: secretVersion }`, strict | at most 256 |
| F19 | `removed[]` | `{ name: secretName, version: secretVersion }`, strict | at most 256 |

Cross-field (F6): `secrets` sorted by name, unique; `removed` sorted by name, unique; no name in
both; `sequence === previous + 1`; and the later fields' rules marked "F6" below.

## Fields fixed now, carried out later

Each is checked in full now (step 2 or 3) and then refused by F7 when present.

| # | Field | Type and rule | Limit |
|---|---|---|---|
| F20 | `builds[]` | strict objects | at most 8 (`LIMITS.buildsPerDeploy`) |
| F21 | `builds[].key` | 64 hex; equal to `buildKey(build, secrets)` (F6, below) | |
| F22 | `builds[].pack` | `{ hash: 64 hex, size, chunks }`, strict | |
| F23 | `builds[].pack.size` | whole number | 1 to 512 MiB (`LIMITS.packBytes`) |
| F24 | `builds[].pack.chunks[]` | 64 hex each; count = `ceil(size / 8 MiB)` (F6) | 1 to 64; at most 64 distinct across all builds (`LIMITS.chunksPerDeploy`, F6) |
| F25 | `builds[].dockerfile` | 1 to 255 characters, well-formed, no `\p{C}`, U+2028 or U+2029, and `staysInside` (`deploy/link.ts`) | |
| F26 | `builds[].target` | `null`, or `^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$` | |
| F27 | `builds[].args[]` | `{ name, value }`, strict; name `SECRET_NAME`, at most 128, not `isReservedSecretName`; value well-formed, no NUL; sorted by name, unique (F6) | 32 per build; a value at most 4 KiB as UTF-8; all values of a deploy at most 64 KiB (F6) |
| F28 | `builds[].secrets[]` | names (`secretName`), sorted, unique; each in the deploy's `secrets[]` (F6) | 32 per build |
| F29 | `builds[].network` | `"default"` or `"none"` | |
| F30 | `builds[].timeout` | whole seconds | 1 to 7,200 |
| F31 | `predeploy` | `null`, or `{ service, command, timeout }`, strict | |
| F32 | `predeploy.service` | `SERVICE_NAME` | |
| F33 | `predeploy.command[]` | words, each well-formed, no NUL | 1 to 64 words; each at most 4,096 characters; all at most 16 KiB as UTF-8 (F6) |
| F34 | `predeploy.timeout` | whole seconds | 1 to 3,600 |
| F35 | `health` | `null`, or `{ timeout, services }`, strict | |
| F36 | `health.timeout` | whole seconds | 1 to 1,800 |
| F37 | `health.services[]` | `{ service: SERVICE_NAME, http }`, strict; sorted by service, unique (F6) | 1 to 16 |
| F38 | `health.services[].http` | `null`, or `{ port, path }`, strict; port 1 to 65,535; path the path rule | |
| F39 | `routes[]` | `{ domain, service: SERVICE_NAME, port: 1 to 65,535 }`, strict; sorted by domain, unique (F6) | at most 64 |
| F40 | `routes[].domain` | the domain rule | |

**The domain rule (F40).** Lowercase ASCII; at most 253 characters; at least two labels; each label
1 to 63 of `[a-z0-9-]`, not starting or ending with `-`; a label starting `xn--` only when
`domainToUnicode(label)` (`node:url`) is not empty and `domainToASCII` of that equals the label; the
last label not all digits; no trailing dot, no `*`; not `localhost`, and not ending in `.invalid`,
`.test`, `.example`, `.local`, `.localhost`, `.internal`, `.alt`, `.onion` or `.arpa` (or being one
of those names). Two spellings of one domain cannot both pass.

**The path rule (F38).** Starts with `/`; at most 1,024 characters; only
`A-Z a-z 0-9 - . _ ~ ! $ & ' ( ) * + , ; = : @ / ?` and `%` followed by two hex digits; no space, no
`#`: `^/(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9A-Fa-f]{2}){0,1023}$`.

**The build key (F21).** `toHex(hash("zekno/v1/build", utf8(JSON.stringify([pack.hash, dockerfile,
target, args.map((a) => [a.name, a.value]), build.secrets.map((n) => [n, hashOf(n)]), network]))))`
where `hashOf(n)` is the `hash` the deploy's `secrets[]` lists for `n`. Only arrays, strings and
`null` go in, so both sides compute the same bytes. Exported as `buildKey(build, secrets)`.

**Not added** (part 5 says nothing): an order or uniqueness rule on `builds[]`; uniqueness of a
build's chunk hashes within one build.

## New limits (`packages/core/src/protocol/limits.ts`)

`buildsPerDeploy` 8, `packBytes` 512 MiB, `chunkBytes` 8 MiB, `chunksPerDeploy` 64,
`argsPerBuild` 32, `argValueBytes` 4 KiB, `argBytesPerDeploy` 64 KiB, `buildSecretsPerBuild` 32,
`dockerfileLength` 255, `buildSeconds` 7,200, `predeployWords` 64, `predeployWordLength` 4,096,
`predeployBytes` 16 KiB, `predeploySeconds` 3,600, `healthServices` 16, `healthPathLength` 1,024,
`healthSeconds` 1,800, `routesPerDeploy` 64, `domainLength` 253, `recordBytesPerServer` 64 MiB,
`expiryWindowMs` 7 days. Part 8's other limits (domains per server, staging, kept builds, the build
cache, `up` time) join with the features that use them.

`statementPayloadLength` 4,096: the characters of a secret statement's payload, as base64url,
where a runner takes a supplied record (K13), where it answers `records`, and in what a client
keeps (`held/`). A real statement is under 1 KiB: the longest app name, secret name, version and
time give fewer than 1,024 characters, so nothing `createSecret` signs comes near it. A longer
statement is padding, which a runner would keep and hand out at every `records` read (security
review S2).

## The hash domains (`crypto/hash.ts`)

`HashDomain` gains `zekno/v1/pack`, `zekno/v1/pack-chunk` and `zekno/v1/build`. None contains a
zero byte; the nine labels differ (a test checks both).

## Signing: `createDeployV2`

```ts
createDeployV2(input: {
  trust: TeamTrust
  serverId: string
  app: string
  previous: number
  compose: string
  statements: readonly Envelope[]   // secret statements (zekno.secret.v1), this machine's or the runner's
  removals: readonly Envelope[]     // removals (zekno.secret-removal.v1)
  expiresAt: Date | null
  later?: { builds?: Build[]; predeploy?: Predeploy | null; health?: Health | null; routes?: Route[] }  // tests only
  signer: Signer
  now?: Date
}): Promise<Envelope>
```

It refuses a signer not in `trust` (`not_member`), a server not in it (`unknown_server`), a
Compose text past 256 KiB (`too_large`), a statement or removal that does not verify for this team,
server and app (`untrusted_secret`, with the reason in its message), a name given twice
(`invalid_argument`), and a payload the readers would not read as itself, in its one spelling
(`readDeployV2Bytes`, F41; `invalid_argument`). The listing is taken only from the statements it verified (FR-021): `name`,
`version`, `hash` from each, sorted. `expiresAt` is written with `toISOString()`. The CLI never
passes `later`.

## Reading: `readSignedDeployV2({ envelope, trust })`

As `readSignedDeploy`: the signer must be a member of `trust`, and the payload must pass F4 to F6
and F41 (`malformed` otherwise). F7 is not applied: a reader of the history does not judge what a runner
carries out. Gives `{ deploy, signer }`.
