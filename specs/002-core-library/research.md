# Research: Core Library

Decisions made before design. The library API was read from the installed type definitions at
`packages/core/node_modules/libsodium-wrappers/dist/modules-esm/libsodium-wrappers.d.mts`.

## R1. Cryptographic library

- **Decision**: `libsodium-wrappers` 0.8.4.
- **Rationale**: one audited, widely deployed library gives every building block the spec needs
  through high-level functions that are hard to misuse: `crypto_sign_detached` and
  `crypto_sign_verify_detached` (Ed25519), `crypto_box_seal` and `crypto_box_seal_open` (anonymous
  encryption to a public key), `crypto_generichash` (BLAKE2b), `randombytes_buf`, `memcmp`
  (constant time) and `memzero`. It is WebAssembly embedded in JavaScript, so it runs in Bun, in
  Node and inside a compiled single-file runner with no native build step.
- **Alternatives considered**: the `@noble` packages are audited and smaller, but have no sealed
  box, so the library would have to compose its own public-key encryption scheme, which FR-027
  rules out. HPKE (RFC 9180) through `@hpke/core` is the modern standard but adds three packages
  and brings no property this feature needs. Node's built-in crypto has no sealed-box equivalent
  either.

## R2. Encrypting a secret for a server

- **Decision**: a libsodium sealed box to the server's X25519 public key. The plaintext is a small
  JSON record `{ v, serverId, app, name, value }`, and the deploy carries a BLAKE2b hash of each
  ciphertext.
- **Rationale**: a sealed box needs no sender key, which fits FR-006. It has no associated data,
  so the binding of FR-007 is done twice: inside the plaintext (checked after opening) and by the
  signed hash in the deploy (checked before opening). Either alone stops the relay exchanging two
  ciphertexts; both together mean a mistake in one check is not fatal.
- **Limit**: ciphertext length reveals value length. Padding is left for a later version.

## R3. Signing without canonical JSON

- **Decision**: sign exact bytes. An envelope carries `payloadType`, the payload bytes as
  base64url, and one signature. What is signed is `"zekno-sig-v1\n" + payloadType + "\n" +
  byteLength + "\n" + payload`. The verifier checks the signature over the bytes it received and
  only then parses them.
- **Rationale**: canonical JSON is a classic source of signature bugs. Signing bytes removes the
  problem. Including `payloadType` in the signed prefix gives the separation of FR-012: a deploy
  signature can never verify as a team-list signature. This is the approach of the DSSE envelope
  used by in-toto and Sigstore.
- **Alternatives considered**: JCS canonical JSON (RFC 8785): more code and a second parser to
  trust. A binary format such as CBOR: no benefit at this size and harder to inspect.

## R4. Team membership

- **Decision**: a hash chain of signed team lists. The founding list is version 1, signed by an
  admin it contains. List N+1 names the hash of list N and is signed by an admin of list N. A
  server pins the founding list at pairing and then only moves forward one step at a time.
- **Rationale**: answers "who vouches for a new teammate" without trusting the relay (FR-018,
  FR-019). Version numbers plus the previous-hash stop reordering and rollback.
- **Limit**: the relay can withhold a newer list, so a removed member keeps working on a server
  that has not received the removal. Recorded in the spec's assumptions.

## R5. Replay protection

- **Decision**: each deploy carries a `sequence` number per app. The runner remembers the last
  accepted number for each app and refuses anything not higher. A rollback is a new signed deploy
  with the next number and the old content.
- **Rationale**: simple, needs no clock (the spec assumes clocks may be wrong), and makes the
  runner's persistent state one integer per app. Binding the deploy to `teamId` and `serverId`
  stops cross-server and cross-team replays.
- **Alternatives considered**: expiry times (depends on clocks); a hash chain of deploys (stops
  two members deploying concurrently without coordination).

## R6. Server identity and confirmation codes

- **Decision**: a server's identifier is derived from its public key (`srv_` plus a BLAKE2b
  hash). A confirmation code is 100 bits of a domain-separated BLAKE2b hash, shown as five groups
  of four Crockford base32 characters.
- **Rationale**: deriving the id from the key means "a deploy for server A" and "a secret sealed
  for key A" are the same statement, with no registry the relay could edit. 100 bits makes finding
  a second key with the same code infeasible while staying short enough to read aloud. Crockford
  base32 avoids look-alike characters, and comparison folds the ones people still confuse.

## R7. Enforcing "verify before decrypt"

- **Decision**: `verifyDeploy` returns an object registered in a module-private `WeakSet`.
  `openSecrets` accepts only an object found in that set.
- **Rationale**: FR-015 asks that there be no way to skip the check. A TypeScript brand alone can
  be forged with a cast; the `WeakSet` makes it a runtime fact.

## R8. Validation and limits

- **Decision**: zod strict objects for every payload and message; byte-size checks before parsing;
  all limits in `limits.ts`.
- **Rationale**: FR-024. Strict objects reject unknown fields, which keeps a later format version
  from being half-understood by an older runner.

## R9. Loading libsodium

- **Decision**: `sodium.ts` awaits `sodium.ready` at module top level, so every exported function
  is synchronous.
- **Rationale**: all callers are ES modules on Bun. A synchronous API is simpler and removes the
  "forgot to initialise" class of bug.

## R10. Key handling

- **Decision**: keys travel as marked text (`zk_mpk_`, `zk_msk_`, `zk_spk_`, `zk_ssk_` plus
  base64url). Signing goes through a `Signer` (`publicKey` plus `sign(bytes)`), which a client can
  back with the OS keychain. Decoded private-key bytes are zeroed after use where the library
  controls them.
- **Rationale**: FR-002, FR-004, FR-005. Marked prefixes make a leaked private key easy to scan
  for. JavaScript strings cannot be zeroed, which is a documented limit.
