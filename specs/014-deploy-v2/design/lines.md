# Lines: what a person newly sees in feature 014

**Feature**: [014-deploy-v2](../spec.md) · **Date**: 2026-11-18 · **Status**: raw material for the design boards. **Every wording below is a proposal.** None is approved, and none is built until the maintainer approves it. The four boards beside this file (`Deploy2Overtaken`, `Deploy2Secrets`, `Deploy2Versions`, `Deploy2Refusals`) draw them with the program's real components; where a board and this file differ, the board is the later one.

**How to read it.** Each entry says where the line appears, when, today's line when one changes (quoted exactly, with its file and line), the closest sentences the CLI already prints, used as the model, and one proposed wording. Layout is not designed here: these are the words and the places. In the sentences, `<S>` is a server's name, `<A>` an app's name, `<N>` a deploy number, `<NAME>` a secret's name, `<F>` the runner's version, `<C>` the version this zekno carries.

**Where a line shows.** Every sentence below is said the same way in three places, as today's refusals are:

- `zekno deploy` and `zekno rollback` at a terminal: under the stage row (`ui/ink/deploy-view.tsx`), a refusal with `✖`, a warning with `!`.
- The same with no terminal, or with `--json`: one plain line on standard error. `--json` output keeps its shape.
- The full-screen app's deploy screen (`app/screens/deploy.tsx`): a refusal as the result line in the error colour; a warning as a notice in the warning colour (`notice("warning", …)`, `app/effects/deploys.ts:410`).

**The models.** The sentences the CLI already prints for nearby cases, which the proposals follow:

- `apps/cli/src/ops/deploy.ts:291`: ``${server.name} says it has accepted deploy ${accepted} of ${app}, far beyond the ${signed} this machine has signed. Nothing was signed.``
- `apps/cli/src/shared/deploy.ts:235`: ``Deploy ${sequence} of ${app} was accepted by ${server}, but the app did not start. Check Docker on the server.``
- `apps/cli/src/cli/errors.ts:51`: `The runner is in the middle of another deploy. Try again in a moment.`
- `apps/cli/src/cli/errors.ts:47-48`: ``The runner on that server has not been set up. Run `zekno server add` first.``
- `apps/cli/src/ops/server.ts:175` (W3): ``The runner on ${server} is version ${version}, older than this zekno's ${carried}. Deploys still work. Some of what this zekno does needs the newer runner: run `zekno server update ${server}`.``
- `apps/cli/src/ops/secret.ts:133`: ``"${name}" is reserved: the runner uses it to start Docker. Choose another name.``

A fourth habit was added while drawing the boards: a refusal's first sentence is drawn in bold and must fit one line of 100 columns, so each says what happened first, then "Nothing of it ran." as a sentence of its own.

Three habits of those sentences are kept: the first sentence says what happened, the second what to do; "Nothing was signed." when the CLI stopped before signing; a command to run in backticks, with the server's or the secret's name filled in.

## R. A runner's refusals, as the CLI says them

One sentence per reason (`REASONS` in `apps/cli/src/cli/errors.ts`). A refusal is a fixed word with no names in it, so these sentences name no app or secret; the C-lines below add names where the CLI can find them itself. Where a reason means something new on the version-2 path, the CLI says the version-2 sentence only for a deploy it signed as version 2, and today's sentence otherwise.

### R1. `replayed`, version 2

- **When**: another deploy of the app reached the runner after this one was made. On version 2 the CLI then reads the runner again and says C1 instead. R1 is said only when that second read fails.
- **Today** (`apps/cli/src/cli/errors.ts:62-63`): `The runner has already accepted a deploy with this number or a higher one.` Kept for version 1.
- **Proposed**: `Another deploy of this app reached the runner first. Nothing of this one ran. Run zekno deploy again to deploy on top of it.`

### R2. `sequence_jump`, version 2

- **When**: the deploy was made after a number the runner does not hold: the runner's answer was false, or its state went back (a restored folder).
- **Today** (`apps/cli/src/cli/errors.ts:68-69`): `The deploy number is too far ahead of the last one the runner accepted.` Kept for version 1.
- **Proposed**: `This deploy was made after a deploy the runner does not hold. Nothing of it ran. Run zekno status to see what the runner holds.`

### R3. `secrets_mismatch`, version 2

- **When**: the deploy does not list every secret the runner holds for the app, or carries a record it does not list, or a sealed value does not open. The CLI checks the first two before signing, so a person sees this only from a runner whose answer changed between the read and the deploy.
- **Today** (`apps/cli/src/cli/errors.ts:64-65`): `The secrets delivered do not match the ones the deploy lists.` Kept for version 1.
- **Proposed**: `The deploy does not account for every secret the runner holds for this app. Nothing of it ran. Run zekno deploy again.`

### R4. `secret_missing` (new)

- **When**: the deploy lists a secret the runner does not hold, and its record was not sent.
- **Today**: none. It would print `The runner refused the request (secret_missing).` (`apps/cli/src/cli/errors.ts:79`).
- **Proposed**: `The runner does not hold a secret this deploy lists, and it was not sent with it. Nothing of it ran. Run zekno deploy again.`

### R5. `untrusted_secret` (new)

- **When**: a secret the deploy uses was set by someone the runner's team list no longer includes. The CLI stops before signing when it knows (C4); R5 is said when the runner learned of the removal first.
- **Today**: none.
- **Proposed**: `A secret of this app was set by someone who is no longer in the team. Nothing of this deploy ran. Set it again with zekno secret set, or remove it with zekno secret rm.`

### R6. `expired` (new)

- **When**: the deploy's expiry had passed by the runner's clock. This feature's CLI signs no expiry over SSH, so a person sees it only from a deploy made elsewhere.
- **Today**: none.
- **Proposed**: `The time this deploy had to run had passed by the server's clock. Nothing of it ran. Deploy again, and check the server's clock if it says so again.`

### R7. `unsupported_version` (new sentence)

- **When**: the runner does not carry out a field the deploy uses, or does not take version 1 for this app.
- **Today**: `The runner refused the request (unsupported_version).` (`apps/cli/src/cli/errors.ts:79`, the general sentence).
- **Proposed**: `The runner on that server does not carry out everything this deploy asks for. Nothing of it ran. Run zekno status to compare its version with this zekno's.`

### R8. `malformed` and `wrong_payload_type` (new sentence)

- **When**: the runner could not read the deploy. The CLI checks the same rules before signing, so this means a runner of another version, or a fault.
- **Today**: `The runner refused the request (malformed).` (`apps/cli/src/cli/errors.ts:79`).
- **Proposed**: `The runner could not read this deploy. Nothing of it ran. Run zekno status to compare its version with this zekno's.`

### Unchanged

`stale_secret` (`errors.ts:72-73`), `stale_team` (`:59-60`), `unknown_signer` (`:57-58`), `busy` (`:51`), `too_large` (`:74-75`) and the rest keep their sentences. `too_large` now also covers the 8,192 records and 64 MiB a server keeps, which its sentence already allows.

## C. What the CLI says itself during a deploy or a rollback

### C1. Another deploy reached the server first (new)

- **Where**: `zekno deploy`, `zekno rollback`, the app's deploy screen, as a refusal.
- **When**: a version-2 deploy was refused `replayed`, and the CLI read the runner again on the same connection.
- **Today**: R1's today line.
- **Proposed**: `Another deploy of <A> reached <S> first, as deploy <N>. Nothing of this one ran. Run zekno deploy again to deploy on top of it.` (For a rollback: `… Run zekno rollback again …`.)

### C2. It cannot tell which deploy ran (new)

- **Where**: as C1.
- **When**: the runner's last number equals a deploy this machine signed whose answer never came, and another deploy with that number may have run.
- **Today**: none.
- **Proposed**: `<S> holds deploy <N> of <A>, and this machine signed a deploy <N> whose answer never came. zekno cannot tell which of the two ran. Run zekno deploy again to settle it.`

### C3. The same deploy sent again (new; only if Needs the maintainer, item 7, says to build it)

- **Where**: `zekno deploy` at a terminal, under the summary, before the stage row moves; the app as an information notice. Plain output: one line on standard error.
- **When**: the last deploy's answer never came, the runner has not taken it, and nothing changed since.
- **Today**: none. Today a new deploy is signed with the next number.
- **Proposed**: `The answer to deploy <N> of <A> never came, and nothing has changed since. Sending deploy <N> again, as it was signed.`

### C4. A secret set by someone no longer in the team (new, replaces a warning)

- **Where**: `zekno deploy`, `zekno rollback`, the app's deploy screen, as a refusal at the Checked stage. One line per secret, then the last sentence once.
- **When**: a secret the app has, on this machine or on the server, was set by a member the team list no longer includes.
- **Today** (`apps/cli/src/ops/deploy.ts:305`, the template ``Left out a ${ignored.kind}${ignored.name ? ` for ${ignored.name}` : ""}: ${ignored.reason}.``), printed as a warning while the deploy goes on: `Left out a record: unknown_signer.`
- **Proposed**: ``<NAME> was set by someone who is no longer in the team, so <A> cannot be deployed with it. Set it again with `zekno secret set <NAME>`, or remove it with `zekno secret rm <NAME>`. Nothing was signed.``

### C5. A secret the server holds that this machine cannot vouch for (new)

- **Where**: as C4.
- **When**: the server holds a live secret and no record of it verifies on this machine for another reason than a removed member (another team, another server or app, a value that does not match its statement).
- **Today**: the same warning template as C4, with that reason, and the deploy goes on.
- **Proposed**: ``<S> holds <NAME> for <A>, and this machine cannot check who set it. Set it again with `zekno secret set <NAME>`, or remove it with `zekno secret rm <NAME>`. Nothing was signed.``

### C6. Signed in the older format (new)

- **Where**: `zekno deploy` and `zekno rollback` as a warning, before the result; the app's deploy screen as a warning notice. Plain output: one line on standard error. Not in `--json` output.
- **When**: every deploy this CLI signs as version 1 because the runner is older, such as 0.1.0.
- **Today**: nothing; `zekno status` and `zekno server add` say W3 once.
- **Proposed**: ``The runner on <S> is version <F>, older than this zekno's <C>, so this deploy was signed in the older format. Run `zekno server update <S>` to bring it to <C>.``

### C7. A runner that speaks a newer protocol (new; only if Needs the maintainer, item 2, chooses to stop)

- **Where**: `zekno deploy`, `zekno rollback`, the app's deploy screen, as a refusal at the Checked stage.
- **When**: the runner's protocol is higher than this CLI's.
- **Today**: the deploy goes ahead. `zekno status` says W5 (`apps/cli/src/ops/server.ts:179`): `The runner on <S> is version <F>, newer than this zekno's <C>, and speaks a newer protocol. Update zekno before you deploy to <S>.`
- **Proposed**: `The runner on <S> is version <F>, newer than this zekno's <C>, and speaks a newer protocol. Update zekno to deploy to <S>. Nothing was signed.`

### C8. "Number <N> is used" after a refusal (changed)

- **Where**: the app's deploy screen, under the result line (`apps/cli/src/app/screens/deploy.tsx:102-103`). `zekno deploy` at a terminal shows the same line only when the app did not start (`apps/cli/src/ui/ink/deploy-view.tsx:131-132`), which stays true.
- **When**: a version-2 deploy was refused. On version 2 a refusal uses no number, and the next deploy may carry the same number.
- **Today**: `Number <N> is used, so the next deploy will be <N+1>.`
- **Proposed**: the line is left out after a refusal of a version-2 deploy. The refusal's own sentence already says nothing ran. Kept as it is when the app did not start, and for version 1.

### Unchanged in deploys and rollbacks

- `Deploy <N> of <A> is running on <S> with 2 secrets.` (`shared/deploy.ts:227`): the count is the secrets the deploy lists, which on version 2 can include ones only the server held.
- `Deploy <N> of <A> was accepted by <S>, but the app did not start. Check Docker on the server.` (`shared/deploy.ts:235`), and the app's `<S> accepted deploy <N>, but the app did not start.` (`app/effects/deploys.ts:429`).
- `Rolling back <A> to what deploy <N> ran.` (`commands/deploy.ts:120`), and the history lines of `prepareRollback` (`ops/deploy.ts:239`, `:248`, `:255`).
- ``Ignored <count> entries in the deploy history that could not be verified.`` (`ops/deploy.ts:147`): the history now holds both kinds, each checked by its own verifier.
- The bound of 1,000 (`ops/deploy.ts:291`): still said on the version-1 path; never on version 2.
- The summary's `secrets` row (`ui/parts/deploy-summary.tsx`): same words; its names come from what the deploy lists, so a secret only the server holds is named too. The stage row keeps Checked, Signed, Sent, Starting. Reading the server's records happens inside Checked.

## S. Secrets

### S1. `zekno secret rm` (unchanged)

- **Today** (`apps/cli/src/commands/secret.ts:46`): `Removed <NAME> from <A> on <S>. It takes effect on the next deploy.` Removal is already a signed act today; version 2 keeps it so. No change proposed.

### S2. A secret this machine has no record of (changed; depends on Needs the maintainer, item 6)

- **Where**: `zekno secret rm <NAME>`.
- **When**: the server holds `<NAME>`, and this machine has no record of it it can verify (another machine set it, this machine lost its copy, or its setter was removed).
- **Today** (`apps/cli/src/ops/secret.ts:350`): `<A> on <S> has no secret named <NAME>.`
- **Proposed**, if `zekno secret rm` asks the server: the removal goes ahead and S1 is said. `<A> on <S> has no secret named <NAME>.` stays for a name neither this machine nor the server holds.

### S3. `zekno secret set` (unchanged words)

- **Today** (`apps/cli/src/commands/secret.ts:35`): `Set <NAME> (version <V>) for <A> on <S>. It takes effect on the next deploy.` The version shown may come from the server's record (item 6). No change proposed.

## V. Versions of the runner and of zekno

No sentence changes. What each command says, with this feature's CLI carrying a runner `<C>` of protocol 3:

| Runner on the server | `zekno status`, `zekno server add`, the app's notice | `zekno doctor`, Runner line | `zekno deploy` |
|---|---|---|---|
| 0.1.0 (protocol 2) | W3 (`ops/server.ts:175`): ``The runner on <S> is version 0.1.0, older than this zekno's <C>. Deploys still work. Some of what this zekno does needs the newer runner: run `zekno server update <S>`.``, then D2 (`:185`) when `<C>` is a development release: `This zekno carries a development release.` | `0.1.0, older than this zekno's <C>`, next step `Run zekno server update <S>` (`ops/doctor.ts:207-210`) | version 1, and C6 |
| this feature's runner | nothing | `<C>` | version 2 |
| a later runner, protocol 4 or more | W5 (`ops/server.ts:179`), then D1 or D2 when they apply | `<F>, newer than this zekno's <C>, and speaks a newer protocol`, next step `Update zekno before you deploy to <S>` (`ops/doctor.ts:217-220`) | today: goes ahead; with item 2 (a): C7 |

`zekno server update` keeps its sentences (`specs/005-runner-release/contracts/versions.md`, "Single commands"). Home's `! older runner` and `! newer runner` stay.

## O. Lines older programs print, in new situations

These cannot change: they are in releases already out. They are listed so the boards and the docs can say what a person will see.

- A zekno from before this feature deploys a new app, or an app deployed with version 2, to this feature's runner: `The runner refused the request (unsupported_version).`
- The same zekno's `zekno status` against this feature's runner: W5, then D1 when the runner is a development release.
- Runner 0.1.0 put back by hand after this feature's runner wrote its state, asked by any zekno: `The runner's stored state is damaged or incomplete, so it refuses to act.` (`errors.ts:52-53`). The state is not damaged; it is newer. A board may want this said in the docs.

## M. The README and the docs

### M1. The README's note on metadata (changed)

- **Where**: `README.md`, "Security model", the note under "What Zekno does not protect against".
- **Today** (`README.md:169-170`): `> [!NOTE]` / `> The control plane still sees metadata: server addresses, app names, deploy times and team membership.`
- **Proposed**: `> The control plane, when it exists, will see metadata: server addresses, team membership, app names, deploy numbers, times and expiries, each deploy's Compose text with its plain variables, image names and digests, and each secret's name, version, size and who set it. It never sees a secret's value. With domains, building from source and health checks it will also see domains, build recipes and their arguments, pre-deploy commands, health-check paths, and the size and fingerprint of each source pack, which is enough to confirm a guess of the exact source, such as a public repository at a known commit, but not to read it.`

### M2. The docs' security page (changed)

- **Where**: `apps/web/content/docs/security.mdx`, the callout "Metadata".
- **Today** (`security.mdx:63-66`): `The control plane still sees metadata: server addresses, app names, deploy times and team membership.`
- **Proposed**: the same words as M1.

## A. The full-screen app

- **Deploy screen** (`app/screens/deploy.tsx`): the result line carries the R- and C-lines on a refusal; C6 shows as a warning notice; C8 changes when the "Number is used" line shows; the summary's `secrets` row may name a secret only the server held. No new stage.
- **Home, the servers pane, the add-server screen**: no change (part V).
- **Secrets on an app's screen**: no change in words. Whether the list shows a secret only the server holds depends on item 6.

## Places that may want a line (not proposed; the maintainer decides)

- `zekno server update` brings a server to version 2, after which runner 0.1.0 cannot read its state and a zekno from before this feature can deploy only the apps that have had no version-2 deploy. Today's question (`Replace the runner on <S> with version <C>? …`) does not say the step is one way.
- The docs' "Status and limits" may want one sentence on the order rule and on restoring a runner's folder (not supported).
