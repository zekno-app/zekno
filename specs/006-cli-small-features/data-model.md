# Data Model: Small CLI Features

Nothing here is stored in a new file. The profile folder keeps the files it has (profile.json,
`secrets/`, `history/`, `links.json`); a project folder keeps `zekno.json`. What is new is held in
memory for one run of a command. Names in `code` are the planned TypeScript names.

What the CLI reads that is new: an import file the person names (read once, never copied); one
batch-mode read of a server for the list of apps; `CHECK_SCRIPT`'s lines and a runner's `version`
and `status` for `zekno doctor`; and, for `zekno version` and `zekno doctor` only, one answer from
GitHub about the newest release ("Latest" below).

## Question

Something a single command asks at a terminal (`Ui`, `apps/cli/src/ui/types.ts`). Four kinds.

| Kind | `Ui` member | Fields | Answer | Leaving |
|------|-------------|--------|--------|---------|
| List | `choose<T>(question: ListQuestion<T>): Promise<T>` | `question` (text after `? `), `rows: ListRow<T>[]` (at least one), `collapsed` (the word of the line left behind: `Server`, `App`), `missing: Error` (thrown by the plain interface) | the chosen row's `value` | Esc, Ctrl-C: throws `Left` |
| Typed | `ask(question: TypedQuestion): Promise<string>` | `question`, `fill?: string` (the value filled in), `check(answer): string \| undefined` (a reason when the answer is wrong), `missing: Error` | the checked answer | Esc, Ctrl-C: throws `Left` |
| Yes or no | `confirm(question, refusal, options?: { leave?: boolean }): Promise<boolean>` | as today; `leave` | `y` yes; `n`, Enter no; without `leave` Esc and Ctrl-C no | with `leave`, Esc and Ctrl-C throw `Left` |
| Hidden, skippable | `askValue(question: string): Promise<string \| undefined>` | `question` | the value; `undefined` after Esc | Ctrl-C throws `Left` |

`ListRow<T> = { value: T; label: string; detail?: string; asksNext?: boolean }`. `label` and
`detail` are drawn as given; whoever builds a row cleans anything that came from a file or a server
(`sanitize`). `asksNext`: choosing the row asks a question of its own (`+ a new app`), so at a
terminal it leaves no `✔ App` line behind.

Validation:

- `rows` is never empty: a caller with nothing to offer says so instead of asking.
- A typed answer is at most `TEXT_LIMIT` (256) characters and one line (`applyTextInput`). `check`
  runs on Enter; a reason keeps the question open with the answer as typed.
- A hidden value is never drawn, never kept in React state, never passed to `check`; an empty value
  is refused with a reason (contracts/questions.md, A9) and asked again.
- No question is drawn before `discardTypedAhead` has run on the interface's input (FR-007).

`Ui.asks: boolean`: true only for the Ink interface whose input is a terminal. When false no
command calls these members; if one did, `choose` and `ask` throw `question.missing`, `askValue`
throws the hidden prompt's no-terminal sentence, and `confirm` throws `refusal`, as today.

## The details a command acts on

`Details` (`project.ts`): `{ app?, server?, file? }`, as today, plus `FromProject` (`serverFrom`,
`project`). How each detail is found, in order (contracts/questions.md):

1. a flag;
2. a `zekno.json` signed by the team and used here (the first-use question first when it is
   signed and not used here yet; a file not signed by the team is left aside at a terminal, and
   stops the command in a script, as today);
3. at a terminal only: the one server, said with a dim line; else a question.

State of a detail: `given` (flag), `linked` (zekno.json), `only` (the one server), `asked`. The
first deploy offers "Remember this folder?" only when the server or the app was `asked`, or was
made in this run.

## Server row and app row (what a list offers)

| Row | `label` | `detail` | Order | Source |
|-----|---------|----------|-------|--------|
| Server | the server's name | its SSH destination, or `this machine` | as in profile.json (as `zekno server ls`) | the verified profile |
| App (read) | the app's name | `deploy <n>, <state>`; `deploy <n>` when the state is unknown | Home's order: this machine's latest deploy first, then by name (`latestFirst`) | the runner's `status.lastSequence` (number at least 1) and `state`, read in batch mode within 20 seconds |
| App (not read) | the app's name | `deploy <n>` | the same | `appsOf(team, server, home)`, this machine's verified history |
| New app (deploy only) | `+ a new app` | none | last | fixed |

App names from a runner are held to the app-name pattern by `RunnerStatusSchema` and cleaned
before they are drawn. The number is the runner's when it was read.

## First-deploy state

What `deployAtTerminal` finds before its first question, and what each step leaves
(contracts/first-deploy.md has the lines and failures).

| Step | Done when | Made by | Left on disk, once done | Left on the server, once done |
|------|-----------|---------|-------------------------|-------------------------------|
| Compose file | read once, not empty | `readCompose` | nothing | nothing |
| Key | profile.json exists | `createTeam` | a keychain entry `signing-key:<teamId>`; profile.json with the founding team list and no server | nothing |
| Server | the profile has a server for this deploy | `prepareServerAdd`, `addServer` | profile.json with the next team list and the server | the runner installed (or found), set up for the team, holding the new team list |
| App | an app name is known | a flag, zekno.json, a list or a typed answer | nothing | nothing |
| Folder | answered, or not asked | `linkFolder` on "y" | zekno.json in the folder (signed); `links.json` records it | nothing |
| Values | each expected name has a secret, or was skipped | `prepareSecretSet`, `setSecret`, one per value | `secrets/<serverId>/<app>.json` with each value sealed, one write each | nothing |
| Deploy | the runner answered | `prepareDeploy`, `send` | `history/<serverId>/<app>.json` with the deploy | the app's Compose file and secrets; the app started |

Transitions: each step runs only when the step before is done; a step that is done already is
skipped, which is how a second run carries on. Leaving or a failure stops at the step it is in and
undoes nothing that was done before it; the step it stops in leaves nothing (see the failures in
contracts/first-deploy.md).

## Import entry and import summary

`ImportEntry = { line: number; name: string; value: string }`, the result of reading one entry line
(contracts/import.md). Held in memory only for the run.

`ImportPlan` (`ops/secret.ts`): the verified team, the server, the app, the store as read, and three
groups, each in the file's order:

| Group | Holds | Rule |
|-------|-------|------|
| `fresh` ("new") | names with no current secret | name fits `SECRET_NAME`, at most 128 characters, not reserved, value not empty, at most 64 KiB |
| `replaces` | names with a current secret | the same rule; the app's current secrets have this name (`currentSecrets`, not removed) |
| `leftOut` | `{ shown, reason }` | the name does not fit (`not a valid name`), is reserved (`zekno keeps this name`), the value is empty (`empty`), or larger than 64 KiB (`larger than 64 KiB`), or the name is longer than 128 characters (`a name longer than 128 characters`). `shown` is the key for a reserved name, and `line <n>` for every other reason, so a piece of a wrapped value is never shown (security review S1) |

Limits checked before anything is sealed (each stops the import, "Nothing was stored."): at most
256 accepted values; the app's current secrets and the new names together at most 256; the store's
records and removals plus the new records at most 4096.

Storing: one `withSigner` seals and signs every record, then one `saveSecrets` writes the store
with all of them appended (research R9). Each record's version is the highest version this machine
has seen for its name, set or removed, plus one.

## Check and report (`zekno doctor`)

`CheckLine = { check: CheckId; label: string; result: "good" | "warning" | "problem" | "not checked";
detail: string; next?: string }`.

| `CheckId` | `label` | Where | Depends on |
|-----------|---------|-------|------------|
| `zekno` | `zekno` | this machine | nothing |
| `key` | `Key` | this machine | profile.json readable (for `keyName`) |
| `profile` | `Profile` | this machine | `key` good |
| `folder` | `This folder` | this machine, only with a zekno.json or a compose.yaml | `profile` good, for a zekno.json |
| `reachable` | `Reachable` | each server | `profile` good |
| `docker` | `Docker` | each server over SSH | `reachable` good |
| `runner` | `Runner` | each server | `reachable` good |
| `disk` | `Disk` | each server over SSH | `reachable` good |

A check whose dependency is not good is `not checked` (FR-023), with one exception that keeps the
problem on the right line: when profile.json exists but cannot be read, `key` is not checked and
`profile` is the problem. `next` is present exactly when the result is `warning` or `problem`.
`CheckLine` may also carry `reason` (the `profile` check only, in `--json`).

`DoctorReport = { zekno: string; runner: string; latest: Latest; machine: CheckLine[]; servers: { name: string;
where: string; checks: CheckLine[] }[]; serversSkipped: boolean; problems: number; warnings: number }`.
`where` is the SSH destination or `this machine`. `serversSkipped` is true when the profile did not
verify, so no server was contacted. Exit status: 0 when `problems` is 0, else 1.

## Check script lines

What `CHECK_SCRIPT` prints, one per line, in this order; anything else ends the reading
(contracts/doctor.md):

```text
connected
docker ok <[0-9A-Za-z.+-]{1,32}> | docker none
runner here | runner none
space <[0-9]{1,15}> | space unknown
done
```

or, at any point after `connected`, `fail usage` or `fail home`.

## Version

`CLI_VERSION` (`apps/cli/src/version/version.ts`): `apps/cli/package.json`'s `version`, held to the version
grammar (`RUNNER_VERSION_PATTERN`). `RUNNER_RELEASE.version` (`runner-release.ts`): the runner this
zekno installs. Both are part of the program, never read from the working folder.

## Latest (the newer-release check)

`Latest = { state: "newest" } | { state: "newer"; version: string } | { state: "not_checked" }`,
returned by `checkNewest(deps, carried)` in `apps/cli/src/version/newest.ts` (contracts/version.md).

| Field | Rule |
|-------|------|
| `version` (only for `newer`) | taken from the answer's `tag_name` after `runner-v`; matches `RUNNER_VERSION_PATTERN`; not a development version; newer than `carried` by `compareRunnerVersions` |
| `state: "newest"` | the answer's version is the same as, or older than, `carried` |
| `state: "not_checked"` | no `deps.fetch`; any error; status other than 200; a redirect off `https://api.github.com`; more than three redirects; over 3 seconds; a body over 262,144 bytes, not UTF-8, not JSON, not an object; `tag_name` missing or not of the form; `prerelease` or `draft` not `false` |

Nothing else of the answer is kept, and nothing is written: no cache, no file, no time of the last
check. `Deps` gains `fetch?: typeof fetch`, set by `main.ts` only (research R14).

`DoctorReport` and `zekno version --json` carry it as `latest`.
