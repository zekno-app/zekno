# Research record: where the CLI changes, and probes run in Bun 1.4.4 (a snapshot at commit 2d00a64)

Written by an Opus agent on 2026-11-19; line numbers go stale. Proposals in it are the agent's; what was decided is in [research.md](../research.md) and the contracts.

## Summary (under 500 words)

**Where it plugs in**
- **Settings.** Make the two settings real in `shape.ts` (`healthcheck: later` L112, `domains: later` L122, `LATER` L221-235). Then follow them through `types.ts` (`ServiceSettings` L11-23, `LaterSetting` L49-50), `schema.ts` (`serviceOf` L242, `acrossSettings` L272), `change.ts` (move them from `LATER` L66 to `SINGLE` L44), `words.ts` (delete `LATER.domains`/`LATER.healthcheck` L285-296; update `CS5` L369 and `NOT_SET`), `text.ts` (`serviceNode` L40), `piped.ts` and `rows.ts`.
  - **`write.ts` `FIELDS` L61-72 must list `domains` and `health`.** If it doesn't, the check that reads the written text back stops seeing them, and a write that dropped them would pass.
- **"Changed, not deployed" mark.** `shared/history.ts` `shared()` L74-88 throws away `routes`/`health`. Keep them for format 2, and add a `lastDeployedSettings` that merges them into `deployedSettings(compose)`. Use it in place of the two callers: `ops/settings.ts` L217-225 and `app/effects/settings.ts` L146-162.
- **Deploy.**
  - `readSource` (`settings/source.ts` L164-179) produces routes/health; `prepareDeploy` (ops/deploy.ts L166-191) carries them on `DeployPlan`.
  - The checks go in `sendDeploy` (L261-301), between `status` (L279) and `deployVersionTwo` (L291), in a new `ops/deploy-dns.ts`. Throwing a `CliError` before `stage("checked")` already gives "sentence alone" at a terminal and "✖ Checked" in the app.
  - B10 goes in `chooseFormat` (deploy-format.ts L24, L39-53), with protocol 4.
  - Signing: `later: { routes, health }` in `createDeployV2` (deploy-send.ts L316-328).
  - `deliver` L153-162 rejects any outcome but started/start_failed today, so it must accept `unhealthy`.
  - Panel row: `DeployStart`/`DeployProgress`, `Summary` L93-115, `outputRows` (screens/deploy.tsx L124-138). Fifth stage: `LABELS`/`DONE`/`stagesOf` (deploy-summary.tsx L15-48).
  - The HTTPS wait goes in `commands/deploy.ts` `send` L42-74, before `view.end`.
- **New files.** `commands/domain.ts`, `ops/domain.ts`, and a `domains/` folder (rule, words, routes, dns, https, server-address, state). The folder must be added to `LAYOUT`/`BASE` in `layers.test.ts`.
- **Rollback.** `prepareRollback` (L209-252) signs only the old compose text. The routes "in force now" can only come from a signed deploy numbered `accepted`: from this machine's history, or from a runner request that returns it.

**What the probes showed in Bun 1.4.4**
- **DNS.** `resolve4`+`resolve6` work. `lookup({all:true})` dropped AAAA on this machine, so it would miss a domain that points to the server by IPv6 only.
  - A missing record gives `ENOTFOUND` both for a name that doesn't exist and for "no record of that type" (no `ENODATA`).
  - `resolve4` of an IP literal fails, so check `isIP` first.
- **Server address.** No `ssh -G` or destination parsing exists today. `ssh -G -T -- <dest>` works offline and gives `hostname`, plus `proxyjump` when a jump host is used. A stored destination of `host:port` comes back as a literal hostname.
- **TLS.** `tls.connect` with SNI, `authorized`, `authorizationError` and `getPeerCertificate().valid_to` work.
  - A self-signed certificate gives `DEPTH_ZERO_SELF_SIGNED_CERT`; an expired one gives `CERT_HAS_EXPIRED`.
  - I could not test a name mismatch through `authorized` (the test site reset the connection), so call `checkServerIdentity` explicitly; it does return `ERR_TLS_CERT_ALTNAME_INVALID`.
  - An address where nothing answers sends no event at all, so the probe needs its own timer.
  - `fetch` is not allowed: `never-fetches.test.ts` limits it to `main.ts` and `version/newest.ts`.
- **Testing these.** Add optional `resolveDomain`/`probeHttps`/`sshHost` to `Deps`, the way `fetch` is done: wired only in `main.ts`, replaced by assignment in tests.

**Risks**
1. **Help vs `plain-unchanged.test.ts`.** Any new `HELP` line fails it unless its `ADDED_TO_HELP` list is extended. Features 010 and 012 did exactly that, but you said the file must not change, so this is your call. Never edit the existing deploy line; put `--skip-dns-check` on a new line.
2. **Status compatibility.** `RunnerStatusSchema` is strict, so adding domains to `status` breaks older CLIs' `zekno status`. A separate request avoids it.
3. **History compatibility.** Adding `unhealthy` to the history outcome list makes older zeknos unable to read that app's history.
4. **Health shape.** Settings are per service, but the signed deploy has one timeout. How to fold them, and how `settings set` names the health check, are undesigned.
5. **Core work the CLI needs.** Export and tighten `isRoutableDomain`, add `unhealthy`, `domain_taken`, a health-wait event and a field for B16-B19.
6. **Templates.** They must keep refusing domains once the schema accepts them.
7. **File sizes.** `cli.ts` (495), `doctor.ts` (778), `first-deploy.ts` (539) and `app.tsx` (447) need splitting.
8. **Uncommitted change.** `meta.json` (`---Get Started---`) already fails `pages.test.ts`.

---

# FULL MAP

Paths are relative to `apps/cli/` unless they start with `packages/`, `apps/web/`, `specs/` or `README.md`. Line numbers are at HEAD 2d00a64.

## A. Settings

### A.1 One setting end to end
- **Strict JSON** (`json.ts`): `MAX_DEPTH = 6` L48, so `services.web.deploy.healthcheck.path` (depth 5) fits.
- **`schema.ts`**
  - `unknownKey` L106-146 walks section → setting one level only. L133-135: a key found in `LATER` gives `{kind:"later"}` (SL1-SL5). Keys nested inside a setting are caught later by zod `strictObject`.
  - `faultOf` L152-239 (`switch` on ids SV1-SV33, L171-214), `serviceOf` L242-264.
  - `acrossSettings` L272-296: SV15, SV16, SV25, SV30, SV32, SV33.
  - `checkSettingsValue` L329-381.
- **`shape.ts`**: `DeploySchema` L95-116 (`healthcheck: later` L112), `NetworkingSchema` L118-125 (`domains: later` L122), `SECTIONS` L213-218, `LATER` L221-235. Each zod issue's message is a sentence id, never file text.
- **`types.ts`**: `ServiceSettings` L11-23, `LaterSetting` L49-50, `SettingPath` L62-76, `Change` L79-89, `SettingRow` L92-109, `SettingsReport` L112-130, `DeployText` L133-136.
- **`values.ts`**: limits L28-46, checks L119-348, `readTyped` L357-391 (secrets split on `,` at L380-385).
- **`change.ts`**: `SINGLE` L44-63, `LATER` L66-77, `parseSettingPath` L87-113, `shownValue` L126-158, `isNow` L173-204, `isSet` L207-213, `changed` L229-246.
  - `applyChange` L256-316 checks the whole file with the change: `settingsText` → `checkSettings`, L295-307.
- **`words.ts`**: `LATER` L273-297, `laterSentences` L300-313, `CS5` L369-370 (lists every setting), `CS6` L372-374, `CS9`/`CS10`/`CS11` L381-387, `SettingKey` L509-519, `settingWords` L536-609, `NOT_SET` L612-623.
- **`text.ts`**: `serviceNode` L40-86, `settingsText` L134-156. The file is re-serialised whole in zekno's fixed form; "exact rewriting" means canonical text plus the one line that changed.
- **`write.ts`**: `FIELDS` L61-72, `canonical` L75-86, `textOf` L89-99 (the text read back must equal the settings), `writeSettings` L213-234.
- **`rows.ts`**: `markOf` L47-64, `PARTS` L86-116, `removedRows` L155-177, `plainRows` L180-201, `volumeRows` L204-222, `reportRows` L230-278 (only rows that are set or were deployed), `reportOf` L303-319, `screenRows` L329-384 (every row).
- **`piped.ts`**: `placesOf` L19-48, one tab-separated line per setting that is set.
- **`compose.ts`**: `composeText` L96-109, `deployedSettings` L191-209. Domains and health are not part of the Compose text.
- **`source.ts`**: `readSource` L164-179 builds `DeployText`.

### A.2 What must change
**Proposed file shape** (needs a decision):
- `networking.domains: ["shop.example.com"]`
- `deploy.healthcheck: {"path"?: "/health", "timeout"?: 60}`

The signed `health` (`packages/core/src/deploy/later-fields.ts` L99-115) has one `timeout` per deploy, and per service `http: {port, path} | null`. So the CLI must fold the per-service timeouts into one (max is the obvious choice), take the port from `networking.port`, and refuse a health path on a service with no port.

1. **`shape.ts`**
   - L112: a strict `HealthcheckSchema` with `path` and `timeout`.
   - L122: `z.array(checkedString(...))`, counted against `LIMITS.routesPerDeploy` = 64, with a duplicate check like `SecretsSchema` L139-149.
   - Remove them from `LATER` L221-235.
2. **`types.ts`**
   - `ServiceSettings` gains `domains?: readonly string[]` and `health?: {path?: string; timeout: number}`.
   - `LaterSetting` drops `"healthcheck"` and `"domains"`.
   - `SettingPath` gains `"domains"` and a health key.
3. **`schema.ts`**
   - `serviceOf` copies both.
   - `faultOf` gains the new SV ids.
   - `acrossSettings` gains: domains need a port (A12/B11), a domain under one service only (A13), at most 64 domains, a health path needs a port.
4. **`values.ts`**: add `checkDomain`, `checkHealthPath`, `checkHealthTimeout` (1-1800), and `readTyped` cases (domains split on `,` and lowercased).
   - Core's `isRoutableDomain` (later-fields.ts L151) is **not exported**: `index.ts` L93-101 exports only `buildKey` from later-fields.
   - It also still accepts `xn--` A-labels (`isALabel` L138-141); point 8 says refuse them.
   - The path regex `PATH` (L96) is not exported either.
5. **`change.ts`**
   - Move both names from `LATER` L66-77 into `SINGLE` L44-63, or use prefixes like `plain.` (L101-106) for `healthcheck.path`.
   - Extend `shownValue` and `isNow` (list compare as for secrets, L187-193). `changed` already works for a list.
6. **`words.ts`**
   - Delete `LATER.healthcheck` and `LATER.domains` (FR-001 and FR-008 say those sentences go).
   - `CS5` must name the new settings (pinned in `words.test.ts`).
   - Add both to `SettingKey`, `settingWords` (labels `domains` and `health`) and `NOT_SET` (`domains: "none"`, `health: "not set"`, matching A1 and C5).
7. **`text.ts` `serviceNode`**: deploy gains `healthcheck` after `cpus`; networking gains `domains` after `publish`.
8. **`write.ts` `FIELDS`**: add `domains` and `health`. Otherwise `canonical` ignores them, and the check that reads the written text back cannot see if they were dropped.
9. **`piped.ts`**: add `networking.domains` (joined with `,`) and `deploy.healthcheck.*`. This only adds lines for services that set them.
10. **`rows.ts`**: see A.3.
11. **Code typed on `LaterSetting`** that must be revisited: `templates/file-words.ts` L263-272, `templates/read.ts` L250-254, `templates/addition.ts` L86-89.
    - The template reader uses `checkSettingsValue`, so once the schema accepts domains a template naming one would pass. Templates need their own refusal; `test/support/template-files.ts` L361 pins the current one.
12. **Tests pinning the old sentences**: `test/settings/schema.test.ts` L101-103, `words.test.ts` L299-308 and L361, `file.test.ts` L297, `test/app/settings-effects.test.ts` L245-246, `test/support/settings-files.ts` L574-591, `test/scenarios/settings-deploy.test.ts` L254-262 and L424-425, `test/templates/read.test.ts` L162.
    - Docs pages too: `settings.mdx` L164-171, `changing-settings.mdx` L144-145.

### A.3 How list settings work today
- **secrets** (one list): `zekno settings set web.secrets "A, B"` replaces the whole list. Shown as one row. On the screen, `enter` opens text filled with `A, B` (`app/state/settings-change.ts` `rawValue` L108-109, `limitOf` L97-98, `checked` L155-197), then y/N.
- **plain and volumes** (named pairs): set per name, one row each, label on the first row only (`plainRows`).
  - On the screen, a `none` row cannot add an entry: it shows `AS7` (`app/state/settings.ts` L162-171).
  - Entries removed since the deploy are marked by `removedRows` with `AS8`.
- **Recommendation for domains**: store and type them like secrets (one path, `set web.domains "a.com, b.com"`) and show them like plain (E1/E6 "one a row", `none` when empty).
  - `zekno domain add/rm` then compute the new list and reuse `applyChange` + `writeSettings`, which gives A1, A2 and A8 through `settingChange({label: "domains"})`.
  - On the screen, `enter` on any domain row can open the whole list. A per-row remove plus an add row would be new screen state (a design question).

### A.4 The "changed, not deployed" mark
**Today**
- `ops/settings.ts` L217-225 and `app/effects/settings.ts` L146-162 both call `lastDeployedCompose` (`shared/views.ts` L336-344, the latest accepted deploy in this machine's verified history), then `deployedSettings`.
- The result goes to `markOf` through `reportOf`/`screenRows`.
- `shared/history.ts` drops routes and health: `HistoryDeploy` L29, `shared()` L74-88, `readDeployEntry` L46-71 (format 2 adds only `previous`).

**Proposal**
1. `HistoryDeploy` gains `routes?` and `health?` (types already exported from core, `index.ts` L95-100), set for format 2.
2. Add `lastDeployedSettings(store, trust, server, app)`: the same entry, `deployedSettings(compose)`, then routes merged into each service's `domains` and health into each service's `health`.
3. Replace the two callers with it.
4. `markOf` and `same` then work as they are; removed domains get their own rows like `removedRows`.

Caveat: this is the last deploy from this machine, not what the server holds. For "held" in `zekno domain`, ask the runner (FR-029).

## B. Commands

### B.1 Registering and parsing a command (`cli/cli.ts`)
- **Help and word counts**: `HELP` L49-79, `WORDS` L82-104.
- **`grouped`** L219-221 covers only server, secret and settings. Add `domain`, so that `domain` is 1 word, `domain add <d>` 3 and `domain rm <d>` 3.
- **`WITHOUT_TEAM`** L122-135: add `domain add` and `domain rm` (they only write the settings file).
- **Option tables**: `OPTIONS` L156-175, `ADD_ONLY` L178-182, `parsed` L190-196, `SETTINGS_OPTIONS` L147-153 (checked at L234-243).
  - New `--service` and `--skip-dns-check` should follow the `ADD_ONLY` pattern rather than go into `OPTIONS`.
  - Otherwise every other command would silently accept them instead of failing with "Unknown option" (status 2).
- **Dispatch** `switch` L375-469. `settings set` L441-445 and `deploy` L411-422 are the models.
- **Exit statuses** (L470-494): `CliError` → 1; `WrongInput` → 2 with no help line; `UsageError` → 2 with the help line; `Left` → 1.
- **Size**: cli.ts is 495 lines, so move the help and option tables into `cli/help.ts` or `cli/options.ts` and re-export `HELP` (tests import it from `src/cli/cli`). `layers.test.ts` lists the files of `cli/` in `CLI_FILES` (L311).

### B.2 The `zekno settings set` flow to copy
In `commands/settings.ts`, `change` L63-90:
1. `prepareSettingChange` (`ops/settings.ts` L322-347) refuses with:
   - CS1/CS2 as `UsageError`.
   - CS5/CS6, and `applyChange` status 2, as `WrongInput`.
   - SH1/SH2/SH3 through `readPlaced` (L199-209). For domains, A14 replaces SH2, the hand-written Compose refusal.
   - CS13 through `refuseLink`.
2. A change that writes nothing (status 0) → `ui.info`, exit 0.
3. `ui.settingChange({service, label, now, next})`. Plain output prints `web · domains  none → shop.example.com` (`plain.ts` L132-135).
4. `ui.confirm(CS9(file), CS10(file))` unless `--yes`.
   - With no terminal and no `--yes` it fails with CS10, exit 1; "no" throws `Left`.
   - So `domain add` and `domain rm` need `[--yes]` too.
5. `writeSettingChange` L354-357.
6. `ui.success(CS11.text, CS11.detail)` gives A4. A9 needs another detail ("Run zekno deploy to release it."), followed by A5/A6.

Other behaviour to reuse:
- `--json` → `ui.json`. Plain output is chosen by `wantsPlain` (`plain.ts` L18-30).
- A7 becomes `ui.choose({..., missing: new WrongInput(A16)})`; the plain interface throws `missing` (`ui/types.ts` L278).
- `ui.line(plain, cells)` prints different text in plain output and at a terminal (L209). That suits the D lines: mark and detail at a terminal, one-word state plus date tab-separated in plain output. `ui.table` prints tab-separated in plain output (`plain.ts` L65).

### B.3 New files (under the folder rule)
**New `src/domains/` folder** (add it to `LAYOUT` L57-72 and `BASE` L280-290 of `test/layers/layers.test.ts`; 010 and 012 did the same):
- `rule.ts`: lowercase and say so once; A10/A11 refusals over core's rule.
- `words.ts`: the sentences of lines.md A, B, D and E, and the plain one-word states.
- `routes.ts`: `routesOf` sorted by domain (core needs them sorted and unique, L267), `healthOf` with services sorted by name; FR-017 and B12 checks against a Compose text.
- `server-address.ts`: `ssh -G`, `isIP`, private-range checks.
- `dns.ts`: resolve the domain and compare with the server's addresses.
- `https.ts`: the TLS probe and the 60 s wait.
- `state.ts`: the D1-D9 states.

**Elsewhere**
- `src/ops/domain.ts`: prepare add and rm (export `readPlaced` from `ops/settings.ts` for it); `listDomains` (status plus probes).
- `src/ops/deploy-dns.ts`: the checks before signing.
- `src/commands/domain.ts`: `domainList`, `domainAdd`, `domainRemove`.
- Tests: `test/domains/*.test.ts`, `test/ops/domain.test.ts`, `test/ops/deploy-dns.test.ts`, `test/commands/domain.test.tsx`, `test/scenarios/domains.test.ts`, `test/support/domain-stand-ins.ts`.

**Test tables to extend**: `test/version/never-fetches.test.ts` `NEVER_FETCHES` L24-55 (L82-84 fails when the help names a command missing from the table). `test/docs/docs.test.ts` requires the docs pages to name every command and flag of the help.

## C. Deploy flow

### C.1 Where things happen today
- **Plan**: `ops/deploy.ts` `prepareDeploy` L166-191 → `DeployPlan` L44-51.
- **Rollback**: `prepareRollback` L209-252. It uses `sentDeploys` L108-139, which keeps only sequence, compose and outcome.
- **`sendDeploy`** L261-301: `chooseFormat` L271-276 (C7 stops here), `status` and `checkIdentity` L279-280, `accepted` L283-285, `AppTaken` L287, then v2 at L291 or v1 at L292-297.
- **Format**: `deploy-format.ts` `VERSION_TWO_PROTOCOL = 3` L24, `chooseFormat` L39-53. Core `RUNNER_PROTOCOL = 3` (`protocol.ts` L260).
- **`deploy-send.ts` `deployVersionTwo`** L300-352: `records` L304, `listing` L309 (the C4/C5 stop is `deploy-secrets.ts` L168, before `stage("checked")` at L314), `createDeployV2` L316-328 with no `later`.
  - Core `createDeployV2` (`deploy-v2.ts` L81-199) already accepts `later` (L90-95), but its comment at L79 says "for tests only".
- **`deliver`** L124-172: the outcome check L153-162 accepts only started/start_failed; history saved L164-169; final stage L170.
  - Refusals go through `deploy-answer.ts` L114-127 to `explainDeploy` (`cli/errors.ts`: `REASONS` L53-93, `VERSION_TWO` L104-114, `EITHER_FORMAT` L121-127, L134-140).
- **Terminal**
  - `commands/deploy.ts` `send` L42-74 (exit status at L73) → `ui/ink/deploy-live.ts` L33-125.
  - Nothing is drawn before the first stage (L40-41), and an error before any stage is not drawn (L87-88).
  - `DeployBlock` is `deploy-view.tsx` L77-150.
- **Parts and types**
  - `ui/parts/deploy-summary.tsx`: `LABELS` L15, `DONE` L17-24, `stagesOf` L32-48, `numberUsed` L57-66, `Summary` L93-115.
  - `shared/deploy.ts`: `DeployStage` L16-17, `DeployInfo` L20-30, `DeployStart` L33-56, `DeployEnding` L59-68, `DeployView` L71-78, `DeployProgress` L86-114, `plainDeployView` L266-294.
  - `shared/deploy-words.ts`: `NOTHING_SIGNED` L25, C7 L84-85.
- **App**
  - `app/effects/deploys.ts`: `plan` L238-327, `deploy` L375-446 (`deploy-started` L386-394 before `sendDeploy`, error → notice L414-425, result text L428-431).
  - `app/state/deploy.ts` L24-99.
  - `screens/deploy.tsx` `outputRows` L124-138.

**How a stop before signing shows**: it is a `CliError` thrown before `stage("checked")`.
- At a terminal nothing is drawn and `run` prints the sentence alone.
- In the app, `deploy-started` was already dispatched, so `stagesOf` gives "✖ Checked" with the sentence as the notice.
- So B7-B12 need no new view code.

### C.2 Routes and health into the plan
- `DeployText.settings` gains `routes` and `health`, filled in `readSource` L171-178.
- `DeployPlan` gains `routes?`, `health?` and `skipDnsCheck?`, copied in `prepareDeploy` L183-190.
- Signing: `createDeployV2({..., later: {routes, health}})`.

### C.3 The checks before signing (new `ops/deploy-dns.ts`, called from `sendDeploy`)
- **B10**: `chooseFormat` gets a `needs: {routes, health}` input and `ROUTES_PROTOCOL = 4`.
  - Stop when the runner is one-shot, reports no version, or speaks a protocol below 4.
  - B10 names a version, so a runner with none needs a variant of the sentence. Core `RUNNER_PROTOCOL` goes to 4.
- **After status** (L279-288): B9 and the set of domains held for this app come from the runner (FR-029).
- **Domains not yet held**: resolve each and compare with the server's addresses.
  - B1 is the line before the panel; B7 and B8 stop with a `CliError`.
  - B13 is a warning when the server's address is private; B14 is the `--skip-dns-check` warning.
- **Domains already held**: a failing check is B15, a warning.
- **Guards**: B11 is already a schema rule but keep it as a guard; B12 and FR-017 checks run before signing.
- **Order**: all of this before `deployVersionTwo` (L291), so before `records`.
- **How the lines reach the person**: `DeployCallbacks` (L23-35) has a `warning` callback but no success line. Add a `said`/`dns` callback, wired in `commands/deploy.ts` L54-58 and `app/effects/deploys.ts` L401-413.

### C.4 The panel's `domains` row (B2, B3)
- `DeployStart` and `DeployProgress` gain `domains?`, set in `commands/deploy.ts` `deploy` L101-107.
- `deploy-live.ts` copies it (`fromOf` L22-27 and the objects at L53-60 and L98-104).
- `Summary` adds the rows: the first three, then `and N more` dim.
- App: the `deploy-started` event and `deployStarted` carry it, and `outputRows` L130-131 adds `min(3, n) + (n > 3 ? 1 : 0)`.

### C.5 Waiting for HTTPS (B4-B6)
- The board puts B5 between "✔ shop is live…" and `startedNext` (`DeployBlock` L108-120). So in `send`, after `started` (L64-72), wait before `view.end`:
  - an optional `view.waiting?.(domain)` for B4;
  - poll `probeHttps` for up to 60 s;
  - `view.end({..., https})`, with `DeployEnding` gaining `https?`.
- `plainDeployView` prints B5/B6 only when `https` is given. The app does the same wait after L426.
- **Catch**: the plain-transcript recorder (`test/plain/plain-scenes.ts` L94-109) wraps the deploy view and passes on only `stage`, `progress` and `end`. Any new view method must be optional, called with `?.`, and never called for apps without domains.

### C.6 The fifth stage and `unhealthy` (C1-C4)
- **Stages**: `DeployStage` gains healthy/checking; `DeployProgress` gains `health?`; change `LABELS`, `DONE` and `stagesOf` (the relabel at L44 becomes conditional).
- **C2's live line** needs a new kind of session event in core: `SessionEventSchema` (`protocol.ts` L313-317) has only progress and log. It would be handled in `deliver`'s `onEvent` (L144-149).
- **`unhealthy` in core**: `RUNNER_OUTCOMES` (L179) must include it.
- **`unhealthy` in the CLI**: `deliver` L153-162, `DeployResult` L65-72, `DeployEnding`, `DeployProgress.outcome`, `DeployRow.outcome` (`views.ts` L61), `HistorySchema` (`profile.ts` L101), `deployEnded`.
  - Exit status 1 at `commands/deploy.ts` L73.
  - C3/C4 in `plainDeployView` and `DeployBlock`.
- **B16-B19** need a report field: `RunnerReportSchema` (L190-206) carries a `reason` only for refusals.

### C.7 Rollback and the routes "in force now"
- Today `prepareRollback` signs only the old compose text, and `Sent` (L95-99) has no routes.
- "In force now" can only be decided inside `sendDeploy`, after `status`.
- **Source of the routes**: the deploy numbered `accepted` in this machine's verified history (with routes kept as in A.4).
  - If another member signed it, this machine doesn't have it. Then either stop with a sentence, or add a runner request that returns the signed current deploy, verified with `readSignedDeployV2`.
  - Not from the current settings file.
- **Plan and checks**: `DeployPlan.routes = "in-force"` for rollbacks; then B12 against the old text (`composeServices` plus the port); the DNS check is skipped.
- The app's rollback (`app/effects/deploys.ts` L242-250) goes through the same code.

## D. Probes (Bun 1.4.4)

### D.1 DNS
```
resolve4(example.com) OK ["104.20.23.154","172.66.147.243"] 8ms
resolve6(example.com) OK ["2606:4700:10::ac42:93f3","2606:4700:10::6814:179a"]
lookup(example.com,{all:true}) OK [two IPv4 only]      <- AAAA dropped (no IPv6 route here)
resolve4/resolve6(no-record.invalid) ERR ENOTFOUND (queryA / queryAaaa)
lookup(no-record.invalid) ERR ENOTFOUND getaddrinfo
resolve6(github.com) ERR ENOTFOUND   <- name exists, no AAAA: Bun says ENOTFOUND, not ENODATA
resolve4("203.0.113.7") ERR ENOTFOUND; lookup("203.0.113.7") OK
new Resolver({timeout:3000,tries:1}).resolve4 OK
```
- Use `resolve4` plus `resolve6`; "no record" means both are empty.
- Test `isIP` first, since `resolve4` of a literal fails.
- `resolve*` doesn't read `/etc/hosts`, which matches what a visitor gets, and satisfies FR-014.
- Shape:
```ts
const resolver = new Resolver({ timeout: 3000, tries: 2 })
const family = (p: Promise<string[]>) => p.catch((e: NodeJS.ErrnoException) =>
  e.code === "ENOTFOUND" || e.code === "ENODATA" ? [] : Promise.reject(e))
async function resolveDomain(name: string) {
  if (isIP(name)) return { v4: isIP(name) === 4 ? [name] : [], v6: isIP(name) === 6 ? [name] : [] }
  const [v4, v6] = await Promise.all([family(resolver.resolve4(name)), family(resolver.resolve6(name))])
  return { v4, v6 }
}
```

### D.2 The host ssh connects to
- **Today**: nothing in the CLI calls `ssh -G` or parses destinations.
  - `transport.ts` holds a destination to `SSH_DESTINATION` (L13) and builds `ssh [-o BatchMode=yes] -- <dest> <remote>` (L346-351).
  - `profile.ts` stores the target at L43-50.
- **Results** from `ssh -G` with a scratch config:
  - `deploy@203.0.113.7` → `hostname 203.0.113.7`
  - an alias → its `HostName` and `Port 2222`
  - a ProxyJump host → `hostname 10.0.0.5` plus `proxyjump` (private, so B13)
  - `203.0.113.7:22` → the literal hostname "203.0.113.7:22"
  - `deploy@2001:db8::1` → `2001:db8::1`
- Exit status 0 each time, with no network. Use `-T` (otherwise it warns about the pseudo-terminal) and `--` before the destination.
- Read only the `hostname`, `proxyjump` and `proxycommand` lines (the output also holds the local user name and identity paths).
- It evaluates the user's `Match exec` lines, as a real connection would. A local target has no public address, so it falls to B13.

### D.3 TLS
```
example.com             authorized, valid_to "Dec 25 22:56:35 2026 GMT", 36 days, 123ms
self-signed.badssl.com  authorized=false DEPTH_ZERO_SELF_SIGNED_CERT
expired.badssl.com      authorized=false CERT_HAS_EXPIRED (first try ECONNRESET)
wrong.host.badssl.com   ECONNRESET twice (site-side; Bun's own hostname check not observed)
no-record.invalid       ENOTFOUND 5ms
example.com via 192.0.2.1  no event at all; ended only by our 3 s timer
checkServerIdentity("shop.example.org", example.com cert) -> ERR_TLS_CERT_ALTNAME_INVALID; for "example.com" -> undefined
```
- Judge a certificate by `authorized` AND an explicit `checkServerIdentity`.
- Always set an own timer, and retry `ECONNRESET` inside the 60 s wait. `Date.parse(valid_to)` works.
- Bun checks against its bundled Mozilla roots, which include Let's Encrypt's, so a test certificate authority needs a stand-in probe in tests.
- `host` may be an address while `servername` stays the domain.
- Do not use `fetch` (`never-fetches.test.ts` L94-115).
- Shape:
```ts
const socket = connect({ host: address ?? domain, port: 443, servername: domain, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] })
// secureConnect: cert = socket.getPeerCertificate(); bad = !socket.authorized || checkServerIdentity(domain, cert)
// valid -> new Date(Date.parse(cert.valid_to)); error -> code; own setTimeout -> "TIMEOUT"
```

### D.4 Injecting these for tests
- `cli/context.ts` `Deps` L25-58 (`OpDeps` L64). The model is `fetch?` (L52-57): optional, set only in `main.ts` L22-29, undefined in tests.
- Add `resolveDomain?`, `probeHttps?` and `sshHost?`, wired in `main.ts`. The app gets them too, because `openApp(deps)` receives the same `OpDeps`.
- Undefined should mean "not looked up", with no network call. A `never-resolves` test can guard who uses them, the way `never-fetches` does for `fetch`.
- Tests replace them by assignment: `m.deps.resolveDomain = async () => ({ v4: ["203.0.113.7"], v6: [] })`, as `never-fetches.test.ts` L79-83 does for `fetch`. `machine()` (`test/support/helpers.ts` L29-84) leaves them out.
- Most scenario tests use a local runner target, which has no public address, so a stand-in decides what the server's addresses are there.

## E. Where domains show
- **`zekno status`**: `ops/status.ts` `readOver` L134-150; `commands/status.ts` table L91-99 and JSON L64-77. The JSON spreads the runner's status answer, so a new field appears in `--json` by itself.
  - E2 means extra table rows, for apps with domains only.
- **`zekno doctor`**: `ops/doctor.ts` (778 lines): `CheckId` L66-74, `LABELS` L110-119, `runnerCheck` L516-576 (the session is open there), `sshChecks` L624-694, `localChecks` L595-622. Rendered by `ui/ink/doctor-report.tsx`, and in plain output by `plain.ts` L110-125.
  - Add a `proxy: "Proxy"` check, only for servers with routed apps.
  - Put it in a new file (`ops/doctor-proxy.ts`, or split doctor into a `doctor/` folder).
- **App, an app's screen**: `app/screens/app.tsx` `AppScreen` L367-447 with `DeploysPane` L138 and `SecretsPane` L267 side by side (L426-443); data from `appDetails` (`views.ts` L303-316), used in `effects/context.ts` L153 and `effects.ts` L112.
  - E7 is a Domains box under Secrets, in a new `app/screens/app-domains.tsx`.
- **App, settings screen**: `app/effects/settings.ts` `outcomeOf` L165-206 → `screenRows`; sections are laid out in `settings-layout.ts` L229-250. Two new rows (domains, health).
- **App, deploy screen**: covered by C.4 and C.6.
- **Help**: new `zekno domain` lines, and `--skip-dns-check` on a new line.
- **Docs**: new pages for domains and health checks.
  - `apps/web/modules/docs/lib/pages.test.ts` pins `CONTRACT` (17 pages, L26-44) and `META` (L47-69), so both must gain the pages.
  - Update `settings.mdx`, `changing-settings.mdx`, `cli.mdx`, `deploying.mdx`, `doctor.mdx`, `security.mdx` L73, `index.mdx` L101 and `output.mdx`.
  - `test/docs/docs.test.ts` requires every command and flag of the help to be named in the pages, and every flag a page names to be on that command's usage line.
- **Stored screens**: the recipes are in `test/screens/recipes`; `bun run screens --check` names the ones that differ.
  - Recapture `help.json` and `settings-screen.json`, and `app-detail.json` if the Domains box is drawn for apps without domains.
  - Add recipes for `zekno domain` and a deploy with a domain. Every stored screen must be shown by a page (`pages.test.ts` L348-380).
- **README**: the "What works today" table (L26-36, and "Not built yet… domains with HTTPS" at L36), the security model (L179), the roadmap (L322). The desktop app stays unnamed.

### E.1 `test/plain/plain-unchanged.test.ts` (to stay unchanged)
**What it freezes**
- (a) `HELP` minus the `ADDED_TO_HELP` list (L20-36) must equal the help at 5264e8a (`HELP_AT_HEAD`).
- (b) The scenes' UI calls, deploy-view calls, `connect` calls, lines and exit statuses, for apps without domains.
- (c) `--for`/`--list`/`--show` on other commands still fail with "Unknown option".

**What the plan touches**
- (a) WILL break with any new help line. Changing the existing deploy line also breaks it.
  - Features 010 and 012 extended `ADDED_TO_HELP` in this file to add their lines; that is a decision for you.
  - The alternative, an unchanged help, conflicts with `docs.test.ts` and `never-fetches`.
- (b) holds only if a deploy without domains makes no new UI call, no new view call, no new `connect` and no new request, and uses the same history words. The DNS check, the wait and `ssh -G` must not run without routes.
- (c) holds if the new options stay out of `OPTIONS`.

## F. Risks and unknowns
1. **Help vs the frozen test**: covered in E.1(a); needs your decision.
2. **Status compatibility**: `RunnerStatusSchema` is a strict object, so domains in the `status` answer break older zeknos' `zekno status` (only deploy runs `chooseFormat`). A separate request asked only by protocol-4 CLIs avoids it.
3. **History compatibility**: the history outcome list and `DeployRow.outcome` are strict, so recording `unhealthy` makes an older zekno unable to read that app's history.
4. **Rollback routes**: signed only if this machine signed the deploy numbered `accepted`. Otherwise a new runner request is needed, which is not in the FR list.
5. **Health shape**: per-service settings vs one signed timeout; the default (60 s?); how `settings set` names it. Lines.md doesn't design these.
6. **Core work the CLI depends on**: export and tighten `isRoutableDomain` (refuse `xn--`); protocol 4; the `unhealthy` outcome; `domain_taken`; a health-wait event; a report field for B16-B19; `createDeployV2`'s `later` stops being "for tests only".
7. **`ssh -G`**: new to the CLI, runs the user's `Match exec`, and gives odd hostnames for odd stored destinations. Jump hosts and local targets fall to B13. A CDN in front is handled only by `--skip-dns-check`.
8. **Bun behaviour**: one `ENOTFOUND` for both kinds of missing record; `lookup` drops AAAA; the name mismatch through `authorized` was unobserved; silent addresses never time out by themselves. A VPN or a corporate TLS proxy can make a correct domain look wrong from this machine.
9. **File sizes and folders**: `cli.ts`, `doctor.ts`, `first-deploy.ts` (it must pass `--skip-dns-check` on to `send` at L445-448) and `app.tsx` need splitting; a `domains/` folder needs a `layers.test.ts` update.
10. **Side effects**: templates must keep refusing domains; `write.ts` `FIELDS` must list the new fields. Deploying a hand-written Compose file, or switching to `-f compose.yaml`, releases the app's domains on the new runner, as the spec says; worth a warning. The uncommitted `meta.json` change already fails `pages.test.ts` `META`.
