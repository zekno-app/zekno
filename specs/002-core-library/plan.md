# Implementation Plan: Core Library

**Branch**: `002-core-library` | **Date**: 2026-11-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-core-library/spec.md`

## Summary

Build `packages/core`, a TypeScript library with no framework, network or storage code. It gives
clients and the runner one implementation of: member and server keys, secrets sealed for one
server, deploys signed by a member, a signed chain of team lists, confirmation codes for pairing,
a runner-side check that must pass before anything can be decrypted, and validated definitions of
every message exchanged with the control plane.

Cryptography comes from libsodium (through `libsodium-wrappers`): Ed25519 signatures, sealed boxes
for encryption to a server's public key, BLAKE2b for hashes. The library composes these and
implements no primitive of its own. Untrusted input is validated with zod before use.

## Technical Context

**Language/Version**: TypeScript 5, ES modules, target ES2022

**Primary Dependencies**: `libsodium-wrappers` 0.8.4 (audited libsodium compiled to WebAssembly), `zod` 4.6.7 (validation of untrusted input)

**Storage**: none. The runner and clients store what the library returns.

**Testing**: `bun test`. Unit tests beside each concern, plus end-to-end scenario tests that play the client, a hostile relay and the runner against each other.

**Target Platform**: Bun 1.4 (CLI, runner, desktop main process). Also loads on Node 26. Not intended for browsers: the website never handles keys.

**Project Type**: library in the existing Bun workspace (`packages/core`)

**Performance Goals**: verify and open a deploy with 50 secrets in under 100 ms on a laptop (SC-004)

**Constraints**: no I/O; no state kept between calls; no key material in errors or logs; every refusal is a typed result with a stable code

**Scale/Scope**: about 12 source files, roughly 900 lines, plus tests. Limits: 256 secrets per deploy, 64 KiB per secret value, 256 KiB service definition, 64 team members.

## Constitution Check

*GATE: checked before research and again after design.*

| Principle | How this plan complies | Status |
|-----------|------------------------|--------|
| I. Security Promise First | This library is the promise. No hosted party ever needs a private key; nothing here depends on closed code; no credentials are committed, and test keys are generated at run time. | Pass |
| II. Honest Surface | Not a visitor-facing surface. The quickstart and README state that the design is unaudited. | Pass |
| III. Read the Installed Docs First | No framework code. The library's API was read from the installed `libsodium-wrappers` type definitions before design (see research.md). | Pass |
| IV. One Design System | No UI. | N/A |
| V. Motion With Purpose | No UI. | N/A |
| VI. Accessible and Fast by Default | No UI. The performance goal is SC-004. | N/A |
| VII. Verified Before Done | Typecheck and `bun test` from the repository root; end-to-end scenarios for every attack in the spec; an internal security review pass at the end. Browser checks do not apply to a library. | Pass |

No violations, so Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-core-library/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── api.md           # public functions, message formats, refusal codes
├── checklists/requirements.md
└── tasks.md             # created by /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/
├── package.json         # @workspace/core
├── tsconfig.json
├── src/
│   ├── index.ts         # the public interface; nothing else is imported by callers
│   ├── sodium.ts        # loads libsodium once
│   ├── encoding.ts      # bytes, base64url, hex, UTF-8 checks
│   ├── result.ts        # Result type, CoreError, refusal codes
│   ├── limits.ts        # every size and count limit in one place
│   ├── hash.ts          # domain-separated BLAKE2b
│   ├── keys.ts          # member and server keys, key ids, signers
│   ├── confirm.ts       # confirmation codes
│   ├── envelope.ts      # sign and verify exact bytes, per message kind
│   ├── roster.ts        # team lists: founding, updating, applying
│   ├── secrets.ts       # seal and open one secret
│   ├── deploy.ts        # create, verify, open; the runner-side gate
│   └── protocol.ts      # message definitions for the control plane
└── test/
    ├── *.test.ts        # unit tests per concern
    ├── helpers.ts       # a team, a server and a relay an attacker controls
    └── scenarios/       # end-to-end scenarios, one file per user story
```

**Structure Decision**: one flat library package. Callers import only from `@workspace/core`
(`src/index.ts`); the other files are internal. A single small interface over the cryptography is
the point: the CLI, runner and desktop app cannot each get verification order or domain separation
subtly wrong if there is one function that does it. Root `turbo.json` already has `typecheck` and
`test` tasks, so the package joins the existing checks by declaring those scripts.

## Complexity Tracking

No constitution violations to justify.
