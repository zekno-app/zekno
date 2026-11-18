# Contract: protocol 3

FR-033, FR-037, FR-022, FR-023. Every message is a strict schema in
`packages/core/src/protocol/protocol.ts`; the runner handles the two new commands in
`apps/runner/src/session/session.ts`, the CLI reads them through `apps/cli/src/server/session.ts`.

## The number

- **P1.** `RUNNER_PROTOCOL` becomes `3` and means: the runner carries out version 2 with `previous`,
  `expiresAt` and secrets by version, and answers `deploy` and `records`. It does not carry out
  `builds`, `predeploy`, `health` or `routes` (refused `unsupported_version`, K7), and has no `pack`.
  The runner reports it in `version` (`{"version":"0.1.0","protocol":3}` for a runner built from
  this branch, research R18). It is set in T025, not before.

## The commands

- **P2.** `SESSION_COMMANDS` gains `deploy` and `records`, in that order after `version`. They exist
  only inside a session: `zekno-runner deploy` and `zekno-runner records` stay wrong usage (exit 2),
  as `state` and `logs` are today. A runner from before this feature answers either with
  `invalid_request` before running anything (its closed `SessionRequestSchema`).

| Command | Input | Events | Result | Frame bound (`SESSION_FRAME_BYTES`) | Lock |
|---|---|---|---|---|---|
| `deploy` | `RunnerDeployRequestSchema` | `progress`, Docker's lines, as `apply` | `RunnerReportSchema` | 64 KiB | the deploy lock |
| `records` | `RunnerRecordsRequestSchema` | none | `RunnerRecordsSchema`, or a refusal | 4 MiB | none |

### `deploy`

- **P3.** Request:

  ```ts
  RunnerDeployRequestSchema = z.strictObject({
    rosters: z.array(EnvelopeSchema).max(LIMITS.rosterChain),   // the whole chain, as apply
    envelope: EnvelopeSchema,                                   // kind zekno.deploy.v2
    records: z.array(SecretRecordSchema).max(LIMITS.secretsPerDeploy),
  })
  ```

- **P4.** Answer: `{"outcome":"started","app":<app>,"sequence":<n>}`,
  `{"outcome":"start_failed","app":<app>,"sequence":<n>}`, or `{"outcome":"refused","reason":<r>}`
  with a reason of contracts/runner-checks.md. The three reasons of `DEPLOY_V2_REFUSALS` appear only
  here. The CLI checks `app` and `sequence` against what it signed, as for `apply`.

### `records`

- **P5.** Request: `RunnerRecordsRequestSchema = z.strictObject({ app: z.string().regex(APP_NAME) })`.
- **P6.** Answer:

  ```ts
  RunnerRecordsSchema = z.strictObject({
    statements: z.array(EnvelopeSchema).max(LIMITS.secretsPerDeploy),
  })
  ```

  For each entry `<app>/<NAME>` of the stored state with a hash, the `envelope` of
  `records/<app>/<hash>.json` when that file exists and reads and its statement is within
  `LIMITS.statementPayloadLength` (4,096 characters), sorted by name. A kept statement over that
  limit is left out, not refused (security review S2), so the answer always fits and the CLI
  reaches its stop for that name. An app the runner does
  not hold, and an app at format 1, answer `{"statements":[]}`. Never a sealed value (FR-022), so
  the answer says names, versions, hashes and the setter's key id only (FR-023). Not set up:
  `not_set_up`; a folder or state it cannot trust: `invalid_state`. Anyone who can start the runner
  can ask it, as `state` and `logs` (review 004, S4): the design's T17, accepted.

## What does not change

- **P7.** `version`, `status`, `setup`, `sync`, `apply`, `state` and `logs` keep their requests,
  their answers and their frame bounds byte for byte (FR-033). `status` is built from the version-1
  view of the stored state, so a zekno from before this feature reads it (`RunnerStatusSchema`,
  strict). `apply` answers only reasons a version-1 CLI knows: `unsupported_version` is one of
  `DEPLOY_REFUSALS`.
- **P8.** `RunnerReportSchema`'s reason list gains `secret_missing`, `untrusted_secret` and
  `expired`. Its shape, its outcomes and its rule (a reason exactly when refused) do not change.
  `StatusReportSchema`, `PendingDeploysResponseSchema` and the other messages to the hosted
  service do not change: their version-2 forms come with the runner's client for it.

## The CLI's side

- **P9.** `EVENTS` (`server/session.ts`) gains `deploy: "progress"`; `records` sends none. A
  `records` or `deploy` answer longer than its bound is `TOO_LARGE`; any frame that is not of the
  contract is `UNEXPECTED` and ends the session, as for every command. A refusal is a
  `RunnerRefused` and the session goes on, which C1 relies on (a second `status`).
- **P10.** The one-shot fallback (`oneShot`) never carries `deploy` or `records`: a runner without
  sessions reports no protocol, so the CLI signs version 1 and does not ask `records` (`TOO_OLD` if
  it ever were).

## Tests

`packages/core/test/scenarios/messages.test.ts`: each new schema accepts its example and refuses an
unknown field, a missing field, a wrong type, 257 records or statements; the frame bounds hold the
longest answer each allows. `apps/runner/test/session/session.test.ts`: `deploy` with progress
events then its result; `records` answers; both refused by name as one-shot commands (exit 2).
`apps/cli/test/server/session.test.ts`: a `deploy` answer with progress; a `records` answer past
4 MiB is `TOO_LARGE`. (As built: the core library's rule that every frame bound is at most an eighth of a message's limit gives 4 MiB, not the design's 8. A real answer is about 0.2 MiB. The schema alone does not bound an answer's size, so the runner checks the bytes of the answer it builds.)
