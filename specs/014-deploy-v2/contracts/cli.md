# Contract: the CLI

FR-005, FR-006, FR-008, FR-010 to FR-012, FR-015, FR-017, FR-021, FR-022, FR-027 to FR-030,
FR-035, FR-039. The words are `design/lines.md`'s and the boards', copied exactly; where they
differ the board is used. Commands are written as lines.md writes them: in backticks inside C4, C5,
C5b and C6, without them in the R-lines, C1, C2 and C7. At a terminal `ErrorLine` drops backticks and
draws the first sentence bold; plain output prints the text as it is.

## The format (`chooseFormat`, `apps/cli/src/ops/deploy-format.ts`)

Asked first inside the deploy's session, before `status`, from `session.mode` and `session.runner`
(the answer to the session's first request, `version`). `carried` is
`(deps.release ?? RUNNER_RELEASE).version`.

| The runner | Format | Said |
|---|---|---|
| does not speak sessions (`mode: "one-shot"`) | 1 | nothing (it reports no version, research R18) |
| protocol below 3, version older than `carried` | 1 | C6, right after signing |
| protocol below 3, version not older than `carried` | 1 | nothing (research R18) |
| protocol 3 (`RUNNER_PROTOCOL`) | 2 | nothing |
| protocol above 3 | none | C7, nothing signed, nothing in the history |

```ts
chooseFormat(input: { server: string; mode: SessionMode; runner: RunnerVersion | undefined; carried: string }):
  | { format: 1; older?: { version: string } }
  | { format: 2 }          // throws CliError(C7) above protocol 3
```

## A deploy (`sendDeploy`, `apps/cli/src/ops/deploy.ts`), in order

`zekno deploy`, `zekno rollback`, the first deploy of `asking/first-deploy.ts` and the app's `d` and
`r` all go through it.

1. **CL1.** Open the session (`withSession`); `chooseFormat` (C7 stops here).
2. **CL2.** `status`; `checkIdentity`; a name typed as new that the runner holds stops with
   `AppTaken` (unchanged, US1 scenario 4).
3. **CL3.** Version 2 only: `records` for the app. A refusal or an answer that does not read ends the
   deploy with its sentence, as `status` would; nothing is signed.
   **CL3b.** Version 2 only: keep what the server said, before anything can stop the deploy:
   `team.store.saveHeld(serverId, app, { statements, versions })` with the statements of the
   `records` answer that `peekSecretStatement` reads (each `payload` at most 4,096 characters, at
   most 256) and the app's entries of the `status` answer as `{ name, version, removed }`. The file
   is replaced whole (research R9; data-model.md).
4. **CL4.** What the deploy lists (below). A blocked name stops with C4, C5 or C5b; nothing is signed,
   the history is unchanged. Each item left out that blocks nothing is warned with today's template
   ``Left out a ${kind}${name ? ` for ${name}` : ""}: ${reason}.``
5. **CL5.** The number. Version 2: `previous` is `status.lastSequence[app]` (0 if absent),
   `sequence` is `previous + 1`; no bound (FR-010). Version 1: as today (one above the runner's
   number and the highest this machine signed, entries of both kinds counted; the 1,000 bound and
   its sentence).
6. **CL6.** Stage `checked` with `{ app, server, sequence, secrets, secretNames, format }`:
   `secrets` is how many secrets the deploy lists, `secretNames` their names.
7. **CL7.** Sign. Version 2: `createDeployV2({ trust, serverId, app, previous, compose, statements,
   removals, expiresAt: null, signer })`; version 1: `createDeploy` as today. A `CoreError` is
   `The deploy could not be signed (<code>).` (today's).
8. **CL8.** Save the history with the entry `sent`; stage `signed`; with `older`, warn C6.
9. **CL9.** Send. Version 2: `deploy` with `{ rosters: team.profile.rosters, envelope, records:
   supply }`; version 1: `apply` as today. Stage `sent`; stage `starting` at the first progress line.
10. **CL10.** The answer. A refusal of a version-2 deploy: the history is read again from the store,
    the entry whose envelope is this deploy's is taken out (it used no number), and it is saved;
    `replayed` goes to C1, C2 or R1 (`ops/deploy-answer.ts`, below);
    any other reason is `RunnerRefused(reason, explainDeploy(reason, 2))`. A refusal of a version-1
    deploy: `RunnerRefused(reason, explainDeploy(reason, 1))`, the entry stays `sent` (today). No
    answer: the entry stays `sent`, today's error.
11. **CL11.** `started` or `start_failed` with this `app` and `sequence`: the entry gets that
    outcome; stage `started` or `failed`; the result lines are today's.

**Expiry (FR-015).** This CLI signs `expiresAt: null` only. The envelope goes to the history file and
into the one `deploy` request of the session it was signed on, and nowhere else.

**Rollback (FR-012).** `prepareRollback` reads the old Compose text from an accepted entry of either
kind (`readDeployEntry`) and sets `rollback: true` on the plan; `sendDeploy` signs it in the format
`chooseFormat` gives, after the current number, with the current secrets. Its lines are today's.

## C1, C2 and R1 after `replayed` (`ops/deploy-answer.ts`)

Ask `status` again on the same session. Any failure (refusal, unreadable answer, another server),
or `lastSequence[app]` not above `previous`: R1. Otherwise, with `N` that number: C2 when the
history as read again at CL10 holds another entry of the app numbered `N` whose outcome is `sent`
(a deploy of this machine, perhaps from another terminal, whose answer never came); else
C1 (`zekno rollback` in it for a rollback). Thrown as `CliError` after stage `sent`, so the stage
row reads `✔ Checked ✔ Signed ✔ Sent ✖ Starting`.

## What a deploy lists (`secretsForDeploy` in `packages/core/src/secrets/for-deploy.ts`, called by `ops/deploy-secrets.ts`)

Inputs: this machine's store for the app (`records`, `removals`), the runner's statements (`held`;
`[]` for version 1), the live names and versions `status` reports for the app (`live`), the key ids
of former members (`former`: of members of an earlier list of `team.chain` that the current list
lacks), the format.

- **CL12. Candidates.** Every own record, own removal and runner statement that verifies for this
  team, server and app against the current list (`verifySecret`, `verifySecretRemoval`,
  `verifySecretStatement`). Per name, `chosen` is the one of the highest version; two different
  items at that version are a conflict: left out with reason `conflict`, as `currentSecrets` does.
- **CL13. Listed.** A `chosen` record or statement goes to `statements`, a `chosen` removal to
  `removals`.
- **CL14. Supplied.** Version 2: a `chosen` own record goes to `supply` when no runner statement has
  its hash. Version 1: every `chosen` record (exactly `currentSecrets(...).secrets`).
- **CL15. C4** (both formats). An item for the name, own or the runner's, that fails with
  `unknown_signer`, whose envelope's key id is in `former`, and whose version
  (`peekSecretStatement`) is at least `chosen`'s, or there is no `chosen`.
- **CL16. C5** (version 2 only, not C4). The name is live in `status`, and there is no `chosen`, or
  `chosen`'s version is below the version `status` reports.
- **CL16b. C5b** (version 2 only; in `ops/deploy-secrets.ts`, from `secretsForDeploy`'s result and
  this machine's own items, so the core function does not change). For each listed statement that
  is not one of this machine's records' envelopes: when this machine's highest verified item for
  the name (`verifySecret`, `verifySecretRemoval`) is a record, its version is below the listed
  statement's, and its hash differs. A removal, no item here, or the listed statement being this
  machine's own never trips it. Its sentence is proposed and waits for the maintainer.
- **CL17.** Every other item that did not verify is left out with today's warning (CL4). `status`'s
  versions decide only CL16; they are never signed (FR-021).

## `zekno secret set` and `zekno secret rm` (`ops/secret.ts`, `ops/secret-versions.ts`)

Both never connect, in any case (decision B): the frozen scenes of
`apps/cli/test/plain/plain-unchanged.test.ts` stay as they are.

- **CL18. The version.** One above the highest of: this machine's records and removals of the name
  that verify (today's `latestVersion`); this machine's records of the name that do not verify,
  read with `peekSecretStatement`; the statements of the name in `held/`, read with
  `peekSecretStatement`; the version of the name in `held/`'s `versions` (`floorVersion` in
  `ops/secret-versions.ts`). A floor only: nothing of `held/` is signed as a hash or listed.
  - `set`: S3's words, with that version.
  - At `Number.MAX_SAFE_INTEGER` the core library refuses the next version: today's
    `That could not be done (invalid_argument).`, nothing stored (research R9).
- **CL19. `rm`.** Signs the removal at that version and says S1 when this machine holds a current
  secret of the name (today), or a record of it that does not verify, or `held/` names it (a
  statement, or a version not removed). Otherwise today's `<A> on <S> has no secret named <NAME>.`
- **CL20.** `secret ls`, `secret import` and `zekno add` do not change.
- **CL21. The chain** (FR-028). A version-2 deploy that stops with C4, C5 or C5b has written
  `held/` (CL3b); `zekno secret set <NAME>` then signs a version above everything the server
  reported, offline, and the next deploy lists it and supplies its record; `zekno secret rm <NAME>`
  signs a removal above it, and the next deploy lists the removal. Tested by
  `test/scenarios/removed-member.test.ts` (C4) and `test/scenarios/held.test.ts` (C5 for a
  version-1 secret a second machine cannot account for; C5b), each with set and with rm, and with
  `deps.connect` throwing for every `zekno secret` command.

## The history (`shared/history.ts`)

`readDeployEntry(envelope, trust)` reads an entry with `readSignedDeploy` or `readSignedDeployV2` by
its kind (research R32). `sentDeploys` (`ops/deploy.ts`), `deployedSecrets` (`ops/secret.ts`) and
`verifiedDeploys` (`shared/views.ts`) use it; an entry neither reads is counted in today's
`Ignored <count> entries in the deploy history that could not be verified.` Only answered entries
are offered for rollback, as today (FR-035).

## Every line

| Id | Exact words | Produced in | When | Test |
|---|---|---|---|---|
| R1 | `Another deploy of this app reached the runner first. Nothing of this one ran. Run zekno deploy again to deploy on top of it.` | `cli/errors.ts` `explainDeploy("replayed", 2)` | `replayed` to version 2, second read failed | `test/cli/errors.test.ts`; `test/ops/deploy-answer.test.ts` |
| R2 | `This deploy was made after a deploy the runner does not hold. Nothing of it ran. Run zekno status to see what the runner holds.` | `explainDeploy("sequence_jump", 2)` | | errors; `test/scenarios/deploy-v2.test.ts` |
| R3 | `The deploy does not account for every secret the runner holds for this app. Nothing of it ran. Run zekno deploy again.` | `explainDeploy("secrets_mismatch", 2)` | | errors; `test/scenarios/secrets-v2.test.ts` |
| R4 | `The runner does not hold a secret this deploy lists, and it was not sent with it. Nothing of it ran. Run zekno deploy again.` | `REASONS.secret_missing` | | errors; secrets-v2 |
| R5 | `A secret of this app was set by someone who is no longer in the team. Nothing of this deploy ran. Set it again with zekno secret set, or remove it with zekno secret rm.` | `REASONS.untrusted_secret` | | errors; `test/scenarios/removed-member.test.ts` |
| R6 | `The time this deploy had to run had passed by the server's clock. Nothing of it ran. Deploy again, and check the server's clock if it says so again.` | `REASONS.expired` | | errors |
| R7 | `The runner on that server does not carry out everything this deploy asks for. Nothing of it ran. Run zekno status to compare its version with this zekno's.` | `explainDeploy("unsupported_version", 1 \| 2)` | | errors; `test/scenarios/deploy-versions.test.ts` |
| R8 | `The runner could not read this deploy. Nothing of it ran. Run zekno status to compare its version with this zekno's.` | `explainDeploy("malformed" \| "wrong_payload_type", 1 \| 2)` | | errors |
| R, kept | today's `REASONS` sentences, for version 1 and every other reason | `cli/errors.ts` | | errors |
| C1 | `Another deploy of <A> reached <S> first, as deploy <N>. Nothing of this one ran. Run zekno deploy again to deploy on top of it.` (rollback: `Run zekno rollback again to deploy on top of it.`) | `shared/deploy-words.ts` `C1(app, server, n, rollback)`; `ops/deploy-answer.ts` | after `replayed` | `test/shared/deploy-words.test.ts`; deploy-answer; deploy-v2 |
| C2 | `<S> holds deploy <N> of <A>, and this machine signed a deploy <N> whose answer never came. zekno cannot tell which of the two ran. Run zekno deploy again to settle it.` | `C2(app, server, n)` | after `replayed`, a `sent` entry `N` | deploy-words; deploy-answer; deploy-v2 |
| C4 | ``<NAME> was set by someone who is no longer in the team, so <A> cannot be deployed with it. Set it again with `zekno secret set <NAME>`, or remove it with `zekno secret rm <NAME>`. Nothing was signed.`` | `C4(name, app)`; `ops/deploy-secrets.ts` | CL15 | deploy-words; `test/ops/deploy-secrets.test.ts`; removed-member |
| C5 | ``<S> holds <NAME> for <A>, and this machine cannot check who set it. Set it again with `zekno secret set <NAME>`, or remove it with `zekno secret rm <NAME>`. Nothing was signed.`` | `C5(name, app, server)`; `ops/deploy-secrets.ts` | CL16 | deploy-words; deploy-secrets; secrets-v2 |
| C5b | ``<S> holds a newer <NAME> for <A> than the one set on this machine. Set it again with `zekno secret set <NAME>` to replace it, or remove it with `zekno secret rm <NAME>`. Nothing was signed.`` (proposed, to be confirmed) | `C5b(name, app, server)`; `ops/deploy-secrets.ts` | CL16b | deploy-words; deploy-secrets; `test/scenarios/held.test.ts` |
| C6 | ``The runner on <S> is version <F>, older than this zekno's <C>, so this deploy was signed in the older format. Run `zekno server update <S>` to bring it to <C>.`` | `C6(server, version, carried)`; warned by `ops/deploy.ts` | CL8 with `older` | deploy-words; `test/ops/deploy-format.test.ts`; deploy-versions; pairing |
| C7 | `The runner on <S> is version <F>, newer than this zekno's <C>, and speaks a newer protocol. Update zekno to deploy to <S>. Nothing was signed.` | `C7(server, version, carried)`; `chooseFormat` | CL1 | deploy-words; deploy-format; deploy-versions |
| C8 | `Number <N> is used, so the next deploy will be <N+1>.` left out | `ui/parts/deploy-summary.tsx` `numberUsed` | a version-2 deploy that ended in error | `test/app/app-operate.test.tsx`; `test/ui/ink/single-commands.test.tsx` |
| S1 to S3 | unchanged words | `commands/secret.ts`, `ops/secret.ts` | CL18, CL19 | `test/ops/secret-versions.test.ts`; `test/plain/plain-unchanged.test.ts` unchanged |
| M1, M2 | the board `Deploy2Refusals`'s list | `README.md`, `apps/web/content/docs/security.mdx` | | `apps/cli/test/docs/metadata-note.test.ts` |

**Several blocked names** (C4, C5, C5b): one line per name, in name order, each its sentence without the
last `Nothing was signed.`, joined by a line break; ` Nothing was signed.` ends the last line. With
one name the text is exactly C4's or C5's.

**How each is shown.**

- At a terminal (`ui/ink`): a refusal and C1 to C7 as `ErrorLine` under the deploy's block when the
  block was drawn (C1, C2 and the R-lines: after `✖ Starting`), alone when it was not (C4, C5, C5b, C7:
  nothing is drawn before the first stage, research R17); C6 as a warning (`!`), drawn above the
  block. C8 is not drawn by the single commands after an error (today they draw it only for
  `start_failed`).
- Plain or `--json`: the sentence on standard error; `--json`'s object on standard output keeps its
  shape. C6 on standard error, not in the object.
- The app's deploy screen: the R- and C-lines as the result line in the error colour (`deploy-ended`,
  `notice.tone "error"`); C6 as `notice("warning", …)`; C4, C5, C5b and C7 under the panel and
  `✖ Checked ○ Signed ○ Sent ○ Starting` (the panel was drawn at `deploy-started`); C8 left out
  after a version-2 error; the panel's `secrets` row names the listed secrets from Checked on.

## What does not change in the CLI

`zekno status`, `zekno server add`, `zekno server update`, `zekno doctor` and Home say what they say
today for each runner (lines.md, V); with `RUNNER_PROTOCOL` 3 a protocol-2 runner older than
`carried` now draws W3 instead of W2, as US4 scenario 1 says. Every other plain line and exit status
is as at `e7b0146`; set and rm make the same calls as there.
