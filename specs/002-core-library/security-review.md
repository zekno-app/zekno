# Security Review: Core Library

**Date**: 2026-11-13 · **Scope**: `packages/core/src` · **Kind**: internal, focused review

This is not an external audit. It was done by the same assistant that wrote the library, plus one
independent reviewer that read the finished source without access to the author's reasoning. An
external audit is still required before production use.

**Threat model**: the control plane is fully hostile. It can read, change, drop, reorder, replay
and invent any message, and can register its own keys. A team member's machine and each server
are trusted.

**Outcome**: ten findings were fixed (three high, three medium, four low). No finding is open.
The limits that remain are listed below.

## Fixed

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 1 | High | **Secrets carried no proof of who set them.** Anyone can encrypt to a server's public key, so the control plane could hand a client a ciphertext it made itself and the member would sign a deploy containing it. | Every secret is a signed record (`zekno.secret.v1`) binding the ciphertext to team, server, app, name and version. `createDeploy` verifies every record. There is no public way to seal without signing. |
| 2 | High | **Server keys were not in anything the team signs.** A teammate who was not at the pairing could only get the server's key from the control plane, which could substitute its own and read every secret that teammate set. | Server keys are part of the admin-signed team list. `createSecret` and `createDeploy` take a server id and read the key from the list (`unknown_server` otherwise). A runner refuses deploys when its own server is not listed. |
| 3 | High | **The team's confirmation code could only be computed from a list the control plane supplied** once the team had changed. A substituted founding list would show a matching code and a new server would trust the attacker's team. | Trust carries the founding hash forward. `teamConfirmationCode(trust)` needs nothing from the control plane. The function that computed a code from any envelope was removed from the public interface. |
| 4 | Medium | **A secret could be rolled back under the same version number.** Only the version was remembered, and an equal version was accepted. | The runner remembers version and ciphertext hash, and refuses a lower version or a different value under the same version. |
| 5 | Medium | **A client with an out-of-date team list could deploy a removed member's secret** to an up-to-date server. | A deploy names the team list it was built from; the runner refuses any other (`stale_team`). |
| 6 | Medium | **Missing stored state silently disabled a check.** The secret-version map was optional. | Runner state is validated in full on every call; every field is required; `initialRunnerState` builds it. Damaged stored trust is a typed error. |
| 7 | Low | **A lying control plane could get a member to sign a huge deploy number** and lock an app permanently. | The runner refuses a number more than 1,048,576 above the last one (`sequence_jump`). |
| 8 | Low | **An admin relying on the control plane to echo their own change** could later re-add a removed member by building on a stale list. | `proposeRoster` returns the new trust with the envelope. |
| 9 | Low | **Display names allowed invisible and direction-changing characters**, and a leading byte-order mark was mishandled. | Names reject control, format and line-separator characters and surrounding space. Text decoding no longer drops a leading U+FEFF. |
| 10 | Low | **The control plane could re-offer a secret the team stopped using.** A genuine old record for a retired name still passed verification. | A member signs a removal (`zekno.secret-removal.v1`). `currentSecrets` leaves removed names out and reports anything it ignored; a deploy carries the removal; the runner remembers it as the latest version of that name and refuses the old record. Fixed 2026-11-13 at the maintainer's request. |

Each fix has an end-to-end scenario in `packages/core/test/scenarios` or a case in
`packages/core/test/edge-cases.test.ts`.

## Open

None.

## Limits that are accepted, not defects

- The control plane can withhold deploys and team changes. With finding 5 fixed, a server that is
  behind refuses deploys instead of accepting them, so withholding is visible.
- A compromised team member's machine or server is outside what the library protects.
- The control plane sees metadata: ids, app names, secret names, ciphertext sizes and the service
  definition of each deploy. A secret written directly into the service definition is not protected.
- Status reports from the runner are not signed, so the control plane can misreport outcomes to
  clients. Nothing in the library trusts them.
- Two admins who sign conflicting team lists at the same time can leave servers on different lists.
- Key bytes are zeroed where the library holds them, but JavaScript strings cannot be zeroed and
  libsodium's WebAssembly memory keeps copies until they are overwritten.
- A secret set by a member who is later removed must be set again by a current member. The same
  goes for a removal they signed.
- A removal protects a server once that server has received it in a deploy. Withholding it from
  every deploying client means it has not taken effect there.

## What a runner must do for the guarantees to hold

- Process deploys one at a time: verify, persist `nextState`, open, run. Verifying a batch
  against one state accepts a duplicate twice.
- Persist `nextState` before running a deploy, and never write back a state older than the one
  on disk (for example after applying a team change in between).
- Pass message bodies to `parseMessage` as received text or bytes, so the size limit applies.

## Checked and found sound

Envelope signing (exact bytes, kind and length inside the signature, verify before parse);
base64url and hex canonical forms; key markings and lengths; the team-list chain (admin of the
previous list, next number, previous hash, no rollback or repeat); confirmation codes (100 bits,
constant-time comparison); the order of checks in `verifyDeploy`; the gate between `verifyDeploy`
and `openSecrets`; binding of a sealed secret to name, app and server; prototype pollution through
attacker-chosen names; schema strictness, size limits and regular-expression cost; error messages
(no secret, key or attacker text).

## Dependencies

`libsodium-wrappers` 0.8.4 (ISC) and `zod` 4.6.7 (MIT). `bun audit` on 2026-11-13 reported no
advisory for either. It reported two in existing development tooling elsewhere in the repository
(`minimatch` through ESLint and the shadcn CLI, moderate; `deepmerge` through the shadcn CLI,
low). Neither is a dependency of this library.
