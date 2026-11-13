# @workspace/core

The one place where Zekno's keys are made, secrets are encrypted, deploys are signed and checked,
and team membership is proven. Every client and the server agent use it, so both ends encrypt and
verify in exactly the same way.

> **Unaudited.** The cryptographic building blocks are libsodium's. How they are combined here
> has had an internal review only. Do not rely on it in production before an external audit.

## What it guarantees

The control plane between a client and a server is treated as hostile. With this library it cannot:

- read a secret: values are sealed for one server's public key;
- make a server run something: a deploy needs a current team member's signature;
- replay or redirect: deploys are numbered per app and addressed to one team and one server;
- swap, plant, roll back or revive secrets: each secret is signed by the member who set it, bound
  to its name, app and server, and versioned; retiring one is a signed removal the server remembers;
- change the team: each team list is signed by an admin of the list before it, in order;
- substitute a server's key: server keys are in the admin-signed team list, added by an admin
  who compared a short code with the one shown on the server;
- substitute the team: a new server or teammate pins the team by a short code any member can
  read out from their own client.

It cannot stop the control plane from withholding messages, and it does not protect against a
compromised team member's machine or a compromised server.

## Use

```ts
import { createDeploy, createSecret, openSecrets, verifyDeploy } from "@workspace/core"
```

A complete round trip is in
[`specs/002-core-library/quickstart.md`](../../specs/002-core-library/quickstart.md), and the
full list of functions, message formats and refusal codes is in
[`contracts/api.md`](../../specs/002-core-library/contracts/api.md).

Two rules shape the interface:

1. **Nothing decrypts before it is verified.** `openSecrets` accepts only what `verifyDeploy`
   returned.
2. **Nothing unsigned is trusted.** There is no public way to seal a secret without signing it,
   and `createDeploy` verifies every secret it is given.

The library does no I/O and keeps no state. The agent stores the state `verifyDeploy` hands back;
clients store keys however they choose and pass in a `Signer`.

An agent must process deploys one at a time (verify, persist `nextState`, open, run). What was
reviewed, what was fixed and what remains open is in
[`security-review.md`](../../specs/002-core-library/security-review.md).

## Develop

```bash
bun test                  # unit tests and end-to-end scenarios
bun test test/scenarios   # only the scenarios: client, hostile relay and agent
bun run typecheck
```

Source files are internal apart from `src/index.ts`. `src/limits.ts` holds every size limit and
`src/result.ts` every refusal code.
