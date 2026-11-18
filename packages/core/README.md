# @workspace/core

The one place where Zekno's keys are made, secrets are encrypted, deploys are signed and checked,
and team membership is proven. Every client and the server runner use it, so both ends encrypt and
verify in exactly the same way.

> **Unaudited.** The cryptographic building blocks are libsodium's. How they are combined here
> has had an internal review only. Do not rely on it in production before an external audit.

## What it guarantees

The control plane between a client and a server is treated as hostile. With this library it cannot:

- read a secret: values are sealed for one server's public key;
- make a server run something: a deploy needs a current team member's signature;
- replay, reorder or redirect: every deploy is addressed to one team and one server. A deploy in
  deploy format 2 (`zekno.deploy.v2`) names the deploy of the app it was made after
  (`previous`), and `verifyDeployV2` accepts it only while that is still the runner's last number
  for the app, so a deploy that another one overtook never runs, however long it was held back.
  Deploy format 1 (`zekno.deploy.v1`) is numbered per app, and the runner takes a number only
  above its last;
- swap, plant, roll back or revive secrets: each secret is signed by the member who set it, bound
  to its name, app and server, and versioned; retiring one is a signed removal the server remembers;
- drop a secret without a word: a deploy in format 2 must account for every secret the runner
  holds a live version of, by version, as current or as removed, and a secret whose statement was
  signed by someone the current team list no longer includes stops counting, on a record the
  runner keeps as on one sent with the deploy (`untrusted_secret`);
- change the team: each team list is signed by an admin of the list before it, in order;
- substitute a server's key: server keys are in the admin-signed team list, added by an admin
  who compared a short code with the one shown on the server;
- substitute the team: a new server or teammate pins the team by a short code any member can
  read out from their own client.

The order of deploys never depends on a clock. A deploy in format 2 may carry an expiry, checked
against the time the runner passes in; one taken from the hosted service, when it exists, must
carry one.

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

1. **Nothing decrypts before it is verified.** `openSecrets` accepts only what `verifyDeploy` or
   `verifyDeployV2` returned.
2. **Nothing unsigned is trusted.** There is no public way to seal a secret without signing it,
   and `createDeploy` and `createDeployV2` verify every secret they are given.

The library does no I/O and keeps no state. The runner stores the state `verifyDeploy` or
`verifyDeployV2` hands back, with the records the latter says to write, and hands `verifyDeployV2`
the records it holds; clients store keys however they choose and pass in a `Signer`. Deploy format
2 and its checks are in [`specs/014-deploy-v2/contracts/`](../../specs/014-deploy-v2/contracts/).

A runner must process deploys one at a time (verify, persist `nextState`, open, run). What was
reviewed, what was fixed and what remains open is in
[`security-review.md`](../../specs/002-core-library/security-review.md).

## Develop

```bash
bun test                  # unit tests and end-to-end scenarios
bun test test/scenarios   # only the scenarios: client, hostile relay and runner
bun run typecheck
bun run lint              # ESLint with typescript-eslint; any finding fails
bun run format            # Prettier, the repository's settings
```

Source files are internal apart from `src/index.ts`. `src/protocol/limits.ts` holds every size limit and
`src/protocol/result.ts` every refusal code.

`src` holds `index.ts` and one folder per subject: `crypto/` (keys, envelopes, hashes,
confirmation codes), `team/` (signed team lists), `secrets/` (sealed secrets and their records),
`deploy/` (signed deploys and project links) and `protocol/` (messages, versions, limits,
results).
